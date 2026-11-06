import { completedDexGenerations } from '@pokesim/engine';
import type { Db } from './db.ts';

/** O Amuleto Brilhante só beneficia as gerações com a Pokédex capturada por completo neste save. */
export function shinyCharmGenerations(db: Db, saveId: string): number[] {
  const charm = db.prepare("SELECT quantity FROM inventory WHERE save_id = ? AND item = 'shiny-charm'")
    .get(saveId) as { quantity: number } | undefined;
  if (!charm || charm.quantity <= 0) return [];
  const caught = db.prepare('SELECT species_id FROM pokedex WHERE save_id = ? AND caught = 1')
    .all(saveId) as { species_id: number }[];
  return completedDexGenerations(new Set(caught.map((row) => row.species_id)));
}
