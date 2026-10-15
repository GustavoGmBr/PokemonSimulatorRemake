import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { MISSION_COMPLETION_REWARD, generateMissions, missionPeriod, saleValue, type HistoryState, type MarketState, type MissionClaimResult, type MissionsState, type SaveDetail } from '@pokesim/engine';
import { openDatabase } from './db.ts';
import { createApp } from './app.ts';

const db = openDatabase(':memory:');
const server = createApp({ db, assetsDir: mkdtempSync(path.join(tmpdir(), 'pokesim-journey-')), devTools: true });
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
async function setup(money = 100_000) {
  const save = (await call<SaveDetail>('POST', '/api/saves', { trainerName: 'Jornada', starterSpeciesId: 4 })).json;
  db.prepare('UPDATE saves SET money = ? WHERE id = ?').run(money, save.id);
  return { save, url: `/api/saves/${save.id}` };
}
const row = (id: string) => db.prepare('SELECT money, chips FROM saves WHERE id = ?').get(id) as { money: number; chips: number };
function addMon(saveId: string, speciesId: number, level = 20, extra: { favorite?: number; ball?: string; shiny?: number } = {}): string {
  const id = randomUUID();
  const used = (db.prepare('SELECT COUNT(*) AS n FROM pokemon WHERE save_id = ? AND box = 7').get(saveId) as { n: number }).n;
  db.prepare(`INSERT INTO pokemon (id, save_id, species_id, level, exp, current_hp, shiny, gender, ivs, moves, friendship, favorite, ball, box, box_slot, caught_at)
              VALUES (?, ?, ?, ?, ?, 50, ?, NULL, ?, '[]', 70, ?, ?, 7, ?, ?)`)
    .run(id, saveId, speciesId, level, level ** 3, extra.shiny ?? 0, JSON.stringify({ hp: 10, atk: 10, def: 10, spa: 10, spd: 10, spe: 10 }), extra.favorite ?? 0, extra.ball ?? null, used, new Date().toISOString());
  return id;
}

