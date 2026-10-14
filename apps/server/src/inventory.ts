import type { Db } from './db.ts';

/** Acesso simples à mochila de um save. */
export function createInventory(db: Db) {
  return {
    quantity(saveId: string, item: string): number {
      const row = db.prepare('SELECT quantity FROM inventory WHERE save_id = ? AND item = ?').get(saveId, item) as { quantity: number } | undefined;
      return row?.quantity ?? 0;
    },
    add(saveId: string, item: string, amount: number): void {
      db.prepare(`
        INSERT INTO inventory (save_id, item, quantity) VALUES (?, ?, ?)
        ON CONFLICT (save_id, item) DO UPDATE SET quantity = quantity + excluded.quantity
      `).run(saveId, item, amount);
    },
    /** Tira `amount` do item; falha (false) se não houver o bastante. */
    take(saveId: string, item: string, amount = 1): boolean {
      const result = db.prepare('UPDATE inventory SET quantity = quantity - ? WHERE save_id = ? AND item = ? AND quantity >= ?')
        .run(amount, saveId, item, amount);
      return Number(result.changes) === 1;
    },
  };
}
export type Inventory = ReturnType<typeof createInventory>;
