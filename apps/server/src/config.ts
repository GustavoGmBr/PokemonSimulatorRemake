import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const repoRoot = path.resolve(serverRoot, '../..');

function resolveFromRepo(value: string | undefined, fallback: string): string {
  return path.resolve(repoRoot, value && value.trim() ? value : fallback);
}

/**
 * Pacote portátil (Windows): o inicializador define POKESIM_HOME com a pasta de instalação.
 * Saves em <pasta>/saves, imagens em <pasta>/assets e a interface em <pasta>/app/web.
 */
const home = process.env.POKESIM_HOME?.trim() ? path.resolve(process.env.POKESIM_HOME) : undefined;

export const config = {
  host: '127.0.0.1',
  port: Number(process.env.PORT ?? 34600),
  dbPath: home && !process.env.DB_PATH ? path.join(home, 'saves/game.db') : resolveFromRepo(process.env.DB_PATH, 'apps/server/data/game.db'),
  /**
   * Pasta com as sprites (subpastas pokemon/, items/, types/).
   * Por padrão usa as sprites já baixadas pela versão anterior, na pasta vizinha.
   */
  assetsDir: home && !process.env.ASSETS_DIR ? path.join(home, 'assets') : resolveFromRepo(process.env.ASSETS_DIR, '../PokemonSimulator Sqlite/backend/public'),
  /** Ferramentas de teste (ex.: ganhar Pokémon aleatórios). Ligadas na alpha; POKESIM_DEV=0 desliga. */
  devTools: process.env.POKESIM_DEV !== '0',
  /** versão exibida no console e usada pelo atualizador */
  version: process.env.POKESIM_VERSION ?? 'dev',
  webDist: process.env.WEB_DIST ? path.resolve(process.env.WEB_DIST) : home ? path.join(home, 'app/web') : path.join(repoRoot, 'apps/web/dist'),
};
