import { useEffect, useMemo, useRef, useState } from 'react';
import type { AutoSearchTarget, PokemonView, WildSlotView, WildState } from '@pokesim/engine';
import { api } from '../api.ts';
import { FilterPanel, type FilterRow } from '../ui/FilterPanel.tsx';
import { Menu, type MenuItem } from '../ui/Menu.tsx';
import { BallIcon, HpBar, KeyHints, Sprite, TypeBadge } from '../ui/bits.tsx';
import { useKeys } from '../ui/useKeys.ts';
import { playSound } from '../sound.ts';

const COLUMNS = 5;
const TARGETS: AutoSearchTarget[] = ['either', 'shiny', 'stars'];
const TARGET_LABEL: Record<AutoSearchTarget, string> = { either: 'Brilhante ou estrelas', shiny: 'Só brilhante', stars: 'Só estrelas' };
const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const SHAKE_TEXT = ['A bola nem balançou…', 'Balançou uma vez…', 'Balançou duas vezes… quase!', 'Três balanços… por pouco!'];

const stars = (n: number) => (n > 0 ? '★'.repeat(n) : '0★');
const percent = (chance: number | null) => (chance === null ? '' : chance >= 1 ? '100%' : chance < 0.01 ? '<1%' : `${Math.round(chance * 100)}%`);

interface Anim {
  ball: string;
  stage: 'fly' | 'shake' | 'open';
  shakeCount: number;
}

interface Props {
  saveId: string;
  onBack: () => void;
}

