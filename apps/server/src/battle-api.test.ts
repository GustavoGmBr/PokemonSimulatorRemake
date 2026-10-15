import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { BattleTurnResult, BattleView, PokemonView, SaveDetail, WildState } from '@pokesim/engine';
import { openDatabase } from './db.ts';
import { createApp } from './app.ts';

const db = openDatabase(':memory:');
const server = createApp({ db, assetsDir: mkdtempSync(path.join(tmpdir(), 'pokesim-battle-')), devTools: true });
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
  const url = `/api/saves/${save.id}`;
  await call('POST', `${url}/dev/kit`);
  return { save, url };
}

async function startFight(url: string) {
  await call('POST', `${url}/wild/search`, { region: 'kanto', minLevel: 2, maxLevel: 4 });
  await call('POST', `${url}/wild/choose`, { slot: 0 });
  return call<BattleTurnResult>('POST', `${url}/battle/start`);
}

test('batalha: precisa de um selvagem escolhido e bloqueia o mapa enquanto dura', async () => {
  const { url } = await setup();
  assert.equal((await call('POST', `${url}/battle/start`)).status, 400);
  assert.equal((await call('GET', `${url}/battle`)).json, null);
  const started = await startFight(url);
  assert.equal(started.status, 201);
  assert.equal(started.json.view.phase, 'choose');
  assert.equal(started.json.view.foe.team.length, 1);
  assert.equal(started.json.view.player.moves.length > 0, true);
  assert.deepEqual(started.json.events.map((e) => e.k), ['send', 'send']);
  assert.equal((await call('POST', `${url}/battle/start`)).status, 400, 'já em batalha');
  for (const route of ['wild/spin', 'wild/leave', 'wild/flee', 'wild/choose']) assert.equal((await call('POST', `${url}/${route}`, { slot: 1 })).status, 400, route);
  assert.equal((await call('POST', `${url}/wild/search`, { region: 'kanto' })).status, 400);
  const resumed = (await call<BattleView>('GET', `${url}/battle`)).json;
  assert.equal(resumed.turn, 0);
  assert.equal((await call('POST', `${url}/battle/act`, { kind: 'dance' })).status, 400);
  assert.equal((await call('POST', `${url}/battle/act`, { kind: 'move', slot: 9 })).status, 400);
  assert.equal((await call('POST', `${url}/battle/act`, { kind: 'switch', to: 0 })).status, 400, 'já está em campo');
});

test('batalha: lutar até o fim dá XP e dinheiro (ou derrota), cura a equipe e libera o mapa', async () => {
  const { save, url } = await setup();
  // deixa o inicial forte para garantir a vitória
  db.prepare('UPDATE pokemon SET level = 30, exp = 27000 WHERE save_id = ?').run(save.id);
  await startFight(url);
  let view = (await call<BattleView>('GET', `${url}/battle`)).json;
  let final: BattleTurnResult | null = null;
  for (let i = 0; i < 40 && !final; i++) {
    const best = [...view.player.moves].sort((a, b) => b.power - a.power)[0];
    const r = await call<BattleTurnResult>('POST', `${url}/battle/act`, { kind: 'move', slot: best?.slot ?? -1 });
    assert.equal(r.status, 201);
    view = r.json.view;
    if (view.phase === 'ended') final = r.json;
  }
  assert.ok(final, 'a batalha acabou');
  assert.equal(final?.view.outcome?.result, 'win');
  assert.ok((final?.view.outcome?.money ?? 0) > 0);
  assert.ok(final?.events.some((e) => e.k === 'xp'));
  assert.ok(final?.events.some((e) => e.k === 'money'));
  const after = (await call<SaveDetail>('GET', url)).json;
  assert.ok(after.money > save.money, 'ganhou dinheiro');
  const mon = after.team[0] as PokemonView;
  assert.ok(mon.exp > 27000, 'ganhou XP');
  assert.equal(mon.currentHp, mon.stats.hp, 'curado ao fim');
  assert.ok(mon.friendship > 70, 'amizade subiu');
  assert.equal((await call('GET', `${url}/battle`)).json, null);
  const wild = (await call<WildState>('GET', `${url}/wild`)).json;
  assert.ok(wild.board, 'vitória mantém o mapa');
  assert.equal(wild.chosen, null);
  assert.equal(wild.board?.slots.length, 2, 'só o derrotado sai do mapa (3 no início)');
  assert.ok(!wild.board?.slots.some((slot) => slot.slot === 0), 'a vaga 0 ficou vazia, as outras não mudam de lugar');
});

