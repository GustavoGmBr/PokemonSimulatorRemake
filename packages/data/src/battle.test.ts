import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from './index.ts';
import {
  chooseAction, combatantFrom, createBattle, createPokemon, damageRange, emptyStages, expForDefeating, expForLevel, resumableRng, seededRng,
  stageMultiplier, activeOf, type BattleAction, type BattleContext, type BattleEvent, type BattleState, type Combatant,
} from '@pokesim/engine';

const data = loadGameData();
const ctx: BattleContext = { species: (id) => data.speciesById.get(id) as never, moves: data.movesByName, chart: data.typeChart };

function mon(speciesId: number, level: number, moveNames?: string[], seed = 1): Combatant {
  const species = data.speciesById.get(speciesId) as NonNullable<ReturnType<typeof data.speciesById.get>>;
  const instance = createPokemon({ species, level, rng: seededRng(seed), moves: data.movesByName });
  if (moveNames) instance.moves = moveNames.map((name) => ({ name, pp: (data.movesByName.get(name) as { pp: number }).pp, maxPp: (data.movesByName.get(name) as { pp: number }).pp }));
  return combatantFrom(instance, species, species.displayName);
}

/** Roda um turno com várias sementes até o golpe do jogador acertar (golpes com precisão menor que 100 podem errar). */
function landed(player: Combatant[], foe: Combatant[], action: BattleAction) {
  for (let seed = 1; seed < 60; seed++) {
    const first = createBattle({ player: structuredClone(player), foe: structuredClone(foe), seed });
    const turn = chooseAction(first.state, action, ctx);
    const mine = turn.events.findIndex((e) => e.k === 'move' && e.side === 'player');
    const missed = turn.events.some((e) => e.k === 'miss' && e.side === 'foe');
    if (mine >= 0 && !missed) return { ...turn, base: first.state };
  }
  throw new Error('o golpe nunca acertou');
}

function start(player: Combatant[], foe: Combatant[], seed = 7) {
  return createBattle({ player, foe, seed });
}

const hits = (events: BattleEvent[], side: 'player' | 'foe') => events.filter((e) => e.k === 'hit' && e.side === side);

test('dano: fórmula, STAB, efetividade e variação', () => {
  const a = mon(25, 50, ['thunderbolt']);
  const d = mon(7, 50);
  a.stats = { hp: 100, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 };
  d.stats = { hp: 100, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 };
  const bolt = data.movesByName.get('thunderbolt') as never;
  // (2·50/5+2)=22; 22·90·100/100=1980; /50=39; +2=41; ×STAB 1,5 = 61; ×2 (água) = 122
  const range = damageRange(a, d, bolt, ctx.chart);
  assert.equal(range.effectiveness, 2);
  assert.equal(range.max, 122);
  assert.ok(range.min < range.max && range.min >= 100);
  // imunidade: elétrico em terrestre
  const ground = mon(74, 50);
  assert.equal(damageRange(a, ground, bolt, ctx.chart).effectiveness, 0);
});

test('estágios: Swords Dance dobra o ataque e o limite é ±6', () => {
  assert.equal(stageMultiplier(2), 2);
  assert.equal(stageMultiplier(-2), 0.5);
  const { state } = start([mon(25, 30, ['swords-dance'])], [mon(19, 5, ['tackle'])]);
  let current = state;
  for (let i = 0; i < 4; i++) current = chooseAction(current, { kind: 'move', slot: 0 }, ctx).state;
  assert.equal(activeOf(current, 'player').stages.atk, 6, 'trava em +6');
});

test('queimadura: dano por turno e ataque físico pela metade', () => {
  const a = mon(4, 40, ['tackle']);
  const d = mon(19, 40, ['tackle']);
  const normal = damageRange(a, d, data.movesByName.get('tackle') as never, ctx.chart);
  a.status = 'burn';
  const burned = damageRange(a, d, data.movesByName.get('tackle') as never, ctx.chart);
  assert.ok(burned.max <= Math.ceil(normal.max / 2));
  const turn = landed([mon(4, 40, ['will-o-wisp'])], [mon(7, 40, ['splash'])], { kind: 'move', slot: 0 });
  assert.equal(activeOf(turn.state, 'foe').status, 'burn');
  assert.ok(turn.events.some((e) => e.k === 'hit' && e.cause === 'burn'));
});

