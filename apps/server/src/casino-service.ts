import { randomInt } from 'node:crypto';
import {
  CASINO_NAMES, CHIP_PRICE, MAX_BET, PIPLUP_ODDS, PIPLUP_PAYS, RACE_PAYOUT, RACE_RUNNERS, ROUND_GAMES, VOLTORB_MAX_PICKS, VOLTORB_SIZE,
  colorOf, dealJack, groupOf, handValue, ivQuality, jackDouble, jackHit, jackMultiplier, newVoltorb, parseRouletteBet, piplupJump, piplupMultiplier,
  isLegendary, pokemonPrize, saleValue, rngFrom, roulettePayout, runRace, spinRoulette, spinSlots, spinWheel, finishJack, voltorbMultiplier,
  type CasinoActResult, type CasinoDetail, type CasinoGame, type CasinoPrize, type CasinoResult, type CasinoRoundView, type CasinoStakeInput,
  type CasinoStakeResult, type CasinoState, type JackState, type PiplupState, type VoltorbState,
} from '@pokesim/engine';
import { loadGameData } from '@pokesim/data';
import { transaction, type Db } from './db.ts';
import { badRequest, notFound } from './errors.ts';
import type { PokemonStore } from './pokemon-store.ts';
import type { Inventory } from './inventory.ts';

/** Prêmios que se compram com fichas (Pedra Brilhante e Essências seguem o jogo antigo; os demais são estimativas). */
export const CASINO_PRIZES: readonly { item: string; price: number }[] = [
  { item: 'master-ball', price: 100_000 },
  { item: 'shiny-stone', price: 350_000 },
  { item: 'rare-candy', price: 5_000 },
  { item: 'exp-candy-p', price: 2_000 },
  { item: 'exp-candy-m', price: 7_000 },
  { item: 'exp-candy-g', price: 22_000 },
  { item: 'exp-candy-gg', price: 65_000 },
  { item: 'iv-hp', price: 1_000 }, { item: 'iv-attack', price: 1_000 }, { item: 'iv-defense', price: 1_000 },
  { item: 'iv-special-attack', price: 1_000 }, { item: 'iv-special-defense', price: 1_000 }, { item: 'iv-speed', price: 1_000 },
];


/** Quem está em jogo: fichas debitadas ou um Pokémon em risco. */
interface Stake {
  kind: 'chips' | 'pokemon';
  bet: number;
  pokemonId: string | null;
  pokemonName: string | null;
  value: number;
}

interface Round {
  game: CasinoGame;
  stake: Stake;
  state: VoltorbState | JackState | PiplupState;
}

const rng = rngFrom(randomInt);

