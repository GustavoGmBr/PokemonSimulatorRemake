import { useEffect, useMemo, useState } from 'react';
import type { ShopEntry } from '@pokesim/engine';
import { api } from '../api.ts';
import { Menu } from '../ui/Menu.tsx';
import { BallIcon, KeyHints, formatMoney } from '../ui/bits.tsx';
import { useKeys } from '../ui/useKeys.ts';
import { playSound } from '../sound.ts';

const TABS = [
  { id: 'captura', label: 'Bolas' },
  { id: 'cura', label: 'Cura' },
  { id: 'evolucao', label: 'Evolução' },
  { id: 'buff', label: 'Amuletos' },
] as const;
const MAX_STACK = 99;
const UNIQUE = new Set(['shiny-charm', 'catching-charm', 'amulet-coin', 'lucky-egg']);

interface Props {
  saveId: string;
  onBack: () => void;
}

export function ShopScreen({ saveId, onBack }: Props) {
  const [items, setItems] = useState<ShopEntry[] | null>(null);
  const [money, setMoney] = useState(0);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [tab, setTab] = useState(0);
  const [index, setIndex] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState('Bem-vindo à Loja! Z ou → põem no carrinho, ← tira.');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => Promise.all([api.shop(saveId), api.getSave(saveId)]).then(([list, save]) => { setItems(list); setMoney(save.money); });
  useEffect(() => { load().catch((e: Error) => setError(e.message)); }, [saveId]); // eslint-disable-line react-hooks/exhaustive-deps

  const category = TABS[tab]?.id ?? 'captura';
  const visible = useMemo(() => (items ?? []).filter((item) => item.category === category), [items, category]);
  const current = visible[Math.min(index, visible.length - 1)] ?? null;
  const byName = useMemo(() => new Map((items ?? []).map((item) => [item.item, item])), [items]);
  const lines = Object.entries(cart).filter(([, qty]) => qty > 0).map(([name, qty]) => ({ entry: byName.get(name) as ShopEntry, qty }));
  const total = lines.reduce((sum, line) => sum + line.entry.price * line.qty, 0);
  const count = lines.reduce((sum, line) => sum + line.qty, 0);

  const change = (entry: ShopEntry, delta: number) => {
    const limit = UNIQUE.has(entry.item) ? 1 : MAX_STACK;
    const next = Math.max(0, Math.min(limit - entry.owned, (cart[entry.item] ?? 0) + delta));
    if (next === (cart[entry.item] ?? 0)) { playSound('error'); return; }
    setCart({ ...cart, [entry.item]: next });
    playSound('move');
  };

  const pay = async () => {
    setBusy(true);
    try {
      const result = await api.buy(saveId, lines.map((line) => ({ item: line.entry.item, quantity: line.qty })));
      setCart({});
      setMoney(result.money);
      await load();
      setMessage(`Compra feita! Você gastou ${formatMoney(result.spent)}. Volte sempre!`);
      playSound('save');
    } catch (e) {
      setMessage((e as Error).message);
      playSound('error');
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  useKeys((key) => {
    const n = visible.length;
    if (key === 'up' && n) { setIndex((i) => (i + n - 1) % n); playSound('move'); }
    else if (key === 'down' && n) { setIndex((i) => (i + 1) % n); playSound('move'); }
    else if (key === 'prev') { setTab((tab + TABS.length - 1) % TABS.length); setIndex(0); playSound('move'); }
    else if (key === 'next') { setTab((tab + 1) % TABS.length); setIndex(0); playSound('move'); }
    else if (current && (key === 'right' || key === 'confirm')) change(current, 1);
    else if (current && key === 'left') change(current, -1);
    else if (current && key === 'goto') change(current, 10);
    else if (key === 'tool') {
      if (count === 0) { setMessage('O carrinho está vazio.'); playSound('error'); }
      else if (total > money) { setMessage('Dinheiro insuficiente para esse carrinho.'); playSound('error'); }
      else { setConfirming(true); playSound('confirm'); }
    } else if (key === 'back') {
      if (count > 0) { setCart({}); setMessage('Carrinho esvaziado.'); playSound('back'); }
      else { playSound('back'); onBack(); }
    }
  }, !confirming && !busy && items !== null);

  if (error) {
    return (
      <main className="gb-screen"><div className="gb-stage">
        <div className="gb-window gb-window--accent gb-dialog"><p>{error}</p></div>
        <button type="button" className="gb-button" onClick={onBack}>Voltar</button>
      </div></main>
    );
  }

  return (
    <main className="gb-screen">
      <div className="gb-stage">
        <header className="gb-window gb-spread" style={{ alignItems: 'center', padding: '10px 20px' }}>
          <h1 className="gb-title" style={{ fontSize: 26 }}>Loja</h1>
          <span style={{ fontSize: 26 }}>{formatMoney(money)}</span>
        </header>

        <div className="gb-row" style={{ alignItems: 'flex-start' }}>
          <section className="gb-window gb-grow" aria-label="Produtos">
            <div className="gb-tabs" role="tablist">
              {TABS.map((t, i) => (
                <button key={t.id} type="button" role="tab" aria-selected={i === tab} className="gb-tab" onClick={() => { setTab(i); setIndex(0); }}>{t.label}</button>
              ))}
            </div>
            {items === null ? <p className="gb-muted">Carregando…</p> : null}
            <ul className="gb-menu" aria-label="Produtos">
              {visible.map((entry, i) => (
                <li key={entry.item}>
                  <button
                    type="button"
                    className="gb-menu__item"
                    aria-current={current?.item === entry.item}
                    onMouseEnter={() => setIndex(i)}
                    onClick={() => { setIndex(i); change(entry, 1); }}
                  >
                    <span className="gb-cursor" aria-hidden="true">▶</span>
                    <span className="gb-shop-row">
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {entry.category === 'captura' ? <BallIcon item={entry.item} small /> : null}{entry.displayName}
                      </span>
                      <span className="gb-muted">tem {entry.owned}</span>
                      <span>{formatMoney(entry.price)}</span>
                      <span className="gb-cartqty">{cart[entry.item] ? `×${cart[entry.item]}` : ''}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <aside className="gb-window gb-side" style={{ maxWidth: 380 }} aria-label="Carrinho">
            <h2 className="gb-title" style={{ fontSize: 20, marginBottom: 6 }}>Carrinho</h2>
            {lines.length === 0 ? <p className="gb-muted">Vazio.</p> : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {lines.map((line) => (
                  <li key={line.entry.item} className="gb-spread" style={{ fontSize: 22 }}>
                    <span>{line.entry.displayName} ×{line.qty}</span>
                    <span>{formatMoney(line.entry.price * line.qty)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="gb-spread" style={{ borderTop: '2px solid var(--rim)', marginTop: 8, paddingTop: 6, fontSize: 24 }}>
              <span className="gb-label">Total</span>
              <span style={{ color: total > money ? 'var(--red)' : undefined }}>{formatMoney(total)}</span>
            </div>
            <div className="gb-spread" style={{ fontSize: 20 }}>
              <span className="gb-muted">Sobra</span><span className="gb-muted">{formatMoney(money - total)}</span>
            </div>
            <button type="button" className="gb-button gb-button--red" style={{ marginTop: 10, width: '100%' }} disabled={count === 0 || total > money || busy} onClick={() => setConfirming(true)}>
              Comprar (T)
            </button>
            {confirming ? (
              <div style={{ marginTop: 10 }}>
                <p style={{ margin: '0 0 6px' }}>Pagar {formatMoney(total)}?</p>
                <Menu label="Confirmar compra" items={[{ id: 'yes', label: 'Sim' }, { id: 'no', label: 'Não' }]} onSelect={(id) => (id === 'yes' ? void pay() : setConfirming(false))} onBack={() => setConfirming(false)} />
              </div>
            ) : null}
          </aside>
        </div>

        <div className="gb-window gb-window--accent gb-info" role="status">
          {current ? <p className="gb-muted" style={{ margin: 0 }}>{current.displayName}: {current.description}</p> : null}
          <p style={{ margin: 0 }}>{message}</p>
        </div>
        <KeyHints hints={[['↑↓', 'item'], ['Q E', 'seção'], ['Z →', '+1'], ['←', '−1'], ['G', '+10'], ['T', 'comprar'], ['X', 'esvaziar / sair']]} />
      </div>
    </main>
  );
}