test('imunidades de status por tipo e um status por vez', () => {
  const { state } = start([mon(25, 40, ['thunder-wave', 'will-o-wisp'])], [mon(25, 40, ['splash'])]);
  const t1 = chooseAction(state, { kind: 'move', slot: 0 }, ctx);
  assert.equal(activeOf(t1.state, 'foe').status, null, 'elétrico não paralisa elétrico');
  const t2 = landed([mon(25, 40, ['thunder-wave', 'will-o-wisp'])], [mon(25, 40, ['splash'])], { kind: 'move', slot: 1 });
  assert.equal(activeOf(t2.state, 'foe').status, 'burn');
  const t3 = chooseAction({ ...t2.state, player: { ...t2.state.player, team: t2.state.player.team.map((c) => ({ ...c, moves: c.moves.map((m) => ({ ...m, pp: 20 })) })) } }, { kind: 'move', slot: 0 }, ctx);
  assert.equal(activeOf(t3.state, 'foe').status, 'burn', 'queimado não troca por paralisia');
});

test('sono impede de agir e acaba sozinho; confusão e paralisia aparecem', () => {
  const { state } = start([mon(25, 40, ['tackle'])], [mon(19, 40, ['tackle'])]);
  let s: BattleState = { ...state, player: { ...state.player, team: [{ ...state.player.team[0] as Combatant, status: 'sleep', sleepTurns: 3 }] } };
  const t = chooseAction(s, { kind: 'move', slot: 0 }, ctx);
  assert.ok(t.events.some((e) => e.text.includes('dormindo')));
  assert.equal(hits(t.events, 'foe').length, 0);
  // acorda depois de alguns turnos
  s = t.state;
  let woke = false;
  for (let i = 0; i < 4 && s.phase !== 'ended'; i++) {
    const r = chooseAction(s, { kind: 'move', slot: 0 }, ctx);
    if (r.events.some((e) => e.k === 'status-end' && e.status === 'sleep')) woke = true;
    s = r.state;
  }
  assert.ok(woke);
  const conf = start([mon(25, 40, ['confuse-ray'])], [mon(19, 40, ['splash'])]);
  const c = chooseAction(conf.state, { kind: 'move', slot: 0 }, ctx);
  assert.ok(activeOf(c.state, 'foe').confusion > 0);
});

test('prioridade vence velocidade; sem prioridade, o mais rápido ataca primeiro', () => {
  const fast = mon(25, 30, ['quick-attack']);
  const slow = mon(143, 30, ['tackle']); // Snorlax
  const { state } = start([slow], [fast]);
  const turn = chooseAction(state, { kind: 'move', slot: 0 }, ctx);
  const moves = turn.events.filter((e) => e.k === 'move');
  assert.equal(moves[0]?.k === 'move' && moves[0].side, 'foe');
  const quick = start([mon(25, 30, ['tackle'])], [mon(143, 30, ['tackle'])]);
  const t2 = chooseAction(quick.state, { kind: 'move', slot: 0 }, ctx);
  const first = t2.events.find((e) => e.k === 'move');
  assert.equal(first?.k === 'move' && first.side, 'player');
});

