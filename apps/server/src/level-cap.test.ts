import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { pokemonLevelCap, type PokemonView, type SaveDetail, type UseItemResult } from '@pokesim/engine';
import { openDatabase } from './db.ts';
import { createApp } from './app.ts';

const db = openDatabase(':memory:');
const server = createApp({ db, assetsDir: mkdtempSync(path.join(tmpdir(), 'pokesim-cap-')), devTools: true });
let base = '';
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { server.close(); db.close(); });

async function call<T>(method: string, url: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await fetch(base + url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : null });
  return { status: res.status, json: (res.status === 204 ? null : await res.json()) as T };
}
async function setup() {
  const save = (await call<SaveDetail>('POST', '/api/saves', { trainerName: 'Teste', starterSpeciesId: 4 })).json;
  return { save, url: `/api/saves/${save.id}`, mon: save.team[0] as PokemonView };
}
const give = (saveId: string, item: string, qty = 1) => db.prepare('INSERT INTO inventory (save_id, item, quantity) VALUES (?, ?, ?) ON CONFLICT (save_id, item) DO UPDATE SET quantity = quantity + excluded.quantity').run(saveId, item, qty);
const badge = (saveId: string, id: string) => db.prepare("INSERT OR IGNORE INTO badges (save_id, challenge_id, won_at) VALUES (?, ?, '2026-01-01')").run(saveId, id);

test('nível máximo do Pokémon segue a região da geração dele', () => {
  assert.equal(pokemonLevelCap([], 25), 10, 'Kanto sem ginásio: 10');
  assert.equal(pokemonLevelCap(['kanto:gym1'], 25), 16);
  assert.equal(pokemonLevelCap(['kanto:gym1', 'kanto:gym2', 'kanto:gym3'], 25), 28);
  assert.equal(pokemonLevelCap(['kanto:gym1', 'kanto:gym2', 'kanto:gym3'], 152), 10, 'Johto não herda os ginásios de Kanto');
  assert.equal(pokemonLevelCap(['kanto:champion'], 1), 100);
});

test('doces param no nível liberado e voltam a funcionar depois de vencer o ginásio', async () => {
  const { save, url, mon } = await setup();
  db.prepare('UPDATE pokemon SET level = 9, exp = 729 WHERE id = ?').run(mon.id);
  give(save.id, 'rare-candy', 5);
  const up = await call<UseItemResult>('POST', `${url}/items/use`, { item: 'rare-candy', pokemonId: mon.id });
  assert.equal(up.status, 201);
  assert.equal(up.json.pokemon.level, 10);
  const blocked = await call<{ message?: string; error?: string }>('POST', `${url}/items/use`, { item: 'rare-candy', pokemonId: mon.id });
  assert.equal(blocked.status, 400);
  assert.equal((db.prepare("SELECT quantity FROM inventory WHERE save_id = ? AND item = 'rare-candy'").get(save.id) as { quantity: number }).quantity, 4, 'o doce não foi gasto');
  badge(save.id, 'kanto:gym1');
  const next = await call<UseItemResult>('POST', `${url}/items/use`, { item: 'rare-candy', pokemonId: mon.id });
  assert.equal(next.status, 201);
  assert.equal(next.json.pokemon.level, 11);
  // doce de EXP grande: sobe só até o limite (16)
  give(save.id, 'exp-candy-g', 1);
  const big = await call<UseItemResult>('POST', `${url}/items/use`, { item: 'exp-candy-g', pokemonId: mon.id });
  assert.ok(big.status === 201 && big.json.pokemon.level <= 16, `nível ${big.json.pokemon.level}`);
});

test('ginásio: só Pokémon da região na 1ª vez; depois de vencer, qualquer um', async () => {
  const { save, url, mon } = await setup();
  db.prepare('UPDATE pokemon SET species_id = 152, form = NULL WHERE id = ?').run(mon.id); // Chikorita
  const first = await call<{ message?: string; error?: string }>('POST', `${url}/battle/challenge`, { challengeId: 'kanto:gym1' });
  assert.equal(first.status, 400);
  badge(save.id, 'kanto:gym1');
  const again = await call('POST', `${url}/battle/challenge`, { challengeId: 'kanto:gym1' });
  assert.equal(again.status, 201);
});