test('batalha: capturar dentro da luta com Master Ball', async () => {
  const { url } = await setup();
  await startFight(url);
  const before = (await call<BattleView>('GET', `${url}/battle`)).json;
  const master = before.balls.find((b) => b.item === 'master-ball');
  assert.ok(master);
  assert.equal(master?.chance, 1);
  const r = await call<BattleTurnResult>('POST', `${url}/battle/act`, { kind: 'ball', item: 'master-ball' });
  assert.equal(r.json.view.outcome?.result, 'captured');
  assert.ok(r.json.view.outcome?.caught);
  assert.ok(r.json.events.some((e) => e.k === 'ball' && e.caught));
  const after = (await call<SaveDetail>('GET', url)).json;
  assert.equal(after.inventory.find((i) => i.item === 'master-ball')?.quantity, 9);
  assert.equal(after.pokedexCaught >= 2, true);
  assert.equal((await call('GET', `${url}/battle`)).json, null);
});

test('batalha: bola que falha gasta o turno; fugir devolve ao mapa; poção cura em batalha', async () => {
  const { save, url } = await setup();
  await startFight(url);
  db.prepare("UPDATE pokemon SET current_hp = 1 WHERE save_id = ?").run(save.id);
  // a equipe só é lida ao iniciar; fere o combatente direto no estado salvo
  const row = db.prepare('SELECT state FROM battles WHERE save_id = ?').get(save.id) as { state: string };
  const state = JSON.parse(row.state);
  state.player.team[0].hp = 3;
  db.prepare('UPDATE battles SET state = ? WHERE save_id = ?').run(JSON.stringify(state), save.id);
  const healed = await call<BattleTurnResult>('POST', `${url}/battle/act`, { kind: 'item', item: 'potion', target: 0 });
  assert.equal(healed.status, 201);
  assert.ok(healed.json.events.some((e) => e.text.includes('Poção') || e.text.includes('Potion')));
  assert.ok(healed.json.view.player.team[0] && healed.json.view.player.team[0].hp > 3);
  assert.equal((await call('POST', `${url}/battle/act`, { kind: 'item', item: 'potion', target: 5 })).status, 400);
  assert.equal((await call('POST', `${url}/battle/act`, { kind: 'item', item: 'poke-ball', target: 0 })).status, 400);
  let ended: BattleTurnResult | null = null;
  for (let i = 0; i < 30 && !ended; i++) {
    const r = await call<BattleTurnResult>('POST', `${url}/battle/act`, { kind: 'run' });
    if (r.json.view.phase === 'ended') ended = r.json;
  }
  assert.equal(ended?.view.outcome?.result === 'fled' || ended?.view.outcome?.result === 'lose', true);
  const wild = (await call<WildState>('GET', `${url}/wild`)).json;
  assert.ok(wild.board, 'fuga mantém o mapa');
  assert.equal(wild.chosen, null);
});

test('evoluir só pelo botão: nível suficiente libera, antes disso não', async () => {
  const { save, url } = await setup();
  const mon = save.team[0] as PokemonView;
  assert.deepEqual(mon.evolutions, []);
  assert.equal((await call('POST', `${url}/pokemon/${mon.id}/evolve`, { speciesId: 5 })).status, 400);
  db.prepare('UPDATE pokemon SET level = 16, exp = 4096 WHERE id = ?').run(mon.id);
  const ready = (await call<SaveDetail>('GET', url)).json.team[0] as PokemonView;
  assert.deepEqual(ready.evolutions.map((e) => e.speciesId), [5]);
  assert.equal(ready.speciesId, 4, 'não evolui sozinho');
  const evolved = await call<PokemonView>('POST', `${url}/pokemon/${mon.id}/evolve`, { speciesId: 5 });
  assert.equal(evolved.status, 201);
  assert.equal(evolved.json.speciesId, 5);
  assert.equal(evolved.json.level, 16);
  assert.ok(evolved.json.currentHp > 0 && evolved.json.currentHp <= evolved.json.stats.hp);
  assert.equal((await call('POST', `${url}/pokemon/${mon.id}/evolve`, { speciesId: 6 })).status, 400, 'Charizard só no 36');
});

test('golpes pendentes: aprender trocando ou descartar', async () => {
  const { save, url } = await setup();
  const mon = save.team[0] as PokemonView;
  db.prepare("INSERT INTO pending_moves (pokemon_id, move) VALUES (?, 'flamethrower')").run(mon.id);
  db.prepare("INSERT INTO pending_moves (pokemon_id, move) VALUES (?, 'slash')").run(mon.id);
  const view = (await call<SaveDetail>('GET', url)).json.team[0] as PokemonView;
  assert.deepEqual(view.pendingMoves.map((m) => m.name), ['flamethrower', 'slash']);
  assert.equal((await call('POST', `${url}/pokemon/${mon.id}/learn`, { move: 'surf', replace: 0 })).status, 400);
  assert.equal((await call('POST', `${url}/pokemon/${mon.id}/learn`, { move: 'flamethrower', replace: 9 })).status, 400);
  const learned = (await call<PokemonView>('POST', `${url}/pokemon/${mon.id}/learn`, { move: 'flamethrower', replace: 0 })).json;
  assert.equal(learned.moves[0]?.name, 'flamethrower');
  assert.equal(learned.pendingMoves.length, 1);
  const dropped = (await call<PokemonView>('POST', `${url}/pokemon/${mon.id}/learn`, { move: 'slash', replace: null })).json;
  assert.equal(dropped.pendingMoves.length, 0);
  assert.ok(!dropped.moves.some((m) => m.name === 'slash'));
});


