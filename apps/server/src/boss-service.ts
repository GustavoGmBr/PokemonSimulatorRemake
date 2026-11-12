import { createHash, randomInt } from 'node:crypto';
import {
  BOSS_DURATION, BOSS_TIERS, attemptCapture, bossMoney, bossPool, captureChance, createPokemon,
  pick, regionOfSpecies, rngFrom, rollBossIvs, rollPrizeItems, seededRng, statsOf, tournamentTier,
  type BattleEvent, type BattleOutcome, type BossFight, type BossOffer, type BossState, type PokemonInstance,
} from '@pokesim/engine';
import { loadGameData } from '@pokesim/data';
import { transaction, type Db } from './db.ts';
import { shinyCharmGenerations } from './dex-progress.ts';
import { badRequest, notFound } from './errors.ts';
import type { Inventory } from './inventory.ts';
import type { Journal } from './journal.ts';
import type { PokemonStore } from './pokemon-store.ts';

interface Attempt {
  period: number;
  slot: number;
  stars: number;
  status: Exclude<BossOffer['status'], 'available'>;
  pokemon: string | null;
}

export function createBossService(db: Db, store: PokemonStore, inventory: Inventory, journal: Journal, now: () => number) {
  const data = loadGameData();
  const pools = BOSS_TIERS.map((tier) => bossPool(data.species, tier.stars));
  const tierOf = (stars: unknown) => BOSS_TIERS.find((tier) => tier.stars === stars);
  const speciesOf = (mon: PokemonInstance) => data.speciesById.get(mon.speciesId)!;

  function assertSave(saveId: string) {
    if (!db.prepare('SELECT 1 FROM saves WHERE id = ?').get(saveId)) throw notFound('Save não encontrado.');
  }

  function teamMinLevel(saveId: string): number | null {
    const row = db.prepare('SELECT MIN(level) AS level FROM pokemon WHERE save_id = ? AND team_slot IS NOT NULL')
      .get(saveId) as { level: number | null };
    return row.level;
  }

  function rollOffer(saveId: string, period: number, slot: number, boosted: readonly number[]) {
    const seed = createHash('sha256').update(`${saveId}:${period}:slot:${slot}`).digest().readUInt32LE();
    const rng = seededRng(seed);
    const tier = pick(rng, BOSS_TIERS);
    const species = pick(rng, pools[tier.stars - 1]!);
    const denominator = tier.shinyDenominator;
    const bonus = boosted.includes(species.generation) ? 2 * denominator : 0;
    const shiny = rng.int(100 * denominator) < 100 + bonus;
    const pokemon = createPokemon({ species, level: tier.level, rng, moves: data.movesByName, shiny, ivs: rollBossIvs(tier, rng) });
    return { tier, pokemon };
  }

  function captureInput(saveId: string, mon: PokemonInstance, ball: string) {
    const species = speciesOf(mon);
    return {
      maxHp: statsOf(mon, species).hp,
      currentHp: 0,
      captureRate: species.captureRate,
      ball,
      catchingCharm: inventory.quantity(saveId, 'catching-charm') > 0,
      context: { types: species.types, weight: species.weight, height: species.height, firstTurn: true, leadTypes: store.team(saveId)[0]?.types ?? [] },
    };
  }

  function state(saveId: string): BossState {
    assertSave(saveId);
    const period = Math.floor(now() / BOSS_DURATION);
    const rows = db.prepare("SELECT period, slot, stars, status, pokemon FROM boss_attempts WHERE save_id = ? AND (period = ? OR status = 'capture') ORDER BY period DESC, slot")
      .all(saveId, period) as unknown as Attempt[];
    const boosted = shinyCharmGenerations(db, saveId);
    return {
      period,
      resetsAt: (period + 1) * BOSS_DURATION,
      teamMinLevel: teamMinLevel(saveId),
      offers: Array.from({ length: BOSS_TIERS.length }, (_, slot) => {
        const row = rows.find((entry) => entry.period === period && entry.slot === slot);
        const rolled = rollOffer(saveId, period, slot, boosted);
        const tier = tierOf(row?.stars) ?? rolled.tier;
        const mon = row?.pokemon ? JSON.parse(row.pokemon) as PokemonInstance : rolled.pokemon;
        return {
          slot, stars: tier.stars, speciesId: mon.speciesId, name: speciesOf(mon).displayName, shiny: mon.shiny,
          level: tier.level, hpMultiplier: tier.hpMultiplier, statBonusPercent: tier.statBonusPercent, status: row?.status ?? 'available',
        };
      }),
      pending: rows.filter((row) => row.status === 'capture' && row.pokemon).map((row) => {
        const mon = JSON.parse(row.pokemon!) as PokemonInstance;
        const balls = data.items.filter((item) => item.category === 'captura').flatMap((item) => {
          const quantity = inventory.quantity(saveId, item.name);
          return quantity > 0 ? [{
            item: item.name, displayName: item.displayName, description: item.description, quantity,
            chance: captureChance(captureInput(saveId, mon, item.name)),
          }] : [];
        });
        return { period: row.period, slot: row.slot, stars: row.stars, speciesId: mon.speciesId, name: speciesOf(mon).displayName, shiny: mon.shiny, balls };
      }),
    };
  }

  return {
    state,

    begin(saveId: string, slot: unknown, requestedPeriod: unknown): BossFight {
      if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot >= BOSS_TIERS.length) throw badRequest('Escolha um chefe da rotação.');
      const started = now();
      const period = Math.floor(started / BOSS_DURATION);
      if (requestedPeriod !== period) throw badRequest('Os chefes mudaram. Atualize a lista.');
      db.prepare("DELETE FROM boss_attempts WHERE save_id = ? AND period < ? AND status IN ('lost', 'spent')").run(saveId, period);
      const { tier, pokemon } = rollOffer(saveId, period, slot, shinyCharmGenerations(db, saveId));
      const minLevel = teamMinLevel(saveId);
      if (minLevel === null || minLevel < tier.level) {
        throw badRequest(`Todos os Pokémon da equipe precisam estar no nível ${tier.level} ou acima para enfrentar este chefe.`);
      }
      const inserted = db.prepare("INSERT OR IGNORE INTO boss_attempts (save_id, period, slot, stars, status, pokemon) VALUES (?, ?, ?, ?, 'running', ?)")
        .run(saveId, period, slot, tier.stars, JSON.stringify(pokemon));
      if (!inserted.changes) throw badRequest('Você já enfrentou este chefe nesta rotação.');
      return { period, slot, stars: tier.stars, deadline: started + BOSS_DURATION, wipes: 0, pokemon };
    },

    finish(saveId: string, fight: BossFight, won: boolean, events: BattleEvent[]): BattleOutcome {
      const tier = tierOf(fight.stars)!;
      const remaining = fight.deadline - now();
      const victory = won && remaining > 0;
      const updated = db.prepare("UPDATE boss_attempts SET status = ? WHERE save_id = ? AND period = ? AND slot = ? AND status = 'running'")
        .run(victory ? 'capture' : 'lost', saveId, fight.period, fight.slot ?? fight.stars - 1);
      const money = victory && updated.changes ? bossMoney(tier, remaining, fight.wipes) : 0;
      const rewards: BattleOutcome['rewards'] = [];
      if (money) {
        db.prepare('UPDATE saves SET money = money + ?, updated_at = ? WHERE id = ?').run(money, new Date(now()).toISOString(), saveId);
        for (const prize of rollPrizeItems(tournamentTier(tier.prizes)!, rngFrom(randomInt))) {
          inventory.add(saveId, prize.item, prize.quantity);
          rewards.push({ ...prize, name: data.itemsByName.get(prize.item)?.displayName ?? prize.item });
        }
        events.push({ k: 'text', text: 'Chefe derrotado! Escolha uma Poké Bola na tela de Chefes para tentar a captura.' });
      }
      if (!victory && remaining <= 0) events.push({ k: 'text', text: 'O tempo do desafio acabou!' });
      store.healTeam(saveId);
      db.prepare('DELETE FROM battles WHERE save_id = ?').run(saveId);
      return { result: victory ? 'win' : 'lose', money, caught: null, levels: [], pending: [], rewards, badge: null, trainerName: null, tournament: null };
    },

    capture(saveId: string, period: unknown, slot: unknown, ball: unknown) {
      assertSave(saveId);
      if (typeof period !== 'number' || !Number.isSafeInteger(period) || typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot >= BOSS_TIERS.length) throw badRequest('Escolha um chefe derrotado.');
      const item = typeof ball === 'string' ? data.itemsByName.get(ball) : undefined;
      if (!item || item.category !== 'captura') throw badRequest('Escolha uma Poké Bola.');
      return transaction(db, () => {
        const row = db.prepare("SELECT pokemon, stars FROM boss_attempts WHERE save_id = ? AND period = ? AND slot = ? AND status = 'capture'")
          .get(saveId, period, slot) as { pokemon: string; stars: number } | undefined;
        if (!row) throw badRequest('Este chefe não tem tentativa de captura disponível.');
        if (!inventory.take(saveId, item.name)) throw badRequest('Você não tem essa Poké Bola.');
        db.prepare("UPDATE boss_attempts SET status = 'spent' WHERE save_id = ? AND period = ? AND slot = ?")
          .run(saveId, period, slot);
        const mon = JSON.parse(row.pokemon) as PokemonInstance;
        const result = attemptCapture(rngFrom(randomInt), captureInput(saveId, mon, item.name));
        if (result.caught) {
          store.place(saveId, { ...mon, ball: item.name });
          journal.record(saveId, { kind: 'capturar', region: regionOfSpecies(mon.speciesId)?.id ?? null, speciesId: mon.speciesId, text: `Capturou o chefe ${speciesOf(mon).displayName} de ${row.stars} estrelas.` });
        }
        return { caught: result.caught, name: speciesOf(mon).displayName, state: state(saveId) };
      });
    },
  };
}
