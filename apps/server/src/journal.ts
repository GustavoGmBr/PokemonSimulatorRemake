import type { Db } from './db.ts';

export interface JournalEntry {
  kind: string;
  text?: string;
  region?: string | null;
  speciesId?: number | null;
  difficulty?: string | null;
  tournament?: string | null;
  /** 'vitoria' | 'derrota' nos eventos de batalha */
  result?: string | null;
  /** valor em ₽ (vendas e compras) */
  amount?: number;
}

/** Diário da jornada: cada captura, vitória, venda… vira um evento (alimenta missões, histórico e estatísticas). */
export function createJournal(db: Db) {
  const insert = db.prepare('INSERT INTO events (save_id, kind, region, species_id, difficulty, tournament, result, amount, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  return {
    record(saveId: string, entry: JournalEntry, at = new Date()): void {
      insert.run(saveId, entry.kind, entry.region ?? null, entry.speciesId ?? null, entry.difficulty ?? null, entry.tournament ?? null, entry.result ?? null, entry.amount ?? 0, entry.text ?? '', at.toISOString());
    },
  };
}
export type Journal = ReturnType<typeof createJournal>;
