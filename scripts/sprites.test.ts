import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { downloadSprites, planSprites, looksLikeImage } from './sprites.ts';
import { remoteSpriteUrl, pokemonSpriteSources } from '@pokesim/engine';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 1, 2, 3]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0]);

function fakeFetch(missing: (url: string) => boolean = () => false, calls: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (missing(url)) return new Response('nope', { status: 404 });
    return new Response(url.endsWith('.gif') ? GIF : PNG, { status: 200 });
  }) as typeof fetch;
}

test('cada espécie tem 10 imagens (5 vistas × normal/shiny); animações só até a Geração V', () => {
  assert.equal(pokemonSpriteSources(25).length, 10);
  assert.equal(pokemonSpriteSources(700).length, 6);
  assert.ok(pokemonSpriteSources(25).some((s) => s.file === 'pokemon/25-animatedBackShiny.gif'
    && s.url.endsWith('/versions/generation-v/black-white/animated/back/shiny/25.gif')));
  assert.equal(planSprites([1, 2], ['potion'], 'basico').length, 8 + 1);
});

test('remoteSpriteUrl só aceita os nomes que o jogo gera', () => {
  assert.match(remoteSpriteUrl('pokemon/6-frontShiny.png')!, /sprites\/pokemon\/shiny\/6\.png$/);
  assert.match(remoteSpriteUrl('items/exp-candy-p.png')!, /items\/exp-candy-xs\.png$/);
  assert.equal(remoteSpriteUrl('../../etc/passwd'), null);
  assert.equal(remoteSpriteUrl('pokemon/6-front.exe'), null);
  assert.equal(remoteSpriteUrl('items/../x.png'), null);
});

test('imagens só são aceitas com a assinatura correta', () => {
  assert.ok(looksLikeImage('a.png', PNG));
  assert.ok(looksLikeImage('a.gif', GIF));
  assert.ok(!looksLikeImage('a.png', new TextEncoder().encode('<html>erro 500</html>')));
});

test('baixa o que falta, pula o que existe e não repete o que não existe na origem', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sprites-'));
  mkdirSync(path.join(dir, 'pokemon'));
  writeFileSync(path.join(dir, 'pokemon/1-front.png'), PNG);
  const calls: string[] = [];
  const notAnimated = (url: string) => url.endsWith('.gif');
  const first = await downloadSprites({ assetsDir: dir, speciesIds: [1], itemNames: ['potion'], fetchImpl: fakeFetch(notAnimated, calls), concurrency: 4, retries: 0 });
  assert.equal(first.alreadyThere, 1);
  assert.equal(first.unavailable, 4);
  assert.equal(first.failed, 0);
  assert.equal(first.downloaded, 10 - 1 - 4 + 1);
  assert.ok(existsSync(path.join(dir, 'pokemon/1-artworkShiny.png')));
  assert.ok(existsSync(path.join(dir, 'items/potion.png')));
  assert.ok(!readdirTemp(dir).some((name) => name.endsWith('.part')));

  const before = calls.length;
  const second = await downloadSprites({ assetsDir: dir, speciesIds: [1], itemNames: ['potion'], fetchImpl: fakeFetch(notAnimated, calls), retries: 0 });
  assert.equal(calls.length, before, 'segunda execução não deve consultar a rede');
  assert.equal(second.downloaded, 0);
  assert.equal(second.unavailable, 4);
});

test('falhas de rede são contadas e tentadas de novo na próxima execução', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sprites-'));
  let online = false;
  const flaky = (async () => (online ? new Response(PNG, { status: 200 }) : new Response('x', { status: 503 }))) as typeof fetch;
  const first = await downloadSprites({ assetsDir: dir, speciesIds: [700], itemNames: [], fetchImpl: flaky, retries: 1 });
  assert.equal(first.failed, 6);
  online = true;
  const second = await downloadSprites({ assetsDir: dir, speciesIds: [700], itemNames: [], fetchImpl: flaky, retries: 0 });
  assert.equal(second.failed, 0);
  assert.equal(second.downloaded, 6);
  assert.equal(readFileSync(path.join(dir, 'pokemon/700-front.png')).length, PNG.length);
});

test('sem internet: desiste depois de várias falhas seguidas em vez de insistir em milhares de arquivos', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sprites-'));
  let calls = 0;
  const offline = (async () => { calls++; throw new TypeError('fetch failed'); }) as typeof fetch;
  const ids = Array.from({ length: 100 }, (_, i) => 700 + i);
  const result = await downloadSprites({ assetsDir: dir, speciesIds: ids, itemNames: [], fetchImpl: offline, retries: 0, giveUpAfter: 10, concurrency: 4 });
  assert.equal(result.gaveUp, true);
  assert.ok(calls < 40, `tentou ${calls} vezes`);
  assert.equal(result.downloaded, 0);
});

function readdirTemp(dir: string): string[] {
  return readdirSync(dir, { recursive: true }) as string[];
}
