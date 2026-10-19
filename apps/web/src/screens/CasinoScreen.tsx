import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  CASINO_GAMES, CASINO_NAMES, GROUP_SPECIES, RACE_LENGTH, RACE_RUNNERS, WHEEL_LAYOUT, SLOT_SYMBOLS,
  type CasinoActResult, type CasinoGame, type CasinoResult, type CasinoRoundView, type CasinoState, type PokemonView, type RouletteGroup,
} from '@pokesim/engine';
import { api } from '../api.ts';
import { BallIcon, ItemIcon, KeyHints, Sprite, formatMoney } from '../ui/bits.tsx';
import { useKeys } from '../ui/useKeys.ts';
import { playSound } from '../sound.ts';

interface Props {
  saveId: string;
  onBack: () => void;
}

type Tab = CasinoGame | 'chips' | 'prizes';
const TABS: { id: Tab; label: string }[] = [
  ...CASINO_GAMES.map((id) => ({ id: id as Tab, label: CASINO_NAMES[id] })),
  { id: 'chips', label: 'Fichas' },
  { id: 'prizes', label: 'Prêmios' },
];
const GAME_HELP: Record<CasinoGame, string> = {
  slots: '3×3 com 8 linhas. Ditto é coringa. Master Bola ×3 em uma linha paga 100×.',
  roulette: '37 casas. Número/verde 36×, cor/paridade/faixa 2×, dúzia 3×, grupo Pokémon 4×.',
  voltorb: 'Vire até 6 cartas: some os multiplicadores. Um Voltorb zera tudo. Linha ou coluna completa ×1,5.',
  jack: 'Chegue a 21 sem estourar. A banca para em 17. Vitória 2×, 21 natural 3×, empate devolve.',
  race: 'Aposte em um dos 5 corredores. Acertou: 6×.',
  wheel: 'Gire a roda: 0×, 0,25×, 0,5×, 1×, 2×, 5× ou 10×.',
  piplup: 'Salte até 7 vezes; cada salto rende mais, mas pode cair. Saque quando quiser.',
};
const roulettePicks: { id: string; label: string; bet: unknown }[] = [
  { id: 'red', label: 'Vermelho 2×', bet: { kind: 'color', value: 'red' } },
  { id: 'black', label: 'Preto 2×', bet: { kind: 'color', value: 'black' } },
  { id: 'green', label: 'Verde (0) 36×', bet: { kind: 'color', value: 'green' } },
  { id: 'odd', label: 'Ímpar 2×', bet: { kind: 'parity', value: 'odd' } },
  { id: 'even', label: 'Par 2×', bet: { kind: 'parity', value: 'even' } },
  { id: 'low', label: '1–18 2×', bet: { kind: 'half', value: 'low' } },
  { id: 'high', label: '19–36 2×', bet: { kind: 'half', value: 'high' } },
  { id: 'd1', label: '1ª dúzia 3×', bet: { kind: 'dozen', value: 1 } },
  { id: 'd2', label: '2ª dúzia 3×', bet: { kind: 'dozen', value: 2 } },
  { id: 'd3', label: '3ª dúzia 3×', bet: { kind: 'dozen', value: 3 } },
];
const SLOT_SPECIES: Partial<Record<string, number>> = { pikachu: 25, mewtwo: 150, mew: 151, ditto: 132 };
const MULT = (n: number) => `${String(n).replace('.', ',')}×`;

function SlotCell({ symbol }: { symbol: string }) {
  const species = SLOT_SPECIES[symbol];
  return <div className="gb-slotcell">{species ? <Sprite speciesId={species} alt={symbol} size={48} /> : <BallIcon item={symbol} />}</div>;
}

