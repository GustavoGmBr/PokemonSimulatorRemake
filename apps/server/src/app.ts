import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadGameData } from '@pokesim/data';
import type { Db } from './db.ts';
import { Router, sendJson, serveFile } from './http.ts';
import { createSaveService } from './saves.ts';
import { notFound } from './errors.ts';

export interface AppOptions {
  db: Db;
  assetsDir: string;
  webDist?: string;
}

export function createApp({ db, assetsDir, webDist }: AppOptions): Server {
  const saves = createSaveService(db);
  const data = loadGameData();
  const router = new Router()
    .get('/api/health', () => ({ ok: true, species: data.species.length }))
    .get('/api/saves', () => saves.list())
    .post('/api/saves', ({ body }) => saves.create((body ?? {}) as { trainerName: unknown; starterSpeciesId: unknown }))
    .get('/api/saves/:id', ({ params }) => saves.get(params.id as string))
    .delete('/api/saves/:id', ({ params }) => { saves.remove(params.id as string); })
    .get('/api/starters', () => saves.starters())
    .get('/api/species/:id', ({ params }) => {
      const species = data.speciesById.get(Number(params.id));
      if (!species) throw notFound('Espécie não encontrada.');
      return species;
    });

  const hasWeb = Boolean(webDist && existsSync(path.join(webDist, 'index.html')));

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (await router.handle(req, res, url)) return;

    if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Rota não encontrada.' });

    if (url.pathname.startsWith('/assets/') && req.method === 'GET') {
      if (serveFile(res, assetsDir, url.pathname.slice('/assets/'.length))) return;
      return sendJson(res, 404, { error: 'Sprite não encontrada.' });
    }

    // Em produção, a própria API entrega a interface já compilada.
    if (hasWeb && webDist && req.method === 'GET') {
      if (url.pathname !== '/' && serveFile(res, webDist, url.pathname.slice(1))) return;
      if (serveFile(res, webDist, 'index.html', 'no-cache')) return;
    }
    sendJson(res, 404, { error: 'Não encontrado.' });
  });
}
