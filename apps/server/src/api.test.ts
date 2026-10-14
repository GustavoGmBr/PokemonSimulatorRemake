import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type {
  BoxView, DevGrantResult, HealthInfo, PokedexView, PokemonSearchResult, PokemonView, SaveDetail, SaveSummary, StarterRegion,
} from '@pokesim/engine';
import { openDatabase } from './db.ts';
import { createApp } from './app.ts';

const assets = mkdtempSync(path.join(tmpdir(), 'pokesim-assets-'));
mkdirSync(path.join(assets, 'pokemon'));
writeFileSync(path.join(assets, 'pokemon', '1-front.png'), 'png');

const db = openDatabase(':memory:');
const server = createApp({ db, assetsDir: assets, devTools: true });
let base = '';

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { server.close(); db.close(); });

async function call<T>(method: string, url: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await fetch(base + url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : null,
  });
  return { status: res.status, json: (res.status === 204 ? null : await res.json()) as T };
}

test('lista os iniciais das nove regiões', async () => {
  const { status, json } = await call<StarterRegion[]>('GET', '/api/starters');
  assert.equal(status, 200);
  assert.equal(json.length, 9);
  assert.deepEqual(json[0]?.starters.map((s) => s.name), ['Bulbasaur', 'Charmander', 'Squirtle']);
});

test('cria, lê, lista e exclui um save', async () => {
  const created = await call<SaveDetail>('POST', '/api/saves', { trainerName: '  Gustavo ', starterSpeciesId: 4 });
  assert.equal(created.status, 201);
  assert.equal(created.json.trainerName, 'Gustavo');
  assert.equal(created.json.money, 3000);
  assert.equal(created.json.team.length, 1);
  const starter = created.json.team[0];
  assert.equal(starter?.speciesName, 'Charmander');
  assert.equal(starter?.level, 5);
  assert.equal(starter?.ivStars, 4);
  assert.equal(starter?.currentHp, starter?.stats.hp);
  assert.ok(starter?.favorite);
  assert.deepEqual(created.json.inventory.map((i) => [i.item, i.quantity]), [['poke-ball', 10], ['potion', 5]]);
  assert.equal(created.json.pokedexCaught, 1);

  const list = await call<SaveSummary[]>('GET', '/api/saves');
  assert.equal(list.json.length, 1);
  assert.deepEqual(list.json[0]?.teamPreview, [{ speciesId: 4, shiny: false, level: 5 }]);

  const removed = await call('DELETE', `/api/saves/${created.json.id}`);
  assert.equal(removed.status, 204);
  assert.equal((await call('GET', `/api/saves/${created.json.id}`)).status, 404);
});

test('valida nome e inicial', async () => {
  assert.equal((await call('POST', '/api/saves', { trainerName: '', starterSpeciesId: 1 })).status, 400);
  assert.equal((await call('POST', '/api/saves', { trainerName: 'Nome muito longo aqui', starterSpeciesId: 1 })).status, 400);
  const notStarter = await call<{ error: string }>('POST', '/api/saves', { trainerName: 'Ash', starterSpeciesId: 150 });
  assert.equal(notStarter.status, 400);
  assert.match(notStarter.json.error, /iniciais/);
});

test('serve sprites e bloqueia caminhos fora da pasta', async () => {
  assert.equal((await fetch(`${base}/assets/pokemon/1-front.png`)).status, 200);
  assert.equal((await fetch(`${base}/assets/pokemon/999-front.png`)).status, 404);
  assert.equal((await fetch(`${base}/assets/..%2f..%2fetc%2fpasswd`)).status, 404);
});

async function newSave(name = 'Teste'): Promise<SaveDetail> {
  return (await call<SaveDetail>('POST', '/api/saves', { trainerName: name, starterSpeciesId: 1 })).json;
}

