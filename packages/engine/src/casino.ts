import type { Rng } from './rng.ts';

/**
 * Pokécassino: regras puras dos sete jogos (os números vêm do jogo antigo).
 * Todo multiplicador é o retorno TOTAL, entrada incluída: apostar 10 e receber 2× devolve 20.
 */

export const CASINO_GAMES = ['slots', 'roulette', 'voltorb', 'jack', 'race', 'wheel', 'piplup'] as const;
export type CasinoGame = (typeof CASINO_GAMES)[number];
export const CASINO_NAMES: Record<CasinoGame, string> = {
  slots: 'Caça-níqueis', roulette: 'Roleta', voltorb: 'Voltorb Flip', jack: 'Pokejack', race: 'Pokémon Race', wheel: 'Wheel of Fortune', piplup: 'Pula Piplup',
};
/** Quanto custa uma ficha em Pokédólares. */
export const CHIP_PRICE = 5;
export const MAX_BET = 1_000_000;

/** Jogos de várias etapas: a rodada fica salva até acabar. */
export const ROUND_GAMES: readonly CasinoGame[] = ['voltorb', 'jack', 'piplup'];

const shuffle = <T,>(list: T[], rng: Rng): T[] => {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
};

// ------------------------------------------------------------------------------------------------ caça-níqueis

export const SLOT_SYMBOLS = ['poke-ball', 'great-ball', 'ultra-ball', 'pikachu', 'mewtwo', 'mew', 'master-ball', 'ditto'] as const;
export type SlotSymbol = (typeof SLOT_SYMBOLS)[number];
export const SLOT_PAYS: Record<Exclude<SlotSymbol, 'ditto'>, number> = {
  'poke-ball': 0.5, 'great-ball': 1.5, 'ultra-ball': 3, pikachu: 5, mewtwo: 30, mew: 50, 'master-ball': 100,
};
/** Dois Ditto devolvem a aposta da linha; três pagam 4×. */
export const DITTO_PAIR = 1;
export const DITTO_TRIPLE = 4;

/** Fita de cada rolo (34 casas, sem espaços vazios); os pesos foram ajustados para um retorno médio de ~93%. */
export const SLOT_STRIP: readonly SlotSymbol[] = (() => {
  const counts: [SlotSymbol, number][] = [['poke-ball', 12], ['great-ball', 8], ['ultra-ball', 5], ['pikachu', 3], ['ditto', 2], ['mewtwo', 2], ['mew', 1], ['master-ball', 1]];
  const left = counts.map(([, n]) => n);
  const strip: SlotSymbol[] = [];
  // intercala os símbolos (rodadas da lista), para que iguais não fiquem lado a lado
  while (strip.length < 34) counts.forEach(([symbol], i) => { if ((left[i] as number) > 0) { strip.push(symbol); left[i] = (left[i] as number) - 1; } });
  return strip;
})();

/** As oito linhas: 3 horizontais, 3 verticais e 2 diagonais (grade 3×3, índices 0–8 por linha). */
export const SLOT_LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6],
];

export interface SlotLine { line: number; symbol: SlotSymbol; multiplier: number }
export interface SlotSpin { grid: SlotSymbol[]; lines: SlotLine[]; multiplier: number }

export function scoreLine(cells: readonly SlotSymbol[]): { symbol: SlotSymbol; multiplier: number } | null {
  const dittos = cells.filter((s) => s === 'ditto').length;
  if (dittos === 3) return { symbol: 'ditto', multiplier: DITTO_TRIPLE };
  if (dittos === 2) return { symbol: 'ditto', multiplier: DITTO_PAIR };
  const real = cells.filter((s) => s !== 'ditto') as Exclude<SlotSymbol, 'ditto'>[];
  const first = real[0];
  if (first && real.every((s) => s === first)) return { symbol: first, multiplier: SLOT_PAYS[first] };
  return null;
}