export function CasinoScreen({ saveId, onBack }: Props) {
  const [state, setState] = useState<CasinoState | null>(null);
  const [tab, setTab] = useState<Tab>('slots');
  const [mode, setMode] = useState<'chips' | 'pokemon'>('chips');
  const [bet, setBet] = useState(10);
  const [mon, setMon] = useState<PokemonView | null>(null);
  const [round, setRound] = useState<CasinoRoundView | null>(null);
  const [last, setLast] = useState<CasinoResult | null>(null);
  const [message, setMessage] = useState('Bem-vindo ao Pokécassino! Fichas custam ₽ 5 cada.');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<{ grid?: string[]; number?: number | null; frame?: number[]; wheel?: number | null; board?: number[] } | null>(null);
  const [rouletteBet, setRouletteBet] = useState('red');
  const [rouletteNumber, setRouletteNumber] = useState(7);
  const [rouletteGroup, setRouletteGroup] = useState<RouletteGroup | ''>('');
  const [pick, setPick] = useState(0);
  const [chipAmount, setChipAmount] = useState(100);
  const [auto, setAuto] = useState(false);
  const timer = useRef<number | null>(null);

  const apply = (next: CasinoState) => { setState(next); setRound(next.round); if (next.round) setTab(next.round.game); };
  useEffect(() => {
    api.casino(saveId).then(apply, (e: Error) => setError(e.message));
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [saveId]); // eslint-disable-line react-hooks/exhaustive-deps

  useKeys((key) => { if (key === 'back') { playSound('back'); onBack(); } }, !busy && !round && state !== null);

  // Giro automático do caça-níqueis: repete a mesma aposta em fichas até faltar ficha, dar erro ou o jogador parar.
  useEffect(() => {
    if (!auto) return;
    if (tab !== 'slots' || mode !== 'chips' || (state && state.chips < bet)) { setAuto(false); return; }
    if (busy) return;
    const id = window.setTimeout(() => void play('slots'), 700);
    return () => window.clearTimeout(id);
  }, [auto, busy, tab, mode, bet, state?.chips]); // eslint-disable-line react-hooks/exhaustive-deps

  const stakeBody = () => (mode === 'pokemon' && mon ? { pokemonId: mon.id } : { bet });
  const absorb = (chips: number, money: number) => setState((s) => (s ? { ...s, chips, money } : s));

  /** Anima por ~0,8 s e depois mostra o resultado de verdade. */
  const animate = (tick: () => void, done: () => void) => {
    let n = 0;
    if (timer.current) window.clearInterval(timer.current);
    timer.current = window.setInterval(() => {
      tick();
      if (++n >= 8) { window.clearInterval(timer.current as number); timer.current = null; done(); }
    }, 100);
  };

  const describe = (r: CasinoResult): string => {
    const s = r.stake;
    if (s.pokemon) {
      return s.pokemon.lost
        ? `Você perdeu ${s.pokemon.name}…`
        : s.multiplier > 1 ? `${s.pokemon.name} venceu! +${formatMoney(s.pokemon.prizeMoney)} e ${s.pokemon.prizeChips.toLocaleString('pt-BR')} fichas.` : `Empate: ${s.pokemon.name} voltou para você.`;
    }
    return s.net > 0 ? `Ganhou ${s.net.toLocaleString('pt-BR')} fichas! (${MULT(s.multiplier)})` : s.net === 0 ? 'Aposta devolvida.' : `Perdeu ${(-s.net).toLocaleString('pt-BR')} fichas.`;
  };

  const finish = (r: CasinoResult) => {
    setLast(r);
    absorb(r.chips, r.money);
    setMessage(describe(r));
    playSound(r.stake.net > 0 || (r.stake.pokemon && !r.stake.pokemon.lost && r.stake.multiplier > 1) ? 'confirm' : 'error');
    if (mon && r.stake.pokemon?.lost) setMon(null);
  };

  const fail = (e: unknown) => { setMessage((e as Error).message); playSound('error'); setAuto(false); setBusy(false); };

  const play = async (game: CasinoGame, extra: Record<string, unknown> = {}) => {
    if (mode === 'pokemon' && !mon) { setMessage('Escolha um Pokémon para apostar.'); return; }
    setBusy(true);
    setLast(null);
    try {
      const result = await api.casinoPlay(saveId, game, { ...stakeBody(), ...extra });
      const d = result.detail;
      const rand = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)] as T;
      animate(() => {
        if (d.game === 'slots') setShown({ grid: Array.from({ length: 9 }, () => rand(SLOT_SYMBOLS)) });
        else if (d.game === 'roulette') setShown({ number: Math.floor(Math.random() * 37) });
        else if (d.game === 'race') setShown({ frame: d.frames[Math.floor(Math.random() * d.frames.length)] });
        else if (d.game === 'wheel') setShown({ wheel: Math.floor(Math.random() * WHEEL_LAYOUT.length) });
      }, () => {
        if (d.game === 'slots') setShown({ grid: d.grid });
        else if (d.game === 'roulette') setShown({ number: d.number });
        else if (d.game === 'race') setShown({ frame: d.frames[d.frames.length - 1] });
        else if (d.game === 'wheel') setShown({ wheel: d.index });
        finish(result);
        setBusy(false);
      });
    } catch (e) { fail(e); }
  };

  const afterAct = (res: CasinoActResult) => {
    absorb(res.chips, res.money);
    setRound(res.round);
    if (res.result) {
      if (res.result.detail.game === 'voltorb') setShown({ board: res.result.detail.board });
      finish(res.result);
    }
  };
  const startRound = async (game: CasinoGame) => {
    if (mode === 'pokemon' && !mon) { setMessage('Escolha um Pokémon para apostar.'); return; }
    setBusy(true); setLast(null); setShown(null);
    try { afterAct(await api.casinoStart(saveId, game, stakeBody())); } catch (e) { fail(e); return; }
    setBusy(false);
  };
  const act = async (action: string, index?: number) => {
    setBusy(true);
    try { afterAct(await api.casinoAct(saveId, action, index)); } catch (e) { setMessage((e as Error).message); playSound('error'); }
    setBusy(false);
  };

  if (error) {
    return (
      <main className="gb-screen"><div className="gb-stage">
        <div className="gb-window gb-window--accent gb-dialog"><p>{error}</p></div>
        <button type="button" className="gb-button" onClick={onBack}>Voltar</button>
      </div></main>
    );
  }
  if (!state) return <main className="gb-screen"><div className="gb-stage"><div className="gb-window gb-dialog"><p>Carregando…</p></div></div></main>;

  const locked = Boolean(round);
  const isGame = (CASINO_GAMES as readonly string[]).includes(tab);
  const game = tab as CasinoGame;

  const stakeBox = (
    <div className="gb-stake">
      <div className="gb-row" style={{ gap: 6 }}>
        <button type="button" className={`gb-tab${mode === 'chips' ? ' is-on' : ''}`} aria-pressed={mode === 'chips'} disabled={locked || busy} onClick={() => setMode('chips')}>Fichas</button>
        <button type="button" className={`gb-tab${mode === 'pokemon' ? ' is-on' : ''}`} aria-pressed={mode === 'pokemon'} disabled={locked || busy} onClick={() => setMode('pokemon')}>Apostar um Pokémon</button>
      </div>
      {mode === 'chips' ? (
        <div className="gb-row" style={{ gap: 6, alignItems: 'center' }}>
          <label>Aposta <input type="number" min={1} value={bet} disabled={locked || busy} onChange={(e) => setBet(Math.max(1, Math.floor(Number(e.target.value) || 1)))} className="gb-input" style={{ width: 120 }} /></label>
          {[10, 100, 1000].map((n) => <button key={n} type="button" className="gb-button" disabled={locked || busy} onClick={() => setBet(n)}>{n}</button>)}
          <button type="button" className="gb-button" disabled={locked || busy} onClick={() => setBet(Math.max(1, state.chips))}>Tudo</button>
        </div>
      ) : <PokemonPicker saveId={saveId} chosen={mon} onChoose={setMon} disabled={locked || busy} />}
    </div>
  );

  let panel: ReactElement | null = null;
  if (tab === 'chips') {
    panel = (
      <div className="gb-stake">
        <p style={{ margin: 0 }}>Fichas custam {formatMoney(state.chipPrice)} cada. Você tem {formatMoney(state.money)}.</p>
        <div className="gb-row" style={{ gap: 6, alignItems: 'center' }}>
          <label>Quantas <input type="number" min={1} value={chipAmount} onChange={(e) => setChipAmount(Math.max(1, Math.floor(Number(e.target.value) || 1)))} className="gb-input" style={{ width: 140 }} /></label>
          {[100, 1000, 10000].map((n) => <button key={n} type="button" className="gb-button" onClick={() => setChipAmount(n)}>{n.toLocaleString('pt-BR')}</button>)}
        </div>
        <p className="gb-muted" style={{ margin: 0 }}>Custo: {formatMoney(chipAmount * state.chipPrice)}</p>
        <button type="button" className="gb-button" disabled={busy || locked} onClick={() => {
          setBusy(true);
          api.casinoChips(saveId, chipAmount).then((next) => { apply(next); setMessage(`Você comprou ${chipAmount.toLocaleString('pt-BR')} fichas.`); playSound('confirm'); }, (e: Error) => { setMessage(e.message); playSound('error'); }).finally(() => setBusy(false));
        }}>Comprar fichas</button>
      </div>
    );
  } else if (tab === 'prizes') {
    panel = (
      <div className="gb-stake">
        <p style={{ margin: 0 }}>Troque suas fichas por prêmios.</p>
        <ul className="gb-prizes">
          {state.prizes.map((p) => (
            <li key={p.item}>
              <span className="gb-iconrow"><ItemIcon item={p.item} size={28} />{p.displayName} <span className="gb-muted">(você tem {p.owned})</span></span>
              <button type="button" className="gb-button" disabled={busy || locked || state.chips < p.price} onClick={() => {
                setBusy(true);
                api.casinoPrize(saveId, p.item).then((next) => { apply(next); setMessage(`${p.displayName} comprado!`); playSound('confirm'); }, (e: Error) => { setMessage(e.message); playSound('error'); }).finally(() => setBusy(false));
              }}>{p.price.toLocaleString('pt-BR')} fichas</button>
            </li>
          ))}
        </ul>
      </div>
    );
  } else if (tab === 'slots') {
    const grid = shown?.grid ?? (last?.detail.game === 'slots' ? last.detail.grid : null);
    panel = (
      <>
        <div className="gb-slotgrid" aria-label="Caça-níqueis">{(grid ?? Array<string>(9).fill('poke-ball')).map((s, i) => <SlotCell key={i} symbol={s} />)}</div>
        {last?.detail.game === 'slots' && last.detail.lines.length > 0 ? <p className="gb-muted" style={{ margin: 0 }}>{last.detail.lines.map((l) => `linha ${l.line + 1}: ${MULT(l.multiplier)}`).join(' · ')}</p> : null}
        {stakeBox}
        <div className="gb-row" style={{ gap: 6 }}>
          <button type="button" className="gb-button" disabled={busy || auto} onClick={() => void play('slots')}>Girar</button>
          <button type="button" className="gb-button" disabled={mode !== 'chips' || (!auto && state.chips < bet)} aria-pressed={auto} onClick={() => setAuto((on) => !on)}>{auto ? 'Parar automático' : 'Giro automático'}</button>
        </div>
      </>
    );
  } else if (tab === 'roulette') {
    const bet2 = rouletteBet === 'number' ? { kind: 'number', value: rouletteNumber } : rouletteBet === 'group' ? { kind: 'group', value: rouletteGroup || 'charmander' } : roulettePicks.find((p) => p.id === rouletteBet)?.bet;
    const n = shown?.number ?? null;
    panel = (
      <>
        <div className={`gb-roulette-ball gb-roulette-ball--${n === null ? 'none' : n === 0 ? 'green' : isRed(n) ? 'red' : 'black'}`} aria-live="polite">{n ?? '?'}</div>
        <div className="gb-chips">
          {roulettePicks.map((p) => <button key={p.id} type="button" className={`gb-tab${rouletteBet === p.id ? ' is-on' : ''}`} aria-pressed={rouletteBet === p.id} onClick={() => setRouletteBet(p.id)}>{p.label}</button>)}
          <button type="button" className={`gb-tab${rouletteBet === 'number' ? ' is-on' : ''}`} aria-pressed={rouletteBet === 'number'} onClick={() => setRouletteBet('number')}>Número 36×</button>
          {(Object.keys(GROUP_SPECIES) as RouletteGroup[]).map((g) => (
            <button key={g} type="button" className={`gb-tab${rouletteBet === 'group' && rouletteGroup === g ? ' is-on' : ''}`} aria-pressed={rouletteBet === 'group' && rouletteGroup === g} onClick={() => { setRouletteBet('group'); setRouletteGroup(g); }}>
              <Sprite speciesId={GROUP_SPECIES[g]} alt={g} size={24} /> 4×
            </button>
          ))}
        </div>
        {rouletteBet === 'number' ? <label>Número (0–36) <input type="number" min={0} max={36} value={rouletteNumber} onChange={(e) => setRouletteNumber(Math.min(36, Math.max(0, Math.floor(Number(e.target.value) || 0))))} className="gb-input" style={{ width: 80 }} /></label> : null}
        {stakeBox}
        <button type="button" className="gb-button" disabled={busy} onClick={() => void play('roulette', { bet_on: bet2 })}>Girar a roleta</button>
      </>
    );
  } else if (tab === 'race') {
    const frame = shown?.frame ?? RACE_RUNNERS.map(() => 0);
    const winner = last?.detail.game === 'race' ? last.detail.winner : -1;
    panel = (
      <>
        <div className="gb-track" aria-label="Pista">
          {RACE_RUNNERS.map((id, i) => (
            <div key={id} className={`gb-lane${winner === i ? ' is-win' : ''}`}>
              <button type="button" className={`gb-lane__pick${pick === i ? ' is-on' : ''}`} aria-pressed={pick === i} onClick={() => setPick(i)}><Sprite speciesId={id} alt={`Corredor ${i + 1}`} size={40} /></button>
              <div className="gb-lane__road"><span style={{ left: `${Math.min(100, ((frame[i] ?? 0) / RACE_LENGTH) * 100)}%` }}><Sprite speciesId={id} alt="" size={32} /></span></div>
            </div>
          ))}
        </div>
        <p className="gb-muted" style={{ margin: 0 }}>Seu corredor: nº {pick + 1}</p>
        {stakeBox}
        <button type="button" className="gb-button" disabled={busy} onClick={() => void play('race', { pick })}>Largar!</button>
      </>
    );
  } else if (tab === 'wheel') {
    const at = shown?.wheel ?? null;
    panel = (
      <>
        <div className="gb-wheel" aria-label="Roda">
          {WHEEL_LAYOUT.map((m, i) => <span key={i} className={`gb-wheel__cell gb-wheel__cell--${m >= 5 ? 'hi' : m >= 1 ? 'mid' : 'lo'}${at === i ? ' is-at' : ''}`} title={MULT(m)} />)}
        </div>
        <p style={{ margin: 0, fontSize: 28 }}>{at !== null ? MULT(WHEEL_LAYOUT[at] as number) : '—'}</p>
        {stakeBox}
        <button type="button" className="gb-button" disabled={busy} onClick={() => void play('wheel')}>Girar a roda</button>
      </>
    );
  } else if (tab === 'voltorb') {
    const revealed = new Map(round?.game === 'voltorb' ? round.revealed.map((r) => [r.index, r.value]) : []);
    const board = shown?.board ?? null;
    panel = (
      <>
        <div className="gb-vgrid" aria-label="Voltorb Flip">
          {Array.from({ length: 36 }, (_, i) => {
            const value = board ? board[i] : revealed.get(i);
            const open = value !== undefined;
            return (
              <button key={i} type="button" className={`gb-vcard${open ? (value === 0 ? ' is-bomb' : ' is-open') : ''}`} disabled={busy || !round || open} aria-label={`Carta ${i + 1}`} onClick={() => void act('flip', i)}>
                {open ? (value === 0 ? '💥' : MULT(value as number)) : '?'}
              </button>
            );
          })}
        </div>
        {round?.game === 'voltorb' ? (
          <div className="gb-row" style={{ alignItems: 'center' }}>
            <span>Total: {MULT(round.multiplier)} · cartas restantes: {round.picksLeft}</span>
            <button type="button" className="gb-button" disabled={busy || round.revealed.length === 0} onClick={() => void act('cashout')}>Sacar</button>
          </div>
        ) : (<>{stakeBox}<button type="button" className="gb-button" disabled={busy} onClick={() => void startRound('voltorb')}>Nova rodada</button></>)}
      </>
    );
  } else if (tab === 'jack') {
    const r = round?.game === 'jack' ? round : null;
    const d = last?.detail.game === 'jack' ? last.detail : null;
    const player = r?.player ?? d?.player ?? [];
    const dealer = r ? r.dealer : d?.dealer ?? [];
    panel = (
      <>
        <div><span className="gb-muted">Banca</span><div className="gb-cards">{dealer.map((c, i) => <CardView key={i} rank={c.rank} suit={c.suit} />)}{r ? <CardView hidden /> : null}</div></div>
        <div><span className="gb-muted">Você{r ? ` · ${r.playerTotal}` : ''}</span><div className="gb-cards">{player.map((c, i) => <CardView key={i} rank={c.rank} suit={c.suit} />)}</div></div>
        {r ? (
          <div className="gb-row">
            <button type="button" className="gb-button" disabled={busy} onClick={() => void act('hit')}>Pedir</button>
            <button type="button" className="gb-button" disabled={busy} onClick={() => void act('stand')}>Parar</button>
            <button type="button" className="gb-button" disabled={busy || !r.canDouble} onClick={() => void act('double')}>Dobrar</button>
          </div>
        ) : (<>{stakeBox}<button type="button" className="gb-button" disabled={busy} onClick={() => void startRound('jack')}>Dar cartas</button></>)}
      </>
    );
  } else if (tab === 'piplup') {
    const r = round?.game === 'piplup' ? round : null;
    const jumps = r?.jumps ?? (last?.detail.game === 'piplup' ? last.detail.jumps : 0);
    panel = (
      <>
        <div className="gb-pads" aria-label="Pedras">
          {Array.from({ length: 7 }, (_, i) => <span key={i} className={`gb-pad${i < jumps ? ' is-done' : ''}`}>{i + 1}</span>)}
        </div>
        <Sprite speciesId={393} alt="Piplup" size={64} />
        {r ? (
          <div className="gb-row" style={{ alignItems: 'center' }}>
            <span>Agora: {MULT(r.multiplier)} · próximo salto: {r.nextOdds}% de acertar, vale {MULT(r.nextMultiplier)}</span>
            <button type="button" className="gb-button" disabled={busy} onClick={() => void act('jump')}>Saltar</button>
            <button type="button" className="gb-button" disabled={busy || r.jumps === 0} onClick={() => void act('cashout')}>Sacar</button>
          </div>
        ) : (<>{stakeBox}<button type="button" className="gb-button" disabled={busy} onClick={() => void startRound('piplup')}>Começar</button></>)}
      </>
    );
  }

  return (
    <main className="gb-screen">
      <div className="gb-stage">
        <header className="gb-window gb-spread" style={{ alignItems: 'center', padding: '10px 20px' }}>
          <h1 className="gb-title" style={{ fontSize: 26 }}>Pokécassino</h1>
          <span style={{ fontSize: 22 }}>🪙 {state.chips.toLocaleString('pt-BR')} · {formatMoney(state.money)}</span>
        </header>
        <section className="gb-window" aria-label="Jogos">
          <div className="gb-tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={t.id === tab} className="gb-tab" disabled={locked && t.id !== tab} onClick={() => { setTab(t.id); setShown(null); setLast(null); }}>{t.label}</button>
            ))}
          </div>
          {isGame ? <p className="gb-muted" style={{ margin: '0 0 8px' }}>{GAME_HELP[game]}</p> : null}
          <div className="gb-casino-panel">{panel}</div>
          {locked ? (
            <button type="button" className="gb-button gb-button--red" style={{ marginTop: 8 }} disabled={busy} onClick={() => {
              setBusy(true);
              api.casinoAbandon(saveId).then(afterAbandon, (e: Error) => setMessage(e.message)).finally(() => setBusy(false));
              function afterAbandon(res: CasinoActResult) { afterAct(res); }
            }}>Abandonar rodada (perde a aposta)</button>
          ) : null}
        </section>
        <div className="gb-window gb-dialog"><p style={{ margin: 0 }} aria-live="polite">{message}</p></div>
        <button type="button" className="gb-button" disabled={locked || busy} onClick={onBack}>Voltar</button>
        <KeyHints hints={[['X', 'voltar']]} />
      </div>
    </main>
  );
}

