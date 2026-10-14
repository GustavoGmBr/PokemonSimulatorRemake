import {
  MAX_STACK, PREMIER_BALL, PREMIER_EVERY, REGIONS, SHOP_CATEGORIES, UNIQUE_ITEMS, applyHealItem, championId, eliteId, gymId,
  type BuyResult, type DevKitResult, type DevProgressResult, type ShopEntry, type UseItemResult,
} from '@pokesim/engine';
import { loadGameData } from '@pokesim/data';
import { transaction, type Db } from './db.ts';
import { badRequest, notFound } from './errors.ts';
import type { PokemonStore } from './pokemon-store.ts';
import type { Inventory } from './inventory.ts';

/** Itens e loja. */
export function createItemService(db: Db, store: PokemonStore, inventory: Inventory) {
  const data = loadGameData();

  function money(saveId: string): number {
    const row = db.prepare('SELECT money FROM saves WHERE id = ?').get(saveId) as { money: number } | undefined;
    if (!row) throw notFound('Save não encontrado.');
    return row.money;
  }

  const buyable = data.items.filter((item) => item.price !== null && (SHOP_CATEGORIES as readonly string[]).includes(item.category));
  const buyableByName = new Map(buyable.map((item) => [item.name, item]));

  return {
    shop(saveId: string): ShopEntry[] {
      money(saveId);
      return buyable.map((item) => ({
        item: item.name,
        displayName: item.displayName,
        category: item.category,
        description: item.description,
        price: item.price as number,
        owned: inventory.quantity(saveId, item.name),
      }));
    },

    /** Compra um carrinho inteiro de uma vez: ou tudo passa, ou nada. */
    buy(saveId: string, cart: unknown): BuyResult {
      const current = money(saveId);
      if (!Array.isArray(cart) || cart.length === 0) throw badRequest('O carrinho está vazio.');
      const wanted = new Map<string, number>();
      for (const line of cart as { item?: unknown; quantity?: unknown }[]) {
        const quantity = Number(line?.quantity);
        if (typeof line?.item !== 'string' || !buyableByName.has(line.item)) throw badRequest('Item indisponível na loja.');
        if (!Number.isInteger(quantity) || quantity < 1) throw badRequest('Quantidade inválida.');
        wanted.set(line.item, (wanted.get(line.item) ?? 0) + quantity);
      }
      let total = 0;
      for (const [name, quantity] of wanted) {
        const item = buyableByName.get(name);
        if (!item) continue;
        const limit = UNIQUE_ITEMS.has(name) ? 1 : MAX_STACK;
        if (inventory.quantity(saveId, name) + quantity > limit) {
          throw badRequest(UNIQUE_ITEMS.has(name) ? `${item.displayName}: só é possível ter um.` : `${item.displayName}: máximo de ${MAX_STACK} na mochila.`);
        }
        total += (item.price as number) * quantity;
      }
      if (total > current) throw badRequest('Dinheiro insuficiente.');
      const premier = Math.min(Math.floor((wanted.get('poke-ball') ?? 0) / PREMIER_EVERY), Math.max(0, MAX_STACK - inventory.quantity(saveId, PREMIER_BALL)));
      transaction(db, () => {
        db.prepare('UPDATE saves SET money = money - ?, updated_at = ? WHERE id = ?').run(total, new Date().toISOString(), saveId);
        for (const [name, quantity] of wanted) inventory.add(saveId, name, quantity);
        if (premier > 0) inventory.add(saveId, PREMIER_BALL, premier);
      });
      return { spent: total, money: current - total, premier };
    },

    /** Usa uma poção, reviver etc. em um Pokémon (fora de batalha). */
    useItem(saveId: string, input: { item?: unknown; pokemonId?: unknown }): UseItemResult {
      money(saveId);
      const itemName = typeof input.item === 'string' ? input.item : '';
      const pokemonId = typeof input.pokemonId === 'string' ? input.pokemonId : '';
      if (!data.itemsByName.has(itemName)) throw badRequest('Item desconhecido.');
      const mon = store.view(saveId, pokemonId);
      const result = applyHealItem(itemName, mon.currentHp, mon.stats.hp);
      if (!result.ok) throw badRequest(result.reason);
      return transaction(db, () => {
        if (!inventory.take(saveId, itemName)) throw badRequest('Você não tem esse item.');
        store.setHp(saveId, pokemonId, result.newHp);
        return { pokemon: store.view(saveId, pokemonId), healed: result.healed, remaining: inventory.quantity(saveId, itemName) };
      });
    },

    // ---- ferramentas de teste da alpha ----
    devKit(saveId: string): DevKitResult {
      money(saveId);
      let balls = 0;
      transaction(db, () => {
        for (const item of data.items) {
          if (item.category === 'captura') { inventory.add(saveId, item.name, 10); balls += 10; }
          if (item.category === 'cura') inventory.add(saveId, item.name, 5);
        }
        db.prepare('UPDATE saves SET money = money + 20000 WHERE id = ?').run(saveId);
      });
      return { balls };
    },

    /** Libera o próximo desafio na ordem (ginásios, Elite dos 4, campeão; região por região). */
    devProgress(saveId: string, all = false): DevProgressResult {
      money(saveId);
      const won = new Set((db.prepare('SELECT challenge_id FROM badges WHERE save_id = ?').all(saveId) as { challenge_id: string }[]).map((row) => row.challenge_id));
      const order = REGIONS.flatMap((region) => [
        ...Array.from({ length: 8 }, (_, i) => gymId(region.id, i + 1)), ...[1, 2, 3, 4].map((n) => eliteId(region.id, n)), championId(region.id),
      ]);
      const pending = order.filter((id) => !won.has(id));
      const grant = all ? pending : pending.slice(0, 1);
      const insert = db.prepare('INSERT OR IGNORE INTO badges (save_id, challenge_id, won_at) VALUES (?, ?, ?)');
      const now = new Date().toISOString();
      transaction(db, () => { for (const id of grant) insert.run(saveId, id, now); });
      return { granted: grant.length === 0 ? null : all ? `${grant.length} desafios` : (grant[0] as string) };
    },

    /** Machuca a equipe (HP aleatório, às vezes 0) para testar poções e o Centro Pokémon. */
    devHurt(saveId: string): number {
      let count = 0;
      for (const mon of store.team(saveId)) {
        const hp = Math.random() < 0.3 ? 0 : Math.max(1, Math.floor(mon.stats.hp * Math.random() * 0.6));
        store.setHp(saveId, mon.id, hp);
        count++;
      }
      return count;
    },
  };
}
export type ItemService = ReturnType<typeof createItemService>;
