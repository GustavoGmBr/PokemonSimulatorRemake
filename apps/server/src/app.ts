import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadGameData } from '@pokesim/data';
import { remoteSpriteUrl } from '@pokesim/engine';
import type { Db } from './db.ts';
import { Router, sendJson, serveFile } from './http.ts';
import type { HealthInfo, SearchPokemonQuery, SortKey, SpeciesIndexEntry } from '@pokesim/engine';
import { createSaveService } from './saves.ts';
import { createPokemonStore } from './pokemon-store.ts';
import { createInventory } from './inventory.ts';
import { createTeamService } from './team-service.ts';
import { createBattleService } from './battle-service.ts';
import { createWildService } from './wild-service.ts';
import { createItemService } from './item-service.ts';
import { badRequest, notFound } from './errors.ts';
import { createCasinoService } from './casino-service.ts';
import { createTournamentService } from './tournament-service.ts';
import { createJournal } from './journal.ts';
import { createJourneyService } from './journey-service.ts';
import { createMarketService } from './market-service.ts';

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
  const journal = createJournal(db);
  const wild = createWildService(db, store, inventory, journal);
  const items = createItemService(db, store, inventory);
  const battle = createBattleService(db, store, inventory, wild, journal);
  const teams = createTeamService(db, store);
  const casino = createCasinoService(db, store, inventory);
  const tournaments = createTournamentService(db, store, battle);
  const journey = createJourneyService(db, inventory);
  const market = createMarketService(db, store, inventory, journal);
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
    .get('/api/saves/:id/battle', ({ params }) => battle.current(params.id as string))
    .post('/api/saves/:id/battle/start', ({ params }) => battle.start(params.id as string))
    .get('/api/saves/:id/challenges', ({ params }) => battle.challenges(params.id as string))
    .post('/api/saves/:id/battle/challenge', ({ params, body }) => battle.startChallenge(params.id as string, (body as { challengeId?: unknown } | null)?.challengeId))
    .post('/api/saves/:id/battle/trainer', ({ params, body }) => battle.startTrainer(params.id as string, (body as { difficulty?: unknown } | null)?.difficulty))
    .post('/api/saves/:id/battle/act', ({ params, body }) => battle.act(params.id as string, body))
    .post('/api/saves/:id/pokemon/:pid/evolve', ({ params, body }) => store.evolve(params.id as string, params.pid as string, (body as { speciesId?: unknown } | null)?.speciesId))
    .post('/api/saves/:id/pokemon/:pid/transform', ({ params, body }) => store.transform(params.id as string, params.pid as string, (body as { form?: unknown } | null)?.form))
    .get('/api/saves/:id/teams', ({ params }) => teams.list(params.id as string))
    .post('/api/saves/:id/teams', ({ params, body }) => teams.create(params.id as string, (body ?? {}) as { name?: unknown }))
    .patch('/api/saves/:id/teams/:tid', ({ params, body }) => teams.update(params.id as string, params.tid as string, (body ?? {}) as { name?: unknown; useCurrent?: unknown }))
    .delete('/api/saves/:id/teams/:tid', ({ params }) => teams.remove(params.id as string, params.tid as string))
    .post('/api/saves/:id/teams/:tid/apply', ({ params }) => teams.apply(params.id as string, params.tid as string))
    .get('/api/saves/:id/casino', ({ params }) => casino.state(params.id as string))
    .post('/api/saves/:id/casino/chips', ({ params, body }) => casino.buyChips(params.id as string, (body ?? {}) as { amount?: unknown }))
    .post('/api/saves/:id/casino/prize', ({ params, body }) => casino.buyPrize(params.id as string, (body ?? {}) as { item?: unknown; quantity?: unknown }))
    .post('/api/saves/:id/casino/round/act', ({ params, body }) => casino.act(params.id as string, (body ?? {}) as { action?: unknown; index?: unknown }))
    .post('/api/saves/:id/casino/round/abandon', ({ params }) => casino.abandon(params.id as string))
    .post('/api/saves/:id/casino/:game/play', ({ params, body }) => casino.play(params.id as string, params.game as string, (body ?? {}) as Record<string, unknown>))
    .post('/api/saves/:id/casino/:game/start', ({ params, body }) => casino.start(params.id as string, params.game as string, (body ?? {}) as Record<string, unknown>))
    .get('/api/saves/:id/tournaments', ({ params }) => tournaments.state(params.id as string))
    .post('/api/saves/:id/tournaments/enter', ({ params, body }) => tournaments.enter(params.id as string, (body ?? {}) as { tier?: unknown; members?: unknown }))
    .post('/api/saves/:id/tournaments/next', ({ params }) => tournaments.next(params.id as string))
    .post('/api/saves/:id/tournaments/abandon', ({ params }) => tournaments.abandon(params.id as string))
    .get('/api/saves/:id/missions', ({ params }) => journey.state(params.id as string))
    .post('/api/saves/:id/missions/claim', ({ params, body }) => journey.claim(params.id as string, (body ?? {}) as { period?: unknown; index?: unknown }))
    .get('/api/saves/:id/history', ({ params }) => journey.history(params.id as string))
    .get('/api/saves/:id/market', ({ params }) => market.state(params.id as string))
    .post('/api/saves/:id/market/buy', ({ params, body }) => market.buy(params.id as string, (body as { id?: unknown } | null)?.id))
    .post('/api/saves/:id/market/refresh', ({ params }) => market.refresh(params.id as string))
    .post('/api/saves/:id/market/favorite', ({ params, body }) => market.favorite(params.id as string, (body as { id?: unknown } | null)?.id, (body as { favorite?: unknown } | null)?.favorite))
    .post('/api/saves/:id/market/sell', ({ params, body }) => market.sell(params.id as string, (body as { ids?: unknown } | null)?.ids))
    .get('/api/saves/:id/pokemon/:pid/moves', ({ params }) => store.moveOptions(params.id as string, params.pid as string))
    .post('/api/saves/:id/pokemon/:pid/tm', ({ params, body }) => store.buyTm(params.id as string, params.pid as string, (body ?? {}) as { move?: unknown }))
    .post('/api/saves/:id/pokemon/:pid/teach', ({ params, body }) => store.teachMove(params.id as string, params.pid as string, (body ?? {}) as { move?: unknown; slot?: unknown }))
    .post('/api/saves/:id/pokemon/:pid/learn', ({ params, body }) => store.learnMove(params.id as string, params.pid as string, (body ?? {}) as { move?: unknown; replace?: unknown }))
    .get('/api/saves/:id/shop', ({ params }) => items.shop(params.id as string))
    .post('/api/saves/:id/shop/buy', ({ params, body }) => items.buy(params.id as string, (body as { cart?: unknown } | null)?.cart))
    .post('/api/saves/:id/items/use', ({ params, body }) => items.useItem(params.id as string, (body ?? {}) as { item?: unknown; pokemonId?: unknown }))
    .get('/api/starters', () => saves.starters())
    .get('/api/catalog/species-index', () => speciesIndex)
    .get('/api/catalog/types', () => data.types)
    .get('/api/catalog/moves', () => data.moves)
    .get('/api/catalog/items', () => data.items)
    .get('/api/catalog/pokeapi-items', () => data.pokeapiItems)
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
      const file = url.pathname.slice('/assets/'.length);
      if (serveFile(res, assetsDir, file)) return;
      // Sprite ainda não baixada: com internet, a imagem vem direto da origem (npm run sprites guarda tudo local).
      const remote = remoteSpriteUrl(file);
      if (remote) {
        res.writeHead(302, { Location: remote, 'Cache-Control': 'no-store' });
        return void res.end();
      }
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
