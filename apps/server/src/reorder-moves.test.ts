import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { PokemonView, SaveDetail } from '@pokesim/engine';
import { openDatabase } from './db.ts';
import { createApp } from './app.ts';

const db = openDatabase(':memory:');
const server = createApp({ db, assetsDir: mkdtempSync(path.join(tmpdir(), 'pokesim-assets-')) });
let base = '';
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { server.close(); db.close(); });

async function call<T>(method: string, url: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await fetch(base + url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : null });
  return { status: res.status, json: (await res.json()) as T };
}

test('ordenar golpes: muda a posição, os outros deslizam e valida', async () => {
  const save = (await call<SaveDetail>('POST', '/api/saves', { trainerName: 'Ordem', starterSpeciesId: 1 })).json;
  const mon = save.team[0] as PokemonView;
  const before = mon.moves.map((move) => move.name);
  assert.ok(before.length >= 2);
  const url = `/api/saves/${save.id}/pokemon/${mon.id}/reorder-moves`;
  const expected = [...before.slice(1), before[0]];
  const moved = await call<PokemonView>('POST', url, { from: 0, to: before.length - 1 });
  assert.equal(moved.status, 201);
  assert.deepEqual(moved.json.moves.map((move) => move.name), expected);
  const reread = (await call<SaveDetail>('GET', `/api/saves/${save.id}`)).json;
  assert.deepEqual(reread.team[0]!.moves.map((move) => move.name), expected);
  assert.equal((await call('POST', url, { from: 1, to: 1 })).status, 201);
  assert.equal((await call('POST', url, { from: 0, to: 9 })).status, 400);
  assert.equal((await call('POST', url, { from: -1, to: 0 })).status, 400);
  assert.equal((await call('POST', url, { from: 'a', to: 0 })).status, 400);
});
