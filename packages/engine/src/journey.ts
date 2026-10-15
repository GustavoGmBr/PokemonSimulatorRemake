import { REGIONS } from './regions.ts';
import { REWARD_BALLS } from './challenges.ts';
import { IV_ESSENCES } from './transform.ts';
import { ALL_TOURNAMENT_TIERS } from './tournaments.ts';

/** Missões, mercado de Pokémon e valor de venda (regras do jogo antigo). */

export const MISSION_DURATION_MS = 2 * 60 * 60 * 1000;
export const MISSION_COUNT = 10;
export const MISSION_COMPLETION_REWARD = { money: 5_000, chips: 500, items: [{ item: 'rare-candy', quantity: 1 }] } as const;
export const missionPeriod = (now = Date.now()): number => Math.floor(now / MISSION_DURATION_MS);

export type MissionKind = 'capturar' | 'derrotar' | 'vencer_treinador' | 'vencer_torneio';
export interface Mission {
  index: number;
  kind: MissionKind;
  region?: string;
  difficulty?: 'facil' | 'medio' | 'dificil';
  tournament?: string;
  title: string;
  target: number;
  reward: { money: number; chips: number; items: { item: string; quantity: number }[] };
}

/** 32 bytes determinísticos a partir de um texto (para as missões não mudarem dentro do período). */
export function hashBytes(text: string): number[] {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) { h = Math.imul(h ^ text.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  const out: number[] = [];
  for (let i = 0; i < 32; i++) {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    out.push((h >>> 0) & 255);
  }
  return out;
}

export interface MissionInput {
  saveId: string;
  period: number;
  /** regiões liberadas no começo do período */
  unlockedRegions: readonly string[];
  /** ginásios vencidos antes do período */
  gymsWon: number;
}

const DIFFICULTIES = ['facil', 'medio', 'dificil'] as const;

export function generateMissions({ saveId, period, unlockedRegions, gymsWon }: MissionInput): Mission[] {
  const bytes = hashBytes(`${saveId}:${period}`);
  const regions = REGIONS.filter((region) => unlockedRegions.includes(region.id));
  const pickRegion = (offset: number) => regions[(bytes[offset] as number) % regions.length] ?? REGIONS[0]!;
  const tiers = gymsWon < 4 ? ['muito-facil'] : gymsWon < 16 ? ['muito-facil', 'facil'] : gymsWon < 32 ? ['facil', 'intermediario'] : ['intermediario', 'dificil', 'muito-dificil', 'copa-prime'];
  const missions: Mission[] = [];
  const tierName = (id: string) => ALL_TOURNAMENT_TIERS.find((tier) => tier.id === id)?.name ?? id;
  for (let i = 0; i < 3; i++) {
    const region = pickRegion(i);
    const goal = i + 1 + (period % 3);
    const ball = REWARD_BALLS[(bytes[20 + i] as number) % REWARD_BALLS.length] as string;
    missions.push({
      index: missions.length, kind: 'capturar', region: region.id, target: goal,
      title: `Capture ${goal} espécie${goal > 1 ? 's' : ''} diferente${goal > 1 ? 's' : ''} de ${region.name}`,
      reward: { money: 150 + region.generation * 50 + i * 100, chips: 0, items: [{ item: ball, quantity: 2 + i }] },
    });
  }
  for (let i = 0; i < 3; i++) {
    const region = pickRegion(i + 3);
    const goal = 2 + i * 2;
    missions.push({
      index: missions.length, kind: 'derrotar', region: region.id, target: goal,
      title: `Derrote ${goal} Pokémon selvagens de ${region.name}`,
      reward: { money: 200 + region.generation * 60 + i * 100, chips: 0, items: [{ item: 'exp-candy-p', quantity: 1 + i }] },
    });
  }
  for (let i = 0; i < 2; i++) {
    const difficulty = DIFFICULTIES[(bytes[8 + i] as number) % (gymsWon < 8 ? 1 : gymsWon < 24 ? 2 : 3)] as (typeof DIFFICULTIES)[number];
    const goal = i + 1;
    missions.push({
      index: missions.length, kind: 'vencer_treinador', difficulty, target: goal,
      title: `Vença ${goal} treinador${goal > 1 ? 'es' : ''} no modo ${{ facil: 'Fácil', medio: 'Médio', dificil: 'Difícil' }[difficulty]}`,
      reward: { money: 300 + DIFFICULTIES.indexOf(difficulty) * 200 + i * 200, chips: 0, items: [{ item: 'great-ball', quantity: 1 + i }] },
    });
  }
  for (let i = 0; i < 2; i++) {
    const tournament = tiers[(bytes[10 + i] as number) % tiers.length] as string;
    const goal = i + 1;
    missions.push({
      index: missions.length, kind: 'vencer_torneio', tournament, target: goal,
      title: `Vença ${goal} vez${goal > 1 ? 'es' : ''} a Copa ${tierName(tournament)}`,
      reward: { money: 500 + tiers.indexOf(tournament) * 300 + i * 400, chips: 0, items: [{ item: 'exp-candy-m', quantity: 1 + i }] },
    });
  }
  const essences = Object.keys(IV_ESSENCES);
  for (const mission of missions) {
    mission.reward.chips = 10 + mission.index * 5;
    mission.reward.items.push({ item: essences[((bytes[12] as number) + mission.index) % essences.length] as string, quantity: 1 });
  }
  return missions;
}

export interface JourneyEvent {
  kind: string;
  region?: string | null;
  speciesId?: number | null;
  difficulty?: string | null;
  tournament?: string | null;
}

/** Progresso: capturas contam espécies diferentes; o resto conta eventos. */
export function missionProgress(mission: Mission, events: readonly JourneyEvent[]): number {
  const matching = events.filter((event) => event.kind === mission.kind
    && (!mission.region || event.region === mission.region)
    && (!mission.difficulty || event.difficulty === mission.difficulty)
    && (!mission.tournament || event.tournament === mission.tournament));
  return mission.kind === 'capturar' ? new Set(matching.map((event) => event.speciesId)).size : matching.length;
}

// ------------------------------------------------------------------------------------------------ mercado

export const MARKET_REFRESH_MS = 60 * 60 * 1000;
export const MARKET_SIZE = 16;
export const MARKET_REFRESH_PRICE = 3_000;
export const MARKET_SHINY_DENOMINATOR = 4086;
export const marketPeriod = (now = Date.now()): number => Math.floor(now / MARKET_REFRESH_MS);

/** Preço de um Pokémon do mercado: ₽ 10.000; ×2 se a região ainda está bloqueada; ×5 shiny; ×1,5 com 3★ e ×2 com 4★. */
export function marketPrice(regionUnlocked: boolean, shiny: boolean, stars: number): number {
  return Math.floor(10_000 * (regionUnlocked ? 1 : 2) * (shiny ? 5 : 1) * (stars === 4 ? 2 : stars === 3 ? 1.5 : 1));
}

export const BALL_SALE_PRICES: Record<string, number> = { 'poke-ball': 200, 'great-ball': 600, 'ultra-ball': 1200 };

export interface SaleInput {
  level: number;
  ball: string | null;
  legendary: boolean;
  shiny: boolean;
  ivMultiplier: number;
  /** soma dos preços dos itens usados no Pokémon (Doces, Essências, pedras…) */
  invested?: number;
}

/** Valor de venda (e da aposta no cassino): bola + nível, mais o investido, ×3 lendário, ×10 shiny, × qualidade dos IVs. */
export function saleValue(input: SaleInput): number {
  const ball = input.ball ?? 'poke-ball';
  const ballValue = ball === 'master-ball' ? input.level * 20 : (BALL_SALE_PRICES[ball] ?? BALL_SALE_PRICES['poke-ball'] as number) / 2 + input.level * 10;
  return Math.floor((ballValue + Math.max(0, input.invested ?? 0)) * (input.legendary ? 3 : 1) * (input.shiny ? 10 : 1) * input.ivMultiplier);
}
