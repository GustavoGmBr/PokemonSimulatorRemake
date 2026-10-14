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

export interface Matchups {
  /** multiplicador de dano recebido → tipos atacantes, do mais perigoso ao menos */
  quadruple: TypeName[];
  double: TypeName[];
  half: TypeName[];
  quarter: TypeName[];
  immune: TypeName[];
}

/** Fraquezas e resistências defensivas de uma combinação de tipos. */
export function defensiveMatchups(chart: TypeChart, defender: readonly TypeName[]): Matchups {
  const result: Matchups = { quadruple: [], double: [], half: [], quarter: [], immune: [] };
  for (const attack of chart.keys()) {
    const multiplier = effectiveness(chart, attack, defender);
    if (multiplier === 0) result.immune.push(attack);
    else if (multiplier >= 4) result.quadruple.push(attack);
    else if (multiplier >= 2) result.double.push(attack);
    else if (multiplier <= 0.25) result.quarter.push(attack);
    else if (multiplier < 1) result.half.push(attack);
  }
  return result;
}
