import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SHINY_STONE, type BattleEvent, type BattleOutcome } from '@pokesim/engine';
import type { Inventory } from './inventory.ts';
import { grantShinyStoneDrop } from './shiny-stone-drop.ts';

test('Pedra Brilhante tem 1% de chance por shiny nocauteado e se soma aos outros prêmios', () => {
  const added: Array<[string, string, number]> = [];
  const inventory: Inventory = {
    add: (saveId, item, quantity) => { added.push([saveId, item, quantity]); },
    quantity: () => 0,
    take: () => false,
  };
  const rewards: BattleOutcome['rewards'] = [{ item: SHINY_STONE, name: 'Pedra Brilhante', quantity: 1 }];
  const events: BattleEvent[] = [];
  const rolls = [1, 0];
  grantShinyStoneDrop('save', [
    { shiny: false, hp: 0 },
    { shiny: true, hp: 10 },
    { shiny: true, hp: 0 },
    { shiny: true, hp: 0 },
  ], inventory, rewards, events, (max) => {
    assert.equal(max, 100);
    const roll = rolls.shift();
    assert.notEqual(roll, undefined);
    return roll!;
  });
  assert.deepEqual(rolls, []);
  assert.deepEqual(added, [['save', SHINY_STONE, 1]]);
  assert.equal(rewards.length, 1);
  assert.equal(rewards[0]?.quantity, 2);
  assert.match(events[0]?.text ?? '', /Pedra Brilhante/);
});
