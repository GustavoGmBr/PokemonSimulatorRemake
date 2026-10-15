import { useEffect, useMemo, useState } from 'react';
import {
  STAT_KEYS, STAT_LABELS, buildTypeChart, defensiveMatchups, flattenEvolution, titleCase,
  type DexState, type Item, type LearnMethod, type Move, type Species, type SpeciesIndexEntry, type TypeInfo, type TypeName,
} from '@pokesim/engine';
import { api } from '../api.ts';
import { Sprite, TypeBadge } from '../ui/bits.tsx';
import { useKeys } from '../ui/useKeys.ts';
import { playSound } from '../sound.ts';

const TABS = ['info', 'stats', 'evolution', 'moves', 'forms'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { info: 'Info', stats: 'Atributos', evolution: 'Evolução', moves: 'Golpes', forms: 'Formas' };

const METHODS: LearnMethod[] = ['level-up', 'machine', 'tutor', 'egg'];
const METHOD_LABEL: Record<LearnMethod, string> = { 'level-up': 'Nível', machine: 'TM/MT', tutor: 'Tutor', egg: 'Ovo' };
const MOVE_ROWS = 8;
const CATEGORY_LABEL = { physical: 'Físico', special: 'Especial', status: 'Status' } as const;
const FORM_KIND: Record<string, string> = { mega: 'Mega Evolução', primal: 'Regressão Primal', gmax: 'Gigantamax', fusion: 'Fusão' };

const dexNumber = (id: number) => `Nº ${String(id).padStart(4, '0')}`;

interface Catalogs {
  moves: Map<string, Move>;
  items: Map<string, Item>;
  types: TypeInfo[];
}

let catalogsPromise: Promise<Catalogs> | null = null;
function loadCatalogs(): Promise<Catalogs> {
  catalogsPromise ??= Promise.all([api.moves(), api.items(), api.types()]).then(([moves, items, types]) => ({
    moves: new Map(moves.map((m) => [m.name, m])),
    items: new Map(items.map((i) => [i.name, i])),
    types,
  })).catch((error: unknown) => {
    catalogsPromise = null;
    throw error;
  });
  return catalogsPromise;
}

interface Props {
  speciesId: number;
  state: DexState;
  owned: number;
  index: SpeciesIndexEntry[];
  states: DexState[];
  onBack: () => void;
  /** vai para o vizinho na lista da Pokédex (-1 anterior, +1 próximo) */
  onStep: (delta: -1 | 1) => void;
}

/** Ficha da Pokédex: o que aparece depende de a espécie ter sido só vista ou capturada. */
export function SpeciesSheet({ speciesId, state, owned, index, states, onBack, onStep }: Props) {
  const [species, setSpecies] = useState<Species | null>(null);
  const [catalogs, setCatalogs] = useState<Catalogs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('info');
  const [method, setMethod] = useState<LearnMethod>('level-up');
  const [scroll, setScroll] = useState(0);
  const [shiny, setShiny] = useState(false);

  const full = state === 2;

  useEffect(() => {
    setSpecies(null);
    setScroll(0);
    api.species(speciesId).then(setSpecies, (e: Error) => setError(e.message));
  }, [speciesId]);
  useEffect(() => {
    loadCatalogs().then(setCatalogs, (e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!full) setTab('info');
  }, [full]);

  const moveList = useMemo(() => {
    if (!species || !catalogs) return [];
    const seen = new Set<string>();
    return species.learnset
      .filter((entry) => entry.method === method)
      .filter((entry) => {
        const key = `${entry.move}:${entry.level}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((entry) => ({ entry, move: catalogs.moves.get(entry.move) }))
      .sort((a, b) => method === 'level-up'
        ? a.entry.level - b.entry.level || a.entry.move.localeCompare(b.entry.move)
        : (a.move?.displayName ?? a.entry.move).localeCompare(b.move?.displayName ?? b.entry.move));
  }, [species, catalogs, method]);

  useKeys((key) => {
    if (key === 'back') { playSound('back'); onBack(); return; }
    if (full && key === 'prev') { setTab(TABS[(TABS.indexOf(tab) + TABS.length - 1) % TABS.length] as Tab); setScroll(0); playSound('move'); return; }
    if (full && key === 'next') { setTab(TABS[(TABS.indexOf(tab) + 1) % TABS.length] as Tab); setScroll(0); playSound('move'); return; }
    if (key === 'confirm' && tab === 'info') { setShiny((v) => !v); playSound('confirm'); return; }
    if (tab === 'moves') {
      if (key === 'left' || key === 'right') {
        const step = key === 'left' ? -1 : 1;
        setMethod(METHODS[(METHODS.indexOf(method) + step + METHODS.length) % METHODS.length] as LearnMethod);
        setScroll(0);
        playSound('move');
        return;
      }
      if (key === 'up') { setScroll((s) => Math.max(0, s - 1)); return; }
      if (key === 'down') { setScroll((s) => Math.max(0, Math.min(moveList.length - MOVE_ROWS, s + 1))); return; }
    }
    if (key === 'up') onStep(-1);
    else if (key === 'down') onStep(1);
  });

  const name = (id: number) => (states[id - 1] ? (index[id - 1]?.name ?? '???') : '?????');
  const itemName = (id: string) => catalogs?.items.get(id)?.displayName ?? titleCase(id);

  if (error) return <section className="gb-window gb-window--accent"><p>{error}</p></section>;
  if (!species || !catalogs) return <section className="gb-window"><p className="gb-muted">Carregando ficha…</p></section>;

  const stateLabel = full ? 'Capturado' : 'Visto';
  return (
    <section className="gb-window" aria-labelledby="sheet-title">
      <div className="gb-spread" style={{ alignItems: 'center', marginBottom: 8 }}>
        <h2 id="sheet-title" className="gb-title" style={{ fontSize: 26 }}>
          {dexNumber(species.id)} · {species.displayName}
        </h2>
        <span className={`gb-chip gb-chip--${full ? 'caught' : 'seen'}`}>{stateLabel}</span>
      </div>

      {full ? (
        <div className="gb-tabs" role="tablist" aria-label="Seções da ficha">
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className="gb-tab"
              onClick={() => { setTab(id); setScroll(0); }}
            >
              {TAB_LABEL[id]}
            </button>
          ))}
        </div>
      ) : null}

      {tab === 'info' ? <InfoTab species={species} owned={owned} full={full} shiny={shiny} /> : null}
      {tab === 'stats' ? <StatsTab species={species} types={catalogs.types} /> : null}
      {tab === 'evolution' ? (
        <EvolutionTab species={species} name={name} states={states} itemName={itemName} />
      ) : null}
      {tab === 'moves' ? (
        <MovesTab method={method} list={moveList} scroll={scroll} onMethod={(m) => { setMethod(m); setScroll(0); }} />
      ) : null}
      {tab === 'forms' ? <FormsTab species={species} itemName={itemName} /> : null}
    </section>
  );
}

function genderText(femaleEighths: number): string {
  if (femaleEighths < 0) return 'Sem gênero';
  const female = femaleEighths * 12.5;
  return `♂ ${(100 - female).toLocaleString('pt-BR')}% · ♀ ${female.toLocaleString('pt-BR')}%`;
}

const GROWTH_LABEL: Record<string, string> = {
  fast: 'Rápido', medium: 'Médio-rápido', 'medium-slow': 'Médio-lento', slow: 'Lento',
  'slow-then-very-fast': 'Errático', 'fast-then-very-slow': 'Flutuante',
};

function InfoTab({ species, owned, full, shiny }: { species: Species; owned: number; full: boolean; shiny: boolean }) {
  return (
    <div className="gb-row" style={{ gap: 24 }}>
      <div className="gb-side gb-stack" style={{ maxWidth: 300, alignItems: 'center', textAlign: 'center' }}>
        <div style={{ background: 'var(--sky)', border: '4px solid var(--ink)', padding: 8 }}>
          <Sprite speciesId={species.id} view="artwork" shiny={shiny} alt={species.displayName} size={240} />
        </div>
        <span style={{ display: 'flex', gap: 6 }}>{species.types.map((t) => <TypeBadge key={t} type={t} />)}</span>
        {full ? <span className="gb-hint">Z alterna a versão brilhante</span> : null}
      </div>
      <div className="gb-grow gb-stack">
        {full ? (
          <dl className="gb-facts">
            <dt>Geração</dt><dd>{species.generation}</dd>
            <dt>Altura</dt><dd>{species.height.toLocaleString('pt-BR')} m</dd>
            <dt>Peso</dt><dd>{species.weight.toLocaleString('pt-BR')} kg</dd>
            <dt>Habilidades</dt>
            <dd>{species.abilities.map((a) => `${titleCase(a.name)}${a.hidden ? ' (oculta)' : ''}`).join(' · ') || '—'}</dd>
            <dt>Gênero</dt><dd>{genderText(species.femaleEighths)}</dd>
            <dt>Captura</dt><dd>{species.captureRate}/255</dd>
            <dt>Crescimento</dt><dd>{GROWTH_LABEL[species.growthRate] ?? species.growthRate}</dd>
            <dt>EXP base</dt><dd>{species.baseExp}</dd>
            <dt>Amizade base</dt><dd>{species.baseHappiness}</dd>
            <dt>Classe</dt><dd>{species.mythical ? 'Mítico' : species.legendary ? 'Lendário' : 'Comum'}</dd>
            <dt>No seu save</dt><dd>{owned > 0 ? `${owned} exemplar${owned > 1 ? 'es' : ''}` : 'Nenhum agora'}</dd>
          </dl>
        ) : (
          <div className="gb-stack">
            <dl className="gb-facts">
              <dt>Geração</dt><dd>{species.generation}</dd>
              <dt>Tipos</dt><dd>{species.types.map((t) => <TypeBadge key={t} type={t} />)}</dd>
            </dl>
            <p className="gb-muted" style={{ margin: 0 }}>
              Você já viu este POKÉMON, mas ainda não o capturou. Capture-o para registrar a ficha completa:
              atributos, fraquezas, evolução, golpes e formas.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function StatsTab({ species, types }: { species: Species; types: TypeInfo[] }) {
  const total = STAT_KEYS.reduce((sum, key) => sum + species.baseStats[key], 0);
  const matchups = useMemo(() => defensiveMatchups(buildTypeChart(types), species.types), [types, species]);
  const groups: [string, TypeName[]][] = [
    ['Fraco ×4', matchups.quadruple], ['Fraco ×2', matchups.double], ['Resiste ×½', matchups.half],
    ['Resiste ×¼', matchups.quarter], ['Imune', matchups.immune],
  ];
  return (
    <div className="gb-row" style={{ gap: 24 }}>
      <div className="gb-grow gb-stack">
        <h3 className="gb-title" style={{ fontSize: 20 }}>Atributos base</h3>
        {STAT_KEYS.map((key) => {
          const value = species.baseStats[key];
          const color = value >= 120 ? 'var(--green)' : value >= 80 ? 'var(--yellow)' : 'var(--red)';
          return (
            <div key={key} className="gb-statrow">
              <span>{STAT_LABELS[key]}</span>
              <span style={{ textAlign: 'right' }}>{value}</span>
              <div className="gb-bar__track" aria-hidden="true">
                <div className="gb-bar__fill" style={{ width: `${Math.min(100, (value / 200) * 100)}%`, background: color }} />
              </div>
            </div>
          );
        })}
        <div className="gb-spread" style={{ borderTop: '2px solid var(--rim)', paddingTop: 6 }}>
          <span className="gb-label">Total</span><span>{total}</span>
        </div>
      </div>
      <div className="gb-grow gb-stack">
        <h3 className="gb-title" style={{ fontSize: 20 }}>Fraquezas e resistências</h3>
        {groups.map(([label, list]) => (
          <div key={label} className="gb-matchup">
            <span className="gb-label">{label}</span>
            <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {list.length ? list.map((t) => <TypeBadge key={t} type={t} />) : <span className="gb-muted">—</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EvolutionTab({ species, name, states, itemName }: {
  species: Species;
  name: (id: number) => string;
  states: DexState[];
  itemName: (id: string) => string;
}) {
  const rows = useMemo(() => flattenEvolution(species.evolutionChain, itemName), [species, itemName]);
  if (rows.length <= 1) return <p className="gb-muted">{species.displayName} não evolui nem vem de outro POKÉMON.</p>;
  return (
    <ul className="gb-stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 4 }} aria-label="Cadeia evolutiva">
      {rows.map((row, i) => {
        const known = (states[row.speciesId - 1] ?? 0) >= 1;
        return (
          <li
            key={`${row.speciesId}-${i}`}
            className={`gb-evo${row.speciesId === species.id ? ' gb-evo--current' : ''}`}
            style={{ marginLeft: row.depth * 28 }}
          >
            {row.depth > 0 ? <span aria-hidden="true" className="gb-evo__arrow">↳</span> : null}
            <span className="gb-mon__sprite gb-mon__sprite--small">
              {known ? <Sprite speciesId={row.speciesId} alt="" size={48} /> : <span className="gb-unknown" aria-hidden="true">?</span>}
            </span>
            <span className="gb-label" style={{ textTransform: 'uppercase' }}>{dexNumber(row.speciesId)} {name(row.speciesId)}</span>
            {row.requirement ? <span className="gb-muted">{row.requirement}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

function MovesTab({ method, list, scroll, onMethod }: {
  method: LearnMethod;
  list: { entry: { move: string; level: number }; move: Move | undefined }[];
  scroll: number;
  onMethod: (method: LearnMethod) => void;
}) {
  const visible = list.slice(scroll, scroll + MOVE_ROWS);
  return (
    <div className="gb-stack">
      <div className="gb-tabs" role="tablist" aria-label="Como aprende">
        {METHODS.map((m) => (
          <button key={m} type="button" role="tab" aria-selected={method === m} className="gb-tab gb-tab--small" onClick={() => onMethod(m)}>
            {METHOD_LABEL[m]}
          </button>
        ))}
        <span className="gb-hint" style={{ marginLeft: 'auto' }}>{list.length} golpes · ←→ método · ↑↓ rolar</span>
      </div>
      {list.length === 0 ? <p className="gb-muted">Nenhum golpe por este método.</p> : (
        <table className="gb-table">
          <thead>
            <tr>
              <th scope="col">{method === 'level-up' ? 'Nv' : ''}</th>
              <th scope="col">Golpe</th><th scope="col">Tipo</th><th scope="col">Classe</th>
              <th scope="col" style={{ textAlign: 'right' }}>Poder</th>
              <th scope="col" style={{ textAlign: 'right' }}>Prec.</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ entry, move }) => (
              <tr key={`${entry.move}:${entry.level}`}>
                <td>{method === 'level-up' ? (entry.level || '—') : ''}</td>
                <th scope="row">{move?.displayName ?? titleCase(entry.move)}</th>
                <td>{move ? <TypeBadge type={move.type} /> : '—'}</td>
                <td>{move ? CATEGORY_LABEL[move.category] : '—'}</td>
                <td style={{ textAlign: 'right' }}>{move && move.category !== 'status' ? move.power : '—'}</td>
                <td style={{ textAlign: 'right' }}>{move ? (move.accuracy ?? '∞') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {list.length > MOVE_ROWS ? (
        <span className="gb-hint">Mostrando {scroll + 1}–{Math.min(list.length, scroll + MOVE_ROWS)} de {list.length}</span>
      ) : null}
    </div>
  );
}

function FormsTab({ species, itemName }: { species: Species; itemName: (id: string) => string }) {
  if (species.forms.length === 0) return <p className="gb-muted">{species.displayName} não tem formas alternativas.</p>;
  return (
    <div className="gb-grid-2">
      {species.forms.map((form) => {
        const total = STAT_KEYS.reduce((sum, key) => sum + form.baseStats[key], 0);
        return (
          <div key={form.name} className="gb-window gb-window--tight gb-form">
            <span className="gb-mon__sprite"><Sprite speciesId={form.spriteId} alt={form.displayName} size={80} /></span>
            <span className="gb-stack" style={{ gap: 4 }}>
              <span className="gb-label" style={{ textTransform: 'uppercase' }}>{form.displayName}</span>
              <span className="gb-muted">{FORM_KIND[form.kind] ?? form.kind}{form.requiredItem ? ` · ${itemName(form.requiredItem)}` : ''}</span>
              <span style={{ display: 'flex', gap: 4 }}>{form.types.map((t) => <TypeBadge key={t} type={t} />)}</span>
              <span className="gb-muted">Atributos base {total}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
