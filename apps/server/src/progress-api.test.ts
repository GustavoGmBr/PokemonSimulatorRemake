import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { PokemonView, SaveDetail, TeamView, UseItemResult } from '@pokesim/engine';
import { openDatabase } from './db.ts';
import { createApp } from './app.ts';

const db = openDatabase(':memory:');
const server = createApp({ db, assetsDir: mkdtempSync(path.join(tmpdir(), 'pokesim-progress-')), devTools: true });
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
  const mon = save.team[0] as PokemonView;
  return { save, url, mon };
}
const give = (saveId: string, item: string, qty = 1) => db.prepare('INSERT INTO inventory (save_id, item, quantity) VALUES (?, ?, ?) ON CONFLICT (save_id, item) DO UPDATE SET quantity = quantity + excluded.quantity').run(saveId, item, qty);
const qty = (saveId: string, item: string) => (db.prepare('SELECT quantity FROM inventory WHERE save_id = ? AND item = ?').get(saveId, item) as { quantity: number } | undefined)?.quantity ?? 0;
const species = (id: string, speciesId: number, level = 30) => db.prepare('UPDATE pokemon SET species_id = ?, level = ?, exp = ?, form = NULL WHERE id = ?').run(speciesId, level, level ** 3, id);
const view = async (url: string, id: string) => (await call<PokemonView[]>('GET', `${url}/pokemon?limit=100`).then(async () => (await call<{ items: PokemonView[] }>('GET', `${url}/pokemon?limit=100`)).json.items.find((m) => m.id === id) as PokemonView));
function addMon(saveId: string, speciesId: number, level = 20): string {
  const id = randomUUID();
  const used = (db.prepare('SELECT COUNT(*) AS n FROM pokemon WHERE save_id = ? AND box = 5').get(saveId) as { n: number }).n;
  db.prepare(`INSERT INTO pokemon (id, save_id, species_id, level, exp, current_hp, shiny, gender, ivs, moves, friendship, box, box_slot, caught_at)
              VALUES (?, ?, ?, ?, ?, 50, 0, NULL, ?, '[]', 70, 5, ?, ?)`)
    .run(id, saveId, speciesId, level, level ** 3, JSON.stringify({ hp: 10, atk: 10, def: 10, spa: 10, spd: 10, spe: 10 }), used, new Date().toISOString());
  return id;
}

test('evolução por pedra: aparece sem a pedra (bloqueada), evolui gastando 1 e não há evolução por amizade', async () => {
  const { save, url, mon } = await setup();
  species(mon.id, 25); // Pikachu
  let v = await view(url, mon.id);
  const raichu = v.evolutions.find((e) => e.speciesId === 26);
  assert.ok(raichu && !raichu.ready && raichu.item === 'thunder-stone');
  assert.equal((await call('POST', `${url}/pokemon/${mon.id}/evolve`, { speciesId: 26 })).status, 400);
  give(save.id, 'thunder-stone', 2);
  const done = await call<PokemonView>('POST', `${url}/pokemon/${mon.id}/evolve`, { speciesId: 26 });
  assert.equal(done.status, 201);
  assert.equal(done.json.speciesId, 26);
  assert.equal(qty(save.id, 'thunder-stone'), 1);

  species(mon.id, 133); // Eevee: só as pedras; Espeon/Umbreon (amizade) ficam de fora
  give(save.id, 'water-stone');
  v = await view(url, mon.id);
  const ids = v.evolutions.map((e) => e.speciesId);
  assert.ok(ids.includes(134) && v.evolutions.find((e) => e.speciesId === 134)?.ready);
  assert.ok(!ids.includes(196) && !ids.includes(197), 'sem evolução por amizade');
});

