import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from './index.ts';
import {
  REGIONS, TRAINER_DIFFICULTIES, activeOf, challengeLockReason, challengeUnlocked, chooseAction, combatantFrom, createBattle, createPokemon, evolutionStage,
  isLegendary, leaderBag, leaderSkill, rollTrainer, seededRng, unlockedRegionIds,
  type BattleContext, type BattleState, type Combatant, type TrainerInfo,
} from '@pokesim/engine';

const data = loadGameData();
const ctx: BattleContext = { species: (id) => data.speciesById.get(id) as never, moves: data.movesByName, chart: data.typeChart };

function mon(speciesId: number, level: number, moveNames: string[], seed = 1): Combatant {
  const species = data.speciesById.get(speciesId) as NonNullable<ReturnType<typeof data.speciesById.get>>;
  const instance = createPokemon({ species, level, rng: seededRng(seed), moves: data.movesByName });
  instance.moves = moveNames.map((name) => ({ name, pp: 10, maxPp: 10 }));
  return combatantFrom(instance, species, species.displayName);
}

const trainer = (patch: Partial<TrainerInfo> = {}): TrainerInfo => ({ name: 'Teste', title: 'Líder', skill: 3, bag: [], lastSwitch: -9, ...patch });

test('dados: 9 regiões com 8 ginásios, 4 da Elite e campeão (Unova tem 2 circuitos)', () => {
  assert.equal(data.challenges.length, 9 * 13 + 13);
  for (const region of REGIONS) {
    const own = data.challenges.filter((c) => c.region === region.id);
    assert.ok(own.length >= 13, region.id);
  }
  assert.equal(data.challenges.filter((c) => c.circuit === 'unova2').length, 13);
  for (const challenge of data.challenges) for (const id of challenge.team) assert.ok(data.speciesById.has(id), `${challenge.id} #${id}`);
  const brock = data.challengesById.get('kanto:gym1');
  assert.deepEqual([brock?.name, brock?.level, brock?.team], ['Brock', 15, [74, 95]]);
  assert.equal(data.challengesById.get('kanto:champion')?.team.length, 6);
  assert.equal(data.challengesById.get('galar:elite1')?.group, 'Copa dos Campeões');
  assert.equal(data.challengesById.get('alola:gym1')?.group, 'Prova Insular');
  assert.equal(data.challengesById.get('paldea:champion')?.level, 100);
});

test('desbloqueio: ginásios livres, Elite em ordem depois dos 8, campeão por último', () => {
  const gym = (id: string) => data.challengesById.get(id) as NonNullable<ReturnType<typeof data.challengesById.get>>;
  const none = new Set<string>();
  assert.ok(challengeUnlocked(gym('kanto:gym5'), none), 'qualquer ginásio de Kanto');
  assert.ok(!challengeUnlocked(gym('johto:gym1'), none), 'Johto bloqueada');
  assert.match(challengeLockReason(gym('johto:gym1'), none) ?? '', /campeão/);
  assert.ok(!challengeUnlocked(gym('kanto:elite1'), none));
  const gyms = new Set(Array.from({ length: 8 }, (_, i) => `kanto:gym${i + 1}`));
  assert.ok(challengeUnlocked(gym('kanto:elite1'), gyms));
  assert.ok(!challengeUnlocked(gym('kanto:elite2'), gyms), 'em ordem');
  const e1 = new Set([...gyms, 'kanto:elite1']);
  assert.ok(challengeUnlocked(gym('kanto:elite2'), e1));
  assert.ok(!challengeUnlocked(gym('kanto:champion'), e1));
  const all = new Set([...gyms, 'kanto:elite1', 'kanto:elite2', 'kanto:elite3', 'kanto:elite4']);
  assert.ok(challengeUnlocked(gym('kanto:champion'), all));
  assert.ok(challengeUnlocked(gym('johto:gym1'), new Set(['kanto:champion'])), 'campeão abre a próxima região');
});

