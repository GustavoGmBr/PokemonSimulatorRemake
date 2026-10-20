import type { Move, MoveSlot, PokemonInstance, Species, Stats, TypeName } from './types.ts';
import { effectiveness, type TypeChart } from './typechart.ts';
import { resumableRng, type Rng } from './rng.ts';
import { expForLevel, levelForExp, levelProgress, MAX_LEVEL } from './experience.ts';
import { stageMultiplier } from './stats.ts';
import { isUsableMove, statsOf } from './pokemon.ts';
import { typesOf } from './transform.ts';

/**
 * Motor de batalha: funções puras sobre um estado serializável.
 * `chooseAction(estado, ação, contexto)` devolve o novo estado e a lista de eventos que a tela anima.
 * Toda a aleatoriedade vem do `rng` guardado no estado: mesma semente + mesmas ações = mesma batalha.
 */

export type Ailment = 'burn' | 'poison' | 'paralysis' | 'sleep' | 'freeze';
export type StatusKind = Ailment | 'confusion';
export type StageKey = 'atk' | 'def' | 'spa' | 'spd' | 'spe' | 'acc' | 'eva';
export const STAGE_KEYS: readonly StageKey[] = ['atk', 'def', 'spa', 'spd', 'spe', 'acc', 'eva'];
export const STAGE_LABELS: Record<StageKey, string> = {
  atk: 'Ataque', def: 'Defesa', spa: 'Ataque especial', spd: 'Defesa especial', spe: 'Velocidade', acc: 'Precisão', eva: 'Esquiva',
};
export const STATUS_LABELS: Record<StatusKind, string> = {
  burn: 'queimadura', poison: 'envenenamento', paralysis: 'paralisia', sleep: 'sono', freeze: 'congelamento', confusion: 'confusão',
};
export type SideKey = 'player' | 'foe';

const STAGE_OF_API: Record<string, StageKey> = {
  attack: 'atk', defense: 'def', 'special-attack': 'spa', 'special-defense': 'spd', speed: 'spe', accuracy: 'acc', evasion: 'eva',
};
/** Golpes de dano cujas quedas de atributo recaem sobre o próprio usuário. */
const SELF_DEBUFF = new Set([
  'close-combat', 'superpower', 'overheat', 'draco-meteor', 'leaf-storm', 'psycho-boost', 'fleur-cannon', 'v-create',
  'hammer-arm', 'dragon-ascent', 'clanging-scales', 'armor-cannon', 'scale-shot', 'make-it-rain', 'spin-out', 'headlong-rush',
]);
const IMMUNE_TO: Record<Ailment, TypeName[]> = {
  burn: ['fire'], poison: ['poison', 'steel'], paralysis: ['electric'], sleep: [], freeze: ['ice'],
};
const AILMENTS: readonly string[] = ['burn', 'poison', 'paralysis', 'sleep', 'freeze'];
const CRIT_DENOMINATOR = [24, 8, 2, 1];

export interface Combatant {
  /** id do Pokémon no save (vazio para selvagens) */
  ref: string;
  speciesId: number;
  name: string;
  level: number;
  exp: number;
  shiny: boolean;
  /** forma permanente (Mega, Primal…), se tiver */
  form?: string | null;
  types: TypeName[];
  ivs: Stats;
  stats: Stats;
  hp: number;
  moves: MoveSlot[];
  /** golpes que subiram de nível mas esperam uma vaga (escolhidos no perfil) */
  pendingMoves: string[];
  status: Ailment | null;
  sleepTurns: number;
  confusion: number;
  flinch: boolean;
  stages: Record<StageKey, number>;
  friendship: number;
  /** já esteve em campo nesta batalha */
  fought: boolean;
  /** nível reduzido pelo limite do desafio: não ganha XP e não muda no save */
  capped?: boolean;
}

export interface BattleSide {
  team: Combatant[];
  active: number;
}

export type BattlePhase = 'choose' | 'replace' | 'ended';
export type BattleResult = 'win' | 'lose' | 'fled' | 'captured';

/** Item de cura que o treinador carrega. `heal` = HP recuperado (9999 = tudo). */
/** Máximo de itens que um treinador usa numa mesma batalha. */
export const MAX_FOE_ITEMS = 5;
/** Itens que ainda podem ser usados: o que sobrou na bolsa, limitado ao teto da batalha. */
export function foeItemsLeft(trainer: Pick<TrainerInfo, 'bag' | 'itemsUsed'>): number {
  const stock = trainer.bag.reduce((total, item) => total + Math.max(0, item.qty), 0);
  return Math.max(0, Math.min(stock, MAX_FOE_ITEMS - (trainer.itemsUsed ?? 0)));
}

export interface FoeBagItem { item: string; name: string; heal: number; cures: boolean; qty: number }

export interface TrainerInfo {
  name: string;
  /** "Líder de Ginásio", "Elite dos 4"… */
  title: string;
  /** 1 = básico, 2 = escolhe pela efetividade e usa itens, 3 = também troca de Pokémon e acerta quase sempre o melhor golpe */
  skill: 1 | 2 | 3;
  bag: FoeBagItem[];
  /** itens já usados nesta batalha (teto: MAX_FOE_ITEMS) */
  itemsUsed?: number;
  /** turno da última troca (para não ficar trocando sem parar) */
  lastSwitch: number;
  /** desafio em disputa (`kanto:gym1`…); ausente nos treinadores aleatórios */
  challengeId?: string;
  /** treinador aleatório: dificuldade, dinheiro fixo e prêmios */
  difficulty?: string;
  money?: number;
  rewards?: { item: string; quantity: number }[];
  /** batalha de torneio: copa e rodada */
  tournament?: { tier: string; round: number };
  /** Novo Ciclo: id do desafio (`ng:...`) e se é a primeira vitória */
  ng?: { id: string; first: boolean };
}

export interface BattleState {
  kind: 'wild' | 'trainer';
  trainer?: TrainerInfo | null;
  turn: number;
  phase: BattlePhase;
  result: BattleResult | null;
  rng: number;
  runAttempts: number;
  player: BattleSide;
  foe: BattleSide;
}

