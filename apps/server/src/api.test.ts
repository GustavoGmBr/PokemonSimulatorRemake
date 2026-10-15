import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type {
  BoxView, DevGrantResult, HealthInfo, PokedexView, PokemonSearchResult, PokemonView, SaveDetail, SaveSummary, StarterRegion,
} from '@pokesim/engine';
import { openDatabase } from './db.ts';
import { createApp } from './app.ts';

const assets = mkdtempSync(path.join(tmpdir(), 'pokesim-assets-'));
mkdirSync(path.join(assets, 'pokemon'));
writeFileSync(path.join(assets, 'pokemon', '1-front.png'), 'png');

const db = openDatabase(':memory:');
const server = createApp({ db, assetsDir: assets, devTools: true });
let base = '';

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { server.close(); db.close(); });

async function call<T>(method: string, url: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await fetch(base + url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : null,
  });
  return { status: res.status, json: (res.status === 204 ? null : await res.json()) as T };
}

test('só os iniciais da 1ª geração estão disponíveis', async () => {
  const { status, json } = await call<StarterRegion[]>('GET', '/api/starters');
  assert.equal(status, 200);
  assert.equal(json.length, 1);
  assert.deepEqual(json[0]?.starters.map((s) => s.name), ['Bulbasaur', 'Charmander', 'Squirtle']);
});

test('cria, lê, lista e exclui um save', async () => {
  const created = await call<SaveDetail>('POST', '/api/saves', { trainerName: '  Gustavo ', starterSpeciesId: 4 });
  assert.equal(created.status, 201);
  assert.equal(created.json.trainerName, 'Gustavo');
  assert.equal(created.json.money, 3000);
  assert.equal(created.json.team.length, 1);
  const starter = created.json.team[0];
  assert.equal(starter?.speciesName, 'Charmander');
  assert.equal(starter?.level, 5);
  assert.equal(starter?.ivStars, 4);
  assert.equal(starter?.currentHp, starter?.stats.hp);
  assert.ok(starter?.favorite);
  assert.deepEqual(created.json.inventory.map((i) => [i.item, i.quantity]), [['poke-ball', 10], ['potion', 5]]);
  assert.equal(created.json.pokedexCaught, 1);

  const list = await call<SaveSummary[]>('GET', '/api/saves');
  assert.equal(list.json.length, 1);
  assert.deepEqual(list.json[0]?.teamPreview, [{ speciesId: 4, shiny: false, level: 5 }]);

  const removed = await call('DELETE', `/api/saves/${created.json.id}`);
  assert.equal(removed.status, 204);
  assert.equal((await call('GET', `/api/saves/${created.json.id}`)).status, 404);
});

test('valida nome e inicial', async () => {
  assert.equal((await call('POST', '/api/saves', { trainerName: '', starterSpeciesId: 1 })).status, 400);
  assert.equal((await call('POST', '/api/saves', { trainerName: 'Nome muito longo aqui', starterSpeciesId: 1 })).status, 400);
  assert.equal((await call('POST', '/api/saves', { trainerName: 'Ash', starterSpeciesId: 152 })).status, 400, 'inicial de Johto ainda fechado');
  const notStarter = await call<{ error: string }>('POST', '/api/saves', { trainerName: 'Ash', starterSpeciesId: 150 });
  assert.equal(notStarter.status, 400);
  assert.match(notStarter.json.error, /iniciais/);
});

