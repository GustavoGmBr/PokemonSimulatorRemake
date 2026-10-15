import { useEffect, useState } from 'react';
import type { MissionsState, MissionView } from '@pokesim/engine';
import { api } from '../api.ts';
import { ItemIcon, KeyHints, formatMoney } from '../ui/bits.tsx';
import { useKeys } from '../ui/useKeys.ts';
import { playSound } from '../sound.ts';

interface Props { saveId: string; onBack: () => void }

const time = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 3600)}h${String(Math.floor((total % 3600) / 60)).padStart(2, '0')}m${String(total % 60).padStart(2, '0')}s`;
};

function Reward({ reward }: { reward: MissionView['reward'] }) {
  return (
    <span className="gb-iconrow" style={{ flexWrap: 'wrap', gap: 10, fontSize: 20 }}>
      <span>{formatMoney(reward.money)}</span>
      {reward.chips > 0 ? <span>🪙 {reward.chips}</span> : null}
      {reward.items.map((i) => <span key={i.item} className="gb-iconrow"><ItemIcon item={i.item} size={24} />{i.quantity}× {i.name}</span>)}
    </span>
  );
}

export function MissionsScreen({ saveId, onBack }: Props) {
  const [state, setState] = useState<MissionsState | null>(null);
  const [message, setMessage] = useState('Complete os objetivos e resgate as recompensas. Concluir as dez dá um bônus!');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(0);

  useEffect(() => { api.missions(saveId).then((s) => { setState(s); setLeft(s.msLeft); }, (e: Error) => setError(e.message)); }, [saveId]);
  useEffect(() => {
    if (!state) return;
    const id = window.setInterval(() => {
      setLeft((ms) => {
        if (ms <= 1000) { api.missions(saveId).then((s) => { setState(s); setLeft(s.msLeft); setMessage('Missões renovadas!'); }, () => undefined); return 0; }
        return ms - 1000;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [state?.period, saveId]); // eslint-disable-line react-hooks/exhaustive-deps
  useKeys((key) => { if (key === 'back') { playSound('back'); onBack(); } }, !busy);

  if (error) return <main className="gb-screen"><div className="gb-stage"><div className="gb-window gb-window--accent gb-dialog"><p>{error}</p></div><button type="button" className="gb-button" onClick={onBack}>Voltar</button></div></main>;
  if (!state) return <main className="gb-screen"><div className="gb-stage"><div className="gb-window gb-dialog"><p>Carregando…</p></div></div></main>;

  const claim = (mission: MissionView) => {
    setBusy(true);
    api.missionClaim(saveId, state.period, mission.index).then((res) => {
      setState(res.state);
      setMessage(res.bonus ? `Missão resgatada! BÔNUS por concluir as dez: ${formatMoney(res.bonus.money)}, 🪙 ${res.bonus.chips} e ${res.bonus.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}.` : 'Recompensa resgatada!');
      playSound('confirm');
    }, (e: Error) => { setMessage(e.message); playSound('error'); }).finally(() => setBusy(false));
  };

  const doneCount = state.missions.filter((m) => m.done).length;
  return (
    <main className="gb-screen">
      <div className="gb-stage">
        <header className="gb-window gb-spread" style={{ alignItems: 'center', padding: '10px 20px' }}>
          <h1 className="gb-title" style={{ fontSize: 26 }}>Missões</h1>
          <span style={{ fontSize: 22 }}>{doneCount}/{state.missions.length} · renovam em {time(left)}</span>
        </header>
        <section className="gb-window" aria-label="Missões">
          <ul className="gb-missions">
            {state.missions.map((m) => (
              <li key={m.index} className={m.claimed ? 'is-claimed' : m.done ? 'is-done' : ''}>
                <div className="gb-grow">
                  <div>{m.title}</div>
                  <div className="gb-minibar" role="meter" aria-valuemin={0} aria-valuemax={m.target} aria-valuenow={m.progress} aria-label={m.title}><span style={{ width: `${(m.progress / m.target) * 100}%` }} /></div>
                  <span className="gb-muted" style={{ fontSize: 20 }}>{m.progress}/{m.target} · </span><Reward reward={m.reward} />
                </div>
                <button type="button" className="gb-button" disabled={busy || !m.done || m.claimed} onClick={() => claim(m)}>{m.claimed ? 'Resgatada' : 'Resgatar'}</button>
              </li>
            ))}
          </ul>
          <p style={{ margin: '8px 0 0' }}>Bônus das dez: <Reward reward={state.bonus} /> {state.bonusClaimed ? '✔' : state.allDone ? '(resgate qualquer missão)' : ''}</p>
        </section>
        <div className="gb-window gb-dialog"><p style={{ margin: 0 }} aria-live="polite">{message}</p></div>
        <button type="button" className="gb-button" onClick={onBack}>Voltar</button>
        <KeyHints hints={[['X', 'voltar']]} />
      </div>
    </main>
  );
}
