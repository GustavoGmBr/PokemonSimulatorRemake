import type { ReactElement } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { TrainerSprite } from '../ui/TrainerSprite.tsx';
import { TYPE_LABELS, type BattleTurnResult, type ChallengesState, type DoublesTurnResult, type NgChallengeView, type ChallengeView, type TrainerOption, type TypeName } from '@pokesim/engine';
import { api } from '../api.ts';
import { Menu, type MenuItem } from '../ui/Menu.tsx';
import { KeyHints, Sprite, formatMoney } from '../ui/bits.tsx';
import { useKeys } from '../ui/useKeys.ts';
import { playSound } from '../sound.ts';
import { BattleScreen } from './BattleScreen.tsx';
import { DoublesBattleScreen } from './DoublesBattleScreen.tsx';

const RANDOM_TAB = '__random';
const NG_TAB = '__ng';
const SKILL_LABEL = ['', 'básica', 'esperta', 'estrategista'];

interface Props {
  saveId: string;
  onBack: () => void;
}

export function ChallengesScreen({ saveId, onBack }: Props) {
  const [state, setState] = useState<ChallengesState | null>(null);
  const [tab, setTab] = useState(0);
  const [hover, setHover] = useState('');
  const [battle, setBattle] = useState<BattleTurnResult | DoublesTurnResult | null>(null);
  const [pair, setPair] = useState(false);
  const [message, setMessage] = useState('Escolha um desafio. Q/E trocam de região.');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.challenges(saveId).then(setState, (e: Error) => setError(e.message));
  useEffect(() => {
    void load();
    // uma batalha interrompida (ao fechar a página) continua de onde parou
    api.battle(saveId).then((running) => { if (running) setBattle({ events: [], view: running }); }, () => undefined);
    api.battle2(saveId).then((running) => { if (running) setBattle({ doubles: true, events: [], view: running }); }, () => undefined);
  }, [saveId]); // eslint-disable-line react-hooks/exhaustive-deps

  const regions = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; list: ChallengeView[] }>();
    for (const c of state?.challenges ?? []) {
      const entry = seen.get(c.region) ?? { id: c.region, name: c.regionName, list: [] };
      entry.list.push(c);
      seen.set(c.region, entry);
    }
    return [...seen.values()];
  }, [state]);
  const tabs = [...regions.map((r) => ({ id: r.id, name: r.name })), { id: RANDOM_TAB, name: 'Aleatórios' }, { id: NG_TAB, name: state?.ngplus.unlocked ? 'Novo Ciclo ★' : 'Novo Ciclo 🔒' }];
  const current = tabs[Math.min(tab, tabs.length - 1)] ?? { id: RANDOM_TAB, name: '' };

  useKeys((key) => {
    if (key === 'prev') { setTab((tab + tabs.length - 1) % tabs.length); playSound('move'); }
    else if (key === 'next') { setTab((tab + 1) % tabs.length); playSound('move'); }
    else if (key === 'back') { playSound('back'); onBack(); }
  }, !battle && !busy && state !== null);

  const start = async (work: () => Promise<BattleTurnResult | DoublesTurnResult>) => {
    setBusy(true);
    setError(null);
    try {
      setBattle(await work());
    } catch (e) {
      setMessage((e as Error).message);
      playSound('error');
    } finally {
      setBusy(false);
    }
  };
  const afterBattle = () => { setBattle(null); setHover(''); void load(); };

  if (battle && 'doubles' in battle) return <DoublesBattleScreen key="battle2" saveId={saveId} start={battle} onExit={afterBattle} />;
  if (battle) return <BattleScreen key="battle" saveId={saveId} start={battle} habitat="forest" onExit={afterBattle} />;
  if (error) {
    return (
      <main className="gb-screen"><div className="gb-stage">
        <div className="gb-window gb-window--accent gb-dialog"><p>{error}</p></div>
        <button type="button" className="gb-button" onClick={onBack}>Voltar</button>
      </div></main>
    );
  }
  if (!state) return <main className="gb-screen"><div className="gb-stage"><div className="gb-window gb-dialog"><p>Carregando…</p></div></div></main>;

  const region = regions.find((r) => r.id === current.id);
  const won = state.challenges.filter((c) => c.won).length;

  let items: MenuItem[] = [];
  let detail: ReactElement | null = null;
  const ng = state.ngplus;
  if (current.id === NG_TAB) {
    items = ng.unlocked ? ng.entries.map((c) => ({ id: c.id, label: <span className="gb-chrow"><span className="gb-muted">{c.kind === 'iconic' ? 'Lenda' : c.regionName}</span> {c.name}</span>, extra: c.wins > 0 ? `★${c.wins}` : '' })) : [];
    const picked = ng.entries.find((c) => c.id === hover) ?? ng.entries[0];
    detail = ng.unlocked ? (picked ? <NgDetail entry={picked} /> : null) : (
      <div className="gb-chdetail">
        <h2 className="gb-title" style={{ fontSize: 22, margin: 0 }}>Novo Ciclo 🔒</h2>
        <p style={{ margin: '6px 0' }}>Vença todos os campeões para começar outro ciclo: campeões Nv 100 com equipes completas e treinadores lendários, com prêmios melhores.</p>
        <p className="gb-muted" style={{ margin: 0 }}>Faltam: {ng.missing.join(', ')}.</p>
      </div>
    );
  } else if (current.id === RANDOM_TAB) {
    items = state.trainers.map((t) => ({ id: t.id, label: t.name, extra: formatMoney(pair ? t.money * 2 : t.money) }));
    const picked = state.trainers.find((t) => t.id === hover) ?? state.trainers[0];
    detail = picked ? <TrainerDetail option={picked} pair={pair} /> : null;
  } else if (region) {
    items = region.list.map((c) => ({
      id: c.id,
      label: <span className="gb-chrow"><span className="gb-muted">{c.group}</span> {titled(c)}</span>,
      extra: c.won ? '★' : c.unlocked ? '' : '🔒',
      disabled: !c.unlocked && !c.won,
    }));
    const picked = region.list.find((c) => c.id === hover) ?? region.list[0];
    detail = picked ? <ChallengeDetail challenge={picked} /> : null;
  }

  return (
    <main className="gb-screen">
      <div className="gb-stage">
        <header className="gb-window gb-spread" style={{ alignItems: 'center', padding: '10px 20px' }}>
          <h1 className="gb-title" style={{ fontSize: 26 }}>Batalhar</h1>
          <span style={{ fontSize: 22 }}>★ {won} / {state.challenges.length}</span>
        </header>
        <div className="gb-row" style={{ alignItems: 'flex-start' }}>
          <section className="gb-window gb-grow" aria-label="Desafios">
            <div className="gb-tabs" role="tablist">
              {tabs.map((t, i) => (
                <button key={t.id} type="button" role="tab" aria-selected={i === tab} className="gb-tab" onClick={() => { setTab(i); setHover(''); }}>{t.name}</button>
              ))}
            </div>
            {current.id === RANDOM_TAB ? (
              <div className="gb-row" style={{ gap: 6, marginBottom: 8, alignItems: 'center' }}>
                <button type="button" className="gb-button" aria-pressed={!pair} onClick={() => setPair(false)}>Individual</button>
                <button type="button" className="gb-button" aria-pressed={pair} onClick={() => setPair(true)}>Dupla (2×2)</button>
                {pair ? <span className="gb-muted">Prêmio em dobro · precisa de 2 Pokémon</span> : null}
              </div>
            ) : null}
            <div style={{ maxHeight: '54vh', overflowY: 'auto' }}>
              <Menu
                key={current.id + String(pair)}
                label="Desafios" items={items} active={!busy}
                onMove={setHover}
                onBack={onBack}
                onSelect={(id) => {
                  if (current.id === RANDOM_TAB) void start(() => (pair ? api.battle2Trainer(saveId, id) : api.trainerStart(saveId, id)));
                  else void start(() => api.challengeStart(saveId, id));
                }}
              />
            </div>
          </section>
          <aside className="gb-window gb-grow" aria-label="Detalhes">{detail}</aside>
        </div>
        <div className="gb-window gb-dialog"><p style={{ margin: 0 }}>{message}</p></div>
        <KeyHints hints={[['↑↓', 'escolher'], ['Z', 'batalhar'], ['Q/E', 'região'], ['X', 'voltar']]} />
      </div>
    </main>
  );
}

