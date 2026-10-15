import { randomInt } from 'node:crypto';
import {
  HEAL_EFFECTS, activeOf, amuletCoinMultiplier, applyHealItem, attemptCapture, captureChance, chooseAction, combatantFrom, createBattle,
  effectiveness, failedThrow, finishCapture, levelProgress, luckyEggMultiplier, resumableRng, statsOf,
  type BallOption, type BattleActRequest, type BattleContext, type BattleEvent, type BattleMonView, type BattleMoveView,
  type BattleOutcome, type BattleState, type BattleTurnResult, type BattleView, type CaptureInput, type Combatant, type PokemonInstance,
  type PokemonView,
} from '@pokesim/engine';
import { loadGameData } from '@pokesim/data';
import { transaction, type Db } from './db.ts';
import { badRequest, notFound } from './errors.ts';
import type { PokemonStore } from './pokemon-store.ts';
import type { Inventory } from './inventory.ts';
import type { WildService } from './wild-service.ts';

/** Batalhas contra selvagens: guarda o estado, aplica ações e entrega XP, dinheiro e cura ao final. */
export function createBattleService(db: Db, store: PokemonStore, inventory: Inventory, wild: WildService, seedOf: () => number = () => randomInt(2 ** 31)) {
  const data = loadGameData();
  const ctxBase: BattleContext = {
    species: (id) => {
      const species = data.speciesById.get(id);
      if (!species) throw new Error(`Espécie ${id} ausente do catálogo.`);
      return species;
    },
    moves: data.movesByName,
    chart: data.typeChart,
  };

  function assertSave(saveId: string): void {
    if (!db.prepare('SELECT 1 FROM saves WHERE id = ?').get(saveId)) throw notFound('Save não encontrado.');
  }

  /** Gerações concluídas depois da 1ª (alimenta Lucky Egg e Amulet Coin). */
  function extraGenerations(saveId: string): number {
    const rows = db.prepare("SELECT challenge_id FROM badges WHERE save_id = ? AND challenge_id LIKE '%:champion'").all(saveId) as { challenge_id: string }[];
    return rows.filter((row) => row.challenge_id !== 'kanto:champion').length;
  }

  function contextFor(saveId: string): BattleContext {
    const egg = inventory.quantity(saveId, 'lucky-egg') > 0 ? luckyEggMultiplier(extraGenerations(saveId)) : 1;
    return { ...ctxBase, expMultiplier: egg };
  }

  function load(saveId: string): BattleState | null {
    const row = db.prepare('SELECT state FROM battles WHERE save_id = ?').get(saveId) as { state: string } | undefined;
    return row ? (JSON.parse(row.state) as BattleState) : null;
  }

  function save(saveId: string, state: BattleState): void {
    db.prepare(`
      INSERT INTO battles (save_id, state, created_at) VALUES (?, ?, ?)
      ON CONFLICT (save_id) DO UPDATE SET state = excluded.state
    `).run(saveId, JSON.stringify(state), new Date().toISOString());
  }

  function monView(c: Combatant, index: number): BattleMonView {
    const species = ctxBase.species(c.speciesId);
    const stages = Object.fromEntries(Object.entries(c.stages).filter(([, value]) => value !== 0));
    return {
      index, speciesId: c.speciesId, name: c.name, level: c.level, hp: c.hp, maxHp: c.stats.hp, status: c.status, confused: c.confusion > 0,
      shiny: c.shiny, types: c.types, stages, expProgress: levelProgress(species.growthRate, c.level, c.exp),
    };
  }

  function captureInput(saveId: string, state: BattleState, ball: string): CaptureInput {
    const foe = activeOf(state, 'foe');
    const species = ctxBase.species(foe.speciesId);
    return {
      maxHp: foe.stats.hp,
      currentHp: foe.hp,
      captureRate: species.captureRate,
      ball,
      catchingCharm: inventory.quantity(saveId, 'catching-charm') > 0,
      statusMultiplier: foe.status === 'sleep' || foe.status === 'freeze' ? 2 : foe.status ? 1.5 : 1,
      context: {
        types: foe.types, weight: species.weight, height: species.height, firstTurn: state.turn === 0,
        leadTypes: activeOf(state, 'player').types, asleep: foe.status === 'sleep',
      },
    };
  }

  function view(saveId: string, state: BattleState, outcome: BattleOutcome | null): BattleView {
    const me = activeOf(state, 'player');
    const foe = activeOf(state, 'foe');
    const moves: BattleMoveView[] = me.moves.map((slot, index) => {
      const move = data.movesByName.get(slot.name);
      return {
        slot: index, name: slot.name, displayName: move?.displayName ?? slot.name, type: move?.type ?? 'normal', category: move?.category ?? 'physical',
        power: move?.power ?? 0, accuracy: move?.accuracy ?? null,
        effectiveness: move && move.category !== 'status' ? effectiveness(data.typeChart, move.type, foe.types) : null,
      };
    });
    const owned = db.prepare('SELECT item, quantity FROM inventory WHERE save_id = ? AND quantity > 0').all(saveId) as { item: string; quantity: number }[];
    const quantities = new Map(owned.map((row) => [row.item, row.quantity]));
    const balls: BallOption[] = data.items
      .filter((item) => item.category === 'captura' && (quantities.get(item.name) ?? 0) > 0)
      .map((item) => ({
        item: item.name, displayName: item.displayName, description: item.description, quantity: quantities.get(item.name) ?? 0,
        chance: state.phase === 'ended' ? null : captureChance(captureInput(saveId, state, item.name)),
      }));
    const heals = data.items
      .filter((item) => item.name in HEAL_EFFECTS && (quantities.get(item.name) ?? 0) > 0)
      .map((item) => ({ item: item.name, displayName: item.displayName, quantity: quantities.get(item.name) ?? 0 }));
    const caughtBefore = (db.prepare('SELECT caught FROM pokedex WHERE save_id = ? AND species_id = ?').get(saveId, foe.speciesId) as { caught: number } | undefined)?.caught === 1;
    return {
      phase: state.phase,
      turn: state.turn,
      player: { active: state.player.active, team: state.player.team.map(monView), moves },
      foe: { active: state.foe.active, team: state.foe.team.map(monView), caughtBefore: caughtBefore || outcome?.result === 'captured' },
      balls,
      heals,
      outcome,
    };
  }

  /** Encerra a batalha: grava XP/níveis, cura a equipe, paga o dinheiro e libera o mapa. */
  function finalize(saveId: string, state: BattleState, events: BattleEvent[], ball: string | null): BattleOutcome {
    const result = state.result as NonNullable<BattleState['result']>;
    const before = new Map(
      (db.prepare('SELECT id, level FROM pokemon WHERE save_id = ?').all(saveId) as { id: string; level: number }[]).map((row) => [row.id, row.level]),
    );
    let caught: PokemonView | null = null;
    let money = 0;
    const foe = activeOf(state, 'foe');
    if (result === 'captured') {
      const original = wild.encounter(saveId);
      const species = ctxBase.species(original.speciesId);
      const healed: PokemonInstance = { ...original, currentHp: statsOf(original, species).hp, ball };
      caught = store.view(saveId, store.place(saveId, healed).id);
    }
    if (result === 'win') {
      const bonus = inventory.quantity(saveId, 'amulet-coin') > 0 ? amuletCoinMultiplier(extraGenerations(saveId)) : 1;
      money = Math.floor(foe.level * 10 * bonus);
      db.prepare('UPDATE saves SET money = money + ?, updated_at = ? WHERE id = ?').run(money, new Date().toISOString(), saveId);
      events.push({ k: 'money', amount: money, text: `Você ganhou ₽ ${money.toLocaleString('pt-BR')}!` });
    }
    store.applyBattle(saveId, state.player.team);
    wild.finishEncounter(saveId, result);
    db.prepare('DELETE FROM battles WHERE save_id = ?').run(saveId);
    if (caught) caught = store.view(saveId, caught.id);
    const levels = state.player.team.filter((c) => c.ref && c.level > (before.get(c.ref) ?? c.level)).map((c) => ({ name: c.name, level: c.level }));
    const pending = state.player.team.filter((c) => c.pendingMoves.length > 0).map((c) => c.name);
    return { result, money, caught, levels, pending };
  }

  function commit(saveId: string, state: BattleState, events: BattleEvent[], ball: string | null = null): BattleTurnResult {
    let outcome: BattleOutcome | null = null;
    if (state.phase === 'ended') outcome = finalize(saveId, state, events, ball);
    else save(saveId, state);
    return { events, view: view(saveId, state, outcome) };
  }

  return {
    /** A batalha em andamento (null se não há). */
    current(saveId: string): BattleView | null {
      assertSave(saveId);
      const state = load(saveId);
      return state ? view(saveId, state, null) : null;
    },

    /** Começa a luta contra o selvagem escolhido no mapa. */
    start(saveId: string): BattleTurnResult {
      assertSave(saveId);
      if (load(saveId)) throw badRequest('Já há uma batalha em andamento.');
      const foe = wild.encounter(saveId);
      const team = store.team(saveId);
      if (team.length === 0) throw badRequest('Você não tem Pokémon na equipe.');
      return transaction(db, () => {
        const player = team.map((mon) => {
          const species = ctxBase.species(mon.speciesId);
          const instance: PokemonInstance = {
            speciesId: mon.speciesId, nickname: mon.nickname, level: mon.level, exp: mon.exp, shiny: mon.shiny, gender: mon.gender, ivs: mon.ivs,
            moves: mon.moves.map((m) => ({ name: m.name, pp: m.pp, maxPp: m.maxPp })), currentHp: mon.currentHp, friendship: mon.friendship, ball: mon.ball, form: null,
          };
          return combatantFrom(instance, species, mon.name, mon.id);
        });
        const species = ctxBase.species(foe.speciesId);
        const wildCombatant = combatantFrom(foe, species, species.displayName);
        if (!player.some((c) => c.hp > 0)) throw badRequest('Nenhum Pokémon da equipe pode lutar. Use poções ou revivers.');
        const { state, events } = createBattle({ player, foe: [wildCombatant], seed: seedOf() });
        save(saveId, state);
        return { events, view: view(saveId, state, null) };
      });
    },

    /** Uma ação do jogador: golpe, troca, fuga, bola ou item de cura. */
    act(saveId: string, request: unknown): BattleTurnResult {
      assertSave(saveId);
      const state = load(saveId);
      if (!state) throw badRequest('Não há batalha em andamento.');
      const input = (request ?? {}) as Partial<BattleActRequest> & { [key: string]: unknown };
      const ctx = contextFor(saveId);
      try {
        return transaction(db, () => {
          switch (input.kind) {
            case 'move': {
              const result = chooseAction(state, { kind: 'move', slot: Number(input.slot) }, ctx);
              return commit(saveId, result.state, result.events);
            }
            case 'switch': {
              const result = chooseAction(state, { kind: 'switch', to: Number(input.to) }, ctx);
              return commit(saveId, result.state, result.events);
            }
            case 'run': {
              if (state.phase !== 'choose') throw badRequest('Escolha o próximo Pokémon primeiro.');
              const result = chooseAction(state, { kind: 'run' }, ctx);
              return commit(saveId, result.state, result.events);
            }
            case 'ball': {
              if (state.phase !== 'choose') throw badRequest('Escolha o próximo Pokémon primeiro.');
              const item = typeof input.item === 'string' ? data.itemsByName.get(input.item) : undefined;
              if (!item || item.category !== 'captura') throw badRequest('Escolha uma POKÉ BOLA.');
              if (!inventory.take(saveId, item.name)) throw badRequest(`Você não tem ${item.displayName}.`);
              const rng = resumableRng(state.rng);
              const capture = attemptCapture(rng, captureInput(saveId, state, item.name));
              const next: BattleState = { ...state, rng: rng.state };
              const throwText = `Você lançou ${item.displayName}!`;
              if (capture.caught) {
                const result = finishCapture(next, ctx, item.name, capture.shakes, `${throwText} Capturou ${activeOf(next, 'foe').name}!`);
                return commit(saveId, result.state, result.events, item.name);
              }
              const result = failedThrow(next, ctx, item.name, capture.shakes, `${throwText} ${activeOf(next, 'foe').name} escapou!`);
              return commit(saveId, result.state, result.events);
            }
            case 'item': {
              if (state.phase !== 'choose') throw badRequest('Escolha o próximo Pokémon primeiro.');
              const name = typeof input.item === 'string' ? input.item : '';
              const item = data.itemsByName.get(name);
              const target = state.player.team[Number(input.target)];
              if (!item || !(name in HEAL_EFFECTS) || !target) throw badRequest('Item ou alvo inválido.');
              const used = applyHealItem(name, target.hp, target.stats.hp);
              if (!used.ok) throw badRequest(used.reason);
              if (!inventory.take(saveId, name)) throw badRequest(`Você não tem ${item.displayName}.`);
              const next: BattleState = JSON.parse(JSON.stringify(state)) as BattleState;
              const mon = next.player.team[Number(input.target)] as Combatant;
              mon.hp = used.newHp;
              if (name === 'full-restore') { mon.status = null; mon.confusion = 0; }
              const result = chooseAction(next, { kind: 'pass', text: `Você usou ${item.displayName} em ${mon.name}! Recuperou ${used.healed} HP.` }, ctx);
              if (Number(input.target) === next.player.active) result.events.unshift({ k: 'heal', side: 'player', amount: used.healed, hp: mon.hp, maxHp: mon.stats.hp, text: '' });
              return commit(saveId, result.state, result.events);
            }
            default:
              throw badRequest('Ação de batalha desconhecida.');
          }
        });
      } catch (error) {
        if (error instanceof Error && !('status' in error)) throw badRequest(error.message);
        throw error;
      }
    },
  };
}
export type BattleService = ReturnType<typeof createBattleService>;
