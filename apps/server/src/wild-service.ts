import { randomInt } from 'node:crypto';
import {
  HABITATS, LEGENDARY_SLOT_CHANCE, REFRESH_COST, REGIONS, SHINY_CHARM_EXTRA_ROLLS, attemptCapture, captureChance, createPokemon,
  habitatById, habitatOfType, isLegendary, isWildEligible, ivQuality, regionOfSpecies, regionProgress, rngFrom, rollShiny, spinsFor, boardSizeFor,
  speciesInHabitat, statsOf, MIN_WILD_LEVEL, GYMS_PER_REGION, DEFAULT_MIN_LEVEL, levelCap, HEAL_BALL, unlockedRegionIds,   type BallOption, type CaptureInput, type Habitat, type PokemonInstance, type Rng, type Species,
  type ThrowBallResult, type WildBoardView, type WildRegionOption, type WildSlotView, type WildState,
} from '@pokesim/engine';
import { loadGameData } from '@pokesim/data';
import { transaction, type Db } from './db.ts';
import { badRequest, notFound } from './errors.ts';
import type { PokemonStore } from './pokemon-store.ts';
import type { Inventory } from './inventory.ts';

interface BoardRow {
  slots: string;
  spins_left: number;
  chosen: number | null;
  region: string;
  habitat: string;
  target_species: number | null;
  min_level: number;
  max_level: number;
  throws: number;
}

interface Board {
  slots: (PokemonInstance | null)[];
  spinsLeft: number;
  chosen: number | null;
  region: string;
  habitat: string;
  target: number | null;
  levels: [number, number];
  /** bolas já lançadas no encontro atual */
  throws: number;
}

