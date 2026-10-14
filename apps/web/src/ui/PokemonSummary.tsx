import { useEffect, useState } from 'react';
import { STAT_KEYS, STAT_LABELS, type PokemonView, type SpeciesIndexEntry } from '@pokesim/engine';
import { api } from '../api.ts';
import { HpBar, Sprite, Stars, TypeBadge, XpBar } from './bits.tsx';
import { Menu, type MenuItem } from './Menu.tsx';
import { useKeys } from './useKeys.ts';
import { playSound } from '../sound.ts';

export function locationLabel(mon: PokemonView): string {
  return mon.location.kind === 'team' ? `Equipe · posição ${mon.location.slot + 1}` : `Caixa ${mon.location.box + 1} · vaga ${mon.location.slot + 1}`;
}

type Panel = null | 'evolve' | 'learn' | { learn: string };

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
  useEffect(() => { setMon(initial); }, [initial]);
  useEffect(() => {
    if (!saveId) return;
    api.speciesIndex().then((list) => setNames(new Map(list.map((entry) => [entry.id, entry]))), () => undefined);
  }, [saveId]);

  const canEvolve = Boolean(saveId) && mon.evolutions.length > 0;
  const canLearn = Boolean(saveId) && mon.pendingMoves.length > 0;
  const update = (next: PokemonView, text: string) => { setMon(next); onChanged?.(next); setNote(text); setPanel(null); };
  const run = async (job: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await job(); } catch (e) { setNote((e as Error).message); playSound('error'); } finally { setBusy(false); }
  };

  useKeys((key) => {
    if (key === 'back' || key === 'confirm') onBack();
    else if (key === 'next' && canEvolve) { setPanel('evolve'); playSound('confirm'); }
    else if (key === 'goto' && canLearn) { setPanel('learn'); playSound('confirm'); }
  }, panel === null && !busy);

  const evolveItems: MenuItem[] = [
    ...mon.evolutions.map((choice): MenuItem => ({ id: String(choice.speciesId), label: `Evoluir para ${names.get(choice.speciesId)?.name ?? `#${choice.speciesId}`}`, extra: choice.requirement })),
    { id: '__back', label: 'Cancelar' },
  ];
  const learnItems: MenuItem[] = [
    ...mon.pendingMoves.map((move): MenuItem => ({ id: move.name, label: move.displayName, extra: `${move.type} · ${move.category === 'status' ? 'Status' : `Poder ${move.power}`}` })),
    { id: '__back', label: 'Cancelar' },
  ];
  const pendingMove = typeof panel === 'object' && panel ? mon.pendingMoves.find((move) => move.name === panel.learn) : undefined;
  const replaceItems: MenuItem[] = pendingMove ? [
    ...mon.moves.map((move, index): MenuItem => ({ id: String(index), label: `Esquecer ${move.displayName}`, extra: `PP ${move.maxPp}` })),
    { id: '__skip', label: `Não aprender ${pendingMove.displayName}` },
    { id: '__back', label: 'Voltar' },
  ] : [];

  return (
    <section className="gb-window" aria-labelledby="summary-title">
      <div className="gb-row" style={{ gap: 24 }}>
        <div className="gb-side gb-stack" style={{ maxWidth: 260, alignItems: 'center', textAlign: 'center' }}>
          <div style={{ background: 'var(--sky)', border: '4px solid var(--ink)', padding: 8 }}>
            <Sprite speciesId={mon.speciesId} shiny={mon.shiny} alt={mon.speciesName} size={180} />
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

          {saveId && (canEvolve || canLearn || note) ? (
            <div className="gb-window gb-window--accent gb-window--tight" aria-label="Ações do perfil">
              {note ? <p style={{ margin: '0 0 6px' }}>{note}</p> : null}
              {panel === null ? (
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {canEvolve ? <button type="button" className="gb-button gb-button--red" onClick={() => setPanel('evolve')}>Evoluir (E)</button> : null}
                  {canLearn ? <button type="button" className="gb-button gb-button--blue" onClick={() => setPanel('learn')}>Novos golpes ({mon.pendingMoves.length}) (G)</button> : null}
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
              {panel === 'learn' ? (
                <Menu label="Novos golpes" items={learnItems} active={!busy} onBack={() => setPanel(null)}
                  onSelect={(id) => setPanel(id === '__back' ? null : { learn: id })}
                />
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
                  <span>PP {move.pp}/{move.maxPp}</span>
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