/** Elite e campeão já trazem o cargo no nome ("Campeão Blue"). */
const titled = (c: ChallengeView) => (c.name.toLowerCase().startsWith(c.title.toLowerCase()) ? c.name : `${c.title} ${c.name}`);

function ChallengeDetail({ challenge: c }: { challenge: ChallengeView }) {
  return (
    <div className="gb-chdetail">
      <div className="gb-row" style={{ alignItems: 'flex-end', gap: 12 }}>
        <TrainerSprite name={c.name} title={c.title} size={112} />
        <h2 className="gb-title" style={{ fontSize: 22, margin: 0 }}>{titled(c)}</h2>
      </div>
      <p className="gb-muted" style={{ margin: '4px 0' }}>{c.circuitName} · {c.group} · tipo {TYPE_LABELS[c.type as TypeName] ?? c.type} · Nv {c.level}</p>
      {c.won ? <p style={{ margin: '4px 0' }}>★ Vencido</p> : null}
      {!c.unlocked && !c.won ? <p style={{ margin: '4px 0', color: 'var(--red)' }}>🔒 {c.lockReason}</p> : null}
      <div className="gb-row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {c.team.map((mon, i) => <Sprite key={i} speciesId={mon.speciesId} alt={mon.name} size={56} />)}
      </div>
      <p className="gb-muted" style={{ margin: '6px 0 0', fontSize: 20 }}>
        IA {SKILL_LABEL[c.skill] ?? c.skill}
        {c.bag.length > 0 ? ` · usa ${c.bag.map((b) => `${b.quantity}× ${b.name}`).join(', ')} (máx. 5 por batalha)` : ' · sem itens'}
      </p>
      <p className="gb-muted" style={{ margin: '4px 0 0', fontSize: 20 }}>
        Só vale equipe da Pokédex #{c.dex[0]}–#{c.dex[1]}. Seus Pokémon acima do Nv {c.level} lutam nesse nível e não ganham XP.
      </p>
    </div>
  );
}