const isRed = (n: number) => [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36].includes(n);

function CardView({ rank, suit, hidden = false }: { rank?: string; suit?: string; hidden?: boolean }) {
  if (hidden) return <span className="gb-card gb-card--back">?</span>;
  return <span className={`gb-card${suit === '♥' || suit === '♦' ? ' is-red' : ''}`}>{rank}{suit}</span>;
}

function PokemonPicker({ saveId, chosen, onChoose, disabled }: { saveId: string; chosen: PokemonView | null; onChoose: (mon: PokemonView) => void; disabled: boolean }) {
  const [text, setText] = useState('');
  const [items, setItems] = useState<PokemonView[]>([]);
  useEffect(() => {
    const id = window.setTimeout(() => { api.search(saveId, { text, limit: 8, sort: 'level', dir: 'asc' }).then((r) => setItems(r.items.filter((m) => !m.favorite)), () => undefined); }, 200);
    return () => window.clearTimeout(id);
  }, [saveId, text]);
  return (
    <div className="gb-pick">
      <p style={{ margin: 0 }}>{chosen ? `Aposta: ${chosen.name} (Nv ${chosen.level}). Se perder, ele vai embora!` : 'Escolha o Pokémon (favoritos ficam de fora).'}</p>
      <input className="gb-input" placeholder="Buscar por nome" value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} />
      <div className="gb-teampick">
        {items.map((m) => (
          <button key={m.id} type="button" disabled={disabled} className={`gb-teampick__mon${chosen?.id === m.id ? ' is-on' : ''}`} aria-pressed={chosen?.id === m.id} onClick={() => onChoose(m)}>
            <Sprite speciesId={m.speciesId} shiny={m.shiny} alt={m.name} size={48} /><span>{m.name}</span><span className="gb-muted">Nv {m.level}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
