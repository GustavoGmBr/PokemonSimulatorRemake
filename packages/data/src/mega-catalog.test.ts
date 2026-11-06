import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from './index.ts';
import { remoteSpriteUrl, SHOP_CATEGORIES } from '@pokesim/engine';

test('todas as Megas têm pedra comprável e rota de sprite válida', () => {
  const data = loadGameData();
  const megas = data.species.flatMap((species) => species.forms.filter((form) => form.kind === 'mega'));
  assert.equal(megas.length, 97);
  for (const form of megas) {
    const stone = data.itemsByName.get(form.requiredItem!);
    assert.ok(stone && stone.price !== null && stone.price > 0, form.name);
    assert.ok((SHOP_CATEGORIES as readonly string[]).includes(stone.category), form.name);
    assert.ok(remoteSpriteUrl(`pokemon/${form.spriteId}-front.png`), form.name);
  }
});
