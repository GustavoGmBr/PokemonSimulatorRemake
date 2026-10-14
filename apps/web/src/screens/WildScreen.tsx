import { useEffect, useMemo, useRef, useState } from 'react';
import { HABITATS, MAX_WILD_LEVEL, MIN_WILD_LEVEL, REGIONS, type PokemonView, type SpeciesIndexEntry, type WildRegionOption, type WildState } from '@pokesim/engine';
import { api } from '../api.ts';
import { HabitatBoard, neighbour } from '../ui/HabitatBoard.tsx';
import { FilterPanel, type FilterRow } from '../ui/FilterPanel.tsx';
import { Menu, type MenuItem } from '../ui/Menu.tsx';
import { BallIcon, HpBar, KeyHints, Sprite, TypeBadge } from '../ui/bits.tsx';
import { useKeys } from '../ui/useKeys.ts';
import { playSound } from '../sound.ts';

/** Pokémon com tantas estrelas (ou mais) ganham destaque no mapa; brilhantes sempre. */
const ALERT_STARS = 3;
const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const SHAKE_TEXT = ['A bola nem balançou…', 'Balançou uma vez…', 'Balançou duas vezes… quase!', 'Três balanços… por pouco!'];

const stars = (n: number) => (n > 0 ? '★'.repeat(n) : '0★');
const percent = (chance: number | null) => (chance === null ? '' : chance >= 1 ? '100%' : chance < 0.01 ? '<1%' : `${Math.round(chance * 100)}%`);
const yen = (n: number) => `₽ ${n.toLocaleString('pt-BR')}`;

interface Anim {
  ball: string;
  stage: 'fly' | 'shake' | 'open';
  shakeCount: number;
}

interface Props {
  saveId: string;
  onBack: () => void;
}

type Step = 'regions' | 'region' | 'species';

