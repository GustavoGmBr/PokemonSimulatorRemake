import { useEffect, useState } from 'react';
import type { BattleOutcome, BattleTurnResult, TeamMemberView, TournamentState, TournamentTierView } from '@pokesim/engine';
import { api } from '../api.ts';
import { Menu, type MenuItem } from '../ui/Menu.tsx';
import { ItemIcon, KeyHints, Sprite, formatMoney } from '../ui/bits.tsx';
import { useKeys } from '../ui/useKeys.ts';
import { playSound } from '../sound.ts';
import { BattleScreen } from './BattleScreen.tsx';

interface Props {
  saveId: string;
  onBack: () => void;
}

export function TournamentScreen({ saveId, onBack }: Props) {
  const [state, setState] = useState<TournamentState | null>(null);
  const [hover, setHover] = useState('');
  const [battle, setBattle] = useState<BattleTurnResult | null>(null);
  const [picking, setPicking] = useState<TournamentTierView | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [message, setMessage] = useState('Escolha uma categoria. Vença 8 rodadas para levar a taça.');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.tournaments(saveId).then(setState, (e: Error) => setError(e.message));
  useEffect(() => {
    void load();
    api.battle(saveId).then((running) => { if (running) setBattle({ events: [], view: running }); }, () => undefined);
  }, [saveId]); // eslint-disable-line react-hooks/exhaustive-deps

  useKeys((key) => {
    if (key === 'back') {
      if (picking) { setPicking(null); playSound('back'); } else { playSound('back'); onBack(); }
    }
  }, !battle && !busy && state !== null && !state.active);

  const run = async (work: () => Promise<BattleTurnResult>) => {
    setBusy(true);
    try {
      setBattle(await work());
      setPicking(null);
    } catch (e) {
      setMessage((e as Error).message);
      playSound('error');
    } finally {
      setBusy(false);
    }
  };

  const afterBattle = (outcome: BattleOutcome | null) => {
    setBattle(null);
    const t = outcome?.tournament;
    if (t?.champion) setMessage(`CAMPEÃO da Copa ${t.tierName}! +${formatMoney(t.prizeMoney)}${t.prizeItems.length ? ' e ' + t.prizeItems.map((i) => `${i.quantity}× ${i.name}`).join(', ') : ''}.`);
    else if (t?.eliminated) setMessage(`Eliminado na rodada ${t.round} da Copa ${t.tierName}.`);
    else if (t) setMessage(`Rodada ${t.round} vencida! Continue para a rodada ${t.round + 1}.`);
    void load();
  };

  if (battle) return <BattleScreen key="battle" saveId={saveId} start={battle} habitat="forest" onExit={afterBattle} />;
  if (error) {
    return (
      <main className="gb-screen"><div className="gb-stage">
        <div className="gb-window gb-window--accent gb-dialog"><p>{error}</p></div>
        <button type="button" className="gb-button" onClick={onBack}>Voltar</button>
      </div></main>
    );
  }
  if (!state) return <main className="gb-screen"><div className="gb-stage"><div className="gb-window gb-dialog"><p>Carregando…</p></div></div></main>;

  const active = state.active;
  const toggle = (member: TeamMemberView) => setPicked((now) => (now.includes(member.id) ? now.filter((id) => id !== member.id) : [...now, member.id]));

  let body: JSX.Element;
  if (active) {
    body = (
      <section className="gb-window" aria-label="Torneio em andamento">
        <h2 className="gb-title" style={{ fontSize: 22, margin: 0 }}>Copa {active.tierName}</h2>
        <p style={{ margin: '4px 0' }}>Rodada {active.round} de {active.rounds} · nível máximo {active.cap}</p>
        <div className="gb-tourbar" aria-label={`Rodada ${active.round} de ${active.rounds}`}>
          {Array.from({ length: active.rounds }, (_, i) => <span key={i} className={i + 1 < active.round ? 'is-done' : i + 1 === active.round ? 'is-now' : ''} />)}
        </div>
        <div className="gb-row" style={{ gap: 6 }}>
          {active.members.map((m) => <Sprite key={m.id} speciesId={m.speciesId} shiny={m.shiny} alt={m.name} size={56} />)}
        </div>
        <div className="gb-row" style={{ marginTop: 12 }}>
          <button type="button" className="gb-button" disabled={busy} autoFocus onClick={() => void run(() => api.tournamentNext(saveId))}>
            {active.inBattle ? 'Retomar batalha' : `Lutar rodada ${active.round}`}
          </button>
          <button type="button" className="gb-button gb-button--red" disabled={busy || active.inBattle} onClick={() => {
            setBusy(true);
            api.tournamentAbandon(saveId).then((next) => { setState(next); setMessage('Você desistiu do torneio. A inscrição não volta.'); }, (e: Error) => setMessage(e.message)).finally(() => setBusy(false));
          }}>Desistir</button>
        </div>
      </section>
    );
  } else if (picking) {
    body = (
      <section className="gb-window" aria-label="Escolher Pokémon">
        <h2 className="gb-title" style={{ fontSize: 22, margin: 0 }}>Copa {picking.name} · inscrição {formatMoney(picking.entry)}</h2>
        <p className="gb-muted" style={{ margin: '4px 0' }}>Escolha de 1 a 6 Pokémon da equipe. Eles lutam até o nível {picking.cap}, com vida cheia a cada rodada e sem ganhar XP.</p>
        <div className="gb-teampick">
          {state.team.map((m) => (
            <button key={m.id} type="button" className={`gb-teampick__mon${picked.includes(m.id) ? ' is-on' : ''}`} aria-pressed={picked.includes(m.id)} onClick={() => toggle(m)}>
              <Sprite speciesId={m.speciesId} shiny={m.shiny} alt={m.name} size={56} />
              <span>{m.name}</span><span className="gb-muted">Nv {m.level}</span>
            </button>
          ))}
        </div>
        <div className="gb-row" style={{ marginTop: 12 }}>
          <button type="button" className="gb-button" disabled={busy || picked.length === 0} onClick={() => void run(() => api.tournamentEnter(saveId, picking.id, picked))}>
            Inscrever ({picked.length})
          </button>
          <button type="button" className="gb-button" onClick={() => setPicking(null)}>Cancelar</button>
        </div>
      </section>
    );
  } else {
    const items: MenuItem[] = state.tiers.map((t) => ({ id: t.id, label: t.name, extra: formatMoney(t.entry), disabled: state.money < t.entry }));
    const tier = state.tiers.find((t) => t.id === hover) ?? state.tiers[0];
    body = (
      <div className="gb-row" style={{ alignItems: 'flex-start' }}>
        <section className="gb-window gb-grow" aria-label="Categorias">
          <Menu label="Categorias" items={items} active={!busy} onMove={setHover} onBack={onBack}
            onSelect={(id) => { const t = state.tiers.find((x) => x.id === id); if (t) { setPicked(state.team.map((m) => m.id)); setPicking(t); } }} />
        </section>
        <aside className="gb-window gb-grow" aria-label="Detalhes">
          {tier ? (
            <div className="gb-chdetail">
              <h2 className="gb-title" style={{ fontSize: 22, margin: 0 }}>Copa {tier.name}</h2>
              <p style={{ margin: '4px 0' }}>{tier.description}</p>
              <p className="gb-muted" style={{ margin: 0, fontSize: 20 }}>{tier.rounds} rodadas · adversários com {tier.teamSize[0] === tier.teamSize[1] ? tier.teamSize[0] : `${tier.teamSize[0]}–${tier.teamSize[1]}`} Pokémon, nível {tier.minLevel}–{tier.cap} · seu time também não passa do {tier.cap}</p>
              <p style={{ margin: '6px 0 0' }}>Inscrição: {formatMoney(tier.entry)}</p>
              <p style={{ margin: 0 }}>Prêmio: {formatMoney(tier.prizeMoney)}</p>
              <p className="gb-muted gb-iconrow" style={{ margin: 0, fontSize: 20, flexWrap: 'wrap' }}>{tier.prizeItems.map((i) => <span key={i.item} className="gb-iconrow"><ItemIcon item={i.item === 'random-ball' ? 'net-ball' : i.item} size={24} />{i.min === i.max ? i.min : `${i.min}–${i.max}`}× {i.name}</span>)}{tier.essences > 0 ? <span className="gb-iconrow"><ItemIcon item="iv-hp" size={24} />{tier.essences}× Essência de IV</span> : null}</p>
              <p style={{ margin: '6px 0 0' }}>{tier.wins > 0 ? `🏆 ${tier.wins} título${tier.wins > 1 ? 's' : ''}` : 'Sem títulos ainda'}</p>
            </div>
          ) : null}
        </aside>
      </div>
    );
  }

  return (
    <main className="gb-screen">
      <div className="gb-stage">
        <header className="gb-window gb-spread" style={{ alignItems: 'center', padding: '10px 20px' }}>
          <h1 className="gb-title" style={{ fontSize: 26 }}>Torneios</h1>
          <span style={{ fontSize: 22 }}>{formatMoney(state.money)}</span>
        </header>
        {body}
        <div className="gb-window gb-dialog"><p style={{ margin: 0 }}>{message}</p></div>
        <KeyHints hints={[['↑↓', 'escolher'], ['Z', 'confirmar'], ['X', 'voltar']]} />
      </div>
    </main>
  );
}
