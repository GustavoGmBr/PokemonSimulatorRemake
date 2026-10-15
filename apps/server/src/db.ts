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
  // 3 — selvagens: regiões liberadas e o mapa de procura em andamento
  `
  ALTER TABLE saves ADD COLUMN unlocked_regions TEXT NOT NULL DEFAULT '';
  CREATE TABLE wild_boards (
    save_id    TEXT PRIMARY KEY REFERENCES saves(id) ON DELETE CASCADE,
    slots      TEXT NOT NULL,
    spins_left INTEGER NOT NULL,
    chosen     INTEGER
  );
  `,
  // 4 — selvagens por região, habitat (mapa) e busca específica
  `
  ALTER TABLE wild_boards ADD COLUMN region TEXT NOT NULL DEFAULT 'kanto';
  ALTER TABLE wild_boards ADD COLUMN habitat TEXT NOT NULL DEFAULT 'forest';
  ALTER TABLE wild_boards ADD COLUMN target_species INTEGER;
  DELETE FROM wild_boards;
  `,
  // 5 — faixa de nível escolhida na procura
  `
  ALTER TABLE wild_boards ADD COLUMN min_level INTEGER NOT NULL DEFAULT 3;
  ALTER TABLE wild_boards ADD COLUMN max_level INTEGER NOT NULL DEFAULT 12;
  DELETE FROM wild_boards;
  `,
  // 6 — turnos do encontro (a Bola Rápida só vale no primeiro)
  `
  ALTER TABLE wild_boards ADD COLUMN throws INTEGER NOT NULL DEFAULT 0;
  `,
  // 7 — batalhas em andamento e golpes que esperam uma vaga
  `
  CREATE TABLE battles (
    save_id    TEXT PRIMARY KEY REFERENCES saves(id) ON DELETE CASCADE,
    state      TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE pending_moves (
    pokemon_id TEXT NOT NULL REFERENCES pokemon(id) ON DELETE CASCADE,
    move       TEXT NOT NULL,
    PRIMARY KEY (pokemon_id, move)
  );
  `,
  // 8 — TMs comprados (valem para sempre, para qualquer Pokémon que possa aprender)
  `
  CREATE TABLE tm_unlocked (
    save_id TEXT NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
    move    TEXT NOT NULL,
    PRIMARY KEY (save_id, move)
  );
  `,
  // 9 — TMs passam a ser comprados em cada Pokémon (a tabela tm_unlocked da 8 fica sem uso)
  `
  CREATE TABLE tm_owned (
    pokemon_id TEXT NOT NULL REFERENCES pokemon(id) ON DELETE CASCADE,
    move       TEXT NOT NULL,
    PRIMARY KEY (pokemon_id, move)
  );
  `,
  // 10 — equipes nomeadas (lista de Pokémon em ordem, até 6)
  `
  CREATE TABLE teams (
    id         TEXT PRIMARY KEY,
    save_id    TEXT NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    members    TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX teams_by_save ON teams (save_id);
  `,
  // 11 — rodada em andamento no Pokécassino (Voltorb Flip, Pokejack, Pula Piplup)
  `
  CREATE TABLE casino_rounds (
    save_id    TEXT PRIMARY KEY REFERENCES saves(id) ON DELETE CASCADE,
    game       TEXT NOT NULL,
    state      TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
  // 12 — torneio em andamento (uma copa por vez) e vitórias por categoria
  `
  CREATE TABLE tournaments (
    save_id    TEXT PRIMARY KEY REFERENCES saves(id) ON DELETE CASCADE,
    tier       TEXT NOT NULL,
    round      INTEGER NOT NULL,
    members    TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE tournament_wins (
    save_id TEXT NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
    tier    TEXT NOT NULL,
    wins    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (save_id, tier)
  );
  `,
  // 13 — histórico/missões/mercado e itens investidos em cada Pokémon (valor de venda)
  `
  CREATE TABLE events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    save_id    TEXT NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,
    region     TEXT,
    species_id INTEGER,
    difficulty TEXT,
    tournament TEXT,
    result     TEXT,
    amount     INTEGER NOT NULL DEFAULT 0,
    text       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX events_by_save ON events (save_id, id);
  CREATE TABLE mission_claims (
    save_id TEXT NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
    period  INTEGER NOT NULL,
    idx     INTEGER NOT NULL,
    PRIMARY KEY (save_id, period, idx)
  );
  CREATE TABLE market_stock (
    save_id TEXT PRIMARY KEY REFERENCES saves(id) ON DELETE CASCADE,
    period  INTEGER NOT NULL,
    state   TEXT NOT NULL
  );
  ALTER TABLE pokemon ADD COLUMN invested INTEGER NOT NULL DEFAULT 0;
  `,
  `
  CREATE TABLE ng_wins (
    save_id      TEXT NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
    challenge_id TEXT NOT NULL,
    wins         INTEGER NOT NULL DEFAULT 0,
    first_at     TEXT NOT NULL,
    PRIMARY KEY (save_id, challenge_id)
  );
  `,
  // 15 — dificuldade do save (normal ou difícil) e marca do Pokémon inicial
  `
  ALTER TABLE saves ADD COLUMN difficulty TEXT NOT NULL DEFAULT 'normal';
  ALTER TABLE pokemon ADD COLUMN is_starter INTEGER NOT NULL DEFAULT 0;
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

const depths = new WeakMap<Db, number>();

/** Transação que pode ser aninhada: a de fora usa BEGIN, as de dentro usam SAVEPOINT. */
export function transaction<T>(db: Db, work: () => T): T {
  const depth = depths.get(db) ?? 0;
  const point = `sp_${depth}`;
  db.exec(depth === 0 ? 'BEGIN' : `SAVEPOINT ${point}`);
  depths.set(db, depth + 1);
  try {
    const result = work();
    db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${point}`);
    return result;
  } catch (error) {
    db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${point}; RELEASE ${point}`);
    throw error;
  } finally {
    depths.set(db, depth);
  }
}
