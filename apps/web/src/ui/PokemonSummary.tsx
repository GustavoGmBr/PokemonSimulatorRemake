import { STAT_KEYS, STAT_LABELS, type PokemonView } from '@pokesim/engine';
import { HpBar, Sprite, Stars, TypeBadge, XpBar } from './bits.tsx';
import { useKeys } from './useKeys.ts';

export function locationLabel(mon: PokemonView): string {
  return mon.location.kind === 'team' ? `Equipe · posição ${mon.location.slot + 1}` : `Caixa ${mon.location.box + 1} · vaga ${mon.location.slot + 1}`;
}

/** Ficha de um Pokémon do jogador: sprite, atributos, IVs e golpes. */
export function PokemonSummary({ mon, onBack }: { mon: PokemonView; onBack: () => void }) {
  useKeys((key) => { if (key === 'back' || key === 'confirm') onBack(); });
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