export type BattleEvent = { text: string } & (
  | { k: 'text' }
  | { k: 'send'; side: SideKey; index: number }
  | { k: 'move'; side: SideKey; move: string; moveName: string; type: TypeName; category: Move['category'] }
  | { k: 'miss'; side: SideKey }
  | { k: 'hit'; side: SideKey; damage: number; hp: number; maxHp: number; effectiveness: number; crit: boolean; cause: 'move' | 'burn' | 'poison' | 'confusion' | 'recoil' }
  | { k: 'heal'; side: SideKey; amount: number; hp: number; maxHp: number }
  | { k: 'status'; side: SideKey; status: StatusKind }
  | { k: 'status-end'; side: SideKey; status: StatusKind }
  | { k: 'stage'; side: SideKey; stat: StageKey; change: number; value: number }
  | { k: 'faint'; side: SideKey }
  | { k: 'xp'; index: number; amount: number; exp: number; progress: number }
  | { k: 'level'; index: number; level: number; hp: number; maxHp: number; progress: number }
  | { k: 'learn'; index: number; move: string }
  | { k: 'ball'; ball: string; shakes: number; caught: boolean }
  | { k: 'run'; ok: boolean }
  | { k: 'money'; amount: number }
  | { k: 'end'; result: BattleResult }
);

export type BattleAction =
  | { kind: 'move'; slot: number }
  | { kind: 'switch'; to: number }
  /** o jogador gastou o turno com um item ou bola (o servidor aplica o efeito antes) */
  | { kind: 'pass'; text?: string }
  | { kind: 'run' };

export interface BattleContext {
  species(id: number): Species;
  moves: Map<string, Move>;
  chart: TypeChart;
  /** Lucky Egg etc. */
  expMultiplier?: number;
}

// ---------------------------------------------------------------------------------------------------------------------
// criação

export function emptyStages(): Record<StageKey, number> {
  return { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 };
}