async function grant(saveId: string, count: number): Promise<DevGrantResult> {
  const res = await call<DevGrantResult>('POST', `/api/saves/${saveId}/dev/grant`, { count });
  assert.equal(res.status, 201);
  return res.json;
}

test('health informa as ferramentas de teste', async () => {
  const { json } = await call<HealthInfo>('GET', '/api/health');
  assert.equal(json.devTools, true);
  assert.equal(json.species, 1025);
});

test('Pokémon novos enchem a equipe e depois vão para o PC, sem limite de caixas', async () => {
  const save = await newSave();
  const result = await grant(save.id, 100);
  assert.equal(result.added, 100);
  assert.equal(result.inTeam, 5);
  assert.equal(result.inBoxes, 95);

  const box0 = (await call<BoxView>('GET', `/api/saves/${save.id}/box/0`)).json;
  assert.equal(box0.slots.length, 30);
  assert.equal(box0.slots.filter(Boolean).length, 30);
  assert.equal(box0.totalInBoxes, 95);
  assert.equal(box0.highestUsedBox, 3);
  const box3 = (await call<BoxView>('GET', `/api/saves/${save.id}/box/3`)).json;
  assert.equal(box3.slots.filter(Boolean).length, 5);
  const far = (await call<BoxView>('GET', `/api/saves/${save.id}/box/500`)).json;
  assert.equal(far.slots.filter(Boolean).length, 0);
  assert.equal((await call('GET', `/api/saves/${save.id}/box/-1`)).status, 400);
  assert.equal((await call('GET', `/api/saves/${save.id}/box/abc`)).status, 400);
});

test('mover entre equipe e PC: depositar, sacar e trocar', async () => {
  const save = await newSave();
  await grant(save.id, 7); // equipe cheia (6) + 1 no PC
  const team = (await call<SaveDetail>('GET', `/api/saves/${save.id}`)).json.team;
  assert.equal(team.length, 6);
  const [first, second] = team as [PokemonView, PokemonView];
  const inBox = (await call<BoxView>('GET', `/api/saves/${save.id}/box/0`)).json.slots[0] as PokemonView;

  // depositar a 2ª em uma vaga livre do PC compacta a equipe
  assert.equal((await call('POST', `/api/saves/${save.id}/pokemon/${second.id}/move`, { to: { kind: 'box', box: 7, slot: 3 } })).status, 204);
  let after = (await call<SaveDetail>('GET', `/api/saves/${save.id}`)).json.team;
  assert.equal(after.length, 5);
  assert.deepEqual(after.map((p) => p.location), [0, 1, 2, 3, 4].map((slot) => ({ kind: 'team', slot })));
  assert.equal((await call<BoxView>('GET', `/api/saves/${save.id}/box/7`)).json.slots[3]?.id, second.id);

  // sacar para a equipe (há vaga) entra no fim
  await call('POST', `/api/saves/${save.id}/pokemon/${inBox.id}/move`, { to: { kind: 'team', slot: 5 } });
  after = (await call<SaveDetail>('GET', `/api/saves/${save.id}`)).json.team;
  assert.equal(after.length, 6);
  assert.equal(after[5]?.id, inBox.id);

  // equipe cheia: sacar em cima de alguém troca os dois
  await call('POST', `/api/saves/${save.id}/pokemon/${second.id}/move`, { to: { kind: 'team', slot: 0 } });
  after = (await call<SaveDetail>('GET', `/api/saves/${save.id}`)).json.team;
  assert.equal(after[0]?.id, second.id);
  assert.equal((await call<BoxView>('GET', `/api/saves/${save.id}/box/7`)).json.slots[3]?.id, first.id);

  // reordenar dentro da equipe troca de lugar
  await call('POST', `/api/saves/${save.id}/pokemon/${second.id}/move`, { to: { kind: 'team', slot: 2 } });
  const reordered = (await call<SaveDetail>('GET', `/api/saves/${save.id}`)).json.team;
  assert.equal(reordered[2]?.id, second.id);
  assert.equal(reordered.length, 6);

  // destinos inválidos
  assert.equal((await call('POST', `/api/saves/${save.id}/pokemon/${second.id}/move`, { to: { kind: 'team', slot: 9 } })).status, 400);
  assert.equal((await call('POST', `/api/saves/${save.id}/pokemon/${second.id}/move`, { to: { kind: 'box', box: -2, slot: 0 } })).status, 400);
  assert.equal((await call('POST', `/api/saves/${save.id}/pokemon/${second.id}/move`, {})).status, 400);
  assert.equal((await call('POST', `/api/saves/${save.id}/pokemon/nao-existe/move`, { to: { kind: 'box', box: 0, slot: 0 } })).status, 404);
});

