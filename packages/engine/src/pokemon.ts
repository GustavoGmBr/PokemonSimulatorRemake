import type { Gender, Move, MoveSlot, PokemonInstance, Species, Stats } from './types.ts';
import type { Rng } from './rng.ts';
import { calcStats } from './stats.ts';
import { expForLevel } from './experience.ts';
import { rollIvs } from './ivs.ts';

/** Golpes que nocauteiam o próprio usuário; ficam fora dos movesets automáticos. */
const SELF_KO_MOVES = new Set([
  'self-destruct', 'explosion', 'misty-explosion', 'memento', 'healing-wish', 'lunar-dance', 'final-gambit',
]);

export function isUsableMove(move: Move): boolean {
  if (SELF_KO_MOVES.has(move.name)) return false;
  return move.category === 'status' || move.power > 0;
}

/**
 * Os quatro golpes mais recentes que a espécie aprende por nível até `level`.
 * Em empate de nível, golpes de dano e do mesmo tipo da espécie vêm primeiro.
 */
export function levelUpMoves(species: Species, level: number, moves: Map<string, Move>): Move[] {
  const learned = new Map<string, number>();
  for (const entry of species.learnset) {
    if (entry.method !== 'level-up' || entry.level > level) continue;
    const move = moves.get(entry.move);
    if (!move || !isUsableMove(move)) continue;
    learned.set(entry.move, Math.max(learned.get(entry.move) ?? 0, entry.level));
  }
  const score = (move: Move) =>
    (move.category !== 'status' ? 2 : 0) + (species.types.includes(move.type) ? 1 : 0);
  const selected = [...learned.entries()]
    .map(([name, learnedAt]) => ({ move: moves.get(name) as Move, learnedAt }))
    .sort((a, b) => b.learnedAt - a.learnedAt || score(b.move) - score(a.move) || a.move.name.localeCompare(b.move.name))
    .slice(0, 4)
    .map((entry) => entry.move);
  if (selected.length > 0) return selected;
  const struggle = moves.get('struggle') ?? moves.get('tackle');
  return struggle ? [struggle] : [];
}

export function toMoveSlot(move: Move): MoveSlot {
  return { name: move.name, pp: move.pp, maxPp: move.pp };
}

export function rollGender(species: Species, rng: Rng): Gender {
  if (species.femaleEighths < 0) return null;
  return rng.int(8) < species.femaleEighths ? 'F' : 'M';
}

export interface CreatePokemonOptions {
  species: Species;
  level: number;
  rng: Rng;
  moves: Map<string, Move>;
  shiny?: boolean;
  ivs?: Stats;
  ball?: string | null;
}

/** Cria um Pokémon novo, com HP cheio e golpes de nível. */
export function createPokemon(options: CreatePokemonOptions): PokemonInstance {
  const { species, level, rng, moves } = options;
  const ivs = options.ivs ?? rollIvs(rng);
  const shiny = options.shiny ?? false;
  const stats = calcStats(species.baseStats, level, ivs, shiny);
  return {
    speciesId: species.id,
    nickname: null,
    level,
    exp: expForLevel(species.growthRate, level),
    shiny,
    gender: rollGender(species, rng),
    ivs,
    moves: levelUpMoves(species, level, moves).map(toMoveSlot),
    currentHp: stats.hp,
    friendship: species.baseHappiness,
    ball: options.ball ?? null,
    form: null,
  };
}

export function statsOf(pokemon: PokemonInstance, species: Species): Stats {
  const form = pokemon.form ? species.forms.find((entry) => entry.name === pokemon.form) : undefined;
  return calcStats(form?.baseStats ?? species.baseStats, pokemon.level, pokemon.ivs, pokemon.shiny);
}
