/**
 * Formatos trocados entre a API (apps/server) e a interface (apps/web).
 * Mudou aqui, o TypeScript aponta os dois lados.
 */
import type { Gender, MoveCategory, Stats, TypeName } from './types.ts';
import type { IvStars } from './ivs.ts';
import type { RegionId } from './regions.ts';
import type { PokemonLocation, SortKey } from './collection.ts';

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
  generation: number;
  location: PokemonLocation;
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

/** Uma caixa do PC: 30 posições, vazias como null. */
export interface BoxView {
  box: number;
  slots: (PokemonView | null)[];
  /** quantos Pokémon existem no PC inteiro */
  totalInBoxes: number;
  /** maior índice de caixa com algum Pokémon (-1 se o PC está vazio) */
  highestUsedBox: number;
}

export interface MovePokemonRequest {
  to: PokemonLocation;
}

export interface UpdatePokemonRequest {
  /** string vazia remove o apelido */
  nickname?: string;
  favorite?: boolean;
}

export interface SearchPokemonQuery {
  text?: string;
  type?: string;
  generation?: number;
  shiny?: boolean;
  minStars?: number;
  minLevel?: number;
  maxLevel?: number;
  favorite?: boolean;
  sort?: SortKey;
  dir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface PokemonSearchResult {
  total: number;
  items: PokemonView[];
}

export interface PlayTimeRequest {
  seconds: number;
}

/** Resumo estático de uma espécie, para listas e para nomear a Pokédex sem baixar a ficha inteira. */
export interface SpeciesIndexEntry {
  id: number;
  name: string;
  types: TypeName[];
  generation: number;
  baseStatTotal: number;
}

/** 0 = não visto, 1 = visto, 2 = capturado; índice = número da Pokédex - 1. */
export type DexState = 0 | 1 | 2;

export interface PokedexView {
  total: number;
  seen: number;
  caught: number;
  states: DexState[];
  /** quantos exemplares do save existem por espécie (equipe + PC) */
  owned: Record<number, number>;
}

export interface HealthInfo {
  ok: boolean;
  species: number;
  /** ferramentas de teste habilitadas (apenas durante a alpha) */
  devTools: boolean;
}

export interface DevGrantResult {
  added: number;
  inTeam: number;
  inBoxes: number;
}

// ---------------------------------------------------------------- selvagens e captura

/** Um selvagem no mapa. Só mostra o que o jogador pode ver: nome, nível, estrelas e brilho. */
export interface WildSlotView {
  slot: number;
  speciesId: number;
  name: string;
  level: number;
  shiny: boolean;
  ivStars: number;
  types: TypeName[];
  gender: Gender;
  /** a espécie já foi capturada neste save */
  caughtBefore: boolean;
}

export interface WildBoardView {
  slots: WildSlotView[];
  spinsLeft: number;
  /** nomes das regiões liberadas, de onde vêm os selvagens */
  regions: string[];
  levelRange: [number, number];
}

export interface BallOption {
  item: string;
  displayName: string;
  description: string;
  quantity: number;
  /** chance de captura (0–1) contra o selvagem escolhido; null sem encontro */
  chance: number | null;
}

/** Resposta de GET /wild. `board` é null sem procura em andamento; `chosen` é o selvagem enfrentado. */
export interface WildState {
  board: WildBoardView | null;
  chosen: number | null;
  balls: BallOption[];
  shinyCharm: boolean;
  catchingCharm: boolean;
}

export type AutoSearchTarget = 'shiny' | 'stars' | 'either';

export interface AutoSearchRequest {
  target?: AutoSearchTarget;
  /** estrelas mínimas quando o alvo inclui estrelas (padrão 3) */
  minStars?: number;
}

export interface AutoSearchResult {
  found: boolean;
  /** quantos mapas foram gerados até parar */
  searches: number;
  state: WildState;
}

export interface ChooseWildRequest {
  slot: number;
}

export interface ThrowBallRequest {
  ball: string;
}

export interface ThrowBallResult {
  shakes: 0 | 1 | 2 | 3;
  caught: boolean;
  chance: number;
  /** o Pokémon capturado, já com o lugar onde foi parar */
  pokemon: PokemonView | null;
  state: WildState;
}

// ---------------------------------------------------------------- itens, loja e Centro Pokémon

export interface ShopEntry {
  item: string;
  displayName: string;
  category: string;
  description: string;
  price: number;
  /** quantos o jogador já tem */
  owned: number;
}

export interface BuyRequest {
  cart: { item: string; quantity: number }[];
}

export interface BuyResult {
  spent: number;
  money: number;
}

export interface UseItemRequest {
  item: string;
  pokemonId: string;
}

export interface UseItemResult {
  pokemon: PokemonView;
  healed: number;
  remaining: number;
}

export interface CenterResult {
  healed: number;
}

export interface DevKitResult {
  regions: number;
  balls: number;
}
