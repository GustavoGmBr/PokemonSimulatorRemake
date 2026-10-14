import { randomInt, randomUUID } from 'node:crypto';
import {
  ALL_STARTERS, REGIONS, STARTER_LEVEL, STARTING_ITEMS, STARTING_MONEY,
  createPokemon, perfectIvs, rngFrom,
  type DevGrantResult, type InventoryEntry, type SaveDetail, type SaveSummary, type StarterRegion,
} from '@pokesim/engine';
import { loadGameData } from '@pokesim/data';
import { transaction, type Db } from './db.ts';
import { badRequest, notFound } from './errors.ts';
import type { PokemonStore } from './pokemon-store.ts';

export const MAX_TRAINER_NAME = 12;
export const MAX_SAVES = 20;
/** O cliente avisa o tempo a cada ~30 s; qualquer coisa maior que isso por chamada é descartada. */
export const MAX_PLAYTIME_PING_SECONDS = 120;
export const MAX_DEV_GRANT = 300;

interface SaveRow {
  id: string;
  trainer_name: string;
  money: number;
  chips: number;
  play_time_seconds: number;
  created_at: string;
  updated_at: string;
}

const rng = rngFrom(randomInt);

export function createSaveService(db: Db, store: PokemonStore) {
  const data = loadGameData();

  function summary(row: SaveRow): SaveSummary {
    const team = db.prepare(
      'SELECT species_id, shiny, level FROM pokemon WHERE save_id = ? AND team_slot IS NOT NULL ORDER BY team_slot',
    ).all(row.id) as { species_id: number; shiny: number; level: number }[];
    const caught = db.prepare('SELECT COUNT(*) AS n FROM pokedex WHERE save_id = ? AND caught = 1').get(row.id) as { n: number };
    const badges = db.prepare('SELECT COUNT(*) AS n FROM badges WHERE save_id = ?').get(row.id) as { n: number };
    return {
      id: row.id,
      trainerName: row.trainer_name,
      money: row.money,
      chips: row.chips,
      badges: badges.n,
      pokedexCaught: caught.n,
      playTimeSeconds: row.play_time_seconds,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      teamPreview: team.map((entry) => ({ speciesId: entry.species_id, shiny: entry.shiny === 1, level: entry.level })),
    };
  }

  function findRow(id: string): SaveRow {
    const row = db.prepare('SELECT * FROM saves WHERE id = ?').get(id) as SaveRow | undefined;
    if (!row) throw notFound('Save não encontrado.');
    return row;
  }

  return {
    list(): SaveSummary[] {
      const rows = db.prepare('SELECT * FROM saves ORDER BY updated_at DESC').all() as unknown as SaveRow[];
      return rows.map(summary);
    },

    get(id: string): SaveDetail {
      const row = findRow(id);
      const inventory = db.prepare(
        'SELECT item, quantity FROM inventory WHERE save_id = ? AND quantity > 0 ORDER BY item',
      ).all(id) as { item: string; quantity: number }[];
      return {
        ...summary(row),
        team: store.team(id),
        inventory: inventory.map((entry): InventoryEntry => {
          const item = data.itemsByName.get(entry.item);
          return { item: entry.item, displayName: item?.displayName ?? entry.item, category: item?.category ?? 'outros', quantity: entry.quantity };
        }),
      };
    },

    create(input: { trainerName: unknown; starterSpeciesId: unknown }): SaveDetail {
      const trainerName = typeof input.trainerName === 'string' ? input.trainerName.trim().replace(/\s+/g, ' ') : '';
      if (!trainerName) throw badRequest('Digite o nome do treinador.');
      if (trainerName.length > MAX_TRAINER_NAME) throw badRequest(`O nome pode ter até ${MAX_TRAINER_NAME} letras.`);
      const starterId = Number(input.starterSpeciesId);
      if (!ALL_STARTERS.has(starterId)) throw badRequest('Escolha um dos Pokémon iniciais.');
      const count = db.prepare('SELECT COUNT(*) AS n FROM saves').get() as { n: number };
      if (count.n >= MAX_SAVES) throw badRequest(`Limite de ${MAX_SAVES} saves atingido. Exclua um para começar outro.`);

      const species = data.speciesById.get(starterId);
      if (!species) throw badRequest('Inicial fora do catálogo.');
      const starter = createPokemon({
        species, level: STARTER_LEVEL, rng, moves: data.movesByName, ivs: perfectIvs(), ball: 'poke-ball',
      });
      const id = randomUUID();
      const now = new Date().toISOString();
      transaction(db, () => {
        db.prepare(`
          INSERT INTO saves (id, trainer_name, money, chips, play_time_seconds, created_at, updated_at)
          VALUES (?, ?, ?, 0, 0, ?, ?)
        `).run(id, trainerName, STARTING_MONEY, now, now);
        store.insert(id, starter, { kind: 'team', slot: 0 }, now, true); // o inicial já nasce favorito
        const addItem = db.prepare('INSERT INTO inventory (save_id, item, quantity) VALUES (?, ?, ?)');
        for (const entry of STARTING_ITEMS) addItem.run(id, entry.item, entry.quantity);
      });
      return this.get(id);
    },

    remove(id: string): void {
      findRow(id);
      db.prepare('DELETE FROM saves WHERE id = ?').run(id);
    },

    /** Soma segundos ao tempo de jogo (o cliente avisa periodicamente enquanto a aba está visível). */
    addPlayTime(id: string, seconds: unknown): void {
      findRow(id);
      const value = Math.floor(Number(seconds));
      if (!Number.isFinite(value) || value <= 0) throw badRequest('Tempo inválido.');
      const add = Math.min(value, MAX_PLAYTIME_PING_SECONDS);
      db.prepare('UPDATE saves SET play_time_seconds = play_time_seconds + ?, updated_at = ? WHERE id = ?')
        .run(add, new Date().toISOString(), id);
    },

    starters(): StarterRegion[] {
      return REGIONS.map((region) => ({
        region: region.id,
        name: region.name,
        starters: region.starters.map((speciesId) => {
          const species = data.speciesById.get(speciesId);
          if (!species) throw new Error(`Inicial ${speciesId} ausente.`);
          return { speciesId, name: species.displayName, types: species.types, baseStats: species.baseStats };
        }),
      }));
    },

    /**
     * FERRAMENTA DE TESTE (só alpha): adiciona Pokémon aleatórios para experimentar o PC e a Pokédex
     * antes de existir captura. Sai na Fase 4.
     */
    devGrant(id: string, count: unknown): DevGrantResult {
      findRow(id);
      const amount = Math.floor(Number(count));
      if (!Number.isFinite(amount) || amount < 1 || amount > MAX_DEV_GRANT) throw badRequest(`Informe de 1 a ${MAX_DEV_GRANT}.`);
      const result: DevGrantResult = { added: 0, inTeam: 0, inBoxes: 0 };
      for (let i = 0; i < amount; i++) {
        const species = data.species[rng.int(data.species.length)];
        if (!species) continue;
        const pokemon = createPokemon({
          species, level: 3 + rng.int(78), rng, moves: data.movesByName, shiny: rng.int(40) === 0, ball: 'poke-ball',
        });
        const { location } = store.place(id, pokemon);
        result.added++;
        if (location.kind === 'team') result.inTeam++;
        else result.inBoxes++;
      }
      return result;
    },
  };
}

export type SaveService = ReturnType<typeof createSaveService>;
