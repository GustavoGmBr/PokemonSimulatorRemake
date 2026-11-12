import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOSS_DURATION, BOSS_TIERS, BOSS_WIPE_PENALTY, bossPool, rollBossIvs, seededRng, statsOf, STAT_KEYS, type BattleState } from '@pokesim/engine';
import { loadGameData } from '@pokesim/data';
import { createBattleService } from './battle-service.ts';
import { openDatabase } from './db.ts';
import { createInventory } from './inventory.ts';
import { createJournal } from './journal.ts';
import { createPokemonStore } from './pokemon-store.ts';
import { createSaveService } from './saves.ts';
import { createWildService } from './wild-service.ts';

test('chefes respeitam os grupos de espécies e os limites de IVs de cada estrela', () => {
  const { species } = loadGameData();
  const weak = new Set([...bossPool(species, 1), ...bossPool(species, 2)].map((entry) => entry.id));
  const rng = seededRng(42);
  for (const tier of BOSS_TIERS) {
    const pool = bossPool(species, tier.stars);
    assert.ok(pool.length > 0);
    if (tier.stars < 6) assert.ok(pool.every((entry) => !entry.legendary && !entry.mythical && entry.id !== 793));
    if (tier.stars >= 3) assert.ok(pool.every((entry) => !weak.has(entry.id)));
    for (let i = 0; i < 100; i++) {
      const ivs = rollBossIvs(tier, rng);
      if (tier.stars === 1) assert.equal(ivs, undefined);
      else {
        const values = Object.values(ivs!);
        const percent = values.reduce((sum, iv) => sum + iv, 0) * 100 / 186;
        assert.ok(values.every((iv) => Number.isInteger(iv) && iv >= 0 && iv <= 31));
        assert.ok(percent >= tier.minIv && percent <= tier.maxIv);
      }
    }
  }
  for (const id of [150, 151, 793]) assert.ok(bossPool(species, 6).some((entry) => entry.id === id));
});

