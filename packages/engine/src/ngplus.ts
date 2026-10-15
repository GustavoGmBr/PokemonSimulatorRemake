import type { Challenge } from './challenges.ts';
import type { Species } from './types.ts';
import { championId } from './wild.ts';

/**
 * New Game+ ("Novo Ciclo"): depois de vencer todos os campeões, eles voltam bem mais fortes (nível 100, IVs perfeitos,
 * seis Pokémon, IA máxima) e treinadores icônicos passam a aceitar desafios. Os prêmios são maiores e há um troféu por vitória.
 */
export const NG_PREFIX = 'ng:';
export const NG_LEVEL = 100;
export const isNgId = (id: string): boolean => id.startsWith(NG_PREFIX);

export interface IconicTrainer {
  slug: string;
  name: string;
  /** de onde vem, para a descrição */
  origin: string;
  blurb: string;
  team: number[];
}

/** Treinadores icônicos (equipes inspiradas nas aparições mais famosas deles). */
export const ICONIC_TRAINERS: readonly IconicTrainer[] = [
  { slug: 'red', name: 'Red', origin: 'Kanto · Monte Prateado', blurb: 'O lendário treinador silencioso do topo do Monte Prateado.', team: [25, 196, 143, 3, 6, 9] },
  { slug: 'ash', name: 'Ash', origin: 'Pallet Town', blurb: 'Viajou por todas as regiões e nunca desistiu de ser Mestre.', team: [25, 658, 6, 745, 254, 149] },
  { slug: 'gold', name: 'Gold', origin: 'Johto · New Bark', blurb: 'O herói de Johto, mestre de Typhlosion.', team: [157, 197, 181, 18, 248, 143] },
  { slug: 'steven', name: 'Steven', origin: 'Hoenn · Campeão', blurb: 'Colecionador de pedras raras e mestre dos Pokémon de aço.', team: [376, 227, 346, 306, 344, 348] },
  { slug: 'wallace', name: 'Wallace', origin: 'Hoenn · Sootopolis', blurb: 'Elegante artista da água e ex-campeão de Hoenn.', team: [350, 272, 340, 321, 73, 130] },
  { slug: 'cynthia', name: 'Cynthia', origin: 'Sinnoh · Campeã', blurb: 'Considerada a treinadora mais forte já vista.', team: [445, 442, 407, 423, 448, 350] },
  { slug: 'n', name: 'N', origin: 'Unova · Team Plasma', blurb: 'Ouve a voz dos Pokémon e luta ao lado de Reshiram.', team: [571, 643, 565, 567, 601, 584] },
  { slug: 'iris', name: 'Iris', origin: 'Unova · Campeã', blurb: 'Cresceu entre dragões e luta de forma selvagem e instintiva.', team: [612, 567, 131, 306, 635, 621] },
  { slug: 'diantha', name: 'Diantha', origin: 'Kalos · Campeã', blurb: 'Atriz e campeã de Kalos, com golpes de cinema.', team: [701, 697, 699, 711, 706, 282] },
  { slug: 'leon', name: 'Leon', origin: 'Galar · Campeão', blurb: 'O campeão invicto de Galar, com seu Charizard.', team: [681, 887, 612, 537, 866, 6] },
  { slug: 'geeta', name: 'Geeta', origin: 'Paldea · Top Champion', blurb: 'A presidente da Liga e Top Champion de Paldea.', team: [956, 673, 976, 713, 983, 970] },
];

export interface NgChallenge {
  /** `ng:kanto:champion` ou `ng:iconic:red` */
  id: string;
  kind: 'champion' | 'iconic';
  region: string | null;
  name: string;
  title: string;
  level: number;
  team: number[];
  blurb: string;
}

const bst = (species: Species) => Object.values(species.baseStats).reduce((sum, value) => sum + value, 0);

/** Os campeões ficam com 6 Pokémon: completa com os mais fortes do ginásio e da Elite do mesmo circuito. */
export function ngChampionTeam(champion: Challenge, all: readonly Challenge[], speciesById: ReadonlyMap<number, Species>): number[] {
  const team = [...champion.team];
  const donors = all.filter((c) => c.circuit === champion.circuit && c.kind !== 'champion').flatMap((c) => c.team);
  const ranked = [...new Set(donors)].filter((id) => !team.includes(id)).sort((a, b) => bst(speciesById.get(b) as Species) - bst(speciesById.get(a) as Species));
  while (team.length < 6 && ranked.length > 0) team.push(ranked.shift() as number);
  return team;
}

export function buildNgChallenges(all: readonly Challenge[], speciesById: ReadonlyMap<number, Species>): NgChallenge[] {
  const out: NgChallenge[] = all.filter((c) => c.kind === 'champion').map((c) => ({
    id: `${NG_PREFIX}${c.id}`, kind: 'champion', region: c.region, name: c.name, title: 'Campeão+', level: NG_LEVEL,
    team: ngChampionTeam(c, all, speciesById), blurb: `${c.name} voltou muito mais forte: equipe completa, nível ${NG_LEVEL} e IVs perfeitos.`,
  }));
  for (const t of ICONIC_TRAINERS) {
    out.push({ id: `${NG_PREFIX}iconic:${t.slug}`, kind: 'iconic', region: null, name: t.name, title: 'Lenda', level: NG_LEVEL, team: [...t.team], blurb: `${t.blurb} (${t.origin})` });
  }
  return out;
}

/** Campeões que precisam estar vencidos para abrir o Novo Ciclo. */
export function ngRequiredIds(all: readonly Challenge[]): string[] {
  return all.filter((c) => c.kind === 'champion').map((c) => championId(c.circuit));
}

export function ngUnlocked(all: readonly Challenge[], won: ReadonlySet<string>): boolean {
  return ngRequiredIds(all).every((id) => won.has(id));
}

export interface NgRewards { money: number; items: { item: string; quantity: number }[] }

/** Prêmio por vitória; a primeira vez de cada desafio rende um bônus extra (Master Ball e Essências). */
export function ngRewards(challenge: Pick<NgChallenge, 'kind'>, firstWin: boolean): NgRewards {
  const iconic = challenge.kind === 'iconic';
  const items = iconic
    ? [{ item: 'rare-candy', quantity: 5 }, { item: 'exp-candy-gg', quantity: 6 }, { item: 'max-revive', quantity: 2 }]
    : [{ item: 'rare-candy', quantity: 3 }, { item: 'exp-candy-gg', quantity: 4 }, { item: 'ultra-ball', quantity: 5 }];
  if (firstWin) {
    items.push({ item: 'master-ball', quantity: 1 });
    for (const essence of ['iv-hp', 'iv-attack', 'iv-defense', 'iv-special-attack', 'iv-special-defense', 'iv-speed']) items.push({ item: essence, quantity: iconic ? 2 : 1 });
  }
  return { money: iconic ? 120_000 : 60_000, items };
}

export function ngLeaderBag() {
  return [{ item: 'full-restore', name: 'Full Restore', heal: 9999, cures: true, qty: 3 }];
}
