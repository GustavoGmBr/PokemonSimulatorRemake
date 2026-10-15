import type { FormKind, Species, SpeciesForm, Stats, TypeName } from './types.ts';
import { MAX_IV } from './ivs.ts';

/** Mega e Primal exigem este nível; G-Max e fusões não. */
export const FORM_MIN_LEVEL = 60;
/** A forma G-Max amplia o HP máximo em 50%. */
export const GMAX_HP_MULTIPLIER = 1.5;

export const NECROZMA = 800;
export const SOLGALEO = 791;
export const LUNALA = 792;

/** Doces de EXP: XP fixo. O Doce Raro sobe exatamente um nível. */
export const EXP_CANDIES: Readonly<Record<string, number>> = {
  'exp-candy-p': 800,
  'exp-candy-m': 3000,
  'exp-candy-g': 10000,
  'exp-candy-gg': 30000,
};
export const RARE_CANDY = 'rare-candy';

/** Essências de IV: +1 no atributo correspondente (máx. 31). */
export const IV_ESSENCES: Readonly<Record<string, keyof Stats>> = {
  'iv-hp': 'hp',
  'iv-attack': 'atk',
  'iv-defense': 'def',
  'iv-special-attack': 'spa',
  'iv-special-defense': 'spd',
  'iv-speed': 'spe',
};

export const isTrainingItem = (item: string): boolean => item === RARE_CANDY || item in EXP_CANDIES || item in IV_ESSENCES;

export interface TransformChoice {
  name: string;
  displayName: string;
  kind: FormKind;
  spriteId: number;
  /** item consumido (null nas fusões sem item) */
  item: string | null;
  requirement: string;
  ready: boolean;
  reason: string | null;
}

export interface TransformContext {
  level: number;
  /** forma atual (null = normal); só é possível transformar a partir da forma normal, salvo Necrozma */
  form: string | null;
  has(item: string): boolean;
  /** a coleção (equipe + PC) tem essa espécie? */
  owns(speciesId: number): boolean;
  itemName(id: string): string;
}

const KIND_TEXT: Record<FormKind, string> = { mega: 'Mega Evolução', primal: 'Regressão Primal', gmax: 'Gigantamax', fusion: 'Fusão' };

/** Formas permanentes ao alcance deste Pokémon (Mega, Primal, G-Max e fusões do Necrozma). */
export function availableForms(species: Species, ctx: TransformContext): TransformChoice[] {
  const isNecrozma = species.id === NECROZMA;
  const current = ctx.form ? species.forms.find((form) => form.name === ctx.form) : undefined;
  if (ctx.form && !(isNecrozma && current?.kind === 'fusion' && current.name !== 'necrozma-ultra')) return [];
  const choices: TransformChoice[] = [];
  for (const form of species.forms) {
    if (current && form.name === current.name) continue;
    const need: string[] = [];
    let item: string | null = form.requiredItem;
    let requirement = KIND_TEXT[form.kind];
    if (form.kind === 'mega' || form.kind === 'primal') {
      if (ctx.level < FORM_MIN_LEVEL) need.push(`nível ${FORM_MIN_LEVEL}`);
      requirement += ` (Nv ${FORM_MIN_LEVEL}+, ${item ? ctx.itemName(item) : '—'})`;
    } else if (form.kind === 'gmax') {
      item = form.requiredItem ?? 'gmax-stone';
      requirement += ` (${ctx.itemName(item)}, +50% de HP)`;
    } else {
      const partners = form.name === 'necrozma-dusk' ? [SOLGALEO] : form.name === 'necrozma-dawn' ? [LUNALA] : [SOLGALEO, LUNALA];
      for (const partner of partners) if (!ctx.owns(partner)) need.push(partner === SOLGALEO ? 'Solgaleo na coleção' : 'Lunala na coleção');
      requirement += form.name === 'necrozma-ultra' ? ` (Solgaleo + Lunala e ${ctx.itemName(item ?? 'ultra-burst-stone')})` : ` (com ${form.name === 'necrozma-dusk' ? 'Solgaleo' : 'Lunala'})`;
    }
    if (item && !ctx.has(item)) need.push(ctx.itemName(item));
    choices.push({
      name: form.name, displayName: form.displayName, kind: form.kind, spriteId: form.spriteId, item, requirement,
      ready: need.length === 0, reason: need.length === 0 ? null : `Falta: ${need.join(', ')}.`,
    });
  }
  return choices;
}

export function formOf(species: Species, formName: string | null): SpeciesForm | undefined {
  return formName ? species.forms.find((form) => form.name === formName) : undefined;
}

/** Tipos efetivos: os da forma (Mega, Primal…), senão os da espécie. */
export function typesOf(species: Species, formName: string | null): TypeName[] {
  return [...(formOf(species, formName)?.types ?? species.types)];
}

/** Aplica +1 num IV. Devolve null se já está no máximo (o item não deve ser gasto). */
export function raiseIv(ivs: Stats, stat: keyof Stats): Stats | null {
  if (ivs[stat] >= MAX_IV) return null;
  return { ...ivs, [stat]: ivs[stat] + 1 };
}

export const IV_STAT_LABEL: Record<keyof Stats, string> = { hp: 'HP', atk: 'Ataque', def: 'Defesa', spa: 'At. especial', spd: 'Def. especial', spe: 'Velocidade' };
