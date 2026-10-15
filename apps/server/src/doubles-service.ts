import { randomInt } from 'node:crypto';
import {
  TOURNAMENT_ROUNDS, TRAINER_DIFFICULTIES, DIFFICULTIES, amuletCoinMultiplier, chooseDoubles, chooseReplacements, combatantFrom, createDoubles, createPokemon,
  effectiveness, monAt, replacementsNeeded, rngFrom, rollOpponent, rollTrainer, tournamentTier,
  type BattleOutcome, type Combatant, type Difficulty, type DoublesActRequest, type DoublesAction, type DoublesMoveView, type DoublesState, type DoublesTurnResult,
  type DoublesView, type DuelEvent, type Pos, type TrainerInfo,
} from '@pokesim/engine';
import { loadGameData } from '@pokesim/data';
import { transaction, type Db } from './db.ts';
import { badRequest, notFound } from './errors.ts';
import type { PokemonStore } from './pokemon-store.ts';
import type { Inventory } from './inventory.ts';
import type { Journal } from './journal.ts';
import type { BattleService } from './battle-service.ts';

/** Batalhas em dupla (2×2) contra treinadores e em torneios. O motor está em `battle2.ts`; aqui ficam persistência, prêmios e a vista para a tela. */
export function createDoublesService(db: Db, store: PokemonStore, inventory: Inventory, journal: Journal, battle: BattleService, seedOf: () => number = () => randomInt(2 ** 31)) {
  const data = loadGameData();
  const shared = battle.shared;
  const species = (id: number) => {
    const found = data.speciesById.get(id);
    if (!found) throw new Error(`Espécie ${id} ausente do catálogo.`);
    return found;
  };

  function assertSave(saveId: string): void {
    if (!db.prepare('SELECT 1 FROM saves WHERE id = ?').get(saveId)) throw notFound('Save não encontrado.');
  }

  function load(saveId: string): DoublesState | null {
    const row = db.prepare('SELECT state FROM battles WHERE save_id = ?').get(saveId) as { state: string } | undefined;
    if (!row) return null;
    const parsed = JSON.parse(row.state) as { kind: string };
    return parsed.kind === 'doubles' ? (parsed as DoublesState) : null;
  }

  function persist(saveId: string, state: DoublesState): void {
    db.prepare(`
      INSERT INTO battles (save_id, state, created_at) VALUES (?, ?, ?)
      ON CONFLICT (save_id) DO UPDATE SET state = excluded.state
    `).run(saveId, JSON.stringify(state), new Date().toISOString());
  }

  function moveViews(state: DoublesState, mon: Combatant): DoublesMoveView[] {
    return mon.moves.map((slot, index) => {
      const move = data.movesByName.get(slot.name);
      const spread = move?.target === 'all-opponents' || move?.target === 'all-other-pokemon';
      const damaging = Boolean(move && move.category !== 'status');
      const eff = (pos: Pos): number | null => {
        const foe = monAt(state, 'foe', pos);
        return move && damaging && foe && foe.hp > 0 ? effectiveness(data.typeChart, move.type, foe.types) : null;
      };
      return {
        slot: index, name: slot.name, displayName: move?.displayName ?? slot.name, type: move?.type ?? 'normal', category: move?.category ?? 'physical',
        power: move?.power ?? 0, accuracy: move?.accuracy ?? null, target: move?.target ?? 'selected-pokemon', spread,
        needsTarget: !spread && damaging, effectiveness: [eff(0), eff(1)],
      };
    });
  }

  function view(state: DoublesState, outcome: BattleOutcome | null): DoublesView {
    const slotMoves = (pos: Pos): DoublesMoveView[] | null => {
      const mon = monAt(state, 'player', pos);
      return mon && mon.hp > 0 ? moveViews(state, mon) : null;
    };
    return {
      trainer: { name: state.trainer.name, title: state.trainer.title, skill: state.trainer.skill },
      phase: state.phase,
      turn: state.turn,
      player: { team: state.player.team.map(shared.monView), active: state.player.active, moves: [slotMoves(0), slotMoves(1)] },
      foe: { team: state.foe.team.map(shared.monView), active: state.foe.active },
      replacements: state.phase === 'replace' ? replacementsNeeded(state) : 0,
      outcome,
    };
  }

  function finalize(saveId: string, state: DoublesState, events: DuelEvent[]): BattleOutcome {
    const result = state.result as NonNullable<DoublesState['result']>;
    const before = new Map((db.prepare('SELECT id, level FROM pokemon WHERE save_id = ?').all(saveId) as { id: string; level: number }[]).map((row) => [row.id, row.level]));
    const trainer = state.trainer;
    const tournament = trainer.tournament ? shared.settleTournament(saveId, trainer.tournament, result, events) : null;
    let money = 0;
    const rewards: BattleOutcome['rewards'] = [];
    if (result === 'win') {
      const coin = inventory.quantity(saveId, 'amulet-coin') > 0 ? amuletCoinMultiplier(shared.extraGenerations(saveId)) : 1;
      money = Math.floor((trainer.money ?? state.foe.team.reduce((sum, c) => sum + c.level * 10, 0)) * coin);
      for (const reward of trainer.rewards ?? []) {
        inventory.add(saveId, reward.item, reward.quantity);
        const name = data.itemsByName.get(reward.item)?.displayName ?? reward.item;
        rewards.push({ item: reward.item, name, quantity: reward.quantity });
        events.push({ k: 'text', text: `Você ganhou ${reward.quantity}× ${name}!` });
      }
      db.prepare('UPDATE saves SET money = money + ?, updated_at = ? WHERE id = ?').run(money, new Date().toISOString(), saveId);
      if (money > 0) events.push({ k: 'money', amount: money, text: `Você ganhou ₽ ${money.toLocaleString('pt-BR')}!` });
    }
    journal.record(saveId, {
      kind: 'batalha', result: result === 'win' ? 'vitoria' : 'derrota',
      text: `${result === 'win' ? 'Venceu' : 'Perdeu para'} ${trainer.name} em dupla${trainer.tournament ? ` (rodada ${trainer.tournament.round} da copa)` : ''}.`,
    });
    if (result === 'win' && trainer.difficulty) journal.record(saveId, { kind: 'vencer_treinador', difficulty: trainer.difficulty });
    if (tournament?.champion && trainer.tournament) journal.record(saveId, { kind: 'vencer_torneio', tournament: trainer.tournament.tier, text: `Campeão da Copa ${tournament.tierName}!` });
    const fallen = store.applyBattle(saveId, state.player.team);
    for (const name of fallen) journal.record(saveId, { kind: 'perda', text: `${name} desmaiou e foi perdido (modo difícil).` });
    if (fallen.length > 0) events.push({ k: 'text', text: `Modo difícil: ${fallen.join(', ')} não voltou${fallen.length > 1 ? 'ram' : ''}...` });
    db.prepare('DELETE FROM battles WHERE save_id = ?').run(saveId);
    const levels = state.player.team.filter((c) => c.ref && !c.capped && c.level > (before.get(c.ref) ?? c.level)).map((c) => ({ name: c.name, level: c.level }));
    const pending = state.player.team.filter((c) => c.pendingMoves.length > 0).map((c) => c.name);
    return { result, money, caught: null, levels, pending, rewards, badge: null, trainerName: trainer.name, tournament, ...(fallen.length ? { fallen } : {}) };
  }

  function commit(saveId: string, state: DoublesState, events: DuelEvent[]): DoublesTurnResult {
    let outcome: BattleOutcome | null = null;
    if (state.phase === 'ended') outcome = finalize(saveId, state, events);
    else persist(saveId, state);
    return { doubles: true, events, view: view(state, outcome) };
  }

  /** Equipe do jogador para duplas: precisa de pelo menos 2 Pokémon aptos. */
  function pair(saveId: string, cap: number | null, members?: string[]): Combatant[] {
    const team = shared.playerTeam(saveId, cap, members);
    if (team.filter((c) => c.hp > 0).length < 2) throw badRequest('Batalhas em dupla pedem pelo menos 2 Pokémon aptos a lutar.');
    return team;
  }

  const foeTeam = (members: { speciesId: number; level: number }[], rng: ReturnType<typeof rngFrom>): Combatant[] => members.map((member) => {
    const sp = species(member.speciesId);
    return combatantFrom(createPokemon({ species: sp, level: member.level, rng, moves: data.movesByName }), sp, sp.displayName);
  });

  return {
    current(saveId: string): DoublesView | null {
      assertSave(saveId);
      const state = load(saveId);
      return state ? view(state, null) : null;
    },

    /** Treinador aleatório em dupla: mesmas dificuldades, com o dobro de dinheiro e de prêmios. */
    startTrainer(saveId: string, difficulty: unknown): DoublesTurnResult {
      assertSave(saveId);
      if (shared.hasBattle(saveId)) throw badRequest('Já há uma batalha em andamento.');
      if (typeof difficulty !== 'string' || !(DIFFICULTIES as readonly string[]).includes(difficulty)) throw badRequest('Escolha Fácil, Médio ou Difícil.');
      const level = difficulty as Difficulty;
      return transaction(db, () => {
        const rng = rngFrom(randomInt);
        const rolled = rollTrainer(level, data.species, rng);
        const rules = TRAINER_DIFFICULTIES[level];
        const trainer: TrainerInfo = {
          name: `${rolled.name} e parceiro`, title: 'Dupla', skill: rules.skill, bag: [], lastSwitch: -9, difficulty: level,
          money: rolled.money * 2, rewards: rolled.rewards.map((r) => ({ ...r, quantity: r.quantity * 2 })),
        };
        const { state, events } = createDoubles({ player: pair(saveId, null), foe: foeTeam(rolled.team, rng), seed: seedOf(), trainer });
        persist(saveId, state);
        return { doubles: true, events, view: view(state, null) };
      });
    },

    /** Rodada de um torneio em duplas. */
    startTournamentRound(saveId: string): DoublesTurnResult {
      assertSave(saveId);
      if (shared.hasBattle(saveId)) throw badRequest('Já há uma batalha em andamento.');
      const row = db.prepare('SELECT tier, round, members FROM tournaments WHERE save_id = ?').get(saveId) as { tier: string; round: number; members: string } | undefined;
      const tier = tournamentTier(row?.tier);
      if (!row || !tier || !tier.doubles) throw badRequest('Você não está em um torneio em duplas.');
      return transaction(db, () => {
        const rng = rngFrom(randomInt);
        const opponent = rollOpponent(tier, row.round, data.species, rng);
        const trainer: TrainerInfo = {
          name: opponent.name, title: `Rodada ${row.round}/${TOURNAMENT_ROUNDS}`, skill: opponent.skill, bag: [], lastSwitch: -9, money: 0, rewards: [],
          tournament: { tier: tier.id, round: row.round },
        };
        const player = pair(saveId, tier.cap, JSON.parse(row.members) as string[]);
        const { state, events } = createDoubles({ player, foe: foeTeam(opponent.team, rng), seed: seedOf(), trainer });
        persist(saveId, state);
        return { doubles: true, events, view: view(state, null) };
      });
    },

    /** Turno: `{ actions: [pos0, pos1] }`; troca depois de um desmaio: `{ replace: [{ pos, to }] }`. */
    act(saveId: string, request: unknown): DoublesTurnResult {
      assertSave(saveId);
      const state = load(saveId);
      if (!state) throw badRequest(shared.hasBattle(saveId) ? 'A batalha em andamento não é em dupla.' : 'Não há batalha em dupla em andamento.');
      const input = (request ?? {}) as Partial<DoublesActRequest> & Record<string, unknown>;
      const ctx = shared.contextFor(saveId);
      try {
        return transaction(db, () => {
          if (Array.isArray(input.replace)) {
            const picks = input.replace.map((p) => ({ pos: Number(p?.pos) as Pos, to: Number(p?.to) }));
            if (picks.some((p) => (p.pos !== 0 && p.pos !== 1) || !Number.isInteger(p.to))) throw badRequest('Troca inválida.');
            const result = chooseReplacements(state, picks);
            return commit(saveId, result.state, result.events);
          }
          if (!Array.isArray(input.actions)) throw badRequest('Ação de batalha desconhecida.');
          const raw = input.actions as ({ kind?: string; slot?: unknown; to?: unknown; target?: { side: 'foe' | 'player'; pos: unknown } } | null)[];
          const actions = [0, 1].map((i): DoublesAction | null => {
            const a = raw[i];
            if (!a) return null;
            if (a.kind === 'move') return { kind: 'move', slot: Number(a.slot), ...(a.target ? { target: { side: a.target.side, pos: Number(a.target.pos) as Pos } } : {}) };
            if (a.kind === 'switch') return { kind: 'switch', to: Number(a.to) };
            throw badRequest('Ação de batalha desconhecida.');
          });
          const result = chooseDoubles(state, actions, ctx);
          return commit(saveId, result.state, result.events);
        });
      } catch (error) {
        if (error instanceof Error && !('status' in error)) throw badRequest(error.message);
        throw error;
      }
    },
  };
}
export type DoublesService = ReturnType<typeof createDoublesService>;