export function WildScreen({ saveId, onBack }: Props) {
  const [state, setState] = useState<WildState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('Escolha uma região para procurar POKÉMON selvagens.');
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [step, setStep] = useState<Step>('regions');
  const [regionId, setRegionId] = useState<string>('kanto');
  const [hoverRegion, setHoverRegion] = useState<string>('kanto');
  const [anim, setAnim] = useState<Anim | null>(null);
  const [caught, setCaught] = useState<PokemonView | null>(null);
  const [index, setIndex] = useState<SpeciesIndexEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [levels, setLevels] = useState<[number, number] | null>(null);
  const [habitatPick, setHabitatPick] = useState('');
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    api.wild(saveId).then((next) => {
      setState(next);
      if (next.board) setMessage(next.chosen !== null ? 'Você continua o encontro.' : 'Você voltou ao mapa da última procura.');
    }, (e: Error) => setError(e.message));
    api.speciesIndex().then(setIndex, () => undefined);
    return () => { alive.current = false; };
  }, [saveId]);

  const board = state?.board ?? null;
  const chosen = state && board && state.chosen !== null ? board.slots[state.chosen] ?? null : null;
  const mode: 'idle' | 'board' | 'encounter' | 'caught' = caught ? 'caught' : chosen ? 'encounter' : board ? 'board' : 'idle';

  const found = useMemo(() => (board?.slots ?? []).filter((slot) => slot.shiny || slot.ivStars >= ALERT_STARS), [board]);
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

  const search = (region: string, speciesId?: number) => run(async () => {
    const [minLevel, maxLevel] = levels ?? state?.defaultLevels ?? [MIN_WILD_LEVEL, MIN_WILD_LEVEL + 9];
    const option = state?.regions.find((r) => r.id === region);
    const request = { region: region as never, minLevel, maxLevel, ...(speciesId ? { speciesId } : option?.chooseHabitat && habitatPick ? { habitat: habitatPick } : {}) };
    const next = await api.wildSearch(saveId, request);
    setState(next);
    setCaught(null);
    setCursor(0);
    const b = next.board;
    setMessage(b ? `${b.habitatName}! Escolha um POKÉMON (${b.spinsLeft} giros para trocar todos).` : '');
  });
  const spin = () => run(async () => {
    if (!board) return;
    const pay = board.spinsLeft === 0;
    const next = await api.wildSpin(saveId, pay);
    setState(next);
    setMessage(pay ? `Mapa renovado por ${yen(next.refreshCost)}.` : `Giro! Restam ${next.board?.spinsLeft ?? 0}.`);
  });
  const leave = () => run(async () => {
    const next = await api.wildLeave(saveId);
    setState(next);
    setCaught(null);
    setStep('regions');
    setMessage('Escolha uma região para procurar POKÉMON selvagens.');
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
  const afterCapture = () => {
    setCaught(null);
    setStep('region');
    setState((s) => (s ? { ...s, board: null, chosen: null } : s));
    setMessage('Procure outro POKÉMON selvagem!');
  };

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

  const speciesChoices = useSpeciesChoices(index, regionId, filter);

  // ---- teclado (mapa e captura; as listas usam o próprio Menu) ----
  useKeys((key) => {
    if (mode === 'board' && board) {
      const n = board.slots.length;
      if (key === 'left' || key === 'right' || key === 'up' || key === 'down') {
        setCursor((c) => neighbour(board.habitat, c, key, n));
        playSound('move');
      } else if (key === 'confirm') { playSound('confirm'); void choose(cursor); }
      else if (key === 'prev') void spin();
      else if (key === 'back') { playSound('back'); void leave(); }
    } else if (mode === 'caught') {
      if (key === 'confirm' || key === 'back') afterCapture();
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

  const regionOf = (id: string): WildRegionOption | undefined => state.regions.find((region) => region.id === id);
  const selected = regionOf(step === 'regions' ? hoverRegion : regionId) ?? (state.regions[0] as WildRegionOption);
  const cycleRow = (id: string, d: number) => {
    const [lo, hi] = levels ?? state.defaultLevels;
    const clamp = (n: number) => Math.max(MIN_WILD_LEVEL, Math.min(MAX_WILD_LEVEL, n));
    if (id === 'min') { const v = clamp(lo + d); setLevels([v, Math.max(v, hi)]); }
    else if (id === 'max') { const v = clamp(hi + d); setLevels([Math.min(lo, v), v]); }
    else if (id === 'habitat') {
      if (!selected.chooseHabitat) { setMessage(`Vença os 8 ginásios de ${selected.name} para escolher o mapa.`); playSound('error'); return; }
      const ids = ['', ...HABITATS.map((h) => h.id)];
      setHabitatPick(ids[(ids.indexOf(habitatPick) + Math.sign(d) + ids.length) % ids.length] as string);
    }
  };
  const previous = REGIONS[Math.max(0, REGIONS.findIndex((region) => region.id === selected.id) - 1)];

  return (
    <main className="gb-screen">
      <div className="gb-stage">
        <header className="gb-window gb-spread" style={{ alignItems: 'center', padding: '10px 20px' }}>
          <h1 className="gb-title" style={{ fontSize: 26 }}>Selvagens</h1>
          <span className="gb-muted">
            {board ? `${board.regionName} · ${board.habitatName} · Nv ${board.levelRange[0]}–${board.levelRange[1]}` : 'Nenhuma procura em andamento'}
            {state.shinyCharm ? ' · Amuleto Brilhante' : ''}{state.catchingCharm ? ' · Amuleto de Captura' : ''}
            {' · '}{yen(state.money)}
          </span>
        </header>

        {mode === 'idle' ? (
          <div className="gb-row" style={{ alignItems: 'flex-start' }}>
            <div className="gb-side" style={{ maxWidth: 380 }}>
              <section className="gb-window" aria-label="Regiões">
                <h2 className="gb-title" style={{ fontSize: 20, marginBottom: 6 }}>Região</h2>
                <Menu
                  label="Regiões"
                  active={step === 'regions' && !busy}
                  initialId={regionId}
                  items={state.regions.map((region): MenuItem => ({
                    id: region.id,
                    label: `${region.name}`,
                    extra: region.unlocked ? `Ger. ${region.generation}` : '🔒',
                    disabled: !region.unlocked,
                  }))}
                  onMove={setHoverRegion}
                  onSelect={(id) => { setRegionId(id); setStep('region'); setMessage(`${regionOf(id)?.name ?? ''}: o que vamos procurar?`); }}
                  onBack={onBack}
                />
              </section>
            </div>
            <div className="gb-grow" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <section className="gb-window" aria-label="Detalhes da região">
                <h2 className="gb-title" style={{ fontSize: 22, marginBottom: 4 }}>{selected.name} · Geração {selected.generation}</h2>
                {selected.unlocked ? (
                  <p style={{ margin: '0 0 8px' }}>Cada mapa mostra 10 POKÉMON soltos. Clique no que quiser enfrentar.</p>
                ) : (
                  <p className="gb-region-lock" style={{ margin: '0 0 8px' }}>
                    🔒 Bloqueada. Derrote o campeão de {previous?.name ?? 'Kanto'} para liberar.
                  </p>
                )}
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
                  <li>Ginásios: <b>{selected.gyms}/8</b> · Elite dos 4: <b>{selected.elite ? '✓' : '—'}</b> · Campeão: <b>{selected.champion ? '✓' : '—'}</b></li>
                  <li>Giros por mapa: <b>{selected.spins}</b> <span className="gb-muted">(ginásio 5 · Elite dos 4 8 · campeão 12)</span></li>
                  <li>Lendários: <b>{selected.legendaries ? 'liberados' : 'derrote a Elite dos 4'}</b></li>
                  <li>Pokémon específico: <b>{selected.specific ? 'liberado' : 'derrote o campeão'}</b></li>
                </ul>
              </section>
              {step !== 'regions' && selected.unlocked ? (
                <section className="gb-window" aria-label="Ações">
                  {step === 'region' ? (
                    <>
                      <h2 className="gb-title" style={{ fontSize: 20, marginBottom: 6 }}>{selected.name}</h2>
                      <FilterPanel
                        title="Procura"
                        active={!busy}
                        rows={actionRows(selected, levels ?? state.defaultLevels, habitatPick)}
                        onBigCycle={(id, d) => cycleRow(id, d * 10)}
                        onCycle={(id, d) => cycleRow(id, d)}
                        onAction={(id) => {
                          if (id === 'search') void search(regionId);
                          else if (id === 'specific') {
                            if (!selected.specific) { setMessage(`Derrote o campeão de ${selected.name} para procurar um POKÉMON específico.`); playSound('error'); return; }
                            setFilter(''); setStep('species'); setMessage('Digite o nome e escolha o POKÉMON.');
                          } else setStep('regions');
                        }}
                        onBack={() => setStep('regions')}
                      />
                      <p className="gb-hint" style={{ margin: '8px 0 0' }}>
                        ←→ mudam o valor (Q/E de 10 em 10). Os níveis valem para este mapa e para os giros.
                        {selected.chooseHabitat && habitatPick ? ` ${HABITATS.find((h) => h.id === habitatPick)?.description ?? ''}` : ''}
                      </p>
                    </>
                  ) : null}
                  {step === 'species' ? (
                    <SpeciesPicker
                      choices={speciesChoices}
                      filter={filter}
                      onFilter={setFilter}
                      busy={busy}
                      onPick={(id) => void search(regionId, id)}
                      onBack={() => setStep('region')}
                    />
                  ) : null}
                </section>
              ) : null}
            </div>
          </div>
        ) : null}

        {mode === 'board' && board ? (
          <section className="gb-window" aria-label="Mapa de selvagens">
            {found.length > 0 ? (
              <div className={`gb-banner${hasShiny ? '' : ' gb-banner--stars'}`} role="alert" style={{ marginBottom: 10 }}>
                {hasShiny ? '✦ Brilhante no mapa!' : `${ALERT_STARS}★ ou mais no mapa!`}
                {hasShiny && found.some((s) => !s.shiny) ? ' Também há POKÉMON de estrelas altas.' : ''}
              </div>
            ) : null}
            {board.targetSpeciesId !== null ? (
              <p className="gb-muted" style={{ margin: '0 0 8px' }}>Procura específica: todos os POKÉMON do mapa são da mesma espécie. Escolha o de melhores estrelas.</p>
            ) : null}
            <HabitatBoard
              habitat={board.habitat}
              slots={board.slots}
              cursor={cursor}
              alertStars={ALERT_STARS}
              disabled={busy}
              onHover={setCursor}
              onPick={(slot) => { setCursor(slot); playSound('confirm'); void choose(slot); }}
            />
            <div className="gb-spread" style={{ marginTop: 12, alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" className="gb-button" disabled={busy} onClick={() => { playSound('back'); void leave(); }}>← Voltar à busca (X)</button>
              <span>Giros: <b>{board.spinsLeft}</b>/{board.spinsTotal}</span>
              {board.spinsLeft > 0 ? (
                <button type="button" className="gb-button gb-button--blue" disabled={busy} onClick={() => void spin()}>Girar (Q)</button>
              ) : (
                <button type="button" className="gb-button gb-button--red" disabled={busy || state.money < state.refreshCost} onClick={() => void spin()}>
                  Renovar mapa — {yen(state.refreshCost)} (Q)
                </button>
              )}
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
            <section className="gb-window gb-side" style={{ flex: '0 0 auto', maxWidth: 520, minWidth: 380 }} aria-label="Bolas">
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
            <button type="button" className="gb-button gb-button--red" onClick={afterCapture}>Continuar (Z)</button>
          </section>
        ) : null}

        <div className="gb-window gb-window--accent gb-info" role="status"><p style={{ margin: 0 }}>{busy && !anim ? 'Aguarde…' : message}</p></div>
        <KeyHints hints={mode === 'board'
          ? [['↑↓←→', 'mover'], ['Z', 'enfrentar'], ['Q', 'girar / renovar'], ['X', 'voltar à busca']]
          : [['↑↓', 'escolher'], ['Z', 'confirmar'], ['X', 'voltar / fugir']]}
        />
      </div>
    </main>
  );
}

function actionRows(region: WildRegionOption, levels: [number, number], habitatPick: string): FilterRow[] {
  const habitat = HABITATS.find((h) => h.id === habitatPick);
  return [
    { id: 'search', label: 'Procurar selvagem', value: '', kind: 'action' },
    { id: 'specific', label: 'POKÉMON específico', value: region.specific ? '' : '🔒 campeão', kind: 'action' },
    { id: 'min', label: 'Nível mínimo', value: String(levels[0]), kind: 'cycle' },
    { id: 'max', label: 'Nível máximo', value: String(levels[1]), kind: 'cycle' },
    { id: 'habitat', label: 'Mapa', value: region.chooseHabitat ? (habitat ? habitat.name : 'Aleatório') : '🔒 8 ginásios', kind: 'cycle' },
    { id: 'back', label: 'Voltar', value: '', kind: 'action' },
  ];
}

function useSpeciesChoices(index: SpeciesIndexEntry[], regionId: string, filter: string): SpeciesIndexEntry[] {
  const generation = REGIONS.find((region) => region.id === regionId)?.generation ?? 1;
  return useMemo(() => {
    const text = filter.trim().toLowerCase();
    return index.filter((entry) => entry.generation === generation && (!text || entry.name.toLowerCase().includes(text)));
  }, [index, generation, filter]);
}

interface PickerProps {
  choices: SpeciesIndexEntry[];
  filter: string;
  onFilter: (value: string) => void;
  onPick: (speciesId: number) => void;
  onBack: () => void;
  busy: boolean;
}

function SpeciesPicker({ choices, filter, onFilter, onPick, onBack, busy }: PickerProps) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useKeys((key) => {
    if (key === 'back') onBack();
    else if (key === 'confirm' && choices[0] && !busy) onPick(choices[0].id);
  }, true);
  return (
    <div>
      <h2 className="gb-title" style={{ fontSize: 20, marginBottom: 6 }}>POKÉMON específico</h2>
      <input
        ref={input}
        className="gb-input"
        value={filter}
        placeholder="Digite o nome…"
        aria-label="Nome do POKÉMON"
        maxLength={20}
        onChange={(event) => onFilter(event.target.value)}
        style={{ width: '100%' }}
      />
      <p className="gb-hint" style={{ margin: '6px 0 0' }}>Enter escolhe o primeiro da lista · Esc volta. O mapa terá 10 do mesmo POKÉMON, no habitat do tipo dele.</p>
      <div className="gb-species-grid" role="list">
        {choices.length === 0 ? <p className="gb-muted" style={{ gridColumn: '1 / -1' }}>Nenhum POKÉMON com esse nome nesta região.</p> : null}
        {choices.slice(0, 80).map((entry) => (
          <button key={entry.id} type="button" role="listitem" className="gb-species-pick" disabled={busy} onClick={() => onPick(entry.id)}>
            <Sprite speciesId={entry.id} alt="" size={56} />
            <span>{entry.name}</span>
            <span style={{ display: 'flex', gap: 3 }}>{entry.types.map((t) => <TypeBadge key={t} type={t} />)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
