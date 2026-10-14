import type { EvolutionCondition, EvolutionNode } from './types.ts';

const TRIGGER_TEXT: Record<string, string> = {
  trade: 'Troca',
  shed: 'Espaço na equipe e uma Poké Bola',
  spin: 'Girar segurando um doce',
  'three-critical-hits': '3 golpes críticos em uma batalha',
  'take-damage': 'Sofrer dano em um local específico',
  'recoil-damage': 'Sofrer dano de recuo',
  'three-defeated-bisharp': 'Derrotar 3 Bisharp líderes',
  'tower-of-darkness': 'Torre da Escuridão',
  'tower-of-waters': 'Torre das Águas',
  'strong-style-move': 'Dominar um golpe de estilo forte',
  'agile-style-move': 'Dominar um golpe de estilo ágil',
  'meltan-candies': 'Dar doces de Meltan',
  'gimmighoul-coins': 'Juntar 999 moedas',
  'in-battle-level-up': 'Subir de nível em batalha',
};

const TIME_TEXT: Record<string, string> = { day: 'de dia', night: 'à noite', dusk: 'ao entardecer' };

export function titleCase(name: string): string {
  return name.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

/** Frase curta em português para o requisito de uma evolução. `itemName` traduz ids de item. */
export function describeCondition(
  condition: EvolutionCondition,
  itemName: (id: string) => string = titleCase,
): string {
  const parts: string[] = [];
  switch (condition.trigger) {
    case 'level-up':
    case 'in-battle-level-up':
      parts.push(condition.level ? `Nível ${condition.level}` : 'Subir de nível');
      break;
    case 'use-item':
      parts.push(condition.item ? `Usar ${itemName(condition.item)}` : 'Usar um item');
      break;
    case 'use-move':
      parts.push(condition.knownMoveType ? `Golpe do tipo ${condition.knownMoveType}` : 'Aprender um golpe');
      break;
    default:
      parts.push(TRIGGER_TEXT[condition.trigger] ?? titleCase(condition.trigger));
  }
  if (condition.trigger === 'level-up' && condition.knownMoveType) parts.push(`sabendo golpe do tipo ${condition.knownMoveType}`);
  if (condition.happiness) parts.push(`com amizade ${condition.happiness}+`);
  if (condition.heldItem) parts.push(`segurando ${itemName(condition.heldItem)}`);
  if (condition.timeOfDay) parts.push(TIME_TEXT[condition.timeOfDay] ?? condition.timeOfDay);
  return parts.join(', ');
}

export function describeConditions(
  conditions: readonly EvolutionCondition[],
  itemName?: (id: string) => string,
): string {
  if (conditions.length === 0) return '';
  return conditions.map((condition) => describeCondition(condition, itemName)).join(' ou ');
}

export interface EvolutionRow {
  depth: number;
  speciesId: number;
  /** requisito para chegar nesta espécie a partir da anterior ('' na raiz) */
  requirement: string;
}

/** Achata a árvore evolutiva em linhas indentadas, na ordem de leitura. */
export function flattenEvolution(root: EvolutionNode, itemName?: (id: string) => string): EvolutionRow[] {
  const rows: EvolutionRow[] = [];
  const walk = (node: EvolutionNode, depth: number) => {
    rows.push({ depth, speciesId: node.speciesId, requirement: describeConditions(node.conditions, itemName) });
    for (const next of node.evolvesTo) walk(next, depth + 1);
  };
  walk(root, 0);
  return rows;
}