test('não deixa depositar o último Pokémon da equipe', async () => {
  const save = await newSave();
  const only = save.team[0] as PokemonView;
  const res = await call<{ error: string }>('POST', `/api/saves/${save.id}/pokemon/${only.id}/move`, { to: { kind: 'box', box: 0, slot: 0 } });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /ao menos um/);
});

test('um save não mexe nos Pokémon de outro', async () => {
  const a = await newSave('A');
  const b = await newSave('B');
  const mine = a.team[0] as PokemonView;
  assert.equal((await call('PATCH', `/api/saves/${b.id}/pokemon/${mine.id}`, { favorite: false })).status, 404);
  assert.equal((await call('POST', `/api/saves/${b.id}/pokemon/${mine.id}/move`, { to: { kind: 'box', box: 0, slot: 0 } })).status, 404);
});

test('apelido e favorito', async () => {
  const save = await newSave();
  const mon = save.team[0] as PokemonView;
  const named = await call<PokemonView>('PATCH', `/api/saves/${save.id}/pokemon/${mon.id}`, { nickname: '  Sr.   Folha ' });
  assert.equal(named.status, 200);
  assert.equal(named.json.nickname, 'Sr. Folha');
  assert.equal(named.json.name, 'Sr. Folha');
  assert.equal(named.json.speciesName, 'Bulbasaur');
  assert.equal((await call('PATCH', `/api/saves/${save.id}/pokemon/${mon.id}`, { nickname: 'nome grande demais' })).status, 400);
  assert.equal((await call('PATCH', `/api/saves/${save.id}/pokemon/${mon.id}`, { nickname: 5 })).status, 400);
  const cleared = await call<PokemonView>('PATCH', `/api/saves/${save.id}/pokemon/${mon.id}`, { nickname: '', favorite: false });
  assert.equal(cleared.json.nickname, null);
  assert.equal(cleared.json.name, 'Bulbasaur');
  assert.equal(cleared.json.favorite, false);
  assert.equal((await call('PATCH', `/api/saves/${save.id}/pokemon/${mon.id}`, { favorite: 'sim' })).status, 400);
});

