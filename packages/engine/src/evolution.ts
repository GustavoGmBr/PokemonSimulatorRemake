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
  /** item gasto na evolução (pedra, Cabo de Ligação…); null quando basta o nível */
  item: string | null;
  /** pode evoluir agora (tem o item e nada bloqueia) */
  ready: boolean;
  /** por que ainda não dá (item faltando, região bloqueada); null quando pronto */
  reason: string | null;
}

export interface EvolutionState {
  level: number;
  friendship: number;
  /** tipos dos golpes que o Pokémon conhece */
  moveTypes: readonly TypeName[];
  /** hora local (0–23) */
  hour: number;
  /** a mochila tem esse item? (sem isso, só evoluções por nível aparecem) */
  has?: (item: string) => boolean;
}

/** Item que o jogo antigo usava no lugar da troca: o próprio objeto da troca, ou o Cabo de Ligação. */
export const LINKING_CORD = 'linking-cord';

function phaseOfDay(hour: number): 'day' | 'dusk' | 'night' {
  if (hour >= 6 && hour < 17) return 'day';
  if (hour >= 17 && hour < 19) return 'dusk';
  return 'night';
}

/** A condição pode ser cumprida agora, sem item, troca ou local? Só gatilhos de nível entram. */
export function conditionMet(condition: EvolutionCondition, state: EvolutionState): boolean {
  if (condition.trigger !== 'level-up' || condition.item || condition.heldItem) return false;
  if (condition.happiness !== null) return false; // sem evolução por amizade neste jogo
  const hasRequirement = condition.level !== null || condition.timeOfDay !== null || condition.knownMoveType !== null;
  if (!hasRequirement) return false; // condição desconhecida (local, gênero…): fora do alcance
  if (condition.level !== null && state.level < condition.level) return false;
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

/** Item que este caminho evolutivo gasta (pedra, objeto de troca, Cabo de Ligação), ou null se não usa item. */
export function itemFor(condition: EvolutionCondition): string | null {
  if (condition.happiness !== null) return null;
  if (condition.trigger === 'use-item' && condition.item && !condition.timeOfDay) return condition.item;
  if (condition.trigger === 'trade') return condition.heldItem ?? LINKING_CORD;
  if (condition.trigger === 'level-up' && condition.heldItem) return condition.heldItem; // Garra Afiada, Presa Afiada
  return null;
}

function findNode(root: EvolutionNode, speciesId: number): EvolutionNode | null {
  if (root.speciesId === speciesId) return root;
  for (const next of root.evolvesTo) {
    const found = findNode(next, speciesId);
    if (found) return found;
  }
  return null;
}

/**
 * Evoluções ao alcance do Pokémon: as de nível já cumpridas e as de item (pedra, troca por Cabo de Ligação ou objeto).
 * As de item sem o item na mochila aparecem com `ready: false` para o jogador saber o que falta.
 */
export function availableEvolutions(species: Species, state: EvolutionState, itemName?: (id: string) => string): EvolutionChoice[] {
  const node = findNode(species.evolutionChain, species.id);
  if (!node) return [];
  const names = itemName ?? titleCase;
  const choices: EvolutionChoice[] = [];
  for (const next of node.evolvesTo) {
    if (next.conditions.some((condition) => conditionMet(condition, state))) {
      choices.push({ speciesId: next.speciesId, requirement: describeConditions(next.conditions, names), item: null, ready: true, reason: null });
      continue;
    }
    const itemPath = next.conditions.map((condition) => ({ condition, item: itemFor(condition) })).find((entry) => entry.item !== null);
    if (!itemPath || !itemPath.item) continue;
    const owned = state.has ? state.has(itemPath.item) : false;
    choices.push({
      speciesId: next.speciesId,
      requirement: itemPath.condition.trigger === 'trade' && !itemPath.condition.heldItem ? `Troca (${names(itemPath.item)})` : `Usar ${names(itemPath.item)}`,
      item: itemPath.item,
      ready: owned,
      reason: owned ? null : `Falta ${names(itemPath.item)} (compre na Loja).`,
    });
  }
  return choices;
}
