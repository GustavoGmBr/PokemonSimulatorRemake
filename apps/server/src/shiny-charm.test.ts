import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MARKET_SHINY_DENOMINATOR, SHINY_ODDS, completedDexGenerations, generationOf, seededRng, type Rng } from '@pokesim/engine';
import { openDatabase, type Db } from './db.ts';
import { createPokemonStore } from './pokemon-store.ts';
import { createSaveService } from './saves.ts';
import { createInventory } from './inventory.ts';
import { createJournal } from './journal.ts';
import { createWildService } from './wild-service.ts';
import { createMarketService } from './market-service.ts';
import { shinyCharmGenerations } from './dex-progress.ts';

function complete(db: Db, saveId: string, first = 1, last = 151, caught = 1) {
  const insert = db.prepare('INSERT INTO pokedex (save_id, species_id, seen, caught) VALUES (?, ?, 1, ?) ON CONFLICT (save_id, species_id) DO UPDATE SET caught = excluded.caught');
  for (let id = first; id <= last; id++) insert.run(saveId, id, caught);
}

function setup() {
  const db = openDatabase(':memory:');
  const store = createPokemonStore(db);
  const saves = createSaveService(db, store);
  const save = saves.create({ trainerName: 'Dex', starterSpeciesId: 4 });
  const inventory = createInventory(db);
  const journal = createJournal(db);
  return { db, store, saves, save, inventory, journal };
}

test('Amuleto Brilhante exige capturas completas por geração e não afeta outros saves', () => {
  const { db, save, saves, inventory } = setup();
  try {
    complete(db, save.id);
    assert.deepEqual(shinyCharmGenerations(db, save.id), [], 'sem amuleto');
    inventory.add(save.id, 'shiny-charm', 1);
    assert.deepEqual(shinyCharmGenerations(db, save.id), [1]);
    complete(db, save.id, 152, 251, 0);
    assert.deepEqual(shinyCharmGenerations(db, save.id), [1], 'vistos não completam Johto');
    complete(db, save.id, 152, 250);
    assert.deepEqual(shinyCharmGenerations(db, save.id), [1], 'mítico #251 também é exigido');
    complete(db, save.id, 251, 251);
    assert.deepEqual(shinyCharmGenerations(db, save.id), [1, 2]);
    const other = saves.create({ trainerName: 'Outro', starterSpeciesId: 1 });
    inventory.add(other.id, 'shiny-charm', 1);
    assert.deepEqual(shinyCharmGenerations(db, other.id), []);
    assert.deepEqual(completedDexGenerations(new Set(Array.from({ length: 1025 }, (_, i) => i + 1))), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  } finally { db.close(); }
});

test('selvagens: sem dex o amuleto não ajuda; mapa misto aplica o bônus pela espécie sorteada', () => {
  const { db, store, save, inventory, journal } = setup();
  try {
    let rolls = 0;
    const base = seededRng(123);
    const rng: Rng = { int: (max) => max === SHINY_ODDS ? (rolls++, 1) : base.int(max) };
    const wild = createWildService(db, store, inventory, journal, rng);
    inventory.add(save.id, 'shiny-charm', 1);
    const first = wild.search(save.id, { region: 'kanto' });
    assert.equal(rolls, first.board!.slots.length);
    assert.deepEqual(first.shinyCharmGenerations, []);
    complete(db, save.id);
    db.prepare('INSERT INTO badges (save_id, challenge_id, won_at) VALUES (?, ?, ?)').run(save.id, 'kanto:champion', new Date().toISOString());
    const generations = new Set<number>();
    for (let i = 0; i < 12; i++) {
      rolls = 0;
      const state = wild.search(save.id, { region: 'all' });
      let expected = 0;
      for (const slot of state.board!.slots) {
        const gen = generationOf(slot.speciesId);
        generations.add(gen);
        expected += gen === 1 ? 3 : 1;
      }
      assert.equal(rolls, expected);
      assert.deepEqual(state.shinyCharmGenerations, [1]);
    }
    assert.deepEqual([...generations].sort(), [1, 2]);
  } finally { db.close(); }
});

test('mercado: o bônus depende da geração de cada oferta, mesmo para gerações bloqueadas', () => {
  const { db, store, save, inventory, journal } = setup();
  try {
    inventory.add(save.id, 'shiny-charm', 1);
    complete(db, save.id);
    let rolls = 0;
    const base = seededRng(42);
    const rng: Rng = { int: (max) => max === MARKET_SHINY_DENOMINATOR ? (rolls++, 1) : base.int(max) };
    const market = createMarketService(db, store, inventory, journal, () => 0, rng);
    const { stock } = market.state(save.id);
    assert.ok(stock.some((slot) => slot.generation === 1));
    assert.ok(stock.some((slot) => slot.generation !== 1));
    assert.equal(rolls, stock.reduce((sum, slot) => sum + (slot.generation === 1 ? 3 : 1), 0));
  } finally { db.close(); }
});

test('mapas de busca específica antigos passam a gerar encontros aleatórios ao girar', () => {
  const { db, store, save, inventory, journal } = setup();
  try {
    const wild = createWildService(db, store, inventory, journal, seededRng(123));
    wild.search(save.id, { region: 'kanto' });
    db.prepare('UPDATE wild_boards SET target_species = 25 WHERE save_id = ?').run(save.id);
    const next = wild.spin(save.id);
    assert.ok(next.board!.slots.some((slot) => slot.speciesId !== 25));
    assert.equal((db.prepare('SELECT target_species FROM wild_boards WHERE save_id = ?').get(save.id) as { target_species: number | null }).target_species, null);
    assert.throws(() => wild.search(save.id, { region: 'kanto', speciesId: 25 }), /não está mais disponível/);
  } finally { db.close(); }
});