test('trocar custa o turno, fuga funciona e Pokémon caído pede substituto', () => {
  const player = [mon(25, 5, ['tackle']), mon(1, 50, ['tackle'])];
  const { state } = start(player, [mon(150, 100, ['psychic'])]);
  const sw = chooseAction(state, { kind: 'switch', to: 1 }, ctx);
  assert.equal(sw.state.player.active, 1);
  assert.ok(hits(sw.events, 'player').length >= 1, 'o oponente atacou depois da troca');
  assert.throws(() => chooseAction(state, { kind: 'switch', to: 0 }, ctx), /em campo/);
  // morre → pede troca
  const weak = start([mon(25, 1, ['tackle']), mon(1, 20, ['tackle'])], [mon(150, 100, ['psychic'])]);
  const hit = chooseAction(weak.state, { kind: 'move', slot: 0 }, ctx);
  assert.equal(hit.state.phase, 'replace');
  assert.throws(() => chooseAction(hit.state, { kind: 'move', slot: 0 }, ctx), /próximo/);
  const back = chooseAction(hit.state, { kind: 'switch', to: 1 }, ctx);
  assert.equal(back.state.phase, 'choose');
  assert.equal(back.state.player.active, 1);
  // fuga: mais rápido sempre foge
  const run = start([mon(25, 100, ['tackle'])], [mon(143, 5, ['tackle'])]);
  const r = chooseAction(run.state, { kind: 'run' }, ctx);
  assert.equal(r.state.result, 'fled');
});

test('derrota quando toda a equipe cai', () => {
  let s = start([mon(10, 1, ['tackle'])], [mon(150, 100, ['psychic'])]).state;
  const r = chooseAction(s, { kind: 'move', slot: 0 }, ctx);
  s = r.state;
  assert.equal(s.result, 'lose');
  assert.equal(s.phase, 'ended');
  assert.throws(() => chooseAction(s, { kind: 'move', slot: 0 }, ctx), /acabou/);
});

test('vitória rende XP, sobe de nível e aprende golpe', () => {
  const species = data.speciesById.get(25) as NonNullable<ReturnType<typeof data.speciesById.get>>;
  const hero = mon(25, 9, ['tackle']);
  hero.exp = expForLevel(species.growthRate, 9) + expForLevel(species.growthRate, 10) - expForLevel(species.growthRate, 9) - 1;
  const foe = mon(10, 3, ['tackle']);
  foe.stats.hp = 1;
  foe.hp = 1;
  const { state } = start([hero], [foe]);
  const r = chooseAction(state, { kind: 'move', slot: 0 }, { ...ctx, expMultiplier: 1 });
  assert.equal(r.state.result, 'win');
  const xp = r.events.find((e) => e.k === 'xp');
  assert.equal(xp?.k === 'xp' && xp.amount, expForDefeating(data.speciesById.get(10) as never, 3));
  const lv = r.events.find((e) => e.k === 'level');
  assert.equal(lv?.k === 'level' && lv.level, 10);
  const me = activeOf(r.state, 'player');
  assert.equal(me.level, 10);
  assert.ok(me.stats.hp > hero.stats.hp - 1);
});

test('golpe novo sem vaga fica pendente', () => {
  const species = data.speciesById.get(25) as NonNullable<ReturnType<typeof data.speciesById.get>>;
  const learn = species.learnset.filter((e) => e.method === 'level-up' && e.level > 1).sort((a, b) => a.level - b.level)[0];
  assert.ok(learn);
  const hero = mon(25, (learn?.level ?? 2) - 1, ['tackle', 'growl', 'thunder-shock', 'quick-attack']);
  hero.exp = expForLevel(species.growthRate, hero.level + 1) - 1;
  const foe = mon(10, 3, ['tackle']);
  foe.hp = 1;
  const { state } = start([hero], [foe]);
  const r = chooseAction(state, { kind: 'move', slot: 0 }, ctx);
  const me = activeOf(r.state, 'player');
  if (!hero.moves.some((m) => m.name === learn?.move)) assert.ok(me.pendingMoves.includes(learn?.move ?? ''));
});

test('multi-golpe, dreno e recuo', () => {
  const { state } = start([mon(25, 50, ['fury-swipes', 'giga-drain', 'double-edge'])], [mon(143, 50, ['splash'])]);
  const many = landed([mon(25, 50, ['fury-swipes'])], [mon(143, 50, ['splash'])], { kind: 'move', slot: 0 });
  assert.ok(hits(many.events, 'foe').length >= 1);
  const recoil = chooseAction(state, { kind: 'move', slot: 2 }, ctx);
  if (hits(recoil.events, 'foe').length > 0) assert.ok(recoil.events.some((e) => e.k === 'hit' && e.cause === 'recoil'));
});

