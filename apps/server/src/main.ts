import { existsSync } from 'node:fs';
import { config } from './config.ts';
import { openDatabase } from './db.ts';
import { createApp } from './app.ts';

const db = openDatabase(config.dbPath);
const server = createApp({ db, assetsDir: config.assetsDir, webDist: config.webDist });

server.listen(config.port, config.host, () => {
  console.log(`API do Pokémon Simulator em http://${config.host}:${config.port}`);
  console.log(`  banco:   ${config.dbPath}`);
  console.log(`  sprites: ${config.assetsDir}${existsSync(config.assetsDir) ? '' : '  (pasta não encontrada — defina ASSETS_DIR no .env)'}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    db.close();
    process.exit(0);
  });
}
