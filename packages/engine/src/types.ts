/** Tipos de domínio compartilhados por todo o jogo. */

export const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type Stats = Record<StatKey, number>;

export const TYPE_NAMES = [
  'normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground',
  'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy',
] as const;
export type TypeName = (typeof TYPE_NAMES)[number];

export type GrowthRate =
  | 'fast' | 'medium' | 'medium-slow' | 'slow' | 'slow-then-very-fast' | 'fast-then-very-slow';

export type MoveCategory = 'physical' | 'special' | 'status';

export interface Move {
  id: number;
  name: string;
  displayName: string;
  type: TypeName;
  category: MoveCategory;
  power: number;
  /** null = nunca erra */
  accuracy: number | null;
  pp: number;
  priority: number;
  target: string;
  ailment: string | null;
  ailmentChance: number;
  flinchChance: number;
  critRate: number;
  drain: number;
  healing: number;
  minHits: number | null;
  maxHits: number | null;
  statChanges: { stat: string; change: number }[];
  statChance: number;
}

export type LearnMethod = 'level-up' | 'machine' | 'tutor' | 'egg';

export interface LearnsetEntry {
  move: string;
  method: LearnMethod;
  level: number;
}

export interface EvolutionCondition {
  trigger: string;
  level: number | null;
  item: string | null;
  happiness: number | null;
  timeOfDay: string | null;
  knownMoveType: string | null;
  heldItem: string | null;
}

export interface EvolutionNode {
  speciesId: number;
  conditions: EvolutionCondition[];
  evolvesTo: EvolutionNode[];
}

export type FormKind = 'mega' | 'primal' | 'gmax' | 'fusion';

export interface SpeciesForm {
  name: string;
  displayName: string;
  kind: FormKind;
  /** id usado pelos arquivos de sprite (ex.: 10034) */
  spriteId: number;
  requiredItem: string | null;
  types: TypeName[];
  baseStats: Stats;
}

export interface Species {
  id: number;
  name: string;
  displayName: string;
  generation: number;
  types: TypeName[];
  baseStats: Stats;
  height: number;
  weight: number;
  baseExp: number;
  captureRate: number;
  baseHappiness: number;
  /** oitavos de chance de ser fêmea (0–8); -1 = sem gênero */
  femaleEighths: number;
  legendary: boolean;
  mythical: boolean;
  growthRate: GrowthRate;
  abilities: { name: string; hidden: boolean }[];
  learnset: LearnsetEntry[];
  /** raiz da cadeia evolutiva à qual a espécie pertence */
  evolutionChain: EvolutionNode;
  forms: SpeciesForm[];
}

export interface TypeInfo {
  name: TypeName;
  doubleTo: TypeName[];
  halfTo: TypeName[];
  noneTo: TypeName[];
}

export type ItemCategory =
  | 'captura' | 'cura' | 'treino' | 'buff' | 'evolucao' | 'mega' | 'primal';

export interface Item {
  id: number;
  name: string;
  displayName: string;
  category: ItemCategory;
  description: string;
  price: number | null;
}

export interface Catalog {
  species: Species[];
  moves: Move[];
  types: TypeInfo[];
  items: Item[];
}

export type Gender = 'M' | 'F' | null;

export interface MoveSlot {
  name: string;
  pp: number;
  maxPp: number;
}

/** Um Pokémon que pertence a um save. */
export interface PokemonInstance {
  speciesId: number;
  nickname: string | null;
  level: number;
  exp: number;
  shiny: boolean;
  gender: Gender;
  ivs: Stats;
  moves: MoveSlot[];
  currentHp: number;
  friendship: number;
  ball: string | null;
  form: string | null;
}
