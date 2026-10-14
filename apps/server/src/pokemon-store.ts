import { randomUUID } from 'node:crypto';
import {
  BOX_SIZE, MAX_BOX_INDEX, MAX_NICKNAME, TEAM_SIZE, TYPE_NAMES,
  ivQuality, isValidLocation, levelProgress, searchCollection, statsOf,
  type BoxView, type CollectionEntry, type CollectionQuery, type DexState, type MoveSlot, type PokedexView,
  type PokemonInstance, type PokemonLocation, type PokemonSearchResult, type PokemonView,
  type SearchPokemonQuery, type SortKey, type Stats, type TypeName, SORT_KEYS,
} from '@pokesim/engine';
import { loadGameData } from '@pokesim/data';
import { transaction, type Db } from './db.ts';
import { badRequest, notFound } from './errors.ts';

export interface PokemonRow {
  id: string;
  save_id: string;
  species_id: number;
  nickname: string | null;
  level: number;
  exp: number;
  current_hp: number;
  shiny: number;
  gender: 'M' | 'F' | null;
  ivs: string;
  moves: string;
  friendship: number;
  ball: string | null;
  form: string | null;
  favorite: number;
  team_slot: number | null;
  box: number | null;
  box_slot: number | null;
  caught_at: string;
}

export const DEFAULT_SEARCH_LIMIT = 30;
export const MAX_SEARCH_LIMIT = 100;

