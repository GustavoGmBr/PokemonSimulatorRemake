import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { config } from './config.ts';
import { openDatabase } from './db.ts';
import { createApp } from './app.ts';

mkdirSync(path.dirname(config.dbPath), { recursive: true });
const db = openDatabase(config.dbPath);
const server = createApp({ db, assetsDir: config.assetsDir, webDist: config.webDist, devTools: config.devTools });

server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(`Não foi possível iniciar: ${error.code === 'EADDRINUSE' ? `a porta ${config.port} já está em uso.` : error.message}`);
  db.close();
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  console.log(`API do Pokémon Simulator ${config.version} em http://${config.host}:${config.port}`);
  console.log(`  banco:   ${config.dbPath}`);
  console.log(`  sprites: ${config.assetsDir}${existsSync(config.assetsDir) ? '' : '  (ainda não baixadas; com internet elas são buscadas na origem)'}`);
  // O inicializador do Windows espera esta linha para abrir o navegador.
  console.log(`Jogo pronto: http://${config.host}:${config.port}/`);
});

function shutdown(): void {
  server.close();
  db.close();
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, shutdown);

// Inicializador gráfico: a linha "stop" (ou o fechamento do stdin) encerra o jogo com o banco fechado.
if (process.env.POKESIM_GUI === '1') {
  const lines = createInterface({ input: process.stdin });
  lines.on('line', (line) => { if (line.trim() === 'stop') shutdown(); });
  lines.on('close', shutdown);
}
