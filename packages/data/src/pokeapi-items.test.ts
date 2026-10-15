import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from './index.ts';

/** Itens inventados deste jogo (não existem no PokéAPI). */
const CUSTOM = /^(exp-candy-(p|g|gg)|iv-.+|gmax-stone|ultra-burst-stone|.+ite)$/;

test('catálogo do PokéAPI: completo, sem duplicatas e com dados básicos', () => {
  const { pokeapiItems } = loadGameData();
  assert.ok(pokeapiItems.length > 2000);
  assert.equal(new Set(pokeapiItems.map((i) => i.name)).size, pokeapiItems.length);
  assert.equal(new Set(pokeapiItems.map((i) => i.id)).size, pokeapiItems.length);
  const ball = pokeapiItems.find((i) => i.name === 'poke-ball');
  assert.equal(ball?.en, 'Poké Ball');
  assert.equal(ball?.cost, 200);
  assert.equal(ball?.pocket, 'pokeballs');
  assert.ok(ball?.effect);
  assert.ok(pokeapiItems.some((i) => i.name === 'thunder-stone'));
});

test('itens do jogo existem no PokéAPI, exceto os inventados', () => {
  const { items, pokeapiItems } = loadGameData();
  const names = new Set(pokeapiItems.map((i) => i.name));
  const missing = items.filter((item) => !names.has(item.name) && !CUSTOM.test(item.name)).map((item) => item.name);
  assert.deepEqual(missing, []);
});
