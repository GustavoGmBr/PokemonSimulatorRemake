import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRIME_ITEM_POOL, rollPrizeItems, seededRng, tournamentTier, type Rng } from '@pokesim/engine';
import { loadGameData } from './index.ts';

const total = (items: { quantity: number }[]) => items.reduce((sum, item) => sum + item.quantity, 0);

test('Copa Prime inclui todos os consumíveis pedidos; especiais ficam fora do sorteio comum', () => {
  const eligible = loadGameData().items.filter((item) =>
    ['captura', 'cura', 'treino', 'ivs'].includes(item.category) && item.name !== 'master-ball');
  assert.deepEqual([...PRIME_ITEM_POOL].sort(), eligible.map((item) => item.name).sort());
  assert.ok(!PRIME_ITEM_POOL.includes('shiny-stone'));
});

for (const id of ['copa-prime', 'dupla-copa-prime']) {
  test(`${id}: limites de 10 e 20 incluem os especiais, com chance exata e independente`, () => {
    const tier = tournamentTier(id)!;
    for (const count of [10, 20]) {
      for (const rolls of [[19, 19], [19, 20], [20, 19], [20, 20]]) {
        let special = 0;
        const rng: Rng = { int: (max) => max === 100 ? rolls[special++]! : max === 11 ? count - 10 : 0 };
        const items = rollPrizeItems(tier, rng);
        assert.equal(total(items), count);
        assert.equal(items.find((item) => item.item === 'master-ball')?.quantity ?? 0, rolls[0]! < 20 ? 1 : 0);
        assert.equal(items.find((item) => item.item === 'shiny-stone')?.quantity ?? 0, rolls[1]! < 20 ? 1 : 0);
        assert.equal(special, 2);
      }
    }
  });

  test(`${id}: 10.000 premiações respeitam o total, agrupam repetidos e cobrem todo o catálogo`, () => {
    const tier = tournamentTier(id)!;
    const rng = seededRng(12345);
    const seen = new Set<string>();
    let master = 0;
    let stone = 0;
    for (let i = 0; i < 10_000; i++) {
      const items = rollPrizeItems(tier, rng);
      assert.ok(total(items) >= 10 && total(items) <= 20);
      assert.equal(new Set(items.map((item) => item.item)).size, items.length);
      for (const item of items) {
        assert.ok(Number.isInteger(item.quantity) && item.quantity > 0);
        seen.add(item.item);
        if (item.item === 'master-ball') master++;
        if (item.item === 'shiny-stone') stone++;
      }
    }
    assert.deepEqual([...seen].sort(), [...PRIME_ITEM_POOL, 'master-ball', 'shiny-stone'].sort());
    assert.ok(master > 1800 && master < 2200, `Master Ball: ${master}`);
    assert.ok(stone > 1800 && stone < 2200, `Pedra Brilhante: ${stone}`);
    assert.deepEqual(rollPrizeItems(tier, seededRng(42)), rollPrizeItems(tier, seededRng(42)));
  });
}