function TrainerDetail({ option: t, pair }: { option: TrainerOption; pair?: boolean }) {
  return (
    <div className="gb-chdetail">
      <div className="gb-row" style={{ alignItems: 'flex-end', gap: 12 }}>
        <TrainerSprite name={t.name} role="trainer" size={96} />
        <h2 className="gb-title" style={{ fontSize: 22, margin: 0 }}>Treinador {t.name}</h2>
      </div>
      <p style={{ margin: '4px 0' }}>{t.description}</p>
      <p className="gb-muted" style={{ margin: '4px 0', fontSize: 20 }}>
        {t.teamSize[0] === t.teamSize[1] ? t.teamSize[0] : `${t.teamSize[0]}–${t.teamSize[1]}`} Pokémon · Nv {t.levels[0] === t.levels[1] ? t.levels[0] : `${t.levels[0]}–${t.levels[1]}`}
      </p>
      <p style={{ margin: '4px 0' }}>Prêmio: {formatMoney(pair ? t.money * 2 : t.money)}</p>
      <p className="gb-muted" style={{ margin: 0, fontSize: 20 }}>{t.rewards.map((r) => `${pair ? r.quantity * 2 : r.quantity}× ${r.name}`).join(', ')}</p>
      {pair ? <p className="gb-muted" style={{ margin: '4px 0 0', fontSize: 20 }}>Dupla: dois de cada lado, sem itens, captura ou fuga.</p> : null}
    </div>
  );
}

function NgDetail({ entry: c }: { entry: NgChallengeView }) {
  return (
    <div className="gb-chdetail">
      <div className="gb-row" style={{ alignItems: 'flex-end', gap: 12 }}>
        <TrainerSprite name={c.name} title={c.kind === 'iconic' ? 'Mestre' : c.title} size={112} />
        <h2 className="gb-title" style={{ fontSize: 22, margin: 0 }}>{c.name}</h2>
      </div>
      <p className="gb-muted" style={{ margin: '4px 0' }}>{c.kind === 'iconic' ? 'Treinador lendário' : `${c.title} · ${c.regionName}`} · Nv {c.level}</p>
      <p style={{ margin: '4px 0' }}>{c.blurb}</p>
      <div className="gb-row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {c.team.map((mon, i) => <Sprite key={i} speciesId={mon.speciesId} alt={mon.name} size={56} />)}
      </div>
      <p style={{ margin: '6px 0 0' }}>Prêmio: {formatMoney(c.money)} · {c.rewards.map((r) => `${r.quantity}× ${r.name}`).join(', ')}</p>
      {c.wins === 0 && c.firstWinBonus.length > 0 ? <p style={{ margin: '4px 0 0', color: 'var(--red)' }}>1ª vitória: {c.firstWinBonus.map((r) => `${r.quantity}× ${r.name}`).join(', ')}</p> : null}
      <p className="gb-muted" style={{ margin: '4px 0 0', fontSize: 20 }}>{c.wins > 0 ? `★ Vencido ${c.wins}×` : 'Ainda não vencido'} · sem limite de nível: seus Pokémon lutam no nível real.</p>
    </div>
  );
}
