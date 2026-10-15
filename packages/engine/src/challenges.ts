import type { Species } from './types.ts';
import { championId, eliteId, evolutionStage, gymId, isLegendary, unlockedRegionIds } from './wild.ts';
import type { FoeBagItem } from './battle.ts';
import { pick, type Rng } from './rng.ts';

// Ginásios, Elite dos 4 e campeões: os mesmos dados do jogo antigo (catálogo `challenges.json`).

export interface LeaderEntry {
  /** id do jogo antigo (ex.: "brock") */
  slug: string;
  name: string;
  type: string;
  level: number;
  team: number[];
}

export interface Circuit {
  /** "unova" é o circuito 1 de Unova; "unova2" é o 2 (as demais regiões têm um circuito com o próprio id) */
  id: string;
  name: string;
  gymLabel: string;
  eliteLabel: string;
  gyms: LeaderEntry[];
  elite: LeaderEntry[];
  champion: LeaderEntry;
}

export interface RegionChallenges {
  id: string;
  circuits: Circuit[];
}

export interface ChallengeCatalog {
  regions: RegionChallenges[];
}

export type ChallengeKind = 'gym' | 'elite' | 'champion';

export interface Challenge {
  /** id gravado em `badges`: `kanto:gym1`, `kanto:elite2`, `kanto:champion`, `unova2:gym3`… */
  id: string;
  region: string;
  circuit: string;
  kind: ChallengeKind;
  number: number;
  name: string;
  type: string;
  level: number;
  team: number[];
  /** "Líder", "Elite", "Campeão"… */
  title: string;
  /** nome do grupo: "Ginásio", "Prova Insular", "Elite dos 4", "Campeão" */
  group: string;
}

export function listChallenges(catalog: ChallengeCatalog): Challenge[] {
  const out: Challenge[] = [];
  for (const region of catalog.regions) {
    for (const circuit of region.circuits) {
      const trial = circuit.gymLabel === 'Provas Insulares';
      circuit.gyms.forEach((entry, i) => out.push({
        id: gymId(circuit.id, i + 1), region: region.id, circuit: circuit.id, kind: 'gym', number: i + 1, ...entry,
        title: trial ? 'Capitão' : 'Líder', group: trial ? 'Prova Insular' : 'Ginásio',
      }));
      circuit.elite.forEach((entry, i) => out.push({
        id: eliteId(circuit.id, i + 1), region: region.id, circuit: circuit.id, kind: 'elite', number: i + 1, ...entry,
        title: circuit.eliteLabel === 'Copa dos Campeões' ? 'Copa' : 'Elite', group: circuit.eliteLabel,
      }));
      out.push({ id: championId(circuit.id), region: region.id, circuit: circuit.id, kind: 'champion', number: 1, ...circuit.champion, title: 'Campeão', group: 'Campeão' });
    }
  }
  return out;
}

/** Liberado? A região precisa estar aberta; ginásios em qualquer ordem; Elite em ordem depois dos 8 ginásios; campeão depois da Elite. */
export function challengeUnlocked(challenge: Challenge, won: ReadonlySet<string>): boolean {
  if (!unlockedRegionIds([...won]).includes(challenge.region)) return false;
  if (challenge.circuit === 'unova2' && !won.has(championId('unova'))) return false;
  const gymsDone = Array.from({ length: 8 }, (_, i) => won.has(gymId(challenge.circuit, i + 1))).every(Boolean);
  if (challenge.kind === 'gym') return true;
  if (!gymsDone) return false;
  if (challenge.kind === 'elite') return Array.from({ length: challenge.number - 1 }, (_, i) => won.has(eliteId(challenge.circuit, i + 1))).every(Boolean);
  return [1, 2, 3, 4].every((n) => won.has(eliteId(challenge.circuit, n)));
}

/** Por que está bloqueado (texto para a tela). */
export function challengeLockReason(challenge: Challenge, won: ReadonlySet<string>): string | null {
  if (challengeUnlocked(challenge, won)) return null;
  if (!unlockedRegionIds([...won]).includes(challenge.region)) return 'Região bloqueada: derrote o campeão da anterior.';
  if (challenge.circuit === 'unova2' && !won.has(championId('unova'))) return 'Derrote o campeão do primeiro circuito de Unova.';
  const gymsDone = Array.from({ length: 8 }, (_, i) => won.has(gymId(challenge.circuit, i + 1))).every(Boolean);
  if (!gymsDone) return 'Vença os 8 ginásios antes.';
  return challenge.kind === 'elite' ? 'Vença os membros anteriores da Elite.' : 'Vença os 4 da Elite.';
}

/** Região de Pokémon permitida no desafio (só Pokémon da geração da região, como no jogo antigo). */
export function circuitDex(region: { dex: [number, number] }): [number, number] {
  return region.dex;
}

// ---------------------------------------------------------------- IA e itens dos líderes

const FULL_RESTORE: FoeBagItem = { item: 'full-restore', name: 'Full Restore', heal: 9999, cures: true, qty: 1 };
const bag = (item: string, name: string, heal: number, qty: number, cures = false): FoeBagItem => ({ item, name, heal, cures, qty });

