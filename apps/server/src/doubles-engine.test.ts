import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseDoubles, chooseReplacements, combatantFrom, createDoubles, createPokemon, monAt, replacementsNeeded, rngFrom,
  type BattleContext, type Combatant, type DoublesState, type TrainerInfo,
} from '@pokesim/engine';
import { loadGameData } from '@pokesim/data';

const data = loadGameData();
const ctx: BattleContext = { species: (id) => data.speciesById.get(id)!, moves: data.movesByName, chart: data.typeChart };
let seed = 1;
const rng = rngFrom((max) => (seed = (seed * 48271) % 2147483647) % max);

function mon(speciesId: number, level = 50): Combatant {
  const species = data.speciesById.get(speciesId)!;
  return combatantFrom(createPokemon({ species, level, rng, moves: data.movesByName }), species, species.displayName, `ref-${speciesId}-${seed}`);
}
const trainer = (skill: 1 | 2 | 3 = 2): TrainerInfo => ({ name: 'Dupla', title: '', skill, bag: [], lastSwitch: -9 });

function fresh(player: Combatant[], foe: Combatant[], skill: 1 | 2 | 3 = 2) {
  return createDoubles({ player, foe, seed: 7, trainer: trainer(skill) });
}

test('duplas: começa com dois de cada lado e mostra as entradas', () => {
  const { state, events } = fresh([mon(6), mon(9), mon(3)], [mon(25), mon(26), mon(143)]);
  assert.deepEqual(state.player.active, [0, 1]);
  assert.deepEqual(state.foe.active, [0, 1]);
  assert.equal(events.filter((e) => e.k === 'send').length, 4);
  assert.ok(events.filter((e) => e.k === 'send').every((e) => 'pos' in e));
});

test('duplas: um turno resolve quatro ações com eventos marcados por posição', () => {
  const { state } = fresh([mon(6, 60), mon(9, 60)], [mon(25, 30), mon(26, 30)]);
  for (const side of ['player', 'foe'] as const) for (const c of state[side].team) c.moves = [{ name: 'tackle', pp: 35, maxPp: 35 }];
  const out = chooseDoubles(state, [{ kind: 'move', slot: 0, target: { side: 'foe', pos: 0 } }, { kind: 'move', slot: 0, target: { side: 'foe', pos: 1 } }], ctx);
  assert.equal(out.state.turn, 1);
  const moves = out.events.filter((e) => e.k === 'move');
  assert.ok(moves.length >= 2 && moves.length <= 4);
  assert.ok(moves.every((e) => (e as { pos?: number }).pos === 0 || (e as { pos?: number }).pos === 1));
  const hits = out.events.filter((e) => e.k === 'hit');
  assert.ok(hits.length >= 2);
  assert.ok(hits.every((e) => e.side === 'foe' || e.side === 'player'));
});

test('duplas: golpe em área atinge os dois adversários com dano reduzido', () => {
  const { state } = fresh([mon(6, 80), mon(9, 80)], [mon(143, 40), mon(143, 40)]);
  state.player.team[0]!.moves = [{ name: 'earthquake', pp: 10, maxPp: 10 }];
  state.player.team[1]!.moves = [{ name: 'tackle', pp: 35, maxPp: 35 }];
  for (const c of state.foe.team) c.moves = [{ name: 'growl', pp: 40, maxPp: 40 }];
  const out = chooseDoubles(state, [{ kind: 'move', slot: 0 }, { kind: 'move', slot: 0 }], ctx);
  const quake = out.events.filter((e) => e.k === 'hit' && e.side === 'foe');
  const positions = new Set(quake.map((e) => (e as { pos?: number }).pos));
  assert.ok(positions.has(0) && positions.has(1), 'os dois alvos levam dano');
});

