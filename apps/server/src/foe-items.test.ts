import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_FOE_ITEMS, chooseAction, combatantFrom, createBattle, createPokemon, foeItemsLeft, rngFrom,
  type BattleContext, type Combatant, type TrainerInfo,
} from '@pokesim/engine';
import { loadGameData } from '@pokesim/data';

const data = loadGameData();
const ctx: BattleContext = { species: (id) => data.speciesById.get(id)!, moves: data.movesByName, chart: data.typeChart };
let seed = 3;
const rng = rngFrom((max) => (seed = (seed * 48271) % 2147483647) % max);
const mon = (speciesId: number, level: number): Combatant => {
  const species = data.speciesById.get(speciesId)!;
  return combatantFrom(createPokemon({ species, level, rng, moves: data.movesByName }), species, species.displayName, `ref-${speciesId}`);
};

test('limite de itens do treinador: nunca passa de 5 por batalha, mesmo com bolsa cheia', () => {
  assert.equal(MAX_FOE_ITEMS, 5);
  assert.equal(foeItemsLeft({ bag: [{ item: 'x', name: 'X', heal: 50, cures: false, qty: 20 }] }), 5);
  assert.equal(foeItemsLeft({ bag: [{ item: 'x', name: 'X', heal: 50, cures: false, qty: 2 }] }), 2);
  assert.equal(foeItemsLeft({ bag: [{ item: 'x', name: 'X', heal: 50, cures: false, qty: 20 }], itemsUsed: 4 }), 1);

  const trainer: TrainerInfo = {
    name: 'Rival', title: '', skill: 3, lastSwitch: -9,
    bag: [{ item: 'hyper-potion', name: 'Hyper Potion', heal: 9999, cures: true, qty: 20 }],
  };
  let { state } = createBattle({ player: [mon(143, 100)], foe: [mon(10, 50)], seed: 11, kind: 'trainer', trainer });
  state.player.team[0]!.moves = [{ name: 'growl', pp: 40, maxPp: 40 }];
  state.foe.team[0]!.moves = [{ name: 'tackle', pp: 35, maxPp: 35 }];
  let used = 0;
  for (let turn = 0; turn < 20 && state.phase === 'choose'; turn++) {
    state.foe.team[state.foe.active]!.hp = 1; // sempre pedindo cura
    const out = chooseAction(state, { kind: 'move', slot: 0 }, ctx);
    used += out.events.filter((e) => e.k === 'text' && /usou Hyper Potion/.test((e as { text?: string }).text ?? '')).length;
    state = out.state;
  }
  assert.equal(used, 5, 'usou exatamente 5');
  assert.equal(state.trainer?.itemsUsed, 5);
  assert.equal(foeItemsLeft(state.trainer!), 0);
});
