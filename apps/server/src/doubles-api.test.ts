import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { DOUBLES_TOURNAMENT_TIERS, TOURNAMENT_TIERS, type BattleView, type DoublesTurnResult, type DoublesView, type SaveDetail, type TournamentState } from '@pokesim/engine';
import { openDatabase } from './db.ts';
import { createApp } from './app.ts';

const db = openDatabase(':memory:');
const server = createApp({ db, assetsDir: mkdtempSync(path.join(tmpdir(), 'pokesim-doubles-')), devTools: true });
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

/** Equipe de `size` Mewtwo nível 100. */
async function setup(size = 2, money = 500_000) {
  const save = (await call<SaveDetail>('POST', '/api/saves', { trainerName: 'Dupla', starterSpeciesId: 4 })).json;
  db.prepare('UPDATE saves SET money = ? WHERE id = ?').run(money, save.id);
  const first = save.team[0]?.id as string;
  const moves = ['psychic', 'ice-beam', 'thunderbolt', 'shadow-ball'].map((name) => ({ name, pp: 10, maxPp: 10 }));
  db.prepare('UPDATE pokemon SET species_id = 150, level = 100, exp = 1000000, moves = ?, current_hp = 9999 WHERE id = ?').run(JSON.stringify(moves), first);
  const ids = [first];
  for (let slot = 1; slot < size; slot++) {
    const id = randomUUID();
    db.prepare(`INSERT INTO pokemon (id, save_id, species_id, level, exp, current_hp, shiny, gender, ivs, moves, friendship, team_slot, caught_at)
                SELECT ?, save_id, species_id, level, exp, current_hp, shiny, gender, ivs, moves, friendship, ?, caught_at FROM pokemon WHERE id = ?`).run(id, slot, first);
    ids.push(id);
  }
  return { save, url: `/api/saves/${save.id}`, ids };
}
const moneyOf = (id: string) => (db.prepare('SELECT money FROM saves WHERE id = ?').get(id) as { money: number }).money;

/** Joga a batalha em dupla até o fim, sempre com o golpe mais forte no primeiro adversário vivo. */
async function fightDoubles(url: string, first: DoublesTurnResult): Promise<DoublesView> {
  let view = first.view;
  for (let i = 0; i < 200 && view.phase !== 'ended'; i++) {
    if (view.phase === 'replace') {
      const empty = ([0, 1] as const).filter((pos) => !view.player.moves[pos]);
      const bench = view.player.team.filter((m) => m.hp > 0 && !view.player.active.includes(m.index));
      const picks = empty.slice(0, bench.length).map((pos, n) => ({ pos, to: bench[n]!.index }));
      view = (await call<DoublesTurnResult>('POST', `${url}/battle2/act`, { replace: picks })).json.view;
      continue;
    }
    const foeAlive = ([0, 1] as const).filter((pos) => (view.foe.team[view.foe.active[pos]]?.hp ?? 0) > 0);
    const actions = ([0, 1] as const).map((pos) => {
      const moves = view.player.moves[pos];
      if (!moves) return null;
      const target = foeAlive[pos % foeAlive.length] ?? 0;
      const best = [...moves].sort((a, b) => b.power * (b.effectiveness[target] ?? 1) - a.power * (a.effectiveness[target] ?? 1))[0]!;
      return { kind: 'move' as const, slot: best.slot, target: { side: 'foe' as const, pos: target } };
    });
    view = (await call<DoublesTurnResult>('POST', `${url}/battle2/act`, { actions })).json.view;
  }
  return view;
}

