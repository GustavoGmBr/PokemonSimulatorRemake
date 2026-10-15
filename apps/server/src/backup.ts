import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Db } from './db.ts';

export const BACKUPS_KEPT = 5;
const NAME = /^game-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(-\d+)?\.db$/;

export interface BackupInfo {
  name: string;
  size: number;
  createdAt: string;
}

export function backupsDirOf(dbPath: string): string {
  return path.join(path.dirname(dbPath), 'backups');
}

export function listBackups(dir: string): BackupInfo[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => NAME.test(name))
    .sort()
    .reverse()
    .map((name) => {
      const stat = statSync(path.join(dir, name));
      return { name, size: stat.size, createdAt: stat.mtime.toISOString() };
    });
}

/**
 * Copia consistente do banco (VACUUM INTO) para <pasta do banco>/backups, guardando as últimas `keep`.
 * Não faz nada se ainda não existe nenhum save. Devolve o nome do arquivo criado.
 */
export function backupDatabase(db: Db, dir: string, keep = BACKUPS_KEPT, now = new Date()): string | null {
  const saves = (db.prepare('SELECT COUNT(*) AS n FROM saves').get() as { n: number }).n;
  if (saves === 0) return null;
  mkdirSync(dir, { recursive: true });
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  let name = `game-${stamp}.db`;
  for (let i = 2; existsSync(path.join(dir, name)); i++) name = `game-${stamp}-${i}.db`;
  db.exec(`VACUUM INTO '${path.join(dir, name).replace(/'/g, "''")}'`);
  for (const old of listBackups(dir).slice(keep)) rmSync(path.join(dir, old.name), { force: true });
  return name;
}