test('serve sprites e bloqueia caminhos fora da pasta', async () => {
  assert.equal((await fetch(`${base}/assets/pokemon/1-front.png`)).status, 200);
  // imagem do jogo que ainda não foi baixada: redireciona para a origem; nomes fora do padrão continuam 404
  const missing = await fetch(`${base}/assets/pokemon/999-front.png`, { redirect: 'manual' });
  assert.equal(missing.status, 302);
  assert.equal(missing.headers.get('location'), 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/999.png');
  assert.equal((await fetch(`${base}/assets/pokemon/qualquer.png`, { redirect: 'manual' })).status, 404);
  assert.equal((await fetch(`${base}/assets/..%2f..%2fetc%2fpasswd`)).status, 404);
});

async function newSave(name = 'Teste'): Promise<SaveDetail> {
  return (await call<SaveDetail>('POST', '/api/saves', { trainerName: name, starterSpeciesId: 1 })).json;
}

async function grant(saveId: string, count: number): Promise<DevGrantResult> {
  const res = await call<DevGrantResult>('POST', `/api/saves/${saveId}/dev/grant`, { count });
  assert.equal(res.status, 201);
  return res.json;
}

test('health informa as ferramentas de teste', async () => {
  const { json } = await call<HealthInfo>('GET', '/api/health');
  assert.equal(json.devTools, true);
  assert.equal(json.species, 1025);
});

test('Pokémon novos enchem a equipe e depois vão para o PC, sem limite de caixas', async () => {
  const save = await newSave();
  const result = await grant(save.id, 100);
  assert.equal(result.added, 100);
  assert.equal(result.inTeam, 5);
  assert.equal(result.inBoxes, 95);

  const box0 = (await call<BoxView>('GET', `/api/saves/${save.id}/box/0`)).json;
  assert.equal(box0.slots.length, 30);
  assert.equal(box0.slots.filter(Boolean).length, 30);
  assert.equal(box0.totalInBoxes, 95);
  assert.equal(box0.highestUsedBox, 3);
  const box3 = (await call<BoxView>('GET', `/api/saves/${save.id}/box/3`)).json;
  assert.equal(box3.slots.filter(Boolean).length, 5);
  const far = (await call<BoxView>('GET', `/api/saves/${save.id}/box/500`)).json;
  assert.equal(far.slots.filter(Boolean).length, 0);
  assert.equal((await call('GET', `/api/saves/${save.id}/box/-1`)).status, 400);
  assert.equal((await call('GET', `/api/saves/${save.id}/box/abc`)).status, 400);
});

test('mover entre equipe e PC: depositar, sacar e trocar', async () => {
  const save = await newSave();
  await grant(save.id, 7); // equipe cheia (6) + 1 no PC
  const team = (await call<SaveDetail>('GET', `/api/saves/${save.id}`)).json.team;
  assert.equal(team.length, 6);
  const [first, second] = team as [PokemonView, PokemonView];
  const inBox = (await call<BoxView>('GET', `/api/saves/${save.id}/box/0`)).json.slots[0] as PokemonView;

  // depositar a 2ª em uma vaga livre do PC compacta a equipe
  assert.equal((await call('POST', `/api/saves/${save.id}/pokemon/${second.id}/move`, { to: { kind: 'box', box: 7, slot: 3 } })).status, 204);
  let after = (await call<SaveDetail>('GET', `/api/saves/${save.id}`)).json.team;
  assert.equal(after.length, 5);
  assert.deepEqual(after.map((p) => p.location), [0, 1, 2, 3, 4].map((slot) => ({ kind: 'team', slot })));
  assert.equal((await call<BoxView>('GET', `/api/saves/${save.id}/box/7`)).json.slots[3]?.id, second.id);

  // sacar para a equipe (há vaga) entra no fim
  await call('POST', `/api/saves/${save.id}/pokemon/${inBox.id}/move`, { to: { kind: 'team', slot: 5 } });
  after = (await call<SaveDetail>('GET', `/api/saves/${save.id}`)).json.team;
  assert.equal(after.length, 6);
  assert.equal(after[5]?.id, inBox.id);

  // equipe cheia: sacar em cima de alguém troca os dois
  await call('POST', `/api/saves/${save.id}/pokemon/${second.id}/move`, { to: { kind: 'team', slot: 0 } });
  after = (await call<SaveDetail>('GET', `/api/saves/${save.id}`)).json.team;
  assert.equal(after[0]?.id, second.id);
  assert.equal((await call<BoxView>('GET', `/api/saves/${save.id}/box/7`)).json.slots[3]?.id, first.id);

  // reordenar dentro da equipe troca de lugar
  await call('POST', `/api/saves/${save.id}/pokemon/${second.id}/move`, { to: { kind: 'team', slot: 2 } });
  const reordered = (await call<SaveDetail>('GET', `/api/saves/${save.id}`)).json.team;
  assert.equal(reordered[2]?.id, second.id);
  assert.equal(reordered.length, 6);

  // destinos inválidos
  assert.equal((await call('POST', `/api/saves/${save.id}/pokemon/${second.id}/move`, { to: { kind: 'team', slot: 9 } })).status, 400);
  assert.equal((await call('POST', `/api/saves/${save.id}/pokemon/${second.id}/move`, { to: { kind: 'box', box: -2, slot: 0 } })).status, 400);
  assert.equal((await call('POST', `/api/saves/${save.id}/pokemon/${second.id}/move`, {})).status, 400);
  assert.equal((await call('POST', `/api/saves/${save.id}/pokemon/nao-existe/move`, { to: { kind: 'box', box: 0, slot: 0 } })).status, 404);
});

test('não deixa depositar o último Pokémon da equipe', async () => {
  const save = await newSave();
  const only = save.team[0] as PokemonView;
  const res = await call<{ error: string }>('POST', `/api/saves/${save.id}/pokemon/${only.id}/move`, { to: { kind: 'box', box: 0, slot: 0 } });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /ao menos um/);
});