test('Unova: o 2º circuito abre com o campeão do 1º; Kalos pede os dois campeões', () => {
  const gym = (id: string) => data.challengesById.get(id) as NonNullable<ReturnType<typeof data.challengesById.get>>;
  const upToUnova = ['kanto', 'johto', 'hoenn', 'sinnoh'].map((r) => `${r}:champion`);
  const won = new Set(upToUnova);
  assert.ok(challengeUnlocked(gym('unova:gym1'), won));
  assert.ok(!challengeUnlocked(gym('unova2:gym1'), won));
  won.add('unova:champion');
  assert.ok(challengeUnlocked(gym('unova2:gym1'), won));
  assert.ok(!unlockedRegionIds([...won]).includes('kalos'));
  won.add('unova2:champion');
  assert.ok(unlockedRegionIds([...won]).includes('kalos'));
});

test('treinadores aleatórios: equipe, nível, pool e prêmios por dificuldade', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rng = seededRng(seed);
    const easy = rollTrainer('facil', data.species, rng);
    assert.ok(easy.team.length >= 2 && easy.team.length <= 3);
    assert.equal(new Set(easy.team.map((m) => m.speciesId)).size, easy.team.length, 'sem repetir');
    for (const m of easy.team) {
      const species = data.speciesById.get(m.speciesId) as never as { baseStats: Record<string, number>; legendary: boolean; mythical: boolean; id: number; evolutionChain: never };
      assert.ok(m.level >= 20 && m.level <= 30);
      assert.ok(!isLegendary(species));
      assert.equal(evolutionStage(species), 0);
      assert.ok(Object.values(species.baseStats).reduce((a, b) => a + b, 0) <= 400);
    }
    assert.equal(easy.money, 1000);
    const mid = rollTrainer('medio', data.species, rng);
    assert.ok(mid.team.length >= 3 && mid.team.length <= 4 && mid.team.every((m) => m.level >= 40 && m.level <= 50));
    const hard = rollTrainer('dificil', data.species, rng);
    assert.equal(hard.team.length, 6);
    assert.ok(hard.team.every((m) => m.level === 100));
    assert.equal(hard.money, 10000);
  }
  assert.deepEqual(TRAINER_DIFFICULTIES.dificil.rewards.map((r) => r.item), ['ultra-ball', 'hyper-potion', 'revive']);
  assert.ok(leaderSkill({ kind: 'champion', number: 1 }) === 3 && leaderSkill({ kind: 'gym', number: 1 }) === 1);
  assert.equal(leaderBag({ kind: 'gym', number: 1 }).length, 0);
});

test('batalha de treinador: não foge, envia o próximo e dá XP 1,5x', () => {
  const { state } = createBattle({
    player: [mon(6, 60, ['flamethrower'])], foe: [mon(19, 5, ['tackle']), mon(16, 5, ['tackle'])], seed: 3, kind: 'trainer', trainer: trainer({ skill: 1 }),
  });
  assert.throws(() => chooseAction(state, { kind: 'run' }, ctx), /fugir/);
  const first = chooseAction(state, { kind: 'move', slot: 0 }, ctx);
  assert.ok(first.events.some((e) => e.k === 'send' && e.side === 'foe' && e.text.includes('Teste enviou')), 'próximo Pokémon entra');
  assert.equal(first.state.phase, 'choose');
  const second = chooseAction(first.state, { kind: 'move', slot: 0 }, ctx);
  assert.equal(second.state.result, 'win');
  const wild = createBattle({ player: [mon(6, 60, ['flamethrower'])], foe: [mon(19, 5, ['tackle'])], seed: 3 });
  const wildEnd = chooseAction(wild.state, { kind: 'move', slot: 0 }, ctx);
  const xp = (events: typeof first.events) => events.filter((e) => e.k === 'xp').reduce((n, e) => n + (e.k === 'xp' ? e.amount : 0), 0);
  assert.equal(xp(first.events), Math.floor(Math.floor((data.speciesById.get(19)!.baseExp * 5) / 7) * 1.5));
  assert.equal(xp(wildEnd.events), Math.floor((data.speciesById.get(19)!.baseExp * 5) / 7));
});

