import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Migrações em ordem. Para mudar o banco, adicione um item novo no final;
 * nunca edite um que já foi publicado.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE saves (
    id                TEXT PRIMARY KEY,
    trainer_name      TEXT NOT NULL,
    money             INTEGER NOT NULL DEFAULT 0,
    chips             INTEGER NOT NULL DEFAULT 0,
    play_time_seconds INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  );

  CREATE TABLE pokemon (
    id          TEXT PRIMARY KEY,
    save_id     TEXT NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
    species_id  INTEGER NOT NULL,
    nickname    TEXT,
    level       INTEGER NOT NULL,
    exp         INTEGER NOT NULL,
    current_hp  INTEGER NOT NULL,
    shiny       INTEGER NOT NULL DEFAULT 0,
    gender      TEXT,
    ivs         TEXT NOT NULL,
    moves       TEXT NOT NULL,
    friendship  INTEGER NOT NULL DEFAULT 70,
    ball        TEXT,
    form        TEXT,
    favorite    INTEGER NOT NULL DEFAULT 0,
    team_slot   INTEGER,
    caught_at   TEXT NOT NULL,
    UNIQUE (save_id, team_slot)
  );
  CREATE INDEX pokemon_by_save ON pokemon (save_id, species_id);

  CREATE TABLE inventory (
    save_id  TEXT NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
    item     TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity >= 0),
    PRIMARY KEY (save_id, item)
  );

  CREATE TABLE pokedex (
    save_id    TEXT NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
    species_id INTEGER NOT NULL,
    caught     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (save_id, species_id)
  );

  CREATE TABLE badges (
    save_id      TEXT NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
    challenge_id TEXT NOT NULL,
    won_at       TEXT NOT NULL,
    PRIMARY KEY (save_id, challenge_id)
  );
  `,
  // 2 — PC com caixas ilimitadas e Pokédex com "visto"
  `
  ALTER TABLE pokemon ADD COLUMN box INTEGER;
  ALTER TABLE pokemon ADD COLUMN box_slot INTEGER;
  CREATE UNIQUE INDEX pokemon_box_position ON pokemon (save_id, box, box_slot) WHERE box IS NOT NULL;
  ALTER TABLE pokedex ADD COLUMN seen INTEGER NOT NULL DEFAULT 1;
  `,
];

export type Db = DatabaseSync;

export function openDatabase(file: string): Db {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let version = row.user_version; version < MIGRATIONS.length; version++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[version] as string);
      db.exec(`PRAGMA user_version = ${version + 1}`);
    });
  }
}

export function transaction<T>(db: Db, work: () => T): T {
  db.exec('BEGIN');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
