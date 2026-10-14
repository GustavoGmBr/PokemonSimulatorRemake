import type { Rng } from './rng.ts';
import type { TypeName } from './types.ts';

/** Chance base de um Pokémon selvagem ser brilhante: 1 em 4096. */
export const SHINY_ODDS = 4096;

/** Sorteia o brilho. Cada "rolagem" extra (Amuleto Brilhante) é mais uma chance de 1/4096. */
export function rollShiny(rng: Rng, extraRolls = 0): boolean {
  for (let i = 0; i <= extraRolls; i++) if (rng.int(SHINY_ODDS) === 0) return true;
  return false;
}

/** Amuleto Brilhante = 2 rolagens extras (1/1365 no total). */
export const SHINY_CHARM_EXTRA_ROLLS = 2;
/** Amuleto de Captura multiplica o valor de captura. */
export const CATCHING_CHARM_MULTIPLIER = 1.5;

export interface BallContext {
  level: number;
  types: readonly TypeName[];
  baseSpeed: number;
  /** a espécie já foi capturada neste save */
  caughtBefore: boolean;
  /** hora local (0–23), para a Bola Crepúsculo */
  hour: number;
}

/** Bolas sem multiplicador especial valem 1. A Master Ball nem chega aqui (captura garantida). */
export function ballMultiplier(ball: string, context: BallContext): number {
  switch (ball) {
    case 'great-ball': return 1.5;
    case 'ultra-ball': return 2;
    case 'net-ball': return context.types.includes('water') || context.types.includes('bug') ? 3.5 : 1;
    case 'dive-ball': return context.types.includes('water') ? 3.5 : 1;
    case 'nest-ball': return Math.max(1, (41 - context.level) / 10);
    case 'repeat-ball': return context.caughtBefore ? 3.5 : 1;
    case 'quick-ball': return 5; // sempre é o primeiro turno: não há batalha antes
    case 'dusk-ball': return context.hour < 6 || context.hour >= 20 ? 3 : 1;
    case 'fast-ball': return context.baseSpeed >= 100 ? 4 : 1;
    default: return 1; // poke, premier, luxury, heal, timer…
  }
}

export interface CaptureInput {
  maxHp: number;
  currentHp: number;
  captureRate: number;
  ball: string;
  context: BallContext;
  /** multiplicador de status (1, 1.5 para veneno/paralisia/queimadura, 2 para sono/congelamento) */
  statusMultiplier?: number;
  catchingCharm?: boolean;
}

/** Valor "a" da fórmula de captura (gerações 3–4). 255 ou mais captura sempre. */
export function captureValue(input: CaptureInput): number {
  if (input.ball === 'master-ball') return 255;
  const { maxHp, currentHp } = input;
  const multiplier = ballMultiplier(input.ball, input.context) * (input.catchingCharm ? CATCHING_CHARM_MULTIPLIER : 1);
  const raw = (((3 * maxHp - 2 * currentHp) * input.captureRate * multiplier) / (3 * maxHp)) * (input.statusMultiplier ?? 1);
  return Math.max(1, Math.min(255, Math.floor(raw)));
}

/** Limite de cada um dos 4 testes de balanço, de 0 a 65535. */
export function shakeThreshold(a: number): number {
  if (a >= 255) return 65536;
  return Math.floor(1048560 / Math.sqrt(Math.sqrt(16711680 / a)));
}

/** Chance total de captura (0 a 1) — as quatro checagens precisam passar. */
export function captureChance(input: CaptureInput): number {
  const a = captureValue(input);
  if (a >= 255) return 1;
  return (shakeThreshold(a) / 65536) ** 4;
}

export interface CaptureResult {
  /** balanços que a bola dá antes de abrir (0 a 3) */
  shakes: 0 | 1 | 2 | 3;
  caught: boolean;
}

export function attemptCapture(rng: Rng, input: CaptureInput): CaptureResult {
  const a = captureValue(input);
  if (a >= 255) return { shakes: 3, caught: true };
  const threshold = shakeThreshold(a);
  for (let check = 0; check < 4; check++) {
    if (rng.int(65536) >= threshold) return { shakes: Math.min(check, 3) as 0 | 1 | 2 | 3, caught: false };
  }
  return { shakes: 3, caught: true };
}
