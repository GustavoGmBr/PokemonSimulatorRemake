import { pick, type Rng } from './rng.ts';
import { STAT_KEYS, type PokemonInstance, type Species, type StatKey, type Stats } from './types.ts';
import { isLegendary } from './wild.ts';

export const BOSS_DURATION = 10 * 60_000;
export const BOSS_WIPE_PENALTY = 60_000;

export const BOSS_TIERS = [
  { stars: 1, level: 40, hpMultiplier: 5, statBonusPercent: 15, minIv: 0, maxIv: 100, shinyDenominator: 4096, prizes: 'muito-facil' },
  { stars: 2, level: 50, hpMultiplier: 8, statBonusPercent: 25, minIv: 40, maxIv: 60, shinyDenominator: 3686, prizes: 'facil' },
  { stars: 3, level: 65, hpMultiplier: 12, statBonusPercent: 40, minIv: 50, maxIv: 70, shinyDenominator: 3072, prizes: 'intermediario' },
  { stars: 4, level: 75, hpMultiplier: 15, statBonusPercent: 55, minIv: 60, maxIv: 80, shinyDenominator: 2260, prizes: 'dificil' },
  { stars: 5, level: 90, hpMultiplier: 20, statBonusPercent: 75, minIv: 75, maxIv: 90, shinyDenominator: 1365, prizes: 'muito-dificil' },
  { stars: 6, level: 100, hpMultiplier: 30, statBonusPercent: 100, minIv: 90, maxIv: 100, shinyDenominator: 512, prizes: 'copa-prime' },
] as const;

export type BossTier = typeof BOSS_TIERS[number];

export interface BossFight {
  period: number;
  /** Ausente nas batalhas salvas antes do sorteio por vaga. */
  slot?: number;
  stars: number;
  deadline: number;
  wipes: number;
  pokemon: PokemonInstance;
}

const ULTRA_BEASTS = new Set([793, 794, 795, 796, 797, 798, 799, 803, 804, 805, 806]);

export function bossPool(species: readonly Species[], stars: number): Species[] {
  return species.filter((entry) => {
    if (isLegendary(entry) || ULTRA_BEASTS.has(entry.id)) return stars === 6;
    const total = STAT_KEYS.reduce((sum, stat) => sum + entry.baseStats[stat], 0);
    if (stars === 1) return total <= 350;
    if (stars === 2) return total > 350 && total <= 440;
    return total > 440;
  });
}

/** Limites em porcentagem da soma dos seis IVs, cujo máximo é 186. */
export function rollBossIvs(tier: BossTier, rng: Rng): Stats | undefined {
  if (tier.stars === 1) return undefined;
  const min = Math.ceil(186 * tier.minIv / 100);
  const max = Math.floor(186 * tier.maxIv / 100);
  let remaining = min + rng.int(max - min + 1);
  const keys: StatKey[] = [...STAT_KEYS];
  const ivs: Stats = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  while (keys.length) {
    const key = pick(rng, keys);
    keys.splice(keys.indexOf(key), 1);
    const lower = Math.max(0, remaining - keys.length * 31);
    const upper = Math.min(31, remaining);
    ivs[key] = lower + rng.int(upper - lower + 1);
    remaining -= ivs[key];
  }
  return ivs;
}

export function bossMoney(tier: BossTier, remainingMs: number, wipes: number): number {
  const time = Math.max(0, Math.min(1, remainingMs / BOSS_DURATION));
  return Math.floor(tier.level * tier.stars * 10 * (1 + time) / (1 + wipes / 2));
}
