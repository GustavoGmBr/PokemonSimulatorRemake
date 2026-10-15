import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { ICONIC_TRAINERS, type BattleTurnResult, type ChallengesState, type SaveDetail } from '@pokesim/engine';
import { loadGameData } from '@pokesim/data';
import { openDatabase } from './db.ts';
import { createApp } from './app.ts';

const db = openDatabase(':memory:');
const server = createApp({ db, assetsDir: mkdtempSync(path.join(tmpdir(), 'pokesim-ng-')), devTools: true });
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

test('Novo Ciclo: bloqueado até vencer todos os campeões; depois campeões fortes e ícones (Red, Ash…) com prêmios', async () => {
  const save = (await call<SaveDetail>('POST', '/api/saves', { trainerName: 'Ciclo', starterSpeciesId: 4 })).json;
  const url = `/api/saves/${save.id}`;
  db.prepare('UPDATE pokemon SET level = 100, exp = 1000000 WHERE save_id = ?').run(save.id);

  const locked = (await call<ChallengesState>('GET', `${url}/challenges`)).json.ngplus;
  assert.equal(locked.unlocked, false);
  assert.equal(locked.missing.length, 10);
  assert.ok(locked.entries.some((e) => e.id === 'ng:iconic:red' && e.name === 'Red'));
  assert.ok(locked.entries.some((e) => e.id === 'ng:iconic:ash'));
  assert.equal((await call('POST', `${url}/battle/challenge`, { challengeId: 'ng:iconic:red' })).status, 400);

  const champions = loadGameData().challenges.filter((c) => c.kind === 'champion');
  const ins = db.prepare('INSERT INTO badges (save_id, challenge_id, won_at) VALUES (?, ?, ?)');
  for (const c of champions) ins.run(save.id, c.id, new Date().toISOString());
  const open = (await call<ChallengesState>('GET', `${url}/challenges`)).json.ngplus;
  assert.equal(open.unlocked, true);
  assert.equal(open.entries.filter((e) => e.kind === 'champion').length, 10);
  assert.ok(open.entries.filter((e) => e.kind === 'champion').every((e) => e.team.length === 6 && e.level === 100));
  assert.equal(open.entries.filter((e) => e.kind === 'iconic').length, ICONIC_TRAINERS.length);
  assert.ok(open.entries.every((e) => e.rewards.length >= 3 && e.firstWinBonus.some((b) => b.item === 'master-ball')));

  const started = (await call<BattleTurnResult>('POST', `${url}/battle/challenge`, { challengeId: 'ng:iconic:red' })).json;
  assert.equal(started.view.trainer?.name, 'Red');
  assert.equal(started.view.foe.team.length, 6);
  assert.ok(started.view.foe.team.every((m) => m.level === 100));

  // deixa só um oponente com 1 de HP e vence com um golpe
  const row = db.prepare('SELECT state FROM battles WHERE save_id = ?').get(save.id) as { state: string };
  const state = JSON.parse(row.state);
  state.foe.team.forEach((c: { hp: number }, i: number) => { c.hp = i === state.foe.active ? 1 : 0; });
  state.trainer.bag = [];
  state.foe.team[state.foe.active].stats.spe = 1;
  state.player.team[state.player.active].stats.spe = 9999;
  state.player.team[state.player.active].hp = state.player.team[state.player.active].stats.hp;
  state.player.team[state.player.active].moves = [{ name: 'scratch', pp: 35, maxPp: 35 }];
  db.prepare('UPDATE battles SET state = ? WHERE save_id = ?').run(JSON.stringify(state), save.id);
  const money = (await call<SaveDetail>('GET', url)).json.money;
  let result = (await call<BattleTurnResult>('POST', `${url}/battle/act`, { kind: 'move', slot: 0 })).json;
  for (let i = 0; i < 3 && result.view.phase !== 'ended'; i++) result = (await call<BattleTurnResult>('POST', `${url}/battle/act`, { kind: 'move', slot: 0 })).json;
  assert.equal(result.view.outcome?.result, 'win');
  assert.ok(result.view.outcome!.rewards.some((r) => r.item === 'master-ball'), 'bônus da primeira vitória');
  assert.equal((await call<SaveDetail>('GET', url)).json.money, money + 120_000);
  const after1 = (await call<ChallengesState>('GET', `${url}/challenges`)).json.ngplus.entries.find((e) => e.id === 'ng:iconic:red')!;
  assert.equal(after1.wins, 1);
  // não vira insígnia comum (não contamina Lucky Egg/Amulet Coin)
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM badges WHERE save_id = ? AND challenge_id LIKE 'ng:%'").get(save.id) as { n: number }).n, 0);
});