test('duplas: derrotar os dois vence; reserva do treinador entra sozinho; XP chega aos dois de pé', () => {
  const { state } = fresh([mon(6, 100), mon(9, 100)], [mon(10, 5), mon(10, 5), mon(10, 5)]);
  for (const c of state.player.team) { c.moves = [{ name: 'scratch', pp: 35, maxPp: 35 }]; c.stats.spe = 9999; c.exp = 0; }
  for (const c of state.foe.team) c.moves = [{ name: 'tackle', pp: 35, maxPp: 35 }];
  const turn = [{ kind: 'move', slot: 0, target: { side: 'foe', pos: 0 } }, { kind: 'move', slot: 0, target: { side: 'foe', pos: 1 } }] as const;
  let out = chooseDoubles(state, [...turn], ctx);
  assert.ok(out.events.some((e) => e.k === 'faint' && e.side === 'foe'));
  assert.ok(out.events.some((e) => e.k === 'send' && e.side === 'foe'), 'o terceiro entra no lugar');
  assert.ok(out.events.some((e) => e.k === 'xp'));
  assert.equal(out.state.phase, 'choose');
  const survivor = out.state.foe.active.map((_, pos) => monAt(out.state, 'foe', pos as 0 | 1)).filter((m) => m && m.hp > 0);
  assert.ok(survivor.length >= 1);
  for (let i = 0; i < 4 && out.state.phase !== 'ended'; i++) out = chooseDoubles(out.state, [...turn], ctx);
  assert.equal(out.state.phase, 'ended');
  assert.equal(out.state.result, 'win');
});

test('duplas: quando um dos seus cai, pede a troca e aceita só quem está de reserva', () => {
  const { state } = fresh([mon(10, 5), mon(10, 5), mon(25, 50)], [mon(143, 100), mon(143, 100)], 3);
  for (const c of state.foe.team) { c.moves = [{ name: 'body-slam', pp: 15, maxPp: 15 }]; c.stats.spe = 9999; }
  for (const c of state.player.team) c.moves = [{ name: 'tackle', pp: 35, maxPp: 35 }];
  const out = chooseDoubles(state, [{ kind: 'move', slot: 0 }, { kind: 'move', slot: 0 }], ctx);
  assert.equal(out.state.phase, 'replace');
  assert.ok(replacementsNeeded(out.state) >= 1);
  assert.throws(() => chooseDoubles(out.state, [{ kind: 'move', slot: 0 }, { kind: 'move', slot: 0 }], ctx), /Escolha quem entra/);
  assert.throws(() => chooseReplacements(out.state, [{ pos: 0, to: 0 }]), /inválida|Escolha/);
  const empty = out.state.player.active.map((_, pos) => ({ pos: pos as 0 | 1, mon: monAt(out.state, 'player', pos as 0 | 1) })).filter((s) => s.mon && s.mon.hp <= 0);
  const back = chooseReplacements(out.state, [{ pos: empty[0]!.pos, to: 2 }]);
  assert.equal(back.state.phase, 'choose');
  assert.equal(monAt(back.state, 'player', empty[0]!.pos)?.speciesId, 25);
  assert.ok(back.events.some((e) => e.k === 'send'));
});

test('duplas: todos os seus Pokémon desmaiam → derrota; ações inválidas são recusadas', () => {
  const { state } = fresh([mon(10, 1), mon(10, 1)], [mon(143, 100), mon(143, 100)], 3);
  for (const c of state.foe.team) { c.moves = [{ name: 'body-slam', pp: 15, maxPp: 15 }]; c.stats.spe = 9999; }
  assert.throws(() => chooseDoubles(state, [{ kind: 'move', slot: 0 }], ctx), /cada Pokémon/);
  assert.throws(() => chooseDoubles(state, [{ kind: 'move', slot: 9 }, { kind: 'move', slot: 0 }], ctx), /indisponível/);
  assert.throws(() => chooseDoubles(state, [{ kind: 'switch', to: 0 }, { kind: 'move', slot: 0 }], ctx), /não pode entrar/);
  let out = { state: state as DoublesState, events: [] as unknown[] };
  for (let i = 0; i < 3 && out.state.phase !== 'ended'; i++) out = chooseDoubles(out.state, [{ kind: 'move', slot: 0 }, { kind: 'move', slot: 0 }], ctx);
  assert.equal(out.state.result, 'lose');
});

test('duplas: mesma semente e mesmas ações dão a mesma batalha', () => {
  const build = () => fresh([mon(6, 50), mon(9, 50)], [mon(25, 50), mon(26, 50)]).state;
  const a = build(); const b = JSON.parse(JSON.stringify(a)) as DoublesState;
  const act = [{ kind: 'move', slot: 0 }, { kind: 'move', slot: 0 }] as const;
  assert.deepEqual(chooseDoubles(a, [...act], ctx), chooseDoubles(b, [...act], ctx));
});
