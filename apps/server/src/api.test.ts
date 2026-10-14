import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { SaveDetail, SaveSummary, StarterRegion } from '@pokesim/engine';
import { openDatabase } from './db.ts';
import { createApp } from './app.ts';

const assets = mkdtempSync(path.join(tmpdir(), 'pokesim-assets-'));
mkdirSync(path.join(assets, 'pokemon'));
writeFileSync(path.join(assets, 'pokemon', '1-front.png'), 'png');

const db = openDatabase(':memory:');
const server = createApp({ db, assetsDir: assets });
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
