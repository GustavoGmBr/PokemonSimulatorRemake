import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SLOT_LINES, WHEEL_LAYOUT, VOLTORB_CARDS, PIPLUP_ODDS, PIPLUP_PAYS, handValue, dealJack, finishJack, jackDouble, jackMultiplier, jackHit,
  newVoltorb, pokemonPrize, pokemonValue, roulettePayout, runRace, scoreLine, spinSlots, spinWheel, voltorbMultiplier, groupOf, colorOf,
  parseRouletteBet, seededRng, piplupJump, piplupMultiplier, RACE_RUNNERS, type Card, type JackState,
} from '@pokesim/engine';

test('caça-níqueis: 8 linhas, Ditto coringa e retorno médio perto de 93%', () => {
  assert.equal(SLOT_LINES.length, 8);
  assert.deepEqual(scoreLine(['mew', 'mew', 'mew']), { symbol: 'mew', multiplier: 50 });
  assert.deepEqual(scoreLine(['mew', 'ditto', 'mew']), { symbol: 'mew', multiplier: 50 }, 'um Ditto completa');
  assert.equal(scoreLine(['ditto', 'ditto', 'mewtwo'])?.multiplier, 1, 'dois Ditto devolvem a aposta da linha');
  assert.equal(scoreLine(['ditto', 'ditto', 'ditto'])?.multiplier, 4);
  assert.equal(scoreLine(['poke-ball', 'great-ball', 'poke-ball']), null);
  const rng = seededRng(11);
  let total = 0;
  const N = 200_000;
  for (let i = 0; i < N; i++) total += spinSlots(rng).multiplier;
  const rtp = total / N;
  assert.ok(rtp > 0.85 && rtp < 1.0, `retorno ${rtp}`);
});

test('roleta: pagamentos, zero fora de paridade/faixas/dúzias e grupos Pokémon', () => {
  assert.equal(roulettePayout({ kind: 'number', value: 17 }, 17), 36);
  assert.equal(roulettePayout({ kind: 'color', value: 'red' }, 1), 2);
  assert.equal(roulettePayout({ kind: 'color', value: 'green' }, 0), 36);
  assert.equal(roulettePayout({ kind: 'parity', value: 'even' }, 0), 0);
  assert.equal(roulettePayout({ kind: 'half', value: 'low' }, 18), 2);
  assert.equal(roulettePayout({ kind: 'half', value: 'low' }, 19), 0);
  assert.equal(roulettePayout({ kind: 'dozen', value: 2 }, 13), 3);
  assert.equal(roulettePayout({ kind: 'group', value: 'mew' }, 0), 4);
  assert.equal(groupOf(1), 'charmander');
  assert.equal(groupOf(2), 'pikachu');
  assert.equal(groupOf(12), 'bulbasaur');
  assert.equal(groupOf(11), 'squirtle');
  assert.equal([...Array(37).keys()].filter((n) => colorOf(n) === 'red').length, 18);
  assert.equal(parseRouletteBet({ kind: 'number', value: 40 }), null);
  assert.equal(parseRouletteBet({ kind: 'dozen', value: 2 })?.kind, 'dozen');
});

test('Voltorb Flip: 36 cartas com a distribuição certa e bônus de linha', () => {
  assert.equal(VOLTORB_CARDS.length, 36);
  assert.equal(VOLTORB_CARDS.filter((c) => c === 0).length, 6);
  const board = newVoltorb(seededRng(5));
  assert.deepEqual([...board].sort(), [...VOLTORB_CARDS].sort());
  const flat = Array<number>(36).fill(1);
  assert.equal(voltorbMultiplier({ stake: 10, board: flat, revealed: [0, 7, 14] }), 3);
  assert.equal(voltorbMultiplier({ stake: 10, board: flat, revealed: [0, 1, 2, 3, 4, 5] }), 9, 'linha completa ×1,5');
  assert.equal(voltorbMultiplier({ stake: 10, board: flat, revealed: [0, 6, 12, 18, 24, 30] }), 9, 'coluna completa ×1,5');
  assert.equal(voltorbMultiplier({ stake: 10, board: flat, revealed: [0, 7, 14, 21, 28, 35] }), 6, 'diagonal não conta');
});

const card = (rank: string): Card => ({ rank, suit: '♠' });
function fixed(player: string[], dealer: string[], rest: string[] = []): JackState {
  return { stake: 10, deck: [...rest].reverse().map(card), player: player.map(card), dealer: dealer.map(card), doubled: false, done: false, result: null };
}