export function spinSlots(rng: Rng): SlotSpin {
  // cada rolo mostra três símbolos seguidos da fita; grade[linha*3 + rolo]
  const offsets = [0, 1, 2].map(() => rng.int(SLOT_STRIP.length));
  const grid: SlotSymbol[] = [];
  for (let row = 0; row < 3; row++) for (let reel = 0; reel < 3; reel++) grid.push(SLOT_STRIP[((offsets[reel] as number) + row) % SLOT_STRIP.length] as SlotSymbol);
  const lines: SlotLine[] = [];
  SLOT_LINES.forEach((cells, line) => {
    const scored = scoreLine(cells.map((i) => grid[i] as SlotSymbol));
    if (scored) lines.push({ line, ...scored });
  });
  return { grid, lines, multiplier: lines.reduce((sum, entry) => sum + entry.multiplier, 0) };
}

// ------------------------------------------------------------------------------------------------ roleta

export const RED_NUMBERS: ReadonlySet<number> = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export type RouletteColor = 'red' | 'black' | 'green';
export const colorOf = (n: number): RouletteColor => (n === 0 ? 'green' : RED_NUMBERS.has(n) ? 'red' : 'black');
export type RouletteGroup = 'charmander' | 'squirtle' | 'bulbasaur' | 'pikachu' | 'mew';
export const GROUP_SPECIES: Record<RouletteGroup, number> = { charmander: 4, squirtle: 7, bulbasaur: 1, pikachu: 25, mew: 151 };
export function groupOf(n: number): RouletteGroup {
  if (n === 0) return 'mew';
  const red = RED_NUMBERS.has(n);
  if (n % 2 === 1) return red ? 'charmander' : 'squirtle';
  return red ? 'bulbasaur' : 'pikachu';
}

export type RouletteBet =
  | { kind: 'number'; value: number }
  | { kind: 'color'; value: 'red' | 'black' | 'green' }
  | { kind: 'parity'; value: 'odd' | 'even' }
  | { kind: 'half'; value: 'low' | 'high' }
  | { kind: 'dozen'; value: 1 | 2 | 3 }
  | { kind: 'group'; value: RouletteGroup };

export function parseRouletteBet(input: unknown): RouletteBet | null {
  const bet = input as { kind?: unknown; value?: unknown } | null;
  if (!bet || typeof bet !== 'object') return null;
  switch (bet.kind) {
    case 'number': return Number.isInteger(bet.value) && (bet.value as number) >= 0 && (bet.value as number) <= 36 ? { kind: 'number', value: bet.value as number } : null;
    case 'color': return bet.value === 'red' || bet.value === 'black' || bet.value === 'green' ? { kind: 'color', value: bet.value } : null;
    case 'parity': return bet.value === 'odd' || bet.value === 'even' ? { kind: 'parity', value: bet.value } : null;
    case 'half': return bet.value === 'low' || bet.value === 'high' ? { kind: 'half', value: bet.value } : null;
    case 'dozen': return bet.value === 1 || bet.value === 2 || bet.value === 3 ? { kind: 'dozen', value: bet.value } : null;
    case 'group': return typeof bet.value === 'string' && bet.value in GROUP_SPECIES ? { kind: 'group', value: bet.value as RouletteGroup } : null;
    default: return null;
  }
}

/** Retorno total da aposta para o número sorteado (0 se perdeu). O zero fica fora de paridade, faixas e dúzias. */
export function roulettePayout(bet: RouletteBet, n: number): number {
  switch (bet.kind) {
    case 'number': return n === bet.value ? 36 : 0;
    case 'color': return colorOf(n) === bet.value ? (bet.value === 'green' ? 36 : 2) : 0;
    case 'parity': return n !== 0 && (n % 2 === 1) === (bet.value === 'odd') ? 2 : 0;
    case 'half': return n !== 0 && (n <= 18) === (bet.value === 'low') ? 2 : 0;
    case 'dozen': return n !== 0 && Math.ceil(n / 12) === bet.value ? 3 : 0;
    case 'group': return groupOf(n) === bet.value ? 4 : 0;
  }
}

export const spinRoulette = (rng: Rng): number => rng.int(37);

// ------------------------------------------------------------------------------------------------ Voltorb Flip

export const VOLTORB_SIZE = 6;
export const VOLTORB_MAX_PICKS = 6;
export const VOLTORB_LINE_BONUS = 1.5;
/** 36 cartas: 6 Voltorbs (0×), 10×0,25, 9×0,5, 5×1,2, 3×1,5, 2×2 e 1×5. */
export const VOLTORB_CARDS: readonly number[] = [
  ...Array<number>(6).fill(0), ...Array<number>(10).fill(0.25), ...Array<number>(9).fill(0.5), ...Array<number>(5).fill(1.2),
  ...Array<number>(3).fill(1.5), 2, 2, 5,
];