test('batalha de chefe persiste, desconta uma derrota, paga a vitória uma vez e permite uma captura', () => {
  const db = openDatabase(':memory:');
  try {
    const store = createPokemonStore(db);
    const inventory = createInventory(db);
    const journal = createJournal(db);
    const wild = createWildService(db, store, inventory, journal);
    const saves = createSaveService(db, store);
    const save = saves.create({ trainerName: 'Chefe', starterSpeciesId: 4 });
    let now = BOSS_DURATION + 100;
    const makeBattle = () => createBattleService(db, store, inventory, wild, journal, () => 123, () => now);
    const battle = makeBattle();
    let rotation = battle.bosses(save.id);
    for (let i = 0; i < 10 && new Set(rotation.offers.map((offer) => offer.stars)).size === 6; i++) {
      now += BOSS_DURATION;
      rotation = battle.bosses(save.id);
    }
    assert.equal(rotation.offers.length, 6);
    assert.equal(new Set(rotation.offers.map((offer) => offer.slot)).size, 6);
    for (const offer of rotation.offers) {
      const tier = BOSS_TIERS.find((entry) => entry.stars === offer.stars)!;
      assert.equal(offer.level, tier.level);
      assert.equal(offer.hpMultiplier, tier.hpMultiplier);
    }
    const first = rotation.offers.find((offer) => rotation.offers.some((other) => other.slot !== offer.slot && other.stars === offer.stars))!;
    assert.ok(first, 'a rotação aceita estrelas repetidas');
    const duplicate = rotation.offers.find((offer) => offer.slot !== first.slot && offer.stars === first.stars)!;
    assert.deepEqual(battle.bosses(save.id).offers, rotation.offers);
    assert.equal(rotation.teamMinLevel, 5);
    assert.throws(() => battle.startBoss(save.id, first.slot, rotation.period), new RegExp(`nível ${first.level}`));
    assert.equal(battle.bosses(save.id).offers[first.slot]?.status, 'available');
    db.prepare('UPDATE pokemon SET level = ? WHERE save_id = ? AND team_slot IS NOT NULL').run(first.level, save.id);
    const start = battle.startBoss(save.id, first.slot, rotation.period);
    assert.equal(start.view.boss?.deadline, now + BOSS_DURATION);
    const stored = db.prepare('SELECT state FROM battles WHERE save_id = ?').get(save.id) as { state: string };
    const fight = JSON.parse(stored.state) as BattleState;
    const original = fight.boss!.pokemon;
    const normal = statsOf(original, loadGameData().speciesById.get(original.speciesId)!);
    for (const stat of STAT_KEYS) {
      const expected = stat === 'hp' ? normal.hp * first.hpMultiplier : Math.floor(normal[stat] * (100 + first.statBonusPercent) / 100);
      assert.equal(fight.foe.team[0]!.stats[stat], expected, stat);
    }
    assert.equal(start.view.heals.length, 0);
    assert.equal(start.view.balls.length, 0);
    assert.throws(() => battle.act(save.id, { kind: 'item', item: 'potion', target: 0 }), /Itens de cura/);
    assert.equal(inventory.quantity(save.id, 'potion'), 5);
    assert.throws(() => battle.act(save.id, { kind: 'ball', item: 'poke-ball' }), /capturar/);

    const changeBattle = (change: (state: BattleState) => void) => {
      const row = db.prepare('SELECT state FROM battles WHERE save_id = ?').get(save.id) as { state: string };
      const state = JSON.parse(row.state) as BattleState;
      change(state);
      db.prepare('UPDATE battles SET state = ? WHERE save_id = ?').run(JSON.stringify(state), save.id);
    };
    changeBattle((state) => {
      const player = state.player.team[0]!;
      player.hp = 1;
      player.moves = [{ name: 'tackle', pp: 1, maxPp: 1 }];
      state.foe.team[0]!.stats.atk = 100_000;
      state.foe.team[0]!.moves = [{ name: 'quick-attack', pp: 1, maxPp: 1 }];
    });
    const resumed = makeBattle();
    const continued = resumed.act(save.id, { kind: 'move', slot: 0 }).view;
    assert.equal(continued.boss?.wipes, 1);
    assert.equal(continued.boss?.deadline, now + BOSS_DURATION - BOSS_WIPE_PENALTY);
    assert.equal(continued.player.team[0]?.hp, continued.player.team[0]?.maxHp);
    assert.equal(continued.foe.team[0]?.hp, start.view.foe.team[0]?.hp);
    assert.equal(continued.outcome, null);

    changeBattle((state) => {
      const player = state.player.team[0]!;
      player.stats.spe = 100_000;
      player.stats.atk = 100_000;
      const foe = state.foe.team[0]!;
      foe.hp = 1;
      foe.types = ['normal'];
      foe.moves = [{ name: 'tackle', pp: 1, maxPp: 1 }];
    });
    const won = resumed.act(save.id, { kind: 'move', slot: 0 }).view;
    assert.equal(won.outcome?.result, 'win');
    assert.ok(won.outcome!.money > 0 && won.outcome!.rewards.length > 0);
    assert.equal(saves.get(save.id).money, save.money + won.outcome!.money);
    assert.throws(() => resumed.startBoss(save.id, first.slot, rotation.period), /já enfrentou/);
    const rewardedBalls = inventory.quantity(save.id, 'master-ball');
    if (rewardedBalls > 0) inventory.take(save.id, 'master-ball', rewardedBalls);
    assert.throws(() => resumed.captureBoss(save.id, rotation.period, first.slot, 'master-ball'), /não tem essa Poké Bola/);
    inventory.add(save.id, 'master-ball', 2);
    const second = resumed.startBoss(save.id, duplicate.slot, rotation.period);
    assert.equal(second.view.boss?.stars, first.stars);
    assert.equal(resumed.bosses(save.id).pending[0]?.slot, first.slot);
    now += BOSS_DURATION;
    const expired = resumed.act(save.id, { kind: 'check-boss' }).view;
    assert.equal(expired.outcome?.result, 'lose');
    assert.equal(expired.outcome.money, 0);
    assert.equal(resumed.current(save.id), null);
    assert.notEqual(resumed.bosses(save.id).period, rotation.period);
    assert.equal(resumed.captureBoss(save.id, rotation.period, first.slot, 'master-ball').caught, true);
    assert.equal(inventory.quantity(save.id, 'master-ball'), 1);
    assert.throws(() => resumed.captureBoss(save.id, rotation.period, first.slot, 'master-ball'), /tentativa/);
    assert.equal(inventory.quantity(save.id, 'master-ball'), 1);
    const captured = store.team(save.id).find((mon) => mon.level === first.level && mon.speciesId === first.speciesId && mon.ball === 'master-ball');
    assert.deepEqual(captured?.stats, normal);

    assert.equal(resumed.bosses(save.id).pending.length, 0);
  } finally {
    db.close();
  }
});
