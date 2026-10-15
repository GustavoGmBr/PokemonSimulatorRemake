import { randomUUID } from 'node:crypto';
import {
  BOX_SIZE, MAX_BOX_INDEX, availableEvolutions, toMoveSlot, MAX_NICKNAME, TEAM_SIZE, TYPE_NAMES,
  ivQuality, isValidLocation, levelProgress, searchCollection, statsOf, availableForms, typesOf, formOf, REGIONS, unlockedRegionIds,
  EXP_CANDIES, IV_ESSENCES, RARE_CANDY, expForLevel, levelForExp, isUsableMove, MAX_LEVEL, type TransformChoice,
  type BoxView, type Combatant, type LearnableMove, type MoveOptions, type CollectionEntry, type MoveView, type EvolutionChoice, type CollectionQuery, type DexState, type MoveSlot, type PokedexView,
  type PokemonInstance, type PokemonLocation, type PokemonSearchResult, type PokemonView,
  type SearchPokemonQuery, type SortKey, type Stats, type TypeName, SORT_KEYS,
} from '@pokesim/engine';
import { loadGameData } from '@pokesim/data';
import { transaction, type Db } from './db.ts';
import { badRequest, notFound } from './errors.ts';
import { createInventory } from './inventory.ts';

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

/** Preço da TM: golpes de status ₽ 1.500; os de dano custam 25 por ponto de poder (mín. ₽ 1.000), em centenas. */
export function tmPrice(move: { category: string; power: number }): number {
  if (move.category === 'status') return 1500;
  return Math.max(1000, Math.round((move.power * 25) / 100) * 100);
}

export const DEFAULT_SEARCH_LIMIT = 30;
export const MAX_SEARCH_LIMIT = 100;

