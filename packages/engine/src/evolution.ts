import type { EvolutionCondition, EvolutionNode, Species, TypeName } from './types.ts';

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

export interface EvolutionChoice {
  speciesId: number;
  requirement: string;
}

export interface EvolutionState {
  level: number;
  friendship: number;
  /** tipos dos golpes que o Pokémon conhece */
  moveTypes: readonly TypeName[];
  /** hora local (0–23) */
  hour: number;
}

function phaseOfDay(hour: number): 'day' | 'dusk' | 'night' {
  if (hour >= 6 && hour < 17) return 'day';
  if (hour >= 17 && hour < 19) return 'dusk';
  return 'night';
}

/** A condição pode ser cumprida agora, sem item, troca ou local? Só gatilhos de nível entram. */
export function conditionMet(condition: EvolutionCondition, state: EvolutionState): boolean {
  if (condition.trigger !== 'level-up' || condition.item || condition.heldItem) return false;
  const hasRequirement = condition.level !== null || condition.happiness !== null || condition.timeOfDay !== null || condition.knownMoveType !== null;
  if (!hasRequirement) return false; // condição desconhecida (local, gênero…): fora do alcance
  if (condition.level !== null && state.level < condition.level) return false;
  if (condition.happiness !== null && state.friendship < condition.happiness) return false;
  if (condition.timeOfDay) {
    const phase = phaseOfDay(state.hour);
    const wanted = condition.timeOfDay;
    if (wanted === 'day' && phase !== 'day') return false;
    if (wanted === 'night' && phase !== 'night') return false;
    if (wanted === 'dusk' && phase !== 'dusk') return false;
  }
  if (condition.knownMoveType && !state.moveTypes.includes(condition.knownMoveType as TypeName)) return false;
  return true;
}

function findNode(root: EvolutionNode, speciesId: number): EvolutionNode | null {
  if (root.speciesId === speciesId) return root;
  for (const next of root.evolvesTo) {
    const found = findNode(next, speciesId);
    if (found) return found;
  }
  return null;
}

/** Evoluções que o Pokémon pode fazer agora (por nível, amizade, hora do dia ou golpe conhecido). */
export function availableEvolutions(species: Species, state: EvolutionState, itemName?: (id: string) => string): EvolutionChoice[] {
  const node = findNode(species.evolutionChain, species.id);
  if (!node) return [];
  return node.evolvesTo
    .filter((next) => next.conditions.some((condition) => conditionMet(condition, state)))
    .map((next) => ({ speciesId: next.speciesId, requirement: describeConditions(next.conditions, itemName) }));
}
