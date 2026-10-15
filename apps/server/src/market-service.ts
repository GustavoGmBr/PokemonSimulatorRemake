import { randomInt, randomUUID } from 'node:crypto';
import {
  MARKET_REFRESH_MS, MARKET_REFRESH_PRICE, MARKET_SHINY_DENOMINATOR, MARKET_SIZE, createPokemon, isLegendary, ivQuality, marketPeriod, marketPrice,
  regionOfSpecies, regionProgress, rngFrom, rollIvs, saleValue, unlockedRegionIds,
  type MarketEntry, type MarketState, type PokemonView, type Stats,
} from '@pokesim/engine';
import { loadGameData } from '@pokesim/data';
import { transaction, type Db } from './db.ts';
import { badRequest, notFound } from './errors.ts';
import type { PokemonStore } from './pokemon-store.ts';
import type { Inventory } from './inventory.ts';
import type { Journal } from './journal.ts';

interface Stored {
  id: string;
  speciesId: number;
  generation: number;
  regionUnlocked: boolean;
  shiny: boolean;
  ivs: Stats;
  stars: number;
  price: number;
  available: boolean;
  favorite: boolean;
}

/** Mercado de Pokémon (16 à venda, renova por hora, favoritos ficam fixos) e venda de Pokémon da coleção. */
export function createMarketService(db: Db, store: PokemonStore, inventory: Inventory, journal: Journal, now: () => number = Date.now) {
  const data = loadGameData();
  const rng = rngFrom(randomInt);

  function assertSave(saveId: string): void {
    if (!db.prepare('SELECT 1 FROM saves WHERE id = ?').get(saveId)) throw notFound('Save não encontrado.');
  }
  const moneyOf = (saveId: string) => (db.prepare('SELECT money FROM saves WHERE id = ?').get(saveId) as { money: number }).money;
  const doneChallenges = (saveId: string) => (db.prepare('SELECT challenge_id FROM badges WHERE save_id = ?').all(saveId) as { challenge_id: string }[]).map((row) => row.challenge_id);

  function makeStock(saveId: string, size: number, excluded: number[]): Stored[] {
    const done = doneChallenges(saveId);
    const unlocked = unlockedRegionIds(done);
    const rolls = 1 + (inventory.quantity(saveId, 'shiny-charm') > 0 ? 2 : 0);
    const skip = new Set(excluded);
    const pool = data.species.filter((species) => {
      if (skip.has(species.id)) return false;
      if (!isLegendary(species)) return true;
      const home = regionOfSpecies(species.id)?.id;
      return home !== undefined && regionProgress(done, home).elite; // lendário só depois da Elite dos 4 da região
    });
    const list: Stored[] = [];
    while (list.length < size && pool.length > 0) {
      const [species] = pool.splice(rng.int(pool.length), 1);
      if (!species) break;
      const region = regionOfSpecies(species.id);
      const regionUnlocked = region ? unlocked.includes(region.id) : false;
      let shiny = false;
      for (let i = 0; i < rolls && !shiny; i++) shiny = rng.int(MARKET_SHINY_DENOMINATOR) === 0;
      let ivs = rollIvs(rng);
      while (ivQuality(ivs).stars < 2) ivs = rollIvs(rng);
      const stars = ivQuality(ivs).stars;
      list.push({ id: randomUUID(), speciesId: species.id, generation: region?.generation ?? 0, regionUnlocked, shiny, ivs, stars, price: marketPrice(regionUnlocked, shiny, stars), available: true, favorite: false });
    }
    return list;
  }

  function stockOf(saveId: string): { period: number; list: Stored[] } {
    const period = marketPeriod(now());
    const row = db.prepare('SELECT period, state FROM market_stock WHERE save_id = ?').get(saveId) as { period: number; state: string } | undefined;
    let list = row ? (JSON.parse(row.state) as Stored[]) : [];
    if (!row || row.period !== period) {
      const favorites = list.filter((entry) => entry.favorite && entry.available);
      list = [...favorites, ...makeStock(saveId, Math.max(0, MARKET_SIZE - favorites.length), favorites.map((entry) => entry.speciesId))];
      write(saveId, period, list);
    } else if (list.length < MARKET_SIZE) {
      list = [...list, ...makeStock(saveId, MARKET_SIZE - list.length, list.map((entry) => entry.speciesId))];
      write(saveId, period, list);
    }
    return { period, list };
  }
  function write(saveId: string, period: number, list: Stored[]): void {
    db.prepare('INSERT INTO market_stock (save_id, period, state) VALUES (?, ?, ?) ON CONFLICT (save_id) DO UPDATE SET period = excluded.period, state = excluded.state').run(saveId, period, JSON.stringify(list));
  }

  function view(entry: Stored): MarketEntry {
    const species = data.speciesById.get(entry.speciesId);
    return {
      id: entry.id, speciesId: entry.speciesId, spriteId: entry.speciesId, name: species?.displayName ?? `#${entry.speciesId}`, generation: entry.generation,
      regionUnlocked: entry.regionUnlocked, level: 1, shiny: entry.shiny, stars: entry.stars, price: entry.price, available: entry.available, favorite: entry.favorite,
    };
  }

  function valueOf(saveId: string, mon: PokemonView): number {
    const species = data.speciesById.get(mon.speciesId);
    return saleValue({
      level: mon.level, ball: mon.ball, legendary: Boolean(species && isLegendary(species)), shiny: mon.shiny,
      ivMultiplier: ivQuality(mon.ivs).valueMultiplier, invested: store.investedOf(saveId, mon.id),
    });
  }

  function state(saveId: string): MarketState {
    assertSave(saveId);
    const { period, list } = stockOf(saveId);
    const all = store.search(saveId, { limit: 500, sort: 'level', dir: 'asc' }).items;
    return {
      money: moneyOf(saveId),
      stock: list.map(view),
      msLeft: (period + 1) * MARKET_REFRESH_MS - now(),
      refreshPrice: MARKET_REFRESH_PRICE,
      sellable: all.map((mon) => ({ id: mon.id, speciesId: mon.speciesId, spriteId: mon.spriteId, name: mon.name, level: mon.level, shiny: mon.shiny, favorite: mon.favorite, value: valueOf(saveId, mon), ball: mon.ball })),
    };
  }

  return {
    state,

    buy(saveId: string, stockId: unknown): { state: MarketState; pokemon: PokemonView; price: number } {
      assertSave(saveId);
      return transaction(db, () => {
        const { period, list } = stockOf(saveId);
        const entry = list.find((item) => item.id === stockId);
        if (!entry) throw notFound('Este Pokémon não está mais no estoque. Atualize o mercado.');
        if (!entry.available) throw badRequest('Este Pokémon já foi comprado.');
        const paid = db.prepare('UPDATE saves SET money = money - ?, updated_at = ? WHERE id = ? AND money >= ?').run(entry.price, new Date().toISOString(), saveId, entry.price);
        if (Number(paid.changes) !== 1) throw badRequest('Pokédólares insuficientes.');
        entry.available = false;
        entry.favorite = false;
        write(saveId, period, list);
        const species = data.speciesById.get(entry.speciesId);
        if (!species) throw badRequest('Espécie desconhecida.');
        const instance = createPokemon({ species, level: 1, rng, moves: data.movesByName, ivs: entry.ivs, shiny: entry.shiny });
        const placed = store.place(saveId, { ...instance, ball: 'poke-ball' });
        journal.record(saveId, { kind: 'compra', speciesId: species.id, amount: entry.price, text: `Comprou ${entry.shiny ? '✨ ' : ''}${species.displayName} no mercado por ₽ ${entry.price.toLocaleString('pt-BR')}.` });
        return { state: state(saveId), pokemon: store.view(saveId, placed.id), price: entry.price };
      });
    },

    /** Troca o estoque (₽ 3.000); os favoritos ficam. */
    refresh(saveId: string): MarketState {
      assertSave(saveId);
      return transaction(db, () => {
        const { period, list } = stockOf(saveId);
        const paid = db.prepare('UPDATE saves SET money = money - ?, updated_at = ? WHERE id = ? AND money >= ?').run(MARKET_REFRESH_PRICE, new Date().toISOString(), saveId, MARKET_REFRESH_PRICE);
        if (Number(paid.changes) !== 1) throw badRequest('São necessários ₽ 3.000 para atualizar o estoque.');
        const favorites = list.filter((entry) => entry.favorite && entry.available);
        write(saveId, period, [...favorites, ...makeStock(saveId, Math.max(0, MARKET_SIZE - favorites.length), favorites.map((entry) => entry.speciesId))]);
        return state(saveId);
      });
    },

    /** Fixa (ou solta) um Pokémon do estoque: ele sobrevive às renovações até ser comprado. */
    favorite(saveId: string, stockId: unknown, favorite: unknown): MarketState {
      assertSave(saveId);
      const { period, list } = stockOf(saveId);
      const entry = list.find((item) => item.id === stockId);
      if (!entry) throw notFound('Este Pokémon não está mais no estoque. Atualize o mercado.');
      if (!entry.available) throw badRequest('Um Pokémon comprado não pode ser fixado.');
      entry.favorite = favorite === true;
      write(saveId, period, list);
      return state(saveId);
    },

    /** Vende um ou vários Pokémon; favoritos ficam, e é preciso manter ao menos um. */
    sell(saveId: string, ids: unknown): { sold: number; money: number; state: MarketState } {
      assertSave(saveId);
      const wanted = Array.isArray(ids) ? [...new Set(ids.filter((id): id is string => typeof id === 'string'))] : [];
      if (wanted.length === 0) throw badRequest('Escolha ao menos um Pokémon.');
      if (db.prepare('SELECT 1 FROM battles WHERE save_id = ?').get(saveId)) throw badRequest('Encerre a batalha atual antes de vender Pokémon.');
      return transaction(db, () => {
        const mons = wanted.map((id) => {
          try { return store.view(saveId, id); } catch { throw notFound('Um ou mais Pokémon não pertencem à sua coleção.'); }
        });
        if (mons.some((mon) => mon.favorite)) throw badRequest('Remova a marca de favorito antes de vender este Pokémon.');
        if (store.count(saveId) <= mons.length) throw badRequest('Mantenha pelo menos um Pokémon na coleção.');
        let total = 0;
        for (const mon of mons) {
          const value = valueOf(saveId, mon);
          total += value;
          store.remove(saveId, mon.id);
          journal.record(saveId, { kind: 'venda', speciesId: mon.speciesId, amount: value, text: `Vendeu ${mon.shiny ? '✨ ' : ''}${mon.name} (Nv ${mon.level}) por ₽ ${value.toLocaleString('pt-BR')}.` });
        }
        db.prepare('UPDATE saves SET money = money + ?, updated_at = ? WHERE id = ?').run(total, new Date().toISOString(), saveId);
        return { sold: mons.length, money: moneyOf(saveId), state: state(saveId) };
      });
    },
  };
}
export type MarketService = ReturnType<typeof createMarketService>;