test('Pokémon reduzido pelo limite do desafio não ganha XP', () => {
  const lead = mon(6, 30, ['flamethrower']);
  lead.capped = true;
  const { state } = createBattle({ player: [lead], foe: [mon(19, 5, ['tackle'])], seed: 3, kind: 'trainer', trainer: trainer() });
  const r = chooseAction(state, { kind: 'move', slot: 0 }, ctx);
  assert.equal(r.state.result, 'win');
  assert.ok(!r.events.some((e) => e.k === 'xp'));
});

test('IA: escolhe o golpe mais eficaz (não só o de maior poder)', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const { state } = createBattle({
      player: [mon(4, 30, ['scratch'])], foe: [mon(7, 30, ['body-slam', 'water-gun'])], seed, kind: 'trainer', trainer: trainer({ skill: 3 }),
    });
    const r = chooseAction(state, { kind: 'move', slot: 0 }, ctx);
    const used = r.events.find((e) => e.k === 'move' && e.side === 'foe');
    if (used && used.k === 'move') assert.equal(used.move, 'water-gun', `semente ${seed}`);
  }
});

test('IA: usa item de cura com pouco HP e troca quando está em desvantagem', () => {
  const hurt = mon(25, 30, ['thunderbolt']);
  hurt.hp = Math.floor(hurt.stats.hp * 0.15);
  const potion = { item: 'hyper-potion', name: 'Hyper Potion', heal: 120, cures: false, qty: 1 };
  const base = createBattle({ player: [mon(1, 20, ['growl'])], foe: [hurt, mon(7, 30, ['tackle'])], seed: 5, kind: 'trainer', trainer: trainer({ bag: [potion] }) });
  const healed = chooseAction(base.state, { kind: 'move', slot: 0 }, ctx);
  assert.ok(healed.events.some((e) => e.k === 'heal' && e.side === 'foe'), 'curou o próprio Pokémon');
  assert.equal(healed.state.trainer?.bag[0]?.qty, 0, 'gastou o item');

  // Charmander (fogo) contra Squirtle (água): o líder troca para o Bulbasaur
  const sw = createBattle({ player: [mon(7, 30, ['water-gun'])], foe: [mon(4, 30, ['ember']), mon(1, 30, ['vine-whip'])], seed: 9, kind: 'trainer', trainer: trainer() });
  const swapped = chooseAction(sw.state, { kind: 'move', slot: 0 }, ctx);
  assert.ok(swapped.events.some((e) => e.k === 'send' && e.side === 'foe' && e.index === 1), 'trocou para o Bulbasaur');
  assert.equal(swapped.state.trainer?.lastSwitch, 1);
  // não troca duas vezes seguidas
  const again = chooseAction(swapped.state, { kind: 'move', slot: 0 }, ctx);
  assert.ok(!again.events.some((e) => e.k === 'send' && e.side === 'foe'));
  assert.equal(activeOf(again.state as BattleState, 'foe').speciesId, 1);
});

test('IA: nível 1 não troca nem confia só no melhor golpe (selvagem segue como antes)', () => {
  const sw = createBattle({ player: [mon(7, 30, ['water-gun'])], foe: [mon(4, 30, ['ember']), mon(1, 30, ['vine-whip'])], seed: 9, kind: 'trainer', trainer: trainer({ skill: 1 }) });
  const r = chooseAction(sw.state, { kind: 'move', slot: 0 }, ctx);
  assert.ok(!r.events.some((e) => e.k === 'send' && e.side === 'foe'));
});

test('batalhas de treinador são reproduzíveis por semente', () => {
  const run = () => {
    let { state } = createBattle({ player: [mon(6, 50, ['flamethrower', 'slash'])], foe: [mon(130, 50, ['hydro-pump', 'bite']), mon(148, 50, ['dragon-rush'])], seed: 77, kind: 'trainer', trainer: trainer() });
    const log: string[] = [];
    for (let i = 0; i < 30 && state.phase !== 'ended'; i++) {
      const r = chooseAction(state, state.phase === 'replace' ? { kind: 'switch', to: 0 } : { kind: 'move', slot: i % 2 }, ctx);
      state = r.state;
      log.push(...r.events.map((e) => e.text));
    }
    return log.join('|');
  };
  assert.equal(run(), run());
});