export function leaderSkill(challenge: Pick<Challenge, 'kind' | 'number'>): 1 | 2 | 3 {
  if (challenge.kind !== 'gym') return 3;
  return challenge.number <= 2 ? 1 : challenge.number <= 5 ? 2 : 3;
}

export function leaderBag(challenge: Pick<Challenge, 'kind' | 'number'>): FoeBagItem[] {
  if (challenge.kind === 'champion') return [bag('hyper-potion', 'Hyper Potion', 120, 1), { ...FULL_RESTORE, qty: 2 }];
  if (challenge.kind === 'elite') return [bag('hyper-potion', 'Hyper Potion', 120, 2)];
  if (challenge.number <= 2) return [];
  return challenge.number <= 5 ? [bag('super-potion', 'Super Potion', 60, 1)] : [bag('hyper-potion', 'Hyper Potion', 120, 1)];
}

// ---------------------------------------------------------------- treinadores aleatórios por dificuldade

export type Difficulty = 'facil' | 'medio' | 'dificil';
export const DIFFICULTIES: readonly Difficulty[] = ['facil', 'medio', 'dificil'];

export interface DifficultyRules {
  name: string;
  minTeam: number;
  maxTeam: number;
  minLevel: number;
  maxLevel: number;
  money: number;
  /** itens de prêmio; `random-ball` vira uma Poké Bola especial sorteada */
  rewards: { item: string; quantity: number }[];
  names: string[];
  skill: 1 | 2 | 3;
  bag: FoeBagItem[];
  description: string;
}

export const REWARD_BALLS = ['net-ball', 'dusk-ball', 'nest-ball', 'repeat-ball', 'timer-ball', 'luxury-ball', 'quick-ball'] as const;

export const TRAINER_DIFFICULTIES: Record<Difficulty, DifficultyRules> = {
  facil: {
    name: 'Fácil', minTeam: 2, maxTeam: 3, minLevel: 20, maxLevel: 30, money: 1000, skill: 1, bag: [],
    rewards: [{ item: 'random-ball', quantity: 2 }, { item: 'potion', quantity: 1 }],
    names: ['Jovem Treinador', 'Escoteira', 'Colecionador'],
    description: '2 a 3 Pokémon básicos, nível 20–30. Sem itens.',
  },
  medio: {
    name: 'Médio', minTeam: 3, maxTeam: 4, minLevel: 40, maxLevel: 50, money: 3000, skill: 2, bag: [bag('super-potion', 'Super Potion', 60, 1)],
    rewards: [{ item: 'great-ball', quantity: 2 }, { item: 'super-potion', quantity: 2 }],
    names: ['Veterana', 'Domador', 'Ace Trainer'],
    description: '3 a 4 Pokémon, nível 40–50. Escolhe golpes pela efetividade e usa poção.',
  },
  dificil: {
    name: 'Difícil', minTeam: 6, maxTeam: 6, minLevel: 100, maxLevel: 100, money: 10000, skill: 3,
    bag: [bag('hyper-potion', 'Hyper Potion', 120, 2), { ...FULL_RESTORE, qty: 1 }],
    rewards: [{ item: 'ultra-ball', quantity: 3 }, { item: 'hyper-potion', quantity: 2 }, { item: 'revive', quantity: 1 }],
    names: ['Campeão Errante', 'Lenda da Arena', 'Mestre Pokémon'],
    description: '6 Pokémon de nível 100 (até lendários). Troca de Pokémon, usa itens e mira o KO.',
  },
};

export interface RolledTrainer {
  name: string;
  difficulty: Difficulty;
  team: { speciesId: number; level: number }[];
  money: number;
  rewards: { item: string; quantity: number }[];
}

const total = (species: Species) => Object.values(species.baseStats).reduce((sum, value) => sum + value, 0);

/** Sorteia um treinador: equipe sem repetição, pela dificuldade (mesmas regras do jogo antigo). */
export function rollTrainer(difficulty: Difficulty, species: readonly Species[], rng: Rng): RolledTrainer {
  const rules = TRAINER_DIFFICULTIES[difficulty];
  const count = rules.minTeam + rng.int(rules.maxTeam - rules.minTeam + 1);
  const pool = species.filter((entry) => {
    if (difficulty === 'facil') return !isLegendary(entry) && evolutionStage(entry) === 0 && total(entry) <= 400;
    if (difficulty === 'medio') return !isLegendary(entry) && total(entry) <= 540;
    return true;
  }).map((entry) => entry.id);
  const team: RolledTrainer['team'] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const [id] = pool.splice(rng.int(pool.length), 1);
    team.push({ speciesId: id as number, level: rules.minLevel + rng.int(rules.maxLevel - rules.minLevel + 1) });
  }
  const rewards = rules.rewards.map((reward) => (reward.item === 'random-ball' ? { ...reward, item: pick(rng, REWARD_BALLS) } : { ...reward }));
  return { name: pick(rng, rules.names), difficulty, team, money: rules.money, rewards };
}