test('evolução por troca: Cabo de Ligação ou o objeto da troca; espécie de região bloqueada espera', async () => {
  const { save, url, mon } = await setup();
  species(mon.id, 64); // Kadabra
  give(save.id, 'linking-cord');
  assert.equal((await call<PokemonView>('POST', `${url}/pokemon/${mon.id}/evolve`, { speciesId: 65 })).json.speciesId, 65);
  assert.equal(qty(save.id, 'linking-cord'), 0);
  species(mon.id, 95); // Onix + Metal Coat → Steelix (Johto, ainda bloqueada): o objeto de troca vale, mas a região não
  give(save.id, 'metal-coat');
  const steelix = (await view(url, mon.id)).evolutions.find((e) => e.speciesId === 208);
  assert.ok(steelix && steelix.item === 'metal-coat' && !steelix.ready);
  db.prepare("INSERT INTO badges (save_id, challenge_id, won_at) VALUES (?, 'kanto:champion', '2026-01-01')").run(save.id);
  assert.equal((await call<PokemonView>('POST', `${url}/pokemon/${mon.id}/evolve`, { speciesId: 208 })).json.speciesId, 208, 'liberada ao vencer o campeão de Kanto');
  assert.equal(qty(save.id, 'metal-coat'), 0);
  db.prepare("DELETE FROM badges WHERE save_id = ?").run(save.id);
  species(mon.id, 315); // Roselia → Roserade (Sinnoh, ainda bloqueada)
  give(save.id, 'shiny-stone');
  const v = await view(url, mon.id);
  const roserade = v.evolutions.find((e) => e.speciesId === 407);
  assert.ok(roserade && !roserade.ready && /região/i.test(roserade.reason ?? ''));
  assert.equal((await call('POST', `${url}/pokemon/${mon.id}/evolve`, { speciesId: 407 })).status, 400);
  assert.equal(qty(save.id, 'shiny-stone'), 1, 'item não é gasto');
});

test('formas: Mega exige nível 60 e a pedra; muda tipos, sprite e atributos; G-Max dá +50% de HP', async () => {
  const { save, url, mon } = await setup();
  species(mon.id, 6, 59);
  give(save.id, 'charizardite-x');
  let v = await view(url, mon.id);
  const mega = v.forms.find((f) => f.name === 'charizard-mega-x');
  assert.ok(mega && !mega.ready && /nível 60/.test(mega.reason ?? ''));
  assert.equal((await call('POST', `${url}/pokemon/${mon.id}/transform`, { form: 'charizard-mega-x' })).status, 400);
  species(mon.id, 6, 60);
  const before = await view(url, mon.id);
  const done = await call<PokemonView>('POST', `${url}/pokemon/${mon.id}/transform`, { form: 'charizard-mega-x' });
  assert.equal(done.status, 201);
  assert.deepEqual(done.json.types, ['fire', 'dragon']);
  assert.equal(done.json.spriteId, 10034);
  assert.equal(done.json.form, 'charizard-mega-x');
  assert.ok(done.json.stats.atk > before.stats.atk);
  assert.equal(qty(save.id, 'charizardite-x'), 0);
  assert.deepEqual((await view(url, mon.id)).forms, [], 'já transformado');

  species(mon.id, 3, 30); // Venusaur
  const hp = (await view(url, mon.id)).stats.hp;
  give(save.id, 'gmax-stone');
  const gm = await call<PokemonView>('POST', `${url}/pokemon/${mon.id}/transform`, { form: 'venusaur-gmax' });
  assert.equal(gm.status, 201);
  assert.ok(gm.json.stats.hp >= Math.floor(hp * 1.5) - 1, 'HP máximo +50%');
});

test('fusão do Necrozma: parceiros precisam estar na coleção e continuam lá', async () => {
  const { save, url, mon } = await setup();
  species(mon.id, 800, 50);
  let v = await view(url, mon.id);
  const dusk = v.forms.find((f) => f.name === 'necrozma-dusk');
  assert.ok(dusk && !dusk.ready);
  const sol = addMon(save.id, 791);
  v = await view(url, mon.id);
  assert.ok(v.forms.find((f) => f.name === 'necrozma-dusk')?.ready);
  assert.ok(!v.forms.find((f) => f.name === 'necrozma-ultra')?.ready);
  assert.equal((await call<PokemonView>('POST', `${url}/pokemon/${mon.id}/transform`, { form: 'necrozma-dusk' })).status, 201);
  assert.ok(db.prepare('SELECT 1 FROM pokemon WHERE id = ?').get(sol), 'parceiro continua na coleção');
  addMon(save.id, 792);
  give(save.id, 'ultra-burst-stone');
  v = await view(url, mon.id);
  assert.ok(v.forms.find((f) => f.name === 'necrozma-ultra')?.ready, 'Ultra a partir da fusão com os dois parceiros e a pedra');
});

