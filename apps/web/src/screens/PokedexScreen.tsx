import { useEffect, useMemo, useRef, useState } from 'react';
import {
  TYPE_LABELS, TYPE_NAMES, normalizeText,
  type DexState, type PokedexView, type SpeciesIndexEntry, type TypeName,
} from '@pokesim/engine';
import { api } from '../api.ts';
import { KeyHints, Sprite, TypeBadge } from '../ui/bits.tsx';
import { useKeys } from '../ui/useKeys.ts';
import { playSound } from '../sound.ts';
import { SpeciesSheet } from './SpeciesSheet.tsx';

type Status = 'all' | 'caught' | 'seen' | 'missing';
const STATUSES: Status[] = ['all', 'caught', 'seen', 'missing'];
const STATUS_LABEL: Record<Status, string> = { all: 'Todos', caught: 'Capturados', seen: 'Só vistos', missing: 'Faltando' };
const VISIBLE_ROWS = 12;

interface Filters {
  text: string;
  generation: number;
  status: Status;
  type: '' | TypeName;
}
const NO_FILTERS: Filters = { text: '', generation: 0, status: 'all', type: '' };

function cycle<T>(list: readonly T[], value: T, direction: 1 | -1): T {
  return list[(list.indexOf(value) + direction + list.length) % list.length] as T;
}

interface Props {
  saveId: string;
  onBack: () => void;
}

