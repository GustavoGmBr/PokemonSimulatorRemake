import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { BattleTurnResult, SaveDetail } from '@pokesim/engine';
import { openDatabase } from './db.ts';
import { createApp } from './app.ts';

const db = openDatabase(':memory:');
const server = createApp({ db, assetsDir: mkdtempSync(path.join(tmpdir(), 'pokesim-hard-')), devTools: true });
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

/** Equipe com o inicial e um Mewtwo Nv 1, ambos com 1 de HP. */
async function play(difficulty: string | undefined) {
  const save = (await call<SaveDetail>('POST', '/api/saves', { trainerName: 'Dif', starterSpeciesId: 4, ...(difficulty ? { difficulty } : {}) })).json;
  const starter = save.team[0]!.id;
  const partner = randomUUID();
  db.prepare(`INSERT INTO pokemon (id, save_id, species_id, level, exp, current_hp, shiny, gender, ivs, moves, friendship, team_slot, caught_at)
              SELECT ?, save_id, 150, 1, 0, 1, shiny, gender, ivs, moves, friendship, 1, caught_at FROM pokemon WHERE id = ?`).run(partner, starter);
  db.prepare('UPDATE pokemon SET level = 1, exp = 0 WHERE id = ?').run(starter);
  return { save, starter, partner, url: `/api/saves/${save.id}` };
}

test('dificuldade: normal por padrão; valor inválido é recusado', async () => {
  const a = (await call<SaveDetail>('POST', '/api/saves', { trainerName: 'A', starterSpeciesId: 4 })).json;
  assert.equal(a.difficulty, 'normal');
  const b = (await call<SaveDetail>('POST', '/api/saves', { trainerName: 'B', starterSpeciesId: 4, difficulty: 'hard' })).json;
  assert.equal(b.difficulty, 'hard');
  assert.equal((await call('POST', '/api/saves', { trainerName: 'C', starterSpeciesId: 4, difficulty: 'impossivel' })).status, 400);
});

for (const mode of ['normal', 'hard'] as const) {
  test(`dificuldade ${mode}: derrota ${mode === 'hard' ? 'apaga' : 'preserva'} os Pokémon, e o inicial fica`, async () => {
    const { starter, partner, url, save } = await play(mode);
    const row = (id: string) => db.prepare('SELECT is_starter FROM pokemon WHERE id = ?').get(id) as { is_starter: number } | undefined;
    assert.equal(row(starter)?.is_starter, 1);
    // fraqueza total: HP 1 nos dois e velocidade mínima; o selvagem vence rápido
    db.prepare('UPDATE pokemon SET current_hp = 1 WHERE save_id = ?').run(save.id);
    // o treinador aleatório difícil (Nv 100) derrota a equipe
    const turn = (await call<BattleTurnResult>('POST', `${url}/battle/trainer`, { difficulty: 'dificil' })).json;
    let view = turn.view;
    for (let i = 0; i < 80 && view.phase !== 'ended'; i++) {
      if (view.phase === 'replace') {
        const next = view.player.team.find((m) => m.hp > 0);
        view = (await call<BattleTurnResult>('POST', `${url}/battle/act`, { kind: 'switch', to: next!.index })).json.view;
      } else view = (await call<BattleTurnResult>('POST', `${url}/battle/act`, { kind: 'move', slot: 0 })).json.view;
    }
    assert.equal(view.outcome?.result, 'lose');
    assert.ok(row(starter), 'o inicial nunca é apagado');
    if (mode === 'hard') {
      assert.equal(row(partner), undefined, 'o parceiro que desmaiou foi apagado');
      assert.deepEqual(view.outcome?.fallen, ['Mewtwo']);
      const team = (await call<SaveDetail>('GET', url)).json.team;
      assert.equal(team.length, 1);
    } else {
      assert.ok(row(partner));
      assert.equal(view.outcome?.fallen, undefined);
    }
  });
}

test('dificuldade difícil: vencer não apaga ninguém (mesmo com Pokémon caído) e selvagem não apaga', async () => {
  const { starter, partner, url, save } = await play('hard');
  const exists = (id: string) => db.prepare('SELECT 1 FROM pokemon WHERE id = ?').get(id) !== undefined;
  // o inicial vira um Mewtwo Nv 100 forte; o parceiro começa desmaiado
  const moves = ['psychic', 'ice-beam', 'thunderbolt', 'shadow-ball'].map((name) => ({ name, pp: 10, maxPp: 10 }));
  db.prepare('UPDATE pokemon SET species_id = 150, level = 100, exp = 1000000, moves = ?, current_hp = 9999 WHERE id = ?').run(JSON.stringify(moves), starter);
  db.prepare('UPDATE pokemon SET current_hp = 0 WHERE id = ?').run(partner);
  let view = (await call<BattleTurnResult>('POST', `${url}/battle/trainer`, { difficulty: 'facil' })).json.view;
  for (let i = 0; i < 400 && view.phase !== 'ended'; i++) {
    if (view.phase === 'replace') {
      const next = view.player.team.find((m) => m.hp > 0);
      view = (await call<BattleTurnResult>('POST', `${url}/battle/act`, { kind: 'switch', to: next!.index })).json.view;
    } else {
      const score = (m: { power: number; effectiveness: number | null }) => m.power * (m.effectiveness ?? 1);
      const best = [...view.player.moves].sort((a, b) => score(b) - score(a))[0];
      view = (await call<BattleTurnResult>('POST', `${url}/battle/act`, { kind: 'move', slot: best?.slot ?? 0 })).json.view;
    }
  }
  assert.equal(view.outcome?.result, 'win');
  assert.ok(exists(partner), 'vitória: ninguém é apagado');
  assert.equal(view.outcome?.fallen, undefined);
  assert.equal(save.difficulty, 'hard');
});
