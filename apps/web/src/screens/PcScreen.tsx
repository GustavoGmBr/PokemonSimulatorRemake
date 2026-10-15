import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BOX_SIZE, MAX_BOX_INDEX, MAX_NICKNAME, SORT_KEYS, TEAM_SIZE, TYPE_LABELS, TYPE_NAMES,
  type BoxView, type PokemonView, type SearchPokemonQuery, type SortKey,
} from '@pokesim/engine';
import { api } from '../api.ts';
import { Menu, type MenuItem } from '../ui/Menu.tsx';
import { FilterPanel, type FilterRow } from '../ui/FilterPanel.tsx';
import { TextPrompt } from '../ui/TextPrompt.tsx';
import { PokemonSummary, locationLabel } from '../ui/PokemonSummary.tsx';
import { HpBar, KeyHints, Sprite, Stars, TypeBadge } from '../ui/bits.tsx';
import { useKeys } from '../ui/useKeys.ts';
import { playSound } from '../sound.ts';

const COLUMNS = 6;
const ROWS = BOX_SIZE / COLUMNS;
const PAGE_SIZE = 10;

type Mode = 'main' | 'search' | 'summary';
type Prompt = 'nickname' | 'goto' | 'text' | null;
type Tri = 'any' | 'yes' | 'no';

interface Filters {
  text: string;
  type: string;
  generation: number;
  shiny: Tri;
  favorite: Tri;
  minStars: number;
  minLevel: number;
  maxLevel: number;
  sort: SortKey;
  dir: 'asc' | 'desc';
}

const NO_FILTERS: Filters = {
  text: '', type: '', generation: 0, shiny: 'any', favorite: 'any', minStars: 0, minLevel: 0, maxLevel: 0, sort: 'recent', dir: 'desc',
};
const LEVEL_STEPS = [0, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100];
const TRI: Tri[] = ['any', 'yes', 'no'];
const SORT_LABEL: Record<SortKey, string> = { recent: 'Mais recentes', level: 'Nível', iv: 'Total de IVs', dex: 'Nº da Pokédex', name: 'Nome' };

function cycle<T>(list: readonly T[], value: T, direction: 1 | -1): T {
  const index = list.indexOf(value);
  return list[(index + direction + list.length) % list.length] as T;
}

function toQuery(filters: Filters, offset: number): SearchPokemonQuery {
  return {
    ...(filters.text ? { text: filters.text } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.generation ? { generation: filters.generation } : {}),
    ...(filters.shiny !== 'any' ? { shiny: filters.shiny === 'yes' } : {}),
    ...(filters.favorite !== 'any' ? { favorite: filters.favorite === 'yes' } : {}),
    ...(filters.minStars ? { minStars: filters.minStars } : {}),
    ...(filters.minLevel ? { minLevel: filters.minLevel } : {}),
    ...(filters.maxLevel ? { maxLevel: filters.maxLevel } : {}),
    sort: filters.sort,
    dir: filters.dir,
    limit: PAGE_SIZE,
    offset,
  };
}

const triLabel = (value: Tri, yes: string, no: string) => (value === 'any' ? 'Tanto faz' : value === 'yes' ? yes : no);

interface Props {
  saveId: string;
  onBack: () => void;
  onOpenSell: () => void;
}

