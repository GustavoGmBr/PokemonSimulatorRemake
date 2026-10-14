/**
 * Formatos trocados entre a API (apps/server) e a interface (apps/web).
 * Mudou aqui, o TypeScript aponta os dois lados.
 */
import type { Gender, MoveCategory, Stats, TypeName } from './types.ts';
import type { IvStars } from './ivs.ts';
import type { RegionId } from './regions.ts';

export interface SaveSummary {
  id: string;
  trainerName: string;
  money: number;
  chips: number;
  badges: number;
  pokedexCaught: number;
  playTimeSeconds: number;
  createdAt: string;
  updatedAt: string;
  /** primeiros Pokémon da equipe, para a prévia na tela de saves */
  teamPreview: { speciesId: number; shiny: boolean; level: number }[];
}

export interface CreateSaveRequest {
  trainerName: string;
  starterSpeciesId: number;
}

export interface MoveView {
  name: string;
  displayName: string;
  type: TypeName;
  category: MoveCategory;
  power: number;
  accuracy: number | null;
  pp: number;
  maxPp: number;
}

export interface PokemonView {
  id: string;
  speciesId: number;
  name: string;
  speciesName: string;
  nickname: string | null;
  types: TypeName[];
  level: number;
  exp: number;
  expProgress: number;
  shiny: boolean;
  gender: Gender;
  currentHp: number;
  stats: Stats;
  ivs: Stats;
  ivStars: IvStars;
  ivTotal: number;
  moves: MoveView[];
  teamSlot: number | null;
  favorite: boolean;
  ball: string | null;
  caughtAt: string;
}

export interface InventoryEntry {
  item: string;
  displayName: string;
  category: string;
  quantity: number;
}

export interface SaveDetail extends SaveSummary {
  team: PokemonView[];
  inventory: InventoryEntry[];
}

export interface StarterOption {
  speciesId: number;
  name: string;
  types: TypeName[];
  baseStats: Stats;
}

export interface StarterRegion {
  region: RegionId;
  name: string;
  starters: StarterOption[];
}

export interface ApiError {
  error: string;
}