export function createPokemonStore(db: Db) {
  const data = loadGameData();

  function assertSave(saveId: string): void {
    if (!db.prepare('SELECT 1 FROM saves WHERE id = ?').get(saveId)) throw notFound('Save não encontrado.');
  }

  function getRow(saveId: string, pokemonId: string): PokemonRow {
    const row = db.prepare('SELECT * FROM pokemon WHERE id = ? AND save_id = ?').get(pokemonId, saveId) as PokemonRow | undefined;
    if (!row) throw notFound('Pokémon não encontrado neste save.');
    return row;
  }

  function locationOf(row: PokemonRow): PokemonLocation {
    if (row.team_slot !== null) return { kind: 'team', slot: row.team_slot };
    return { kind: 'box', box: row.box ?? 0, slot: row.box_slot ?? 0 };
  }

  function rowToView(row: PokemonRow): PokemonView {
    const species = data.speciesById.get(row.species_id);
    if (!species) throw new Error(`Espécie ${row.species_id} ausente do catálogo.`);
    const ivs = JSON.parse(row.ivs) as Stats;
    const slots = JSON.parse(row.moves) as MoveSlot[];
    const instance: PokemonInstance = {
      speciesId: row.species_id, nickname: row.nickname, level: row.level, exp: row.exp, shiny: row.shiny === 1,
      gender: row.gender, ivs, moves: slots, currentHp: row.current_hp, friendship: row.friendship, ball: row.ball, form: row.form,
    };
    const quality = ivQuality(ivs);
    return {
      id: row.id,
      speciesId: species.id,
      name: row.nickname ?? species.displayName,
      speciesName: species.displayName,
      nickname: row.nickname,
      types: species.types,
      level: row.level,
      exp: row.exp,
      expProgress: levelProgress(species.growthRate, row.level, row.exp),
      shiny: instance.shiny,
      gender: row.gender,
      currentHp: row.current_hp,
      stats: statsOf(instance, species),
      ivs,
      ivStars: quality.stars,
      ivTotal: quality.total,
      moves: slots.map((slot) => {
        const move = data.movesByName.get(slot.name);
        return {
          name: slot.name,
          displayName: move?.displayName ?? slot.name,
          type: move?.type ?? 'normal',
          category: move?.category ?? 'physical',
          power: move?.power ?? 0,
          accuracy: move?.accuracy ?? null,
          pp: slot.pp,
          maxPp: slot.maxPp,
        };
      }),
      generation: species.generation,
      location: locationOf(row),
      favorite: row.favorite === 1,
      ball: row.ball,
      caughtAt: row.caught_at,
    };
  }

  function writeLocation(id: string, location: PokemonLocation | null): void {
    const team = location?.kind === 'team' ? location.slot : null;
    const box = location?.kind === 'box' ? location.box : null;
    const slot = location?.kind === 'box' ? location.slot : null;
    db.prepare('UPDATE pokemon SET team_slot = ?, box = ?, box_slot = ? WHERE id = ?').run(team, box, slot, id);
  }

  function teamRows(saveId: string): PokemonRow[] {
    return db.prepare('SELECT * FROM pokemon WHERE save_id = ? AND team_slot IS NOT NULL ORDER BY team_slot').all(saveId) as unknown as PokemonRow[];
  }

  /** Deixa a equipe sem buracos (0, 1, 2…). Processa em ordem crescente, então nunca há colisão. */
  function compactTeam(saveId: string): void {
    teamRows(saveId).forEach((row, index) => {
      if (row.team_slot !== index) writeLocation(row.id, { kind: 'team', slot: index });
    });
  }

  function recordCaught(saveId: string, speciesId: number): void {
    db.prepare(`
      INSERT INTO pokedex (save_id, species_id, caught, seen) VALUES (?, ?, 1, 1)
      ON CONFLICT (save_id, species_id) DO UPDATE SET caught = 1, seen = 1
    `).run(saveId, speciesId);
  }

  function insert(saveId: string, pokemon: PokemonInstance, location: PokemonLocation, now: string, favorite = false): string {
    const id = randomUUID();
    db.prepare(`
      INSERT INTO pokemon (id, save_id, species_id, nickname, level, exp, current_hp, shiny, gender, ivs, moves,
                           friendship, ball, form, favorite, team_slot, box, box_slot, caught_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, saveId, pokemon.speciesId, pokemon.nickname, pokemon.level, pokemon.exp, pokemon.currentHp,
      pokemon.shiny ? 1 : 0, pokemon.gender, JSON.stringify(pokemon.ivs), JSON.stringify(pokemon.moves),
      pokemon.friendship, pokemon.ball, pokemon.form, favorite ? 1 : 0,
      location.kind === 'team' ? location.slot : null,
      location.kind === 'box' ? location.box : null,
      location.kind === 'box' ? location.slot : null,
      now,
    );
    recordCaught(saveId, pokemon.speciesId);
    return id;
  }

  /** Primeira posição livre: equipe primeiro, depois a primeira vaga do PC (caixas nunca acabam). */
  function firstFreeLocation(saveId: string): PokemonLocation {
    const inTeam = (db.prepare('SELECT COUNT(*) AS n FROM pokemon WHERE save_id = ? AND team_slot IS NOT NULL').get(saveId) as { n: number }).n;
    if (inTeam < TEAM_SIZE) return { kind: 'team', slot: inTeam };
    const used = db.prepare('SELECT box, box_slot FROM pokemon WHERE save_id = ? AND box IS NOT NULL ORDER BY box, box_slot')
      .all(saveId) as { box: number; box_slot: number }[];
    let expected = 0;
    for (const row of used) {
      const position = row.box * BOX_SIZE + row.box_slot;
      if (position > expected) break;
      expected = position + 1;
    }
    const box = Math.floor(expected / BOX_SIZE);
    if (box > MAX_BOX_INDEX) throw badRequest('O PC está cheio.');
    return { kind: 'box', box, slot: expected % BOX_SIZE };
  }

  function entryOf(row: PokemonRow): CollectionEntry {
    const species = data.speciesById.get(row.species_id);
    if (!species) throw new Error(`Espécie ${row.species_id} ausente do catálogo.`);
    const quality = ivQuality(JSON.parse(row.ivs) as Stats);
    return {
      id: row.id, speciesId: species.id, name: row.nickname ?? species.displayName, speciesName: species.displayName,
      types: species.types, generation: species.generation, shiny: row.shiny === 1, ivStars: quality.stars,
      ivTotal: quality.total, level: row.level, favorite: row.favorite === 1, caughtAt: row.caught_at,
    };
  }

  function parseQuery(query: SearchPokemonQuery): CollectionQuery {
    const sort: SortKey = SORT_KEYS.includes(query.sort as SortKey) ? (query.sort as SortKey) : 'recent';
    const type = query.type && (TYPE_NAMES as readonly string[]).includes(query.type) ? (query.type as TypeName) : undefined;
    if (query.type && !type) throw badRequest('Tipo desconhecido.');
    return {
      sort,
      dir: query.dir === 'asc' ? 'asc' : 'desc',
      ...(query.text ? { text: query.text.slice(0, 40) } : {}),
      ...(type ? { type } : {}),
      ...(query.generation ? { generation: query.generation } : {}),
      ...(query.shiny !== undefined ? { shiny: query.shiny } : {}),
      ...(query.minStars ? { minStars: query.minStars } : {}),
      ...(query.minLevel ? { minLevel: query.minLevel } : {}),
      ...(query.maxLevel ? { maxLevel: query.maxLevel } : {}),
      ...(query.favorite !== undefined ? { favorite: query.favorite } : {}),
    };
  }

  return {
    insert,
    recordCaught,

    /** Coloca um Pokémon recém-obtido na equipe ou no PC. */
    place(saveId: string, pokemon: PokemonInstance, now = new Date().toISOString()): { id: string; location: PokemonLocation } {
      return transaction(db, () => {
        const location = firstFreeLocation(saveId);
        return { id: insert(saveId, pokemon, location, now), location };
      });
    },

    team(saveId: string): PokemonView[] {
      return teamRows(saveId).map(rowToView);
    },

    box(saveId: string, box: number): BoxView {
      assertSave(saveId);
      if (!Number.isInteger(box) || box < 0 || box > MAX_BOX_INDEX) throw badRequest('Caixa inválida.');
      const rows = db.prepare('SELECT * FROM pokemon WHERE save_id = ? AND box = ?').all(saveId, box) as unknown as PokemonRow[];
      const slots: (PokemonView | null)[] = Array.from({ length: BOX_SIZE }, () => null);
      for (const row of rows) if (row.box_slot !== null && row.box_slot < BOX_SIZE) slots[row.box_slot] = rowToView(row);
      const totals = db.prepare('SELECT COUNT(*) AS n, MAX(box) AS highest FROM pokemon WHERE save_id = ? AND box IS NOT NULL')
        .get(saveId) as { n: number; highest: number | null };
      return { box, slots, totalInBoxes: totals.n, highestUsedBox: totals.highest ?? -1 };
    },

    search(saveId: string, query: SearchPokemonQuery): PokemonSearchResult {
      assertSave(saveId);
      const rows = db.prepare('SELECT * FROM pokemon WHERE save_id = ?').all(saveId) as unknown as PokemonRow[];
      const byId = new Map(rows.map((row) => [row.id, row]));
      const sorted = searchCollection(rows.map(entryOf), parseQuery(query));
      const limit = Math.max(1, Math.min(MAX_SEARCH_LIMIT, Math.floor(query.limit ?? DEFAULT_SEARCH_LIMIT)));
      const offset = Math.max(0, Math.floor(query.offset ?? 0));
      return {
        total: sorted.length,
        items: sorted.slice(offset, offset + limit).map((entry) => rowToView(byId.get(entry.id) as PokemonRow)),
      };
    },

    /** Move para a equipe ou para uma caixa. Se o destino está ocupado, os dois trocam de lugar. */
    move(saveId: string, pokemonId: string, to: PokemonLocation): void {
      if (!to || typeof to !== 'object' || !isValidLocation(to)) throw badRequest('Destino inválido.');
      transaction(db, () => {
        const mover = getRow(saveId, pokemonId);
        const from = locationOf(mover);

        if (to.kind === 'team') {
          const team = teamRows(saveId);
          if (from.kind === 'team') {
            const target = team[Math.min(to.slot, team.length - 1)];
            if (!target || target.id === mover.id) return;
            writeLocation(mover.id, null);
            writeLocation(target.id, from);
            writeLocation(mover.id, { kind: 'team', slot: target.team_slot as number });
            return;
          }
          const occupant = team[to.slot];
          if (occupant) {
            writeLocation(mover.id, null);
            writeLocation(occupant.id, from);
            writeLocation(mover.id, { kind: 'team', slot: to.slot });
          } else {
            writeLocation(mover.id, { kind: 'team', slot: team.length });
          }
          return;
        }

        if (from.kind === 'box' && from.box === to.box && from.slot === to.slot) return;
        const occupant = db.prepare('SELECT * FROM pokemon WHERE save_id = ? AND box = ? AND box_slot = ?')
          .get(saveId, to.box, to.slot) as PokemonRow | undefined;
        if (occupant) {
          writeLocation(mover.id, null);
          writeLocation(occupant.id, from);
          writeLocation(mover.id, to);
          return;
        }
        if (from.kind === 'team' && teamRows(saveId).length <= 1) {
          throw badRequest('Você precisa manter ao menos um Pokémon na equipe.');
        }
        writeLocation(mover.id, to);
        compactTeam(saveId);
      });
    },

    patch(saveId: string, pokemonId: string, patch: { nickname?: unknown; favorite?: unknown }): PokemonView {
      const row = getRow(saveId, pokemonId);
      if (patch.nickname !== undefined) {
        if (typeof patch.nickname !== 'string') throw badRequest('Apelido inválido.');
        const nickname = patch.nickname.trim().replace(/\s+/g, ' ');
        if ([...nickname].length > MAX_NICKNAME) throw badRequest(`O apelido pode ter até ${MAX_NICKNAME} letras.`);
        db.prepare('UPDATE pokemon SET nickname = ? WHERE id = ?').run(nickname === '' ? null : nickname, row.id);
      }
      if (patch.favorite !== undefined) {
        if (typeof patch.favorite !== 'boolean') throw badRequest('Favorito inválido.');
        db.prepare('UPDATE pokemon SET favorite = ? WHERE id = ?').run(patch.favorite ? 1 : 0, row.id);
      }
      return rowToView(getRow(saveId, pokemonId));
    },

    pokedex(saveId: string): PokedexView {
      assertSave(saveId);
      const total = data.species.length;
      const states: DexState[] = Array.from({ length: total }, () => 0);
      const rows = db.prepare('SELECT species_id, caught, seen FROM pokedex WHERE save_id = ?').all(saveId) as { species_id: number; caught: number; seen: number }[];
      let seen = 0;
      let caught = 0;
      for (const row of rows) {
        const index = row.species_id - 1;
        if (index < 0 || index >= total) continue;
        const state: DexState = row.caught ? 2 : row.seen ? 1 : 0;
        states[index] = state;
        if (state >= 1) seen++;
        if (state === 2) caught++;
      }
      const owned: Record<number, number> = {};
      const counts = db.prepare('SELECT species_id, COUNT(*) AS n FROM pokemon WHERE save_id = ? GROUP BY species_id').all(saveId) as { species_id: number; n: number }[];
      for (const row of counts) owned[row.species_id] = row.n;
      return { total, seen, caught, states, owned };
    },

    /** Marca uma espécie como vista (encontro em batalha), sem capturar. */
    markSeen(saveId: string, speciesId: number): void {
      db.prepare(`
        INSERT INTO pokedex (save_id, species_id, caught, seen) VALUES (?, ?, 0, 1)
        ON CONFLICT (save_id, species_id) DO NOTHING
      `).run(saveId, speciesId);
    },
  };
}

export type PokemonStore = ReturnType<typeof createPokemonStore>;
