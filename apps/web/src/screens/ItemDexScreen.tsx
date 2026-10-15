import { useEffect, useMemo, useState } from 'react';
import type { Item, PokeapiItem } from '@pokesim/engine';
import { api } from '../api.ts';
import { Menu, type MenuItem } from '../ui/Menu.tsx';
import { ItemIcon, KeyHints, formatMoney } from '../ui/bits.tsx';
import { useKeys } from '../ui/useKeys.ts';
import { playSound } from '../sound.ts';

const POCKETS: { id: string; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'game', label: 'No jogo' },
  { id: 'pokeballs', label: 'Bolas' },
  { id: 'medicine', label: 'Remédios' },
  { id: 'battle', label: 'Batalha' },
  { id: 'berries', label: 'Berries' },
  { id: 'machines', label: 'TMs/HMs' },
  { id: 'misc', label: 'Diversos' },
  { id: 'key', label: 'Chave' },
  { id: 'mail', label: 'Cartas' },
];
const PAGE = 60;
const norm = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

interface Props {
  saveId: string;
  onBack: () => void;
}

export function ItemDexScreen({ saveId, onBack }: Props) {
  const [all, setAll] = useState<PokeapiItem[] | null>(null);
  const [game, setGame] = useState<Map<string, Item>>(new Map());
  const [owned, setOwned] = useState<Map<string, number>>(new Map());
  const [tab, setTab] = useState(0);
  const [text, setText] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [hover, setHover] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.pokeapiItems(), api.items(), api.getSave(saveId)]).then(([list, items, save]) => {
      setAll(list);
      setGame(new Map(items.map((item) => [item.name, item])));
      setOwned(new Map(save.inventory.map((entry) => [entry.item, entry.quantity])));
    }, (e: Error) => setError(e.message));
  }, [saveId]);

  useKeys((key) => {
    if (key === 'prev') { setTab((tab + POCKETS.length - 1) % POCKETS.length); setLimit(PAGE); playSound('move'); }
    else if (key === 'next') { setTab((tab + 1) % POCKETS.length); setLimit(PAGE); playSound('move'); }
    else if (key === 'back') { playSound('back'); onBack(); }
  }, all !== null);

  const pocket = POCKETS[tab]?.id ?? 'all';
  const filtered = useMemo(() => {
    if (!all) return [];
    const needle = norm(text.trim());
    return all.filter((item) => {
      if (pocket === 'game' ? !game.has(item.name) : pocket !== 'all' && item.pocket !== pocket) return false;
      if (!needle) return true;
      const own = game.get(item.name);
      return norm(item.en).includes(needle) || item.name.includes(needle) || (own ? norm(own.displayName).includes(needle) : false);
    });
  }, [all, game, pocket, text]);

  if (error) {
    return (
      <main className="gb-screen"><div className="gb-stage">
        <div className="gb-window gb-window--accent gb-dialog"><p>{error}</p></div>
        <button type="button" className="gb-button" onClick={onBack}>Voltar</button>
      </div></main>
    );
  }
  if (!all) return <main className="gb-screen"><div className="gb-stage"><div className="gb-window gb-dialog"><p>Carregando…</p></div></div></main>;

  const shown = filtered.slice(0, limit);
  const items: MenuItem[] = shown.map((item) => ({
    id: item.name,
    label: <span className="gb-iconrow"><ItemIcon item={item.name} size={24} />{game.get(item.name)?.displayName ?? item.en}</span>,
    extra: (owned.get(item.name) ?? 0) > 0 ? `×${owned.get(item.name)}` : game.has(item.name) ? '●' : '',
  }));
  if (filtered.length > limit) items.push({ id: '__more', label: `Mostrar mais (${filtered.length - limit})` });
  const picked = all.find((item) => item.name === hover) ?? shown[0];
  const own = picked ? game.get(picked.name) : undefined;

  return (
    <main className="gb-screen">
      <div className="gb-stage">
        <header className="gb-window gb-spread" style={{ alignItems: 'center', padding: '10px 20px' }}>
          <h1 className="gb-title" style={{ fontSize: 26 }}>Catálogo de itens</h1>
          <span style={{ fontSize: 22 }}>{filtered.length} / {all.length}</span>
        </header>
        <div className="gb-row" style={{ alignItems: 'flex-start' }}>
          <section className="gb-window gb-grow" aria-label="Itens">
            <div className="gb-tabs" role="tablist">
              {POCKETS.map((p, i) => <button key={p.id} type="button" role="tab" aria-selected={i === tab} className="gb-tab" onClick={() => { setTab(i); setLimit(PAGE); }}>{p.label}</button>)}
            </div>
            <input className="gb-input" style={{ width: '100%', marginBottom: 8 }} placeholder="Buscar por nome (inglês ou português)" value={text} onChange={(e) => { setText(e.target.value); setLimit(PAGE); }} />
            <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
              <Menu key={`${pocket}-${text}`} label="Itens" items={items} onMove={setHover} onBack={onBack}
                onSelect={(id) => { if (id === '__more') setLimit(limit + PAGE); }} />
              {items.length === 0 ? <p className="gb-muted">Nenhum item encontrado.</p> : null}
            </div>
          </section>
          <aside className="gb-window gb-grow" aria-label="Detalhes">
            {picked ? (
              <div className="gb-chdetail">
                <div className="gb-iconrow"><ItemIcon item={picked.name} size={48} /><h2 className="gb-title" style={{ fontSize: 22, margin: 0 }}>{own?.displayName ?? picked.en}</h2></div>
                <p className="gb-muted" style={{ margin: '2px 0' }}>{own ? `${picked.en} · ` : ''}#{picked.id} · {picked.category}</p>
                {picked.cost > 0 ? <p style={{ margin: '2px 0' }}>Valor nos jogos oficiais: {formatMoney(picked.cost)}</p> : null}
                {picked.effect ? <p style={{ margin: '4px 0' }}>{picked.effect}</p> : null}
                {picked.text && picked.text !== picked.effect ? <p className="gb-muted" style={{ margin: '4px 0', fontSize: 20 }}>{picked.text}</p> : null}
                <p style={{ margin: '6px 0 0' }}>
                  {own ? `No jogo: ${own.description}${own.price ? ` (loja ${formatMoney(own.price)})` : ''}` : 'Ainda não tem função neste jogo.'}
                </p>
                {(owned.get(picked.name) ?? 0) > 0 ? <p style={{ margin: 0 }}>Você tem {owned.get(picked.name)}.</p> : null}
              </div>
            ) : null}
          </aside>
        </div>
        <KeyHints hints={[['↑↓', 'escolher'], ['Q/E', 'bolso'], ['Z', 'mostrar mais'], ['X', 'voltar']]} />
      </div>
    </main>
  );
}
