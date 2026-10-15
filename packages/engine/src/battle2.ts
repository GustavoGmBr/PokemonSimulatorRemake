import type { Move } from './types.ts';
import { resumableRng, type Rng } from './rng.ts';
import {
  awardExp, battleAi, duelMove, duelResidual, emptyStages, expForDefeating,
  type BattleContext, type BattleEvent, type BattlePhase, type BattleResult, type Combatant, type DuelChoice, type SideKey, type TrainerInfo,
} from './battle.ts';

/**
 * Batalhas em dupla (2×2). Cada golpe é resolvido pelo motor 1×1 (`duelMove`), então regras de dano, status e atributos
 * são as mesmas; este módulo cuida de quem age primeiro, dos alvos, dos golpes em área e das entradas e saídas.
 * Só treinadores (sem fuga, captura ou itens); o oponente usa a IA de golpes do treinador.
 */

export type Pos = 0 | 1;
export interface SlotRef { side: SideKey; pos: Pos }

export interface DoublesSide {
  team: Combatant[];
  /** índice na equipe de quem ocupa cada posição (-1 = vazia); o Pokémon pode estar desmaiado */
  active: [number, number];
}

export interface DoublesState {
  kind: 'doubles';
  trainer: TrainerInfo;
  turn: number;
  phase: BattlePhase;
  result: BattleResult | null;
  rng: number;
  player: DoublesSide;
  foe: DoublesSide;
}

/** Evento do motor 1×1 com a posição (0 ou 1) do lado a que ele se refere. */
export type DuelEvent = BattleEvent & { pos?: Pos };

export type DoublesAction =
  | { kind: 'move'; slot: number; target?: SlotRef }
  | { kind: 'switch'; to: number };

/** Uma ação por posição (null/ausente onde não há Pokémon de pé). */
export type DoublesTurn = (DoublesAction | null | undefined)[];

const POSITIONS: readonly Pos[] = [0, 1];
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const alive = (c: Combatant | undefined): c is Combatant => c !== undefined && c.hp > 0;

export function monAt(state: DoublesState, side: SideKey, pos: Pos): Combatant | undefined {
  const index = state[side].active[pos];
  return index >= 0 ? state[side].team[index] : undefined;
}

const activeAlive = (state: DoublesState, side: SideKey): { mon: Combatant; pos: Pos }[] =>
  POSITIONS.flatMap((pos) => { const mon = monAt(state, side, pos); return alive(mon) ? [{ mon, pos }] : []; });

/** Reserva viva (fora de campo). */
export function benchOf(state: DoublesState, side: SideKey): number[] {
  const inField = new Set(state[side].active);
  return state[side].team.map((c, i) => ({ c, i })).filter(({ c, i }) => alive(c) && !inField.has(i)).map(({ i }) => i);
}

/** Posições vazias (sem ninguém de pé) do lado. */
export function emptySlots(state: DoublesState, side: SideKey): Pos[] {
  return POSITIONS.filter((pos) => !alive(monAt(state, side, pos)));
}

const nameOf = (state: DoublesState, side: SideKey, c: Combatant) => (side === 'foe' ? `${c.name} de ${state.trainer.name}` : c.name);

export function createDoubles(input: { player: Combatant[]; foe: Combatant[]; seed: number; trainer: TrainerInfo }): { state: DoublesState; events: DuelEvent[] } {
  const lead = (team: Combatant[]): [number, number] => {
    const ids = team.map((c, i) => ({ c, i })).filter(({ c }) => c.hp > 0).map(({ i }) => i).slice(0, 2);
    return [ids[0] ?? -1, ids[1] ?? -1];
  };
  const player = lead(input.player);
  const foe = lead(input.foe);
  if (player[0] < 0) throw new Error('Nenhum Pokémon da equipe pode lutar.');
  if (foe[0] < 0) throw new Error('Sem oponente.');
  const state: DoublesState = {
    kind: 'doubles', trainer: input.trainer, turn: 0, phase: 'choose', result: null, rng: input.seed >>> 0,
    player: { team: input.player, active: player }, foe: { team: input.foe, active: foe },
  };
  const events: DuelEvent[] = [{ k: 'text', text: `${input.trainer.title ? `${input.trainer.title} ` : ''}${input.trainer.name} quer uma batalha em dupla!` }];
  for (const pos of POSITIONS) {
    const mon = monAt(state, 'foe', pos);
    if (mon) events.push({ k: 'send', side: 'foe', index: state.foe.active[pos], pos, text: `${input.trainer.name} enviou ${mon.name}!` });
  }
  for (const pos of POSITIONS) {
    const mon = monAt(state, 'player', pos);
    if (mon) { mon.fought = true; events.push({ k: 'send', side: 'player', index: state.player.active[pos], pos, text: `Vai, ${mon.name}!` }); }
  }
  return { state, events };
}