test('missões: 10 por período, estáveis, resgate com bônus único', async () => {
  const { save, url } = await setup();
  const state = (await call<MissionsState>('GET', `${url}/missions`)).json;
  assert.equal(state.missions.length, 10);
  assert.equal(state.period, missionPeriod());
  assert.deepEqual((await call<MissionsState>('GET', `${url}/missions`)).json.missions.map((m) => m.title), state.missions.map((m) => m.title));
  assert.equal(state.allDone, false);
  assert.ok(state.missions.every((m) => m.reward.chips > 0 && m.reward.items.length >= 2));
  assert.equal((await call('POST', `${url}/missions/claim`, { period: state.period, index: 0 })).status, 400, 'não concluída');
  // conclui todas gravando os eventos que cada missão pede
  const now = new Date().toISOString();
  const ins = db.prepare('INSERT INTO events (save_id, kind, region, species_id, difficulty, tournament, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const gen = generateMissions({ saveId: save.id, period: state.period, unlockedRegions: ['kanto'], gymsWon: 0 });
  for (const m of gen) for (let i = 0; i < m.target; i++) ins.run(save.id, m.kind, m.region ?? null, m.kind === 'capturar' ? 1 + i : null, m.difficulty ?? null, m.tournament ?? null, '', now);
  const done = (await call<MissionsState>('GET', `${url}/missions`)).json;
  assert.equal(done.allDone, true);
  assert.ok(done.missions.every((m) => m.done && !m.claimed));
  assert.equal((await call('POST', `${url}/missions/claim`, { period: state.period + 1, index: 0 })).status, 400, 'período errado');
  const first = done.missions[0]!;
  const claimed = (await call<MissionClaimResult>('POST', `${url}/missions/claim`, { period: state.period, index: 0 })).json;
  assert.ok(claimed.bonus);
  assert.equal(row(save.id).money, 100_000 + first.reward.money + MISSION_COMPLETION_REWARD.money);
  assert.equal(row(save.id).chips, first.reward.chips + MISSION_COMPLETION_REWARD.chips);
  assert.equal((db.prepare("SELECT quantity FROM inventory WHERE save_id = ? AND item = 'rare-candy'").get(save.id) as { quantity: number }).quantity, 1);
  assert.equal((await call('POST', `${url}/missions/claim`, { period: state.period, index: 0 })).status, 400, 'já resgatada');
  const second = (await call<MissionClaimResult>('POST', `${url}/missions/claim`, { period: state.period, index: 1 })).json;
  assert.equal(second.bonus, null, 'bônus só uma vez');
  assert.equal(second.state.bonusClaimed, true);
});

test('histórico e estatísticas vêm de eventos reais (venda, compra, batalha)', async () => {
  const { save, url } = await setup(50_000);
  const extra = addMon(save.id, 25, 20, { ball: 'great-ball' });
  await call('POST', `${url}/market/sell`, { ids: [extra] });
  const stock = (await call<MarketState>('GET', `${url}/market`)).json;
  await call('POST', `${url}/market/buy`, { id: stock.stock[0]!.id });
  const history = (await call<HistoryState>('GET', `${url}/history`)).json;
  assert.equal(history.stats.sold, 1);
  assert.equal(history.stats.moneyEarnedSales, 500);
  assert.equal(history.events.length, 2);
  assert.match(history.events[0]!.text, /Comprou/);
  assert.match(history.events[1]!.text, /Vendeu/);
});

test('mercado: 12 no estoque, compra, renovação paga, favorito fica', async () => {
  const { save, url } = await setup(100_000);
  const market = (await call<MarketState>('GET', `${url}/market`)).json;
  assert.equal(market.stock.length, 16);
  assert.equal(new Set(market.stock.map((s) => s.speciesId)).size, 16);
  assert.ok(market.stock.every((s) => s.stars >= 2 && s.level === 1 && s.price >= 10_000));
  assert.ok(market.stock.every((s) => (s.regionUnlocked ? true : s.price >= 20_000)));
  assert.deepEqual((await call<MarketState>('GET', `${url}/market`)).json.stock.map((s) => s.id), market.stock.map((s) => s.id), 'estável na mesma hora');
  const target = market.stock[0]!;
  const bought = (await call<{ pokemon: { speciesId: number; level: number; ball: string | null }; price: number }>('POST', `${url}/market/buy`, { id: target.id })).json;
  assert.equal(bought.pokemon.speciesId, target.speciesId);
  assert.equal(bought.pokemon.level, 1);
  assert.equal(row(save.id).money, 100_000 - target.price);
  assert.equal((await call('POST', `${url}/market/buy`, { id: target.id })).status, 400, 'já comprado');
  assert.equal((await call('POST', `${url}/market/buy`, { id: 'x' })).status, 404);
  const keep = market.stock[1]!;
  assert.equal((await call('POST', `${url}/market/favorite`, { id: keep.id, favorite: true })).status, 200);
  const money = row(save.id).money;
  const refreshed = (await call<MarketState>('POST', `${url}/market/refresh`)).json;
  assert.equal(row(save.id).money, money - 3000);
  assert.equal(refreshed.stock.length, 16);
  assert.ok(refreshed.stock.some((s) => s.id === keep.id && s.favorite), 'favorito sobrevive');
  assert.equal(refreshed.stock.filter((s) => s.id !== keep.id && market.stock.some((o) => o.id === s.id)).length, 0, 'o resto é novo');
  db.prepare('UPDATE saves SET money = 10 WHERE id = ?').run(save.id);
  assert.equal((await call('POST', `${url}/market/refresh`)).status, 400);
  assert.equal((await call('POST', `${url}/market/buy`, { id: keep.id })).status, 400, 'sem dinheiro');
});

test('venda: valor por bola/nível/investido, favorito e último Pokémon protegidos', async () => {
  const { save, url } = await setup(0);
  const a = addMon(save.id, 25, 20, { ball: 'great-ball' });
  const b = addMon(save.id, 16, 10);
  const fav = addMon(save.id, 16, 10, { favorite: 1 });
  db.prepare('UPDATE pokemon SET invested = 2000 WHERE id = ?').run(b);
  const market = (await call<MarketState>('GET', `${url}/market`)).json;
  assert.equal(market.sellable.find((s) => s.id === a)?.value, 500);
  assert.equal(market.sellable.find((s) => s.id === b)?.value, saleValue({ level: 10, ball: null, legendary: false, shiny: false, ivMultiplier: 1, invested: 2000 }));
  assert.equal((await call('POST', `${url}/market/sell`, { ids: [fav] })).status, 400, 'favorito');
  assert.equal((await call('POST', `${url}/market/sell`, { ids: ['nao-existe'] })).status, 404);
  assert.equal((await call('POST', `${url}/market/sell`, { ids: [] })).status, 400);
  const sold = (await call<{ sold: number; money: number }>('POST', `${url}/market/sell`, { ids: [a, b] })).json;
  assert.equal(sold.sold, 2);
  assert.equal(row(save.id).money, sold.money);
  assert.ok(sold.money > 500);
  db.prepare('UPDATE pokemon SET favorite = 0 WHERE save_id = ?').run(save.id);
  const both = (await call<MarketState>('GET', `${url}/market`)).json.sellable.map((s) => s.id);
  assert.equal((await call('POST', `${url}/market/sell`, { ids: both })).status, 400, 'manter ao menos um');
});