test('Pokejack: ás, natural 3×, banca para em 17, empate devolve, dobrar paga o dobro', () => {
  assert.deepEqual(handValue([card('A'), card('K')]), { total: 21, soft: true });
  assert.equal(handValue([card('A'), card('A'), card('9')]).total, 21);
  assert.equal(handValue([card('K'), card('Q'), card('5')]).total, 25);
  let s = fixed(['A', 'K'], ['9', '8']); finishJack(s);
  assert.equal(jackMultiplier(s), 3);
  s = fixed(['10', '8'], ['10', '7']); finishJack(s);
  assert.equal(s.result, 'win'); assert.equal(jackMultiplier(s), 2);
  s = fixed(['10', '7'], ['10', '7']); finishJack(s);
  assert.equal(jackMultiplier(s), 1);
  s = fixed(['10', '6'], ['10', '6'], ['5', 'K']); jackHit(s); // 21? 10+6+5 = 21: encerra e a banca fica em 16 → compra
  assert.ok(s.done);
  s = fixed(['5', '6'], ['10', '7'], ['K']); jackDouble(s); // 5+6+10 = 21 contra 17
  assert.equal(s.result, 'win'); assert.equal(jackMultiplier(s), 4);
  s = fixed(['10', '6'], ['10', '7'], ['K']); jackHit(s);
  assert.equal(s.result, 'lose'); assert.equal(jackMultiplier(s), 0);
  const dealt = dealJack(10, seededRng(2));
  assert.equal(dealt.player.length, 2);
  assert.equal(dealt.deck.length, 48);
});

test('Pokémon Race: cinco corredores, sempre há um vencedor e as chances são parecidas', () => {
  const rng = seededRng(9);
  const wins = Array<number>(5).fill(0);
  for (let i = 0; i < 4000; i++) {
    const race = runRace(rng);
    assert.ok(race.winner >= 0 && race.winner < RACE_RUNNERS.length);
    assert.ok(race.frames.at(-1)?.some((p) => p >= 100));
    wins[race.winner] = (wins[race.winner] as number) + 1;
  }
  for (const w of wins) assert.ok(w > 4000 * 0.14 && w < 4000 * 0.26, `vitórias ${wins}`);
});

test('Wheel of Fortune: 50 casas com as fatias 20/18/18/20/16/6/2%', () => {
  assert.equal(WHEEL_LAYOUT.length, 50);
  const share = (m: number) => WHEEL_LAYOUT.filter((x) => x === m).length * 2;
  assert.deepEqual([0, 0.25, 0.5, 1, 2, 5, 10].map(share), [20, 18, 18, 20, 16, 6, 2]);
  const spin = spinWheel(seededRng(1));
  assert.equal(WHEEL_LAYOUT[spin.index], spin.multiplier);
});

test('Pula Piplup: sete saltos, retorno acumulado e queda perde tudo', () => {
  assert.deepEqual([...PIPLUP_PAYS], [1, 1.1, 1.5, 2, 2.5, 3.5, 5]);
  assert.deepEqual([...PIPLUP_ODDS], [90, 85, 80, 80, 75, 70, 65]);
  assert.equal(piplupMultiplier(0), 0);
  assert.equal(piplupMultiplier(7), 5);
  const state = { stake: 10, jumps: 0 };
  let falls = 0;
  const rng = seededRng(4);
  for (let i = 0; i < 100; i++) { state.jumps = 0; while (state.jumps < 7) { if (piplupJump(state, rng) === 'fall') { falls++; break; } } }
  assert.ok(falls > 70, 'chegar ao 7º salto é raro (~17%)');
});

test('aposta de Pokémon: só há prêmio acima de 1× e o valor segue o mercado antigo', () => {
  assert.equal(pokemonPrize(10_000, 0.5), 0);
  assert.equal(pokemonPrize(10_000, 1), 0);
  assert.equal(pokemonPrize(10_000, 3), 20_000);
  const base = { level: 30, ball: 'poke-ball', ballPrice: 200, legendary: false, shiny: false, ivMultiplier: 1 };
  assert.equal(pokemonValue(base), 100 + 300);
  assert.equal(pokemonValue({ ...base, shiny: true, legendary: true, ivMultiplier: 2 }), 400 * 3 * 10 * 2);
  assert.equal(pokemonValue({ ...base, ball: 'master-ball' }), 600);
});