export function createWildService(db: Db, store: PokemonStore, inventory: Inventory, rng: Rng = rngFrom(randomInt)) {
  const data = loadGameData();

  function assertSave(saveId: string): void {
    if (!db.prepare('SELECT 1 FROM saves WHERE id = ?').get(saveId)) throw notFound('Save não encontrado.');
  }

  function challenges(saveId: string): string[] {
    return (db.prepare('SELECT challenge_id FROM badges WHERE save_id = ?').all(saveId) as { challenge_id: string }[]).map((row) => row.challenge_id);
  }

  function gymCount(ids: string[]): number {
    return ids.filter((id) => id.includes(':gym')).length;
  }

  function guardBattle(saveId: string): void {
    if (db.prepare('SELECT 1 FROM battles WHERE save_id = ?').get(saveId)) throw badRequest('Termine a batalha em andamento primeiro.');
  }

  function moneyOf(saveId: string): number {
    return (db.prepare('SELECT money FROM saves WHERE id = ?').get(saveId) as { money: number }).money;
  }

  function regionOptions(ids: string[]): WildRegionOption[] {
    const unlocked = unlockedRegionIds(ids);
    const list: WildRegionOption[] = REGIONS.map((region) => {
      const progress = regionProgress(ids, region.id);
      return {
        id: region.id, name: region.name, generation: region.generation, unlocked: unlocked.includes(region.id),
        gyms: progress.gyms, eliteMembers: progress.eliteMembers, elite: progress.elite, champion: progress.champion,
        levelCap: levelCap(progress),
        spins: spinsFor(progress), mapSize: boardSizeFor(progress), legendaries: progress.elite, specific: progress.champion,
        chooseHabitat: progress.gyms >= GYMS_PER_REGION,
      };
    });
    // "Todas as gerações": junta as regiões liberadas; o limite e os giros seguem a mais recente
    const latest = list.filter((region) => region.unlocked).at(-1) as WildRegionOption;
    const all: WildRegionOption = {
      ...latest, id: 'all', name: 'Todas as gerações', generation: 0, unlocked: true,
      legendaries: list.some((region) => region.unlocked && region.elite), specific: false,
    };
    return [all, ...list];
  }

  function randomOf<T>(list: readonly T[]): T {
    return list[rng.int(list.length)] as T;
  }

  /** Regiões de onde o mapa sorteia: a escolhida, ou todas as liberadas em "Todas as gerações". */
  function scopeOf(region: string, unlocked: string[]): string[] {
    return region === 'all' ? unlocked : [region];
  }

  /** Espécies comuns (e do habitat, se houver) e lendários das regiões cuja Elite dos 4 já caiu. */
  function pools(regions: string[], unlocked: string[], badges: number, habitat: Habitat | null, ids: string[]) {
    const fits = (species: Species) => !habitat || speciesInHabitat(species, habitat);
    const common = data.species.filter((species) => regions.some((region) => isWildEligible(species, region, unlocked, badges)) && fits(species));
    const rare = data.species.filter((species) => {
      if (!isLegendary(species) || !fits(species)) return false;
      const home = regionOfSpecies(species.id)?.id;
      return home !== undefined && regions.includes(home) && regionProgress(ids, home).elite;
    });
    return { common, rare };
  }

  function makeMon(species: Species, level: [number, number], extraRolls: number): PokemonInstance {
    const [min, max] = level;
    return createPokemon({
      species,
      level: min + rng.int(max - min + 1),
      rng,
      moves: data.movesByName,
      shiny: rollShiny(rng, extraRolls),
    });
  }

  /** Sorteia os Pokémon do mapa (3 a 15, conforme os desafios da região). */
  function generate(saveId: string, region: string, habitat: Habitat, target: number | null, range: [number, number]): PokemonInstance[] {
    const ids = challenges(saveId);
    const unlocked = unlockedRegionIds(ids);
    const badges = gymCount(ids);
    const size = regionOptions(ids).find((option) => option.id === region)?.mapSize ?? 3;
    const extraRolls = inventory.quantity(saveId, 'shiny-charm') > 0 ? SHINY_CHARM_EXTRA_ROLLS : 0;
    if (target !== null) {
      const species = data.speciesById.get(target);
      if (!species) throw badRequest('Espécie desconhecida.');
      return Array.from({ length: size }, () => makeMon(species, range, extraRolls));
    }
    const { common, rare } = pools(scopeOf(region, unlocked), unlocked, badges, habitat, ids);
    if (common.length === 0 && rare.length === 0) throw badRequest('Nenhum POKÉMON disponível neste mapa.');
    return Array.from({ length: size }, () => {
      const useRare = rare.length > 0 && (common.length === 0 || rng.int(1000) < LEGENDARY_SLOT_CHANCE * 1000);
      const species = useRare ? randomOf(rare) : randomOf(common);
      return makeMon(species, range, extraRolls);
    });
  }

  function readBoard(saveId: string): Board | null {
    const row = db.prepare('SELECT * FROM wild_boards WHERE save_id = ?').get(saveId) as BoardRow | undefined;
    if (!row) return null;
    return {
      slots: JSON.parse(row.slots) as (PokemonInstance | null)[], spinsLeft: row.spins_left, chosen: row.chosen,
      region: row.region, habitat: row.habitat, target: row.target_species, levels: [row.min_level, row.max_level], throws: row.throws,
    };
  }

  function writeBoard(saveId: string, board: Board): void {
    db.prepare(`
      INSERT INTO wild_boards (save_id, slots, spins_left, chosen, region, habitat, target_species, min_level, max_level, throws) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (save_id) DO UPDATE SET slots = excluded.slots, spins_left = excluded.spins_left, chosen = excluded.chosen,
        region = excluded.region, habitat = excluded.habitat, target_species = excluded.target_species,
        min_level = excluded.min_level, max_level = excluded.max_level, throws = excluded.throws
    `).run(saveId, JSON.stringify(board.slots), board.spinsLeft, board.chosen, board.region, board.habitat, board.target, board.levels[0], board.levels[1], board.throws);
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

  /** Tira o Pokémon escolhido do mapa (a vaga fica vazia, então os outros não mudam de lugar). */
  function removeChosen(board: Board, remove: boolean): Board {
    if (!remove || board.chosen === null) return board;
    return { ...board, slots: board.slots.map((slot, index) => (index === board.chosen ? null : slot)) };
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

  function captureInput(saveId: string, pokemon: PokemonInstance, ball: string, throws: number): CaptureInput {
    const species = speciesOf(pokemon);
    return {
      maxHp: statsOf(pokemon, species).hp,
      currentHp: pokemon.currentHp,
      captureRate: species.captureRate,
      ball,
      catchingCharm: inventory.quantity(saveId, 'catching-charm') > 0,
      context: {
        types: species.types,
        weight: species.weight,
        height: species.height,
        firstTurn: throws === 0,
        leadTypes: store.team(saveId)[0]?.types ?? [],
      },
    };
  }

  function state(saveId: string): WildState {
    assertSave(saveId);
    const board = readBoard(saveId);
    const caught = caughtSet(saveId);
    const ids = challenges(saveId);
    const encounter = board && board.chosen !== null ? board.slots[board.chosen] ?? undefined : undefined;

    const owned = db.prepare('SELECT item, quantity FROM inventory WHERE save_id = ? AND quantity > 0').all(saveId) as { item: string; quantity: number }[];
    const quantities = new Map(owned.map((row) => [row.item, row.quantity]));
    const balls: BallOption[] = data.items
      .filter((item) => item.category === 'captura' && (quantities.get(item.name) ?? 0) > 0)
      .map((item) => ({
        item: item.name,
        displayName: item.displayName,
        description: item.description,
        quantity: quantities.get(item.name) ?? 0,
        chance: encounter ? captureChance(captureInput(saveId, encounter, item.name, board?.throws ?? 0)) : null,
      }));

    const regions = regionOptions(ids);
    let view: WildBoardView | null = null;
    if (board) {
      const habitat = habitatById(board.habitat) ?? (HABITATS[0] as Habitat);
      view = {
        slots: board.slots.flatMap((pokemon, index) => (pokemon ? [slotView(index, pokemon, caught)] : [])),
        spinsLeft: board.spinsLeft,
        spinsTotal: regions.find((region) => region.id === board.region)?.spins ?? 3,
        region: board.region as WildBoardView['region'],
        regionName: regions.find((region) => region.id === board.region)?.name ?? board.region,
        habitat: habitat.id,
        habitatName: habitat.name,
        targetSpeciesId: board.target,
        levelRange: board.levels,
      };
    }
    return {
      board: view,
      chosen: board?.chosen ?? null,
      balls,
      regions,
      money: moneyOf(saveId),
      refreshCost: REFRESH_COST,
      shinyCharm: (quantities.get('shiny-charm') ?? 0) > 0,
      catchingCharm: (quantities.get('catching-charm') ?? 0) > 0,
    };
  }

  return {
    state,

    /**
     * "Procurar selvagem": escolhe a região (e, com o campeão derrotado, uma espécie específica).
     * Sem espécie, o mapa (habitat) é sorteado entre os que têm Pokémon disponíveis.
     */
    search(saveId: string, input: { region?: unknown; speciesId?: unknown; habitat?: unknown; minLevel?: unknown; maxLevel?: unknown }): WildState {
      assertSave(saveId);
      guardBattle(saveId);
      const ids = challenges(saveId);
      const options = regionOptions(ids);
      const option = options.find((entry) => entry.id === input.region);
      if (!option) throw badRequest('Escolha uma região.');
      if (!option.unlocked) throw badRequest(`${option.name} ainda não foi liberada.`);

      const cap = option.levelCap;
      const min = input.minLevel === undefined || input.minLevel === null ? Math.min(DEFAULT_MIN_LEVEL, cap) : Number(input.minLevel);
      const max = input.maxLevel === undefined || input.maxLevel === null ? cap : Number(input.maxLevel);
      if (![min, max].every((n) => Number.isInteger(n) && n >= MIN_WILD_LEVEL)) throw badRequest(`O nível mínimo é ${MIN_WILD_LEVEL}.`);
      if (max > cap) throw badRequest(`O nível máximo liberado em ${option.name} é ${cap}.`);
      if (min > max) throw badRequest('O nível mínimo não pode ser maior que o máximo.');
      const levels: [number, number] = [min, max];

      let target: number | null = null;
      let habitat: Habitat;
      if (input.speciesId !== undefined && input.speciesId !== null) {
        if (option.id === 'all') throw badRequest('Escolha uma região para procurar um POKÉMON específico.');
        if (!option.specific) throw badRequest(`Derrote o campeão de ${option.name} para procurar um POKÉMON específico.`);
        const species = data.speciesById.get(Number(input.speciesId));
        if (!species || regionOfSpecies(species.id)?.id !== option.id) throw badRequest(`Escolha um POKÉMON de ${option.name}.`);
        target = species.id;
        habitat = habitatOfType(species.types[0] as Species['types'][number]);
      } else if (typeof input.habitat === 'string' && input.habitat !== '') {
        if (!option.chooseHabitat) throw badRequest(`Vença os ${GYMS_PER_REGION} ginásios de ${option.name} para escolher o mapa.`);
        const chosenHabitat = habitatById(input.habitat);
        if (!chosenHabitat) throw badRequest('Mapa desconhecido.');
        const unlockedNow = unlockedRegionIds(ids);
        const { common, rare } = pools(scopeOf(option.id, unlockedNow), unlockedNow, gymCount(ids), chosenHabitat, ids);
        if (common.length + rare.length === 0) throw badRequest('Nenhum POKÉMON desta região vive neste mapa.');
        habitat = chosenHabitat;
      } else {
        const unlocked = unlockedRegionIds(ids);
        const badges = gymCount(ids);
        const candidates = HABITATS.filter((entry) => {
          const { common, rare } = pools(scopeOf(option.id, unlocked), unlocked, badges, entry, ids);
          return common.length + rare.length > 0;
        });
        if (candidates.length === 0) throw badRequest('Nenhum POKÉMON disponível nesta região.');
        habitat = randomOf(candidates);
      }
      writeBoard(saveId, {
        slots: generate(saveId, option.id, habitat, target, levels), spinsLeft: option.spins, chosen: null, throws: 0,
        region: option.id, habitat: habitat.id, target, levels,
      });
      return state(saveId);
    },

    /** Gasta um giro (ou paga a renovação quando não há giros) e sorteia os 10 de novo, no mesmo mapa. */
    spin(saveId: string, pay = false): WildState {
      assertSave(saveId);
      guardBattle(saveId);
      const board = readBoard(saveId);
      if (!board) throw badRequest('Procure um selvagem primeiro.');
      if (board.chosen !== null) throw badRequest('Fuja do encontro antes de girar.');
      const habitat = habitatById(board.habitat) ?? (HABITATS[0] as Habitat);
      return transaction(db, () => {
        let spinsLeft = board.spinsLeft;
        if (spinsLeft > 0) {
          spinsLeft -= 1;
        } else {
          if (!pay) throw badRequest(`Acabaram os giros. Renovar o mapa custa ₽ ${REFRESH_COST.toLocaleString('pt-BR')}.`);
          if (moneyOf(saveId) < REFRESH_COST) throw badRequest('Dinheiro insuficiente para renovar o mapa.');
          db.prepare('UPDATE saves SET money = money - ?, updated_at = ? WHERE id = ?').run(REFRESH_COST, new Date().toISOString(), saveId);
        }
        writeBoard(saveId, { ...board, slots: generate(saveId, board.region, habitat, board.target, board.levels), spinsLeft, chosen: null, throws: 0 });
        return state(saveId);
      });
    },

    /** Voltar à tela inicial de busca: descarta o mapa atual. */
    leave(saveId: string): WildState {
      assertSave(saveId);
      guardBattle(saveId);
      db.prepare('DELETE FROM wild_boards WHERE save_id = ?').run(saveId);
      return state(saveId);
    },

    /** Clicar em um Pokémon do mapa: começa o encontro (e a espécie passa a contar como vista). */
    choose(saveId: string, slot: unknown): WildState {
      assertSave(saveId);
      guardBattle(saveId);
      const board = readBoard(saveId);
      if (!board) throw badRequest('Procure um selvagem primeiro.');
      const index = Number(slot);
      const pokemon = Number.isInteger(index) ? board.slots[index] : undefined;
      if (!pokemon) throw badRequest('Escolha um dos POKÉMON do mapa.');
      store.markSeen(saveId, pokemon.speciesId);
      writeBoard(saveId, { ...board, chosen: index, throws: 0 });
      return state(saveId);
    },

    /** O selvagem escolhido (para a batalha começar). */
    encounter(saveId: string): PokemonInstance {
      assertSave(saveId);
      const board = readBoard(saveId);
      const wild = board && board.chosen !== null ? board.slots[board.chosen] : undefined;
      if (!wild) throw badRequest('Escolha um selvagem no mapa antes de lutar.');
      return wild;
    },

    /** Fim da batalha: vitória ou captura tiram só aquele Pokémon do mapa; fuga e derrota devolvem ao mapa como estava. */
    finishEncounter(saveId: string, result: 'win' | 'lose' | 'fled' | 'captured'): void {
      const board = readBoard(saveId);
      if (!board) return;
      writeBoard(saveId, { ...removeChosen(board, result === 'win' || result === 'captured'), chosen: null, throws: 0 });
    },

    /** Fugir do encontro: volta ao mapa (os giros que sobraram continuam). */
    flee(saveId: string): WildState {
      assertSave(saveId);
      guardBattle(saveId);
      const board = readBoard(saveId);
      if (board) writeBoard(saveId, { ...board, chosen: null, throws: 0 });
      return state(saveId);
    },

    throwBall(saveId: string, ball: unknown): ThrowBallResult {
      assertSave(saveId);
      guardBattle(saveId);
      const board = readBoard(saveId);
      if (!board || board.chosen === null) throw badRequest('Escolha um selvagem antes de lançar a bola.');
      const wild = board.slots[board.chosen];
      if (!wild) throw badRequest('Escolha um selvagem antes de lançar a bola.');
      const item = typeof ball === 'string' ? data.itemsByName.get(ball) : undefined;
      if (!item || item.category !== 'captura') throw badRequest('Escolha uma POKÉ BOLA.');

      const caught = caughtSet(saveId);
      const input = captureInput(saveId, wild, item.name, board.throws);
      const chance = captureChance(input);
      return transaction(db, () => {
        if (!inventory.take(saveId, item.name)) throw badRequest(`Você não tem ${item.displayName}.`);
        const result = attemptCapture(rng, input);
        let pokemon = null;
        if (result.caught) {
          const healed = item.name === HEAL_BALL ? { ...wild, currentHp: statsOf(wild, speciesOf(wild)).hp } : wild;
          const placed = store.place(saveId, { ...healed, ball: item.name });
          pokemon = store.view(saveId, placed.id);
          writeBoard(saveId, { ...removeChosen(board, true), chosen: null, throws: 0 });
        } else {
          writeBoard(saveId, { ...board, throws: board.throws + 1 });
        }
        return { shakes: result.shakes, caught: result.caught, chance, pokemon, state: state(saveId) };
      });
    },
  };
}

export type WildService = ReturnType<typeof createWildService>;
