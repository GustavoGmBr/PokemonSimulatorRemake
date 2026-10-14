import { randomInt, randomUUID } from 'node:crypto';
import {
  ALL_STARTERS, REGIONS, STARTER_LEVEL, STARTING_ITEMS, STARTING_MONEY,
  createPokemon, ivQuality, levelProgress, perfectIvs, rngFrom, statsOf,
  type InventoryEntry, type MoveSlot, type PokemonInstance, type PokemonView, type SaveDetail,
  type SaveSummary, type StarterRegion, type Stats,
} from '@pokesim/engine';
import { loadGameData } from '@pokesim/data';
import { transaction, type Db } from './db.ts';
import { badRequest, notFound } from './errors.ts';

export const MAX_TRAINER_NAME = 12;
export const MAX_SAVES = 20;

interface SaveRow {
  id: string;
  trainer_name: string;
  money: number;
  chips: number;
  play_time_seconds: number;
  created_at: string;
  updated_at: string;
}

interface PokemonRow {
  id: string;
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
  caught_at: string;
}

const rng = rngFrom(randomInt);

export function createSaveService(db: Db) {
  const data = loadGameData();

  function toPokemonView(row: PokemonRow): PokemonView {
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
      teamSlot: row.team_slot,
      favorite: row.favorite === 1,
      ball: row.ball,
      caughtAt: row.caught_at,
    };
  }

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

  function insertPokemon(saveId: string, pokemon: PokemonInstance, teamSlot: number | null, now: string, favorite = false): string {
    const id = randomUUID();
    db.prepare(`
      INSERT INTO pokemon (id, save_id, species_id, nickname, level, exp, current_hp, shiny, gender, ivs, moves,
                           friendship, ball, form, favorite, team_slot, caught_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, saveId, pokemon.speciesId, pokemon.nickname, pokemon.level, pokemon.exp, pokemon.currentHp,
      pokemon.shiny ? 1 : 0, pokemon.gender, JSON.stringify(pokemon.ivs), JSON.stringify(pokemon.moves),
      pokemon.friendship, pokemon.ball, pokemon.form, favorite ? 1 : 0, teamSlot, now,
    );
    db.prepare(`
      INSERT INTO pokedex (save_id, species_id, caught) VALUES (?, ?, 1)
      ON CONFLICT (save_id, species_id) DO UPDATE SET caught = 1
    `).run(saveId, pokemon.speciesId);
    return id;
  }

  return {
    list(): SaveSummary[] {
      const rows = db.prepare('SELECT * FROM saves ORDER BY updated_at DESC').all() as unknown as SaveRow[];
      return rows.map(summary);
    },

    get(id: string): SaveDetail {
      const row = findRow(id);
      const team = db.prepare(
        'SELECT * FROM pokemon WHERE save_id = ? AND team_slot IS NOT NULL ORDER BY team_slot',
      ).all(id) as unknown as PokemonRow[];
      const inventory = db.prepare(
        'SELECT item, quantity FROM inventory WHERE save_id = ? AND quantity > 0 ORDER BY item',
      ).all(id) as { item: string; quantity: number }[];
      return {
        ...summary(row),
        team: team.map(toPokemonView),
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
        insertPokemon(id, starter, 0, now, true); // o inicial já nasce favorito (protegido)
        const addItem = db.prepare('INSERT INTO inventory (save_id, item, quantity) VALUES (?, ?, ?)');
        for (const entry of STARTING_ITEMS) addItem.run(id, entry.item, entry.quantity);
      });
      return this.get(id);
    },

    remove(id: string): void {
      findRow(id);
      db.prepare('DELETE FROM saves WHERE id = ?').run(id);
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
  };
}

export type SaveService = ReturnType<typeof createSaveService>;
