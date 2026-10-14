import type { TypeInfo, TypeName } from './types.ts';

export type TypeChart = Map<TypeName, TypeInfo>;

export function buildTypeChart(types: TypeInfo[]): TypeChart {
  return new Map(types.map((info) => [info.name, info]));
}

/** Multiplicador de dano de um golpe do tipo `attack` contra os tipos do defensor. */
export function effectiveness(chart: TypeChart, attack: TypeName, defender: readonly TypeName[]): number {
  const info = chart.get(attack);
  if (!info) return 1;
  let multiplier = 1;
  for (const type of defender) {
    if (info.noneTo.includes(type)) return 0;
    if (info.doubleTo.includes(type)) multiplier *= 2;
    else if (info.halfTo.includes(type)) multiplier *= 0.5;
  }
  return multiplier;
}

export function effectivenessLabel(multiplier: number): string {
  if (multiplier === 0) return 'Não afeta';
  if (multiplier >= 4) return 'Super efetivo ×4';
  if (multiplier >= 2) return 'Super efetivo';
  if (multiplier <= 0.25) return 'Quase sem efeito';
  if (multiplier < 1) return 'Pouco efetivo';
  return 'Normal';
}

export const TYPE_LABELS: Record<TypeName, string> = {
  normal: 'Normal', fire: 'Fogo', water: 'Água', electric: 'Elétrico', grass: 'Planta', ice: 'Gelo',
  fighting: 'Lutador', poison: 'Venenoso', ground: 'Terra', flying: 'Voador', psychic: 'Psíquico',
  bug: 'Inseto', rock: 'Pedra', ghost: 'Fantasma', dragon: 'Dragão', dark: 'Sombrio', steel: 'Aço', fairy: 'Fada',
};
