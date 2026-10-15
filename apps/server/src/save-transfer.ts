import { randomUUID } from 'node:crypto';
import { transaction, type Db } from './db.ts';
import { badRequest } from './errors.ts';
import { MAX_SAVES } from './saves.ts';

export const SAVE_FORMAT = 'pokesim-save';
export const SAVE_FORMAT_VERSION = 1;

export interface SaveExport {
  format: typeof SAVE_FORMAT;
  formatVersion: number;
  /** versão do esquema do banco que gerou o arquivo (PRAGMA user_version) */
  schema: number;
  gameVersion: string;
  exportedAt: string;
  tables: Record<string, Record<string, string | number | null>[]>;
}

type Row = Record<string, string | number | null>;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function schemaVersion(db: Db): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
}

function columnsOf(db: Db, table: string): string[] {
  return (db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map((c) => c.name);
}

/** Tabelas de dados do jogador: as que têm save_id, as filhas de pokemon e a própria saves. */
function saveTables(db: Db): { name: string; kind: 'saves' | 'save' | 'pokemon' }[] {
  const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((t) => t.name);
  const result: { name: string; kind: 'saves' | 'save' | 'pokemon' }[] = [];
  for (const name of names) {
    const cols = columnsOf(db, name);
    if (name === 'saves') result.push({ name, kind: 'saves' });
    else if (cols.includes('save_id')) result.push({ name, kind: 'save' });
    else if (cols.includes('pokemon_id')) result.push({ name, kind: 'pokemon' });
  }
  // saves e pokemon primeiro, para as chaves estrangeiras
  const rank = (t: { name: string }) => (t.name === 'saves' ? 0 : t.name === 'pokemon' ? 1 : 2);
  return result.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export function exportSave(db: Db, saveId: string, gameVersion = 'dev'): SaveExport {
  const tables: SaveExport['tables'] = {};
  for (const table of saveTables(db)) {
    const sql = table.kind === 'saves'
      ? 'SELECT * FROM saves WHERE id = ?'
      : table.kind === 'save'
        ? `SELECT * FROM "${table.name}" WHERE save_id = ?`
        : `SELECT * FROM "${table.name}" WHERE pokemon_id IN (SELECT id FROM pokemon WHERE save_id = ?)`;
    tables[table.name] = (db.prepare(sql).all(saveId) as Row[]).map((row) => ({ ...row }));
  }
  return { format: SAVE_FORMAT, formatVersion: SAVE_FORMAT_VERSION, schema: schemaVersion(db), gameVersion, exportedAt: new Date().toISOString(), tables };
}

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.values(value).every((v) => v === null || typeof v === 'string' || typeof v === 'number');
}

/** Importa um save exportado como um save NOVO (todos os ids são trocados). Devolve o id do novo save. */
export function importSave(db: Db, payload: unknown): string {
  const file = payload as Partial<SaveExport> | null;
  if (!file || file.format !== SAVE_FORMAT || typeof file.tables !== 'object' || file.tables === null) {
    throw badRequest('Este arquivo não é um save exportado do Pokémon Simulator.');
  }
  if (typeof file.formatVersion !== 'number' || file.formatVersion > SAVE_FORMAT_VERSION) throw badRequest('Arquivo de uma versão mais nova do jogo. Atualize o jogo para importar.');
  if (typeof file.schema !== 'number' || file.schema > schemaVersion(db)) throw badRequest('Save de uma versão mais nova do jogo. Atualize o jogo para importar.');
  const savesRows = file.tables.saves;
  if (!Array.isArray(savesRows) || savesRows.length !== 1) throw badRequest('O arquivo precisa conter exatamente um save.');

  // Troca todos os UUIDs (save, Pokémon, equipes…) de uma vez, inclusive os guardados dentro de JSON.
  const map = new Map<string, string>();
  const text = JSON.stringify(file.tables).replace(UUID, (id) => {
    const key = id.toLowerCase();
    let fresh = map.get(key);
    if (!fresh) { fresh = randomUUID(); map.set(key, fresh); }
    return fresh;
  });
  const tables = JSON.parse(text) as Record<string, unknown>;

  const known = new Map(saveTables(db).map((t) => [t.name, t]));
  return transaction(db, () => {
    const count = (db.prepare('SELECT COUNT(*) AS n FROM saves').get() as { n: number }).n;
    if (count >= MAX_SAVES) throw badRequest(`Limite de ${MAX_SAVES} saves atingido. Apague um antes de importar.`);
    let newSaveId = '';
    for (const [name] of [...known.entries()]) {
      const rows = tables[name];
      if (rows === undefined) continue;
      if (!Array.isArray(rows)) throw badRequest(`Tabela inválida no arquivo: ${name}.`);
      const columns = new Set(columnsOf(db, name));
      for (const row of rows) {
        if (!isRow(row)) throw badRequest(`Linha inválida na tabela ${name}.`);
        const entries = Object.entries(row).filter(([column]) => columns.has(column) && !(name === 'events' && column === 'id'));
        if (!entries.length) continue;
        if (name === 'saves') newSaveId = String(row.id);
        db.prepare(`INSERT INTO "${name}" (${entries.map(([c]) => `"${c}"`).join(', ')}) VALUES (${entries.map(() => '?').join(', ')})`)
          .run(...entries.map(([, v]) => v));
      }
    }
    if (!newSaveId) throw badRequest('Save inválido no arquivo.');
    return newSaveId;
  });
}
