import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { CasinoActResult, CasinoResult, CasinoState, SaveDetail } from '@pokesim/engine';
import { openDatabase } from './db.ts';
import { createApp } from './app.ts';

const db = openDatabase(':memory:');
const server = createApp({ db, assetsDir: mkdtempSync(path.join(tmpdir(), 'pokesim-casino-')), devTools: true });
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
async function setup(money = 100_000, chips = 0) {
  const save = (await call<SaveDetail>('POST', '/api/saves', { trainerName: 'Teste', starterSpeciesId: 4 })).json;
  db.prepare('UPDATE saves SET money = ?, chips = ? WHERE id = ?').run(money, chips, save.id);
  return { save, url: `/api/saves/${save.id}/casino` };
}
const row = (id: string) => ({ ...(db.prepare('SELECT money, chips FROM saves WHERE id = ?').get(id) as { money: number; chips: number }) });
function addMon(saveId: string, speciesId: number, level = 20, favorite = 0): string {
  const id = randomUUID();
  const used = (db.prepare('SELECT COUNT(*) AS n FROM pokemon WHERE save_id = ? AND box = 6').get(saveId) as { n: number }).n;
  db.prepare(`INSERT INTO pokemon (id, save_id, species_id, level, exp, current_hp, shiny, gender, ivs, moves, friendship, favorite, box, box_slot, caught_at)
              VALUES (?, ?, ?, ?, ?, 50, 0, NULL, ?, '[]', 70, ?, 6, ?, ?)`)
    .run(id, saveId, speciesId, level, level ** 3, JSON.stringify({ hp: 10, atk: 10, def: 10, spa: 10, spd: 10, spe: 10 }), favorite, used, new Date().toISOString());
  return id;
}
const monCount = (saveId: string) => (db.prepare('SELECT COUNT(*) AS n FROM pokemon WHERE save_id = ?').get(saveId) as { n: number }).n;

test('compra de fichas e de prêmios', async () => {
  const { save, url } = await setup(1000, 0);
  const bought = await call<CasinoState>('POST', `${url}/chips`, { amount: 100 });
  assert.equal(bought.status, 200);
  assert.deepEqual(row(save.id), { money: 500, chips: 100 });
  assert.equal((await call('POST', `${url}/chips`, { amount: 1000 })).status, 400);
  assert.equal((await call('POST', `${url}/prize`, { item: 'iv-hp' })).status, 400); // 100 fichas < 1.000
  db.prepare('UPDATE saves SET chips = 5000 WHERE id = ?').run(save.id);
  const prize = await call<CasinoState>('POST', `${url}/prize`, { item: 'iv-hp', quantity: 2 });
  assert.equal(prize.status, 200);
  assert.equal(row(save.id).chips, 3000);
  assert.equal(prize.json.prizes.find((p) => p.item === 'iv-hp')?.owned, 2);
  assert.equal((await call('POST', `${url}/prize`, { item: 'nao-existe' })).status, 400);
});

test('jogos de uma jogada: fichas ficam consistentes e aposta inválida é recusada', async () => {
  const { save, url } = await setup(0, 10_000);
  const bets: Array<[string, Record<string, unknown>]> = [
    ['slots', { bet: 10 }], ['roulette', { bet: 10, bet_on: { kind: 'color', value: 'red' } }], ['race', { bet: 10, pick: 2 }], ['wheel', { bet: 10 }],
  ];
  for (const [game, body] of bets) {
    for (let i = 0; i < 5; i++) {
      const before = row(save.id).chips;
      const res = await call<CasinoResult>('POST', `${url}/${game}/play`, body);
      assert.equal(res.status, 200, `${game}: ${JSON.stringify(res.json)}`);
      assert.equal(res.json.chips, before - 10 + res.json.stake.payout);
      assert.equal(res.json.chips, row(save.id).chips);
    }
  }
  assert.equal((await call('POST', `${url}/slots/play`, { bet: 0 })).status, 400);
  assert.equal((await call('POST', `${url}/slots/play`, { bet: 999_999_999 })).status, 400);
  assert.equal((await call('POST', `${url}/roulette/play`, { bet: 10, bet_on: { kind: 'color', value: 'xyz' } })).status, 400);
  assert.equal((await call('POST', `${url}/race/play`, { bet: 10, pick: 9 })).status, 400);
  assert.equal((await call('POST', `${url}/voltorb/play`, { bet: 10 })).status, 400);
  assert.equal((await call('POST', `${url}/xadrez/play`, { bet: 10 })).status, 400);
  db.prepare('UPDATE saves SET chips = 5 WHERE id = ?').run(save.id);
  assert.equal((await call('POST', `${url}/wheel/play`, { bet: 10 })).status, 400);
});

