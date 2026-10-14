export type RegionId =
  | 'kanto' | 'johto' | 'hoenn' | 'sinnoh' | 'unova' | 'kalos' | 'alola' | 'galar' | 'paldea';

export interface Region {
  id: RegionId;
  name: string;
  generation: number;
  /** faixa de números da Pokédex nacional introduzida na região */
  dex: [first: number, last: number];
  /** iniciais Planta, Fogo e Água */
  starters: [number, number, number];
}

export const REGIONS: readonly Region[] = [
  { id: 'kanto', name: 'Kanto', generation: 1, dex: [1, 151], starters: [1, 4, 7] },
  { id: 'johto', name: 'Johto', generation: 2, dex: [152, 251], starters: [152, 155, 158] },
  { id: 'hoenn', name: 'Hoenn', generation: 3, dex: [252, 386], starters: [252, 255, 258] },
  { id: 'sinnoh', name: 'Sinnoh', generation: 4, dex: [387, 493], starters: [387, 390, 393] },
  { id: 'unova', name: 'Unova', generation: 5, dex: [494, 649], starters: [495, 498, 501] },
  { id: 'kalos', name: 'Kalos', generation: 6, dex: [650, 721], starters: [650, 653, 656] },
  { id: 'alola', name: 'Alola', generation: 7, dex: [722, 809], starters: [722, 725, 728] },
  { id: 'galar', name: 'Galar', generation: 8, dex: [810, 905], starters: [810, 813, 816] },
  { id: 'paldea', name: 'Paldea', generation: 9, dex: [906, 1025], starters: [906, 909, 912] },
];

export function generationOf(speciesId: number): number {
  const region = REGIONS.find((entry) => speciesId >= entry.dex[0] && speciesId <= entry.dex[1]);
  return region?.generation ?? 0;
}

export function regionById(id: string): Region | undefined {
  return REGIONS.find((entry) => entry.id === id);
}

export const ALL_STARTERS: ReadonlySet<number> = new Set(REGIONS.flatMap((region) => region.starters));

export const STARTER_LEVEL = 5;

/** Itens com que toda jornada começa. */
export const STARTING_ITEMS: readonly { item: string; quantity: number }[] = [
  { item: 'poke-ball', quantity: 10 },
  { item: 'potion', quantity: 5 },
];

export const STARTING_MONEY = 3000;
