import {
  MISSION_COMPLETION_REWARD, MISSION_DURATION_MS, generateMissions, missionPeriod, missionProgress, unlockedRegionIds,
  type HistoryState, type JourneyEvent, type Mission, type MissionClaimResult, type MissionView, type MissionsState,
} from '@pokesim/engine';
import { loadGameData } from '@pokesim/data';
import { transaction, type Db } from './db.ts';
import { badRequest, notFound } from './errors.ts';
import type { Inventory } from './inventory.ts';

const BONUS_INDEX = -1;

/** Missões a cada 2 horas, histórico e estatísticas da jornada. */
export function createJourneyService(db: Db, inventory: Inventory, now: () => number = Date.now) {
  const data = loadGameData();
  const itemName = (item: string) => data.itemsByName.get(item)?.displayName ?? item;

  function assertSave(saveId: string): void {
    if (!db.prepare('SELECT 1 FROM saves WHERE id = ?').get(saveId)) throw notFound('Save não encontrado.');
  }

  function context(saveId: string) {
    const period = missionPeriod(now());
    const startedAt = new Date(period * MISSION_DURATION_MS).toISOString();
    // as missões dependem só do que já estava concluído quando o período começou (não mudam no meio)
    const done = (db.prepare('SELECT challenge_id FROM badges WHERE save_id = ? AND won_at < ?').all(saveId, startedAt) as { challenge_id: string }[]).map((row) => row.challenge_id);
    const missions = generateMissions({ saveId, period, unlockedRegions: unlockedRegionIds(done), gymsWon: done.filter((id) => id.includes(':gym')).length });
    const events = db.prepare('SELECT kind, region, species_id AS speciesId, difficulty, tournament FROM events WHERE save_id = ? AND created_at >= ?').all(saveId, startedAt) as unknown as JourneyEvent[];
    const claimed = new Set((db.prepare('SELECT idx FROM mission_claims WHERE save_id = ? AND period = ?').all(saveId, period) as { idx: number }[]).map((row) => row.idx));
    return { period, missions, events, claimed };
  }

  const rewardView = (reward: Mission['reward']): MissionView['reward'] => ({
    money: reward.money, chips: reward.chips, items: reward.items.map((entry) => ({ ...entry, name: itemName(entry.item) })),
  });

  function state(saveId: string): MissionsState {
    assertSave(saveId);
    const { period, missions, events, claimed } = context(saveId);
    const views = missions.map((mission): MissionView => {
      const progress = Math.min(mission.target, missionProgress(mission, events));
      return { index: mission.index, kind: mission.kind, title: mission.title, target: mission.target, progress, done: progress >= mission.target, claimed: claimed.has(mission.index), reward: rewardView(mission.reward) };
    });
    const expiresAt = (period + 1) * MISSION_DURATION_MS;
    return {
      period, expiresAt: new Date(expiresAt).toISOString(), msLeft: expiresAt - now(),
      allDone: views.every((mission) => mission.done), bonusClaimed: claimed.has(BONUS_INDEX),
      bonus: rewardView({ money: MISSION_COMPLETION_REWARD.money, chips: MISSION_COMPLETION_REWARD.chips, items: [...MISSION_COMPLETION_REWARD.items] }),
      missions: views,
    };
  }

  function pay(saveId: string, reward: Mission['reward']): void {
    db.prepare('UPDATE saves SET money = money + ?, chips = chips + ?, updated_at = ? WHERE id = ?').run(reward.money, reward.chips, new Date().toISOString(), saveId);
    for (const entry of reward.items) inventory.add(saveId, entry.item, entry.quantity);
  }

  return {
    state,

    /** Resgata uma missão concluída; ao concluir as dez, o bônus final vem junto (uma vez só por período). */
    claim(saveId: string, input: { period?: unknown; index?: unknown }): MissionClaimResult {
      assertSave(saveId);
      const index = Number(input.index);
      return transaction(db, () => {
        const current = context(saveId);
        if (input.period !== current.period) throw badRequest('As missões foram renovadas. Atualize a tela.');
        const mission = current.missions[index];
        if (!mission) throw notFound('Missão não encontrada.');
        if (current.claimed.has(index)) throw badRequest('Recompensa já resgatada.');
        if (missionProgress(mission, current.events) < mission.target) throw badRequest('Missão ainda não concluída.');
        db.prepare('INSERT INTO mission_claims (save_id, period, idx) VALUES (?, ?, ?)').run(saveId, current.period, index);
        pay(saveId, mission.reward);
        const allDone = current.missions.every((entry) => missionProgress(entry, current.events) >= entry.target);
        let bonus: MissionClaimResult['bonus'] = null;
        if (allDone && !current.claimed.has(BONUS_INDEX)) {
          db.prepare('INSERT INTO mission_claims (save_id, period, idx) VALUES (?, ?, ?)').run(saveId, current.period, BONUS_INDEX);
          const reward = { money: MISSION_COMPLETION_REWARD.money, chips: MISSION_COMPLETION_REWARD.chips, items: [...MISSION_COMPLETION_REWARD.items] };
          pay(saveId, reward);
          bonus = rewardView(reward);
        }
        return { reward: rewardView(mission.reward), bonus, state: state(saveId) };
      });
    },

    /** Estatísticas e os 60 eventos mais recentes. */
    history(saveId: string): HistoryState {
      assertSave(saveId);
      const count = (where: string, ...args: (string | number)[]) =>
        (db.prepare(`SELECT COUNT(*) AS n FROM events WHERE save_id = ? AND ${where}`).get(saveId, ...args) as { n: number }).n;
      const row = db.prepare('SELECT play_time_seconds FROM saves WHERE id = ?').get(saveId) as { play_time_seconds?: number } | undefined;
      const sales = db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM events WHERE save_id = ? AND kind = 'venda'").get(saveId) as { total: number };
      return {
        stats: {
          victories: count("kind = 'batalha' AND result = 'vitoria'"),
          defeats: count("kind = 'batalha' AND result = 'derrota'"),
          captures: count("kind = 'capturar'"),
          shinyEncounters: count("kind = 'shiny_encontrado'"),
          sold: count("kind = 'venda'"),
          trainersBeaten: count("kind = 'vencer_treinador'"),
          tournamentTitles: count("kind = 'vencer_torneio'"),
          moneyEarnedSales: sales.total,
          pokemonOwned: (db.prepare('SELECT COUNT(*) AS n FROM pokemon WHERE save_id = ?').get(saveId) as { n: number }).n,
          speciesCaught: (db.prepare('SELECT COUNT(*) AS n FROM pokedex WHERE save_id = ? AND caught = 1').get(saveId) as { n: number }).n,
          playTimeSeconds: row?.play_time_seconds ?? 0,
        },
        events: (db.prepare("SELECT id, kind, text, created_at AS at FROM events WHERE save_id = ? AND text <> '' ORDER BY id DESC LIMIT 60").all(saveId)) as unknown as HistoryState['events'],
      };
    },
  };
}
export type JourneyService = ReturnType<typeof createJourneyService>;
