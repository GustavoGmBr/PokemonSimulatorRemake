import { useEffect, useState } from 'react';
import type { MarketState } from '@pokesim/engine';
import { api } from '../api.ts';
import { KeyHints, Sprite, formatMoney } from '../ui/bits.tsx';
import { useKeys } from '../ui/useKeys.ts';
import { playSound } from '../sound.ts';

interface Props { saveId: string; onBack: () => void }

const time = (ms: number) => `${Math.floor(Math.max(0, ms) / 60000)} min`;

export function MarketScreen({ saveId, onBack }: Props) {
  const [state, setState] = useState<MarketState | null>(null);
  const [tab, setTab] = useState<'buy' | 'sell'>('buy');
  const [picked, setPicked] = useState<string[]>([]);
  const [message, setMessage] = useState('Mercado Pokémon: o estoque renova a cada hora. Fixe (📌) o que quiser guardar.');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.market(saveId).then(setState, (e: Error) => setError(e.message)); }, [saveId]);
  useKeys((key) => { if (key === 'back') { playSound('back'); onBack(); } }, !busy);

  if (error) return <main className="gb-screen"><div className="gb-stage"><div className="gb-window gb-window--accent gb-dialog"><p>{error}</p></div><button type="button" className="gb-button" onClick={onBack}>Voltar</button></div></main>;
  if (!state) return <main className="gb-screen"><div className="gb-stage"><div className="gb-window gb-dialog"><p>Carregando…</p></div></div></main>;

  const run = (work: () => Promise<void>) => {
    setBusy(true);
    work().catch((e: Error) => { setMessage(e.message); playSound('error'); }).finally(() => setBusy(false));
  };
  const total = state.sellable.filter((s) => picked.includes(s.id)).reduce((sum, s) => sum + s.value, 0);

  return (
    <main className="gb-screen">
      <div className="gb-stage">
        <header className="gb-window gb-spread" style={{ alignItems: 'center', padding: '10px 20px' }}>
          <h1 className="gb-title" style={{ fontSize: 26 }}>Mercado</h1>
          <span style={{ fontSize: 22 }}>{formatMoney(state.money)}</span>
        </header>
        <section className="gb-window" aria-label="Mercado">
          <div className="gb-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'buy'} className="gb-tab" onClick={() => setTab('buy')}>Comprar</button>
            <button type="button" role="tab" aria-selected={tab === 'sell'} className="gb-tab" onClick={() => setTab('sell')}>Vender</button>
          </div>
          {tab === 'buy' ? (
            <>
              <div className="gb-spread" style={{ marginBottom: 8 }}>
                <span className="gb-muted">Renova em {time(state.msLeft)}</span>
                <button type="button" className="gb-button" disabled={busy || state.money < state.refreshPrice} onClick={() => run(async () => { setState(await api.marketRefresh(saveId)); setMessage('Estoque renovado!'); playSound('confirm'); })}>
                  Renovar ({formatMoney(state.refreshPrice)})
                </button>
              </div>
              <div className="gb-teampick">
                {state.stock.map((e) => (
                  <div key={e.id} className={`gb-teampick__mon${e.available ? '' : ' is-sold'}`}>
                    <Sprite speciesId={e.speciesId} shiny={e.shiny} alt={e.name} size={56} />
                    <span>{e.shiny ? '✨ ' : ''}{e.name}</span>
                    <span className="gb-muted">Nv {e.level} · {'★'.repeat(e.stars)}</span>
                    <span>{formatMoney(e.price)}{e.regionUnlocked ? '' : ' 🔒'}</span>
                    <div className="gb-row" style={{ gap: 4 }}>
                      <button type="button" className="gb-button" disabled={busy || !e.available || state.money < e.price} onClick={() => run(async () => {
                        const res = await api.marketBuy(saveId, e.id);
                        setState(res.state); setMessage(`Você comprou ${res.pokemon.name} por ${formatMoney(res.price)}!`); playSound('confirm');
                      })}>{e.available ? 'Comprar' : 'Vendido'}</button>
                      <button type="button" className="gb-button" aria-pressed={e.favorite} aria-label={e.favorite ? 'Soltar' : 'Fixar'} disabled={busy || !e.available} onClick={() => run(async () => setState(await api.marketFavorite(saveId, e.id, !e.favorite)))}>{e.favorite ? '📌' : '📍'}</button>
                    </div>
                  </div>
                ))}
              </div>
              <p className="gb-muted" style={{ margin: '8px 0 0', fontSize: 20 }}>🔒 = região ainda bloqueada (preço dobrado). Todos chegam no Nv 1 com 2★ ou mais.</p>
            </>
          ) : (
            <>
              <div className="gb-teampick" style={{ maxHeight: '48vh', overflowY: 'auto' }}>
                {state.sellable.map((s) => (
                  <button key={s.id} type="button" disabled={s.favorite} className={`gb-teampick__mon${picked.includes(s.id) ? ' is-on' : ''}`} aria-pressed={picked.includes(s.id)}
                    onClick={() => setPicked((now) => (now.includes(s.id) ? now.filter((id) => id !== s.id) : [...now, s.id]))}>
                    <Sprite speciesId={s.speciesId} shiny={s.shiny} alt={s.name} size={48} />
                    <span>{s.favorite ? '♥ ' : ''}{s.name}</span><span className="gb-muted">Nv {s.level}</span><span>{formatMoney(s.value)}</span>
                  </button>
                ))}
              </div>
              <div className="gb-row" style={{ marginTop: 8, alignItems: 'center' }}>
                <span>{picked.length} escolhidos · {formatMoney(total)}</span>
                <button type="button" className="gb-button" disabled={busy || picked.length === 0} onClick={() => {
                  if (!window.confirm(`Vender ${picked.length} Pokémon por ${formatMoney(total)}? Não dá para desfazer.`)) return;
                  run(async () => { const res = await api.marketSell(saveId, picked); setState(res.state); setPicked([]); setMessage(`Vendeu ${res.sold} Pokémon!`); playSound('confirm'); });
                }}>Vender</button>
              </div>
              <p className="gb-muted" style={{ margin: '4px 0 0', fontSize: 20 }}>Favoritos (♥) não podem ser vendidos. O valor sobe com o nível, a bola, os itens gastos, IVs, lendário e shiny.</p>
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
