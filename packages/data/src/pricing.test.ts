import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ivQuality, marketPrice, saleValue, type Stats } from '@pokesim/engine';

const base = { ball: 'poke-ball', legendary: false, shiny: false, ivMultiplier: 1 };

test('valor de venda: bola + 10 ₽ por nível (Master Bola: 20 ₽ por nível)', () => {
  assert.equal(saleValue({ ...base, level: 1 }), 110);
  assert.equal(saleValue({ ...base, ball: 'great-ball', level: 1 }), 310);
  assert.equal(saleValue({ ...base, ball: 'ultra-ball', level: 1 }), 610);
  assert.equal(saleValue({ ...base, ball: 'master-ball', level: 50 }), 1000);
  assert.equal(saleValue({ ...base, ball: null, level: 10 }), 200, 'sem bola registrada conta como Poké Bola');
});

test('valor de venda: itens investidos, lendário ×3, shiny ×10, IVs e arredondamento para baixo', () => {
  assert.equal(saleValue({ ...base, level: 50, invested: 400 }), 1000);
  assert.equal(saleValue({ ...base, level: 50, legendary: true }), 1800);
  assert.equal(saleValue({ ...base, level: 50, shiny: true }), 6000);
  assert.equal(saleValue({ ...base, level: 50, legendary: true, shiny: true }), 18000);
  assert.equal(saleValue({ ...base, level: 50, ivMultiplier: 2 }), 1200);
  assert.equal(saleValue({ ...base, level: 1, ivMultiplier: 1.5 }), 165);
  assert.equal(saleValue({ ...base, level: 3, ivMultiplier: 1.5 }), 195, '130 × 1,5');
  assert.equal(saleValue({ ...base, level: 3, ivMultiplier: 1.5, invested: 1 }), 196, '(130 + 1) × 1,5 = 196,5 → 196');
});

test('exemplo da regra: comum, nível 50, Poké Bola e 3 estrelas vale 900 ₽', () => {
  const ivs3: Stats = { hp: 28, atk: 28, def: 28, spa: 28, spd: 28, spe: 28 }; // 168 = 3★
  const quality = ivQuality(ivs3);
  assert.equal(quality.stars, 3);
  assert.equal(saleValue({ ...base, level: 50, ivMultiplier: quality.valueMultiplier }), 900);
});

test('multiplicador de IVs: até 2★ ×1, 3★ ×1,5, 4★ ×2', () => {
  const total = (value: number): Stats => ({ hp: value, atk: value, def: value, spa: value, spd: value, spe: value });
  assert.equal(ivQuality(total(10)).valueMultiplier, 1);
  assert.equal(ivQuality(total(21)).stars, 2);
  assert.equal(ivQuality(total(21)).valueMultiplier, 1);
  assert.equal(ivQuality(total(26)).valueMultiplier, 1.5);
  assert.equal(ivQuality(total(31)).stars, 4);
  assert.equal(ivQuality(total(31)).valueMultiplier, 2);
});

test('Mercado Pokémon: ₽ 10.000, região bloqueada ×2, shiny ×5, 3★ ×1,5, 4★ ×2', () => {
  assert.equal(marketPrice(true, false, 2), 10_000);
  assert.equal(marketPrice(false, false, 2), 20_000);
  assert.equal(marketPrice(true, true, 2), 50_000);
  assert.equal(marketPrice(true, false, 3), 15_000);
  assert.equal(marketPrice(true, false, 4), 20_000);
  assert.equal(marketPrice(false, true, 4), 200_000);
});
