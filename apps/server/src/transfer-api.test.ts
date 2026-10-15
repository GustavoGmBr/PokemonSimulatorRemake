import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { SaveDetail } from '@pokesim/engine';
import { openDatabase } from './db.ts';
import { createApp } from './app.ts';
import { backupDatabase, listBackups, BACKUPS_KEPT } from './backup.ts';

const db = openDatabase(':memory:');
const dir = mkdtempSync(path.join(tmpdir(), 'pokesim-transfer-'));
const server = createApp({ db, assetsDir: dir, backupsDir: path.join(dir, 'backups'), devTools: true });
let base = '';
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { server.close(); db.close(); });

async function call<T>(method: string, url: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await fetch(base + url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : null });
  return { status: res.status === 201 ? 200 : res.status, json: (res.status === 204 ? null : await res.json()) as T };
}

test('exportar e importar cria um save novo, com tudo igual e ids novos', async () => {
  const save = (await call<SaveDetail>('POST', '/api/saves', { trainerName: 'Origem', starterSpeciesId: 4 })).json;
  await call('POST', `/api/saves/${save.id}/dev/grant`, { count: 30 });
  await call('POST', `/api/saves/${save.id}/teams`, { name: 'Equipe A' });
  db.prepare('UPDATE saves SET money = 12345, chips = 77 WHERE id = ?').run(save.id);
  const exported = (await call<{ format: string; tables: Record<string, unknown[]> }>('GET', `/api/saves/${save.id}/export`)).json;
  assert.equal(exported.format, 'pokesim-save');
  assert.equal(exported.tables.pokemon?.length, 31);

  const original = (await call<SaveDetail>('GET', `/api/saves/${save.id}`)).json;
  const imported = (await call<SaveDetail>('POST', '/api/saves/import', exported)).json;
  assert.notEqual(imported.id, save.id);
  assert.equal(imported.trainerName, 'Origem');
  assert.equal(imported.money, 12345);
  assert.equal(imported.chips, 77);
  assert.equal(imported.team.length, original.team.length);
  assert.deepEqual(imported.inventory.map((i) => [i.item, i.quantity]), original.inventory.map((i) => [i.item, i.quantity]));
  const count = (id: string) => (db.prepare('SELECT COUNT(*) AS n FROM pokemon WHERE save_id = ?').get(id) as { n: number }).n;
  assert.equal(count(imported.id), 31);
  assert.equal(count(save.id), 31, 'o save original continua intacto');
  const ids = new Set((db.prepare('SELECT id FROM pokemon').all() as { id: string }[]).map((r) => r.id));
  assert.equal(ids.size, 62, 'nenhum id repetido');
  const teams = (await call<{ pokemonIds?: string[] }[]>('GET', `/api/saves/${imported.id}/teams`)).json;
  assert.equal(teams.length, 1);
});

test('importação recusa arquivos que não são saves e versões mais novas', async () => {
  assert.equal((await call('POST', '/api/saves/import', { foo: 1 })).status, 400);
  assert.equal((await call('POST', '/api/saves/import', { format: 'pokesim-save', formatVersion: 1, schema: 999, tables: { saves: [{}] } })).status, 400);
  assert.equal((await call('POST', '/api/saves/import', { format: 'pokesim-save', formatVersion: 1, schema: 1, tables: { saves: [] } })).status, 400);
  const bad = { format: 'pokesim-save', formatVersion: 1, schema: 1, tables: { saves: [{ id: 'x', trainer_name: { drop: 1 } }] } };
  assert.equal((await call('POST', '/api/saves/import', bad)).status, 400);
});

test('backup guarda só os 5 mais recentes e não cria nada sem saves', () => {
  const empty = openDatabase(':memory:');
  assert.equal(backupDatabase(empty, path.join(dir, 'vazio')), null);
  empty.close();
  const target = path.join(dir, 'b');
  for (let i = 0; i < 8; i++) backupDatabase(db, target, BACKUPS_KEPT, new Date(2026, 0, 1, 10, 0, i));
  const kept = listBackups(target);
  assert.equal(kept.length, BACKUPS_KEPT);
  assert.equal(kept[0]?.name, 'game-2026-01-01_10-00-07.db');
  assert.equal(readdirSync(target).length, BACKUPS_KEPT);
  const copy = openDatabase(path.join(target, kept[0]!.name));
  assert.ok((copy.prepare('SELECT COUNT(*) AS n FROM saves').get() as { n: number }).n >= 2);
  copy.close();
});
