import { useEffect, useMemo, useState } from 'react';
import { TYPE_LABELS, TYPE_NAMES, type MarketEntry, type MarketState, type SaleOffer, type SpeciesIndexEntry, type TypeName } from '@pokesim/engine';
import { api } from '../api.ts';
import { BallIcon, KeyHints, Sprite, TypeBadge, formatMoney } from '../ui/bits.tsx';
import { useKeys } from '../ui/useKeys.ts';
import { playSound } from '../sound.ts';

interface Props { saveId: string; onBack: () => void }

/** No máximo 4 estrelas de IV. */
const MAX_STARS = 4;
const STAR_STEPS = [0, 2, 3, 4];
const isSpecial = (e: { shiny: boolean; stars: number; available: boolean }) => e.available && (e.shiny || e.stars >= MAX_STARS);
const minutes = (ms: number) => Math.max(0, Math.ceil(ms / 60000));
const HOUR_MS = 60 * 60 * 1000;

type SellSort = 'value' | 'level' | 'stars' | 'name';
const SELL_SORT_LABEL: Record<SellSort, string> = { value: 'Maior valor', level: 'Maior nível', stars: 'Mais estrelas', name: 'Nome' };

/** Quatro estrelas de IV: cheias até `count`, vazias depois. */
function StarRow({ count }: { count: number }) {
  return (
    <span className="gb-mkt-stars" role="img" aria-label={`${count} de ${MAX_STARS} estrelas de IV`}>
      {Array.from({ length: MAX_STARS }, (_, i) => <span key={i} className={i < count ? 'is-on' : ''}>★</span>)}
    </span>
  );
}

