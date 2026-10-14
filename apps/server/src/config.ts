import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const repoRoot = path.resolve(serverRoot, '../..');

function resolveFromRepo(value: string | undefined, fallback: string): string {
  return path.resolve(repoRoot, value && value.trim() ? value : fallback);
}

export const config = {
  host: '127.0.0.1',
  port: Number(process.env.PORT ?? 34600),
  dbPath: resolveFromRepo(process.env.DB_PATH, 'apps/server/data/game.db'),
  /**
   * Pasta com as sprites (subpastas pokemon/, items/, types/).
   * Por padrão usa as sprites já baixadas pela versão anterior, na pasta vizinha.
   */
  assetsDir: resolveFromRepo(process.env.ASSETS_DIR, '../PokemonSimulator Sqlite/backend/public'),
  webDist: path.join(repoRoot, 'apps/web/dist'),
};