test('um save não mexe nos Pokémon de outro', async () => {
  const a = await newSave('A');
  const b = await newSave('B');
  const mine = a.team[0] as PokemonView;
  assert.equal((await call('PATCH', `/api/saves/${b.id}/pokemon/${mine.id}`, { favorite: false })).status, 404);
  assert.equal((await call('POST', `/api/saves/${b.id}/pokemon/${mine.id}/move`, { to: { kind: 'box', box: 0, slot: 0 } })).status, 404);
});

test('apelido e favorito', async () => {
  const save = await newSave();
  const mon = save.team[0] as PokemonView;
  const named = await call<PokemonView>('PATCH', `/api/saves/${save.id}/pokemon/${mon.id}`, { nickname: '  Sr.   Folha ' });
  assert.equal(named.status, 200);
  assert.equal(named.json.nickname, 'Sr. Folha');
  assert.equal(named.json.name, 'Sr. Folha');
  assert.equal(named.json.speciesName, 'Bulbasaur');
  assert.equal((await call('PATCH', `/api/saves/${save.id}/pokemon/${mon.id}`, { nickname: 'nome grande demais' })).status, 400);
  assert.equal((await call('PATCH', `/api/saves/${save.id}/pokemon/${mon.id}`, { nickname: 5 })).status, 400);
  const cleared = await call<PokemonView>('PATCH', `/api/saves/${save.id}/pokemon/${mon.id}`, { nickname: '', favorite: false });
  assert.equal(cleared.json.nickname, null);
  assert.equal(cleared.json.name, 'Bulbasaur');
  assert.equal(cleared.json.favorite, false);
  assert.equal((await call('PATCH', `/api/saves/${save.id}/pokemon/${mon.id}`, { favorite: 'sim' })).status, 400);
});

test('busca: filtros, ordenação e paginação', async () => {
  const save = await newSave();
  await grant(save.id, 120);
  const all = (await call<PokemonSearchResult>('GET', `/api/saves/${save.id}/pokemon?limit=100`)).json;
  assert.equal(all.total, 121);
  assert.equal(all.items.length, 100);
  const page2 = (await call<PokemonSearchResult>('GET', `/api/saves/${save.id}/pokemon?limit=100&offset=100`)).json;
  assert.equal(page2.items.length, 21);

  const byLevel = (await call<PokemonSearchResult>('GET', `/api/saves/${save.id}/pokemon?sort=level&dir=desc&limit=100`)).json;
  const levels = byLevel.items.map((p) => p.level);
  assert.deepEqual(levels, [...levels].sort((x, y) => y - x));

  const fire = (await call<PokemonSearchResult>('GET', `/api/saves/${save.id}/pokemon?type=fire&limit=100`)).json;
  assert.ok(fire.total > 0);
  assert.ok(fire.items.every((p) => p.types.includes('fire')));

  const gen1 = (await call<PokemonSearchResult>('GET', `/api/saves/${save.id}/pokemon?generation=1&limit=100`)).json;
  assert.ok(gen1.items.every((p) => p.generation === 1 && p.speciesId <= 151));

  const range = (await call<PokemonSearchResult>('GET', `/api/saves/${save.id}/pokemon?minLevel=30&maxLevel=40&limit=100`)).json;
  assert.ok(range.items.every((p) => p.level >= 30 && p.level <= 40));

  const favs = (await call<PokemonSearchResult>('GET', `/api/saves/${save.id}/pokemon?favorite=true`)).json;
  assert.equal(favs.total, 1);
  assert.equal(favs.items[0]?.speciesName, 'Bulbasaur');

  const byName = (await call<PokemonSearchResult>('GET', `/api/saves/${save.id}/pokemon?text=bulba`)).json;
  assert.ok(byName.items.some((p) => p.speciesName === 'Bulbasaur'));

  assert.equal((await call('GET', `/api/saves/${save.id}/pokemon?type=lixo`)).status, 400);
  assert.equal((await call('GET', `/api/saves/${save.id}/pokemon?minLevel=abc`)).status, 400);
  assert.equal((await call('GET', `/api/saves/nao-existe/pokemon`)).status, 404);
});

test('Pokédex: capturado, não visto e contagem de exemplares', async () => {
  const save = await newSave();
  const dex = (await call<PokedexView>('GET', `/api/saves/${save.id}/pokedex`)).json;
  assert.equal(dex.total, 1025);
  assert.equal(dex.states.length, 1025);
  assert.equal(dex.states[0], 2);
  assert.equal(dex.states[1], 0);
  assert.equal(dex.caught, 1);
  assert.equal(dex.seen, 1);
  assert.equal(dex.owned[1], 1);

  await grant(save.id, 50);
  const after = (await call<PokedexView>('GET', `/api/saves/${save.id}/pokedex`)).json;
  assert.ok(after.caught > 1);
  assert.equal(Object.values(after.owned).reduce((sum, n) => sum + n, 0), 51);
  assert.equal(after.states.filter((state) => state === 2).length, after.caught);
});

