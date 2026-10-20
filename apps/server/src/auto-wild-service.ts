import type { AutoWildReport, AutoWildResult, BattleMoveView, BattleView, WildSlotView } from '@pokesim/engine';
import { badRequest } from './errors.ts';
import type { WildService } from './wild-service.ts';
import type { BattleService } from './battle-service.ts';

/** Segurança contra laço infinito: nenhuma luta selvagem razoável passa disso. */
const MAX_ACTIONS_PER_FIGHT = 300;

/** Pontuação simples de golpe: poder × vantagem de tipo × STAB × precisão. */
function moveScore(move: BattleMoveView, userTypes: readonly string[]): number {
  if (move.category === 'status' || move.power <= 0) return 0;
  return move.power * (move.effectiveness ?? 1) * (userTypes.includes(move.type) ? 1.5 : 1) * ((move.accuracy ?? 100) / 100);
}

export function pickMove(view: BattleView): number {
  const user = view.player.team[view.player.active];
  const scored = view.player.moves.map((move) => ({ slot: move.slot, score: moveScore(move, user?.types ?? []) }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.slot ?? 0;
}

/**
 * Auto-batalha: luta com todos os Pokémon do mapa atual, um por vez, usando o melhor golpe de cada turno.
 * Para antes de começar se houver um shiny ou ★★★★ no mapa (para o jogador decidir) e quando a equipe cai.
 * O giro entre um mapa e outro fica com o cliente, que pode interromper a qualquer momento.
 */
export function createAutoWildService(wild: WildService, battle: BattleService) {
  return {
    /** `lead` (opcional): id do Pokémon da equipe que abre cada luta; os outros só entram se ele cair. */
    /** `solo` (com `lead`): só ele luta; se desmaiar, a auto-batalha para ao fim da luta. */
    run(saveId: string, lead?: unknown, solo?: unknown): AutoWildResult {
      if (lead !== undefined && lead !== null && typeof lead !== 'string') throw badRequest('Pokémon inválido.');
      const initial = wild.state(saveId);
      if (!initial.board) throw badRequest('Procure um selvagem primeiro.');
      if (initial.chosen !== null) throw badRequest('Termine o encontro atual primeiro.');
      if (battle.current(saveId)) throw badRequest('Termine a batalha em andamento primeiro.');
      if (typeof lead === 'string' && lead) battle.assertLead(saveId, lead);
      const onlyLead = solo === true && typeof lead === 'string' && lead !== '';

      const report: AutoWildReport = { fights: 0, wins: 0, losses: 0, money: 0, levelUps: [], stopped: null };
      const levels = new Map<string, number>();
      const special = (slot: WildSlotView) => slot.shiny || slot.ivStars >= 4;

      const flagged = initial.board.slots.find(special);
      if (flagged) {
        report.stopped = {
          reason: flagged.shiny ? 'shiny' : 'stars',
          message: `${flagged.shiny ? '✨ Shiny' : '★★★★'} no mapa: ${flagged.name} Nv ${flagged.level}! A auto-batalha parou para você decidir.`,
          slot: { slot: flagged.slot, speciesId: flagged.speciesId, name: flagged.name, level: flagged.level, shiny: flagged.shiny, ivStars: flagged.ivStars },
        };
        return { report, state: initial };
      }

      for (const slot of initial.board.slots) {
        wild.choose(saveId, slot.slot);
        let view = battle.start(saveId, typeof lead === 'string' && lead ? lead : null).view;
        let leadFell = false;
        for (let guard = 0; view.outcome === null; guard++) {
          if (guard > MAX_ACTIONS_PER_FIGHT) throw badRequest('A auto-batalha foi interrompida: a luta não terminou.');
          if (view.phase === 'replace') {
            leadFell = true;
            const next = view.player.team.find((mon) => mon.hp > 0);
            view = battle.act(saveId, { kind: 'switch', to: next?.index ?? 0 }).view;
          } else {
            view = battle.act(saveId, { kind: 'move', slot: pickMove(view) }).view;
          }
        }
        const outcome = view.outcome;
        report.fights++;
        if (outcome.fallen?.length) {
          report.stopped = { reason: 'defeat', message: `Modo difícil: ${outcome.fallen.join(', ')} foi perdido. A auto-batalha parou.` };
          if (outcome.result === 'win') { report.wins++; report.money += outcome.money; } else report.losses++;
          break;
        }
        if (outcome.result === 'win') {
          report.wins++;
          report.money += outcome.money;
          for (const up of outcome.levels) levels.set(up.name, up.level);
          if (onlyLead && leadFell) {
            report.stopped = { reason: 'lead', message: 'O lutador escolhido desmaiou, então a auto-batalha parou. Escolha outro (ou desmarque "Só ele luta").' };
            break;
          }
        } else {
          report.losses++;
          report.stopped = { reason: 'defeat', message: 'Sua equipe foi derrotada. A auto-batalha parou.' };
          break;
        }
      }
      report.levelUps = [...levels].map(([name, level]) => ({ name, level }));
      return { report, state: wild.state(saveId) };
    },
  };
}