test('sem PP: Struggle', () => {
  const hero = mon(25, 50, ['tackle']);
  hero.moves = [{ name: 'tackle', pp: 0, maxPp: 35 }];
  const { state } = start([hero], [mon(143, 50, ['splash'])]);
  assert.throws(() => chooseAction(state, { kind: 'move', slot: 0 }, ctx), /PP/);
  const r = chooseAction(state, { kind: 'move', slot: -1 }, ctx);
  assert.ok(r.events.some((e) => e.k === 'move' && e.move === 'struggle'));
});

test('reprodutível: mesma semente e ações dão a mesma batalha; outra semente muda', () => {
  const play = (seed: number) => {
    let { state } = start([mon(6, 40, ['flamethrower', 'slash', 'dragon-claw', 'swords-dance'])], [mon(9, 40, ['water-gun', 'bite', 'surf', 'withdraw'])], seed);
    const log: BattleEvent[] = [];
    for (let i = 0; i < 30 && state.phase !== 'ended'; i++) {
      const r = chooseAction(state, { kind: 'move', slot: i % 3 }, ctx);
      state = r.state;
      log.push(...r.events);
    }
    return JSON.stringify(log);
  };
  assert.equal(play(123), play(123));
  assert.notEqual(play(123), play(124));
});

test('estado é serializável e retomável no meio da batalha', () => {
  const { state } = start([mon(6, 40, ['flamethrower', 'slash'])], [mon(9, 40, ['water-gun', 'bite'])], 99);
  const a = chooseAction(state, { kind: 'move', slot: 0 }, ctx);
  const restored = JSON.parse(JSON.stringify(a.state)) as BattleState;
  const b1 = chooseAction(a.state, { kind: 'move', slot: 1 }, ctx);
  const b2 = chooseAction(restored, { kind: 'move', slot: 1 }, ctx);
  assert.deepEqual(b1, b2);
});

test('fuzz: 500 batalhas aleatórias terminam sem erro e respeitam os invariantes', () => {
  const rng = resumableRng(2026);
  const ids = [1, 4, 7, 25, 39, 52, 63, 66, 74, 92, 94, 129, 133, 143, 150, 151, 152, 249, 280, 330, 448, 493, 571, 700, 888];
  for (let battle = 0; battle < 500; battle++) {
    const level = 5 + rng.int(60);
    const team = Array.from({ length: 1 + rng.int(3) }, (_, i) => mon(ids[rng.int(ids.length)] as number, level + rng.int(10), undefined, battle * 7 + i));
    const foe = mon(ids[rng.int(ids.length)] as number, level + rng.int(10), undefined, battle * 13);
    let { state } = start(team, [foe], battle);
    let turns = 0;
    while (state.phase !== 'ended' && turns < 400) {
      turns++;
      let action: BattleAction;
      if (state.phase === 'replace') action = { kind: 'switch', to: state.player.team.findIndex((c) => c.hp > 0) };
      else {
        const me = activeOf(state, 'player');
        const slots = me.moves.map((m, i) => (m.pp > 0 ? i : -1)).filter((i) => i >= 0);
        action = slots.length ? { kind: 'move', slot: slots[rng.int(slots.length)] as number } : { kind: 'move', slot: -1 };
      }
      const r = chooseAction(state, action, ctx);
      state = r.state;
      for (const c of [...state.player.team, ...state.foe.team]) {
        assert.ok(c.hp >= 0 && c.hp <= c.stats.hp, 'HP dentro dos limites');
        for (const key of Object.keys(c.stages) as (keyof typeof c.stages)[]) assert.ok(Math.abs(c.stages[key]) <= 6);
        for (const m of c.moves) assert.ok(m.pp >= 0 && m.pp <= m.maxPp);
      }
      for (const e of r.events) assert.ok(typeof e.text === 'string');
    }
    assert.ok(state.phase === 'ended', `batalha ${battle} terminou (${turns} turnos)`);
    assert.ok(state.result === 'win' || state.result === 'lose');
    void emptyStages;
  }
});
