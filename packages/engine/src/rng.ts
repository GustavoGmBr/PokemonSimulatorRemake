/**
 * Toda aleatoriedade do engine passa por um Rng. Em testes usamos uma semente fixa,
 * no servidor usamos crypto. Isso deixa batalhas e encontros reproduzíveis.
 */
export interface Rng {
  /** inteiro em [0, maxExclusive) */
  int(maxExclusive: number): number;
}

/** Gerador determinístico (mulberry32) para testes e replays. */
export function seededRng(seed: number): Rng {
  let state = seed >>> 0;
  return {
    int(maxExclusive) {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      return Math.floor(value * maxExclusive);
    },
  };
}

/** Rng a partir de uma função do tipo crypto.randomInt. */
export function rngFrom(randomInt: (maxExclusive: number) => number): Rng {
  return { int: (max) => randomInt(max) };
}

export function chance(rng: Rng, percent: number): boolean {
  return rng.int(100) < percent;
}

export function pick<T>(rng: Rng, list: readonly T[]): T {
  if (list.length === 0) throw new Error('Lista vazia.');
  return list[rng.int(list.length)] as T;
}
