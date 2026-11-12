import { randomInt } from 'node:crypto';
import { SHINY_STONE, type BattleEvent, type BattleOutcome } from '@pokesim/engine';
import type { Inventory } from './inventory.ts';

/** Uma rolagem por adversário shiny nocauteado em uma batalha vencida. */
export function grantShinyStoneDrop(
  saveId: string,
  foes: readonly { shiny: boolean; hp: number }[],
  inventory: Inventory,
  rewards: BattleOutcome['rewards'],
  events: BattleEvent[],
  roll: (max: number) => number = randomInt,
): void {
  const quantity = foes.filter((foe) => foe.shiny && foe.hp <= 0 && roll(100) === 0).length;
  if (quantity === 0) return;
  inventory.add(saveId, SHINY_STONE, quantity);
  const existing = rewards.find((reward) => reward.item === SHINY_STONE);
  if (existing) existing.quantity += quantity;
  else rewards.push({ item: SHINY_STONE, name: 'Pedra Brilhante', quantity });
  events.push({ k: 'text', text: `Você ganhou ${quantity}× Pedra Brilhante por derrotar Pokémon shiny!` });
}