test('tempo de jogo soma e limita a cada aviso', async () => {
  const save = await newSave();
  assert.equal((await call('POST', `/api/saves/${save.id}/playtime`, { seconds: 30 })).status, 204);
  assert.equal((await call('POST', `/api/saves/${save.id}/playtime`, { seconds: 99999 })).status, 204);
  assert.equal((await call('POST', `/api/saves/${save.id}/playtime`, { seconds: -5 })).status, 400);
  assert.equal((await call('POST', `/api/saves/${save.id}/playtime`, {})).status, 400);
  const detail = (await call<SaveDetail>('GET', `/api/saves/${save.id}`)).json;
  assert.equal(detail.playTimeSeconds, 30 + 120);
});

test('catálogo para a interface', async () => {
  const index = (await call<{ id: number; name: string }[]>('GET', '/api/catalog/species-index')).json;
  assert.equal(index.length, 1025);
  assert.equal(index[24]?.name, 'Pikachu');
  assert.equal((await call<unknown[]>('GET', '/api/catalog/types')).json.length, 18);
});

test('ferramenta de teste fica de fora quando desligada', async () => {
  const db2 = openDatabase(':memory:');
  const server2 = createApp({ db: db2, assetsDir: assets });
  await new Promise<void>((resolve) => server2.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server2.address() as AddressInfo).port}`;
  const health = (await (await fetch(`${url}/api/health`)).json()) as HealthInfo;
  assert.equal(health.devTools, false);
  assert.equal((await fetch(`${url}/api/saves/x/dev/grant`, { method: 'POST', body: '{}' })).status, 404);
  server2.close();
  db2.close();
});

// ---------------------------------------------------------------- selvagens, itens e loja

import { HABITATS } from '@pokesim/engine';
import type {
  BuyResult, ShopEntry, ThrowBallResult, UseItemResult, WildState,
} from '@pokesim/engine';

const KANTO = { region: 'kanto' };

async function kit(saveId: string): Promise<void> {
  assert.equal((await call('POST', `/api/saves/${saveId}/dev/kit`)).status, 201);
}

test('procurar: mapa com 3 selvagens, 3 giros e nada sem procura', async () => {
  const save = await newSave();
  const idle = (await call<WildState>('GET', `/api/saves/${save.id}/wild`)).json;
  assert.equal(idle.board, null);
  assert.deepEqual(idle.balls.map((b) => [b.item, b.quantity]), [['poke-ball', 10]]);

  const first = (await call<WildState>('POST', `/api/saves/${save.id}/wild/search`, KANTO)).json;
  assert.equal(first.board?.slots.length, 3);
  assert.equal(first.board?.spinsLeft, 3);
  assert.equal(first.board?.regionName, 'Kanto');
  assert.ok(first.board?.habitat);
  for (const slot of first.board?.slots ?? []) {
    assert.ok(slot.speciesId >= 1 && slot.speciesId <= 151, 'só Kanto');
    assert.ok(slot.level >= 2 && slot.level <= 10);
    assert.ok(slot.ivStars >= 0 && slot.ivStars <= 4);
    assert.equal(typeof slot.shiny, 'boolean');
  }

  for (let left = 2; left >= 0; left--) {
    const spun = (await call<WildState>('POST', `/api/saves/${save.id}/wild/spin`)).json;
    assert.equal(spun.board?.spinsLeft, left);
  }
  const noMore = await call<{ error: string }>('POST', `/api/saves/${save.id}/wild/spin`);
  assert.equal(noMore.status, 400);
  assert.match(noMore.json.error, /giros/);
  // sem giros: pagar ₽ 1.000 renova o mapa
  const poor = await call<{ error: string }>('POST', `/api/saves/${save.id}/wild/spin`, { pay: true });
  assert.equal(poor.status, 201);
  assert.equal((poor.json as unknown as WildState).money, 2000);
  assert.equal((poor.json as unknown as WildState).board?.spinsLeft, 0);
  // buscar de novo renova os giros
  assert.equal(((await call<WildState>('POST', `/api/saves/${save.id}/wild/search`, KANTO)).json.board?.spinsLeft), 3);
});

test('escolher: encontro, fugir, e regras de ordem', async () => {
  const save = await newSave();
  assert.equal((await call('POST', `/api/saves/${save.id}/wild/choose`, { slot: 0 })).status, 400);
  assert.equal((await call('POST', `/api/saves/${save.id}/wild/throw`, { ball: 'poke-ball' })).status, 400);
  await call('POST', `/api/saves/${save.id}/wild/search`, KANTO);
  assert.equal((await call('POST', `/api/saves/${save.id}/wild/choose`, { slot: 10 })).status, 400);
  const chosen = (await call<WildState>('POST', `/api/saves/${save.id}/wild/choose`, { slot: 2 })).json;
  assert.equal(chosen.chosen, 2);
  const ball = chosen.balls[0];
  assert.ok(ball && ball.chance !== null && ball.chance > 0 && ball.chance < 1);
  assert.equal((await call('POST', `/api/saves/${save.id}/wild/spin`)).status, 400, 'não gira durante o encontro');

  const dex = (await call<PokedexView>('GET', `/api/saves/${save.id}/pokedex`)).json;
  const speciesId = chosen.board?.slots[2]?.speciesId ?? 0;
  assert.ok(dex.states[speciesId - 1] ?? 0 >= 1, 'a espécie escolhida vira vista');

  const fled = (await call<WildState>('POST', `/api/saves/${save.id}/wild/flee`)).json;
  assert.equal(fled.chosen, null);
  assert.equal(fled.board?.spinsLeft, 3);
});

test('lançar bola: gasta a bola, errar mantém o encontro e a Master Ball captura', async () => {
  const save = await newSave();
  await kit(save.id);
  await call('POST', `/api/saves/${save.id}/wild/search`, KANTO);
  const before = (await call<WildState>('POST', `/api/saves/${save.id}/wild/choose`, { slot: 2 })).json;
  const target = before.board?.slots[2];
  assert.ok(target);
  assert.equal((await call('POST', `/api/saves/${save.id}/wild/throw`, { ball: 'rare-candy' })).status, 400);

  const thrown = (await call<ThrowBallResult>('POST', `/api/saves/${save.id}/wild/throw`, { ball: 'poke-ball' })).json;
  assert.ok([0, 1, 2, 3].includes(thrown.shakes));
  assert.equal(thrown.state.balls.find((b) => b.item === 'poke-ball')?.quantity, 19);
  if (!thrown.caught) assert.equal(thrown.state.chosen, 2);

  const master = (await call<ThrowBallResult>('POST', `/api/saves/${save.id}/wild/throw`, { ball: 'master-ball' }));
  if (thrown.caught) {
    assert.equal(master.status, 400, 'o mapa acabou com a captura');
  } else {
    assert.equal(master.json.caught, true);
    assert.equal(master.json.shakes, 3);
    assert.equal(master.json.chance, 1);
    assert.equal(master.json.pokemon?.speciesId, target.speciesId);
    assert.equal(master.json.pokemon?.level, target.level);
    assert.equal(master.json.pokemon?.shiny, target.shiny);
    assert.equal(master.json.pokemon?.ball, 'master-ball');
    assert.equal(master.json.state.board?.slots.length, 2, 'só o capturado sai do mapa');
  }
  const mine = (await call<PokemonSearchResult>('GET', `/api/saves/${save.id}/pokemon?limit=100`)).json;
  assert.equal(mine.total, 2);
  const dex = (await call<PokedexView>('GET', `/api/saves/${save.id}/pokedex`)).json;
  assert.equal(dex.states[target.speciesId - 1], 2);
});

test('sem bolas não dá para lançar', async () => {
  const save = await newSave();
  await call('POST', `/api/saves/${save.id}/wild/search`, KANTO);
  await call('POST', `/api/saves/${save.id}/wild/choose`, { slot: 0 });
  for (let i = 0; i < 10; i++) {
    const res = await call<ThrowBallResult>('POST', `/api/saves/${save.id}/wild/throw`, { ball: 'poke-ball' });
    if (res.json.caught) return; // capturou com as 10 — o mapa encerra, nada a testar
  }
  const empty = await call<{ error: string }>('POST', `/api/saves/${save.id}/wild/throw`, { ball: 'poke-ball' });
  assert.equal(empty.status, 400);
});

const reg = (state: WildState, id: string) => state.regions.find((r) => r.id === id);

test('regiões: só Kanto no início; progresso libera regiões, giros, lendários e busca específica', async () => {
  const save = await newSave();
  const base = `/api/saves/${save.id}`;
  const initial = (await call<WildState>('GET', `${base}/wild`)).json;
  assert.deepEqual(initial.regions.filter((r) => r.unlocked).map((r) => r.id), ['all', 'kanto']);
  assert.equal(reg(initial, 'kanto')?.spins, 3);
  assert.equal((await call('POST', `${base}/wild/search`, { region: 'johto' })).status, 400, 'Johto fechada');
  assert.equal((await call('POST', `${base}/wild/search`, { region: 'kanto', speciesId: 25 })).status, 400, 'busca específica fechada');
  assert.equal((await call('POST', `${base}/wild/search`, {})).status, 400);

  const seen = new Set<number>();
  for (let i = 0; i < 20; i++) for (const slot of (await call<WildState>('POST', `${base}/wild/search`, KANTO)).json.board?.slots ?? []) seen.add(slot.speciesId);
  for (const id of [150, 151, 144, 145, 146]) assert.ok(!seen.has(id), `#${id} lendário bloqueado`);
  const stages = [...seen].filter((id) => [6, 9, 3, 149].includes(id));
  assert.deepEqual(stages, [], 'sem insígnias, só o 1º estágio');

  // giros por desafio: ginásio 5, elite 8, campeão 12
  const progress = async () => (await call<{ granted: string | null }>('POST', `${base}/dev/progress`)).json.granted;
  assert.equal(await progress(), 'kanto:gym1');
  assert.equal(reg((await call<WildState>('GET', `${base}/wild`)).json, 'kanto')?.spins, 5);
  for (let i = 0; i < 7; i++) await progress();
  for (const n of [1, 2, 3]) {
    assert.equal(await progress(), `kanto:elite${n}`);
    assert.equal(reg((await call<WildState>('GET', `${base}/wild`)).json, 'kanto')?.spins, 5, 'Elite incompleta não conta');
  }
  assert.equal(await progress(), 'kanto:elite4');
  const afterElite = (await call<WildState>('GET', `${base}/wild`)).json;
  assert.equal(reg(afterElite, 'kanto')?.spins, 8);
  assert.ok(reg(afterElite, 'kanto')?.legendaries);
  assert.ok(!reg(afterElite, 'johto')?.unlocked, 'Johto ainda fechada');
  assert.equal((await call('POST', `${base}/wild/search`, { region: 'kanto', speciesId: 25 })).status, 400);
  assert.equal(await progress(), 'kanto:champion');
  const afterChampion = (await call<WildState>('GET', `${base}/wild`)).json;
  assert.equal(reg(afterChampion, 'kanto')?.spins, 12);
  assert.ok(reg(afterChampion, 'johto')?.unlocked, 'Johto abriu');
  assert.ok(!reg(afterChampion, 'hoenn')?.unlocked);

  // busca específica: os 10 são o escolhido e o mapa é o do tipo dele
  const specific = (await call<WildState>('POST', `${base}/wild/search`, { region: 'kanto', speciesId: 25 })).json.board;
  assert.equal(specific?.slots.length, 15);
  assert.ok(specific?.slots.every((slot) => slot.speciesId === 25));
  assert.equal(specific?.habitat, 'industrial');
  assert.equal(specific?.spinsLeft, 12);
  assert.equal((await call('POST', `${base}/wild/search`, { region: 'kanto', speciesId: 152 })).status, 400, 'espécie de outra região');
  const water = (await call<WildState>('POST', `${base}/wild/search`, { region: 'kanto', speciesId: 7 })).json.board;
  assert.equal(water?.habitat, 'coast');

  // sair do mapa
  const left = (await call<WildState>('POST', `${base}/wild/leave`)).json;
  assert.equal(left.board, null);

  // Johto e lendários: com a Elite dos 4, lendários passam a aparecer
  await call('POST', `${base}/dev/progress`, { all: true });
  const legends = new Set<number>();
  for (let i = 0; i < 60; i++) {
    for (const slot of (await call<WildState>('POST', `${base}/wild/search`, { region: 'kanto' })).json.board?.slots ?? []) legends.add(slot.speciesId);
  }
  assert.ok([144, 145, 146, 150, 151].some((id) => legends.has(id)), 'lendários de Kanto aparecem com a Elite dos 4');
});