test('rodadas: Voltorb Flip persiste, bloqueia outros jogos e encerra ao sacar', async () => {
  const { save, url } = await setup(0, 1000);
  const started = await call<CasinoActResult>('POST', `${url}/voltorb/start`, { bet: 100 });
  assert.equal(started.status, 200);
  assert.equal(row(save.id).chips, 900);
  assert.equal((await call('POST', `${url}/slots/play`, { bet: 10 })).status, 400);
  assert.equal((await call('POST', `${url}/chips`, { amount: 1 })).status, 400);
  const state = await call<CasinoState>('GET', url);
  assert.equal(state.json.round?.game, 'voltorb');
  assert.equal((await call('POST', `${url}/round/act`, { action: 'cashout' })).status, 400); // nada virado
  let last: CasinoActResult | null = null;
  for (let i = 0; i < 36 && !last?.result; i++) {
    last = (await call<CasinoActResult>('POST', `${url}/round/act`, { action: 'flip', index: i })).json;
    if (last.round && last.round.game === 'voltorb' && last.round.revealed.length >= 1 && i === 0) {
      assert.equal((await call('POST', `${url}/round/act`, { action: 'flip', index: 0 })).status, 400); // repetida
    }
  }
  if (!last?.result) last = (await call<CasinoActResult>('POST', `${url}/round/act`, { action: 'cashout' })).json;
  assert.ok(last?.result);
  assert.equal(row(save.id).chips, last.chips);
  assert.equal((await call<CasinoState>('GET', url)).json.round, null);
});

test('rodadas: Pokejack e Pula Piplup terminam e acertam as fichas', async () => {
  const { save, url } = await setup(0, 100_000);
  for (let g = 0; g < 20; g++) {
    const start = (await call<CasinoActResult>('POST', `${url}/jack/start`, { bet: 100 })).json;
    let res = start;
    while (res.round) res = (await call<CasinoActResult>('POST', `${url}/round/act`, { action: 'stand' })).json;
    assert.ok(res.result && res.result.game === 'jack');
    assert.equal(res.chips, row(save.id).chips);
  }
  const before = row(save.id).chips;
  await call('POST', `${url}/piplup/start`, { bet: 100 });
  assert.equal((await call('POST', `${url}/round/act`, { action: 'cashout' })).status, 400); // sem saltar
  let res = (await call<CasinoActResult>('POST', `${url}/round/act`, { action: 'jump' })).json;
  while (res.round) res = (await call<CasinoActResult>('POST', `${url}/round/act`, { action: 'cashout' })).json;
  assert.ok(res.result && res.result.game === 'piplup');
  assert.equal(row(save.id).chips, before - 100 + res.result.stake.payout);
  const aband = await call<CasinoActResult>('POST', `${url}/piplup/start`, { bet: 100 });
  assert.ok(aband.json.round);
  const out = (await call<CasinoActResult>('POST', `${url}/round/abandon`)).json;
  assert.equal(out.result?.stake.payout, 0);
});

test('aposta de Pokémon: favorito e último Pokémon protegidos; perda remove, vitória paga', async () => {
  const { save, url } = await setup(0, 0);
  assert.equal((await call('POST', `${url}/wheel/play`, { pokemonId: save.team[0]?.id })).status, 400); // único Pokémon
  const fav = addMon(save.id, 16, 20, 1);
  assert.equal((await call('POST', `${url}/wheel/play`, { pokemonId: fav })).status, 400);
  let lost = 0, won = 0;
  for (let i = 0; i < 60; i++) {
    const id = addMon(save.id, 16, 20);
    const before = row(save.id);
    const n = monCount(save.id);
    const res = await call<CasinoResult>('POST', `${url}/wheel/play`, { pokemonId: id });
    assert.equal(res.status, 200);
    const p = res.json.stake.pokemon;
    assert.ok(p);
    if (p.lost) {
      lost++;
      assert.equal(monCount(save.id), n - 1);
      assert.equal(row(save.id).money, before.money);
    } else {
      assert.equal(monCount(save.id), n);
      if (res.json.stake.multiplier > 1) { won++; assert.ok(p.prizeMoney > 0); assert.equal(row(save.id).money, before.money + p.prizeMoney); }
    }
  }
  assert.ok(lost + won > 0);
  const started = await call<CasinoActResult>('POST', `${url}/piplup/start`, { pokemonId: addMon(save.id, 16, 20) });
  assert.equal(started.status, 200);
  const dbl = await call('POST', `${url}/jack/start`, { bet: 1 });
  assert.equal(dbl.status, 400); // rodada aberta
});
