import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { TOURNAMENT_ROUNDS, TOURNAMENT_TIERS, rollOpponent, roundLevel, seededRng, type BattleTurnResult, type SaveDetail, type TournamentState } from '@pokesim/engine';
import { loadGameData } from '@pokesim/data';
import { openDatabase } from './db.ts';
import { createApp } from './app.ts';

const db = openDatabase(':memory:');
const server = createApp({ db, assetsDir: mkdtempSync(path.join(tmpdir(), 'pokesim-tour-')), devTools: true });
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

/** Equipe de 6 Mewtwo nível 100 (limitados pela copa), para vencer com folga. */
async function setup(money = 500_000, size = 6) {
  const save = (await call<SaveDetail>('POST', '/api/saves', { trainerName: 'Teste', starterSpeciesId: 4 })).json;
  db.prepare('UPDATE saves SET money = ? WHERE id = ?').run(money, save.id);
  const first = save.team[0]?.id as string;
  const moves = ['psychic', 'ice-beam', 'thunderbolt', 'shadow-ball'].map((name) => ({ name, pp: 10, maxPp: 10 }));
  db.prepare('UPDATE pokemon SET species_id = 150, level = 100, exp = 1000000, moves = ? WHERE id = ?').run(JSON.stringify(moves), first);
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

async function fight(url: string, first: BattleTurnResult) {
  let view = first.view;
  for (let i = 0; i < 300 && view.phase !== 'ended'; i++) {
    if (view.phase === 'replace' || view.player.team[view.player.active]?.hp === 0) {
      const next = view.player.team.find((m) => m.hp > 0);
      if (!next) break;
      view = (await call<BattleTurnResult>('POST', `${url}/battle/act`, { kind: 'switch', to: next.index })).json.view;
      continue;
    }
    const score = (m: { power: number; effectiveness: number | null }) => m.power * (m.effectiveness ?? 1);
    const best = [...view.player.moves].sort((a, b) => score(b) - score(a))[0];
    view = (await call<BattleTurnResult>('POST', `${url}/battle/act`, { kind: 'move', slot: best?.slot ?? 0 })).json.view;
  }
  return view;
}

test('motor: rodadas crescem em nível e tamanho, respeitando o teto da copa', () => {
  const data = loadGameData();
  for (const tier of TOURNAMENT_TIERS) {
    assert.equal(roundLevel(tier, TOURNAMENT_ROUNDS), tier.cap);
    let last = 0;
    for (let round = 1; round <= TOURNAMENT_ROUNDS; round++) {
      const opp = rollOpponent(tier, round, data.species, seededRng(round));
      assert.ok(opp.team.length >= last && opp.team.length >= 1);
      last = opp.team.length;
      for (const member of opp.team) {
        assert.ok(member.level <= tier.cap);
        const species = data.speciesById.get(member.speciesId);
        assert.ok(species);
        if (tier.maxBst !== null) assert.ok(Object.values(species.baseStats).reduce((a, b) => a + b, 0) <= tier.maxBst);
        if (!tier.legendary) assert.ok(!species.legendary && !species.mythical);
      }
      assert.equal(new Set(opp.team.map((m) => m.speciesId)).size, opp.team.length);
    }
  }
});

test('torneio: validações da inscrição', async () => {
  const { save, url, ids } = await setup(500, 2);
  assert.equal((await call('POST', `${url}/tournaments/enter`, { tier: 'copa-prime', members: ids })).status, 400); // sem dinheiro
  assert.equal((await call('POST', `${url}/tournaments/enter`, { tier: 'inexistente', members: ids })).status, 400);
  assert.equal((await call('POST', `${url}/tournaments/enter`, { tier: 'muito-facil', members: [] })).status, 400);
  assert.equal((await call('POST', `${url}/tournaments/enter`, { tier: 'muito-facil', members: ['x'] })).status, 400);
  assert.equal(moneyOf(save.id), 500);
  const state = (await call<TournamentState>('GET', `${url}/tournaments`)).json;
  assert.equal(state.tiers.length, 6);
  assert.equal(state.active, null);
  assert.equal(state.team.length, 2);
});

test('torneio: campeão paga o prêmio; rodadas avançam; não dá para entrar de novo no meio', async () => {
  const { save, url, ids } = await setup();
  const tier = TOURNAMENT_TIERS[0] as (typeof TOURNAMENT_TIERS)[number];
  const start = await call<BattleTurnResult>('POST', `${url}/tournaments/enter`, { tier: tier.id, members: ids });
  assert.equal(start.status, 200);
  assert.equal(moneyOf(save.id), 500_000 - tier.entry);
  assert.equal(start.json.view.trainer?.title, `Rodada 1/${TOURNAMENT_ROUNDS}`);
  assert.equal(start.json.view.player.team.length, 6);
  assert.ok(start.json.view.player.team.every((m) => m.level <= tier.cap));
  assert.equal((await call('POST', `${url}/tournaments/enter`, { tier: tier.id, members: ids })).status, 400);
  assert.equal((await call('POST', `${url}/tournaments/abandon`)).status, 400, 'batalha aberta');
  let turn = start.json;
  for (let round = 1; round <= TOURNAMENT_ROUNDS; round++) {
    const view = await fight(url, turn);
    assert.equal(view.phase, 'ended');
    const outcome = view.outcome;
    assert.equal(outcome?.result, 'win', `rodada ${round}`);
    assert.equal(outcome?.money, 0);
    assert.equal(outcome?.tournament?.round, round);
    if (round < TOURNAMENT_ROUNDS) {
      const state = (await call<TournamentState>('GET', `${url}/tournaments`)).json;
      assert.equal(state.active?.round, round + 1);
      assert.equal(state.active?.inBattle, false);
      turn = (await call<BattleTurnResult>('POST', `${url}/tournaments/next`)).json;
      assert.equal(turn.view.trainer?.title, `Rodada ${round + 1}/${TOURNAMENT_ROUNDS}`);
      assert.ok(turn.view.player.team.every((m) => m.hp === m.maxHp), 'vida cheia entre rodadas');
    } else {
      assert.equal(outcome?.tournament?.champion, true);
      assert.equal(moneyOf(save.id), 500_000 - tier.entry + tier.prize.money);
    }
  }
  const after = (await call<TournamentState>('GET', `${url}/tournaments`)).json;
  assert.equal(after.active, null);
  assert.equal(after.tiers[0]?.wins, 1);
  const candy = db.prepare("SELECT quantity FROM inventory WHERE save_id = ? AND item = 'exp-candy-p'").get(save.id) as { quantity: number } | undefined;
  assert.ok((candy?.quantity ?? 0) >= 2);
  assert.equal((await call('POST', `${url}/tournaments/next`)).status, 400);
});

test('torneio: perder elimina e não devolve a inscrição; desistir também encerra', async () => {
  const { save, url, ids } = await setup(150_000, 1);
  db.prepare('UPDATE pokemon SET species_id = 10, level = 5, exp = 125 WHERE id = ?').run(ids[0] as string); // Caterpie, fraco
  const start = await call<BattleTurnResult>('POST', `${url}/tournaments/enter`, { tier: 'copa-prime', members: ids });
  assert.equal(start.status, 200);
  const view = await fight(url, start.json);
  assert.equal(view.outcome?.result, 'lose');
  assert.equal(view.outcome?.tournament?.eliminated, true);
  assert.equal(moneyOf(save.id), 50_000);
  assert.equal(((await call<TournamentState>('GET', `${url}/tournaments`)).json).active, null);
});

test('torneio: desistir', async () => {
  const { save, url, ids } = await setup(10_000, 1);
  // inscrição direta no banco, sem batalha aberta
  db.prepare('INSERT INTO tournaments (save_id, tier, round, members, created_at) VALUES (?, ?, 3, ?, ?)').run(save.id, 'facil', JSON.stringify(ids), new Date().toISOString());
  const state = (await call<TournamentState>('GET', `${url}/tournaments`)).json;
  assert.equal(state.active?.round, 3);
  const out = await call<TournamentState>('POST', `${url}/tournaments/abandon`);
  assert.equal(out.json.active, null);
});