// ---------------------------------------------------------------------------------------------------------------------

interface Run { state: DoublesState; ctx: BattleContext; rng: Rng; events: DuelEvent[]; fainted: Set<Combatant> }

const push = (run: Run, event: DuelEvent) => { run.events.push(event); };
const done = (run: Run) => run.state.phase === 'ended';

function endBattle(run: Run, result: BattleResult, text: string) {
  run.state.phase = 'ended';
  run.state.result = result;
  push(run, { k: 'end', result, text });
}

function tag(events: BattleEvent[], attacker: SlotRef, defender: SlotRef): DuelEvent[] {
  return events.map((event) => {
    if (!('side' in event)) return event;
    const ref = event.side === 'player' ? attacker : defender;
    return { ...event, side: ref.side, pos: ref.pos } as DuelEvent;
  });
}

function moveFor(run: Run, mon: Combatant, choice: DuelChoice): Move | null {
  if ('struggle' in choice) return run.ctx.moves.get('struggle') ?? battleAi.struggle;
  const slot = mon.moves[choice.slot];
  return slot ? run.ctx.moves.get(slot.name) ?? null : null;
}

const SELF_TARGETS = new Set(['user', 'users-field', 'entire-field', 'user-and-allies', 'all-allies', 'ally', 'user-or-ally', 'opponents-field', 'all-pokemon', 'fainting-pokemon', 'specific-move']);

/** Quem o golpe atinge: alvo escolhido (ou o que sobrou), os dois adversários, todos os outros ou o próprio usuário. */
function targetsOf(run: Run, me: SlotRef, move: Move, wanted: SlotRef | undefined): SlotRef[] {
  const foeSide: SideKey = me.side === 'player' ? 'foe' : 'player';
  const foes = activeAlive(run.state, foeSide).map(({ pos }) => ({ side: foeSide, pos }));
  if (move.category === 'status' && SELF_TARGETS.has(move.target)) return [me];
  if (move.target === 'all-opponents') return foes;
  if (move.target === 'all-other-pokemon') {
    const ally = activeAlive(run.state, me.side).filter(({ pos }) => pos !== me.pos).map(({ pos }) => ({ side: me.side, pos }));
    return [...foes, ...ally];
  }
  if (wanted && wanted.side === foeSide && alive(monAt(run.state, foeSide, wanted.pos))) return [wanted];
  return foes.slice(0, 1);
}

/** Cuida dos desmaios: XP, entrada automática do reserva do treinador e fim da batalha. */
function settle(run: Run) {
  const { state } = run;
  if (done(run)) return;
  for (const side of ['foe', 'player'] as const) {
    for (const pos of POSITIONS) {
      const mon = monAt(state, side, pos);
      if (!mon || mon.hp > 0 || run.fainted.has(mon) || (mon as { downed?: boolean }).downed) continue;
      run.fainted.add(mon);
      (mon as { downed?: boolean }).downed = true;
      push(run, { k: 'faint', side, pos, text: `${nameOf(state, side, mon)} desmaiou!` });
      if (side === 'foe') {
        const amount = expForDefeating(run.ctx.species(mon.speciesId), mon.level, (run.ctx.expMultiplier ?? 1) * 1.5);
        for (const { mon: winner, pos: winnerPos } of activeAlive(state, 'player')) {
          if (winner.capped) continue;
          const index = state.player.active[winnerPos];
          const proxy = { state: { player: { team: state.player.team } } as never, ctx: run.ctx, events: run.events };
          awardExp(proxy, index, amount);
        }
      }
    }
  }
  if (activeAlive(state, 'player').length === 0 && !state.player.team.some((c) => c.hp > 0)) { endBattle(run, 'lose', 'Todos os seus Pokémon desmaiaram...'); return; }
  if (!state.foe.team.some((c) => c.hp > 0)) { endBattle(run, 'win', `Você venceu ${state.trainer.name}!`); return; }
  // o treinador manda o reserva para cada posição vazia
  for (const pos of emptySlots(state, 'foe')) {
    const bench = benchOf(state, 'foe');
    if (bench.length === 0) break;
    const targets = activeAlive(state, 'player').map(({ mon }) => mon);
    const score = (index: number) => targets.reduce((sum, t) => sum + battleAi.matchup(state.foe.team[index] as Combatant, t, run.ctx), 0);
    const pick = state.trainer.skill >= 2 ? [...bench].sort((a, b) => score(b) - score(a))[0] as number : bench[0] as number;
    state.foe.active[pos] = pick;
    const entering = state.foe.team[pick] as Combatant;
    entering.fought = true;
    push(run, { k: 'send', side: 'foe', index: pick, pos, text: `${state.trainer.name} enviou ${entering.name}!` });
  }
}