test('nível escolhido e mapa escolhido após os 8 ginásios', async () => {
  const save = await newSave();
  const base = `/api/saves/${save.id}`;
  const levelled = (await call<WildState>('POST', `${base}/wild/search`, { region: 'kanto', minLevel: 2, maxLevel: 10 })).json;
  assert.deepEqual(levelled.board?.levelRange, [2, 10]);
  assert.ok(levelled.board?.slots.every((slot) => slot.level >= 2 && slot.level <= 10));
  const spun = (await call<WildState>('POST', `${base}/wild/spin`)).json;
  assert.deepEqual(spun.board?.levelRange, [2, 10], 'o giro mantém a faixa');
  assert.ok(spun.board?.slots.every((slot) => slot.level >= 2 && slot.level <= 10));
  assert.equal(reg(levelled, 'kanto')?.levelCap, 10);
  for (const bad of [{ minLevel: 0 }, { minLevel: 30, maxLevel: 20 }, { maxLevel: 101 }, { maxLevel: 11 }, { minLevel: 2.5 }]) {
    assert.equal((await call('POST', `${base}/wild/search`, { region: 'kanto', ...bad })).status, 400, JSON.stringify(bad));
  }

  assert.equal((await call('POST', `${base}/wild/search`, { region: 'kanto', habitat: 'coast' })).status, 400, 'mapa escolhido exige 8 ginásios');
  for (let i = 0; i < 8; i++) await call('POST', `${base}/dev/progress`);
  const state = (await call<WildState>('GET', `${base}/wild`)).json;
  assert.ok(reg(state, 'kanto')?.chooseHabitat);
  for (const habitat of HABITATS) {
    const board = (await call<WildState>('POST', `${base}/wild/search`, { region: 'kanto', habitat: habitat.id })).json.board;
    assert.equal(board?.habitat, habitat.id);
    assert.ok(board?.slots.every((slot) => slot.types.some((t) => habitat.types.includes(t))), habitat.id);
  }
  assert.equal((await call('POST', `${base}/wild/search`, { region: 'kanto', habitat: 'lua' })).status, 400);
});