export function MarketScreen({ saveId, onBack }: Props) {
  const [state, setState] = useState<MarketState | null>(null);
  const [tab, setTab] = useState<'buy' | 'sell'>('buy');
  const [picked, setPicked] = useState<string[]>([]);
  const [message, setMessage] = useState('O estoque renova a cada hora. Fixe (📌) o que quiser guardar.');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState<SpeciesIndexEntry[]>([]);
  const [fType, setFType] = useState('');
  const [fStars, setFStars] = useState(0);
  const [fShiny, setFShiny] = useState(false);
  const [fGen, setFGen] = useState(0);
  const [sellSort, setSellSort] = useState<SellSort>('value');
  const [sellText, setSellText] = useState('');
  const [sellStars, setSellStars] = useState(0);
  const [alert, setAlert] = useState<string | null>(null);

  // Avisa quando há shiny ou 4★ à venda (ao abrir e a cada renovação).
  const announce = (next: MarketState, label: string) => {
    const hits = next.stock.filter(isSpecial);
    if (hits.length === 0) { setAlert(null); return; }
    setAlert(`${label}: ${hits.map((h) => `${h.shiny ? '✨ ' : ''}${h.name} (${'★'.repeat(h.stars)})`).join(', ')}`);
    playSound('confirm');
  };
  useEffect(() => {
    api.market(saveId).then((m) => { setState(m); announce(m, 'Destaque no estoque'); }, (e: Error) => setError(e.message));
    api.speciesIndex().then(setIndex, () => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveId]);
  useKeys((key) => { if (key === 'back') { playSound('back'); onBack(); } }, !busy);

  const typesOf = useMemo(() => new Map(index.map((x) => [x.id, x.types as string[]])), [index]);
  const sellList = useMemo(() => {
    const needle = sellText.trim().toLowerCase();
    const list = (state?.sellable ?? []).filter((s) => (!needle || s.name.toLowerCase().includes(needle)) && s.stars >= sellStars);
    const by: Record<SellSort, (a: SaleOffer, b: SaleOffer) => number> = {
      value: (a, b) => b.value - a.value,
      level: (a, b) => b.level - a.level || b.value - a.value,
      stars: (a, b) => b.stars - a.stars || b.value - a.value,
      name: (a, b) => a.name.localeCompare(b.name, 'pt-BR'),
    };
    return [...list].sort(by[sellSort]);
  }, [state, sellText, sellStars, sellSort]);

  if (error) return <main className="gb-screen"><div className="gb-stage"><div className="gb-window gb-window--accent gb-dialog"><p>{error}</p></div><button type="button" className="gb-button" onClick={onBack}>Voltar</button></div></main>;
  if (!state) return <main className="gb-screen"><div className="gb-stage"><div className="gb-window gb-dialog"><p>Carregando…</p></div></div></main>;

  const run = (work: () => Promise<void>) => {
    setBusy(true);
    work().catch((e: Error) => { setMessage(e.message); playSound('error'); }).finally(() => setBusy(false));
  };
  const gens = [...new Set(state.stock.map((e) => e.generation))].sort((a, b) => a - b);
  const visible = state.stock.filter((e) =>
    (!fType || (typesOf.get(e.speciesId) ?? []).includes(fType)) && e.stars >= fStars && (!fShiny || e.shiny) && (!fGen || e.generation === fGen));
  const filtered = fType !== '' || fStars > 0 || fShiny || fGen > 0;
  const chosen = state.sellable.filter((s) => picked.includes(s.id));
  const total = chosen.reduce((sum, s) => sum + s.value, 0);
  const sellable = sellList.filter((s) => !s.favorite);
  const refreshLeft = Math.min(1, Math.max(0, state.msLeft / HOUR_MS));

  const buy = (e: MarketEntry) => run(async () => {
    const res = await api.marketBuy(saveId, e.id);
    setState(res.state); setMessage(`Você comprou ${res.pokemon.name} por ${formatMoney(res.price)}!`); playSound('confirm');
  });
  const sell = () => {
    if (!window.confirm(`Vender ${picked.length} Pokémon por ${formatMoney(total)}? Não dá para desfazer.`)) return;
    run(async () => { const res = await api.marketSell(saveId, picked); setState(res.state); setPicked([]); setMessage(`Vendeu ${res.sold} Pokémon por ${formatMoney(total)}!`); playSound('confirm'); });
  };

  return (
    <main className="gb-screen">
      <div className="gb-stage gb-mkt">
        <header className="gb-mkt-head">
          <div>
            <h1 className="gb-title gb-mkt-title">Mercado Pokémon</h1>
            <p className="gb-mkt-sub">Compre Pokémon prontos ou venda os que sobraram na sua coleção.</p>
          </div>
          <div className="gb-mkt-wallet" aria-label="Seu dinheiro">
            <span className="gb-label">Seu dinheiro</span>
            <b>{formatMoney(state.money)}</b>
          </div>
        </header>

        <div className="gb-mkt-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'buy'} className="gb-mkt-tab" onClick={() => setTab('buy')}>🛒 Comprar <span className="gb-mkt-count">{state.stock.filter((e) => e.available).length}</span></button>
          <button type="button" role="tab" aria-selected={tab === 'sell'} className="gb-mkt-tab" onClick={() => setTab('sell')}>💰 Vender <span className="gb-mkt-count">{sellable.length}</span></button>
        </div>

        <section className="gb-window gb-mkt-panel" aria-label="Mercado">
          {tab === 'buy' ? (
            <>
              <div className="gb-mkt-renew">
                <div className="gb-mkt-renew__info">
                  <span>Estoque renova em <b>{minutes(state.msLeft)} min</b></span>
                  <div className="gb-mkt-meter" role="img" aria-label={`Faltam ${minutes(state.msLeft)} minutos`}><span style={{ width: `${Math.round(refreshLeft * 100)}%` }} /></div>
                </div>
                <button type="button" className="gb-button" disabled={busy || state.money < state.refreshPrice} onClick={() => run(async () => { const next = await api.marketRefresh(saveId); setState(next); setMessage('Estoque renovado!'); playSound('confirm'); announce(next, 'Novo na renovação'); })}>
                  ↻ Renovar agora ({formatMoney(state.refreshPrice)})
                </button>
              </div>
              {alert ? <div className="gb-mkt-alert" role="alert">🔔 {alert}</div> : null}

              <div className="gb-mkt-filters" aria-label="Filtros">
                <div className="gb-mkt-filter" role="group" aria-label="Estrelas de IV">
                  <span className="gb-label">IV</span>
                  {STAR_STEPS.map((n) => (
                    <button key={n} type="button" className="gb-pill" aria-pressed={fStars === n} onClick={() => setFStars(n)}>{n === 0 ? 'Todas' : `${'★'.repeat(n)}${n < MAX_STARS ? '+' : ''}`}</button>
                  ))}
                  <button type="button" className="gb-pill" aria-pressed={fShiny} onClick={() => setFShiny((v) => !v)}>✨ Shiny</button>
                </div>
                <div className="gb-mkt-filter">
                  <select className="gb-input" aria-label="Tipo" value={fType} onChange={(ev) => setFType(ev.target.value)}>
                    <option value="">Todos os tipos</option>
                    {TYPE_NAMES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                  </select>
                  <select className="gb-input" aria-label="Região" value={fGen} onChange={(ev) => setFGen(Number(ev.target.value))}>
                    <option value={0}>Todas as regiões</option>
                    {gens.map((g) => <option key={g} value={g}>Geração {g}</option>)}
                  </select>
                  {filtered ? <button type="button" className="gb-button" onClick={() => { setFType(''); setFStars(0); setFShiny(false); setFGen(0); }}>Limpar ({visible.length}/{state.stock.length})</button> : null}
                </div>
              </div>

              {visible.length === 0 ? <p className="gb-muted">Nenhum Pokémon com esses filtros.</p> : null}
              <div className="gb-mkt-grid">
                {visible.map((e) => {
                  const types = (typesOf.get(e.speciesId) ?? []) as TypeName[];
                  const missing = e.price - state.money;
                  return (
                    <article key={e.id} className={`gb-mkt-card${e.shiny ? ' is-shiny' : ''}${e.stars >= MAX_STARS ? ' is-top' : ''}${e.available ? '' : ' is-sold'}${e.favorite ? ' is-pinned' : ''}`} aria-label={e.name}>
                      <div className={`gb-mkt-card__art${types[0] ? ` gb-mkt-art--${types[0]}` : ''}`}>
                        <Sprite speciesId={e.speciesId} shiny={e.shiny} alt={e.name} size={80} />
                        {e.shiny ? <span className="gb-mkt-badge gb-mkt-badge--shiny">✨ Shiny</span> : null}
                        {!e.regionUnlocked ? <span className="gb-mkt-badge gb-mkt-badge--lock" title="Região bloqueada: preço dobrado">🔒 ×2</span> : null}
                        {!e.available ? <span className="gb-mkt-stamp">Vendido</span> : null}
                      </div>
                      <div className="gb-mkt-card__body">
                        <h3 className="gb-mkt-card__name">{e.name}</h3>
                        <div className="gb-mkt-card__meta">
                          <span className="gb-mkt-types">{types.map((t) => <TypeBadge key={t} type={t} />)}</span>
                          <span className="gb-muted">Ger. {e.generation || '—'}</span>
                        </div>
                        <div className="gb-mkt-card__meta">
                          <StarRow count={e.stars} />
                          <span className="gb-muted">Nv {e.level}</span>
                        </div>
                        <div className="gb-mkt-price">{formatMoney(e.price)}</div>
                        {e.available && missing > 0 ? <span className="gb-mkt-short">faltam {formatMoney(missing)}</span> : null}
                      </div>
                      <div className="gb-mkt-card__actions">
                        <button type="button" className="gb-button gb-mkt-buy" disabled={busy || !e.available || state.money < e.price} onClick={() => buy(e)}>{e.available ? 'Comprar' : 'Vendido'}</button>
                        <button type="button" className="gb-button gb-mkt-pin" aria-pressed={e.favorite} aria-label={e.favorite ? 'Soltar do estoque' : 'Fixar no estoque'} title={e.favorite ? 'Fixado: não some na renovação' : 'Fixar para guardar na renovação'} disabled={busy || !e.available} onClick={() => run(async () => setState(await api.marketFavorite(saveId, e.id, !e.favorite)))}>{e.favorite ? '📌' : '📍'}</button>
                      </div>
                    </article>
                  );
                })}
              </div>
              <p className="gb-muted gb-mkt-note">🔒 = região ainda bloqueada (preço dobrado). Todos chegam no Nv 1 com 2★ ou mais. Preço base ₽ 10.000; shiny ×5, 3★ ×1,5 e 4★ ×2.</p>
            </>
          ) : (
            <>
              <div className="gb-mkt-filters" aria-label="Filtros de venda">
                <div className="gb-mkt-filter">
                  <input className="gb-input" type="search" aria-label="Buscar por nome" placeholder="Buscar por nome…" value={sellText} onChange={(ev) => setSellText(ev.target.value)} />
                  <select className="gb-input" aria-label="Ordenar" value={sellSort} onChange={(ev) => setSellSort(ev.target.value as SellSort)}>
                    {(Object.keys(SELL_SORT_LABEL) as SellSort[]).map((k) => <option key={k} value={k}>{SELL_SORT_LABEL[k]}</option>)}
                  </select>
                </div>
                <div className="gb-mkt-filter" role="group" aria-label="Estrelas de IV">
                  <span className="gb-label">IV</span>
                  {STAR_STEPS.map((n) => (
                    <button key={n} type="button" className="gb-pill" aria-pressed={sellStars === n} onClick={() => setSellStars(n)}>{n === 0 ? 'Todas' : `${'★'.repeat(n)}${n < MAX_STARS ? '+' : ''}`}</button>
                  ))}
                  <button type="button" className="gb-button" disabled={sellable.length === 0} onClick={() => setPicked((now) => [...new Set([...now, ...sellable.map((s) => s.id)])])}>Marcar a lista</button>
                  <button type="button" className="gb-button" disabled={picked.length === 0} onClick={() => setPicked([])}>Desmarcar</button>
                </div>
              </div>
              {sellList.length === 0 ? <p className="gb-muted">Nenhum Pokémon com esses filtros.</p> : null}
              <div className="gb-mkt-sellgrid">
                {sellList.map((s) => (
                  <button key={s.id} type="button" disabled={s.favorite} className={`gb-mkt-sell${picked.includes(s.id) ? ' is-on' : ''}${s.shiny ? ' is-shiny' : ''}`} aria-pressed={picked.includes(s.id)}
                    onClick={() => setPicked((now) => (now.includes(s.id) ? now.filter((id) => id !== s.id) : [...now, s.id]))}>
                    <Sprite speciesId={s.spriteId} shiny={s.shiny} alt={s.name} size={56} />
                    <span className="gb-mkt-sell__name">{s.favorite ? '♥ ' : ''}{s.shiny ? '✨ ' : ''}{s.name}</span>
                    <span className="gb-mkt-sell__meta"><StarRow count={s.stars} /><span className="gb-muted">Nv {s.level}</span>{s.ball ? <BallIcon item={s.ball} small /> : null}</span>
                    {s.inTeam ? <span className="gb-mkt-sell__tag">equipe</span> : null}
                    <span className="gb-mkt-price gb-mkt-price--sell">{formatMoney(s.value)}</span>
                    {picked.includes(s.id) ? <span className="gb-mkt-check" aria-hidden="true">✔</span> : null}
                  </button>
                ))}
              </div>
              <div className="gb-mkt-sellbar">
                <span><b>{picked.length}</b> escolhido{picked.length === 1 ? '' : 's'} · <b>{formatMoney(total)}</b></span>
                <button type="button" className="gb-button gb-button--red" disabled={busy || picked.length === 0} onClick={sell}>Vender selecionados</button>
              </div>
              <p className="gb-muted gb-mkt-note">Favoritos (♥) não podem ser vendidos. Valor = (bola + nível + itens gastos) × lendário (×3) × shiny (×10) × IVs (3★ ×1,5, 4★ ×2).</p>
            </>
          )}
        </section>
        <div className="gb-window gb-dialog"><p style={{ margin: 0 }} aria-live="polite">{message}</p></div>
        <button type="button" className="gb-button" onClick={onBack}>Voltar</button>
        <KeyHints hints={[['X', 'voltar']]} />
      </div>
    </main>
  );
}