interface Plan { ref: SlotRef; mon: Combatant; action: DoublesAction }

/** Plano do treinador: para cada Pokémon, o melhor par (golpe, alvo) pela pontuação da IA. */
function planFoe(run: Run): Plan[] {
  const { state, ctx, rng } = run;
  const targets = activeAlive(state, 'player');
  const plans: Plan[] = [];
  for (const { mon, pos } of activeAlive(state, 'foe')) {
    const options = targets.flatMap(({ pos: targetPos, mon: target }) =>
      battleAi.scoreMoves(mon, target, ctx).map((scored) => ({ ...scored, target: targetPos })));
    if (options.length === 0) { plans.push({ ref: { side: 'foe', pos }, mon, action: { kind: 'move', slot: -1 } }); continue; }
    options.sort((a, b) => b.score - a.score);
    const skill = state.trainer.skill;
    const best = options[0] as (typeof options)[number];
    let chosen = best;
    if (skill === 2 && rng.int(5) === 0 && options[1]) chosen = options[1];
    else if (skill === 1) {
      const pool = options.slice(0, 3).filter((o) => o.score >= best.score * 0.6);
      chosen = pool[rng.int(pool.length)] ?? best;
    }
    plans.push({ ref: { side: 'foe', pos }, mon, action: { kind: 'move', slot: chosen.slot, target: { side: 'player', pos: chosen.target } } });
  }
  return plans;
}

function validate(state: DoublesState, turn: DoublesTurn): void {
  if (state.phase === 'ended') throw new Error('A batalha já acabou.');
  if (state.phase === 'replace') throw new Error('Escolha quem entra no lugar de quem desmaiou.');
  const switching = new Set<number>();
  for (const pos of POSITIONS) {
    const mon = monAt(state, 'player', pos);
    const action = turn[pos];
    if (!alive(mon)) continue;
    if (!action) throw new Error('Escolha uma ação para cada Pokémon em campo.');
    if (action.kind === 'move') {
      if (action.slot !== -1 && !mon.moves[action.slot]) throw new Error('Golpe indisponível.');
      if (action.target && action.target.side !== 'foe') throw new Error('Alvo inválido.');
    } else {
      const to = state.player.team[action.to];
      if (!alive(to) || state.player.active.includes(action.to)) throw new Error('Esse Pokémon não pode entrar.');
      if (switching.has(action.to)) throw new Error('Não dá para enviar o mesmo Pokémon duas vezes.');
      switching.add(action.to);
    }
  }
}

function doSwitch(run: Run, side: SideKey, pos: Pos, to: number) {
  const { state } = run;
  const old = monAt(state, side, pos);
  if (alive(old)) { push(run, { k: 'text', text: `Volte, ${old.name}!` }); old.stages = emptyStages(); old.confusion = 0; old.flinch = false; }
  state[side].active[pos] = to;
  const entering = state[side].team[to] as Combatant;
  entering.fought = true;
  push(run, { k: 'send', side, index: to, pos, text: `Vai, ${entering.name}!` });
}

