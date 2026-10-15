import { useEffect, useState } from 'react';
import { STAT_KEYS, STAT_LABELS, isTrainingItem, type InventoryEntry, type MoveOptions, type PokemonView, type SpeciesIndexEntry } from '@pokesim/engine';
import { api } from '../api.ts';
import { HpBar, Sprite, Stars, TypeBadge, XpBar } from './bits.tsx';
import { Menu, type MenuItem } from './Menu.tsx';
import { useKeys } from './useKeys.ts';
import { playSound } from '../sound.ts';

export function locationLabel(mon: PokemonView): string {
  return mon.location.kind === 'team' ? `Equipe · posição ${mon.location.slot + 1}` : `Caixa ${mon.location.box + 1} · vaga ${mon.location.slot + 1}`;
}

type Panel = null | 'evolve' | 'forms' | 'items' | 'learn' | 'slots' | 'tms' | { learn: string } | { teach: number } | { confirmForm: string };

/**
 * Ficha de um Pokémon do jogador: sprite, atributos, IVs e golpes.
 * Com `saveId`, também permite evoluir (E) e aprender golpes novos (G).
 */
export function PokemonSummary({ mon: initial, onBack, saveId, onChanged }: { mon: PokemonView; onBack: () => void; saveId?: string; onChanged?: (mon: PokemonView) => void }) {
  const [mon, setMon] = useState(initial);
  const [panel, setPanel] = useState<Panel>(null);
  const [names, setNames] = useState<Map<number, SpeciesIndexEntry>>(new Map());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<MoveOptions | null>(null);
  const [stock, setStock] = useState<InventoryEntry[]>([]);
  useEffect(() => { setMon(initial); }, [initial]);
  useEffect(() => {
    if (!saveId) return;
    api.speciesIndex().then((list) => setNames(new Map(list.map((entry) => [entry.id, entry]))), () => undefined);
  }, [saveId]);

  const canEvolve = Boolean(saveId) && mon.evolutions.length > 0;
  const canTransform = Boolean(saveId) && mon.forms.length > 0;
  const canLearn = Boolean(saveId) && mon.pendingMoves.length > 0;
  const update = (next: PokemonView, text: string) => { setMon(next); onChanged?.(next); setNote(text); setPanel(null); };
  const run = async (job: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await job(); } catch (e) { setNote((e as Error).message); playSound('error'); } finally { setBusy(false); }
  };

  const openTms = () => run(async () => {
    if (!saveId) return;
    setOptions(await api.moveOptions(saveId, mon.id));
    setPanel('tms');
    playSound('confirm');
  });

  const openSlots = () => run(async () => {
    if (!saveId) return;
    setOptions(await api.moveOptions(saveId, mon.id));
    setPanel('slots');
    playSound('confirm');
  });

  const openItems = () => run(async () => {
    if (!saveId) return;
    setStock((await api.getSave(saveId)).inventory.filter((entry) => isTrainingItem(entry.item) && entry.quantity > 0));
    setPanel('items');
    playSound('confirm');
  });

  useKeys((key) => {
    if (key === 'back' || key === 'confirm') onBack();
    else if (key === 'tool' && canTransform) { setPanel('forms'); playSound('confirm'); }
    else if (key === 'next' && canEvolve) { setPanel('evolve'); playSound('confirm'); }
    else if (key === 'goto' && canLearn) { setPanel('learn'); playSound('confirm'); }
    else if (key === 'filter' && saveId) { openSlots(); }
  }, panel === null && !busy);

  const evolveItems: MenuItem[] = [
    ...mon.evolutions.map((choice): MenuItem => ({
      id: String(choice.speciesId),
      label: `Evoluir para ${names.get(choice.speciesId)?.name ?? `#${choice.speciesId}`}`,
      extra: choice.ready ? choice.requirement : (choice.reason ?? choice.requirement),
      disabled: !choice.ready,
    })),
    { id: '__back', label: 'Cancelar' },
  ];
  const formItems: MenuItem[] = [
    ...mon.forms.map((choice): MenuItem => ({ id: choice.name, label: choice.displayName, extra: choice.ready ? choice.requirement : (choice.reason ?? ''), disabled: !choice.ready })),
    { id: '__back', label: 'Cancelar' },
  ];
  const itemItems: MenuItem[] = [
    ...stock.map((entry): MenuItem => ({ id: entry.item, label: entry.displayName, extra: `×${entry.quantity}` })),
    { id: '__back', label: 'Voltar' },
  ];
  const confirmForm = typeof panel === 'object' && panel && 'confirmForm' in panel ? mon.forms.find((f) => f.name === panel.confirmForm) : undefined;
  const learnItems: MenuItem[] = [
    ...mon.pendingMoves.map((move): MenuItem => ({ id: move.name, label: move.displayName, extra: `${move.type} · ${move.category === 'status' ? 'Status' : `Poder ${move.power}`}` })),
    { id: '__back', label: 'Cancelar' },
  ];
  const teachSlot = typeof panel === 'object' && panel && 'teach' in panel ? panel.teach : null;
  const slotItems: MenuItem[] = [
    ...mon.moves.map((move, index): MenuItem => ({ id: String(index), label: `Trocar ${move.displayName}`, extra: `golpe ${index + 1}` })),
    ...(mon.moves.length < 4 ? [{ id: String(mon.moves.length), label: 'Aprender em vaga livre', extra: `golpe ${mon.moves.length + 1}` } as MenuItem] : []),
    { id: '__back', label: 'Cancelar' },
  ];
  const tmItems: MenuItem[] = [
    ...(options?.learnable ?? []).filter((item) => item.source === 'machine').map((item): MenuItem => ({
      id: item.move.name,
      label: item.move.displayName,
      extra: `${item.move.category === 'status' ? 'Status' : `Poder ${item.move.power}`} · ${item.unlocked ? 'comprada ✓' : `₽ ${item.price.toLocaleString('pt-BR')}`}`,
      disabled: item.unlocked || item.price > (options?.money ?? 0),
    })),
    { id: '__back', label: 'Voltar' },
  ];
  const teachItems: MenuItem[] = [
    ...(options?.learnable ?? []).filter((item) => !item.known && item.unlocked).map((item): MenuItem => ({
      id: item.move.name,
      label: item.move.displayName,
      extra: `${item.move.category === 'status' ? 'Status' : `Poder ${item.move.power}`} · ${item.source === 'level' ? `Nv${item.level}` : 'TM'}`,
    })),
    { id: '__back', label: 'Voltar' },
  ];
  const pendingMove = typeof panel === 'object' && panel && 'learn' in panel ? mon.pendingMoves.find((move) => move.name === panel.learn) : undefined;
  const replaceItems: MenuItem[] = pendingMove ? [
    ...mon.moves.map((move, index): MenuItem => ({ id: String(index), label: `Esquecer ${move.displayName}` })),
    { id: '__skip', label: `Não aprender ${pendingMove.displayName}` },
    { id: '__back', label: 'Voltar' },
  ] : [];

  return (
    <section className="gb-window" aria-labelledby="summary-title">
      <div className="gb-row" style={{ gap: 24 }}>
        <div className="gb-side gb-stack" style={{ maxWidth: 260, alignItems: 'center', textAlign: 'center' }}>
          <div style={{ background: 'var(--sky)', border: '4px solid var(--ink)', padding: 8 }}>
            <Sprite speciesId={mon.spriteId} shiny={mon.shiny} alt={mon.speciesName} size={180} />
          </div>
          <h2 id="summary-title" className="gb-title" style={{ fontSize: 28 }}>
            {mon.favorite ? <span className="gb-fav" aria-label="Favorito">♥ </span> : null}
            {mon.name}{mon.shiny ? ' ✦' : ''}
          </h2>
          <span className="gb-muted">Nº {String(mon.speciesId).padStart(4, '0')}{mon.nickname ? ` · ${mon.speciesName}` : ''}{mon.gender ? ` · ${mon.gender === 'M' ? '♂' : '♀'}` : ''}</span>
          <span style={{ display: 'flex', gap: 6 }}>{mon.types.map((t) => <TypeBadge key={t} type={t} />)}</span>
          <div style={{ width: '100%' }}>
            <div className="gb-spread"><span className="gb-label">Nv{mon.level}</span><span>{mon.currentHp}/{mon.stats.hp}</span></div>
            <HpBar current={mon.currentHp} max={mon.stats.hp} />
            <div style={{ marginTop: 6 }}><XpBar progress={mon.expProgress} /></div>
          </div>
          <span className="gb-hint">{locationLabel(mon)}</span>
        </div>

        <div className="gb-grow gb-stack">
          <div className="gb-spread">
            <h3 className="gb-title" style={{ fontSize: 22 }}>Atributos</h3>
            <span><Stars count={mon.ivStars} /> <span className="gb-muted">IV {mon.ivTotal}/186</span></span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 24 }}>
            <thead>
              <tr className="gb-muted" style={{ textAlign: 'left' }}>
                <th scope="col" style={{ fontWeight: 400 }}>Atributo</th>
                <th scope="col" style={{ fontWeight: 400, textAlign: 'right' }}>Valor</th>
                <th scope="col" style={{ fontWeight: 400, textAlign: 'right' }}>IV</th>
              </tr>
            </thead>
            <tbody>
              {STAT_KEYS.map((key) => (
                <tr key={key} style={{ borderTop: '2px solid var(--rim)' }}>
                  <th scope="row" style={{ textAlign: 'left', fontWeight: 400 }}>{STAT_LABELS[key]}</th>
                  <td style={{ textAlign: 'right' }}>{mon.stats[key]}</td>
                  <td style={{ textAlign: 'right', color: mon.ivs[key] === 31 ? 'var(--ok)' : undefined }}>{mon.ivs[key]}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {saveId ? (
            <div className="gb-window gb-window--accent gb-window--tight" aria-label="Ações do perfil">
              {note ? <p style={{ margin: '0 0 6px' }}>{note}</p> : null}
              {panel === null ? (
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {canEvolve ? <button type="button" className="gb-button gb-button--red" onClick={() => setPanel('evolve')}>Evoluir (E)</button> : null}
                  {canTransform ? <button type="button" className="gb-button gb-button--red" onClick={() => setPanel('forms')}>Transformar (T)</button> : null}
                  <button type="button" className="gb-button" disabled={busy} onClick={() => void openItems()}>Doces e Essências</button>
                  {canLearn ? <button type="button" className="gb-button gb-button--blue" onClick={() => setPanel('learn')}>Novos golpes ({mon.pendingMoves.length}) (G)</button> : null}
                  <button type="button" className="gb-button" disabled={busy} onClick={() => void openSlots()}>Trocar golpes (F)</button>
                  <button type="button" className="gb-button gb-button--blue" disabled={busy} onClick={() => void openTms()}>Comprar TMs</button>
                </div>
              ) : null}
              {panel === 'evolve' ? (
                <Menu label="Evoluir" items={evolveItems} active={!busy} onBack={() => setPanel(null)}
                  onSelect={(id) => {
                    if (id === '__back' || !saveId) { setPanel(null); return; }
                    void run(async () => {
                      const next = await api.evolve(saveId, mon.id, Number(id));
                      playSound('levelup');
                      update(next, `${mon.name} evoluiu para ${next.speciesName}!`);
                    });
                  }}
                />
              ) : null}
              {panel === 'forms' ? (
                <>
                  <p style={{ margin: '0 0 6px' }}>Formas permanentes de {mon.name}. A transformação não tem volta e gasta o item.</p>
                  <Menu label="Transformar" items={formItems} active={!busy} onBack={() => setPanel(null)}
                    onSelect={(id) => setPanel(id === '__back' ? null : { confirmForm: id })}
                  />
                </>
              ) : null}
              {confirmForm && saveId ? (
                <>
                  <p style={{ margin: '0 0 6px' }}>Transformar {mon.name} em {confirmForm.displayName} para sempre?</p>
                  <Menu label="Confirmar" active={!busy} onBack={() => setPanel('forms')}
                    items={[{ id: 'yes', label: `Sim, virar ${confirmForm.displayName}` }, { id: 'no', label: 'Cancelar' }]}
                    onSelect={(id) => {
                      if (id !== 'yes') { setPanel('forms'); return; }
                      void run(async () => {
                        const next = await api.transform(saveId, mon.id, confirmForm.name);
                        playSound('levelup');
                        update(next, `${mon.name} virou ${next.speciesName}!`);
                      });
                    }}
                  />
                </>
              ) : null}
              {panel === 'items' && saveId ? (
                <>
                  <p style={{ margin: '0 0 6px' }}>{stock.length === 0 ? 'Você não tem Doces nem Essências de IV.' : `Use em ${mon.name}. Essência: +1 IV (máx. 31). Doce: XP ou nível.`}</p>
                  <Menu label="Doces e Essências" items={itemItems} active={!busy} onBack={() => setPanel(null)}
                    onSelect={(id) => {
                      if (id === '__back') { setPanel(null); return; }
                      void run(async () => {
                        const result = await api.useItem(saveId, id, mon.id);
                        playSound('levelup');
                        setMon(result.pokemon); onChanged?.(result.pokemon);
                        setNote(result.message ?? `${mon.name} usou o item.`);
                        setStock((await api.getSave(saveId)).inventory.filter((entry) => isTrainingItem(entry.item) && entry.quantity > 0));
                      });
                    }}
                  />
                </>
              ) : null}
              {panel === 'learn' ? (
                <Menu label="Novos golpes" items={learnItems} active={!busy} onBack={() => setPanel(null)}
                  onSelect={(id) => setPanel(id === '__back' ? null : { learn: id })}
                />
              ) : null}
              {panel === 'slots' ? (
                <>
                  <p style={{ margin: '0 0 6px' }}>Qual golpe de {mon.name} você quer trocar?</p>
                  <Menu label="Vaga de golpe" items={slotItems} active={!busy} onBack={() => setPanel(null)}
                    onSelect={(id) => (id === '__back' ? setPanel(null) : setPanel({ teach: Number(id) }))}
                  />
                </>
              ) : null}
              {panel === 'tms' && saveId ? (
                <>
                  <p style={{ margin: '0 0 6px' }}>TMs que {mon.name} pode aprender. Comprada, a TM fica com ele para sempre (depois ensine em "Trocar golpes"). Dinheiro: ₽ {(options?.money ?? 0).toLocaleString('pt-BR')}.</p>
                  <Menu label="TMs" items={tmItems} active={!busy} onBack={() => setPanel(null)}
                    onSelect={(id) => {
                      if (id === '__back') { setPanel(null); return; }
                      void run(async () => {
                        const next = await api.buyTm(saveId, mon.id, id);
                        playSound('save');
                        setOptions(next);
                        setNote(`TM de ${next.learnable.find((item) => item.move.name === id)?.move.displayName ?? id} comprada!`);
                      });
                    }}
                  />
                </>
              ) : null}
              {teachSlot !== null && saveId ? (
                <>
                  <p style={{ margin: '0 0 6px' }}>Novo golpe para a vaga {teachSlot + 1}. Nível = já aprendido; TM = as que você comprou para ele. Dinheiro: ₽ {(options?.money ?? 0).toLocaleString('pt-BR')}.</p>
                  <Menu label="Golpes permitidos" items={teachItems} active={!busy} onBack={() => setPanel('slots')}
                    onSelect={(id) => {
                      if (id === '__back') { setPanel('slots'); return; }
                      void run(async () => {
                        const old = mon.moves[teachSlot]?.displayName;
                        const next = await api.teachMove(saveId, mon.id, id, teachSlot);
                        playSound('save');
                        const learned = next.moves[teachSlot]?.displayName ?? id;
                        update(next, old ? `${mon.name} esqueceu ${old} e aprendeu ${learned}!` : `${mon.name} aprendeu ${learned}!`);
                      });
                    }}
                  />
                </>
              ) : null}
              {pendingMove ? (
                <>
                  <p style={{ margin: '0 0 6px' }}>{mon.name} quer aprender {pendingMove.displayName}. Qual golpe esquecer?</p>
                  <Menu label="Esquecer golpe" items={replaceItems} active={!busy} onBack={() => setPanel('learn')}
                    onSelect={(id) => {
                      if (id === '__back' || !saveId) { setPanel('learn'); return; }
                      void run(async () => {
                        const replace = id === '__skip' ? null : Number(id);
                        const old = replace === null ? null : mon.moves[replace]?.displayName;
                        const next = await api.learnMove(saveId, mon.id, pendingMove.name, replace);
                        playSound('save');
                        update(next, replace === null ? `${mon.name} não aprendeu ${pendingMove.displayName}.` : `${mon.name} esqueceu ${old} e aprendeu ${pendingMove.displayName}!`);
                      });
                    }}
                  />
                </>
              ) : null}
            </div>
          ) : null}

          <h3 className="gb-title" style={{ fontSize: 22, marginTop: 8 }}>Golpes</h3>
          <div className="gb-grid-2">
            {mon.moves.map((move) => (
              <div key={move.name} className="gb-window gb-window--tight" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span className="gb-label" style={{ textTransform: 'uppercase' }}>{move.displayName}</span>
                <span className="gb-spread" style={{ fontSize: 20 }}>
                  <TypeBadge type={move.type} />
                </span>
                <span className="gb-muted" style={{ fontSize: 20 }}>
                  {move.category === 'status' ? 'Status' : `Poder ${move.power}`}{move.accuracy ? ` · Precisão ${move.accuracy}` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