export interface VoltorbState { stake: number; board: number[]; revealed: number[] }

export const newVoltorb = (rng: Rng): number[] => shuffle([...VOLTORB_CARDS], rng);

/** Uma linha ou coluna inteira virada ganha o bônus de 1,5×; diagonais não contam. */
export function voltorbMultiplier(state: VoltorbState): number {
  const sum = state.revealed.reduce((total, index) => total + (state.board[index] as number), 0);
  const open = new Set(state.revealed);
  let line = false;
  for (let k = 0; k < VOLTORB_SIZE && !line; k++) {
    const row = Array.from({ length: VOLTORB_SIZE }, (_, c) => k * VOLTORB_SIZE + c);
    const col = Array.from({ length: VOLTORB_SIZE }, (_, r) => r * VOLTORB_SIZE + k);
    if (row.every((i) => open.has(i)) || col.every((i) => open.has(i))) line = true;
  }
  return sum * (line ? VOLTORB_LINE_BONUS : 1);
}

// ------------------------------------------------------------------------------------------------ Pokejack

export interface Card { rank: string; suit: string }
export const SUITS = ['♠', '♥', '♦', '♣'] as const;
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
export const newDeck = (rng: Rng): Card[] => shuffle(SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit }))), rng);

/** Ás vale 1 ou 11, figuras 10. */
export function handValue(hand: readonly Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    if (card.rank === 'A') { aces++; total += 1; } else total += ['J', 'Q', 'K'].includes(card.rank) ? 10 : Number(card.rank);
  }
  let soft = false;
  if (aces > 0 && total + 10 <= 21) { total += 10; soft = true; }
  return { total, soft };
}
export const isNatural = (hand: readonly Card[]): boolean => hand.length === 2 && handValue(hand).total === 21;

export const JACK_WIN = 2;
export const JACK_NATURAL = 3;
export const DEALER_STANDS = 17;

export interface JackState {
  stake: number;
  deck: Card[];
  player: Card[];
  dealer: Card[];
  doubled: boolean;
  /** terminou? */
  done: boolean;
  /** retorno total relativo à entrada simples (0, 1, 2, 3 ou, com dobrar, 0/2/4) */
  result: 'blackjack' | 'win' | 'push' | 'lose' | null;
}

export function dealJack(stake: number, rng: Rng): JackState {
  const deck = newDeck(rng);
  const state: JackState = { stake, deck, player: [deck.pop() as Card, deck.pop() as Card], dealer: [deck.pop() as Card, deck.pop() as Card], doubled: false, done: false, result: null };
  if (isNatural(state.player) || isNatural(state.dealer)) finishJack(state);
  return state;
}

/** A banca compra até 17 (para em 17, inclusive soft) e compara. */
export function finishJack(state: JackState): void {
  const player = handValue(state.player).total;
  if (isNatural(state.player) || isNatural(state.dealer)) {
    state.result = isNatural(state.player) && isNatural(state.dealer) ? 'push' : isNatural(state.player) ? 'blackjack' : 'lose';
  } else if (player > 21) {
    state.result = 'lose';
  } else {
    while (handValue(state.dealer).total < DEALER_STANDS) state.dealer.push(state.deck.pop() as Card);
    const dealer = handValue(state.dealer).total;
    state.result = dealer > 21 || player > dealer ? 'win' : player === dealer ? 'push' : 'lose';
  }
  state.done = true;
}

export function jackHit(state: JackState): void {
  state.player.push(state.deck.pop() as Card);
  if (handValue(state.player).total >= 21) finishJack(state);
}
export function jackDouble(state: JackState): void {
  state.doubled = true;
  state.player.push(state.deck.pop() as Card);
  finishJack(state);
}

/** Retorno total em múltiplos da entrada simples (dobrar paga o dobro, pois debitou duas entradas). */
export function jackMultiplier(state: JackState): number {
  const base = state.result === 'blackjack' ? JACK_NATURAL : state.result === 'win' ? JACK_WIN : state.result === 'push' ? 1 : 0;
  return base * (state.doubled ? 2 : 1);
}

// ------------------------------------------------------------------------------------------------ Pokémon Race

