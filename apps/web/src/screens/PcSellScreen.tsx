import { useEffect, useMemo, useState } from 'react';
import type { MarketState, SaleOffer } from '@pokesim/engine';
import { api } from '../api.ts';
import { KeyHints, Sprite, formatMoney } from '../ui/bits.tsx';
import { useKeys } from '../ui/useKeys.ts';
import { playSound } from '../sound.ts';

interface Props { saveId: string; onBack: () => void }

/** Dentre os repetidos de cada espécie, mantém o melhor (mais ★, depois nível) e devolve os demais. */
export function duplicatesOf(list: SaleOffer[]): SaleOffer[] {
  const bySpecies = new Map<number, SaleOffer[]>();
  for (const mon of list) bySpecies.set(mon.speciesId, [...(bySpecies.get(mon.speciesId) ?? []), mon]);
  const extras: SaleOffer[] = [];
  for (const group of bySpecies.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => Number(b.shiny) - Number(a.shiny) || b.stars - a.stars || b.level - a.level);
    extras.push(...sorted.slice(1));
  }
  return extras;
}

export function PcSellScreen({ saveId, onBack }: Props) {
  const [state, setState] = useState<MarketState | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [message, setMessage] = useState('Escolha os Pokémon à mão ou use os atalhos de filtro. Favoritos, shinies e a equipe ficam protegidos nos atalhos.');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onlyDup, setOnlyDup] = useState(false);
  const [maxStars, setMaxStars] = useState(0); // 0 = qualquer; N = só abaixo de N★
  const [maxLevel, setMaxLevel] = useState(0);
  const [hideShiny, setHideShiny] = useState(true);
  const [text, setText] = useState('');

  useEffect(() => { api.market(saveId).then(setState, (e: Error) => setError(e.message)); }, [saveId]);
  useKeys((key) => { if (key === 'back') { playSound('back'); onBack(); } }, !busy);

  const sellable = useMemo(() => (state?.sellable ?? []).filter((s) => !s.favorite && !s.inTeam), [state]);
  const dupIds = useMemo(() => new Set(duplicatesOf(state?.sellable ?? []).map((s) => s.id)), [state]);
  const visible = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return sellable.filter((s) =>
      (!onlyDup || dupIds.has(s.id)) && (!maxStars || s.stars < maxStars) && (!maxLevel || s.level <= maxLevel)
      && (!hideShiny || !s.shiny) && (!needle || s.name.toLowerCase().includes(needle)));
  }, [sellable, onlyDup, dupIds, maxStars, maxLevel, hideShiny, text]);

  if (error) return <main className="gb-screen"><div className="gb-stage"><div className="gb-window gb-window--accent gb-dialog"><p>{error}</p></div><button type="button" className="gb-button" onClick={onBack}>Voltar</button></div></main>;
  if (!state) return <main className="gb-screen"><div className="gb-stage"><div className="gb-window gb-dialog"><p>Carregando…</p></div></div></main>;

  const run = (work: () => Promise<void>) => {
    setBusy(true);
    work().catch((e: Error) => { setMessage(e.message); playSound('error'); }).finally(() => setBusy(false));
  };
  const chosen = state.sellable.filter((s) => picked.includes(s.id));
  const total = chosen.reduce((sum, s) => sum + s.value, 0);
  const toggle = (id: string) => setPicked((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]));
  const clearFilters = () => { setOnlyDup(false); setMaxStars(0); setMaxLevel(0); setHideShiny(true); setText(''); };
  const sell = () => {
    if (!window.confirm(`Vender ${picked.length} Pokémon por ${formatMoney(total)}? Não dá para desfazer.`)) return;
    run(async () => {
      const res = await api.marketSell(saveId, picked);
      setState(res.state); setPicked([]); setMessage(`Vendeu ${res.sold} Pokémon por ${formatMoney(total)}!`); playSound('confirm');
    });
  };

  return (
    <main className="gb-screen">
      <div className="gb-stage">
        <header className="gb-window gb-spread" style={{ alignItems: 'center', padding: '10px 20px' }}>
          <h1 className="gb-title" style={{ fontSize: 26 }}>Venda no PC</h1>
          <span style={{ fontSize: 22 }}>{formatMoney(state.money)}</span>
        </header>
        <section className="gb-window" aria-label="Filtros de venda">
          <div className="gb-row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <input className="gb-button" aria-label="Buscar por nome" placeholder="Nome…" value={text} onChange={(ev) => setText(ev.target.value)} style={{ width: 140 }} />
            <button type="button" className="gb-button" aria-pressed={onlyDup} onClick={() => setOnlyDup((v) => !v)}>Duplicados</button>
            <button type="button" className="gb-button" aria-pressed={maxStars === 3} onClick={() => setMaxStars((v) => (v === 3 ? 0 : 3))}>Abaixo de 3★</button>
            <select className="gb-button" aria-label="Estrelas" value={maxStars} onChange={(ev) => setMaxStars(Number(ev.target.value))}>
              <option value={0}>Qualquer ★</option>
              {[2, 3, 4].map((n) => <option key={n} value={n}>Abaixo de {n}★</option>)}
            </select>
            <select className="gb-button" aria-label="Nível" value={maxLevel} onChange={(ev) => setMaxLevel(Number(ev.target.value))}>
              <option value={0}>Qualquer nível</option>
              {[5, 10, 20, 30, 50].map((n) => <option key={n} value={n}>Até Nv {n}</option>)}
            </select>
            <button type="button" className="gb-button" aria-pressed={hideShiny} onClick={() => setHideShiny((v) => !v)}>Proteger ✨</button>
            <button type="button" className="gb-button" onClick={clearFilters}>Limpar</button>
          </div>
          <div className="gb-row" style={{ gap: 6, margin: '8px 0', alignItems: 'center' }}>
            <span className="gb-muted">{visible.length} na lista</span>
            <button type="button" className="gb-button" disabled={visible.length === 0} onClick={() => setPicked((now) => [...new Set([...now, ...visible.map((v) => v.id)])])}>Marcar todos da lista</button>
            <button type="button" className="gb-button" disabled={picked.length === 0} onClick={() => setPicked([])}>Desmarcar tudo</button>
          </div>
          <div className="gb-teampick" style={{ maxHeight: '44vh', overflowY: 'auto' }}>
            {visible.map((s) => (
              <button key={s.id} type="button" className={`gb-teampick__mon${picked.includes(s.id) ? ' is-on' : ''}`} aria-pressed={picked.includes(s.id)} onClick={() => toggle(s.id)}>
                <Sprite speciesId={s.speciesId} shiny={s.shiny} alt={s.name} size={48} />
                <span>{s.shiny ? '✨ ' : ''}{s.name}</span>
                <span className="gb-muted">Nv {s.level} · {'★'.repeat(s.stars) || '—'}{dupIds.has(s.id) ? ' · repetido' : ''}</span>
                <span>{formatMoney(s.value)}</span>
              </button>
            ))}
            {visible.length === 0 && <p className="gb-muted">Nenhum Pokémon vendável com esses filtros.</p>}
          </div>
          <div className="gb-row" style={{ marginTop: 8, alignItems: 'center' }}>
            <span>{picked.length} escolhidos · {formatMoney(total)}</span>
            <button type="button" className="gb-button" disabled={busy || picked.length === 0} onClick={sell}>Vender</button>
          </div>
        </section>
        <div className="gb-window gb-dialog"><p style={{ margin: 0 }} aria-live="polite">{message}</p></div>
        <button type="button" className="gb-button" onClick={onBack}>Voltar</button>
        <KeyHints hints={[['X', 'voltar']]} />
      </div>
    </main>
  );
}
