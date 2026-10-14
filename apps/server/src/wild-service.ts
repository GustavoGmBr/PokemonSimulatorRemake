import { randomInt } from 'node:crypto';
import {
  BOARD_SIZE, BOARD_SPINS, REGIONS, SHINY_CHARM_EXTRA_ROLLS, attemptCapture, captureChance, createPokemon, isWildEligible, rollShiny,
  ivQuality, regionOfSpecies, rngFrom, statsOf, wildLevelRange,
  type AutoSearchResult, type AutoSearchTarget, type BallOption, type CaptureInput, type PokemonInstance, type Rng,
  type Species, type ThrowBallResult, type WildBoardView, type WildSlotView, type WildState,
} from '@pokesim/engine';
import { loadGameData } from '@pokesim/data';
import { transaction, type Db } from './db.ts';
import { badRequest, notFound } from './errors.ts';
import type { PokemonStore } from './pokemon-store.ts';
import type { Inventory } from './inventory.ts';

/** Teto de mapas gerados por uma busca automática (evita travar o servidor). */
export const MAX_AUTO_SEARCHES = 5000;
export const DEFAULT_AUTO_STARS = 3;

interface BoardRow {
  slots: string;
  spins_left: number;
  chosen: number | null;
}

export function createWildService(db: Db, store: PokemonStore, inventory: Inventory, rng: Rng = rngFrom(randomInt)) {
  const data = loadGameData();
  const poolCache = new Map<string, Species[]>();

  function assertSave(saveId: string): void {
    if (!db.prepare('SELECT 1 FROM saves WHERE id = ?').get(saveId)) throw notFound('Save não encontrado.');
  }

  /** Regiões liberadas. Saves sem o campo (criados antes da migração 3) usam a região do Pokémon mais antigo. */
  function unlockedRegions(saveId: string): string[] {
    const row = db.prepare('SELECT unlocked_regions FROM saves WHERE id = ?').get(saveId) as { unlocked_regions: string } | undefined;
    const stored = (row?.unlocked_regions ?? '').split(',').filter(Boolean);
    if (stored.length > 0) return stored;
    const first = db.prepare('SELECT species_id FROM pokemon WHERE save_id = ? ORDER BY caught_at LIMIT 1').get(saveId) as { species_id: number } | undefined;
    return [first ? (regionOfSpecies(first.species_id)?.id ?? 'kanto') : 'kanto'];
  }

  function badgeCount(saveId: string): number {
    return (db.prepare('SELECT COUNT(*) AS n FROM badges WHERE save_id = ?').get(saveId) as { n: number }).n;
  }

  function pool(regions: string[], badges: number): Species[] {
    const key = `${regions.join(',')}|${badges}`;
    let list = poolCache.get(key);
    if (!list) {
      list = data.species.filter((species) => isWildEligible(species, regions, badges));
      poolCache.set(key, list);
    }
    return list;
  }

  function generate(saveId: string): PokemonInstance[] {
    const regions = unlockedRegions(saveId);
    const badges = badgeCount(saveId);
    const species = pool(regions, badges);
    if (species.length === 0) throw badRequest('Nenhum POKÉMON disponível nas regiões liberadas.');
    const extraRolls = inventory.quantity(saveId, 'shiny-charm') > 0 ? SHINY_CHARM_EXTRA_ROLLS : 0;
    const [min, max] = wildLevelRange(badges);
    return Array.from({ length: BOARD_SIZE }, () => {
      const chosen = species[rng.int(species.length)] as Species;
      return createPokemon({
        species: chosen,
        level: min + rng.int(max - min + 1),
        rng,
        moves: data.movesByName,
        shiny: rollShiny(rng, extraRolls),
      });
    });
  }

  function readBoard(saveId: string): { slots: PokemonInstance[]; spinsLeft: number; chosen: number | null } | null {
    const row = db.prepare('SELECT slots, spins_left, chosen FROM wild_boards WHERE save_id = ?').get(saveId) as BoardRow | undefined;
    if (!row) return null;
    return { slots: JSON.parse(row.slots) as PokemonInstance[], spinsLeft: row.spins_left, chosen: row.chosen };
  }

  function writeBoard(saveId: string, slots: PokemonInstance[], spinsLeft: number, chosen: number | null): void {
    db.prepare(`
      INSERT INTO wild_boards (save_id, slots, spins_left, chosen) VALUES (?, ?, ?, ?)
      ON CONFLICT (save_id) DO UPDATE SET slots = excluded.slots, spins_left = excluded.spins_left, chosen = excluded.chosen
    `).run(saveId, JSON.stringify(slots), spinsLeft, chosen);
  }

  function speciesOf(pokemon: PokemonInstance): Species {
    const species = data.speciesById.get(pokemon.speciesId);
    if (!species) throw new Error(`Espécie ${pokemon.speciesId} ausente do catálogo.`);
    return species;
  }

  function caughtSet(saveId: string): Set<number> {
    const rows = db.prepare('SELECT species_id FROM pokedex WHERE save_id = ? AND caught = 1').all(saveId) as { species_id: number }[];
    return new Set(rows.map((row) => row.species_id));
  }

  function slotView(slot: number, pokemon: PokemonInstance, caught: Set<number>): WildSlotView {
    const species = speciesOf(pokemon);
    return {
      slot,
      speciesId: species.id,
      name: species.displayName,
      level: pokemon.level,
      shiny: pokemon.shiny,
      ivStars: ivQuality(pokemon.ivs).stars,
      types: species.types,
      gender: pokemon.gender,
      caughtBefore: caught.has(species.id),
    };
  }

  function captureInput(saveId: string, pokemon: PokemonInstance, ball: string, caught: Set<number>): CaptureInput {
    const species = speciesOf(pokemon);
    return {
      maxHp: statsOf(pokemon, species).hp,
      currentHp: pokemon.currentHp,
      captureRate: species.captureRate,
      ball,
      catchingCharm: inventory.quantity(saveId, 'catching-charm') > 0,
      context: {
        level: pokemon.level,
        types: species.types,
        baseSpeed: species.baseStats.spe,
        caughtBefore: caught.has(species.id),
        hour: new Date().getHours(),
      },
    };
  }

  function state(saveId: string): WildState {
    assertSave(saveId);
    const board = readBoard(saveId);
    const caught = caughtSet(saveId);
    const regions = unlockedRegions(saveId);
    const encounter = board && board.chosen !== null ? board.slots[board.chosen] : undefined;

    const owned = db.prepare('SELECT item, quantity FROM inventory WHERE save_id = ? AND quantity > 0').all(saveId) as { item: string; quantity: number }[];
    const quantities = new Map(owned.map((row) => [row.item, row.quantity]));
    const balls: BallOption[] = data.items
      .filter((item) => item.category === 'captura' && (quantities.get(item.name) ?? 0) > 0)
      .map((item) => ({
        item: item.name,
        displayName: item.displayName,
        description: item.description,
        quantity: quantities.get(item.name) ?? 0,
        chance: encounter ? captureChance(captureInput(saveId, encounter, item.name, caught)) : null,
      }));

    const view: WildBoardView | null = board
      ? {
        slots: board.slots.map((pokemon, index) => slotView(index, pokemon, caught)),
        spinsLeft: board.spinsLeft,
        regions: regions.map((id) => REGIONS.find((region) => region.id === id)?.name ?? id),
        levelRange: wildLevelRange(badgeCount(saveId)),
      }
      : null;
    return {
      board: view,
      chosen: board?.chosen ?? null,
      balls,
      shinyCharm: (quantities.get('shiny-charm') ?? 0) > 0,
      catchingCharm: (quantities.get('catching-charm') ?? 0) > 0,
    };
  }

  function matches(slots: PokemonInstance[], target: AutoSearchTarget, minStars: number): boolean {
    return slots.some((pokemon) => {
      const shiny = pokemon.shiny;
      const stars = ivQuality(pokemon.ivs).stars >= minStars;
      return target === 'shiny' ? shiny : target === 'stars' ? stars : shiny || stars;
    });
  }

  return {
    state,

    /** "Procurar selvagem": novo mapa com 10 Pokémon e 3 giros. */
    search(saveId: string): WildState {
      assertSave(saveId);
      writeBoard(saveId, generate(saveId), BOARD_SPINS, null);
      return state(saveId);
    },

    /** Gasta um giro e sorteia os 10 de novo. */
    spin(saveId: string): WildState {
      assertSave(saveId);
      const board = readBoard(saveId);
      if (!board) throw badRequest('Procure um selvagem primeiro.');
      if (board.chosen !== null) throw badRequest('Fuja do encontro antes de girar.');
      if (board.spinsLeft <= 0) throw badRequest('Acabaram os giros deste mapa. Faça uma nova procura.');
      writeBoard(saveId, generate(saveId), board.spinsLeft - 1, null);
      return state(saveId);
    },

    /** Gera mapas novos, sem gastar giros, até aparecer um brilhante e/ou de estrelas altas. */
    autoSearch(saveId: string, input: { target?: unknown; minStars?: unknown }): AutoSearchResult {
      assertSave(saveId);
      const target: AutoSearchTarget = input.target === 'shiny' || input.target === 'stars' ? input.target : 'either';
      const minStars = Math.max(1, Math.min(4, Math.floor(Number(input.minStars ?? DEFAULT_AUTO_STARS)) || DEFAULT_AUTO_STARS));
      let slots = generate(saveId);
      let searches = 1;
      while (!matches(slots, target, minStars) && searches < MAX_AUTO_SEARCHES) {
        slots = generate(saveId);
        searches++;
      }
      writeBoard(saveId, slots, BOARD_SPINS, null);
      return { found: matches(slots, target, minStars), searches, state: state(saveId) };
    },

    /** Clicar em um Pokémon do mapa: começa o encontro (e a espécie passa a contar como vista). */
    choose(saveId: string, slot: unknown): WildState {
      assertSave(saveId);
      const board = readBoard(saveId);
      if (!board) throw badRequest('Procure um selvagem primeiro.');
      const index = Number(slot);
      const pokemon = Number.isInteger(index) ? board.slots[index] : undefined;
      if (!pokemon) throw badRequest('Escolha um dos POKÉMON do mapa.');
      store.markSeen(saveId, pokemon.speciesId);
      writeBoard(saveId, board.slots, board.spinsLeft, index);
      return state(saveId);
    },

    /** Fugir do encontro: volta ao mapa (os giros que sobraram continuam). */
    flee(saveId: string): WildState {
      assertSave(saveId);
      const board = readBoard(saveId);
      if (board) writeBoard(saveId, board.slots, board.spinsLeft, null);
      return state(saveId);
    },

    throwBall(saveId: string, ball: unknown): ThrowBallResult {
      assertSave(saveId);
      const board = readBoard(saveId);
      if (!board || board.chosen === null) throw badRequest('Escolha um selvagem antes de lançar a bola.');
      const wild = board.slots[board.chosen];
      if (!wild) throw badRequest('Escolha um selvagem antes de lançar a bola.');
      const item = typeof ball === 'string' ? data.itemsByName.get(ball) : undefined;
      if (!item || item.category !== 'captura') throw badRequest('Escolha uma POKÉ BOLA.');

      const caught = caughtSet(saveId);
      const input = captureInput(saveId, wild, item.name, caught);
      const chance = captureChance(input);
      return transaction(db, () => {
        if (!inventory.take(saveId, item.name)) throw badRequest(`Você não tem ${item.displayName}.`);
        const result = attemptCapture(rng, input);
        let pokemon = null;
        if (result.caught) {
          const placed = store.place(saveId, { ...wild, ball: item.name });
          pokemon = store.view(saveId, placed.id);
          db.prepare('DELETE FROM wild_boards WHERE save_id = ?').run(saveId);
        }
        return { shakes: result.shakes, caught: result.caught, chance, pokemon, state: state(saveId) };
      });
    },
  };
}

export type WildService = ReturnType<typeof createWildService>;
