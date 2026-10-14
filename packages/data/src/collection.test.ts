import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from './index.ts';
import {
  defensiveMatchups, describeConditions, flattenEvolution, isValidLocation, matchesFilter, normalizeText, searchCollection,
  sortEntries, type CollectionEntry,
} from '@pokesim/engine';

const data = loadGameData();

function entry(patch: Partial<CollectionEntry> & { id: string }): CollectionEntry {
  return {
    speciesId: 1, name: 'Bulbasaur', speciesName: 'Bulbasaur', types: ['grass', 'poison'], generation: 1, shiny: false,
    ivStars: 3, ivTotal: 90, level: 10, favorite: false, caughtAt: '2026-01-01T00:00:00.000Z', ...patch,
  };
}

test('locais válidos: equipe 0–5, caixa com 30 vagas e índice sem teto prático', () => {
  assert.ok(isValidLocation({ kind: 'team', slot: 0 }));
  assert.ok(isValidLocation({ kind: 'team', slot: 5 }));
  assert.ok(!isValidLocation({ kind: 'team', slot: 6 }));
  assert.ok(!isValidLocation({ kind: 'team', slot: -1 }));
  assert.ok(isValidLocation({ kind: 'box', box: 0, slot: 29 }));
  assert.ok(isValidLocation({ kind: 'box', box: 4321, slot: 0 }));
  assert.ok(!isValidLocation({ kind: 'box', box: 0, slot: 30 }));
  assert.ok(!isValidLocation({ kind: 'box', box: -1, slot: 0 }));
  assert.ok(!isValidLocation({ kind: 'box', box: 1.5, slot: 0 }));
});

test('busca ignora acento, maiúscula e aceita número', () => {
  assert.equal(normalizeText('  Pokémon  '), 'pokemon');
  const mon = entry({ id: 'a', speciesId: 25, name: 'Zé', speciesName: 'Pikachu' });
  assert.ok(matchesFilter(mon, { text: 'ze' }));
  assert.ok(matchesFilter(mon, { text: 'PIKA' }));
  assert.ok(matchesFilter(mon, { text: '#25' }));
  assert.ok(!matchesFilter(mon, { text: 'char' }));
});

test('filtros de tipo, geração, shiny, estrelas, nível e favorito', () => {
  const list = [
    entry({ id: '1', types: ['fire'], generation: 1, level: 5, ivStars: 2 }),
    entry({ id: '2', types: ['water'], generation: 2, shiny: true, ivStars: 5, level: 50, favorite: true }),
    entry({ id: '3', types: ['water', 'flying'], generation: 3, level: 99, ivStars: 1 }),
  ];
  const ids = (filter: Parameters<typeof matchesFilter>[1]) => list.filter((e) => matchesFilter(e, filter)).map((e) => e.id);
  assert.deepEqual(ids({ type: 'water' }), ['2', '3']);
  assert.deepEqual(ids({ generation: 2 }), ['2']);
  assert.deepEqual(ids({ shiny: true }), ['2']);
  assert.deepEqual(ids({ shiny: false }), ['1', '3']);
  assert.deepEqual(ids({ minStars: 3 }), ['2']);
  assert.deepEqual(ids({ minLevel: 10, maxLevel: 60 }), ['2']);
  assert.deepEqual(ids({ favorite: true }), ['2']);
  assert.deepEqual(ids({ type: 'water', maxLevel: 60 }), ['2']);
});

test('ordenação é estável e desempata por número e id', () => {
  const list = [
    entry({ id: 'b', speciesId: 7, level: 10 }),
    entry({ id: 'a', speciesId: 7, level: 10 }),
    entry({ id: 'c', speciesId: 1, level: 10 }),
    entry({ id: 'd', speciesId: 4, level: 20 }),
  ];
  assert.deepEqual(sortEntries(list, 'level', 'desc').map((e) => e.id), ['d', 'c', 'a', 'b']);
  assert.deepEqual(sortEntries(list, 'level', 'asc').map((e) => e.id), ['c', 'a', 'b', 'd']);
  assert.deepEqual(sortEntries(list, 'dex', 'asc').map((e) => e.id), ['c', 'd', 'a', 'b']);
  assert.deepEqual(list.map((e) => e.id), ['b', 'a', 'c', 'd'], 'não altera a lista original');
  assert.deepEqual(searchCollection(list, { sort: 'level', dir: 'desc', minLevel: 15 }).map((e) => e.id), ['d']);
});

test('fraquezas e resistências por combinação de tipos', () => {
  const grassPoison = defensiveMatchups(data.typeChart, ['grass', 'poison']);
  assert.deepEqual([...grassPoison.double].sort(), ['fire', 'flying', 'ice', 'psychic']);
  assert.deepEqual(grassPoison.quadruple, []);
  assert.ok(grassPoison.quarter.includes('grass'));

  const steelGround = defensiveMatchups(data.typeChart, ['steel', 'ground']);
  assert.ok(steelGround.immune.includes('electric'));
  assert.ok(steelGround.immune.includes('poison'));
  assert.deepEqual(steelGround.quadruple, []);
  assert.ok(steelGround.double.includes('water') && steelGround.double.includes('fire'));
  assert.deepEqual(defensiveMatchups(data.typeChart, ['bug', 'grass']).quadruple, ['fire', 'flying']);

  const ghost = defensiveMatchups(data.typeChart, ['ghost']);
  assert.deepEqual(ghost.immune.sort(), ['fighting', 'normal']);
});

test('cadeia evolutiva vira linhas legíveis em português', () => {
  const charmander = data.speciesById.get(4);
  assert.ok(charmander);
  const rows = flattenEvolution(charmander.evolutionChain);
  assert.deepEqual(rows.map((r) => [r.depth, r.speciesId, r.requirement]), [[0, 4, ''], [1, 5, 'Nível 16'], [2, 6, 'Nível 36']]);

  const eevee = flattenEvolution((data.speciesById.get(133) as NonNullable<ReturnType<typeof data.speciesById.get>>).evolutionChain);
  assert.ok(eevee.length >= 9);
  assert.ok(eevee.some((r) => r.speciesId === 134 && /Usar/.test(r.requirement)));

  const machamp = flattenEvolution((data.speciesById.get(66) as NonNullable<ReturnType<typeof data.speciesById.get>>).evolutionChain);
  assert.equal(machamp.find((r) => r.speciesId === 68)?.requirement, 'Troca');
  assert.equal(describeConditions([]), '');
});

test('toda espécie tem cadeia que contém ela mesma', () => {
  for (const species of data.species) {
    const ids = flattenEvolution(species.evolutionChain).map((r) => r.speciesId);
    assert.ok(ids.includes(species.id), `#${species.id} ${species.displayName} fora da própria cadeia`);
  }
});
