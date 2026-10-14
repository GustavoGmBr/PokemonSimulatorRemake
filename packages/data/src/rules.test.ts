import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from './index.ts';
import {
  calcStats, createPokemon, effectiveness, expForLevel, ivQuality, levelForExp, levelUpMoves,
  perfectIvs, rollIvs, seededRng, stageMultiplier, REGIONS, generationOf,
} from '@pokesim/engine';

const data = loadGameData();
const species = (id: number) => {
  const entry = data.speciesById.get(id);
  assert.ok(entry, `espécie ${id}`);
  return entry;
};

test('atributos seguem a fórmula clássica (Pikachu nv 50, IVs 31)', () => {
  const stats = calcStats(species(25).baseStats, 50, perfectIvs());
  assert.deepEqual(stats, { hp: 110, atk: 75, def: 60, spa: 70, spd: 70, spe: 110 });
});

test('shiny ganha +50% em todos os atributos', () => {
  const normal = calcStats(species(25).baseStats, 50, perfectIvs());
  const shiny = calcStats(species(25).baseStats, 50, perfectIvs(), true);
  assert.equal(shiny.atk, Math.floor(normal.atk * 1.5));
});

test('estágios de atributo', () => {
  assert.equal(stageMultiplier(0), 1);
  assert.equal(stageMultiplier(2), 2);
  assert.equal(stageMultiplier(-2), 0.5);
  assert.equal(stageMultiplier(9), 4);
});

test('qualidade dos IVs e estrelas', () => {
  assert.equal(ivQuality(perfectIvs()).stars, 4);
  assert.equal(ivQuality({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }).stars, 0);
  assert.equal(ivQuality({ hp: 26, atk: 26, def: 26, spa: 26, spd: 26, spe: 26 }).stars, 3);
});

test('efetividade de tipos', () => {
  const chart = data.typeChart;
  assert.equal(effectiveness(chart, 'electric', ['water', 'flying']), 4);
  assert.equal(effectiveness(chart, 'electric', ['ground']), 0);
  assert.equal(effectiveness(chart, 'fire', ['water']), 0.5);
  assert.equal(effectiveness(chart, 'fighting', ['normal', 'ghost']), 0);
});

test('curvas de experiência batem com a tabela do catálogo antigo', () => {
  assert.equal(expForLevel('medium-slow', 5), 135);
  assert.equal(expForLevel('medium', 100), 1_000_000);
  assert.equal(expForLevel('slow-then-very-fast', 100), 600_000);
  assert.equal(expForLevel('fast-then-very-slow', 100), 1_640_000);
  assert.equal(levelForExp('medium-slow', 135), 5);
  assert.equal(levelForExp('medium-slow', 134), 4);
});

test('golpes iniciais do Charmander nv 5', () => {
  const moves = levelUpMoves(species(4), 5, data.movesByName).map((move) => move.name);
  assert.ok(moves.includes('scratch'));
  assert.ok(moves.length >= 2 && moves.length <= 4);
});

test('criar Pokémon é determinístico com a mesma semente', () => {
  const a = createPokemon({ species: species(1), level: 5, rng: seededRng(42), moves: data.movesByName });
  const b = createPokemon({ species: species(1), level: 5, rng: seededRng(42), moves: data.movesByName });
  assert.deepEqual(a, b);
  assert.equal(a.exp, 135);
  assert.equal(a.currentHp, calcStats(species(1).baseStats, 5, a.ivs).hp);
});

test('IVs aleatórios ficam entre 0 e 31', () => {
  const rng = seededRng(7);
  for (let i = 0; i < 200; i++) {
    for (const value of Object.values(rollIvs(rng))) assert.ok(value >= 0 && value <= 31);
  }
});

test('regiões cobrem a Pokédex inteira e os iniciais existem', () => {
  assert.equal(generationOf(1), 1);
  assert.equal(generationOf(1025), 9);
  for (const region of REGIONS) {
    for (const id of region.starters) assert.equal(species(id).generation, region.generation);
  }
});

test('catálogo completo', () => {
  assert.equal(data.species.length, 1025);
  assert.equal(data.types.length, 18);
  assert.ok(species(6).forms.some((form) => form.kind === 'mega'));
});
