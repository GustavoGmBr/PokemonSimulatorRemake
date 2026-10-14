import { STAT_KEYS, type Stats } from './types.ts';

/** Bônus de atributos de um Pokémon shiny (regra própria do jogo). */
export const SHINY_STAT_MULTIPLIER = 1.5;

/**
 * Atributos finais de um Pokémon. Fórmula clássica sem EVs nem naturezas:
 *   HP     = floor((2·base + IV) · nível / 100) + nível + 10
 *   outros = floor((2·base + IV) · nível / 100) + 5
 */
export function calcStats(baseStats: Stats, level: number, ivs: Stats, shiny = false): Stats {
  const stats = {} as Stats;
  for (const key of STAT_KEYS) {
    const core = Math.floor(((2 * baseStats[key] + ivs[key]) * level) / 100);
    const value = key === 'hp' ? core + level + 10 : core + 5;
    stats[key] = shiny ? Math.floor(value * SHINY_STAT_MULTIPLIER) : value;
  }
  return stats;
}

/** Multiplicador de um estágio de atributo (-6 a +6). */
export function stageMultiplier(stage: number): number {
  const s = Math.max(-6, Math.min(6, stage));
  return s >= 0 ? (2 + s) / 2 : 2 / (2 - s);
}