test('busca: filtros, ordenação e paginação', async () => {
  const save = await newSave();
  await grant(save.id, 120);
  const all = (await call<PokemonSearchResult>('GET', `/api/saves/${save.id}/pokemon?limit=100`)).json;
  assert.equal(all.total, 121);
  assert.equal(all.items.length, 100);
  const page2 = (await call<PokemonSearchResult>('GET', `/api/saves/${save.id}/pokemon?limit=100&offset=100`)).json;
  assert.equal(page2.items.length, 21);

  const byLevel = (await call<PokemonSearchResult>('GET', `/api/saves/${save.id}/pokemon?sort=level&dir=desc&limit=100`)).json;
  const levels = byLevel.items.map((p) => p.level);
  assert.deepEqual(levels, [...levels].sort((x, y) => y - x));

  const fire = (await call<PokemonSearchResult>('GET', `/api/saves/${save.id}/pokemon?type=fire&limit=100`)).json;
  assert.ok(fire.total > 0);
  assert.ok(fire.items.every((p) => p.types.includes('fire')));

  const gen1 = (await call<PokemonSearchResult>('GET', `/api/saves/${save.id}/pokemon?generation=1&limit=100`)).json;
  assert.ok(gen1.items.every((p) => p.generation === 1 && p.speciesId <= 151));

  const range = (await call<PokemonSearchResult>('GET', `/api/saves/${save.id}/pokemon?minLevel=30&maxLevel=40&limit=100`)).json;
  assert.ok(range.items.every((p) => p.level >= 30 && p.level <= 40));

  const favs = (await call<PokemonSearchResult>('GET', `/api/saves/${save.id}/pokemon?favorite=true`)).json;
  assert.equal(favs.total, 1);
  assert.equal(favs.items[0]?.speciesName, 'Bulbasaur');

  const byName = (await call<PokemonSearchResult>('GET', `/api/saves/${save.id}/pokemon?text=bulba`)).json;
  assert.ok(byName.items.some((p) => p.speciesName === 'Bulbasaur'));

  assert.equal((await call('GET', `/api/saves/${save.id}/pokemon?type=lixo`)).status, 400);
  assert.equal((await call('GET', `/api/saves/${save.id}/pokemon?minLevel=abc`)).status, 400);
  assert.equal((await call('GET', `/api/saves/nao-existe/pokemon`)).status, 404);
});

test('Pokédex: capturado, não visto e contagem de exemplares', async () => {
  const save = await newSave();
  const dex = (await call<PokedexView>('GET', `/api/saves/${save.id}/pokedex`)).json;
  assert.equal(dex.total, 1025);
  assert.equal(dex.states.length, 1025);
  assert.equal(dex.states[0], 2);
  assert.equal(dex.states[1], 0);
  assert.equal(dex.caught, 1);
  assert.equal(dex.seen, 1);
  assert.equal(dex.owned[1], 1);

  await grant(save.id, 50);
  const after = (await call<PokedexView>('GET', `/api/saves/${save.id}/pokedex`)).json;
  assert.ok(after.caught > 1);
  assert.equal(Object.values(after.owned).reduce((sum, n) => sum + n, 0), 51);
  assert.equal(after.states.filter((state) => state === 2).length, after.caught);
});

test('tempo de jogo soma e limita a cada aviso', async () => {
  const save = await newSave();
  assert.equal((await call('POST', `/api/saves/${save.id}/playtime`, { seconds: 30 })).status, 204);
  assert.equal((await call('POST', `/api/saves/${save.id}/playtime`, { seconds: 99999 })).status, 204);
  assert.equal((await call('POST', `/api/saves/${save.id}/playtime`, { seconds: -5 })).status, 400);
  assert.equal((await call('POST', `/api/saves/${save.id}/playtime`, {})).status, 400);
  const detail = (await call<SaveDetail>('GET', `/api/saves/${save.id}`)).json;
  assert.equal(detail.playTimeSeconds, 30 + 120);
});

test('catálogo para a interface', async () => {
  const index = (await call<{ id: number; name: string }[]>('GET', '/api/catalog/species-index')).json;
  assert.equal(index.length, 1025);
  assert.equal(index[24]?.name, 'Pikachu');
  assert.equal((await call<unknown[]>('GET', '/api/catalog/types')).json.length, 18);
});

test('ferramenta de teste fica de fora quando desligada', async () => {
  const db2 = openDatabase(':memory:');
  const server2 = createApp({ db: db2, assetsDir: assets });
  await new Promise<void>((resolve) => server2.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server2.address() as AddressInfo).port}`;
  const health = (await (await fetch(`${url}/api/health`)).json()) as HealthInfo;
  assert.equal(health.devTools, false);
  assert.equal((await fetch(`${url}/api/saves/x/dev/grant`, { method: 'POST', body: '{}' })).status, 404);
  server2.close();
  db2.close();
});
