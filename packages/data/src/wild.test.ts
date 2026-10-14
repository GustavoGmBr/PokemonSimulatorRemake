import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from './index.ts';
import {
  applyHealItem, attemptCapture, ballMultiplier, captureChance, captureValue, evolutionStage, isWildEligible, maxStageForBadges,
  rollShiny, seededRng, shakeThreshold, wildLevelRange, type BallContext,
} from '@pokesim/engine';

const data = loadGameData();
const species = (id: number) => data.speciesById.get(id) as NonNullable<ReturnType<typeof data.speciesById.get>>;
const ctx: BallContext = { level: 20, types: ['normal'], baseSpeed: 50, caughtBefore: false, hour: 12 };
const base = { maxHp: 100, currentHp: 100, captureRate: 45, ball: 'poke-ball', context: ctx };

test('brilhante: cerca de 1 em 4096, e o amuleto aumenta a chance', () => {
  const rng = seededRng(42);
  let plain = 0;
  let charm = 0;
  const N = 400_000;
  for (let i = 0; i < N; i++) {
    if (rollShiny(rng)) plain++;
    if (rollShiny(rng, 2)) charm++;
  }
  assert.ok(plain > N / 4096 * 0.7 && plain < N / 4096 * 1.3, `sem amuleto: ${plain}`);
  assert.ok(charm > plain * 2, `com amuleto: ${charm} vs ${plain}`);
});

test('fórmula de captura: HP baixo e bolas melhores ajudam', () => {
  const full = captureChance(base);
  const weak = captureChance({ ...base, currentHp: 5 });
  const great = captureChance({ ...base, ball: 'great-ball' });
  const ultra = captureChance({ ...base, ball: 'ultra-ball' });
  assert.ok(full > 0 && full < 0.15, `bola comum, HP cheio: ${full}`);
  assert.ok(weak > full * 2);
  assert.ok(ultra > great && great > full);
  assert.equal(captureChance({ ...base, ball: 'master-ball' }), 1);
  assert.equal(captureValue({ ...base, captureRate: 255 }), 85);
  assert.equal(captureValue({ ...base, captureRate: 255, currentHp: 1 }), 253);
  assert.equal(captureValue({ ...base, captureRate: 255, ball: 'ultra-ball' }), 170);
  assert.equal(captureValue({ ...base, captureRate: 255, ball: 'ultra-ball', currentHp: 1 }), 255);
  assert.ok(captureChance({ ...base, statusMultiplier: 2 }) > full);
  assert.ok(captureChance({ ...base, catchingCharm: true }) > full);
  assert.ok(shakeThreshold(255) >= 65536 && shakeThreshold(30) < shakeThreshold(120));
});

test('bolas especiais olham tipo, nível, velocidade, hora e Pokédex', () => {
  assert.equal(ballMultiplier('net-ball', { ...ctx, types: ['water'] }), 3.5);
  assert.equal(ballMultiplier('net-ball', ctx), 1);
  assert.equal(ballMultiplier('nest-ball', { ...ctx, level: 5 }), 3.6);
  assert.equal(ballMultiplier('nest-ball', { ...ctx, level: 60 }), 1);
  assert.equal(ballMultiplier('repeat-ball', { ...ctx, caughtBefore: true }), 3.5);
  assert.equal(ballMultiplier('dusk-ball', { ...ctx, hour: 22 }), 3);
  assert.equal(ballMultiplier('dusk-ball', ctx), 1);
  assert.equal(ballMultiplier('fast-ball', { ...ctx, baseSpeed: 110 }), 4);
  assert.equal(ballMultiplier('quick-ball', ctx), 5);
  assert.equal(ballMultiplier('poke-ball', ctx), 1);
});

test('lançamento: master ball sempre captura; balanços ficam entre 0 e 3', () => {
  const rng = seededRng(7);
  assert.deepEqual(attemptCapture(rng, { ...base, ball: 'master-ball' }), { shakes: 3, caught: true });
  let caught = 0;
  const shakes = new Set<number>();
  for (let i = 0; i < 5000; i++) {
    const result = attemptCapture(rng, { ...base, ball: 'ultra-ball', captureRate: 120 });
    shakes.add(result.shakes);
    if (result.caught) caught++;
  }
  const expected = captureChance({ ...base, ball: 'ultra-ball', captureRate: 120 });
  assert.ok(Math.abs(caught / 5000 - expected) < 0.03, `${caught / 5000} vs ${expected}`);
  assert.deepEqual([...shakes].sort(), [0, 1, 2, 3]);
});

test('selvagens: estágio, nível e regiões liberadas', () => {
  assert.equal(evolutionStage(species(4)), 0);
  assert.equal(evolutionStage(species(5)), 1);
  assert.equal(evolutionStage(species(6)), 2);
  assert.equal(maxStageForBadges(0), 0);
  assert.equal(maxStageForBadges(2), 1);
  assert.equal(maxStageForBadges(5), 2);
  assert.deepEqual(wildLevelRange(0), [3, 12]);
  assert.deepEqual(wildLevelRange(8), [43, 52]);
  assert.ok(isWildEligible(species(25), ['kanto'], 0), 'Pikachu: o Pichu é de Johto, ainda fechada');
  assert.ok(!isWildEligible(species(25), ['kanto', 'johto'], 0));
  assert.ok(isWildEligible(species(25), ['kanto', 'johto'], 2));
  assert.ok(!isWildEligible(species(6), ['kanto'], 0), 'Charizard só com insígnias');
  assert.ok(isWildEligible(species(6), ['kanto'], 5));
  assert.ok(!isWildEligible(species(152), ['kanto'], 8), 'região não liberada');
  assert.ok(!isWildEligible(species(150), ['kanto'], 8), 'lendário bloqueado');
  assert.ok(!isWildEligible(species(151), ['kanto'], 8), 'mítico bloqueado');
});

test('itens de cura', () => {
  assert.deepEqual(applyHealItem('potion', 10, 100), { ok: true, newHp: 30, healed: 20 });
  assert.deepEqual(applyHealItem('potion', 90, 100), { ok: true, newHp: 100, healed: 10 });
  assert.equal(applyHealItem('potion', 100, 100).ok, false);
  assert.equal(applyHealItem('potion', 0, 100).ok, false);
  assert.deepEqual(applyHealItem('max-potion', 1, 80), { ok: true, newHp: 80, healed: 79 });
  assert.deepEqual(applyHealItem('revive', 0, 81), { ok: true, newHp: 40, healed: 40 });
  assert.deepEqual(applyHealItem('max-revive', 0, 81), { ok: true, newHp: 81, healed: 81 });
  assert.equal(applyHealItem('revive', 5, 81).ok, false);
  assert.equal(applyHealItem('poke-ball', 5, 81).ok, false);
});
