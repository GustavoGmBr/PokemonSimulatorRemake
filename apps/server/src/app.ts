import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadGameData } from '@pokesim/data';
import type { Db } from './db.ts';
import { Router, sendJson, serveFile } from './http.ts';
import type { HealthInfo, SearchPokemonQuery, SortKey, SpeciesIndexEntry } from '@pokesim/engine';
import { createSaveService } from './saves.ts';
import { createPokemonStore } from './pokemon-store.ts';
import { createInventory } from './inventory.ts';
import { createWildService } from './wild-service.ts';
import { createItemService } from './item-service.ts';
import { badRequest, notFound } from './errors.ts';

export interface AppOptions {
  db: Db;
  assetsDir: string;
  webDist?: string;
  /** liga as ferramentas de teste da alpha (padrão: desligado nos testes) */
  devTools?: boolean;
}

function numberParam(url: URL, key: string): number | undefined {
  const raw = url.searchParams.get(key);
  if (raw === null || raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw badRequest(`Parâmetro "${key}" inválido.`);
  return value;
}

function boolParam(url: URL, key: string): boolean | undefined {
  const raw = url.searchParams.get(key);
  if (raw === null || raw === '') return undefined;
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  throw badRequest(`Parâmetro "${key}" inválido.`);
}

function searchQuery(url: URL): SearchPokemonQuery {
  const query: SearchPokemonQuery = {};
  const text = url.searchParams.get('text');
  const type = url.searchParams.get('type');
  const sort = url.searchParams.get('sort');
  const dir = url.searchParams.get('dir');
  if (text) query.text = text;
  if (type) query.type = type;
  if (sort) query.sort = sort as SortKey;
  if (dir === 'asc' || dir === 'desc') query.dir = dir;
  for (const key of ['generation', 'minStars', 'minLevel', 'maxLevel', 'limit', 'offset'] as const) {
    const value = numberParam(url, key);
    if (value !== undefined) query[key] = value;
  }
  for (const key of ['shiny', 'favorite'] as const) {
    const value = boolParam(url, key);
    if (value !== undefined) query[key] = value;
  }
  return query;
}

export function createApp({ db, assetsDir, webDist, devTools = false }: AppOptions): Server {
  const store = createPokemonStore(db);
  const saves = createSaveService(db, store);
  const inventory = createInventory(db);
  const wild = createWildService(db, store, inventory);
  const items = createItemService(db, store, inventory);
  const data = loadGameData();
  const speciesIndex: SpeciesIndexEntry[] = data.species.map((s) => ({
    id: s.id, name: s.displayName, types: s.types, generation: s.generation,
    baseStatTotal: Object.values(s.baseStats).reduce((sum, value) => sum + value, 0),
  }));
  const router = new Router()
    .get('/api/health', (): HealthInfo => ({ ok: true, species: data.species.length, devTools }))
    .get('/api/saves', () => saves.list())
    .post('/api/saves', ({ body }) => saves.create((body ?? {}) as { trainerName: unknown; starterSpeciesId: unknown }))
    .get('/api/saves/:id', ({ params }) => saves.get(params.id as string))
    .delete('/api/saves/:id', ({ params }) => { saves.remove(params.id as string); })
    .post('/api/saves/:id/playtime', ({ params, body }) => {
      saves.addPlayTime(params.id as string, (body as { seconds?: unknown } | null)?.seconds);
    })
    .get('/api/saves/:id/box/:n', ({ params }) => store.box(params.id as string, Number(params.n)))
    .get('/api/saves/:id/pokemon', ({ params, url }) => store.search(params.id as string, searchQuery(url)))
    .post('/api/saves/:id/pokemon/:pid/move', ({ params, body }) => {
      store.move(params.id as string, params.pid as string, (body as { to?: never } | null)?.to as never);
    })
    .patch('/api/saves/:id/pokemon/:pid', ({ params, body }) =>
      store.patch(params.id as string, params.pid as string, (body ?? {}) as { nickname?: unknown; favorite?: unknown }))
    .get('/api/saves/:id/pokedex', ({ params }) => store.pokedex(params.id as string))
    .get('/api/saves/:id/wild', ({ params }) => wild.state(params.id as string))
    .post('/api/saves/:id/wild/search', ({ params, body }) => wild.search(params.id as string, (body ?? {}) as { region?: unknown; speciesId?: unknown; habitat?: unknown; minLevel?: unknown; maxLevel?: unknown }))
    .post('/api/saves/:id/wild/spin', ({ params, body }) => wild.spin(params.id as string, (body as { pay?: unknown } | null)?.pay === true))
    .post('/api/saves/:id/wild/leave', ({ params }) => wild.leave(params.id as string))
    .post('/api/saves/:id/wild/choose', ({ params, body }) => wild.choose(params.id as string, (body as { slot?: unknown } | null)?.slot))
    .post('/api/saves/:id/wild/flee', ({ params }) => wild.flee(params.id as string))
    .post('/api/saves/:id/wild/throw', ({ params, body }) => wild.throwBall(params.id as string, (body as { ball?: unknown } | null)?.ball))
    .get('/api/saves/:id/shop', ({ params }) => items.shop(params.id as string))
    .post('/api/saves/:id/shop/buy', ({ params, body }) => items.buy(params.id as string, (body as { cart?: unknown } | null)?.cart))
    .post('/api/saves/:id/items/use', ({ params, body }) => items.useItem(params.id as string, (body ?? {}) as { item?: unknown; pokemonId?: unknown }))
    .get('/api/starters', () => saves.starters())
    .get('/api/catalog/species-index', () => speciesIndex)
    .get('/api/catalog/types', () => data.types)
    .get('/api/catalog/moves', () => data.moves)
    .get('/api/catalog/items', () => data.items)
    .get('/api/species/:id', ({ params }) => {
      const species = data.speciesById.get(Number(params.id));
      if (!species) throw notFound('Espécie não encontrada.');
      return species;
    });
  if (devTools) {
    router.post('/api/saves/:id/dev/grant', ({ params, body }) =>
      saves.devGrant(params.id as string, (body as { count?: unknown } | null)?.count));
    router.post('/api/saves/:id/dev/kit', ({ params }) => items.devKit(params.id as string));
    router.post('/api/saves/:id/dev/progress', ({ params, body }) => items.devProgress(params.id as string, (body as { all?: unknown } | null)?.all === true));
    router.post('/api/saves/:id/dev/hurt', ({ params }) => ({ hurt: items.devHurt(params.id as string) }));
  }

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