test('Todas as gerações: mistura as regiões liberadas e usa o limite da mais recente', async () => {
  const save = await newSave();
  const base = `/api/saves/${save.id}`;
  const first = (await call<WildState>('GET', `${base}/wild`)).json;
  assert.equal(first.regions[0]?.id, 'all');
  assert.equal(reg(first, 'all')?.levelCap, 10);
  assert.equal((await call('POST', `${base}/wild/search`, { region: 'all', speciesId: 25 })).status, 400, 'sem busca específica');
  assert.equal((await call('POST', `${base}/wild/search`, { region: 'all', maxLevel: 11 })).status, 400);
  const board = (await call<WildState>('POST', `${base}/wild/search`, { region: 'all' })).json.board;
  assert.equal(board?.region, 'all');
  assert.deepEqual(board?.levelRange, [2, 10], 'mínimo padrão 2');
  assert.ok(board?.slots.every((slot) => slot.speciesId <= 151));

  for (let i = 0; i < 13; i++) await call('POST', `${base}/dev/progress`); // 8 ginásios + Elite + campeão de Kanto
  const later = (await call<WildState>('GET', `${base}/wild`)).json;
  assert.equal(reg(later, 'kanto')?.levelCap, 100);
  assert.equal(reg(later, 'johto')?.levelCap, 10);
  assert.equal(reg(later, 'all')?.levelCap, 10, 'acompanha a região mais recente');
  assert.equal(reg(later, 'all')?.spins, reg(later, 'johto')?.spins);
  const seen = new Set<number>();
  for (let i = 0; i < 25; i++) for (const slot of (await call<WildState>('POST', `${base}/wild/search`, { region: 'all' })).json.board?.slots ?? []) seen.add(slot.speciesId);
  assert.ok([...seen].some((id) => id <= 151), 'Kanto');
  assert.ok([...seen].some((id) => id > 151 && id <= 251), 'Johto');
  assert.ok([...seen].every((id) => id <= 251));
});

