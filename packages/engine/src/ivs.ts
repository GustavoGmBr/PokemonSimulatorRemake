import { STAT_KEYS, type Stats } from './types.ts';
import type { Rng } from './rng.ts';

export const MAX_IV = 31;
export const MAX_TOTAL_IV = MAX_IV * STAT_KEYS.length; // 186

export const STAT_LABELS: Record<keyof Stats, string> = {
  hp: 'HP', atk: 'Ataque', def: 'Defesa', spa: 'At. Especial', spd: 'Def. Especial', spe: 'Velocidade',
};

export function perfectIvs(): Stats {
  return { hp: MAX_IV, atk: MAX_IV, def: MAX_IV, spa: MAX_IV, spd: MAX_IV, spe: MAX_IV };
}

export function rollIvs(rng: Rng): Stats {
  const ivs = {} as Stats;
  for (const key of STAT_KEYS) ivs[key] = rng.int(MAX_IV + 1);
  return ivs;
}

export function clampIvs(ivs: Partial<Stats>): Stats {
  const result = {} as Stats;
  for (const key of STAT_KEYS) {
    const value = ivs[key];
    result[key] = Number.isInteger(value) ? Math.max(0, Math.min(MAX_IV, value as number)) : 15;
  }
  return result;
}

export type IvStars = 0 | 1 | 2 | 3 | 4;

export interface IvQuality {
  total: number;
  percentage: number;
  stars: IvStars;
  label: string;
  /** multiplicador de valor de venda */
  valueMultiplier: number;
}

const LABELS = ['Decente', 'Acima da média', 'Muito bom', 'Fantástico', 'Potencial perfeito'] as const;

export function ivQuality(ivs: Stats): IvQuality {
  const total = STAT_KEYS.reduce((sum, key) => sum + ivs[key], 0);
  const stars: IvStars = total === MAX_TOTAL_IV ? 4 : total >= 151 ? 3 : total >= 121 ? 2 : total >= 91 ? 1 : 0;
  return {
    total,
    percentage: (total / MAX_TOTAL_IV) * 100,
    stars,
    label: LABELS[stars],
    valueMultiplier: stars === 4 ? 2 : stars === 3 ? 1.5 : 1,
  };
}