export function PcScreen({ saveId, onBack, onOpenSell }: Props) {
  const [team, setTeam] = useState<PokemonView[]>([]);
  const [trainer, setTrainer] = useState('');
  const [boxNo, setBoxNo] = useState(0);
  const [box, setBox] = useState<BoxView | null>(null);
  const [zone, setZone] = useState<'team' | 'box'>('box');
  const [cursor, setCursor] = useState(0);
  const [carrying, setCarrying] = useState<PokemonView | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [mode, setMode] = useState<Mode>('main');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [devTools, setDevTools] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);

  // busca
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [page, setPage] = useState(0);
  const [results, setResults] = useState<{ total: number; items: PokemonView[] }>({ total: 0, items: [] });
  const [resultIndex, setResultIndex] = useState(0);
  const [searchZone, setSearchZone] = useState<'filters' | 'results'>('filters');
  const [summaryOf, setSummaryOf] = useState<PokemonView | null>(null);
  const prevModeRef = useRef<Mode>('main');

  const reload = useCallback(async () => {
    const [save, boxView] = await Promise.all([api.getSave(saveId), api.box(saveId, boxNo)]);
    setTeam(save.team);
    setTrainer(save.trainerName);
    setBox(boxView);
  }, [saveId, boxNo]);

  useEffect(() => {
    reload().catch((e: Error) => setFatal(e.message));
  }, [reload]);
  useEffect(() => {
    api.health().then((h) => setDevTools(h.devTools), () => setDevTools(false));
  }, []);

  // ---- busca com pequena espera enquanto o jogador mexe nos filtros ----
  const searchSeq = useRef(0);
  const refreshSearch = useCallback(() => {
    const seq = ++searchSeq.current;
    api.search(saveId, toQuery(filters, page * PAGE_SIZE)).then((result) => {
      if (seq !== searchSeq.current) return;
      const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
      if (page >= pages) setPage(pages - 1);
      setResults(result);
      setResultIndex((i) => Math.min(i, Math.max(0, result.items.length - 1)));
    }, (e: Error) => setMessage(e.message));
  }, [saveId, filters, page]);
  useEffect(() => {
    if (mode === 'main') return;
    const timer = window.setTimeout(refreshSearch, 150);
    return () => window.clearTimeout(timer);
  }, [mode, refreshSearch]);

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(0);
    setResultIndex(0);
  };

  const guarded = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (e) {
      setMessage((e as Error).message);
      playSound('error');
    } finally {
      setBusy(false);
    }
  };

  // ---- quem está sob o cursor ----
  const boxSlots = box?.slots ?? Array.from({ length: BOX_SIZE }, () => null);
  const hovered: PokemonView | null = mode === 'search'
    ? (searchZone === 'results' ? results.items[resultIndex] ?? null : null)
    : zone === 'team' ? team[cursor] ?? null : boxSlots[cursor] ?? null;
  const target: PokemonView | null = mode === 'summary' ? summaryOf : hovered;

  const overlay = menuOpen || prompt !== null || mode === 'summary';
  const mainActive = mode === 'main' && !overlay && !busy;
  const searchActive = mode === 'search' && !overlay && !busy;

  const refreshAll = async () => {
    await reload();
    if (mode !== 'main') refreshSearch();
  };

  const drop = () => guarded(async () => {
    if (!carrying) return;
    if (hovered?.id === carrying.id) { setCarrying(null); return; }
    const to = zone === 'team'
      ? { kind: 'team' as const, slot: cursor }
      : { kind: 'box' as const, box: boxNo, slot: cursor };
    await api.movePokemon(saveId, carrying.id, to);
    playSound('save');
    setMessage(`${carrying.name} foi ${zone === 'team' ? 'para a equipe' : `para a caixa ${boxNo + 1}`}.`);
    setCarrying(null);
    await reload();
  });

  const goToBox = (next: number) => {
    const clamped = Math.max(0, Math.min(MAX_BOX_INDEX, next));
    if (clamped !== boxNo) { setBoxNo(clamped); playSound('move'); }
  };

  useKeys((key) => {
    if (key === 'up' || key === 'down') {
      const delta = key === 'up' ? -1 : 1;
      if (zone === 'team') setCursor((c) => Math.max(0, Math.min(TEAM_SIZE - 1, c + delta)));
      else setCursor((c) => (c + delta * COLUMNS + BOX_SIZE) % BOX_SIZE);
      playSound('move');
    } else if (key === 'left') {
      if (zone === 'box') {
        if (cursor % COLUMNS === 0) { setZone('team'); setCursor(Math.min(Math.floor(cursor / COLUMNS), TEAM_SIZE - 1)); }
        else setCursor((c) => c - 1);
        playSound('move');
      }
    } else if (key === 'right') {
      if (zone === 'team') { setZone('box'); setCursor(Math.min(cursor, ROWS - 1) * COLUMNS); playSound('move'); }
      else if (cursor % COLUMNS < COLUMNS - 1) { setCursor((c) => c + 1); playSound('move'); }
    } else if (key === 'prev') goToBox(boxNo - 1);
    else if (key === 'next') goToBox(boxNo + 1);
    else if (key === 'confirm') {
      if (carrying) void drop();
      else if (hovered) { setMenuOpen(true); playSound('confirm'); }
    } else if (key === 'back') {
      if (carrying) { setCarrying(null); playSound('back'); }
      else { playSound('back'); onBack(); }
    } else if (key === 'filter') { setMode('search'); setSearchZone('filters'); playSound('confirm'); }
    else if (key === 'goto') setPrompt('goto');
    else if (key === 'tool' && devTools) {
      void guarded(async () => {
        const result = await api.devGrant(saveId, 12);
        setMessage(`[TESTE] +${result.added} Pokémon aleatórios (${result.inTeam} na equipe, ${result.inBoxes} no PC).`);
        await reload();
      });
    }
  }, mainActive);

  // troca de zona/página na busca
  useKeys((key) => {
    if (key === 'prev' || key === 'next') {
      if (searchZone === 'filters' && key === 'next') setSearchZone('results');
      else if (searchZone === 'results' && key === 'prev') setSearchZone('filters');
      playSound('move');
    }
  }, searchActive);

  useKeys((key) => {
    const n = results.items.length;
    const pages = Math.max(1, Math.ceil(results.total / PAGE_SIZE));
    if (key === 'up' && n) { setResultIndex((i) => (i + n - 1) % n); playSound('move'); }
    else if (key === 'down' && n) { setResultIndex((i) => (i + 1) % n); playSound('move'); }
    else if (key === 'left' && page > 0) { setPage(page - 1); playSound('move'); }
    else if (key === 'right' && page < pages - 1) { setPage(page + 1); playSound('move'); }
    else if (key === 'confirm' && hovered) { setMenuOpen(true); playSound('confirm'); }
    else if (key === 'back') { setSearchZone('filters'); playSound('back'); }
  }, searchActive && searchZone === 'results');

  // ---- ações sobre o Pokémon selecionado ----
  const actions = useMemo<MenuItem[]>(() => {
    if (!target) return [];
    return [
      mode === 'search'
        ? { id: 'goto', label: 'Ir até ele' }
        : { id: 'move', label: 'Mover' },
      { id: 'summary', label: 'Resumo' },
      { id: 'nickname', label: 'Apelido' },
      { id: 'favorite', label: target.favorite ? 'Desfavoritar' : 'Favoritar' },
      { id: 'cancel', label: 'Cancelar' },
    ];
  }, [target, mode]);

  const onAction = (id: string) => {
    const mon = hovered;
    setMenuOpen(false);
    if (!mon) return;
    if (id === 'move') setCarrying(mon);
    else if (id === 'summary') { prevModeRef.current = mode; setSummaryOf(mon); setMode('summary'); }
    else if (id === 'nickname') setPrompt('nickname');
    else if (id === 'favorite') {
      void guarded(async () => {
        await api.updatePokemon(saveId, mon.id, { favorite: !mon.favorite });
        setMessage(`${mon.name} ${mon.favorite ? 'deixou de ser' : 'agora é'} favorito.`);
        await refreshAll();
      });
    } else if (id === 'goto') {
      const loc = mon.location;
      if (loc.kind === 'team') { setZone('team'); setCursor(loc.slot); }
      else { setBoxNo(loc.box); setZone('box'); setCursor(loc.slot); }
      setMode('main');
    }
  };

  // ---- linhas de filtro ----
  const rows: FilterRow[] = [
    { id: 'text', label: 'Nome / Nº', value: filters.text || 'Todos', kind: 'text' },
    { id: 'type', label: 'Tipo', value: filters.type ? TYPE_LABELS[filters.type as keyof typeof TYPE_LABELS] : 'Todos', kind: 'cycle' },
    { id: 'generation', label: 'Geração', value: filters.generation ? `Geração ${filters.generation}` : 'Todas', kind: 'cycle' },
    { id: 'shiny', label: 'Brilhante', value: triLabel(filters.shiny, 'Só brilhantes', 'Sem brilhantes'), kind: 'cycle' },
    { id: 'minStars', label: 'Estrelas (IV)', value: filters.minStars ? `${'★'.repeat(filters.minStars)} ou mais` : 'Qualquer', kind: 'cycle' },
    { id: 'minLevel', label: 'Nível mínimo', value: filters.minLevel ? `Nv ${filters.minLevel}` : 'Qualquer', kind: 'cycle' },
    { id: 'maxLevel', label: 'Nível máximo', value: filters.maxLevel ? `Nv ${filters.maxLevel}` : 'Qualquer', kind: 'cycle' },
    { id: 'favorite', label: 'Favoritos', value: triLabel(filters.favorite, 'Só favoritos', 'Sem favoritos'), kind: 'cycle' },
    { id: 'sort', label: 'Ordenar por', value: SORT_LABEL[filters.sort], kind: 'cycle' },
    { id: 'dir', label: 'Ordem', value: filters.dir === 'desc' ? 'Maior → menor' : 'Menor → maior', kind: 'cycle' },
    { id: 'clear', label: 'Limpar filtros', value: '', kind: 'action' },
  ];

  const onCycle = (id: string, direction: 1 | -1) => {
    switch (id) {
      case 'type': setFilter('type', cycle(['', ...TYPE_NAMES], filters.type, direction)); break;
      case 'generation': setFilter('generation', cycle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], filters.generation, direction)); break;
      case 'shiny': setFilter('shiny', cycle(TRI, filters.shiny, direction)); break;
      case 'favorite': setFilter('favorite', cycle(TRI, filters.favorite, direction)); break;
      case 'minStars': setFilter('minStars', cycle([0, 1, 2, 3, 4], filters.minStars, direction)); break;
      case 'minLevel': setFilter('minLevel', cycle(LEVEL_STEPS, filters.minLevel, direction)); break;
      case 'maxLevel': setFilter('maxLevel', cycle(LEVEL_STEPS, filters.maxLevel, direction)); break;
      case 'sort': setFilter('sort', cycle(SORT_KEYS, filters.sort, direction)); break;
      case 'dir': setFilter('dir', filters.dir === 'desc' ? 'asc' : 'desc'); break;
      default: break;
    }
  };

  if (fatal) {
    return (
      <main className="gb-screen"><div className="gb-stage">
        <div className="gb-window gb-window--accent gb-dialog"><p>{fatal}</p></div>
        <button type="button" className="gb-button" onClick={onBack}>Voltar</button>
      </div></main>
    );
  }

  if (mode === 'summary' && summaryOf) {
    return (
      <main className="gb-screen"><div className="gb-stage">
        <PokemonSummary mon={summaryOf} saveId={saveId} onChanged={(next) => { setSummaryOf(next); void refreshAll(); }} onBack={() => { setMode(prevModeRef.current); setSummaryOf(null); }} />
        <KeyHints hints={[['Z / X', 'voltar']]} />
      </div></main>
    );
  }

  const pages = Math.max(1, Math.ceil(results.total / PAGE_SIZE));
  const boxCountInView = boxSlots.filter(Boolean).length;
  const info = carrying
    ? `Levando ${carrying.name}. Escolha o destino e aperte Z (X cancela).`
    : message || (mode === 'search' ? 'Filtre e ordene todos os seus Pokémon.' : 'Z em um Pokémon abre as ações. Q/E trocam de caixa.');

  return (
    <main className="gb-screen">
      <div className="gb-stage">
        <header className="gb-window gb-spread" style={{ alignItems: 'center', padding: '10px 20px' }}>
          <h1 className="gb-title" style={{ fontSize: 26 }}>PC de {trainer || '…'}</h1>
          <span className="gb-row" style={{ alignItems: 'center', gap: 12 }}>
            <span className="gb-muted">{box ? `${box.totalInBoxes.toLocaleString('pt-BR')} no PC · ${team.length}/${TEAM_SIZE} na equipe` : 'Carregando…'}</span>
            <button type="button" className="gb-button" onClick={onOpenSell} disabled={Boolean(carrying)}>Vender…</button>
          </span>
        </header>

        {mode === 'main' ? (
          <div className="gb-row" style={{ alignItems: 'flex-start' }}>
            <section className="gb-window gb-window--sky gb-side" style={{ maxWidth: 330, border: '4px solid var(--ink)' }} aria-label="Equipe">
              <h2 className="gb-title gb-title--shadow" style={{ fontSize: 20, marginBottom: 8 }}>Equipe</h2>
              <div className="gb-stack" style={{ gap: 6 }}>
                {Array.from({ length: TEAM_SIZE }, (_, i) => {
                  const mon = team[i];
                  const selected = zone === 'team' && cursor === i;
                  return mon ? (
                    <button
                      key={mon.id}
                      type="button"
                      className={`gb-mon gb-mon--compact${carrying?.id === mon.id ? ' gb-mon--lifted' : ''}`}
                      aria-current={selected}
                      onClick={() => { setZone('team'); setCursor(i); if (carrying) void drop(); else setMenuOpen(true); }}
                    >
                      <span className="gb-mon__sprite gb-mon__sprite--small"><Sprite speciesId={mon.spriteId} shiny={mon.shiny} alt="" size={48} /></span>
                      <span className="gb-mon__body">
                        <span className="gb-mon__head">
                          <span>{mon.favorite ? <span className="gb-fav">♥</span> : null} {mon.name}</span>
                          <span>Nv{mon.level}</span>
                        </span>
                        <HpBar current={mon.currentHp} max={mon.stats.hp} />
                      </span>
                    </button>
                  ) : (
                    <button
                      key={`empty-${i}`}
                      type="button"
                      className="gb-mon gb-mon--compact gb-mon--empty"
                      aria-current={selected}
                      onClick={() => { setZone('team'); setCursor(i); if (carrying) void drop(); }}
                    >
                      <span className="gb-muted">— vazio —</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="gb-window gb-grow" aria-label={`Caixa ${boxNo + 1}`}>
              <div className="gb-spread" style={{ alignItems: 'center', marginBottom: 8 }}>
                <button type="button" className="gb-button" onClick={() => goToBox(boxNo - 1)} disabled={boxNo === 0} aria-label="Caixa anterior">◀</button>
                <button type="button" className="gb-title gb-box-title" onClick={() => setPrompt('goto')} title="Ir para a caixa… (G)">
                  Caixa {boxNo + 1} <span className="gb-muted" style={{ fontSize: 18 }}>{boxCountInView}/{BOX_SIZE}</span>
                </button>
                <button type="button" className="gb-button" onClick={() => goToBox(boxNo + 1)} disabled={boxNo >= MAX_BOX_INDEX} aria-label="Próxima caixa">▶</button>
              </div>
              <div className="gb-box-grid" role="grid" aria-label={`Caixa ${boxNo + 1}`}>
                {boxSlots.map((mon, i) => (
                  <button
                    key={i}
                    type="button"
                    role="gridcell"
                    className={`gb-cell${mon && carrying?.id === mon.id ? ' gb-cell--lifted' : ''}`}
                    aria-current={zone === 'box' && cursor === i}
                    aria-label={mon ? `${mon.name}, nível ${mon.level}` : 'Vaga vazia'}
                    onMouseEnter={() => { if (!overlay) { setZone('box'); setCursor(i); } }}
                    onClick={() => { setZone('box'); setCursor(i); if (carrying) void drop(); else if (mon) setMenuOpen(true); }}
                  >
                    {mon ? <Sprite speciesId={mon.spriteId} shiny={mon.shiny} alt="" size={56} /> : null}
                    {mon?.favorite ? <span className="gb-cell__fav" aria-hidden="true">♥</span> : null}
                    {mon?.shiny ? <span className="gb-cell__shiny" aria-hidden="true">✦</span> : null}
                  </button>
                ))}
              </div>
            </section>
          </div>
        ) : (
          <div className="gb-row" style={{ alignItems: 'flex-start' }}>
            <div className="gb-side" style={{ maxWidth: 470 }}>
              <FilterPanel
                title="Filtros"
                rows={rows}
                active={searchActive && searchZone === 'filters'}
                onCycle={onCycle}
                onEdit={() => setPrompt('text')}
                onAction={() => { setFilters(NO_FILTERS); setPage(0); }}
                onBack={() => { setMode('main'); setMessage(''); }}
              />
            </div>
            <section className="gb-window gb-grow" aria-label="Resultados">
              <div className="gb-spread" style={{ marginBottom: 6 }}>
                <h2 className="gb-title" style={{ fontSize: 20 }}>{results.total.toLocaleString('pt-BR')} encontrados</h2>
                <span className="gb-muted">Página {page + 1}/{pages}</span>
              </div>
              {results.items.length === 0 ? <p className="gb-muted">Nenhum Pokémon com esses filtros.</p> : null}
              <ul className="gb-stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 4 }}>
                {results.items.map((mon, i) => (
                  <li key={mon.id}>
                    <button
                      type="button"
                      className="gb-mon gb-mon--compact"
                      aria-current={searchZone === 'results' && i === resultIndex}
                      onClick={() => { setSearchZone('results'); setResultIndex(i); setMenuOpen(true); }}
                      onMouseEnter={() => { if (!overlay) { setSearchZone('results'); setResultIndex(i); } }}
                    >
                      <span className="gb-mon__sprite gb-mon__sprite--small"><Sprite speciesId={mon.spriteId} shiny={mon.shiny} alt="" size={48} /></span>
                      <span className="gb-mon__body">
                        <span className="gb-mon__head">
                          <span>{mon.favorite ? <span className="gb-fav">♥</span> : null} {mon.name}{mon.shiny ? ' ✦' : ''}</span>
                          <span>Nv{mon.level}</span>
                        </span>
                        <span className="gb-spread" style={{ fontSize: 18 }}>
                          <span style={{ display: 'flex', gap: 4 }}>{mon.types.map((t) => <TypeBadge key={t} type={t} />)}</span>
                          <Stars count={mon.ivStars} />
                          <span className="gb-muted">{locationLabel(mon)}</span>
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}

        <div className="gb-row" style={{ alignItems: 'stretch' }}>
          <div className="gb-window gb-window--accent gb-info gb-grow" role="status">
            {target && !carrying ? <MonInfo mon={target} /> : null}
            <p style={{ margin: 0 }}>{busy ? 'Aguarde…' : info}</p>
          </div>
          {menuOpen && target ? (
            <div className="gb-window gb-side" style={{ maxWidth: 260 }}>
              <Menu label={`Ações de ${target.name}`} items={actions} onSelect={onAction} onBack={() => setMenuOpen(false)} />
            </div>
          ) : null}
        </div>

        {mode === 'main' ? (
          <KeyHints hints={[['↑↓←→', 'mover'], ['Z', 'ações / soltar'], ['X', 'voltar'], ['Q E', 'caixa'], ['G', 'ir p/ caixa'], ['F', 'buscar'], ...(devTools ? [['T', '+12 teste'] as [string, string]] : [])]} />
        ) : (
          <KeyHints hints={[['↑↓', 'linha'], ['←→', 'valor / página'], ['E', 'resultados'], ['Q', 'filtros'], ['Z', 'ações'], ['X', 'voltar']]} />
        )}

        {prompt === 'nickname' && hovered ? (
          <TextPrompt
            label={`Apelido de ${hovered.speciesName} (vazio remove)`}
            initial={hovered.nickname ?? ''}
            maxLength={MAX_NICKNAME}
            onCancel={() => setPrompt(null)}
            onSubmit={(value) => {
              const mon = hovered;
              setPrompt(null);
              void guarded(async () => {
                await api.updatePokemon(saveId, mon.id, { nickname: value });
                setMessage(value.trim() ? `${mon.speciesName} agora se chama ${value.trim()}.` : `${mon.speciesName} voltou ao nome original.`);
                await refreshAll();
              });
            }}
          />
        ) : null}
        {prompt === 'goto' ? (
          <TextPrompt
            label="Ir para qual caixa?"
            initial={String(boxNo + 1)}
            maxLength={5}
            inputMode="numeric"
            placeholder="1"
            onCancel={() => setPrompt(null)}
            onSubmit={(value) => {
              setPrompt(null);
              const n = Number.parseInt(value, 10);
              if (Number.isFinite(n) && n >= 1) goToBox(n - 1);
              else setMessage('Digite o número de uma caixa (1 ou mais).');
            }}
          />
        ) : null}
        {prompt === 'text' ? (
          <TextPrompt
            label="Buscar por nome, apelido ou nº"
            initial={filters.text}
            maxLength={30}
            submitLabel="Buscar"
            onCancel={() => setPrompt(null)}
            onSubmit={(value) => { setPrompt(null); setFilter('text', value.trim()); }}
          />
        ) : null}
      </div>
    </main>
  );
}

function MonInfo({ mon }: { mon: PokemonView }) {
  return (
    <div className="gb-spread" style={{ alignItems: 'center', marginBottom: 6 }}>
      <span className="gb-label" style={{ fontSize: 22, textTransform: 'uppercase' }}>
        {mon.favorite ? <span className="gb-fav">♥ </span> : null}{mon.name}{mon.shiny ? ' ✦' : ''}
        <span className="gb-muted"> · Nº {String(mon.speciesId).padStart(4, '0')}{mon.nickname ? ` ${mon.speciesName}` : ''}</span>
      </span>
      <span style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {mon.types.map((t) => <TypeBadge key={t} type={t} />)}
        <span>Nv{mon.level}</span>
        <Stars count={mon.ivStars} />
        <span className="gb-muted">IV {mon.ivTotal}/186</span>
      </span>
    </div>
  );
}
