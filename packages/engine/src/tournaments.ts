import type { Species } from './types.ts';
import type { FoeBagItem } from './battle.ts';
import { evolutionStage, isLegendary } from './wild.ts';
import { IV_ESSENCES } from './transform.ts';
import { pick, type Rng } from './rng.ts';

/** Torneios por categoria: 8 rodadas eliminatórias, com nível máximo para o seu time e inscrição em Pokédólares. */
export const TOURNAMENT_ROUNDS = 8;

export type TournamentTierId = 'muito-facil' | 'facil' | 'intermediario' | 'dificil' | 'muito-dificil' | 'copa-prime';

export interface TournamentPrize {
  money: number;
  /** `random-essence` vira uma Essência de IV sorteada */
  items: { item: string; quantity: number }[];
}

export interface TournamentTier {
  id: TournamentTierId;
  name: string;
  description: string;
  entry: number;
  /** nível máximo dos Pokémon dos dois lados na final */
  cap: number;
  /** soma máxima dos atributos-base dos adversários (null = sem limite) */
  maxBst: number | null;
  legendary: boolean;
  /** só espécies sem evolução anterior */
  basicOnly: boolean;
  prize: TournamentPrize;
}

export const TOURNAMENT_TIERS: readonly TournamentTier[] = [
  { id: 'muito-facil', name: 'Muito Fácil', description: 'Pokémon básicos até o nível 30.', entry: 1_000, cap: 30, maxBst: 400, legendary: false, basicOnly: true,
    prize: { money: 8_000, items: [{ item: 'exp-candy-p', quantity: 2 }] } },
  { id: 'facil', name: 'Fácil', description: 'Até o nível 45, sem lendários.', entry: 3_000, cap: 45, maxBst: 480, legendary: false, basicOnly: false,
    prize: { money: 25_000, items: [{ item: 'exp-candy-p', quantity: 5 }] } },
  { id: 'intermediario', name: 'Intermediário', description: 'Até o nível 60, sem lendários.', entry: 8_000, cap: 60, maxBst: 540, legendary: false, basicOnly: false,
    prize: { money: 70_000, items: [{ item: 'exp-candy-m', quantity: 3 }] } },
  { id: 'dificil', name: 'Difícil', description: 'Até o nível 75; Pokémon fortes, sem lendários.', entry: 20_000, cap: 75, maxBst: 600, legendary: false, basicOnly: false,
    prize: { money: 180_000, items: [{ item: 'exp-candy-g', quantity: 2 }, { item: 'random-essence', quantity: 1 }] } },
  { id: 'muito-dificil', name: 'Muito Difícil', description: 'Até o nível 90; lendários liberados.', entry: 50_000, cap: 90, maxBst: 680, legendary: true, basicOnly: false,
    prize: { money: 450_000, items: [{ item: 'exp-candy-gg', quantity: 1 }, { item: 'random-essence', quantity: 2 }] } },
  { id: 'copa-prime', name: 'Copa Prime', description: 'Nível 100 e sem limites: a elite da elite.', entry: 100_000, cap: 100, maxBst: null, legendary: true, basicOnly: false,
    prize: { money: 1_000_000, items: [{ item: 'exp-candy-gg', quantity: 3 }, { item: 'random-essence', quantity: 3 }] } },
];

export const tournamentTier = (id: unknown): TournamentTier | undefined => TOURNAMENT_TIERS.find((tier) => tier.id === id);

/** Adversários por rodada: 1, 2, 2, 3, 3, 4, 5 e 6 Pokémon. */
export const ROUND_TEAM_SIZES: readonly number[] = [1, 2, 2, 3, 3, 4, 5, 6];
export const MAX_TOURNAMENT_PICKS = 6;

const OPPONENT_NAMES = ['Estreante', 'Lutador de Arena', 'Treinador Rival', 'Veterano', 'Estrategista', 'Semifinalista', 'Finalista', 'Campeão do Torneio'];
const bag = (item: string, name: string, heal: number, qty: number, cures = false): FoeBagItem => ({ item, name, heal, cures, qty });

export interface RolledOpponent {
  name: string;
  skill: 1 | 2 | 3;
  bag: FoeBagItem[];
  team: { speciesId: number; level: number }[];
}

export const roundLevel = (tier: TournamentTier, round: number): number => Math.max(5, tier.cap - (TOURNAMENT_ROUNDS - round) * 2);

const bst = (species: Species) => Object.values(species.baseStats).reduce((sum, value) => sum + value, 0);

/** Sorteia o adversário da rodada (1–8): mais Pokémon, nível e inteligência a cada vitória. */
export function rollOpponent(tier: TournamentTier, round: number, species: readonly Species[], rng: Rng): RolledOpponent {
  const pool = species.filter((entry) =>
    (tier.legendary || !isLegendary(entry)) && (tier.maxBst === null || bst(entry) <= tier.maxBst) && (!tier.basicOnly || evolutionStage(entry) === 0)).map((entry) => entry.id);
  const level = roundLevel(tier, round);
  const count = ROUND_TEAM_SIZES[round - 1] ?? 6;
  const team: RolledOpponent['team'] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const [id] = pool.splice(rng.int(pool.length), 1);
    team.push({ speciesId: id as number, level });
  }
  const base = round <= 3 ? 1 : round <= 6 ? 2 : 3;
  const skill = (tier.id === 'copa-prime' || tier.id === 'muito-dificil') ? Math.max(base, 2) : base;
  const items: FoeBagItem[] = [];
  if (round >= 5) items.push(bag('super-potion', 'Super Potion', 60, 1));
  if (round === TOURNAMENT_ROUNDS) items.push(tier.cap >= 75 ? bag('full-restore', 'Full Restore', 9999, 1, true) : bag('hyper-potion', 'Hyper Potion', 120, 1));
  return { name: OPPONENT_NAMES[round - 1] ?? 'Adversário', skill: skill as 1 | 2 | 3, bag: items, team };
}

/** Resolve `random-essence` para uma Essência de IV sorteada. */
export function resolvePrizeItem(item: string, rng: Rng): string {
  return item === 'random-essence' ? pick(rng, Object.keys(IV_ESSENCES)) : item;
}