/** Resolve um turno inteiro: `turn[pos]` é a ação do seu Pokémon na posição `pos`. */
export function chooseDoubles(input: DoublesState, turn: DoublesTurn, ctx: BattleContext): { state: DoublesState; events: DuelEvent[] } {
  validate(input, turn);
  const state = clone(input);
  const rng = resumableRng(state.rng);
  const run: Run = { state, ctx, rng, events: [], fainted: new Set() };
  state.turn += 1;

  const plans: Plan[] = [];
  for (const { pos } of activeAlive(state, 'player')) plans.push({ ref: { side: 'player', pos }, mon: monAt(state, 'player', pos) as Combatant, action: turn[pos] as DoublesAction });
  plans.push(...planFoe(run));

  // trocas primeiro
  for (const plan of plans.filter((p) => p.action.kind === 'switch')) doSwitch(run, plan.ref.side, plan.ref.pos, (plan.action as { to: number }).to);

  const priority = (plan: Plan): number => {
    const action = plan.action as { slot: number };
    return moveFor(run, plan.mon, action.slot === -1 ? { struggle: true } : { slot: action.slot })?.priority ?? 0;
  };
  const order = plans.filter((p) => p.action.kind === 'move')
    .map((plan) => ({ plan, priority: priority(plan), speed: battleAi.effectiveSpeed(plan.mon), tie: rng.int(1000) }))
    .sort((a, b) => b.priority - a.priority || b.speed - a.speed || a.tie - b.tie);

  for (const { plan } of order) {
    if (done(run)) break;
    const attacker = monAt(state, plan.ref.side, plan.ref.pos);
    if (!attacker || attacker !== plan.mon || !alive(attacker)) continue;
    const action = plan.action as Extract<DoublesAction, { kind: 'move' }>;
    const choice: DuelChoice = action.slot === -1 ? { struggle: true } : { slot: action.slot };
    const move = moveFor(run, attacker, choice);
    if (!move) { push(run, { k: 'text', text: `${attacker.name} não sabe usar esse golpe!` }); continue; }
    const targets = targetsOf(run, plan.ref, move, action.target);
    if (targets.length === 0) { push(run, { k: 'text', text: `${attacker.name} usou ${move.displayName}, mas não havia alvo!` }); continue; }
    const spread = targets.length > 1 && move.category !== 'status' ? 0.75 : 1;
    let prepared = false;
    for (const target of targets) {
      const defender = monAt(state, target.side, target.pos);
      if (!defender) continue;
      if (move.category !== 'status' && !alive(defender)) continue;
      const events = duelMove(attacker, defender, choice, ctx, rng, { spread, skipPrep: prepared });
      run.events.push(...tag(events, plan.ref, target));
      // se o Pokémon não conseguiu agir (sono, paralisia…), não há anúncio de golpe: encerra para os outros alvos
      if (!prepared) { prepared = events.some((e) => e.k === 'move'); if (!prepared) break; }
      if (!alive(attacker)) break;
    }
    settle(run);
  }

  if (!done(run)) {
    for (const side of ['foe', 'player'] as const) {
      for (const { mon, pos } of activeAlive(state, side)) {
        run.events.push(...tag(duelResidual(mon, ctx, rng), { side, pos }, { side, pos }));
        settle(run);
        if (done(run)) break;
      }
      if (done(run)) break;
    }
    for (const side of ['foe', 'player'] as const) for (const { mon } of activeAlive(state, side)) mon.flinch = false;
  }
  if (!done(run) && emptySlots(state, 'player').length > 0 && benchOf(state, 'player').length > 0) {
    state.phase = 'replace';
    push(run, { k: 'text', text: 'Escolha quem entra em campo.' });
  }
  state.rng = rng.state;
  return { state, events: run.events };
}

/** Quantas trocas o jogador precisa escolher na fase `replace`. */
export function replacementsNeeded(state: DoublesState): number {
  return Math.min(emptySlots(state, 'player').length, benchOf(state, 'player').length);
}

/** Fase `replace`: quem entra em cada posição vazia. */
export function chooseReplacements(input: DoublesState, picks: { pos: Pos; to: number }[]): { state: DoublesState; events: DuelEvent[] } {
  if (input.phase !== 'replace') throw new Error('Não há troca pendente.');
  const need = replacementsNeeded(input);
  const empty = new Set(emptySlots(input, 'player'));
  const bench = new Set(benchOf(input, 'player'));
  if (picks.length !== need) throw new Error(need === 1 ? 'Escolha um Pokémon para entrar.' : `Escolha ${need} Pokémon para entrar.`);
  if (new Set(picks.map((p) => p.pos)).size !== picks.length || new Set(picks.map((p) => p.to)).size !== picks.length) throw new Error('Escolhas repetidas.');
  if (picks.some((p) => !empty.has(p.pos) || !bench.has(p.to))) throw new Error('Troca inválida.');
  const state = clone(input);
  const run: Run = { state, ctx: undefined as never, rng: undefined as never, events: [], fainted: new Set() };
  for (const pick of picks) doSwitch(run, 'player', pick.pos, pick.to);
  state.phase = 'choose';
  return { state, events: run.events };
}
