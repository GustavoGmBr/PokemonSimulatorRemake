import type { EvolutionNode, Species } from './types.ts';
import { REGIONS, type Region } from './regions.ts';

export const BOARD_SIZE = 10;
export const BOARD_SPINS = 3;

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

/** Pode aparecer como selvagem? Lendários e míticos ficam bloqueados até o campeão (Fase 6). */
export function isWildEligible(species: Species, unlockedRegions: readonly string[], badges: number): boolean {
  if (species.legendary || species.mythical) return false;
  const region = regionOfSpecies(species.id);
  if (!region || !unlockedRegions.includes(region.id)) return false;
  const inUnlockedRegion = (id: number) => unlockedRegions.includes(regionOfSpecies(id)?.id ?? '');
  return evolutionStage(species, inUnlockedRegion) <= maxStageForBadges(badges);
}
