import { randomUUID } from 'node:crypto';
import { MAX_TEAMS, MAX_TEAM_NAME, TEAM_SIZE, type TeamView } from '@pokesim/engine';
import { transaction, type Db } from './db.ts';
import { badRequest, notFound } from './errors.ts';
import type { PokemonStore } from './pokemon-store.ts';

interface TeamRow {
  id: string;
  save_id: string;
  name: string;
  members: string;
  created_at: string;
}

/** Equipes nomeadas: guardam a ordem de até 6 Pokémon e montam a equipe com um clique. */
export function createTeamService(db: Db, store: PokemonStore) {
  function assertSave(saveId: string): void {
    if (!db.prepare('SELECT 1 FROM saves WHERE id = ?').get(saveId)) throw notFound('Save não encontrado.');
  }
  function getRow(saveId: string, id: string): TeamRow {
    const row = db.prepare('SELECT * FROM teams WHERE id = ? AND save_id = ?').get(id, saveId) as TeamRow | undefined;
    if (!row) throw notFound('Equipe não encontrada.');
    return row;
  }
  function cleanName(value: unknown): string {
    const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
    if (name.length < 1 || name.length > MAX_TEAM_NAME) throw badRequest(`O nome da equipe deve ter de 1 a ${MAX_TEAM_NAME} letras.`);
    return name;
  }
  function currentIds(saveId: string): string[] {
    return store.team(saveId).map((mon) => mon.id);
  }

  function list(saveId: string): TeamView[] {
    assertSave(saveId);
    const current = currentIds(saveId).join(',');
    const rows = db.prepare('SELECT * FROM teams WHERE save_id = ? ORDER BY created_at, rowid').all(saveId) as unknown as TeamRow[];
    return rows.map((row) => {
      const ids = JSON.parse(row.members) as string[];
      const members = ids.flatMap((id) => {
        try {
          const mon = store.view(saveId, id);
          return [{ id: mon.id, speciesId: mon.speciesId, spriteId: mon.spriteId, name: mon.name, level: mon.level, shiny: mon.shiny }];
        } catch { return []; } // Pokémon que não existe mais
      });
      return { id: row.id, name: row.name, members, active: members.map((m) => m.id).join(',') === current };
    });
  }

  return {
    list,

    /** Guarda a equipe montada agora com este nome. */
    create(saveId: string, input: { name?: unknown }): TeamView[] {
      assertSave(saveId);
      const name = cleanName(input.name);
      const ids = currentIds(saveId);
      if (ids.length === 0) throw badRequest('Monte uma equipe antes de salvá-la.');
      const count = (db.prepare('SELECT COUNT(*) AS n FROM teams WHERE save_id = ?').get(saveId) as { n: number }).n;
      if (count >= MAX_TEAMS) throw badRequest(`Limite de ${MAX_TEAMS} equipes. Apague uma antes.`);
      db.prepare('INSERT INTO teams (id, save_id, name, members, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(randomUUID(), saveId, name, JSON.stringify(ids.slice(0, TEAM_SIZE)), new Date().toISOString());
      return list(saveId);
    },

    /** Renomeia e/ou regrava a equipe com os Pokémon montados agora. */
    update(saveId: string, id: string, input: { name?: unknown; useCurrent?: unknown }): TeamView[] {
      const row = getRow(saveId, id);
      const name = input.name === undefined ? row.name : cleanName(input.name);
      let members = row.members;
      if (input.useCurrent === true) {
        const ids = currentIds(saveId);
        if (ids.length === 0) throw badRequest('Você não tem Pokémon na equipe.');
        members = JSON.stringify(ids);
      }
      db.prepare('UPDATE teams SET name = ?, members = ? WHERE id = ?').run(name, members, row.id);
      return list(saveId);
    },

    remove(saveId: string, id: string): TeamView[] {
      getRow(saveId, id);
      db.prepare('DELETE FROM teams WHERE id = ?').run(id);
      return list(saveId);
    },

    /** Monta esta equipe: quem sai vai para o PC, quem entra sai da caixa. */
    apply(saveId: string, id: string): TeamView[] {
      if (db.prepare('SELECT 1 FROM battles WHERE save_id = ?').get(saveId)) throw badRequest('Termine a batalha antes de trocar de equipe.');
      const row = getRow(saveId, id);
      transaction(db, () => store.applyTeam(saveId, JSON.parse(row.members) as string[]));
      return list(saveId);
    },
  };
}
export type TeamService = ReturnType<typeof createTeamService>;
