import {
  MAX_TOURNAMENT_PICKS, TOURNAMENT_ROUNDS, ALL_TOURNAMENT_TIERS, tournamentTier,
  type BattleTurnResult, type DoublesTurnResult, type TeamMemberView, type TournamentRun, type TournamentState,
} from '@pokesim/engine';
import { loadGameData } from '@pokesim/data';
import { transaction, type Db } from './db.ts';
import { badRequest, notFound } from './errors.ts';
import type { PokemonStore } from './pokemon-store.ts';
import type { BattleService } from './battle-service.ts';
import type { DoublesService } from './doubles-service.ts';

/** Torneios por categoria: inscrição, rodadas e abandono. As batalhas rodam no serviço de batalha. */
export function createTournamentService(db: Db, store: PokemonStore, battle: BattleService, doubles: DoublesService) {
  const data = loadGameData();

  function money(saveId: string): number {
    const row = db.prepare('SELECT money FROM saves WHERE id = ?').get(saveId) as { money: number } | undefined;
    if (!row) throw notFound('Save não encontrado.');
    return row.money;
  }
  const member = (mon: { id: string; speciesId: number; spriteId: number; name: string; level: number; shiny: boolean }): TeamMemberView =>
    ({ id: mon.id, speciesId: mon.speciesId, spriteId: mon.spriteId, name: mon.name, level: mon.level, shiny: mon.shiny });

  function active(saveId: string): TournamentRun | null {
    const row = db.prepare('SELECT tier, round, members FROM tournaments WHERE save_id = ?').get(saveId) as { tier: string; round: number; members: string } | undefined;
    const tier = tournamentTier(row?.tier);
    if (!row || !tier) return null;
    const members = (JSON.parse(row.members) as string[]).map((id) => member(store.view(saveId, id)));
    const inBattle = Boolean(db.prepare('SELECT 1 FROM battles WHERE save_id = ?').get(saveId));
    return { tier: tier.id, tierName: tier.name, round: row.round, rounds: TOURNAMENT_ROUNDS, cap: tier.cap, members, inBattle };
  }

  function state(saveId: string): TournamentState {
    const now = money(saveId);
    const wins = new Map((db.prepare('SELECT tier, wins FROM tournament_wins WHERE save_id = ?').all(saveId) as { tier: string; wins: number }[]).map((row) => [row.tier, row.wins]));
    const itemName = (item: string) => data.itemsByName.get(item)?.displayName ?? item;
    return {
      money: now,
      tiers: ALL_TOURNAMENT_TIERS.map((tier) => ({
        id: tier.id, name: tier.name, description: tier.description, entry: tier.entry, cap: tier.cap, rounds: TOURNAMENT_ROUNDS,
        prizeMoney: tier.prize.money, prizeItems: tier.prize.items.map((entry) => ({ item: entry.item, name: entry.item === 'random-ball' ? 'Poké Bola especial' : itemName(entry.item), min: entry.min, max: entry.max })),
        essences: tier.prize.essences, minLevel: tier.minLevel, teamSize: [tier.minTeam, tier.maxTeam],
        wins: wins.get(tier.id) ?? 0, ...(tier.doubles ? { doubles: true } : {}),
      })),
      active: active(saveId),
      team: store.team(saveId).map(member),
    };
  }

  return {
    state,

    /** Inscreve a equipe escolhida e já começa a rodada 1. */
    enter(saveId: string, input: { tier?: unknown; members?: unknown }): BattleTurnResult | DoublesTurnResult {
      money(saveId);
      if (db.prepare('SELECT 1 FROM tournaments WHERE save_id = ?').get(saveId)) throw badRequest('Você já está em um torneio. Continue ou desista dele.');
      if (db.prepare('SELECT 1 FROM battles WHERE save_id = ?').get(saveId)) throw badRequest('Termine a batalha em andamento primeiro.');
      const tier = tournamentTier(input.tier);
      if (!tier) throw badRequest('Escolha uma categoria de torneio.');
      const ids = Array.isArray(input.members) ? input.members.filter((id): id is string => typeof id === 'string') : [];
      const minPicks = tier.doubles ? 2 : 1;
      if (ids.length < minPicks || ids.length > MAX_TOURNAMENT_PICKS || new Set(ids).size !== ids.length) throw badRequest(`Escolha de ${minPicks} a ${MAX_TOURNAMENT_PICKS} Pokémon da equipe.`);
      const team = new Set(store.team(saveId).map((mon) => mon.id));
      if (ids.some((id) => !team.has(id))) throw badRequest('Só Pokémon da equipe podem participar.');
      return transaction(db, () => {
        const paid = db.prepare('UPDATE saves SET money = money - ?, updated_at = ? WHERE id = ? AND money >= ?').run(tier.entry, new Date().toISOString(), saveId, tier.entry);
        if (Number(paid.changes) !== 1) throw badRequest(`Inscrição de ₽ ${tier.entry.toLocaleString('pt-BR')}: dinheiro insuficiente.`);
        db.prepare('INSERT INTO tournaments (save_id, tier, round, members, created_at) VALUES (?, ?, 1, ?, ?)').run(saveId, tier.id, JSON.stringify(ids), new Date().toISOString());
        return tier.doubles ? doubles.startTournamentRound(saveId) : battle.startTournamentRound(saveId);
      });
    },

    /** Começa a próxima rodada (depois de vencer a anterior). */
    next(saveId: string): BattleTurnResult | DoublesTurnResult {
      money(saveId);
      const row = db.prepare('SELECT tier FROM tournaments WHERE save_id = ?').get(saveId) as { tier: string } | undefined;
      return tournamentTier(row?.tier)?.doubles ? doubles.startTournamentRound(saveId) : battle.startTournamentRound(saveId);
    },

    /** Desiste do torneio: a inscrição não volta. */
    abandon(saveId: string): TournamentState {
      money(saveId);
      if (db.prepare('SELECT 1 FROM battles WHERE save_id = ?').get(saveId)) throw badRequest('Termine ou perca a batalha em andamento antes de desistir.');
      db.prepare('DELETE FROM tournaments WHERE save_id = ?').run(saveId);
      return state(saveId);
    },
  };
}
export type TournamentService = ReturnType<typeof createTournamentService>;
