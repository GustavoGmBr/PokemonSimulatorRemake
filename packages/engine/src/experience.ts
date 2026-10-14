import type { GrowthRate } from './types.ts';

export const MAX_LEVEL = 100;

/** Experiência total necessária para estar no nível `level` (fórmulas oficiais). */
export function expForLevel(rate: GrowthRate, level: number): number {
  const n = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  if (n === 1) return 0;
  const n3 = n ** 3;
  switch (rate) {
    case 'fast':
      return Math.floor((4 * n3) / 5);
    case 'medium':
      return n3;
    case 'medium-slow':
      return Math.floor((6 * n3) / 5 - 15 * n * n + 100 * n - 140);
    case 'slow':
      return Math.floor((5 * n3) / 4);
    case 'slow-then-very-fast': // "Erratic"
      if (n <= 50) return Math.floor((n3 * (100 - n)) / 50);
      if (n <= 68) return Math.floor((n3 * (150 - n)) / 100);
      if (n <= 98) return Math.floor((n3 * Math.floor((1911 - 10 * n) / 3)) / 500);
      return Math.floor((n3 * (160 - n)) / 100);
    case 'fast-then-very-slow': // "Fluctuating"
      if (n <= 15) return Math.floor((n3 * (Math.floor((n + 1) / 3) + 24)) / 50);
      if (n <= 36) return Math.floor((n3 * (n + 14)) / 50);
      return Math.floor((n3 * (Math.floor(n / 2) + 32)) / 50);
  }
}

export function levelForExp(rate: GrowthRate, exp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && expForLevel(rate, level + 1) <= exp) level++;
  return level;
}

/** Progresso (0–1) dentro do nível atual, para a barra de XP. */
export function levelProgress(rate: GrowthRate, level: number, exp: number): number {
  if (level >= MAX_LEVEL) return 1;
  const start = expForLevel(rate, level);
  const end = expForLevel(rate, level + 1);
  return Math.max(0, Math.min(1, (exp - start) / (end - start)));
}