export function combatantFrom(instance: PokemonInstance, species: Species, name: string, ref = ''): Combatant {
  const stats = statsOf(instance, species);
  return {
    ref, speciesId: species.id, name, level: instance.level, exp: instance.exp, shiny: instance.shiny,
    types: typesOf(species, instance.form), form: instance.form, ivs: { ...instance.ivs }, stats, hp: Math.max(0, Math.min(stats.hp, instance.currentHp)),
    moves: instance.moves.map((slot) => ({ ...slot })), pendingMoves: [], status: null, sleepTurns: 0, confusion: 0,
    flinch: false, stages: emptyStages(), friendship: instance.friendship, fought: false,
  };
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const alive = (c: Combatant | undefined): c is Combatant => c !== undefined && c.hp > 0;
export const activeOf = (state: BattleState, side: SideKey): Combatant => {
  const s = state[side];
  return s.team[s.active] as Combatant;
};
const other = (side: SideKey): SideKey => (side === 'player' ? 'foe' : 'player');
const labelOf = (state: BattleState, side: SideKey, c: Combatant): string => {
  if (side !== 'foe') return c.name;
  if (state.kind === 'wild') return `${c.name} selvagem`;
  return state.trainer ? `${c.name} de ${state.trainer.name}` : c.name;
};

/** Começa uma batalha: o primeiro Pokémon vivo da equipe entra em campo. */
export function createBattle(input: { player: Combatant[]; foe: Combatant[]; seed: number; kind?: 'wild' | 'trainer'; trainer?: TrainerInfo }): { state: BattleState; events: BattleEvent[] } {
  const lead = input.player.findIndex((c) => c.hp > 0);
  if (lead < 0) throw new Error('Nenhum Pokémon da equipe pode lutar.');
  if (input.foe.length === 0) throw new Error('Sem oponente.');
  const state: BattleState = {
    kind: input.kind ?? 'wild', trainer: input.trainer ?? null, turn: 0, phase: 'choose', result: null, rng: input.seed >>> 0, runAttempts: 0,
    player: { team: input.player, active: lead }, foe: { team: input.foe, active: 0 },
  };
  (state.player.team[lead] as Combatant).fought = true;
  const foe = activeOf(state, 'foe');
  const me = activeOf(state, 'player');
  const events: BattleEvent[] = state.kind === 'trainer' && state.trainer
    ? [
      { k: 'text', text: `${state.trainer.title ? `${state.trainer.title} ` : ''}${state.trainer.name} quer batalhar!` },
      { k: 'send', side: 'foe', index: 0, text: `${state.trainer.name} enviou ${foe.name}!` },
      { k: 'send', side: 'player', index: lead, text: `Vai, ${me.name}!` },
    ]
    : [
      { k: 'send', side: 'foe', index: 0, text: `Um ${foe.name} selvagem apareceu!` },
      { k: 'send', side: 'player', index: lead, text: `Vai, ${me.name}!` },
    ];
  return { state, events };
}

// ---------------------------------------------------------------------------------------------------------------------
// utilidades de combate

function effectiveSpeed(c: Combatant): number {
  return Math.max(1, Math.floor(c.stats.spe * stageMultiplier(c.stages.spe) * (c.status === 'paralysis' ? 0.5 : 1)));
}

function accuracyStage(stage: number): number {
  return stage >= 0 ? (3 + stage) / 3 : 3 / (3 - stage);
}

export function damageRange(attacker: Combatant, defender: Combatant, move: Move, chart: TypeChart): { min: number; max: number; effectiveness: number } {
  const one = (roll: number) => rawDamage(attacker, defender, move, chart, roll, false).damage;
  const eff = effectiveness(chart, move.type, defender.types);
  return { min: one(85), max: one(100), effectiveness: eff };
}

function rawDamage(attacker: Combatant, defender: Combatant, move: Move, chart: TypeChart, roll: number, crit: boolean): { damage: number; effectiveness: number } {
  const eff = effectiveness(chart, move.type, defender.types);
  if (eff === 0) return { damage: 0, effectiveness: 0 };
  const physical = move.category === 'physical';
  const atkKey: StageKey = physical ? 'atk' : 'spa';
  const defKey: StageKey = physical ? 'def' : 'spd';
  // crítico ignora quedas do atacante e aumentos do defensor
  const atkStage = crit ? Math.max(0, attacker.stages[atkKey]) : attacker.stages[atkKey];
  const defStage = crit ? Math.min(0, defender.stages[defKey]) : defender.stages[defKey];
  const atk = Math.max(1, Math.floor(attacker.stats[physical ? 'atk' : 'spa'] * stageMultiplier(atkStage)));
  const def = Math.max(1, Math.floor(defender.stats[physical ? 'def' : 'spd'] * stageMultiplier(defStage)));
  let damage = Math.floor(Math.floor((Math.floor((2 * attacker.level) / 5) + 2) * move.power * atk / def) / 50) + 2;
  if (crit) damage = Math.floor(damage * 1.5);
  damage = Math.floor((damage * roll) / 100);
  if (attacker.types.includes(move.type)) damage = Math.floor(damage * 1.5);
  damage = Math.floor(damage * eff);
  if (attacker.status === 'burn' && physical) damage = Math.floor(damage / 2);
  return { damage: Math.max(1, damage), effectiveness: eff };
}

const STRUGGLE: Move = {
  id: 0, name: 'struggle', displayName: 'Struggle', type: 'normal', category: 'physical', power: 50, accuracy: null, pp: 1,
  priority: 0, target: 'random-opponent', ailment: null, ailmentChance: 0, flinchChance: 0, critRate: 0, drain: 0, healing: -25,
  minHits: null, maxHits: null, statChanges: [], statChance: 0,
};

type FoeChoice = { slot: number } | { struggle: true } | { switchTo: number } | { item: number };

function usableSlots(c: Combatant): number[] {
  // Sem PP: todos os golpes ficam sempre disponíveis.
  return c.moves.map((_, i) => i);
}

interface Scored { slot: number; score: number; ko: boolean; priority: number }

/** Pontua cada golpe de `me` contra `target` (dano esperado pela efetividade, KO, status úteis). */
function scoreMoves(me: Combatant, target: Combatant, ctx: BattleContext): Scored[] {
  return usableSlots(me).map((slot) => {
    const move = ctx.moves.get((me.moves[slot] as MoveSlot).name);
    if (!move) return { slot, score: 1, ko: false, priority: 0 };
    let score: number;
    let ko = false;
    if (move.category !== 'status') {
      const range = damageRange(me, target, move, ctx.chart);
      const hits = move.minHits ? (move.minHits + (move.maxHits ?? move.minHits)) / 2 : 1;
      const accuracy = (move.accuracy ?? 100) / 100;
      score = ((range.min + range.max) / 2) * hits * accuracy;
      ko = range.max * hits >= target.hp && range.effectiveness > 0;
      if (ko) score += 10_000 + move.priority * 500;
    } else if (move.healing > 0) score = me.hp < me.stats.hp / 2 ? 60 : 0;
    else if (move.ailment && AILMENTS.includes(move.ailment) && !target.status) score = 25;
    else if (move.ailment === 'confusion' && target.confusion === 0) score = 18;
    else if (move.statChanges.length > 0) {
      const onSelf = move.target === 'user';
      const useful = move.statChanges.some((change) => {
        const key = STAGE_OF_API[change.stat] as StageKey;
        const stage = (onSelf ? me : target).stages[key];
        return onSelf ? change.change > 0 && stage < 2 : change.change < 0 && stage > -2;
      });
      score = useful ? 15 : 0;
    } else score = 0;
    return { slot, score, ko, priority: move.priority };
  });
}

/** Melhor efetividade de um conjunto de tipos de golpe contra os tipos dados (0 se nenhum causa dano). */
function bestEffectiveness(moveTypes: TypeName[], defender: TypeName[], chart: TypeChart): number {
  return moveTypes.reduce((best, type) => Math.max(best, effectiveness(chart, type, defender)), 0);
}

function damagingTypes(c: Combatant, ctx: BattleContext): TypeName[] {
  const types: TypeName[] = [];
  for (const slot of c.moves) {
    const move = ctx.moves.get(slot.name);
    if (move && move.category !== 'status' && move.power > 0) types.push(move.type);
  }
  return types.length > 0 ? types : [...c.types];
}

/** Quão bom é `c` contra `target`: ataque que ele tem menos o perigo que corre, mais a saúde. */
function matchup(c: Combatant, target: Combatant, ctx: BattleContext): number {
  const offense = bestEffectiveness(damagingTypes(c, ctx), target.types, ctx.chart);
  const danger = bestEffectiveness(damagingTypes(target, ctx), c.types, ctx.chart);
  return offense - danger * 1.2 + c.hp / c.stats.hp;
}

/** Quem entra depois que o Pokémon do treinador cai: o melhor contra o que está em campo. */
function nextFoe(state: BattleState, ctx: BattleContext): number {
  const candidates = state.foe.team.map((c, i) => ({ c, i })).filter(({ c }) => c.hp > 0);
  if (candidates.length === 0) return -1;
  if (state.kind !== 'trainer' || (state.trainer?.skill ?? 1) < 2) return (candidates[0] as { i: number }).i;
  const target = activeOf(state, 'player');
  candidates.sort((a, b) => matchup(b.c, target, ctx) - matchup(a.c, target, ctx));
  return (candidates[0] as { i: number }).i;
}

function chooseMove(scores: Scored[], skill: 1 | 2 | 3, rng: Rng): FoeChoice {
  if (scores.length === 0) return { struggle: true };
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  if (skill === 3) return { slot: (sorted[0] as Scored).slot };
  if (skill === 2) return { slot: ((rng.int(5) === 0 ? sorted[1] : undefined) ?? (sorted[0] as Scored)).slot };
  const top = sorted.slice(0, Math.min(2, sorted.length));
  const best = top[0]?.score ?? 0;
  const pool = top.filter((o) => o.score >= best * 0.6);
  return { slot: (pool[rng.int(pool.length)] ?? (sorted[0] as Scored)).slot };
}

/**
 * IA do oponente. Selvagem: pontua os golpes e sorteia entre os dois melhores. Treinador: escolhe pela efetividade,
 * garante KO quando pode, usa itens de cura com pouco HP e troca de Pokémon quando está em desvantagem.
 */
function foeChoice(state: BattleState, ctx: BattleContext, rng: Rng): FoeChoice {
  const me = activeOf(state, 'foe');
  const target = activeOf(state, 'player');
  const scores = scoreMoves(me, target, ctx);
  const trainer = state.kind === 'trainer' ? state.trainer : null;
  if (!trainer) return chooseMove(scores, 1, rng);

  const skill = trainer.skill;
  const canKo = scores.some((o) => o.ko);
  const quicker = effectiveSpeed(me) > effectiveSpeed(target) || scores.some((o) => o.ko && o.priority > 0);
  if (!(canKo && quicker)) {
    // 1) item de cura
    const fraction = me.hp / me.stats.hp;
    const chance = skill === 1 ? 40 : skill === 2 ? 70 : 100;
    const wantsHeal = fraction < (skill === 1 ? 0.2 : 0.35) || (skill >= 2 && me.status !== null && fraction < 0.7);
    if (wantsHeal && foeItemsLeft(trainer) > 0 && rng.int(100) < chance) {
      const usable = trainer.bag
        .map((b, index) => ({ b, index }))
        .filter(({ b }) => b.qty > 0 && (b.heal >= me.stats.hp * 0.3 || (b.cures && me.status !== null)))
        .sort((a, b) => a.b.heal - b.b.heal);
      const pick = usable.find(({ b }) => me.hp + b.heal >= me.stats.hp * 0.6) ?? usable[usable.length - 1];
      if (pick) return { item: pick.index };
    }
    // 2) troca quando está em desvantagem
    const bench = state.foe.team.map((c, i) => ({ c, i })).filter(({ c, i }) => c.hp > 0 && i !== state.foe.active);
    if (skill >= 2 && bench.length > 0 && state.turn - trainer.lastSwitch >= 3) {
      const offense = bestEffectiveness(damagingTypes(me, ctx), target.types, ctx.chart);
      const danger = bestEffectiveness(damagingTypes(target, ctx), me.types, ctx.chart);
      const crippled = me.stages.atk <= -2 || me.stages.spa <= -2 || me.status === 'sleep' || me.status === 'freeze';
      const bad = (danger >= 2 && offense <= 1) || offense === 0 || crippled;
      if (bad && (skill === 3 || rng.int(2) === 0)) {
        const here = matchup(me, target, ctx);
        const best = bench.map(({ c, i }) => ({ i, value: matchup(c, target, ctx) })).sort((a, b) => b.value - a.value)[0];
        if (best && best.value > here + 1) return { switchTo: best.i };
      }
    }
  }
  return chooseMove(scores, skill, rng);
}

// ---------------------------------------------------------------------------------------------------------------------
// execução

interface Run {
  state: BattleState;
  ctx: BattleContext;
  rng: Rng;
  events: BattleEvent[];
  /** quem já teve o desmaio tratado neste turno */
  fainted: Set<Combatant>;
  /** duplas: golpe que atinge vários alvos causa só uma fração do dano */
  spread?: number;
  /** duplas: já preparou o golpe (canAct e anúncio) para o primeiro alvo */
  skipPrep?: boolean;
}

const push = (run: Run, event: BattleEvent) => { run.events.push(event); };
const done = (run: Run) => run.state.phase === 'ended';

function setHp(c: Combatant, hp: number) {
  c.hp = Math.max(0, Math.min(c.stats.hp, hp));
}

function dealDamage(run: Run, side: SideKey, amount: number, cause: 'move' | 'burn' | 'poison' | 'confusion' | 'recoil', text: string, extra: { effectiveness?: number; crit?: boolean } = {}) {
  const target = activeOf(run.state, side);
  const dealt = Math.min(target.hp, amount);
  setHp(target, target.hp - dealt);
  push(run, { k: 'hit', side, damage: dealt, hp: target.hp, maxHp: target.stats.hp, effectiveness: extra.effectiveness ?? 1, crit: extra.crit ?? false, cause, text });
  return dealt;
}

function healBy(run: Run, side: SideKey, amount: number, text: string) {
  const target = activeOf(run.state, side);
  const gained = Math.min(target.stats.hp - target.hp, amount);
  if (gained <= 0) return 0;
  setHp(target, target.hp + gained);
  push(run, { k: 'heal', side, amount: gained, hp: target.hp, maxHp: target.stats.hp, text });
  return gained;
}

function changeStage(run: Run, side: SideKey, stat: StageKey, change: number) {
  const target = activeOf(run.state, side);
  const before = target.stages[stat];
  const next = Math.max(-6, Math.min(6, before + change));
  const who = labelOf(run.state, side, target);
  if (next === before) {
    push(run, { k: 'text', text: `${STAGE_LABELS[stat]} de ${who} não pode ${change > 0 ? 'subir' : 'baixar'} mais!` });
    return;
  }
  target.stages[stat] = next;
  const size = Math.abs(change) >= 3 ? ' drasticamente' : Math.abs(change) === 2 ? ' bastante' : '';
  push(run, { k: 'stage', side, stat, change: next - before, value: next, text: `${STAGE_LABELS[stat]} de ${who} ${change > 0 ? 'subiu' : 'baixou'}${size}!` });
}

function tryAilment(run: Run, side: SideKey, ailment: string, quiet: boolean): boolean {
  const target = activeOf(run.state, side);
  const who = labelOf(run.state, side, target);
  if (ailment === 'confusion') {
    if (target.confusion > 0) { if (!quiet) push(run, { k: 'text', text: `${who} já está confuso!` }); return false; }
    target.confusion = 2 + run.rng.int(4);
    push(run, { k: 'status', side, status: 'confusion', text: `${who} ficou confuso!` });
    return true;
  }
  if (!AILMENTS.includes(ailment)) return false;
  const kind = ailment as Ailment;
  if (target.status) { if (!quiet) push(run, { k: 'text', text: `${who} já tem um problema de status!` }); return false; }
  if (target.types.some((type) => IMMUNE_TO[kind].includes(type))) { if (!quiet) push(run, { k: 'text', text: `Não afeta ${who}...` }); return false; }
  target.status = kind;
  target.sleepTurns = kind === 'sleep' ? 1 + run.rng.int(3) : 0;
  const text: Record<Ailment, string> = {
    burn: `${who} se queimou!`, poison: `${who} foi envenenado!`, paralysis: `${who} está paralisado! Pode não conseguir atacar.`,
    sleep: `${who} caiu no sono!`, freeze: `${who} congelou!`,
  };
  push(run, { k: 'status', side, status: kind, text: text[kind] });
  return true;
}

/** O Pokémon consegue agir neste turno? (sono, congelamento, paralisia, recuo, confusão) */
function canAct(run: Run, side: SideKey, move: Move | null): boolean {
  const me = activeOf(run.state, side);
  const who = labelOf(run.state, side, me);
  if (me.status === 'sleep') {
    me.sleepTurns -= 1;
    if (me.sleepTurns <= 0) {
      me.status = null;
      push(run, { k: 'status-end', side, status: 'sleep', text: `${who} acordou!` });
    } else {
      push(run, { k: 'text', text: `${who} está dormindo.` });
      return false;
    }
  }
  if (me.status === 'freeze') {
    if (run.rng.int(100) < 20 || move?.type === 'fire') {
      me.status = null;
      push(run, { k: 'status-end', side, status: 'freeze', text: `${who} descongelou!` });
    } else {
      push(run, { k: 'text', text: `${who} está congelado e não consegue se mexer.` });
      return false;
    }
  }
  if (me.flinch) {
    me.flinch = false;
    push(run, { k: 'text', text: `${who} recuou e não conseguiu atacar!` });
    return false;
  }
  if (me.confusion > 0) {
    me.confusion -= 1;
    if (me.confusion === 0) push(run, { k: 'status-end', side, status: 'confusion', text: `${who} não está mais confuso.` });
    else {
      push(run, { k: 'text', text: `${who} está confuso!` });
      if (run.rng.int(3) === 0) {
        const self: Move = { ...STRUGGLE, name: 'confusion-hit', power: 40, healing: 0 };
        const roll = 85 + run.rng.int(16);
        const hit = rawDamage({ ...me, types: [] }, me, self, run.ctx.chart, roll, false);
        dealDamage(run, side, hit.damage, 'confusion', `${who} se machucou na confusão!`);
        return false;
      }
    }
  }
  if (me.status === 'paralysis' && run.rng.int(4) === 0) {
    push(run, { k: 'text', text: `${who} está paralisado! Não consegue se mexer!` });
    return false;
  }
  return true;
}

function hitCount(move: Move, rng: Rng): number {
  if (!move.minHits || !move.maxHits || move.maxHits <= 1) return 1;
  if (move.minHits === move.maxHits) return move.minHits;
  if (move.minHits === 2 && move.maxHits === 5) {
    const roll = rng.int(20);
    return roll < 7 ? 2 : roll < 14 ? 3 : roll < 17 ? 4 : 5;
  }
  return move.minHits + rng.int(move.maxHits - move.minHits + 1);
}

function useMove(run: Run, side: SideKey, choice: { slot: number } | { struggle: true }): void {
  const { state, ctx, rng } = run;
  const me = activeOf(state, side);
  const foeSide = other(side);
  const who = labelOf(state, side, me);
  let move: Move;
  if ('struggle' in choice) move = ctx.moves.get('struggle') ?? STRUGGLE;
  else {
    const slot = me.moves[choice.slot];
    const found = slot ? ctx.moves.get(slot.name) : undefined;
    if (!slot || !found) { push(run, { k: 'text', text: `${who} não sabe usar esse golpe!` }); return; }
    move = found;
  }
  if (!run.skipPrep) {
    if (!canAct(run, side, move)) return;
    push(run, { k: 'move', side, move: move.name, moveName: move.displayName, type: move.type, category: move.category, text: `${who} usou ${move.displayName}!` });
  }

  const targetsSelf = move.target === 'user';
  const target = activeOf(state, foeSide);
  const targetWho = labelOf(state, foeSide, target);

  if (move.category === 'status') {
    // golpes de status com alvo no próprio usuário nunca erram
    if (!targetsSelf && move.accuracy !== null) {
      const chance = move.accuracy * accuracyStage(me.stages.acc - target.stages.eva);
      if (rng.int(100) >= chance) { push(run, { k: 'miss', side: foeSide, text: `${targetWho} desviou!` }); return; }
    }
    let acted = false;
    if (move.healing > 0) acted = healBy(run, side, Math.floor((me.stats.hp * move.healing) / 100), `${who} recuperou HP!`) > 0 || acted;
    if (move.healing > 0 && !acted) { push(run, { k: 'text', text: `O HP de ${who} já está cheio!` }); return; }
    if (move.ailment && (AILMENTS.includes(move.ailment) || move.ailment === 'confusion') && !targetsSelf) {
      acted = tryAilment(run, foeSide, move.ailment, false) || acted;
      if (!acted) return;
    }
    for (const change of move.statChanges) {
      const key = STAGE_OF_API[change.stat];
      if (!key) continue;
      changeStage(run, targetsSelf ? side : foeSide, key, change.change);
      acted = true;
    }
    if (!acted) push(run, { k: 'text', text: 'Mas nada aconteceu!' });
    return;
  }

  // golpe de dano
  const hits = hitCount(move, rng);
  let total = 0;
  let landed = 0;
  for (let i = 0; i < hits; i++) {
    if (!alive(activeOf(state, foeSide)) || !alive(me)) break;
    if (move.accuracy !== null) {
      const chance = move.accuracy * accuracyStage(me.stages.acc - target.stages.eva);
      if (i === 0 && rng.int(100) >= chance) { push(run, { k: 'miss', side: foeSide, text: `O ataque de ${who} errou!` }); return; }
    }
    const crit = rng.int(CRIT_DENOMINATOR[Math.min(3, Math.max(0, move.critRate))] as number) === 0;
    const roll = 85 + rng.int(16);
    const result = rawDamage(me, target, move, ctx.chart, roll, crit);
    if (run.spread && run.spread !== 1 && result.effectiveness > 0) result.damage = Math.max(1, Math.floor(result.damage * run.spread));
    if (result.effectiveness === 0) {
      push(run, { k: 'text', text: `Não afeta ${targetWho}...` });
      return;
    }
    const note = result.effectiveness > 1 ? ' É super efetivo!' : result.effectiveness < 1 ? ' Não é muito efetivo...' : '';
    const dealt = dealDamage(run, foeSide, result.damage, 'move', `${crit ? 'Golpe crítico!' : ''}${i === hits - 1 || target.hp === 0 ? note : ''}`.trim(), { effectiveness: result.effectiveness, crit });
    total += dealt;
    landed += 1;
  }
  if (landed > 1) push(run, { k: 'text', text: `Acertou ${landed} vezes!` });
  if (total === 0) return;

  if (move.drain > 0) healBy(run, side, Math.max(1, Math.floor((total * move.drain) / 100)), `${who} sugou energia!`);
  if (move.drain < 0 && alive(me)) dealDamage(run, side, Math.max(1, Math.floor((total * -move.drain) / 100)), 'recoil', `${who} sofreu o recuo!`);
  if (move.healing < 0 && alive(me)) dealDamage(run, side, Math.max(1, Math.floor((me.stats.hp * -move.healing) / 100)), 'recoil', `${who} se machucou no esforço!`);

  if (alive(target)) {
    if (move.ailment && move.ailmentChance > 0 && rng.int(100) < move.ailmentChance) tryAilment(run, foeSide, move.ailment, true);
    if (move.flinchChance > 0 && rng.int(100) < move.flinchChance) target.flinch = true;
  }
  if (move.statChanges.length > 0 && (move.statChance === 0 || rng.int(100) < move.statChance)) {
    const allDown = move.statChanges.every((c) => c.change < 0);
    const onUser = SELF_DEBUFF.has(move.name) || move.statChanges.every((c) => c.change > 0) || (!allDown && move.target === 'user');
    const recipient = onUser ? side : foeSide;
    if (alive(activeOf(state, recipient))) for (const change of move.statChanges) { const key = STAGE_OF_API[change.stat]; if (key) changeStage(run, recipient, key, change.change); }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// XP, nível e golpes

/** XP que o oponente derrotado rende (fórmula do jogo antigo: base × nível ÷ 7). */
export function expForDefeating(species: Species, level: number, multiplier = 1): number {
  return Math.max(1, Math.floor(Math.floor((species.baseExp * level) / 7) * multiplier));
}

export function awardExp(run: { state: BattleState; ctx: BattleContext; events: BattleEvent[] }, index: number, amount: number): void {
  const c = run.state.player.team[index];
  if (!c || amount <= 0) return;
  const species = run.ctx.species(c.speciesId);
  const maxExp = expForLevel(species.growthRate, MAX_LEVEL);
  c.exp = Math.min(maxExp, c.exp + amount);
  run.events.push({ k: 'xp', index, amount, exp: c.exp, progress: levelProgress(species.growthRate, c.level, c.exp), text: `${c.name} ganhou ${amount} pontos de experiência!` });
  const target = levelForExp(species.growthRate, c.exp);
  while (c.level < target) {
    const oldMax = c.stats.hp;
    c.level += 1;
    c.stats = statsOf({ speciesId: c.speciesId, nickname: null, level: c.level, exp: c.exp, shiny: c.shiny, gender: null, ivs: c.ivs, moves: c.moves, currentHp: c.hp, friendship: c.friendship, ball: null, form: c.form ?? null }, species);
    if (c.hp > 0) c.hp = Math.min(c.stats.hp, c.hp + (c.stats.hp - oldMax));
    run.events.push({ k: 'level', index, level: c.level, hp: c.hp, maxHp: c.stats.hp, progress: levelProgress(species.growthRate, c.level, c.exp), text: `${c.name} subiu para o nível ${c.level}!` });
    for (const entry of species.learnset) {
      if (entry.method !== 'level-up' || entry.level !== c.level) continue;
      const move = run.ctx.moves.get(entry.move);
      if (!move || !isUsableMove(move)) continue;
      if (c.moves.some((m) => m.name === move.name) || c.pendingMoves.includes(move.name)) continue;
      if (c.moves.length < 4) {
        c.moves.push({ name: move.name, pp: move.pp, maxPp: move.pp });
        run.events.push({ k: 'learn', index, move: move.name, text: `${c.name} aprendeu ${move.displayName}!` });
      } else {
        c.pendingMoves.push(move.name);
        run.events.push({ k: 'text', text: `${c.name} quer aprender ${move.displayName}, mas já sabe 4 golpes. Decida no perfil dele.` });
      }
    }
  }
}

/** XP do oponente atual, dado ao Pokémon do jogador em campo (se estiver de pé). */
export function awardFoeExp(run: { state: BattleState; ctx: BattleContext; events: BattleEvent[] }): void {
  const foe = activeOf(run.state, 'foe');
  const index = run.state.player.active;
  if (!alive(run.state.player.team[index])) return;
  if (run.state.player.team[index]?.capped) return;
  const amount = expForDefeating(run.ctx.species(foe.speciesId), foe.level, (run.ctx.expMultiplier ?? 1) * (run.state.kind === 'trainer' ? 1.5 : 1));
  awardExp(run, index, amount);
}

// ---------------------------------------------------------------------------------------------------------------------
// turno

function endBattle(run: Run, result: BattleResult, text: string) {
  run.state.phase = 'ended';
  run.state.result = result;
  push(run, { k: 'end', result, text });
}

function residual(run: Run, side: SideKey) {
  const me = activeOf(run.state, side);
  if (!alive(me) || done(run)) return;
  const who = labelOf(run.state, side, me);
  if (me.status === 'burn') dealDamage(run, side, Math.max(1, Math.floor(me.stats.hp / 16)), 'burn', `${who} sofre com a queimadura!`);
  else if (me.status === 'poison') dealDamage(run, side, Math.max(1, Math.floor(me.stats.hp / 8)), 'poison', `${who} sofre com o veneno!`);
}

function validate(state: BattleState, action: BattleAction): void {
  if (state.phase === 'ended') throw new Error('A batalha já acabou.');
  const me = activeOf(state, 'player');
  if (state.phase === 'replace') {
    if (action.kind !== 'switch') throw new Error('Escolha o próximo Pokémon.');
  }
  if (action.kind === 'run' && state.kind === 'trainer') throw new Error('Não dá para fugir de uma batalha de treinador!');
  if (action.kind === 'move') {
    const slots = usableSlots(me);
    if (!slots.includes(action.slot)) throw new Error('Golpe indisponível.');
  }
  if (action.kind === 'switch') {
    const target = state.player.team[action.to];
    if (!alive(target)) throw new Error('Esse Pokémon não pode lutar.');
    if (action.to === state.player.active && state.phase !== 'replace') throw new Error('Esse Pokémon já está em campo.');
  }
}

function doSwitch(run: Run, to: number) {
  const { state } = run;
  const old = activeOf(state, 'player');
  if (alive(old)) push(run, { k: 'text', text: `Volte, ${old.name}!` });
  old.stages = emptyStages();
  old.confusion = 0;
  old.flinch = false;
  state.player.active = to;
  const entering = activeOf(state, 'player');
  entering.fought = true;
  push(run, { k: 'send', side: 'player', index: to, text: `Vai, ${entering.name}!` });
}

function doFoeSwitch(run: Run, to: number) {
  const { state } = run;
  const old = activeOf(state, 'foe');
  push(run, { k: 'text', text: `${state.trainer?.name ?? 'O treinador'} recolheu ${old.name}!` });
  old.stages = emptyStages();
  old.confusion = 0;
  old.flinch = false;
  state.foe.active = to;
  if (state.trainer) state.trainer.lastSwitch = state.turn;
  push(run, { k: 'send', side: 'foe', index: to, text: `${state.trainer?.name ?? 'O treinador'} enviou ${activeOf(state, 'foe').name}!` });
}

function useFoeItem(run: Run, index: number) {
  const { state } = run;
  const item = state.trainer?.bag[index];
  if (!state.trainer || !item || item.qty <= 0 || foeItemsLeft(state.trainer) <= 0) return;
  item.qty -= 1;
  state.trainer.itemsUsed = (state.trainer.itemsUsed ?? 0) + 1;
  const me = activeOf(state, 'foe');
  push(run, { k: 'text', text: `${state.trainer?.name} usou ${item.name} em ${me.name}!` });
  if (item.cures && me.status) {
    const status = me.status;
    me.status = null;
    me.sleepTurns = 0;
    push(run, { k: 'status-end', side: 'foe', status, text: `${me.name} se recuperou!` });
  }
  const amount = Math.min(item.heal, me.stats.hp - me.hp);
  if (amount > 0) healBy(run, 'foe', amount, `${me.name} recuperou ${amount} HP!`);
}

/** Resolve um turno. `action` é a escolha do jogador; o oponente decide sozinho. */
export function chooseAction(input: BattleState, action: BattleAction, ctx: BattleContext): { state: BattleState; events: BattleEvent[] } {
  validate(input, action);
  const state = clone(input);
  const rng = resumableRng(state.rng);
  const run: Run = { state, ctx, rng, events: [], fainted: new Set() };

  if (state.phase === 'replace' && action.kind === 'switch') {
    doSwitch(run, action.to);
    state.phase = 'choose';
    state.rng = rng.state;
    return { state, events: run.events };
  }

  state.turn += 1;
  const foeAction = foeChoice(state, ctx, rng);
  const playerMove = action.kind === 'move' ? (action.slot === -1 ? ({ struggle: true } as const) : { slot: action.slot }) : null;
  const moveOf = (side: SideKey, choice: FoeChoice | null): Move | null => {
    if (!choice || 'switchTo' in choice || 'item' in choice) return null;
    if ('struggle' in choice) return ctx.moves.get('struggle') ?? STRUGGLE;
    const slot = activeOf(state, side).moves[choice.slot];
    return slot ? ctx.moves.get(slot.name) ?? null : null;
  };

  // ações que vão antes de qualquer golpe
  if (action.kind === 'switch') doSwitch(run, action.to);
  else if (action.kind === 'pass') { if (action.text) push(run, { k: 'text', text: action.text }); }
  else if (action.kind === 'run') {
    state.runAttempts += 1;
    const mine = effectiveSpeed(activeOf(state, 'player'));
    const theirs = effectiveSpeed(activeOf(state, 'foe'));
    const odds = Math.floor((mine * 128) / theirs) + 30 * state.runAttempts;
    if (odds > 255 || rng.int(256) < odds) {
      push(run, { k: 'run', ok: true, text: 'Você fugiu em segurança!' });
      endBattle(run, 'fled', '');
      state.rng = rng.state;
      return { state, events: run.events.filter((e) => !(e.k === 'end' && e.text === '')).concat({ k: 'end', result: 'fled', text: '' }) };
    }
    push(run, { k: 'run', ok: false, text: 'Não conseguiu fugir!' });
  }

  // o treinador troca de Pokémon ou usa um item antes dos golpes
  if ('switchTo' in foeAction) doFoeSwitch(run, foeAction.switchTo);
  else if ('item' in foeAction) useFoeItem(run, foeAction.item);

  const order: SideKey[] = [];
  const foeMove = moveOf('foe', foeAction);
  if (playerMove) {
    const mine = moveOf('player', playerMove);
    const a = mine?.priority ?? 0;
    const b = foeMove?.priority ?? 0;
    if (a !== b) order.push(...(a > b ? (['player', 'foe'] as const) : (['foe', 'player'] as const)));
    else {
      const sp = effectiveSpeed(activeOf(state, 'player'));
      const sf = effectiveSpeed(activeOf(state, 'foe'));
      if (sp !== sf) order.push(...(sp > sf ? (['player', 'foe'] as const) : (['foe', 'player'] as const)));
      else order.push(...(rng.int(2) === 0 ? (['player', 'foe'] as const) : (['foe', 'player'] as const)));
    }
  } else if (foeMove) order.push('foe');
  if (playerMove && !foeMove) order.splice(0, order.length, 'player');

  for (const side of order) {
    if (done(run)) break;
    const actor = activeOf(state, side);
    if (!alive(actor)) continue;
    useMove(run, side, side === 'player' ? (playerMove as { slot: number }) : (foeAction as { slot: number } | { struggle: true }));
    resolveFaintsAfterHit(run);
  }
  if (!done(run)) {
    // fim do turno: veneno e queimadura; o oponente (se vivo) e depois o jogador
    for (const side of ['foe', 'player'] as const) { residual(run, side); resolveFaintsAfterHit(run); }
    activeOf(state, 'foe').flinch = false;
    activeOf(state, 'player').flinch = false;
  }
  if (!done(run) && !alive(activeOf(state, 'player'))) {
    state.phase = 'replace';
    push(run, { k: 'text', text: 'Escolha o próximo Pokémon.' });
  }
  state.rng = rng.state;
  return { state, events: run.events };
}

function resolveFaintsAfterHit(run: Run) {
  const { state } = run;
  if (done(run)) return;
  const foe = activeOf(state, 'foe');
  if (foe.hp <= 0 && !run.fainted.has(foe)) {
    run.fainted.add(foe);
    push(run, { k: 'faint', side: 'foe', text: `${labelOf(state, 'foe', foe)} desmaiou!` });
    awardFoeExp(run);
    const next = nextFoe(state, run.ctx);
    if (next < 0) { endBattle(run, 'win', state.kind === 'trainer' && state.trainer ? `Você venceu ${state.trainer.name}!` : 'Você venceu a batalha!'); return; }
    state.foe.active = next;
    push(run, { k: 'send', side: 'foe', index: next, text: state.kind === 'trainer' && state.trainer ? `${state.trainer.name} enviou ${activeOf(state, 'foe').name}!` : `${activeOf(state, 'foe').name} entrou em batalha!` });
  }
  const me = activeOf(state, 'player');
  if (me.hp <= 0 && !run.fainted.has(me)) {
    run.fainted.add(me);
    push(run, { k: 'faint', side: 'player', text: `${me.name} desmaiou!` });
    if (!state.player.team.some((c) => c.hp > 0)) endBattle(run, 'lose', 'Todos os seus Pokémon desmaiaram...');
  }
}

/** Depois de uma captura: encerra a batalha e rende XP ao Pokémon em campo. */
export function finishCapture(input: BattleState, ctx: BattleContext, ball: string, shakes: number, text: string): { state: BattleState; events: BattleEvent[] } {
  const state = clone(input);
  const events: BattleEvent[] = [{ k: 'ball', ball, shakes, caught: true, text }];
  state.phase = 'ended';
  state.result = 'captured';
  state.turn += 1;
  awardFoeExp({ state, ctx, events });
  events.push({ k: 'end', result: 'captured', text: '' });
  return { state, events };
}

/** Bola que falhou: o turno passa e o selvagem ataca. */
export function failedThrow(input: BattleState, ctx: BattleContext, ball: string, shakes: number, text: string): { state: BattleState; events: BattleEvent[] } {
  const result = chooseAction(input, { kind: 'pass' }, ctx);
  result.events.unshift({ k: 'ball', ball, shakes, caught: false, text });
  return result;
}

/** Vista rápida do dano que um golpe causaria (para dicas na tela e testes). */
export function estimateDamage(state: BattleState, ctx: BattleContext, side: SideKey, moveName: string): { min: number; max: number; effectiveness: number } | null {
  const move = ctx.moves.get(moveName);
  if (!move || move.category === 'status') return null;
  return damageRange(activeOf(state, side), activeOf(state, other(side)), move, ctx.chart);
}

// ---------------------------------------------------------------------------------------------------------------------
// peças para o motor de duplas (battle2.ts): cada golpe é resolvido como um duelo 1×1 entre dois Combatentes

export type DuelChoice = { slot: number } | { struggle: true };

function duelState(a: Combatant, d: Combatant): BattleState {
  return {
    kind: 'trainer', trainer: null, turn: 0, phase: 'choose', result: null, rng: 0, runAttempts: 0,
    player: { team: [a], active: 0 }, foe: { team: [d], active: 0 },
  };
}

/**
 * Executa um golpe de `attacker` em `defender` (os dois são alterados). Nos eventos devolvidos, `side: 'player'` é o
 * atacante e `side: 'foe'` o alvo. `skipPrep` pula o anúncio e os testes de ação (para o 2º alvo de um golpe em área).
 */
export function duelMove(attacker: Combatant, defender: Combatant, choice: DuelChoice, ctx: BattleContext, rng: Rng, options: { spread?: number; skipPrep?: boolean } = {}): BattleEvent[] {
  const run: Run = { state: duelState(attacker, defender), ctx, rng, events: [], fainted: new Set(), ...options };
  useMove(run, 'player', choice);
  return run.events;
}

/** Veneno e queimadura do fim do turno (eventos com `side: 'player'`). */
export function duelResidual(c: Combatant, ctx: BattleContext, rng: Rng): BattleEvent[] {
  const run: Run = { state: duelState(c, c), ctx, rng, events: [], fainted: new Set() };
  residual(run, 'player');
  return run.events;
}

export const battleAi = {
  scoreMoves,
  chooseMove: (scores: ReturnType<typeof scoreMoves>, skill: 1 | 2 | 3, rng: Rng): { slot: number } | { struggle: true } => {
    const choice = chooseMove(scores, skill, rng);
    return 'slot' in choice ? { slot: choice.slot } : { struggle: true };
  },
  effectiveSpeed,
  matchup,
  struggle: STRUGGLE,
};