test('mapas: cada procura usa um habitat e os Pokémon combinam com ele', async () => {
  const save = await newSave();
  const base = `/api/saves/${save.id}`;
  const habitats = new Set<string>();
  for (let i = 0; i < 40; i++) {
    const board = (await call<WildState>('POST', `${base}/wild/search`, KANTO)).json.board;
    assert.ok(board);
    habitats.add(board.habitat);
    const allowed = HABITATS.find((h) => h.id === board.habitat)?.types ?? [];
    for (const slot of board.slots) assert.ok(slot.types.some((t) => allowed.includes(t)), `${slot.name} não combina com ${board.habitat}`);
  }
  assert.ok(habitats.size >= 3);
});

test('loja: compra em carrinho, dinheiro e limites', async () => {
  const save = await newSave();
  const shop = (await call<ShopEntry[]>('GET', `/api/saves/${save.id}/shop`)).json;
  assert.ok(shop.some((e) => e.item === 'poke-ball' && e.price === 200));
  assert.ok(!shop.some((e) => e.item === 'master-ball'), 'Master Ball não é vendida');
  assert.ok(!shop.some((e) => e.item === 'premier-ball'), 'Premier só de brinde');
  const categories = new Set(shop.map((e) => e.category));
  for (const category of ['captura', 'cura', 'evolucao', 'mega', 'primal', 'ivs', 'buff']) assert.ok(categories.has(category), category);
  assert.ok(!categories.has('treino'));
  assert.equal(shop.filter((e) => e.category === 'mega').length, 97);
  assert.equal(shop.filter((e) => e.category === 'ivs').length, 6);
  assert.ok(shop.filter((e) => e.category === 'ivs').every((e) => e.price === 5000));
  assert.equal(shop.find((e) => e.item === 'shiny-stone')?.price, 1_000_000);
  assert.equal(shop.filter((e) => e.category === 'captura' && e.price === 1000).length, 16);

  const bought = await call<BuyResult>('POST', `/api/saves/${save.id}/shop/buy`, {
    cart: [{ item: 'poke-ball', quantity: 5 }, { item: 'potion', quantity: 3 }, { item: 'poke-ball', quantity: 1 }],
  });
  assert.equal(bought.status, 201);
  assert.equal(bought.json.spent, 6 * 200 + 3 * 300);
  assert.equal(bought.json.money, 3000 - 2100);
  const detail = (await call<SaveDetail>('GET', `/api/saves/${save.id}`)).json;
  assert.equal(detail.money, 900);
  assert.deepEqual(detail.inventory.map((i) => [i.item, i.quantity]), [['poke-ball', 16], ['potion', 8]]);

  const broke = await call<{ error: string }>('POST', `/api/saves/${save.id}/shop/buy`, { cart: [{ item: 'ultra-ball', quantity: 1 }] });
  assert.equal(broke.status, 400);
  assert.match(broke.json.error, /Dinheiro/);
  assert.equal((await call<SaveDetail>('GET', `/api/saves/${save.id}`)).json.money, 900, 'nada foi cobrado');

  for (const cart of [[], [{ item: 'master-ball', quantity: 1 }], [{ item: 'potion', quantity: 0 }], [{ item: 'potion', quantity: 1.5 }], [{ item: 'potion', quantity: 99 }]]) {
    assert.equal((await call('POST', `/api/saves/${save.id}/shop/buy`, { cart })).status, 400, JSON.stringify(cart));
  }
  assert.equal((await call('POST', `/api/saves/${save.id}/shop/buy`, {})).status, 400);
});

