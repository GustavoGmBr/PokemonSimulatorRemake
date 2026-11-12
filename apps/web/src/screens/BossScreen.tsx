import { useEffect, useState } from 'react';
import type { BossState, BattleTurnResult } from '@pokesim/engine';
import { api } from '../api.ts';
import { ItemIcon, Sprite } from '../ui/bits.tsx';
import { useKeys } from '../ui/useKeys.ts';
import { BattleScreen } from './BattleScreen.tsx';

const STATUS = {
  available: 'Enfrentar',
  running: 'Em combate',
  lost: 'Derrota',
  capture: 'Captura disponível',
  spent: 'Concluído',
};

export function BossScreen({ saveId, onBack }: { saveId: string; onBack: () => void }) {
  const [state, setState] = useState<BossState | null>(null);
  const [battle, setBattle] = useState<BattleTurnResult | null>(null);
  const [now, setNow] = useState(Date.now);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([api.bosses(saveId), api.battle(saveId)]).then(([next, running]) => {
      if (!active) return;
      setState(next);
      if (running?.boss) setBattle({ events: [], view: running });
    }, (error: Error) => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, [saveId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  const rotationExpired = state !== null && now >= state.resetsAt;
  useEffect(() => {
    if (!rotationExpired || battle || busy) return;
    let active = true;
    const retry = window.setTimeout(() => {
      api.bosses(saveId).then((next) => { if (active) setState(next); }, (error: Error) => { if (active) setMessage(error.message); });
    }, 200);
    return () => { active = false; window.clearTimeout(retry); };
  }, [rotationExpired, battle, busy, saveId]);

  useKeys((key) => { if (key === 'back') onBack(); }, !battle && !busy);

  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await work();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (battle) {
    return <BattleScreen saveId={saveId} start={battle} habitat="mountain" onExit={() => {
      setBattle(null);
      void run(async () => setState(await api.bosses(saveId)));
    }} />;
  }

  const seconds = Math.max(0, Math.ceil(((state?.resetsAt ?? now) - now) / 1000));
  const rotation = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return (
    <main className="gb-screen">
      <div className="gb-stage">
        <header className="gb-window gb-spread">
          <h1 className="gb-title">Chefes</h1>
          {state ? <span>Nova rotação em {rotation}</span> : null}
          <button type="button" className="gb-button" disabled={busy} onClick={onBack}>Voltar</button>
        </header>
        <section className="gb-window">
          <p>Você tem 10 minutos por batalha. Se toda a equipe cair, ela volta com HP cheio e você perde 1 minuto. Itens de cura ficam bloqueados.</p>
          {state ? (
            <div className="gb-grid-2">
              {state.offers.map((offer) => {
                const levelBlocked = (state.teamMinLevel ?? 0) < offer.level;
                return (
                  <article key={offer.slot} className="gb-window gb-row" style={{ gap: 10, flexWrap: 'wrap' }}>
                    <Sprite speciesId={offer.speciesId} shiny={offer.shiny} alt="" size={72} />
                    <div>
                      <div aria-label={`${offer.stars} estrelas`}>{'★'.repeat(offer.stars)}</div>
                      <strong>{offer.shiny ? '✦ ' : ''}{offer.name}</strong>
                      <div>Nv. {offer.level} · HP ×{offer.hpMultiplier} · Outros atributos +{offer.statBonusPercent}%</div>
                      <button type="button" className="gb-button" disabled={busy || seconds === 0 || offer.status !== 'available' || levelBlocked} onClick={() => void run(async () => {
                        setBattle(await api.bossStart(saveId, state.period, offer.slot));
                      })}>{offer.status === 'available' && levelBlocked ? `Equipe precisa de Nv. ${offer.level}+` : STATUS[offer.status]}</button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : <p>{message ? 'Falha ao carregar os chefes.' : 'Carregando chefes…'}</p>}
        </section>
        {state?.pending.map((entry) => (
          <section className="gb-window gb-window--accent" key={`${entry.period}:${entry.slot}`}>
            <h2 className="gb-title">Capturar {entry.shiny ? '✦ ' : ''}{entry.name} · {'★'.repeat(entry.stars)}</h2>
            <p>Escolha uma Poké Bola para a única tentativa.</p>
            {entry.balls.length === 0 ? <p>Você precisa de uma Poké Bola.</p> : null}
            <div className="gb-row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {entry.balls.map((ball) => (
                <button type="button" key={ball.item} className="gb-button gb-iconrow" disabled={busy} onClick={() => void run(async () => {
                  const result = await api.bossCapture(saveId, entry.period, entry.slot, ball.item);
                  setState(result.state);
                  setMessage(result.caught ? `${result.name} foi capturado!` : `${result.name} escapou da Poké Bola.`);
                })}>
                  <ItemIcon item={ball.item} size={20} />{ball.displayName} ×{ball.quantity} · {((ball.chance ?? 0) * 100).toFixed(1)}%
                </button>
              ))}
            </div>
          </section>
        ))}
        {message ? <div className="gb-window" role="status">{message}</div> : null}
      </div>
    </main>
  );
}
