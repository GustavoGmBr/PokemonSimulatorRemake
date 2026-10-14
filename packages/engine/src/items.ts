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

/** Itens da loja: categorias à venda e limite por item. */
export const SHOP_CATEGORIES = ['captura', 'cura', 'evolucao', 'buff'] as const;
export const MAX_STACK = 99;
/** Amuletos e afins: só um por jogador. */
export const UNIQUE_ITEMS: ReadonlySet<string> = new Set(['shiny-charm', 'catching-charm', 'amulet-coin', 'lucky-egg']);
