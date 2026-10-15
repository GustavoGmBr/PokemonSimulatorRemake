import type { Species } from './types.ts';
import type { FoeBagItem } from './battle.ts';
import { evolutionStage, isLegendary } from './wild.ts';
import { IV_ESSENCES } from './transform.ts';
import { pick, type Rng } from './rng.ts';
import { REWARD_BALLS } from './challenges.ts';

/** Torneios por categoria: 8 rodadas eliminatórias, com nível máximo para o seu time e inscrição em Pokédólares. */
export const TOURNAMENT_ROUNDS = 8;

type SinglesTierId = 'muito-facil' | 'facil' | 'intermediario' | 'dificil' | 'muito-dificil' | 'copa-prime';
export type TournamentTierId = SinglesTierId | `dupla-${SinglesTierId}`;

export interface TournamentPrize {
  money: number;
  /** quantidade sorteada entre min e máx; `random-ball` vira uma Poké Bola especial sorteada */
  items: { item: string; min: number; max: number }[];
  /** Essências de IV sorteadas (cada uma de um tipo aleatório) */
  essences: number;
}

export interface TournamentTier {
  id: TournamentTierId;
  name: string;
  description: string;
  entry: number;
  /** nível máximo dos seus Pokémon (e dos adversários) */
  cap: number;
  minLevel: number;
  minTeam: number;
  maxTeam: number;
  prize: TournamentPrize;
  /** copa em duplas (2×2) */
  doubles?: boolean;
  /** categoria de singles que serve de base (filtros de Pokémon e IA) */
  base?: SinglesTierId;
}

/** Valores do jogo antigo (inscrição, prêmio, níveis e tamanho dos times). */
export const TOURNAMENT_TIERS: readonly TournamentTier[] = [
  { id: 'muito-facil', name: 'Muito Fácil', description: 'Pokémon básicos, nível 2–10.', entry: 150, cap: 10, minLevel: 2, minTeam: 3, maxTeam: 3,
    prize: { money: 120, essences: 1, items: [{ item: 'random-ball', min: 2, max: 4 }, { item: 'great-ball', min: 0, max: 2 }, { item: 'exp-candy-p', min: 1, max: 3 }, { item: 'exp-candy-m', min: 0, max: 1 }] } },
  { id: 'facil', name: 'Fácil', description: 'Nível 10–30, sem lendários.', entry: 500, cap: 30, minLevel: 10, minTeam: 3, maxTeam: 4,
    prize: { money: 400, essences: 1, items: [{ item: 'great-ball', min: 2, max: 4 }, { item: 'ultra-ball', min: 0, max: 2 }, { item: 'exp-candy-m', min: 2, max: 3 }, { item: 'exp-candy-g', min: 0, max: 1 }] } },
  { id: 'intermediario', name: 'Intermediário', description: 'Nível 30–50, sem lendários.', entry: 1_500, cap: 50, minLevel: 30, minTeam: 4, maxTeam: 5,
    prize: { money: 1_200, essences: 2, items: [{ item: 'great-ball', min: 2, max: 4 }, { item: 'ultra-ball', min: 1, max: 3 }, { item: 'exp-candy-g', min: 2, max: 3 }, { item: 'exp-candy-gg', min: 0, max: 1 }] } },
  { id: 'dificil', name: 'Difícil', description: 'Nível 50–70; evoluídos e fortes, sem lendários.', entry: 4_000, cap: 70, minLevel: 50, minTeam: 5, maxTeam: 6,
    prize: { money: 3_200, essences: 2, items: [{ item: 'ultra-ball', min: 3, max: 4 }, { item: 'exp-candy-gg', min: 2, max: 4 }, { item: 'rare-candy', min: 1, max: 2 }] } },
  { id: 'muito-dificil', name: 'Muito Difícil', description: 'Nível 70–99; lendários liberados.', entry: 10_000, cap: 99, minLevel: 70, minTeam: 6, maxTeam: 6,
    prize: { money: 8_000, essences: 3, items: [{ item: 'ultra-ball', min: 4, max: 4 }, { item: 'exp-candy-gg', min: 3, max: 4 }, { item: 'rare-candy', min: 2, max: 3 }] } },
  { id: 'copa-prime', name: 'Copa Prime', description: 'Nível 100 e sem limites: a elite da elite.', entry: 25_000, cap: 100, minLevel: 100, minTeam: 6, maxTeam: 6,
    prize: { money: 20_000, essences: 3, items: [{ item: 'master-ball', min: 0, max: 1 }, { item: 'ultra-ball', min: 4, max: 4 }, { item: 'exp-candy-gg', min: 4, max: 4 }, { item: 'rare-candy', min: 3, max: 4 }] } },
];