test('Essência de IV: +1 e não gasta se já está no máximo', async () => {
  const { save, url, mon } = await setup();
  db.prepare('UPDATE pokemon SET ivs = ? WHERE id = ?').run(JSON.stringify({ hp: 10, atk: 31, def: 10, spa: 10, spd: 10, spe: 10 }), mon.id);
  give(save.id, 'iv-speed', 1); give(save.id, 'iv-attack', 1);
  const ok = await call<UseItemResult>('POST', `${url}/items/use`, { item: 'iv-speed', pokemonId: mon.id });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.pokemon.ivs.spe, 11);
  assert.equal(qty(save.id, 'iv-speed'), 0);
  const maxed = await call('POST', `${url}/items/use`, { item: 'iv-attack', pokemonId: mon.id });
  assert.equal(maxed.status, 400);
  assert.equal(qty(save.id, 'iv-attack'), 1);
});

test('Doces: EXP fixo, Doce Raro sobe um nível, golpes novos e nível máximo', async () => {
  const { save, url, mon } = await setup();
  give(save.id, 'exp-candy-g', 1); give(save.id, 'rare-candy', 1);
  const big = await call<UseItemResult>('POST', `${url}/items/use`, { item: 'exp-candy-g', pokemonId: mon.id });
  assert.equal(big.status, 201);
  assert.ok(big.json.pokemon.level > mon.level);
  assert.equal(qty(save.id, 'exp-candy-g'), 0);
  const level = big.json.pokemon.level;
  const rare = await call<UseItemResult>('POST', `${url}/items/use`, { item: 'rare-candy', pokemonId: mon.id });
  assert.equal(rare.json.pokemon.level, level + 1);
  species(mon.id, 4, 100);
  give(save.id, 'rare-candy', 1);
  assert.equal((await call('POST', `${url}/items/use`, { item: 'rare-candy', pokemonId: mon.id })).status, 400);
  assert.equal(qty(save.id, 'rare-candy'), 1);
});

test('equipes nomeadas: salvar, montar (quem sai vai ao PC), renomear e apagar', async () => {
  const { save, url, mon } = await setup();
  const other = addMon(save.id, 25);
  assert.equal((await call('POST', `${url}/teams`, { name: '' })).status, 400);
  const first = (await call<TeamView[]>('POST', `${url}/teams`, { name: 'Inicial' })).json;
  assert.equal(first.length, 1);
  assert.ok(first[0]?.active);
  // monta uma equipe só com o Pikachu e salva
  await call('POST', `${url}/pokemon/${other}/move`, { to: { kind: 'team', slot: 1 } });
  await call('POST', `${url}/pokemon/${mon.id}/move`, { to: { kind: 'box', box: 0, slot: 0 } });
  const second = (await call<TeamView[]>('POST', `${url}/teams`, { name: 'Elétrica' })).json;
  assert.equal(second.length, 2);
  const initialId = (second.find((t) => t.name === 'Inicial') as TeamView).id;
  const applied = (await call<TeamView[]>('POST', `${url}/teams/${initialId}/apply`)).json;
  assert.ok(applied.find((t) => t.id === initialId)?.active);
  const team = (await call<SaveDetail>('GET', url)).json.team;
  assert.deepEqual(team.map((m) => m.id), [mon.id], 'só o inicial na equipe');
  assert.equal(db.prepare('SELECT team_slot FROM pokemon WHERE id = ?').get(other)?.team_slot, null);
  assert.ok(db.prepare('SELECT box FROM pokemon WHERE id = ?').get(other)?.box !== null, 'Pikachu foi para o PC');
  const renamed = (await call<TeamView[]>('PATCH', `${url}/teams/${initialId}`, { name: 'Fogo' })).json;
  assert.ok(renamed.some((t) => t.name === 'Fogo'));
  const left = (await call<TeamView[]>('DELETE', `${url}/teams/${initialId}`)).json;
  assert.equal(left.length, 1);
});