/** Pokécassino: sete jogos com fichas (ou um Pokémon em risco), rodadas salvas e loja de prêmios. */
export function createCasinoService(db: Db, store: PokemonStore, inventory: Inventory) {
  const data = loadGameData();

  function save(saveId: string): { chips: number; money: number } {
    const row = db.prepare('SELECT chips, money FROM saves WHERE id = ?').get(saveId) as { chips: number; money: number } | undefined;
    if (!row) throw notFound('Save não encontrado.');
    return row;
  }
  function touch(saveId: string): void {
    db.prepare('UPDATE saves SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), saveId);
  }
  function loadRound(saveId: string): Round | null {
    const row = db.prepare('SELECT game, state FROM casino_rounds WHERE save_id = ?').get(saveId) as { game: CasinoGame; state: string } | undefined;
    if (!row) return null;
    const parsed = JSON.parse(row.state) as { stake: Stake; state: Round['state'] };
    return { game: row.game, stake: parsed.stake, state: parsed.state };
  }
  function saveRound(saveId: string, round: Round): void {
    db.prepare(`
      INSERT INTO casino_rounds (save_id, game, state, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (save_id) DO UPDATE SET state = excluded.state
    `).run(saveId, round.game, JSON.stringify({ stake: round.stake, state: round.state }), new Date().toISOString());
  }
  const dropRound = (saveId: string) => { db.prepare('DELETE FROM casino_rounds WHERE save_id = ?').run(saveId); };
  function assertNoRound(saveId: string): void {
    if (loadRound(saveId)) throw badRequest('Termine ou abandone a rodada em andamento antes de continuar.');
  }

  /** Debita as fichas ou trava o Pokémon da aposta. */
  function takeStake(saveId: string, input: CasinoStakeInput): Stake {
    if (typeof input.pokemonId === 'string' && input.pokemonId) {
      const mon = store.view(saveId, input.pokemonId);
      if (mon.favorite) throw badRequest('Pokémon favorito não pode ser apostado.');
      if (store.count(saveId) < 2) throw badRequest('Você precisa manter ao menos um Pokémon.');
      const species = data.speciesById.get(mon.speciesId);
      const value = saleValue({
        level: mon.level, ball: mon.ball, legendary: Boolean(species && isLegendary(species)), shiny: mon.shiny,
        ivMultiplier: ivQuality(mon.ivs).valueMultiplier, invested: store.investedOf(saveId, mon.id),
      });
      return { kind: 'pokemon', bet: 0, pokemonId: mon.id, pokemonName: mon.name, value };
    }
    const bet = Number(input.bet);
    if (!Number.isInteger(bet) || bet < 1) throw badRequest('Aposte ao menos 1 ficha.');
    if (bet > MAX_BET) throw badRequest(`A aposta máxima é ${MAX_BET.toLocaleString('pt-BR')} fichas.`);
    const result = db.prepare('UPDATE saves SET chips = chips - ? WHERE id = ? AND chips >= ?').run(bet, saveId, bet);
    if (Number(result.changes) !== 1) throw badRequest('Fichas insuficientes. Compre mais na loja de fichas.');
    return { kind: 'chips', bet, pokemonId: null, pokemonName: null, value: 0 };
  }

  /** Acerta as contas: devolve o retorno em fichas ou paga/tira o Pokémon. */
  function settle(saveId: string, stake: Stake, multiplier: number, spent = stake.bet): CasinoStakeResult {
    if (stake.kind === 'chips') {
      const payout = Math.floor(spent * multiplier);
      if (payout > 0) db.prepare('UPDATE saves SET chips = chips + ? WHERE id = ?').run(payout, saveId);
      return { kind: 'chips', bet: spent, payout, net: payout - spent, multiplier, pokemon: null };
    }
    const mon = store.view(saveId, stake.pokemonId as string);
    const prize = pokemonPrize(stake.value, multiplier);
    const prizeChips = Math.floor(prize / CHIP_PRICE);
    const lost = multiplier < 1;
    if (prize > 0) db.prepare('UPDATE saves SET money = money + ?, chips = chips + ? WHERE id = ?').run(prize, prizeChips, saveId);
    if (lost) store.remove(saveId, mon.id);
    return {
      kind: 'pokemon', bet: 0, payout: prizeChips, net: prizeChips, multiplier,
      pokemon: { name: mon.name, speciesId: mon.speciesId, spriteId: mon.spriteId, value: stake.value, lost, prizeMoney: prize, prizeChips },
    };
  }

  function result(saveId: string, game: CasinoGame, stake: CasinoStakeResult, detail: CasinoDetail): CasinoResult {
    touch(saveId);
    const now = save(saveId);
    return { game, stake, detail, chips: now.chips, money: now.money };
  }

  const stakeView = (stake: Stake) => ({ kind: stake.kind, bet: stake.bet, pokemonName: stake.pokemonName });

  function viewOf(round: Round): CasinoRoundView {
    const stake = stakeView(round.stake);
    if (round.game === 'voltorb') {
      const state = round.state as VoltorbState;
      return {
        game: 'voltorb', stake,
        revealed: state.revealed.map((index) => ({ index, value: state.board[index] as number })),
        picksLeft: VOLTORB_MAX_PICKS - state.revealed.length,
        multiplier: voltorbMultiplier(state),
      };
    }
    if (round.game === 'jack') {
      const state = round.state as JackState;
      return {
        game: 'jack', stake, player: state.player, dealer: state.dealer.slice(0, 1),
        playerTotal: handValue(state.player).total, canDouble: state.player.length === 2 && !state.doubled && round.stake.kind === 'chips',
      };
    }
    const state = round.state as PiplupState;
    return {
      game: 'piplup', stake, jumps: state.jumps, multiplier: piplupMultiplier(state.jumps),
      nextOdds: PIPLUP_ODDS[state.jumps] ?? 0, nextMultiplier: PIPLUP_PAYS[state.jumps] ?? 0,
    };
  }

  function finishVoltorb(saveId: string, round: Round, hit: boolean): CasinoResult {
    const state = round.state as VoltorbState;
    dropRound(saveId);
    const multiplier = hit ? 0 : voltorbMultiplier(state);
    return result(saveId, 'voltorb', settle(saveId, round.stake, multiplier), { game: 'voltorb', board: state.board, revealed: state.revealed, hit });
  }
  function finishJackRound(saveId: string, round: Round): CasinoResult {
    const state = round.state as JackState;
    dropRound(saveId);
    const spent = round.stake.bet * (state.doubled ? 2 : 1);
    const multiplier = jackMultiplier(state) / (state.doubled ? 2 : 1);
    return result(saveId, 'jack', settle(saveId, round.stake, multiplier, spent), { game: 'jack', player: state.player, dealer: state.dealer, result: state.result, doubled: state.doubled });
  }
  function finishPiplup(saveId: string, round: Round, fell: boolean): CasinoResult {
    const state = round.state as PiplupState;
    dropRound(saveId);
    return result(saveId, 'piplup', settle(saveId, round.stake, fell ? 0 : piplupMultiplier(state.jumps)), { game: 'piplup', jumps: state.jumps, fell });
  }

  const state = (saveId: string): CasinoState => {
    const now = save(saveId);
    const round = loadRound(saveId);
    return {
      chips: now.chips, money: now.money, chipPrice: CHIP_PRICE,
      prizes: CASINO_PRIZES.map((prize): CasinoPrize => ({ item: prize.item, displayName: data.itemsByName.get(prize.item)?.displayName ?? prize.item, price: prize.price, owned: inventory.quantity(saveId, prize.item) })),
      round: round ? viewOf(round) : null,
    };
  };

  return {
    state,

    /** Compra fichas com Pokédólares (5 ₽ cada). */
    buyChips(saveId: string, input: { amount?: unknown }): CasinoState {
      save(saveId);
      assertNoRound(saveId);
      const amount = Number(input.amount);
      if (!Number.isInteger(amount) || amount < 1 || amount > 10_000_000) throw badRequest('Escolha quantas fichas comprar.');
      const cost = amount * CHIP_PRICE;
      transaction(db, () => {
        const result = db.prepare('UPDATE saves SET money = money - ?, chips = chips + ?, updated_at = ? WHERE id = ? AND money >= ?')
          .run(cost, amount, new Date().toISOString(), saveId, cost);
        if (Number(result.changes) !== 1) throw badRequest(`Dinheiro insuficiente: ${amount.toLocaleString('pt-BR')} fichas custam ₽ ${cost.toLocaleString('pt-BR')}.`);
      });
      return state(saveId);
    },

    /** Troca fichas por um prêmio (Master Bola, Pedra Brilhante, Doces, Essências). */
    buyPrize(saveId: string, input: { item?: unknown; quantity?: unknown }): CasinoState {
      save(saveId);
      assertNoRound(saveId);
      const prize = CASINO_PRIZES.find((entry) => entry.item === input.item);
      if (!prize) throw badRequest('Esse prêmio não existe.');
      const quantity = input.quantity === undefined ? 1 : Number(input.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw badRequest('Quantidade inválida.');
      if (prize.item === 'shiny-stone' && inventory.quantity(saveId, prize.item) + quantity > 1) throw badRequest('Pedra Brilhante: só é possível ter uma.');
      transaction(db, () => {
        const cost = prize.price * quantity;
        const result = db.prepare('UPDATE saves SET chips = chips - ?, updated_at = ? WHERE id = ? AND chips >= ?').run(cost, new Date().toISOString(), saveId, cost);
        if (Number(result.changes) !== 1) throw badRequest('Fichas insuficientes para esse prêmio.');
        inventory.add(saveId, prize.item, quantity);
      });
      return state(saveId);
    },

    /** Jogos de uma jogada só: caça-níqueis, roleta, corrida e roda. */
    play(saveId: string, game: string, body: Record<string, unknown>): CasinoResult {
      save(saveId);
      assertNoRound(saveId);
      if (ROUND_GAMES.includes(game as CasinoGame) || !(game in CASINO_NAMES)) throw badRequest('Esse jogo não existe.');
      return transaction(db, () => {
        const input = body as CasinoStakeInput;
        switch (game) {
          case 'slots': {
            const stake = takeStake(saveId, input);
            const spin = spinSlots(rng);
            return result(saveId, 'slots', settle(saveId, stake, spin.multiplier), { game: 'slots', grid: spin.grid, lines: spin.lines });
          }
          case 'roulette': {
            const bet = parseRouletteBet(body.bet_on);
            if (!bet) throw badRequest('Escolha em que apostar na roleta.');
            const stake = takeStake(saveId, input);
            const n = spinRoulette(rng);
            return result(saveId, 'roulette', settle(saveId, stake, roulettePayout(bet, n)), { game: 'roulette', number: n, color: colorOf(n), group: groupOf(n) });
          }
          case 'race': {
            const pick = Number(body.pick);
            if (!Number.isInteger(pick) || pick < 0 || pick >= RACE_RUNNERS.length) throw badRequest('Escolha um corredor.');
            const stake = takeStake(saveId, input);
            const race = runRace(rng);
            return result(saveId, 'race', settle(saveId, stake, race.winner === pick ? RACE_PAYOUT : 0), { game: 'race', frames: race.frames, winner: race.winner, pick });
          }
          case 'wheel': {
            const stake = takeStake(saveId, input);
            const spin = spinWheel(rng);
            return result(saveId, 'wheel', settle(saveId, stake, spin.multiplier), { game: 'wheel', index: spin.index, multiplier: spin.multiplier });
          }
          default:
            throw badRequest('Esse jogo não existe.');
        }
      });
    },

    /** Começa uma rodada salva (Voltorb Flip, Pokejack ou Pula Piplup). */
    start(saveId: string, game: string, body: Record<string, unknown>): CasinoActResult {
      save(saveId);
      assertNoRound(saveId);
      if (!ROUND_GAMES.includes(game as CasinoGame)) throw badRequest('Esse jogo não tem rodadas.');
      return transaction(db, () => {
        const stake = takeStake(saveId, body as CasinoStakeInput);
        if (game === 'voltorb') {
          const round: Round = { game, stake, state: { stake: stake.bet, board: newVoltorb(rng), revealed: [] } };
          saveRound(saveId, round);
          return { round: viewOf(round), result: null, ...save(saveId) };
        }
        if (game === 'jack') {
          const dealt = dealJack(stake.bet, rng);
          const round: Round = { game, stake, state: dealt };
          if (dealt.done) return { round: null, result: finishJackRound(saveId, round), ...save(saveId) };
          saveRound(saveId, round);
          return { round: viewOf(round), result: null, ...save(saveId) };
        }
        const round: Round = { game: 'piplup', stake, state: { stake: stake.bet, jumps: 0 } };
        saveRound(saveId, round);
        return { round: viewOf(round), result: null, ...save(saveId) };
      });
    },

    /** Uma ação na rodada em andamento: virar carta, pedir/parar/dobrar, saltar, sacar. */
    act(saveId: string, body: { action?: unknown; index?: unknown }): CasinoActResult {
      save(saveId);
      const round = loadRound(saveId);
      if (!round) throw badRequest('Não há rodada em andamento.');
      return transaction(db, () => {
        const action = body.action;
        if (round.game === 'voltorb') {
          const state = round.state as VoltorbState;
          if (action === 'cashout') {
            if (state.revealed.length === 0) throw badRequest('Vire ao menos uma carta antes de sacar.');
            return { round: null, result: finishVoltorb(saveId, round, false), ...save(saveId) };
          }
          const index = Number(body.index);
          if (action !== 'flip' || !Number.isInteger(index) || index < 0 || index >= VOLTORB_SIZE * VOLTORB_SIZE) throw badRequest('Escolha uma carta.');
          if (state.revealed.includes(index)) throw badRequest('Essa carta já foi virada.');
          state.revealed.push(index);
          if (state.board[index] === 0) return { round: null, result: finishVoltorb(saveId, round, true), ...save(saveId) };
          if (state.revealed.length >= VOLTORB_MAX_PICKS) return { round: null, result: finishVoltorb(saveId, round, false), ...save(saveId) };
          saveRound(saveId, round);
          return { round: viewOf(round), result: null, ...save(saveId) };
        }
        if (round.game === 'jack') {
          const state = round.state as JackState;
          if (action === 'hit') jackHit(state);
          else if (action === 'stand') finishJack(state);
          else if (action === 'double') {
            if (state.player.length !== 2 || state.doubled) throw badRequest('Só dá para dobrar com as duas primeiras cartas.');
            if (round.stake.kind !== 'chips') throw badRequest('Não dá para dobrar apostando um Pokémon.');
            const paid = db.prepare('UPDATE saves SET chips = chips - ? WHERE id = ? AND chips >= ?').run(round.stake.bet, saveId, round.stake.bet);
            if (Number(paid.changes) !== 1) throw badRequest('Fichas insuficientes para dobrar.');
            jackDouble(state);
          } else throw badRequest('Ação inválida.');
          if (state.done) return { round: null, result: finishJackRound(saveId, round), ...save(saveId) };
          saveRound(saveId, round);
          return { round: viewOf(round), result: null, ...save(saveId) };
        }
        const state = round.state as PiplupState;
        if (action === 'cashout') {
          if (state.jumps === 0) throw badRequest('Salte ao menos uma vez antes de sacar.');
          return { round: null, result: finishPiplup(saveId, round, false), ...save(saveId) };
        }
        if (action !== 'jump') throw badRequest('Ação inválida.');
        if (piplupJump(state, rng) === 'fall') return { round: null, result: finishPiplup(saveId, round, true), ...save(saveId) };
        if (state.jumps >= PIPLUP_PAYS.length) return { round: null, result: finishPiplup(saveId, round, false), ...save(saveId) };
        saveRound(saveId, round);
        return { round: viewOf(round), result: null, ...save(saveId) };
      });
    },

    /** Desiste da rodada: a entrada é perdida (Voltorb: tudo; Pokejack: a mão perde; Piplup: cai). */
    abandon(saveId: string): CasinoActResult {
      save(saveId);
      const round = loadRound(saveId);
      if (!round) throw badRequest('Não há rodada em andamento.');
      return transaction(db, () => {
        if (round.game === 'voltorb') return { round: null, result: finishVoltorb(saveId, round, true), ...save(saveId) };
        if (round.game === 'jack') {
          const state = round.state as JackState;
          state.result = 'lose';
          state.done = true;
          return { round: null, result: finishJackRound(saveId, round), ...save(saveId) };
        }
        return { round: null, result: finishPiplup(saveId, round, true), ...save(saveId) };
      });
    },
  };
}
export type CasinoService = ReturnType<typeof createCasinoService>;