/** Copas em duplas: inscrição 2,5× maior; dinheiro 3×, itens 1,5× e uma Essência a mais. */
export const DOUBLES_TOURNAMENT_TIERS: readonly TournamentTier[] = TOURNAMENT_TIERS.map((tier) => ({
  ...tier,
  id: `dupla-${tier.id}` as TournamentTierId,
  base: tier.id as SinglesTierId,
  doubles: true,
  name: `Duplas · ${tier.name}`,
  description: `Em duplas (2×2). ${tier.description}`,
  entry: Math.round((tier.entry * 2.5) / 5) * 5,
  prize: {
    money: tier.prize.money * 3,
    essences: tier.prize.essences + 1,
    items: tier.prize.items.map((line) => ({ item: line.item, min: Math.ceil(line.min * 1.5), max: Math.ceil(line.max * 1.5) })),
  },
}));

export const ALL_TOURNAMENT_TIERS: readonly TournamentTier[] = [...TOURNAMENT_TIERS, ...DOUBLES_TOURNAMENT_TIERS];

export const tournamentTier = (id: unknown): TournamentTier | undefined => ALL_TOURNAMENT_TIERS.find((tier) => tier.id === id);

export const MAX_TOURNAMENT_PICKS = 6;

const OPPONENT_NAMES = ['Treinador da Copa', 'Ace Trainer', 'Veterana', 'Domador', 'Colecionador', 'Especialista', 'Mestre Pokémon', 'Finalista'];
const bag = (item: string, name: string, heal: number, qty: number, cures = false): FoeBagItem => ({ item, name, heal, cures, qty });

export interface RolledOpponent {
  name: string;
  skill: 1 | 2 | 3;
  bag: FoeBagItem[];
  team: { speciesId: number; level: number }[];
}

const bst = (species: Species) => Object.values(species.baseStats).reduce((sum, value) => sum + value, 0);

/** Quem pode aparecer em cada categoria (mesmos filtros do jogo antigo, por estágio de evolução e atributos-base). */
export function tournamentPool(tier: TournamentTier, species: readonly Species[]): number[] {
  return species.filter((entry) => {
    const total = bst(entry);
    const stage = evolutionStage(entry);
    const legendary = isLegendary(entry);
    switch (tier.base ?? tier.id) {
      case 'muito-facil': return stage === 0 && total <= 350;
      case 'facil': return !legendary && total <= 480;
      case 'intermediario': return !legendary && (stage >= 1 || total >= 440);
      case 'dificil': return !legendary && (stage >= 2 || total >= 460);
      default: return stage >= 2 || legendary || total >= 470;
    }
  }).map((entry) => entry.id);
}

/** Sorteia o adversário da rodada (1–8): time e níveis da categoria; a IA e os itens melhoram nas últimas rodadas. */
export function rollOpponent(tier: TournamentTier, round: number, species: readonly Species[], rng: Rng): RolledOpponent {
  const pool = tournamentPool(tier, species);
  const count = tier.minTeam + rng.int(tier.maxTeam - tier.minTeam + 1);
  const team: RolledOpponent['team'] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const [id] = pool.splice(rng.int(pool.length), 1);
    team.push({ speciesId: id as number, level: tier.minLevel + rng.int(tier.cap - tier.minLevel + 1) });
  }
  const base = round <= 3 ? 1 : round <= 6 ? 2 : 3;
  const kind = tier.base ?? tier.id;
  const skill = (kind === 'copa-prime' || kind === 'muito-dificil') ? Math.max(base, 2) : base;
  const items: FoeBagItem[] = [];
  if (round >= 5) items.push(bag('super-potion', 'Super Potion', 60, 1));
  if (round === TOURNAMENT_ROUNDS) items.push(tier.cap >= 70 ? bag('full-restore', 'Full Restore', 9999, 1, true) : bag('hyper-potion', 'Hyper Potion', 120, 1));
  return { name: `${OPPONENT_NAMES[round - 1] ?? 'Adversário'} ${round}`, skill: skill as 1 | 2 | 3, bag: items, team };
}

/** Resolve `random-essence` para uma Essência de IV sorteada. */
export function resolvePrizeItem(item: string, rng: Rng): string {
  if (item === 'random-essence') return pick(rng, Object.keys(IV_ESSENCES));
  if (item === 'random-ball') return pick(rng, REWARD_BALLS);
  return item;
}

/** Sorteia os itens do prêmio: quantidades dentro da faixa de cada linha e as Essências. */
export function rollPrizeItems(tier: TournamentTier, rng: Rng): { item: string; quantity: number }[] {
  const out: { item: string; quantity: number }[] = [];
  const add = (item: string, quantity: number) => {
    const found = out.find((entry) => entry.item === item);
    if (found) found.quantity += quantity; else out.push({ item, quantity });
  };
  for (const line of tier.prize.items) {
    const quantity = line.min + rng.int(line.max - line.min + 1);
    if (quantity > 0) add(resolvePrizeItem(line.item, rng), quantity);
  }
  for (let i = 0; i < tier.prize.essences; i++) add(resolvePrizeItem('random-essence', rng), 1);
  return out;
}