export const RACE_RUNNERS = [25, 78, 59, 135, 291] as const; // Pikachu, Rapidash, Arcanine, Jolteon, Ninjask
export const RACE_LENGTH = 100;
export const RACE_PAYOUT = 6;
export interface RaceResult { frames: number[][]; winner: number }

/** Cada passo move um corredor de 1 a 5; vence quem cruzar primeiro (empate: sorteio entre os líderes). */
export function runRace(rng: Rng): RaceResult {
  const positions: number[] = RACE_RUNNERS.map(() => 0);
  const frames: number[][] = [[...positions]];
  while (Math.max(...positions) < RACE_LENGTH) {
    for (let i = 0; i < positions.length; i++) positions[i] = (positions[i] as number) + 1 + rng.int(5);
    frames.push(positions.map((p) => Math.min(RACE_LENGTH, p)));
  }
  const best = Math.max(...positions);
  const leaders = positions.flatMap((p, i) => (p === best ? [i] : []));
  return { frames, winner: leaders[rng.int(leaders.length)] as number };
}

// ------------------------------------------------------------------------------------------------ Wheel of Fortune

/** Multiplicadores e sua fatia da roda (50 casas): 20%, 18%, 18%, 20%, 16%, 6% e 2%. */
export const WHEEL_SEGMENTS: readonly { multiplier: number; cells: number }[] = [
  { multiplier: 0, cells: 10 }, { multiplier: 0.25, cells: 9 }, { multiplier: 0.5, cells: 9 }, { multiplier: 1, cells: 10 },
  { multiplier: 2, cells: 8 }, { multiplier: 5, cells: 3 }, { multiplier: 10, cells: 1 },
];
/** Roda desenhada: as casas intercaladas para não ficarem todas juntas. */
export const WHEEL_LAYOUT: readonly number[] = (() => {
  const left = WHEEL_SEGMENTS.map((s) => s.cells);
  const out: number[] = [];
  while (out.length < 50) WHEEL_SEGMENTS.forEach((s, i) => { if ((left[i] as number) > 0) { out.push(s.multiplier); left[i] = (left[i] as number) - 1; } });
  return out;
})();
export const spinWheel = (rng: Rng): { index: number; multiplier: number } => {
  const index = rng.int(WHEEL_LAYOUT.length);
  return { index, multiplier: WHEEL_LAYOUT[index] as number };
};

// ------------------------------------------------------------------------------------------------ Pula Piplup

/** Retorno acumulado e chance de sucesso de cada um dos sete saltos. */
export const PIPLUP_PAYS: readonly number[] = [1, 1.1, 1.5, 2, 2.5, 3.5, 5];
export const PIPLUP_ODDS: readonly number[] = [90, 85, 80, 80, 75, 70, 65];
export interface PiplupState { stake: number; jumps: number }
export const piplupJump = (state: PiplupState, rng: Rng): 'safe' | 'fall' => {
  const ok = rng.int(100) < (PIPLUP_ODDS[state.jumps] as number);
  if (ok) state.jumps += 1;
  return ok ? 'safe' : 'fall';
};
export const piplupMultiplier = (jumps: number): number => (jumps === 0 ? 0 : (PIPLUP_PAYS[jumps - 1] as number));

// ------------------------------------------------------------------------------------------------ valor de um Pokémon apostado

export interface BetValueInput {
  level: number;
  ball: string | null;
  ballPrice: number | null;
  legendary: boolean;
  shiny: boolean;
  ivMultiplier: number;
}
/** Valor de venda usado na aposta de Pokémon (mesma conta do mercado do jogo antigo). */
export function pokemonValue(input: BetValueInput): number {
  const ballValue = input.ball === 'master-ball' ? input.level * 20 : (input.ballPrice ?? 200) / 2 + input.level * 10;
  return Math.floor(ballValue * (input.legendary ? 3 : 1) * (input.shiny ? 10 : 1) * input.ivMultiplier);
}
/** Prêmio em Pokédólares de uma aposta de Pokémon: só há prêmio acima de 1× (o Pokémon fica); abaixo de 1× ele é perdido. */
export const pokemonPrize = (value: number, multiplier: number): number => (multiplier > 1 ? Math.floor(value * (multiplier - 1)) : 0);
