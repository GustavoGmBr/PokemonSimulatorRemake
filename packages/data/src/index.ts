import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildTypeChart, listChallenges, type Challenge, type ChallengeCatalog, type Item, type Move, type Species, type TypeChart, type TypeInfo } from '@pokesim/engine';

export const CATALOG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../catalog');

export interface GameData {
  species: Species[];
  moves: Move[];
  types: TypeInfo[];
  items: Item[];
  speciesById: Map<number, Species>;
  movesByName: Map<string, Move>;
  itemsByName: Map<string, Item>;
  typeChart: TypeChart;
  /** ginásios, Elite dos 4 e campeões de todas as regiões */
  challenges: Challenge[];
  challengesById: Map<string, Challenge>;
}

function readJson<T>(name: string): T {
  const file = path.join(CATALOG_DIR, `${name}.json`);
  if (!existsSync(file)) {
    throw new Error(`Catálogo ausente (${file}). Rode "npm run data:import" na raiz do projeto.`);
  }
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

let cached: GameData | undefined;

/** Carrega o catálogo uma vez e mantém em memória. */
export function loadGameData(): GameData {
  if (cached) return cached;
  const species = readJson<Species[]>('species');
  const moves = readJson<Move[]>('moves');
  const types = readJson<TypeInfo[]>('types');
  const items = readJson<Item[]>('items');
  const challenges = listChallenges(readJson<ChallengeCatalog>('challenges'));
  cached = {
    species,
    moves,
    types,
    items,
    speciesById: new Map(species.map((entry) => [entry.id, entry])),
    movesByName: new Map(moves.map((entry) => [entry.name, entry])),
    itemsByName: new Map(items.map((entry) => [entry.name, entry])),
    typeChart: buildTypeChart(types),
    challenges,
    challengesById: new Map(challenges.map((entry) => [entry.id, entry])),
  };
  return cached;
}

export function getSpecies(id: number): Species {
  const species = loadGameData().speciesById.get(id);
  if (!species) throw new Error(`Espécie ${id} não existe.`);
  return species;
}
