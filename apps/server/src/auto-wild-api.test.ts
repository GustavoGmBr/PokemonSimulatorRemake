import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { AutoWildResult, SaveDetail, WildState } from '@pokesim/engine';
import { openDatabase } from './db.ts';
import { createApp } from './app.ts';

const db = openDatabase(':memory:');
const server = createApp({ db, assetsDir: mkdtempSync(path.join(tmpdir(), 'pokesim-auto-')), devTools: true });
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

async function strongSave() {
  const save = (await call<SaveDetail>('POST', '/api/saves', { trainerName: 'Auto', starterSpeciesId: 4 })).json;
  // Charmander nível 100: ganha fácil dos selvagens iniciais
  // golpes de quatro tipos (cobertura) para não perder por resistência de tipo
  const moves = JSON.stringify(['earthquake', 'surf', 'thunderbolt', 'ice-beam'].map((name) => ({ name, pp: 10, maxPp: 10 })));
  db.prepare('UPDATE pokemon SET level = 100, exp = 1000000, current_hp = 9999, moves = ? WHERE save_id = ?').run(moves, save.id);
  return save;
}

test('auto-batalha limpa o mapa inteiro, ganha dinheiro e depois dá para girar', async () => {
  const save = await strongSave();
  const url = `/api/saves/${save.id}`;
  const money = save.money;
  const searched = (await call<WildState>('POST', `${url}/wild/search`, { region: 'kanto' })).json;
  const size = searched.board!.slots.length;
  const flagged = searched.board!.slots.some((s) => s.shiny || s.ivStars >= 4);
  const { status, json } = await call<AutoWildResult>('POST', `${url}/wild/auto`);
  assert.equal(status, 200);
  if (flagged) {
    assert.ok(json.report.stopped?.reason === 'shiny' || json.report.stopped?.reason === 'stars');
    assert.equal(json.report.fights, 0);
    return;
  }
  assert.equal(json.report.stopped, null);
  assert.equal(json.report.wins, size);
  assert.equal(json.state.board!.slots.length, 0, 'mapa limpo');
  assert.ok(json.report.money > 0);
  assert.equal((await call<SaveDetail>('GET', url)).json.money, money + json.report.money);
  const spun = (await call<WildState>('POST', `${url}/wild/spin`, {})).json;
  assert.equal(spun.board!.slots.length, size);
});

test('auto-batalha para sem lutar quando há shiny ou 4★ no mapa', async () => {
  const save = await strongSave();
  const url = `/api/saves/${save.id}`;
  await call('POST', `${url}/wild/search`, { region: 'kanto' });
  const row = db.prepare('SELECT slots FROM wild_boards WHERE save_id = ?').get(save.id) as { slots: string };
  const slots = JSON.parse(row.slots) as { shiny: boolean }[];
  slots[1]!.shiny = true;
  db.prepare('UPDATE wild_boards SET slots = ? WHERE save_id = ?').run(JSON.stringify(slots), save.id);
  const { json } = await call<AutoWildResult>('POST', `${url}/wild/auto`);
  assert.equal(json.report.stopped?.reason, 'shiny');
  assert.equal(json.report.stopped?.slot?.slot, 1);
  assert.equal(json.report.fights, 0);
  assert.equal(json.state.board!.slots.length, slots.length, 'nada foi derrotado');
});

test('auto-batalha exige mapa e recusa durante uma batalha', async () => {
  const save = await strongSave();
  const url = `/api/saves/${save.id}`;
  assert.equal((await call('POST', `${url}/wild/auto`)).status, 400);
});

test('derrota para a auto-batalha', async () => {
  const save = (await call<SaveDetail>('POST', '/api/saves', { trainerName: 'Fraco', starterSpeciesId: 4 })).json;
  const url = `/api/saves/${save.id}`;
  await call('POST', `${url}/wild/search`, { region: 'kanto' });
  db.prepare('UPDATE pokemon SET current_hp = 1 WHERE save_id = ?').run(save.id);
  const { json } = await call<AutoWildResult>('POST', `${url}/wild/auto`);
  assert.ok(json.report.stopped?.reason === 'defeat' || json.report.stopped?.reason === 'shiny' || json.report.stopped?.reason === 'stars' || json.report.wins >= 1);
});

test('auto-batalha: escolher o lutador (válido, fora da equipe e desmaiado)', async () => {
  const save = await strongSave();
  const url = `/api/saves/${save.id}`;
  const granted = await call<{ team?: { id: string }[] }>('POST', `${url}/dev/grant`, { count: 1 });
  assert.equal(granted.status, 200);
  const team = (await call<SaveDetail>('GET', url)).json.team;
  assert.ok(team.length >= 2);
  const coverage = JSON.stringify(['earthquake', 'surf', 'thunderbolt', 'ice-beam'].map((name) => ({ name, pp: 10, maxPp: 10 })));
  db.prepare('UPDATE pokemon SET level = 100, exp = 1000000, current_hp = 9999, moves = ? WHERE save_id = ?').run(coverage, save.id);
  const second = team[1]!.id;
  await call('POST', `${url}/wild/search`, { region: 'kanto' });
  assert.equal((await call('POST', `${url}/wild/auto`, { lead: 'nao-existe' })).status, 400);
  assert.equal((await call('POST', `${url}/wild/auto`, { lead: 5 })).status, 400);
  db.prepare('UPDATE pokemon SET current_hp = 0 WHERE id = ?').run(second);
  assert.equal((await call('POST', `${url}/wild/auto`, { lead: second })).status, 400);
  db.prepare('UPDATE pokemon SET current_hp = 9999 WHERE id = ?').run(second);
  const ok = await call<AutoWildResult>('POST', `${url}/wild/auto`, { lead: second });
  assert.equal(ok.status, 200);
});

test('auto-batalha "só ele luta": lutador forte limpa o mapa sem parar por desmaio', async () => {
  const save = await strongSave();
  const url = `/api/saves/${save.id}`;
  const lead = (await call<SaveDetail>('GET', url)).json.team[0]!.id;
  db.prepare('UPDATE pokemon SET current_hp = 9999 WHERE save_id = ?').run(save.id);
  await call('POST', `${url}/wild/search`, { region: 'kanto' });
  const { status, json } = await call<AutoWildResult>('POST', `${url}/wild/auto`, { lead, solo: true });
  assert.equal(status, 200);
  assert.notEqual(json.report.stopped?.reason, 'lead');
});