test('loja: Bola Premier de brinde a cada 10 Poké Bolas', async () => {
  const save = await newSave();
  await kit(save.id);
  const bought = await call<BuyResult>('POST', `/api/saves/${save.id}/shop/buy`, { cart: [{ item: 'poke-ball', quantity: 20 }] });
  assert.equal(bought.status, 201);
  assert.equal(bought.json.premier, 2);
  const inventory = (await call<SaveDetail>('GET', `/api/saves/${save.id}`)).json.inventory;
  assert.equal(inventory.find((i) => i.item === 'premier-ball')?.quantity, 12, '10 do kit + 2 de brinde');
  const few = await call<BuyResult>('POST', `/api/saves/${save.id}/shop/buy`, { cart: [{ item: 'poke-ball', quantity: 9 }] });
  assert.equal(few.json.premier, 0);
});

test('itens: poção e reviver', async () => {
  const save = await newSave();
  await kit(save.id);
  await call('POST', `/api/saves/${save.id}/dev/grant`, { count: 3 });
  const team = (await call<SaveDetail>('GET', `/api/saves/${save.id}`)).json.team;
  const mon = team[0] as PokemonView;

  const full = await call<{ error: string }>('POST', `/api/saves/${save.id}/items/use`, { item: 'potion', pokemonId: mon.id });
  assert.equal(full.status, 400);
  assert.match(full.json.error, /cheio/);

  await call('POST', `/api/saves/${save.id}/dev/hurt`);
  let hurt = (await call<SaveDetail>('GET', `/api/saves/${save.id}`)).json.team;
  assert.ok(hurt.every((p) => p.currentHp < p.stats.hp));
  const down = hurt.find((p) => p.currentHp === 0) ?? null;
  const alive = hurt.find((p) => p.currentHp > 0) as PokemonView;

  const used = await call<UseItemResult>('POST', `/api/saves/${save.id}/items/use`, { item: 'max-potion', pokemonId: alive.id });
  assert.equal(used.status, 201);
  assert.equal(used.json.pokemon.currentHp, alive.stats.hp);
  assert.equal(used.json.remaining, 4);
  assert.equal((await call('POST', `/api/saves/${save.id}/items/use`, { item: 'revive', pokemonId: alive.id })).status, 400);
  if (down) {
    const revived = (await call<UseItemResult>('POST', `/api/saves/${save.id}/items/use`, { item: 'max-revive', pokemonId: down.id })).json;
    assert.equal(revived.pokemon.currentHp, down.stats.hp);
  }
  assert.equal((await call('POST', `/api/saves/${save.id}/items/use`, { item: 'potion', pokemonId: 'nao-existe' })).status, 404);
  assert.equal((await call('POST', `/api/saves/${save.id}/items/use`, { item: 'poke-ball', pokemonId: mon.id })).status, 400);
});
