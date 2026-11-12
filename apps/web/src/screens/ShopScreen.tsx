import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_STACK, UNIQUE_ITEMS, type ShopEntry } from '@pokesim/engine';
import { api } from '../api.ts';
import { Menu } from '../ui/Menu.tsx';
import { BallIcon, ItemIcon, KeyHints, formatMoney } from '../ui/bits.tsx';
import { useKeys } from '../ui/useKeys.ts';
import { playSound } from '../sound.ts';

const TABS = [
  { id: 'captura', label: 'Bolas' },
  { id: 'cura', label: 'Cura' },
  { id: 'evolucao', label: 'Evolução' },
  { id: 'mega', label: 'Mega' },
  { id: 'primal', label: 'Primal' },
  { id: 'ivs', label: 'IVs' },
  { id: 'buff', label: 'Amuletos' },
] as const;
const QUICK_QUANTITIES = [1, 5, 10] as const;
const itemLimit = (entry: ShopEntry) => UNIQUE_ITEMS.has(entry.item) ? 1 : MAX_STACK;

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
  const [custom, setCustom] = useState<{ item: string; quantity: string } | null>(null);
  const [message, setMessage] = useState('Escolha um produto para montar o carrinho.');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => Promise.all([api.shop(saveId), api.getSave(saveId)]).then(([list, save]) => { setItems(list); setMoney(save.money); });
  useEffect(() => { load().catch((e: Error) => setError(e.message)); }, [saveId]); // eslint-disable-line react-hooks/exhaustive-deps

  const listRef = useRef<HTMLUListElement>(null);
  const category = TABS[tab]?.id ?? 'captura';
  const visible = useMemo(() => (items ?? []).filter((item) => item.category === category), [items, category]);
  const current = visible[Math.min(index, visible.length - 1)] ?? null;
  useEffect(() => { listRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' }); }, [index, tab]);
  const byName = useMemo(() => new Map((items ?? []).map((item) => [item.item, item])), [items]);
  const lines = Object.entries(cart).filter(([, qty]) => qty > 0).map(([name, qty]) => ({ entry: byName.get(name) as ShopEntry, qty }));
  const total = lines.reduce((sum, line) => sum + line.entry.price * line.qty, 0);
  const count = lines.reduce((sum, line) => sum + line.qty, 0);

  const change = (entry: ShopEntry, delta: number) => {
    if (busy || confirming) return;
    const currentQuantity = cart[entry.item] ?? 0;
    const available = Math.max(0, itemLimit(entry) - entry.owned - currentQuantity);
    if (!Number.isSafeInteger(delta) || delta > available || currentQuantity + delta < 0) {
      setMessage(available > 0 ? `Você pode adicionar até ${available}× ${entry.displayName}.` : `${entry.displayName} chegou ao limite.`);
      playSound('error');
      return;
    }
    setCart({ ...cart, [entry.item]: currentQuantity + delta });
    setMessage(delta > 0
      ? `Adicionou ${delta}× ${entry.displayName} ao carrinho.`
      : `Removeu ${-delta}× ${entry.displayName} do carrinho.`);
    playSound('move');
  };

  const pay = async () => {
    setBusy(true);
    try {
      const result = await api.buy(saveId, lines.map((line) => ({ item: line.entry.item, quantity: line.qty })));
      setCart({});
      setMoney(result.money);
      await load();
      setMessage(`Compra feita! Você gastou ${formatMoney(result.spent)}.${result.premier > 0 ? ` Ganhou ${result.premier} BOLA PREMIER de brinde!` : ''} Volte sempre!`);
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
  }, !confirming && !busy && !custom && items !== null);

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
      <div className="gb-stage gb-shop">
        <header className="gb-shop-head">
          <div>
            <h1 className="gb-title gb-mkt-title">Loja</h1>
          </div>
          <div className="gb-mkt-wallet"><span className="gb-muted">Seu dinheiro</span><b>{formatMoney(money)}</b></div>
        </header>

        <div className="gb-shop-layout">
          <section className="gb-window gb-shop-catalog" aria-label="Produtos">
            <div className="gb-shop-tabs" role="tablist">
              {TABS.map((t, i) => {
                const inCart = (items ?? []).filter((it) => it.category === t.id).reduce((sum, it) => sum + (cart[it.item] ?? 0), 0);
                return (
                  <button key={t.id} type="button" role="tab" aria-selected={i === tab} className="gb-mkt-tab" disabled={busy || confirming} onClick={() => { setCustom(null); setTab(i); setIndex(0); }}>
                    {t.label}{inCart > 0 ? <span className="gb-mkt-count">{inCart}</span> : null}
                  </button>
                );
              })}
            </div>
            {items === null ? <p className="gb-muted">Carregando…</p> : null}
            <ul className="gb-shop-list" aria-label="Produtos" ref={listRef}>
              {visible.map((entry, i) => {
                const qty = cart[entry.item] ?? 0;
                const limit = itemLimit(entry);
                const maxed = entry.owned >= limit;
                const available = Math.max(0, limit - entry.owned - qty);
                const editing = custom?.item === entry.item;
                const amount = editing ? Number(custom.quantity) : 0;
                const validAmount = Number.isSafeInteger(amount) && amount >= 1 && amount <= available;
                const locked = busy || confirming;
                return (
                  <li key={entry.item}>
                    <div
                      className={`gb-shop-item${qty > 0 ? ' is-in-cart' : ''}${maxed ? ' is-maxed' : ''}`}
                      aria-current={current?.item === entry.item}
                      onMouseEnter={() => setIndex(i)}
                    >
                      <div className="gb-shop-item__header">
                        <span className="gb-shop-item__icon" aria-hidden="true">
                          {entry.category === 'captura' ? <BallIcon item={entry.item} /> : <ItemIcon item={entry.item} size={36} />}
                        </span>
                        <div className="gb-shop-item__text">
                          <strong>{entry.displayName}</strong>
                          <span className="gb-shop-item__price">{formatMoney(entry.price)} <small>/ un.</small></span>
                        </div>
                      </div>
                      <p className="gb-shop-item__desc">{entry.description}</p>
                      <div className="gb-shop-item__stock">
                        <span>{maxed ? 'Limite na mochila' : `Na mochila: ${entry.owned}`}</span>
                        <b>No carrinho: {qty}</b>
                      </div>
                      <div className="gb-shop-item__actions"
                        onKeyDown={(event) => {
                          if (event.target instanceof HTMLButtonElement && (event.key === 'Enter' || event.key === ' ')) event.stopPropagation();
                        }}>
                        <div className="gb-shop-quantities" role="group" aria-label={`Adicionar ${entry.displayName} ao carrinho`}>
                          <span className="gb-shop-quantity-label">Adicionar</span>
                          {QUICK_QUANTITIES.map((quantity) => (
                            <button key={quantity} type="button" className="gb-button gb-shop-add" aria-label={`Adicionar ${quantity}× ${entry.displayName}`}
                              disabled={locked || quantity > available} onClick={() => { setIndex(i); setCustom(null); change(entry, quantity); }}>
                              +{quantity}×
                            </button>
                          ))}
                          <button type="button" className="gb-button" aria-expanded={editing} aria-label={`Quantidade personalizada de ${entry.displayName}`}
                            disabled={locked || available < 1} onClick={() => { setIndex(i); setCustom(editing ? null : { item: entry.item, quantity: '' }); }}>
                            Outra
                          </button>
                        </div>
                        <div className="gb-shop-quantities" role="group" aria-label={`Remover ${entry.displayName} do carrinho`}>
                          <span className="gb-shop-quantity-label">Remover</span>
                          {QUICK_QUANTITIES.map((quantity) => (
                            <button key={quantity} type="button" className="gb-button gb-shop-remove" aria-label={`Remover ${quantity}× ${entry.displayName}`}
                              disabled={locked || quantity > qty} onClick={() => { setIndex(i); change(entry, -quantity); }}>
                              −{quantity}×
                            </button>
                          ))}
                        </div>
                      </div>
                      {editing ? (
                        <form className="gb-shop-quantities gb-shop-custom" onSubmit={(event) => {
                          event.preventDefault();
                          if (!validAmount || locked) return;
                          change(entry, amount);
                          setCustom(null);
                        }} onKeyDown={(event) => {
                          if (event.key === 'Escape') { event.preventDefault(); setCustom(null); }
                        }}>
                          <label>
                            Quantidade
                            <input className="gb-input" type="number" min={1} max={available} step={1} required autoFocus
                              aria-label={`Quantidade de ${entry.displayName}`} value={custom.quantity} disabled={locked}
                              onChange={(event) => setCustom({ item: entry.item, quantity: event.target.value })} />
                          </label>
                          <span className="gb-muted">Até {available} unidades</span>
                          <button type="submit" className="gb-button" disabled={locked || !validAmount}>Adicionar</button>
                          <button type="button" className="gb-button" onClick={() => setCustom(null)}>Cancelar</button>
                        </form>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <aside className="gb-shop-cart" aria-label="Carrinho">
            <div className="gb-shop-cart__heading"><h2 className="gb-title">Carrinho</h2><span>{count} {count === 1 ? 'unidade' : 'unidades'}</span></div>
            {lines.length === 0 ? <p className="gb-muted">Vazio. Escolha uma quantidade nos produtos.</p> : (
              <ul className="gb-shop-cart__lines">
                {lines.map((line) => (
                  <li key={line.entry.item}>
                    <ItemIcon item={line.entry.item} size={24} />
                    <span>{line.entry.displayName} <b>×{line.qty}</b></span>
                    <strong>{formatMoney(line.entry.price * line.qty)}</strong>
                  </li>
                ))}
              </ul>
            )}
            <div className="gb-spread gb-shop-cart__total">
              <span className="gb-label">Total</span>
              <span style={{ color: total > money ? 'var(--red)' : undefined }}>{formatMoney(total)}</span>
            </div>
            <div className="gb-spread" style={{ fontSize: 18 }}>
              <span className="gb-muted">Saldo após a compra</span><span className="gb-muted" style={{ color: money - total < 0 ? 'var(--red)' : undefined }}>{formatMoney(money - total)}</span>
            </div>
            <button type="button" className="gb-button gb-button--red" style={{ marginTop: 10, width: '100%' }} disabled={count === 0 || total > money || busy || confirming || Boolean(custom)} onClick={() => setConfirming(true)}>
              Comprar (T)
            </button>
            {count > 0 ? <button type="button" className="gb-button" style={{ marginTop: 6, width: '100%' }} disabled={busy || confirming} onClick={() => { setCustom(null); setCart({}); setMessage('Carrinho esvaziado.'); }}>Esvaziar</button> : null}
            {confirming ? (
              <div style={{ marginTop: 10 }}>
                <p style={{ margin: '0 0 6px' }}>Pagar {formatMoney(total)}?</p>
                <Menu label="Confirmar compra" active={!busy} items={[{ id: 'yes', label: 'Sim', disabled: busy }, { id: 'no', label: 'Não', disabled: busy }]} onSelect={(id) => (id === 'yes' ? void pay() : setConfirming(false))} onBack={() => setConfirming(false)} />
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