test('duplas: treinador em dupla — exige 2 Pokémon, joga até vencer, paga o dobro e limpa a batalha', async () => {
  const solo = await setup(1);
  assert.equal((await call('POST', `${solo.url}/battle2/trainer`, { difficulty: 'facil' })).status, 400, 'um Pokémon só não basta');
  const { save, url } = await setup(2);
  assert.equal((await call('POST', `${url}/battle2/trainer`, { difficulty: 'nada' })).status, 400);
  const start = (await call<DoublesTurnResult>('POST', `${url}/battle2/trainer`, { difficulty: 'facil' })).json;
  assert.equal(start.doubles, true);
  assert.equal(start.view.player.active.filter((i) => i >= 0).length, 2);
  assert.ok(start.view.player.moves[0] && start.view.player.moves[1]);
  assert.ok(start.view.player.moves[0]!.some((m) => m.needsTarget));
  assert.equal((await call('POST', `${url}/battle2/trainer`, { difficulty: 'facil' })).status, 400, 'já há uma batalha');
  assert.equal((await call('POST', `${url}/battle/start`)).status, 400);
  assert.equal((await call('POST', `${url}/battle/act`, { kind: 'move', slot: 0 })).status, 400, 'rota 1×1 não mexe na batalha em dupla');
  assert.equal(((await call<BattleView | null>('GET', `${url}/battle`)).json), null);
  assert.equal((await call<DoublesView | null>('GET', `${url}/battle2`)).json?.turn, 0, 'retomar');
  assert.equal((await call('POST', `${url}/battle2/act`, { actions: [null, null] })).status, 400);
  const money = moneyOf(save.id);
  const end = await fightDoubles(url, start);
  assert.equal(end.outcome?.result, 'win');
  assert.ok(end.outcome!.money >= 2000, 'dobro do prêmio do Fácil (₽ 1.000)');
  assert.equal(moneyOf(save.id), money + end.outcome!.money);
  assert.equal((await call<DoublesView | null>('GET', `${url}/battle2`)).json, null);
  assert.ok(end.outcome!.rewards.length >= 1);
});

test('duplas: torneio em duplas custa mais, paga mais e passa as rodadas', async () => {
  const single = TOURNAMENT_TIERS.find((t) => t.id === 'muito-facil')!;
  const dupla = DOUBLES_TOURNAMENT_TIERS.find((t) => t.id === 'dupla-muito-facil')!;
  assert.ok(dupla.entry > single.entry * 2 && dupla.prize.money > single.prize.money && dupla.prize.essences > single.prize.essences);
  assert.equal(dupla.doubles, true);
  assert.equal(DOUBLES_TOURNAMENT_TIERS.length, TOURNAMENT_TIERS.length);

  const { save, url, ids } = await setup(2);
  const state = (await call<TournamentState>('GET', `${url}/tournaments`)).json;
  assert.ok(state.tiers.some((t) => t.id === 'dupla-muito-facil' && t.doubles));
  assert.ok(state.tiers.some((t) => t.id === 'muito-facil' && !t.doubles));
  assert.equal((await call('POST', `${url}/tournaments/enter`, { tier: 'dupla-muito-facil', members: [ids[0]] })).status, 400, 'duplas pedem 2');
  const before = moneyOf(save.id);
  const entered = (await call<DoublesTurnResult>('POST', `${url}/tournaments/enter`, { tier: 'dupla-muito-facil', members: ids })).json;
  assert.equal(entered.doubles, true);
  assert.equal(moneyOf(save.id), before - dupla.entry);
  let end = await fightDoubles(url, entered);
  assert.equal(end.outcome?.tournament?.round, 1);
  for (let round = 2; round <= 8; round++) {
    assert.equal(end.outcome?.result, 'win', `rodada ${round - 1}`);
    const next = (await call<DoublesTurnResult>('POST', `${url}/tournaments/next`)).json;
    assert.equal(next.doubles, true);
    end = await fightDoubles(url, next);
  }
  assert.equal(end.outcome?.tournament?.champion, true);
  assert.equal(end.outcome?.tournament?.prizeMoney, dupla.prize.money);
  const after = (await call<TournamentState>('GET', `${url}/tournaments`)).json;
  assert.equal(after.tiers.find((t) => t.id === 'dupla-muito-facil')?.wins, 1);
  assert.equal(after.active, null);
});