test('mapa limpo: derrotar/capturar todos deixa o mapa vazio até girar', async () => {
  const { url } = await setup();
  await call('POST', `${url}/wild/search`, { region: 'kanto', minLevel: 2, maxLevel: 4 });
  for (const slot of [0, 1, 2]) {
    await call('POST', `${url}/wild/choose`, { slot });
    const r = await call<BattleTurnResult>('POST', `${url}/battle/start`);
    assert.equal(r.status, 201);
    const done = await call<BattleTurnResult>('POST', `${url}/battle/act`, { kind: 'ball', item: 'master-ball' });
    assert.equal(done.json.view.outcome?.result, 'captured');
  }
  const wild = (await call<WildState>('GET', `${url}/wild`)).json;
  assert.equal(wild.board?.slots.length, 0);
  const spun = (await call<WildState>('POST', `${url}/wild/spin`, {})).json;
  assert.equal(spun.board?.slots.length, 3, 'girar traz novos Pokémon');
});

test('golpes: lista permitidos, troca por nível (grátis) e TM comprada no Pokémon', async () => {
  const { save, url } = await setup();
  const mon = save.team[0] as PokemonView;
  db.prepare('UPDATE pokemon SET level = 40 WHERE id = ?').run(mon.id);
  const opts = (await call<{ learnable: { move: { name: string }; source: string; price: number; known: boolean }[]; money: number }>('GET', `${url}/pokemon/${mon.id}/moves`)).json;
  assert.ok(opts.learnable.length > 3);
  const tm = opts.learnable.find((item) => item.source === 'machine' && item.price > 0 && !item.known);
  assert.ok(tm, 'há TM para comprar');
  const free = opts.learnable.find((item) => item.source === 'level' && !item.known);
  assert.ok(free);
  assert.equal((await call('POST', `${url}/pokemon/${mon.id}/teach`, { move: 'definitely-not-a-move', slot: 0 })).status, 400);
  const swapped = await call<PokemonView>('POST', `${url}/pokemon/${mon.id}/teach`, { move: free?.move.name, slot: 0 });
  assert.equal(swapped.status, 201);
  assert.equal(swapped.json.moves[0]?.name, free?.move.name);
  assert.equal((await call('POST', `${url}/pokemon/${mon.id}/teach`, { move: free?.move.name, slot: 1 })).status, 400, 'já conhece');
  assert.equal((await call('POST', `${url}/pokemon/${mon.id}/teach`, { move: tm?.move.name, slot: 1 })).status, 400, 'TM não comprada');
  db.prepare('UPDATE saves SET money = 0 WHERE id = ?').run(save.id);
  assert.equal((await call('POST', `${url}/pokemon/${mon.id}/tm`, { move: tm?.move.name })).status, 400, 'sem dinheiro');
  db.prepare('UPDATE saves SET money = 100000 WHERE id = ?').run(save.id);
  assert.equal((await call('POST', `${url}/pokemon/${mon.id}/tm`, { move: free?.move.name })).status, 400, 'golpe de nível não é TM');
  const bought = await call<{ learnable: { move: { name: string }; unlocked: boolean }[] }>('POST', `${url}/pokemon/${mon.id}/tm`, { move: tm?.move.name });
  assert.equal(bought.status, 201);
  assert.ok(bought.json.learnable.find((i) => i.move.name === tm?.move.name)?.unlocked);
  assert.equal((db.prepare('SELECT money FROM saves WHERE id = ?').get(save.id) as { money: number }).money, 100000 - (tm?.price ?? 0));
  assert.equal((await call('POST', `${url}/pokemon/${mon.id}/tm`, { move: tm?.move.name })).status, 400, 'não compra duas vezes');
  const taught = await call<PokemonView>('POST', `${url}/pokemon/${mon.id}/teach`, { move: tm?.move.name, slot: 1 });
  assert.equal(taught.status, 201);
  assert.equal(taught.json.moves[1]?.name, tm?.move.name);
  assert.equal((db.prepare('SELECT money FROM saves WHERE id = ?').get(save.id) as { money: number }).money, 100000 - (tm?.price ?? 0), 'ensinar não cobra de novo');
});