export function PokedexScreen({ saveId, onBack }: Props) {
  const [dex, setDex] = useState<PokedexView | null>(null);
  const [index, setIndex] = useState<SpeciesIndexEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [cursor, setCursor] = useState(0);
  const [view, setView] = useState<'list' | 'sheet'>('list');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([api.pokedex(saveId), api.speciesIndex()]).then(([d, i]) => { setDex(d); setIndex(i); }, (e: Error) => setError(e.message));
  }, [saveId]);

  const filtered = useMemo(() => {
    if (!dex || !index) return [];
    const text = normalizeText(filters.text.replace(/^#/, ''));
    return index.filter((entry) => {
      const state = dex.states[entry.id - 1] ?? 0;
      if (filters.generation && entry.generation !== filters.generation) return false;
      if (filters.status === 'caught' && state !== 2) return false;
      if (filters.status === 'seen' && state !== 1) return false;
      if (filters.status === 'missing' && state !== 0) return false;
      // tipo e nome só valem para espécies já vistas: filtrar não pode "vazar" quem ainda é um mistério
      if (filters.type && (state === 0 || !entry.types.includes(filters.type))) return false;
      if (text) {
        const byNumber = String(entry.id).includes(text);
        const byName = state > 0 && normalizeText(entry.name).includes(text);
        if (!byNumber && !byName) return false;
      }
      return true;
    });
  }, [dex, index, filters]);

  const current = Math.min(cursor, Math.max(0, filtered.length - 1));
  const selected = filtered[current] ?? null;
  const selectedState: DexState = selected && dex ? (dex.states[selected.id - 1] ?? 0) : 0;

  const move = (delta: number) => {
    if (filtered.length === 0) return;
    setCursor((c) => Math.max(0, Math.min(filtered.length - 1, Math.min(c, filtered.length - 1) + delta)));
    playSound('move');
  };
  const jumpGeneration = (direction: 1 | -1) => {
    setFilters((f) => ({ ...f, generation: cycle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], f.generation, direction) }));
    setCursor(0);
    playSound('move');
  };

  useKeys((key) => {
    if (key === 'up') move(-1);
    else if (key === 'down') move(1);
    else if (key === 'left') move(-VISIBLE_ROWS);
    else if (key === 'right') move(VISIBLE_ROWS);
    else if (key === 'prev') jumpGeneration(-1);
    else if (key === 'next') jumpGeneration(1);
    else if (key === 'filter') { searchRef.current?.focus(); playSound('confirm'); }
    else if (key === 'confirm') {
      if (selected && selectedState > 0) { setView('sheet'); playSound('confirm'); }
      else playSound('error');
    } else if (key === 'back') { playSound('back'); onBack(); }
  }, view === 'list' && Boolean(dex && index));

  if (error) {
    return (
      <main className="gb-screen"><div className="gb-stage">
        <div className="gb-window gb-window--accent gb-dialog"><p>{error}</p></div>
        <button type="button" className="gb-button" onClick={onBack}>Voltar</button>
      </div></main>
    );
  }
  if (!dex || !index) {
    return <main className="gb-screen"><div className="gb-stage"><div className="gb-window gb-dialog"><p>Carregando a Pokédex…</p></div></div></main>;
  }

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setCursor(0);
  };
  const activeFilters = (filters.text ? 1 : 0) + (filters.generation ? 1 : 0) + (filters.status !== 'all' ? 1 : 0) + (filters.type ? 1 : 0);

  if (view === 'sheet' && selected) {
    return (
      <main className="gb-screen"><div className="gb-stage">
        <SpeciesSheet
          key={selected.id}
          speciesId={selected.id}
          state={selectedState}
          owned={dex.owned[selected.id] ?? 0}
          index={index}
          states={dex.states}
          onBack={() => setView('list')}
          onStep={(delta) => {
            // pula espécies ainda desconhecidas ao navegar pela ficha
            let next = current + delta;
            while (next >= 0 && next < filtered.length && (dex.states[(filtered[next]?.id ?? 1) - 1] ?? 0) === 0) next += delta;
            if (next >= 0 && next < filtered.length) { setCursor(next); playSound('move'); }
          }}
        />
        <KeyHints hints={[['↑↓', 'anterior / próximo'], ['Q E', 'seções'], ['X', 'voltar']]} />
      </div></main>
    );
  }

  // janela de linhas ao redor do cursor
  const start = Math.max(0, Math.min(current - Math.floor(VISIBLE_ROWS / 2), filtered.length - VISIBLE_ROWS));
  const visible = filtered.slice(start, start + VISIBLE_ROWS);
  const percent = Math.round((dex.caught / dex.total) * 100);

  return (
    <main className="gb-screen">
      <div className="gb-stage">
        <header className="gb-window gb-spread" style={{ alignItems: 'center', padding: '10px 20px' }}>
          <h1 className="gb-title" style={{ fontSize: 26 }}>Pokédex nacional</h1>
          <span style={{ display: 'flex', gap: 22, fontSize: 24 }}>
            <span>VISTOS {dex.seen}</span>
            <span>CAPTURADOS {dex.caught}/{dex.total}</span>
            <span className="gb-muted">{percent}%</span>
          </span>
        </header>

        <section className="gb-window gb-dexfilter" aria-label="Filtros da Pokédex">
          <div className="gb-dexfilter__top">
            <input
              ref={searchRef}
              className="gb-input gb-dexfilter__search"
              type="search"
              value={filters.text}
              placeholder="Buscar por nome ou nº (F)"
              aria-label="Buscar por nome ou número"
              maxLength={30}
              spellCheck={false}
              onChange={(event) => setFilter('text', event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' || event.key === 'Enter' || event.key === 'ArrowDown') {
                  event.preventDefault();
                  event.stopPropagation();
                  event.currentTarget.blur();
                }
              }}
            />
            <span className="gb-muted gb-dexfilter__count">{filtered.length.toLocaleString('pt-BR')} na lista</span>
            <button type="button" className="gb-button gb-dexfilter__clear" disabled={activeFilters === 0} onClick={() => { setFilters(NO_FILTERS); setCursor(0); playSound('back'); }}>
              Limpar{activeFilters ? ` (${activeFilters})` : ''}
            </button>
          </div>
          <div className="gb-dexfilter__row" role="group" aria-label="Registro">
            <span className="gb-label">Registro</span>
            {STATUSES.map((status) => (
              <button key={status} type="button" className="gb-pill" aria-pressed={filters.status === status} onClick={() => { setFilter('status', status); playSound('move'); }}>
                {STATUS_LABEL[status]}
              </button>
            ))}
          </div>
          <div className="gb-dexfilter__row" role="group" aria-label="Geração">
            <span className="gb-label">Geração</span>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((generation) => (
              <button key={generation} type="button" className="gb-pill" aria-pressed={filters.generation === generation} onClick={() => { setFilter('generation', generation); playSound('move'); }}>
                {generation === 0 ? 'Todas' : generation}
              </button>
            ))}
          </div>
          <div className="gb-dexfilter__row" role="group" aria-label="Tipo">
            <span className="gb-label">Tipo</span>
            <button type="button" className="gb-pill" aria-pressed={filters.type === ''} onClick={() => { setFilter('type', ''); playSound('move'); }}>Todos</button>
            {TYPE_NAMES.map((type) => (
              <button key={type} type="button" className={`gb-pill gb-pill--type gb-type gb-type--${type}`} aria-pressed={filters.type === type} onClick={() => { setFilter('type', filters.type === type ? '' : type); playSound('move'); }}>
                {TYPE_LABELS[type]}
              </button>
            ))}
          </div>
          <p className="gb-muted gb-dexfilter__note">Nome e tipo só enxergam POKÉMON que você já viu; o resto continua um mistério. Q/E trocam a geração.</p>
        </section>

          <div className="gb-row" style={{ alignItems: 'flex-start' }}>
            <nav className="gb-window gb-side" style={{ maxWidth: 420 }} aria-label="Lista da Pokédex">
              <div className="gb-spread" style={{ marginBottom: 6 }}>
                <span className="gb-label">{filters.generation ? `Geração ${filters.generation}` : 'Todas as gerações'}</span>
                <span className="gb-muted">{filtered.length ? `${current + 1}/${filtered.length}` : '0'}</span>
              </div>
              {filtered.length === 0 ? <p className="gb-muted">Nada com esses filtros. Ajuste os filtros acima.</p> : null}
              <ul className="gb-menu">
                {visible.map((entry) => {
                  const state = dex.states[entry.id - 1] ?? 0;
                  const isCurrent = entry.id === selected?.id;
                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        className="gb-menu__item gb-dex-row"
                        aria-current={isCurrent}
                        onMouseEnter={() => setCursor(filtered.indexOf(entry))}
                        onClick={() => { setCursor(filtered.indexOf(entry)); if (state > 0) setView('sheet'); }}
                      >
                        <span className="gb-cursor" aria-hidden="true">▶</span>
                        <span className="gb-dex-row__num">{String(entry.id).padStart(4, '0')}</span>
                        <span className="gb-dex-row__ball" role="img" aria-label={state === 2 ? 'Capturado' : state === 1 ? 'Visto' : 'Não visto'}>
                          {state === 2 ? '●' : state === 1 ? '○' : '·'}
                        </span>
                        <span>{state > 0 ? entry.name : '?????'}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <section className="gb-window gb-window--sky gb-grow gb-preview" aria-label="Pré-visualização" style={{ border: '4px solid var(--ink)' }}>
              {selected ? (
                <>
                  <div className="gb-preview__art">
                    {selectedState > 0
                      ? <Sprite speciesId={selected.id} view="artwork" alt={selected.name} size={260} />
                      : <span className="gb-unknown gb-unknown--big" aria-hidden="true">?</span>}
                  </div>
                  <div className="gb-window gb-window--tight" style={{ width: '100%' }}>
                    <div className="gb-spread">
                      <span className="gb-label" style={{ fontSize: 24, textTransform: 'uppercase' }}>
                        Nº {String(selected.id).padStart(4, '0')} {selectedState > 0 ? selected.name : '?????'}
                      </span>
                      <span className={`gb-chip gb-chip--${selectedState === 2 ? 'caught' : selectedState === 1 ? 'seen' : 'unknown'}`}>
                        {selectedState === 2 ? 'Capturado' : selectedState === 1 ? 'Visto' : 'Não visto'}
                      </span>
                    </div>
                    {selectedState > 0 ? (
                      <div className="gb-spread" style={{ marginTop: 6 }}>
                        <span style={{ display: 'flex', gap: 6 }}>{selected.types.map((t) => <TypeBadge key={t} type={t} />)}</span>
                        <span className="gb-muted">Geração {selected.generation}{selectedState === 2 ? ` · Total base ${selected.baseStatTotal}` : ''}</span>
                      </div>
                    ) : <p className="gb-muted" style={{ margin: '6px 0 0' }}>Encontre este POKÉMON para registrá-lo.</p>}
                  </div>
                </>
              ) : null}
            </section>
          </div>

        <KeyHints hints={[['↑↓', 'mover'], ['←→', 'pular 12'], ['Q E', 'geração'], ['F', 'buscar'], ['Z', 'abrir ficha'], ['X', 'voltar']]}
        />

      </div>
    </main>
  );
}
