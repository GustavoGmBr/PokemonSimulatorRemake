/**
 * Regras da coleção: tamanho da equipe e das caixas do PC, filtros e ordenação.
 * Tudo puro, sem banco, para a API e os testes compartilharem a mesma lógica.
 */
import type { TypeName } from './types.ts';

export const TEAM_SIZE = 6;
export const BOX_SIZE = 30;
/** Teto técnico só para a API recusar números absurdos; na prática as caixas são ilimitadas. */
export const MAX_BOX_INDEX = 99_999;
export const MAX_NICKNAME = 12;

export type PokemonLocation =
  | { kind: 'team'; slot: number }
  | { kind: 'box'; box: number; slot: number };

export function isValidLocation(location: PokemonLocation): boolean {
  if (location.kind === 'team') return Number.isInteger(location.slot) && location.slot >= 0 && location.slot < TEAM_SIZE;
  return (
    Number.isInteger(location.box) && location.box >= 0 && location.box <= MAX_BOX_INDEX &&
    Number.isInteger(location.slot) && location.slot >= 0 && location.slot < BOX_SIZE
  );
}

/** Dados mínimos de um Pokémon para filtrar e ordenar a coleção. */
export interface CollectionEntry {
  id: string;
  speciesId: number;
  name: string;
  speciesName: string;
  types: readonly TypeName[];
  generation: number;
  shiny: boolean;
  ivStars: number;
  ivTotal: number;
  level: number;
  favorite: boolean;
  caughtAt: string;
}

export const SORT_KEYS = ['recent', 'level', 'iv', 'dex', 'name'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export interface CollectionFilter {
  text?: string;
  type?: TypeName;
  generation?: number;
  shiny?: boolean;
  minStars?: number;
  minLevel?: number;
  maxLevel?: number;
  favorite?: boolean;
}

export interface CollectionQuery extends CollectionFilter {
  sort: SortKey;
  dir: 'asc' | 'desc';
}

export function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export function matchesFilter(entry: CollectionEntry, filter: CollectionFilter): boolean {
  if (filter.text) {
    const text = normalizeText(filter.text.replace(/^#/, ''));
    const haystack = `${normalizeText(entry.name)} ${normalizeText(entry.speciesName)} ${entry.speciesId}`;
    if (text && !haystack.includes(text)) return false;
  }
  if (filter.type && !entry.types.includes(filter.type)) return false;
  if (filter.generation && entry.generation !== filter.generation) return false;
  if (filter.shiny !== undefined && entry.shiny !== filter.shiny) return false;
  if (filter.minStars !== undefined && entry.ivStars < filter.minStars) return false;
  if (filter.minLevel !== undefined && entry.level < filter.minLevel) return false;
  if (filter.maxLevel !== undefined && entry.level > filter.maxLevel) return false;
  if (filter.favorite !== undefined && entry.favorite !== filter.favorite) return false;
  return true;
}

/** Ordena sem alterar a lista original. Empates sempre se resolvem por número e depois por id, para a ordem ser estável. */
export function sortEntries(entries: readonly CollectionEntry[], sort: SortKey, dir: 'asc' | 'desc'): CollectionEntry[] {
  const sign = dir === 'asc' ? 1 : -1;
  const primary = (a: CollectionEntry, b: CollectionEntry): number => {
    switch (sort) {
      case 'recent': return a.caughtAt.localeCompare(b.caughtAt);
      case 'level': return a.level - b.level;
      case 'iv': return a.ivTotal - b.ivTotal;
      case 'dex': return a.speciesId - b.speciesId;
      case 'name': return normalizeText(a.name).localeCompare(normalizeText(b.name));
    }
  };
  return [...entries].sort((a, b) => sign * primary(a, b) || a.speciesId - b.speciesId || a.id.localeCompare(b.id));
}

export function searchCollection(entries: readonly CollectionEntry[], query: CollectionQuery): CollectionEntry[] {
  return sortEntries(entries.filter((entry) => matchesFilter(entry, query)), query.sort, query.dir);
}

export function boxCount(highestUsedBox: number): number {
  return Math.max(1, highestUsedBox + 1);
}
