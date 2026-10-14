import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_MIN_LEVEL, HABITATS, MIN_WILD_LEVEL, REGIONS, type BattleTurnResult, type SpeciesIndexEntry, type WildRegionOption, type WildState } from '@pokesim/engine';
import { api } from '../api.ts';
import { HabitatBoard, neighbour } from '../ui/HabitatBoard.tsx';
import { FilterPanel, type FilterRow } from '../ui/FilterPanel.tsx';
import { Menu, type MenuItem } from '../ui/Menu.tsx';
import { KeyHints, Sprite, TypeBadge } from '../ui/bits.tsx';
import { BattleScreen } from './BattleScreen.tsx';
import { useKeys } from '../ui/useKeys.ts';
import { playSound } from '../sound.ts';

/** Pokémon com tantas estrelas (ou mais) ganham destaque no mapa; brilhantes sempre. */
const ALERT_STARS = 3;

const stars = (n: number) => (n > 0 ? '★'.repeat(n) : '0★');
const yen = (n: number) => `₽ ${n.toLocaleString('pt-BR')}`;

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
  const [battle, setBattle] = useState<{ start: BattleTurnResult; habitat: string } | null>(null);
  const [index, setIndex] = useState<SpeciesIndexEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [levels, setLevels] = useState<[number, number] | null>(null);
  const [habitatPick, setHabitatPick] = useState('');
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    Promise.all([api.wild(saveId), api.battle(saveId)]).then(([next, running]) => {
      setState(next);
      if (running) setBattle({ start: { events: [], view: running }, habitat: next.board?.habitat ?? 'forest' });
      else if (next.board) setMessage('Você voltou ao mapa da última procura.');
    }, (e: Error) => setError(e.message));
    api.speciesIndex().then(setIndex, () => undefined);
    return () => { alive.current = false; };
  }, [saveId]);

  const board = state?.board ?? null;
  const mode: 'idle' | 'board' = board ? 'board' : 'idle';

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

  /** Faixa de nível escolhida, sempre dentro do limite liberado da região (padrão: do 2 ao máximo). */
  const rangeFor = (option: WildRegionOption | undefined): [number, number] => {
    const cap = option?.levelCap ?? DEFAULT_MIN_LEVEL;
    const [lo, hi] = levels ?? [Math.min(DEFAULT_MIN_LEVEL, cap), cap];
    const max = Math.max(MIN_WILD_LEVEL, Math.min(cap, hi));
    return [Math.max(MIN_WILD_LEVEL, Math.min(max, lo)), max];
  };

  const search = (region: string, speciesId?: number) => run(async () => {
    const option = state?.regions.find((r) => r.id === region);
    const [minLevel, maxLevel] = rangeFor(option);
    const request = { region: region as never, minLevel, maxLevel, ...(speciesId ? { speciesId } : option?.chooseHabitat && habitatPick ? { habitat: habitatPick } : {}) };
    const next = await api.wildSearch(saveId, request);
    setState(next);
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
    setStep('regions');
    setMessage('Escolha uma região para procurar POKÉMON selvagens.');
  });
  const choose = (slot: number) => run(async () => {
    const next = await api.wildChoose(saveId, slot);
    setState(next);
    const started = await api.battleStart(saveId);
    setBattle({ start: started, habitat: next.board?.habitat ?? 'forest' });
  });
  const afterBattle = async () => {
    setBattle(null);
    try {
      const next = await api.wild(saveId);
      setState(next);
      if (next.board) setMessage('De volta ao mapa. Escolha outro POKÉMON.');
      else { setStep('region'); setMessage('Procure outro POKÉMON selvagem!'); }
    } catch (e) {
      setError((e as Error).message);
    }
  };

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
    }
  }, mode === 'board' && !busy && !battle);

  if (battle) {
    return <BattleScreen key="battle" saveId={saveId} start={battle.start} habitat={battle.habitat} onExit={() => void afterBattle()} />;
  }

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
    const [lo, hi] = rangeFor(selected);
    const clamp = (n: number) => Math.max(MIN_WILD_LEVEL, Math.min(selected.levelCap, n));
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
                    extra: region.unlocked ? (region.id === 'all' ? 'Todas' : `Ger. ${region.generation}`) : '🔒',
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
                <h2 className="gb-title" style={{ fontSize: 22, marginBottom: 4 }}>{selected.id === 'all' ? selected.name : `${selected.name} · Geração ${selected.generation}`}</h2>
                {selected.unlocked ? (
                  <p style={{ margin: '0 0 8px' }}>Cada mapa mostra 10 POKÉMON soltos. Clique no que quiser enfrentar.</p>
                ) : (
                  <p className="gb-region-lock" style={{ margin: '0 0 8px' }}>
                    🔒 Bloqueada. Derrote o campeão de {previous?.name ?? 'Kanto'} para liberar.
                  </p>
                )}
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
                  {selected.id === 'all' ? <li className="gb-muted">Mistura as regiões liberadas; giros, lendários e limite de nível seguem a região mais recente.</li> : null}
                  <li>Ginásios: <b>{selected.gyms}/8</b> · Elite dos 4: <b>{selected.eliteMembers}/4</b> · Campeão: <b>{selected.champion ? '✓' : '—'}</b></li>
                  <li>Nível máximo liberado: <b>{selected.levelCap}</b></li>
                  <li>Giros por mapa: <b>{selected.spins}</b> <span className="gb-muted">(ginásio 5 · Elite dos 4 8 · campeão 12)</span></li>
                  <li>Lendários: <b>{selected.legendaries ? 'liberados' : 'derrote a Elite dos 4'}</b></li>
                  <li>Pokémon específico: <b>{selected.id === 'all' ? 'escolha uma geração' : selected.specific ? 'liberado' : 'derrote o campeão'}</b></li>
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
                        rows={actionRows(selected, rangeFor(selected), habitatPick)}
                        onBigCycle={(id, d) => cycleRow(id, d * 10)}
                        onCycle={(id, d) => cycleRow(id, d)}
                        onAction={(id) => {
                          if (id === 'search') void search(regionId);
                          else if (id === 'specific') {
                            if (selected.id === 'all') { setMessage('Escolha uma geração para procurar um POKÉMON específico.'); playSound('error'); return; }
                            if (!selected.specific) { setMessage(`Derrote o campeão de ${selected.name} para procurar um POKÉMON específico.`); playSound('error'); return; }
                            setFilter(''); setStep('species'); setMessage('Digite o nome e escolha o POKÉMON.');
                          } else setStep('regions');
                        }}
                        onBack={() => setStep('regions')}
                      />
                      <p className="gb-hint" style={{ margin: '8px 0 0' }}>
                        ←→ mudam o valor (Q/E de 10 em 10). Os níveis (1 até o máximo liberado) valem para este mapa e para os giros.
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

        <div className="gb-window gb-window--accent gb-info" role="status"><p style={{ margin: 0 }}>{busy ? 'Aguarde…' : message}</p></div>
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
    { id: 'specific', label: 'POKÉMON específico', value: region.id === 'all' ? '— por geração' : region.specific ? '' : '🔒 campeão', kind: 'action' },
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