export function WildScreen({ saveId, onBack }: Props) {
  const [state, setState] = useState<WildState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('Procure um POKÉMON selvagem!');
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [target, setTarget] = useState<AutoSearchTarget>('either');
  const [minStars, setMinStars] = useState(3);
  const [anim, setAnim] = useState<Anim | null>(null);
  const [caught, setCaught] = useState<PokemonView | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    api.wild(saveId).then(setState, (e: Error) => setError(e.message));
    return () => { alive.current = false; };
  }, [saveId]);

  const board = state?.board ?? null;
  const chosen = state && board && state.chosen !== null ? board.slots[state.chosen] ?? null : null;
  const mode: 'idle' | 'board' | 'encounter' | 'caught' = caught ? 'caught' : chosen ? 'encounter' : board ? 'board' : 'idle';

  const highlight = (slot: WildSlotView): 'shiny' | 'stars' | null => (slot.shiny ? 'shiny' : slot.ivStars >= minStars ? 'stars' : null);
  const found = useMemo(() => (board?.slots ?? []).filter((slot) => highlight(slot) !== null), [board, minStars]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasShiny = found.some((slot) => slot.shiny);

  // alerta sonoro quando o mapa tem brilhante / estrelas altas
  const boardKey = board ? board.slots.map((s) => `${s.speciesId}${s.level}${s.shiny ? 's' : ''}${s.ivStars}`).join('|') : '';
  useEffect(() => {
    if (found.length > 0 && mode === 'board') playSound('save');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardKey]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (e) {
      setMessage((e as Error).message);
      playSound('error');
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const search = () => run(async () => {
    const next = await api.wildSearch(saveId);
    setState(next);
    setCaught(null);
    setCursor(0);
    setMessage('Um mapa novo! Escolha um POKÉMON (3 giros para trocar todos).');
  });
  const spin = () => run(async () => {
    const next = await api.wildSpin(saveId);
    setState(next);
    setMessage(`Giro! Restam ${next.board?.spinsLeft ?? 0}.`);
  });
  const autoSearch = () => run(async () => {
    setMessage('Procurando…');
    const result = await api.wildAuto(saveId, { target, minStars });
    setState(result.state);
    setCaught(null);
    setCursor(0);
    setMessage(result.found
      ? `Achei! Apareceu depois de ${result.searches.toLocaleString('pt-BR')} ${result.searches === 1 ? 'mapa' : 'mapas'}.`
      : `Nada em ${result.searches.toLocaleString('pt-BR')} mapas. Tente de novo.`);
  });
  const choose = (slot: number) => run(async () => {
    const next = await api.wildChoose(saveId, slot);
    setState(next);
    const wild = next.board?.slots[slot];
    setMessage(wild ? `Um ${wild.name.toUpperCase()} selvagem apareceu!` : '');
  });
  const flee = () => run(async () => {
    setState(await api.wildFlee(saveId));
    setMessage('Você fugiu. Escolha outro POKÉMON.');
  });

  const throwBall = (ball: string) => run(async () => {
    if (!state || !chosen) return;
    const ballName = state.balls.find((b) => b.item === ball)?.displayName ?? 'bola';
    const result = await api.wildThrow(saveId, ball);
    const fast = reducedMotion();
    setMessage(`Você lançou ${ballName}!`);
    setAnim({ ball, stage: 'fly', shakeCount: 0 });
    await sleep(fast ? 100 : 700);
    for (let i = 1; i <= result.shakes; i++) {
      if (!alive.current) return;
      setAnim({ ball, stage: 'shake', shakeCount: i });
      playSound('move');
      await sleep(fast ? 100 : 750);
    }
    setAnim({ ball, stage: 'open', shakeCount: result.shakes });
    await sleep(fast ? 100 : 500);
    if (!alive.current) return;
    setAnim(null);
    setState(result.state);
    if (result.caught && result.pokemon) {
      playSound('save');
      setCaught(result.pokemon);
      const where = result.pokemon.location.kind === 'team' ? 'foi para a sua equipe' : `foi para a caixa ${result.pokemon.location.box + 1} do PC`;
      setMessage(`Gotcha! ${result.pokemon.name.toUpperCase()} foi capturado e ${where}!`);
    } else {
      playSound('back');
      setMessage(`${SHAKE_TEXT[result.shakes] ?? ''} ${chosen.name.toUpperCase()} escapou!`);
    }
  });

  // ---- teclado ----
  useKeys((key) => {
    if (mode === 'board') {
      const n = board?.slots.length ?? 0;
      if (key === 'left') setCursor((c) => (c + n - 1) % n);
      else if (key === 'right') setCursor((c) => (c + 1) % n);
      else if (key === 'up') setCursor((c) => (c - COLUMNS + n) % n);
      else if (key === 'down') setCursor((c) => (c + COLUMNS) % n);
      else if (key === 'confirm') { playSound('confirm'); void choose(cursor); }
      else if (key === 'prev') { if ((board?.spinsLeft ?? 0) > 0) void spin(); else playSound('error'); }
      else if (key === 'filter') void search();
      else if (key === 'next') void autoSearch();
      else if (key === 'back') { playSound('back'); onBack(); }
      if (key === 'left' || key === 'right' || key === 'up' || key === 'down') playSound('move');
    } else if (mode === 'caught') {
      if (key === 'confirm' || key === 'back') { setCaught(null); setState((s) => (s ? { ...s, board: null, chosen: null } : s)); setMessage('Procure outro POKÉMON selvagem!'); }
    }
  }, (mode === 'board' || mode === 'caught') && !busy);

  if (error) {
    return (
      <main className="gb-screen"><div className="gb-stage">
        <div className="gb-window gb-window--accent gb-dialog"><p>{error}</p></div>
        <button type="button" className="gb-button" onClick={onBack}>Voltar</button>
      </div></main>
    );
  }
  if (!state) return <main className="gb-screen"><div className="gb-stage"><div className="gb-window gb-dialog"><p>Carregando…</p></div></div></main>;

  const rows: FilterRow[] = [
    { id: 'search', label: 'Procurar selvagem', value: '', kind: 'action' },
    { id: 'auto', label: 'Busca automática', value: '', kind: 'action' },
    { id: 'target', label: 'Parar quando achar', value: TARGET_LABEL[target], kind: 'cycle' },
    { id: 'stars', label: 'Estrelas mínimas', value: stars(minStars), kind: 'cycle' },
    { id: 'back', label: 'Voltar', value: '', kind: 'action' },
  ];

  return (
    <main className="gb-screen">
      <div className="gb-stage">
        <header className="gb-window gb-spread" style={{ alignItems: 'center', padding: '10px 20px' }}>
          <h1 className="gb-title" style={{ fontSize: 26 }}>Selvagens</h1>
          <span className="gb-muted">
            {board ? `${board.regions.join(' · ')} · Nv ${board.levelRange[0]}–${board.levelRange[1]}` : 'Nenhuma procura em andamento'}
            {state.shinyCharm ? ' · Amuleto Brilhante' : ''}{state.catchingCharm ? ' · Amuleto de Captura' : ''}
          </span>
        </header>

        {mode === 'idle' ? (
          <div className="gb-row" style={{ alignItems: 'flex-start' }}>
            <div className="gb-side" style={{ maxWidth: 520 }}>
              <FilterPanel
                title="O que fazer?"
                rows={rows}
                active={!busy}
                onCycle={(id, d) => {
                  if (id === 'target') setTarget(TARGETS[(TARGETS.indexOf(target) + d + TARGETS.length) % TARGETS.length] as AutoSearchTarget);
                  else if (id === 'stars') setMinStars(((minStars - 1 + d + 4) % 4) + 1);
                }}
                onAction={(id) => { if (id === 'search') void search(); else if (id === 'auto') void autoSearch(); else onBack(); }}
                onBack={onBack}
              />
            </div>
            <div className="gb-window gb-grow">
              <p style={{ margin: 0 }}>Cada procura mostra 10 POKÉMON no mapa. Você tem 3 giros para trocar todos eles; clique no que quiser enfrentar.</p>
              <p className="gb-muted" style={{ marginBottom: 0 }}>A busca automática gera mapas até aparecer um brilhante ou um POKÉMON com as estrelas mínimas escolhidas.</p>
            </div>
          </div>
        ) : null}

        {mode === 'board' && board ? (
          <section className="gb-window" aria-label="Mapa de selvagens">
            {found.length > 0 ? (
              <div className={`gb-banner${hasShiny ? '' : ' gb-banner--stars'}`} role="alert" style={{ marginBottom: 10 }}>
                {hasShiny ? '✦ Brilhante no mapa!' : `${minStars === 4 ? '4★' : `${minStars}★ ou mais`} no mapa!`}
                {hasShiny && found.some((s) => !s.shiny) ? ' Também há POKÉMON de estrelas altas.' : ''}
              </div>
            ) : null}
            <div className="gb-spawn-grid" role="grid">
              {board.slots.map((slot) => {
                const mark = highlight(slot);
                return (
                  <button
                    key={slot.slot}
                    type="button"
                    role="gridcell"
                    className={`gb-spawn${mark === 'shiny' ? ' gb-spawn--shiny' : mark === 'stars' ? ' gb-spawn--stars' : ''}`}
                    aria-current={cursor === slot.slot}
                    aria-label={`${slot.name}, nível ${slot.level}, ${slot.ivStars} estrelas${slot.shiny ? ', brilhante' : ''}`}
                    onMouseEnter={() => setCursor(slot.slot)}
                    onClick={() => { setCursor(slot.slot); playSound('confirm'); void choose(slot.slot); }}
                    disabled={busy}
                  >
                    <span className="gb-spawn__name">{slot.shiny ? '✦ ' : ''}{slot.name}</span>
                    <span className="gb-spawn__meta">Nv{slot.level} · <span className="gb-stars">{stars(slot.ivStars)}</span></span>
                    <Sprite speciesId={slot.speciesId} shiny={slot.shiny} alt="" size={96} />
                    <span style={{ display: 'flex', gap: 3 }}>{slot.types.map((t) => <TypeBadge key={t} type={t} />)}</span>
                  </button>
                );
              })}
            </div>
            <div className="gb-spread" style={{ marginTop: 12, alignItems: 'center' }}>
              <span>Giros restantes: <b>{board.spinsLeft}</b>/3</span>
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button type="button" className="gb-button" disabled={busy || board.spinsLeft === 0} onClick={() => void spin()}>Girar (Q)</button>
                <button type="button" className="gb-button" disabled={busy} onClick={() => void search()}>Nova procura (F)</button>
                <button type="button" className="gb-button gb-button--blue" disabled={busy} onClick={() => void autoSearch()}>Busca automática (E)</button>
              </span>
            </div>
          </section>
        ) : null}

        {mode === 'encounter' && chosen ? (
          <div className="gb-row" style={{ alignItems: 'stretch' }}>
            <section className="gb-arena gb-grow" aria-label="Encontro">
              <span className="gb-wildname">
                {chosen.shiny ? '✦ ' : ''}{chosen.name} · Nv{chosen.level} · <span className="gb-stars">{stars(chosen.ivStars)}</span>
              </span>
              <div style={{ display: 'flex', gap: 6 }}>{chosen.types.map((t) => <TypeBadge key={t} type={t} />)}</div>
              <div style={{ width: 220 }}><HpBar current={1} max={1} /></div>
              <div style={{ minHeight: 170, display: 'flex', alignItems: 'center' }}>
                {anim && anim.stage !== 'open' ? (
                  <BallIcon item={anim.ball} className={anim.stage === 'fly' ? 'gb-pokeball--fly' : 'gb-pokeball--shake'} />
                ) : (
                  <Sprite speciesId={chosen.speciesId} shiny={chosen.shiny} alt={chosen.name} size={168} className="gb-bob" />
                )}
              </div>
              {chosen.caughtBefore ? <span className="gb-hint" style={{ color: 'var(--ink)' }}>Você já capturou esta espécie.</span> : <span className="gb-hint" style={{ color: 'var(--ink)' }}>Espécie nova para a sua Pokédex!</span>}
            </section>
            <section className="gb-window gb-side" style={{ maxWidth: 470, minWidth: 330 }} aria-label="Bolas">
              <h2 className="gb-title" style={{ fontSize: 20, marginBottom: 6 }}>Lançar bola</h2>
              {state.balls.length === 0 ? <p className="gb-muted">Você está sem POKÉ BOLAS. Compre mais na Loja.</p> : null}
              <Menu
                label="Bolas"
                active={!busy && !anim}
                items={[
                  ...state.balls.map((ball): MenuItem => ({
                    id: ball.item,
                    label: (
                      <span className="gb-ballrow">
                        <BallIcon item={ball.item} small />
                        <span>{ball.displayName}</span>
                        <span className="gb-ballrow__chance">×{ball.quantity} · {percent(ball.chance)}</span>
                      </span>
                    ),
                  })),
                  { id: '__flee', label: 'Fugir' },
                ]}
                onSelect={(id) => (id === '__flee' ? void flee() : void throwBall(id))}
                onBack={() => void flee()}
              />
              <p className="gb-hint" style={{ marginBottom: 0 }}>A porcentagem é a chance de captura com cada bola.</p>
            </section>
          </div>
        ) : null}

        {mode === 'caught' && caught ? (
          <section className="gb-window gb-window--accent" aria-label="Capturado" style={{ textAlign: 'center' }}>
            <Sprite speciesId={caught.speciesId} shiny={caught.shiny} alt={caught.name} size={160} className="gb-bob" />
            <h2 className="gb-title" style={{ fontSize: 28 }}>{caught.shiny ? '✦ ' : ''}{caught.name} · Nv{caught.level}</h2>
            <p style={{ margin: '4px 0' }}><span className="gb-stars">{stars(caught.ivStars)}</span> · IV {caught.ivTotal}/186</p>
            <button type="button" className="gb-button gb-button--red" onClick={() => { setCaught(null); setState((s) => (s ? { ...s, board: null, chosen: null } : s)); setMessage('Procure outro POKÉMON selvagem!'); }}>Continuar (Z)</button>
          </section>
        ) : null}

        <div className="gb-window gb-window--accent gb-info" role="status"><p style={{ margin: 0 }}>{busy && !anim ? 'Aguarde…' : message}</p></div>
        <KeyHints hints={mode === 'board'
          ? [['↑↓←→', 'mover'], ['Z', 'enfrentar'], ['Q', 'girar'], ['F', 'nova procura'], ['E', 'busca automática'], ['X', 'sair']]
          : [['↑↓', 'escolher'], ['Z', 'confirmar'], ['X', 'voltar / fugir']]}
        />
      </div>
    </main>
  );
}
