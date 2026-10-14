import type { EvolutionNode, Species, TypeName } from './types.ts';
import { REGIONS, type Region } from './regions.ts';

export const BOARD_SIZE = 10;
export const BOARD_SPINS = 3;
/** Preço para renovar o mapa quando os giros acabam. */
export const REFRESH_COST = 1000;
export const MIN_WILD_LEVEL = 1;
export const MAX_WILD_LEVEL = 100;
export const GYMS_PER_REGION = 8;
/** Chance de cada vaga do mapa ser lendário/mítico, quando a Elite dos 4 da região já caiu. */
export const LEGENDARY_SLOT_CHANCE = 0.04;

// ---------------------------------------------------------------- progresso por região

/** Ids gravados na tabela `badges`: `kanto:gym1`…`kanto:gym8`, `kanto:elite`, `kanto:champion`. */
export const gymId = (region: string, n: number) => `${region}:gym${n}`;
export const eliteId = (region: string) => `${region}:elite`;
export const championId = (region: string) => `${region}:champion`;

export interface RegionProgress {
  gyms: number;
  elite: boolean;
  champion: boolean;
}

export function regionProgress(challengeIds: readonly string[], region: string): RegionProgress {
  const gyms = challengeIds.filter((id) => id.startsWith(`${region}:gym`)).length;
  return { gyms, elite: challengeIds.includes(eliteId(region)), champion: challengeIds.includes(championId(region)) };
}

/** Kanto começa liberada; cada região seguinte abre ao derrotar o campeão da anterior. */
export function unlockedRegionIds(challengeIds: readonly string[]): string[] {
  const unlocked: string[] = [];
  for (const [index, region] of REGIONS.entries()) {
    if (index === 0 || challengeIds.includes(championId((REGIONS[index - 1] as Region).id))) unlocked.push(region.id);
    else break;
  }
  return unlocked;
}

/** Giros por mapa: 3 de base; 5 com um ginásio da região, 8 com a Elite dos 4, 12 com o campeão. */
export function spinsFor(progress: RegionProgress): number {
  return progress.champion ? 12 : progress.elite ? 8 : progress.gyms > 0 ? 5 : BOARD_SPINS;
}

// ---------------------------------------------------------------- habitats (mapas)

export interface Habitat {
  id: string;
  name: string;
  types: readonly TypeName[];
  description: string;
}

export const HABITATS: readonly Habitat[] = [
  { id: 'forest', name: 'Floresta', types: ['normal', 'grass', 'bug'], description: 'Floresta densa com clareiras e campos abertos.' },
  { id: 'coast', name: 'Costa', types: ['water', 'flying'], description: 'Costa litorânea com falésias rochosas, praias e ilhotas oceânicas.' },
  { id: 'volcano', name: 'Terreno vulcânico', types: ['fire', 'rock', 'ground'], description: 'Terreno árido vulcânico com desfiladeiros, cânions secos e crateras de lava.' },
  { id: 'mountain', name: 'Cordilheira', types: ['ice', 'steel'], description: 'Cordilheira com picos nevados, cavernas de gelo e minas escavadas.' },
  { id: 'industrial', name: 'Zona industrial', types: ['electric', 'poison'], description: 'Zona industrial abandonada com pântanos tóxicos e usinas desativadas.' },
  { id: 'ruins', name: 'Ruínas', types: ['psychic', 'ghost', 'dark'], description: 'Ruínas antigas com cemitério abandonado e uma torre misteriosa cercada por névoa.' },
  { id: 'plateau', name: 'Platô', types: ['fighting', 'dragon'], description: 'Platô montanhoso com escadarias esculpidas na rocha, arena a céu aberto e santuário no cume.' },
  { id: 'grove', name: 'Bosque encantado', types: ['fairy'], description: 'Bosque encantado com clareira mística, lago cristalino e cogumelos gigantes iluminados.' },
];

export function habitatOfType(type: TypeName): Habitat {
  return HABITATS.find((habitat) => habitat.types.includes(type)) as Habitat;
}

export function habitatById(id: string): Habitat | undefined {
  return HABITATS.find((habitat) => habitat.id === id);
}

export function speciesInHabitat(species: Pick<Species, 'types'>, habitat: Habitat): boolean {
  return species.types.some((type) => habitat.types.includes(type));
}


/**
 * Posição na cadeia evolutiva: 0 = primeiro estágio, 1 = segundo, 2 = terceiro.
 * Com `counts`, só contam os antecessores aceitos — assim o Pikachu é "primeiro estágio" em Kanto
 * enquanto Johto (onde mora o Pichu) não está liberada.
 */
export function evolutionStage(
  species: Pick<Species, 'id' | 'evolutionChain'>,
  counts: (speciesId: number) => boolean = () => true,
): number {
  const walk = (node: EvolutionNode, ancestors: number[]): number[] | null => {
    if (node.speciesId === species.id) return ancestors;
    for (const next of node.evolvesTo) {
      const found = walk(next, [...ancestors, node.speciesId]);
      if (found) return found;
    }
    return null;
  };
  return (walk(species.evolutionChain, []) ?? []).filter(counts).length;
}

/** Estágios finais só aparecem com algumas insígnias, para não ver um Dragonite com o inicial. */
export function maxStageForBadges(badges: number): number {
  return badges >= 5 ? 2 : badges >= 2 ? 1 : 0;
}

/** Faixa de nível dos selvagens: sobe 5 níveis por insígnia. */
export function wildLevelRange(badges: number): [min: number, max: number] {
  const min = Math.min(95, 3 + badges * 5);
  return [min, Math.min(100, min + 9)];
}

export function regionOfSpecies(speciesId: number): Region | undefined {
  return REGIONS.find((region) => speciesId >= region.dex[0] && speciesId <= region.dex[1]);
}

export function isLegendary(species: Pick<Species, 'legendary' | 'mythical'>): boolean {
  return species.legendary || species.mythical;
}

/**
 * Pode aparecer comum no mapa da região? Lendários e míticos entram à parte (ver LEGENDARY_SLOT_CHANCE).
 * Os estágios evolutivos contam só os antecessores de regiões liberadas.
 */
export function isWildEligible(species: Species, region: string, unlockedRegions: readonly string[], badges: number): boolean {
  if (isLegendary(species)) return false;
  if (regionOfSpecies(species.id)?.id !== region) return false;
  const inUnlockedRegion = (id: number) => unlockedRegions.includes(regionOfSpecies(id)?.id ?? '');
  return evolutionStage(species, inUnlockedRegion) <= maxStageForBadges(badges);
}
