import type { StatusKind } from './battle.ts';
/** Efeito de itens de cura. `heal` = HP recuperado (Infinity = tudo). */
export interface HealEffect {
  heal: number;
  /** só funciona em Pokémon desmaiado (Reviver) */
  revive: boolean;
}

export const HEAL_EFFECTS: Record<string, HealEffect> = {
  potion: { heal: 20, revive: false },
  'super-potion': { heal: 60, revive: false },
  'hyper-potion': { heal: 120, revive: false },
  'max-potion': { heal: Infinity, revive: false },
  'full-restore': { heal: Infinity, revive: false },
  // Reviver: volta com metade do HP; Max Revive com tudo
  revive: { heal: 0.5, revive: true },
  'max-revive': { heal: Infinity, revive: true },
};

export type UseResult =
  | { ok: true; newHp: number; healed: number }
  | { ok: false; reason: string };

/** Aplica um item de cura a um Pokémon (puro: devolve o novo HP ou o motivo da recusa). */
export function applyHealItem(item: string, currentHp: number, maxHp: number): UseResult {
  const effect = HEAL_EFFECTS[item];
  if (!effect) return { ok: false, reason: 'Este item não pode ser usado assim.' };
  const fainted = currentHp <= 0;
  if (effect.revive) {
    if (!fainted) return { ok: false, reason: 'Só funciona em POKÉMON desmaiado.' };
    const newHp = effect.heal === Infinity ? maxHp : Math.max(1, Math.floor(maxHp * effect.heal));
    return { ok: true, newHp, healed: newHp };
  }
  if (fainted) return { ok: false, reason: 'POKÉMON desmaiado precisa de um Reviver.' };
  if (currentHp >= maxHp) return { ok: false, reason: 'O HP já está cheio.' };
  const newHp = Math.min(maxHp, effect.heal === Infinity ? maxHp : currentHp + effect.heal);
  return { ok: true, newHp, healed: newHp - currentHp };
}

/** Itens que removem problemas de status em batalha (o status some ao fim da luta, então só valem nela). */
export const STATUS_CURES: Readonly<Record<string, readonly StatusKind[]>> = {
  antidote: ['poison'],
  'burn-heal': ['burn'],
  'ice-heal': ['freeze'],
  awakening: ['sleep'],
  'paralyze-heal': ['paralysis'],
  'full-heal': ['burn', 'poison', 'paralysis', 'sleep', 'freeze', 'confusion'],
  'full-restore': ['burn', 'poison', 'paralysis', 'sleep', 'freeze', 'confusion'],
};

export type StatusCureResult = { ok: true; status: boolean; confusion: boolean } | { ok: false; reason: string };

/** O que um item de status cura no Pokémon (puro): o status principal e/ou a confusão. */
export function applyStatusCure(item: string, status: StatusKind | null, confused: boolean, fainted = false): StatusCureResult {
  const cures = STATUS_CURES[item];
  if (!cures) return { ok: false, reason: 'Este item não cura status.' };
  if (fainted) return { ok: false, reason: 'POKÉMON desmaiado precisa de um Reviver.' };
  const status1 = status !== null && cures.includes(status);
  const confusion = confused && cures.includes('confusion');
  if (!status1 && !confusion) return { ok: false, reason: 'Não surtiria efeito.' };
  return { ok: true, status: status1, confusion };
}

/** Itens da loja: categorias à venda e limite por item. */
export const SHOP_CATEGORIES = ['captura', 'cura', 'evolucao', 'mega', 'primal', 'ivs', 'buff'] as const;
export const MAX_STACK = 99;
/** Amuletos e afins: só um por jogador. */
export const UNIQUE_ITEMS: ReadonlySet<string> = new Set(['shiny-charm', 'catching-charm', 'amulet-coin', 'lucky-egg']);

/** Bola Premier de brinde: uma a cada 10 Poké Bolas compradas de uma vez. */
export const PREMIER_BALL = 'premier-ball';
export const PREMIER_EVERY = 10;

/** Lucky Egg: 2× de XP, +25% por geração concluída depois da 1ª, até 4×. */
export const luckyEggMultiplier = (extraGenerations: number) => Math.min(4, 2 + 0.25 * extraGenerations);
/** Amulet Coin: 2× de dinheiro, +50% por geração concluída depois da 1ª, até 5×. */
export const amuletCoinMultiplier = (extraGenerations: number) => Math.min(5, 2 + 0.5 * extraGenerations);