export function createPokemonStore(db: Db) {
  const data = loadGameData();
  const inventory = createInventory(db);

  /** A espécie pertence a uma região que o save ainda não liberou? */
  function regionBlocked(saveId: string, speciesId: number): boolean {
    const region = REGIONS.find((entry) => speciesId >= entry.dex[0] && speciesId <= entry.dex[1]);
    if (!region) return false;
    const won = (db.prepare('SELECT challenge_id FROM badges WHERE save_id = ?').all(saveId) as { challenge_id: string }[]).map((r) => r.challenge_id);
    return !unlockedRegionIds(won).includes(region.id);
  }

  function owns(saveId: string, speciesId: number): boolean {
    return db.prepare('SELECT 1 FROM pokemon WHERE save_id = ? AND species_id = ? LIMIT 1').get(saveId, speciesId) !== undefined;
  }

  const itemName = (id: string): string => data.itemsByName.get(id)?.displayName ?? id;

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
      name: row.nickname ?? formOf(species, row.form)?.displayName ?? species.displayName,
      speciesName: formOf(species, row.form)?.displayName ?? species.displayName,
      nickname: row.nickname,
      types: typesOf(species, row.form),
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
      moves: slots.map((slot) => moveView(slot.name, slot.pp, slot.maxPp)),
      generation: species.generation,
      location: locationOf(row),
      favorite: row.favorite === 1,
      ball: row.ball,
      caughtAt: row.caught_at,
      evolutions: evolutionsOf(row, species, slots),
      forms: formsOf(row, species),
      form: row.form,
      spriteId: formOf(species, row.form)?.spriteId ?? species.id,
      pendingMoves: pendingOf(row.id),
      friendship: row.friendship,
    };
  }

  /** Golpes que o Pokémon pode usar: os de nível já alcançados (grátis) e os de TM (comprados uma vez por save). */
  function moveOptionsOf(saveId: string, pokemonId: string): MoveOptions {
    const row = getRow(saveId, pokemonId);
    const species = data.speciesById.get(row.species_id);
    if (!species) throw notFound('Espécie desconhecida.');
    const known = new Set((JSON.parse(row.moves) as MoveSlot[]).map((slot) => slot.name));
    const unlocked = new Set((db.prepare('SELECT move FROM tm_owned WHERE pokemon_id = ?').all(row.id) as { move: string }[]).map((r) => r.move));
    const seen = new Map<string, LearnableMove>();
    for (const entry of species.learnset) {
      const move = data.movesByName.get(entry.move);
      if (!move) continue;
      const source = entry.method === 'level-up' && entry.level <= row.level ? 'level' : entry.method === 'machine' ? 'machine' : null;
      if (!source) continue;
      const before = seen.get(entry.move);
      if (before && (before.source === 'level' || source === 'machine')) continue; // nível (grátis) tem prioridade
      seen.set(entry.move, {
        move: moveView(entry.move),
        source,
        level: source === 'level' ? entry.level : 0,
        price: source === 'machine' && !unlocked.has(entry.move) ? tmPrice(move) : 0,
        unlocked: source === 'level' || unlocked.has(entry.move),
        known: known.has(entry.move),
      });
    }
    const list = [...seen.values()].sort((a, b) => (a.source === b.source ? a.move.displayName.localeCompare(b.move.displayName) : a.source === 'level' ? -1 : 1));
    const money = (db.prepare('SELECT money FROM saves WHERE id = ?').get(saveId) as { money: number }).money;
    return { learnable: list, money };
  }

  function moveView(name: string, pp?: number, maxPp?: number): MoveView {
    const move = data.movesByName.get(name);
    return {
      name,
      displayName: move?.displayName ?? name,
      type: move?.type ?? 'normal',
      category: move?.category ?? 'physical',
      power: move?.power ?? 0,
      accuracy: move?.accuracy ?? null,
      pp: pp ?? move?.pp ?? 0,
      maxPp: maxPp ?? move?.pp ?? 0,
    };
  }

  function pendingOf(pokemonId: string): MoveView[] {
    const rows = db.prepare('SELECT move FROM pending_moves WHERE pokemon_id = ? ORDER BY rowid').all(pokemonId) as { move: string }[];
    return rows.map((row) => moveView(row.move));
  }

  function evolutionsOf(row: PokemonRow, species: NonNullable<ReturnType<typeof data.speciesById.get>>, slots: MoveSlot[]): EvolutionChoice[] {
    const moveTypes = slots.map((slot) => data.movesByName.get(slot.name)?.type).filter((type): type is TypeName => type !== undefined);
    return availableEvolutions(species, {
      level: row.level, friendship: row.friendship, moveTypes, hour: new Date().getHours(),
      has: (item) => inventory.quantity(row.save_id, item) > 0,
    }, itemName).map((choice) => (choice.ready && regionBlocked(row.save_id, choice.speciesId)
      ? { ...choice, ready: false, reason: 'Essa espécie é de uma região que você ainda não liberou.' }
      : choice));
  }

  function formsOf(row: PokemonRow, species: NonNullable<ReturnType<typeof data.speciesById.get>>): TransformChoice[] {
    if (species.forms.length === 0) return [];
    return availableForms(species, {
      level: row.level, form: row.form,
      has: (item) => inventory.quantity(row.save_id, item) > 0,
      owns: (id) => owns(row.save_id, id),
      itemName,
    });
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

  /** Primeira vaga livre do PC (ignora a equipe), contando as posições já reservadas em `taken`. */
  function firstFreeBox(saveId: string, taken: Set<number> = new Set()): { box: number; slot: number } {
    const used = new Set((db.prepare('SELECT box, box_slot FROM pokemon WHERE save_id = ? AND box IS NOT NULL').all(saveId) as { box: number; box_slot: number }[]).map((r) => r.box * BOX_SIZE + r.box_slot));
    let position = 0;
    while (used.has(position) || taken.has(position)) position++;
    const box = Math.floor(position / BOX_SIZE);
    if (box > MAX_BOX_INDEX) throw badRequest('O PC está cheio.');
    taken.add(position);
    return { box, slot: position % BOX_SIZE };
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

    /** Monta a equipe com estes Pokémon (em ordem); quem sai da equipe vai para o PC. */
    applyTeam(saveId: string, ids: string[]): void {
      assertSave(saveId);
      transaction(db, () => {
        const wanted = ids.filter((id) => db.prepare('SELECT 1 FROM pokemon WHERE id = ? AND save_id = ?').get(id, saveId));
        if (wanted.length === 0) throw badRequest('Nenhum Pokémon dessa equipe existe mais.');
        const leaving = teamRows(saveId).filter((row) => !wanted.includes(row.id));
        for (const id of [...wanted, ...leaving.map((row) => row.id)]) writeLocation(id, null);
        wanted.forEach((id, index) => writeLocation(id, { kind: 'team', slot: index }));
        const taken = new Set<number>();
        for (const row of leaving) writeLocation(row.id, { kind: 'box', ...firstFreeBox(saveId, taken) });
      });
    },

    /** Soma o preço de um item gasto no Pokémon ao valor investido (conta na venda). */
    invest(pokemonId: string, item: string): void {
      const price = data.itemsByName.get(item)?.price ?? 0;
      if (price > 0) db.prepare('UPDATE pokemon SET invested = invested + ? WHERE id = ?').run(price, pokemonId);
    },

    investedOf(saveId: string, pokemonId: string): number {
      return (db.prepare('SELECT invested FROM pokemon WHERE id = ? AND save_id = ?').get(pokemonId, saveId) as { invested: number } | undefined)?.invested ?? 0;
    },

    /** Remove um Pokémon do save para sempre (aposta perdida no cassino) e fecha o buraco da equipe. */
    remove(saveId: string, pokemonId: string): void {
      getRow(saveId, pokemonId);
      transaction(db, () => {
        db.prepare('DELETE FROM pokemon WHERE id = ? AND save_id = ?').run(pokemonId, saveId);
        compactTeam(saveId);
        if (teamRows(saveId).length === 0) {
          // a equipe nunca fica vazia: o primeiro Pokémon do PC sobe
          const next = db.prepare('SELECT id FROM pokemon WHERE save_id = ? ORDER BY box, box_slot LIMIT 1').get(saveId) as { id: string } | undefined;
          if (next) writeLocation(next.id, { kind: 'team', slot: 0 });
        }
      });
    },

    /** Quantos Pokémon o save tem (equipe + PC). */
    count(saveId: string): number {
      return (db.prepare('SELECT COUNT(*) AS n FROM pokemon WHERE save_id = ?').get(saveId) as { n: number }).n;
    },

    /** Um Pokémon do save, já no formato da API. */
    view(saveId: string, pokemonId: string): PokemonView {
      return rowToView(getRow(saveId, pokemonId));
    },

    setHp(saveId: string, pokemonId: string, hp: number): void {
      getRow(saveId, pokemonId);
      db.prepare('UPDATE pokemon SET current_hp = ? WHERE id = ?').run(Math.max(0, Math.floor(hp)), pokemonId);
    },

    /** Centro Pokémon: HP e PP cheios para toda a equipe. Devolve quantos precisavam de cura. */
    healTeam(saveId: string): number {
      assertSave(saveId);
      let healed = 0;
      transaction(db, () => {
        for (const row of teamRows(saveId)) {
          const view = rowToView(row);
          const slots = (JSON.parse(row.moves) as MoveSlot[]).map((slot) => ({ ...slot, pp: slot.maxPp }));
          const ppFull = slots.every((slot, i) => slot.pp === (JSON.parse(row.moves) as MoveSlot[])[i]?.pp);
          if (row.current_hp < view.stats.hp || !ppFull) healed++;
          db.prepare('UPDATE pokemon SET current_hp = ?, moves = ? WHERE id = ?').run(view.stats.hp, JSON.stringify(slots), row.id);
        }
      });
      return healed;
    },

    /** Guarda o resultado de uma batalha (nível, XP, golpes, amizade) e cura toda a equipe. */
    applyBattle(saveId: string, combatants: Combatant[]): void {
      assertSave(saveId);
      transaction(db, () => {
        for (const c of combatants) {
          if (!c.ref) continue;
          const row = db.prepare('SELECT * FROM pokemon WHERE id = ? AND save_id = ?').get(c.ref, saveId) as PokemonRow | undefined;
          if (!row) continue;
          const friendship = c.fought ? Math.min(255, row.friendship + 5) : row.friendship;
          if (c.capped) {
            db.prepare('UPDATE pokemon SET friendship = ? WHERE id = ?').run(friendship, row.id);
            continue;
          }
          const slots = c.moves.map((slot) => ({ ...slot, pp: slot.maxPp }));
          db.prepare('UPDATE pokemon SET level = ?, exp = ?, moves = ?, friendship = ? WHERE id = ?').run(c.level, c.exp, JSON.stringify(slots), friendship, row.id);
          for (const move of c.pendingMoves) db.prepare('INSERT OR IGNORE INTO pending_moves (pokemon_id, move) VALUES (?, ?)').run(row.id, move);
        }
        this.healTeam(saveId);
      });
    },

    /** Evolui por escolha do jogador (botão no perfil). Gasta a pedra/objeto, se o caminho exigir. */
    evolve(saveId: string, pokemonId: string, toSpeciesId: unknown): PokemonView {
      const row = getRow(saveId, pokemonId);
      const view = rowToView(row);
      const choice = view.evolutions.find((entry) => entry.speciesId === toSpeciesId);
      if (!choice) throw badRequest('Este Pokémon não pode evoluir assim.');
      if (!choice.ready) throw badRequest(choice.reason ?? 'Ainda não dá para evoluir.');
      const next = data.speciesById.get(choice.speciesId);
      if (!next) throw badRequest('Espécie desconhecida.');
      transaction(db, () => {
        if (choice.item && !inventory.take(saveId, choice.item)) throw badRequest(`Falta ${itemName(choice.item)}.`);
        const grown = { ...row, species_id: next.id, form: null };
        const newMax = rowToView(grown).stats.hp;
        const hp = Math.min(newMax, row.current_hp + Math.max(0, newMax - view.stats.hp));
        db.prepare('UPDATE pokemon SET species_id = ?, current_hp = ?, form = NULL WHERE id = ?').run(next.id, hp, row.id);
        recordCaught(saveId, next.id);
        if (choice.item) this.invest(row.id, choice.item);
      });
      return rowToView(getRow(saveId, pokemonId));
    },

    /** Mega, Primal, G-Max ou fusão: permanente; gasta o item e mantém os parceiros da fusão na coleção. */
    transform(saveId: string, pokemonId: string, formName: unknown): PokemonView {
      const row = getRow(saveId, pokemonId);
      const view = rowToView(row);
      const choice = view.forms.find((entry) => entry.name === formName);
      if (!choice) throw badRequest('Este Pokémon não tem essa forma.');
      if (!choice.ready) throw badRequest(choice.reason ?? 'Ainda não dá.');
      transaction(db, () => {
        if (choice.item && !inventory.take(saveId, choice.item)) throw badRequest(`Falta ${itemName(choice.item)}.`);
        const next = { ...row, form: choice.name };
        const newMax = rowToView(next).stats.hp;
        const hp = Math.min(newMax, row.current_hp + Math.max(0, newMax - view.stats.hp));
        db.prepare('UPDATE pokemon SET form = ?, current_hp = ? WHERE id = ?').run(choice.name, hp, row.id);
        if (choice.item) this.invest(row.id, choice.item);
      });
      return rowToView(getRow(saveId, pokemonId));
    },

    /** Essência de IV (+1, máx. 31). Se o IV já está no máximo, falha sem gastar o item. */
    useEssence(saveId: string, pokemonId: string, item: string): PokemonView {
      const stat = IV_ESSENCES[item];
      if (!stat) throw badRequest('Esse item não é uma Essência de IV.');
      const row = getRow(saveId, pokemonId);
      const ivs = JSON.parse(row.ivs) as Stats;
      if (ivs[stat] >= 31) throw badRequest('Esse IV já está no máximo; o item não foi gasto.');
      transaction(db, () => {
        if (!inventory.take(saveId, item)) throw badRequest('Você não tem esse item.');
        const before = rowToView(row).stats.hp;
        const updated = { ...row, ivs: JSON.stringify({ ...ivs, [stat]: ivs[stat] + 1 }) };
        const after = rowToView(updated).stats.hp;
        db.prepare('UPDATE pokemon SET ivs = ?, current_hp = ? WHERE id = ?').run(updated.ivs, Math.min(after, row.current_hp + Math.max(0, after - before)), row.id);
        this.invest(row.id, item);
      });
      return rowToView(getRow(saveId, pokemonId));
    },

    /** Doce de EXP (XP fixo) ou Doce Raro (+1 nível). Golpes novos entram sozinhos ou esperam vaga no perfil. */
    useCandy(saveId: string, pokemonId: string, item: string): { pokemon: PokemonView; gained: number; levels: number } {
      const row = getRow(saveId, pokemonId);
      const species = data.speciesById.get(row.species_id);
      if (!species) throw notFound('Espécie desconhecida.');
      if (row.level >= MAX_LEVEL) throw badRequest('Esse Pokémon já está no nível máximo.');
      const amount = item === RARE_CANDY ? expForLevel(species.growthRate, row.level + 1) - row.exp : EXP_CANDIES[item];
      if (amount === undefined) throw badRequest('Esse item não é um doce.');
      return transaction(db, () => {
        if (!inventory.take(saveId, item)) throw badRequest('Você não tem esse item.');
        const maxExp = expForLevel(species.growthRate, MAX_LEVEL);
        const exp = Math.min(maxExp, row.exp + amount);
        const level = levelForExp(species.growthRate, exp);
        const before = rowToView(row).stats.hp;
        const grown = { ...row, exp, level };
        const after = rowToView(grown).stats.hp;
        const slots = JSON.parse(row.moves) as MoveSlot[];
        for (let l = row.level + 1; l <= level; l++) {
          for (const entry of species.learnset) {
            if (entry.method !== 'level-up' || entry.level !== l) continue;
            const move = data.movesByName.get(entry.move);
            if (!move || !isUsableMove(move) || slots.some((slot) => slot.name === move.name)) continue;
            if (slots.length < 4) slots.push(toMoveSlot(move));
            else db.prepare('INSERT OR IGNORE INTO pending_moves (pokemon_id, move) VALUES (?, ?)').run(row.id, move.name);
          }
        }
        db.prepare('UPDATE pokemon SET exp = ?, level = ?, moves = ?, current_hp = ? WHERE id = ?')
          .run(exp, level, JSON.stringify(slots), Math.min(after, row.current_hp > 0 ? row.current_hp + Math.max(0, after - before) : 0), row.id);
        this.invest(row.id, item);
        return { pokemon: rowToView(getRow(saveId, pokemonId)), gained: exp - row.exp, levels: level - row.level };
      });
    },

    /** Aprende um golpe pendente, trocando por um dos quatro atuais (ou descarta). */
    learnMove(saveId: string, pokemonId: string, input: { move?: unknown; replace?: unknown }): PokemonView {
      const row = getRow(saveId, pokemonId);
      const name = typeof input.move === 'string' ? input.move : '';
      const pending = db.prepare('SELECT 1 FROM pending_moves WHERE pokemon_id = ? AND move = ?').get(row.id, name);
      if (!pending) throw badRequest('Esse golpe não está esperando uma vaga.');
      const move = data.movesByName.get(name);
      if (!move) throw badRequest('Golpe desconhecido.');
      const slots = JSON.parse(row.moves) as MoveSlot[];
      transaction(db, () => {
        if (input.replace !== null && input.replace !== undefined) {
          const index = Number(input.replace);
          if (!Number.isInteger(index) || index < 0 || index >= slots.length) throw badRequest('Escolha qual golpe esquecer.');
          slots[index] = toMoveSlot(move);
          db.prepare('UPDATE pokemon SET moves = ? WHERE id = ?').run(JSON.stringify(slots), row.id);
        }
        db.prepare('DELETE FROM pending_moves WHERE pokemon_id = ? AND move = ?').run(row.id, name);
      });
      return rowToView(getRow(saveId, pokemonId));
    },

    moveOptions: (saveId: string, pokemonId: string): MoveOptions => moveOptionsOf(saveId, pokemonId),

    /** Compra uma TM para este Pokémon (fica com ele para sempre; ainda precisa ser ensinada numa vaga). */
    buyTm(saveId: string, pokemonId: string, input: { move?: unknown }): MoveOptions {
      const name = typeof input.move === 'string' ? input.move : '';
      const options = moveOptionsOf(saveId, pokemonId);
      const choice = options.learnable.find((item) => item.move.name === name && item.source === 'machine');
      if (!choice) throw badRequest('Esse POKÉMON não aprende esse golpe por TM.');
      if (choice.unlocked) throw badRequest('Ele já tem essa TM.');
      if (options.money < choice.price) throw badRequest(`Dinheiro insuficiente: essa TM custa ₽ ${choice.price.toLocaleString('pt-BR')}.`);
      transaction(db, () => {
        db.prepare('UPDATE saves SET money = money - ?, updated_at = ? WHERE id = ?').run(choice.price, new Date().toISOString(), saveId);
        db.prepare('INSERT OR IGNORE INTO tm_owned (pokemon_id, move) VALUES (?, ?)').run(pokemonId, name);
      });
      return moveOptionsOf(saveId, pokemonId);
    },

    /** Troca o golpe de uma vaga (ou preenche uma vaga livre) por um golpe permitido; TM novo é comprado na hora. */
    teachMove(saveId: string, pokemonId: string, input: { move?: unknown; slot?: unknown }): PokemonView {
      const name = typeof input.move === 'string' ? input.move : '';
      const options = moveOptionsOf(saveId, pokemonId);
      const choice = options.learnable.find((item) => item.move.name === name);
      if (!choice) throw badRequest('Esse POKÉMON não pode aprender esse golpe.');
      if (choice.known) throw badRequest('Ele já conhece esse golpe.');
      const move = data.movesByName.get(name);
      if (!move) throw badRequest('Golpe desconhecido.');
      const row = getRow(saveId, pokemonId);
      const slots = JSON.parse(row.moves) as MoveSlot[];
      const index = Number(input.slot);
      const max = Math.min(4, slots.length + 1);
      if (!Number.isInteger(index) || index < 0 || index >= max) throw badRequest('Escolha uma vaga de golpe.');
      if (!choice.unlocked) throw badRequest(`Compre a TM de ${move.displayName} para este POKÉMON primeiro.`);
      transaction(db, () => {
        slots[index] = toMoveSlot(move);
        db.prepare('UPDATE pokemon SET moves = ? WHERE id = ?').run(JSON.stringify(slots), row.id);
        db.prepare('DELETE FROM pending_moves WHERE pokemon_id = ? AND move = ?').run(row.id, name);
      });
      return rowToView(getRow(saveId, pokemonId));
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
