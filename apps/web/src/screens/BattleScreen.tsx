import { useEffect, useMemo, useRef, useState } from 'react';
import {
  STAGE_LABELS, STATUS_LABELS, TYPE_LABELS,
  type BattleActRequest, type BattleEvent, type BattleMonView, type BattleOutcome, type BattleTurnResult, type BattleView, type SideKey,
  type StageKey, type StatusKind, type TypeName,
} from '@pokesim/engine';
import { api } from '../api.ts';
import { Menu, type MenuItem } from '../ui/Menu.tsx';
import { BallIcon, HpBar, ItemIcon, KeyHints, Sprite, Stars, TypeBadge, XpBar } from '../ui/bits.tsx';
import { useKeys } from '../ui/useKeys.ts';
import { keyLabel, useSettings, type BindAction } from '../settings.ts';
import { playSound } from '../sound.ts';
import { BattleFx, fxKindOf } from '../ui/BattleFx.tsx';

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const STATUS_SHORT: Record<StatusKind, string> = { burn: 'QUE', poison: 'ENV', paralysis: 'PAR', sleep: 'SONO', freeze: 'GEL', confusion: 'CONF' };
const STAGE_SHORT: Record<StageKey, string> = { atk: 'ATQ', def: 'DEF', spa: 'A.ESP', spd: 'D.ESP', spe: 'VEL', acc: 'PREC', eva: 'ESQ' };
const percent = (chance: number | null) => (chance === null ? '' : chance >= 1 ? '100%' : chance < 0.01 ? '<1%' : `${Math.round(chance * 100)}%`);

type Mode = 'playing' | 'command' | 'fight' | 'bag' | 'balls' | 'heals' | 'target' | 'team' | 'ended';

interface Model {
  player: BattleMonView[];
  foe: BattleMonView[];
  active: Record<SideKey, number>;
}

interface Props {
  saveId: string;
  /** resultado de iniciar a batalha (com eventos) ou só o estado ao retomar */
  start: BattleTurnResult;
  habitat: string;
  onExit: (outcome: BattleOutcome | null) => void;
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function BattleScreen({ saveId, start, habitat, onExit }: Props) {
  const [view, setView] = useState<BattleView>(start.view);
  const [mons, setMons] = useState<Record<SideKey, BattleMonView | null>>({ player: null, foe: null });
  const [anims, setAnims] = useState<Record<SideKey, string>>({ player: '', foe: '' });
  const [text, setText] = useState('');
  const [mode, setMode] = useState<Mode>('playing');
  const [fx, setFx] = useState<{ id: number; type: TypeName; side: SideKey; category: string } | null>(null);
  const [popup, setPopup] = useState<{ id: number; side: SideKey; text: string; kind: 'up' | 'down' | 'heal' | 'level' } | null>(null);
  const [ball, setBall] = useState<{ item: string; stage: 'fly' | 'shake' | 'caught' | 'open'; n: number } | null>(null);
  const [shake, setShake] = useState('');
  const [hover, setHover] = useState<string>('');
  const [healItem, setHealItem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<BattleOutcome | null>(null);
  const [xpShown, setXpShown] = useState(0);

  const model = useRef<Model>({ player: [], foe: [], active: { player: 0, foe: 0 } });
  const alive = useRef(true);
  const skip = useRef<(() => void) | null>(null);
  const counter = useRef(0);
  const playing = useRef(false);
  const calm = useRef(reducedMotion());

  const wait = (ms: number) => new Promise<void>((resolve) => {
    const finish = () => { window.clearTimeout(timer); skip.current = null; resolve(); };
    const timer = window.setTimeout(finish, calm.current ? Math.min(ms, 120) : ms);
    skip.current = finish;
  });
  const showSide = (side: SideKey) => {
    const current = model.current[side][model.current.active[side]];
    setMons((m) => ({ ...m, [side]: current ? clone(current) : null }));
  };
  const animate = async (side: SideKey, name: string, ms: number) => {
    if (calm.current) return;
    setAnims((a) => ({ ...a, [side]: name }));
    await wait(ms);
    if (alive.current) setAnims((a) => ({ ...a, [side]: '' }));
  };
  const say = async (line: string, minimum = 0) => {
    if (!line) { if (minimum) await wait(minimum); return; }
    setText(line);
    await wait(Math.max(minimum, 350 + line.length * 22));
  };
  const pop = (side: SideKey, label: string, kind: 'up' | 'down' | 'heal' | 'level') => {
    counter.current += 1;
    setPopup({ id: counter.current, side, text: label, kind });
  };

  const playEvent = async (e: BattleEvent) => {
    const m = model.current;
    const mon = (side: SideKey) => m[side][m.active[side]] as BattleMonView;
    switch (e.k) {
      case 'send': {
        m.active[e.side] = e.index;
        showSide(e.side);
        const sliding = animate(e.side, e.side === 'foe' ? 'gb-in-right' : 'gb-in-left', 600);
        await Promise.all([say(e.text), sliding]);
        break;
      }
      case 'move': {
        counter.current += 1;
        const target: SideKey = e.side === 'player' ? 'foe' : 'player';
        const lunge = e.category === 'status' ? Promise.resolve() : animate(e.side, e.side === 'player' ? 'gb-lunge-player' : 'gb-lunge-foe', 380);
        const effectId = counter.current;
        window.setTimeout(() => { if (alive.current && !calm.current) setFx({ id: effectId, type: e.type, side: e.category === 'status' ? e.side : target, category: e.category }); }, 220);
        await Promise.all([say(e.text, 800), lunge, wait(fxKindOf(e.type, e.category).ms)]);
        if (alive.current) setFx(null);
        break;
      }
      case 'miss': {
        playSound('miss');
        await Promise.all([say(e.text), animate(e.side, 'gb-dodge', 450)]);
        break;
      }
      case 'hit': {
        const target = mon(e.side);
        target.hp = e.hp;
        showSide(e.side);
        playSound(e.cause !== 'move' ? 'hit' : e.effectiveness > 1 ? 'super' : e.effectiveness < 1 ? 'weak' : 'hit');
        if (e.crit || e.effectiveness > 1) setShake(e.effectiveness > 1 ? 'gb-shake-big' : 'gb-shake');
        await Promise.all([animate(e.side, 'gb-blink', 560), wait(650)]);
        setShake('');
        if (e.text) await say(e.text, 500);
        break;
      }
      case 'heal': {
        mon(e.side).hp = e.hp;
        showSide(e.side);
        playSound('heal');
        pop(e.side, `+${e.amount}`, 'heal');
        await Promise.all([say(e.text), wait(600)]);
        break;
      }
      case 'status': {
        const target = mon(e.side);
        if (e.status === 'confusion') target.confused = true; else target.status = e.status;
        showSide(e.side);
        playSound('error');
        await Promise.all([say(e.text), animate(e.side, `gb-flash-${e.status}`, 700)]);
        break;
      }
      case 'status-end': {
        const target = mon(e.side);
        if (e.status === 'confusion') target.confused = false; else target.status = null;
        showSide(e.side);
        await say(e.text);
        break;
      }
      case 'stage': {
        const target = mon(e.side);
        const stages = { ...target.stages };
        if (e.value === 0) delete stages[e.stat]; else stages[e.stat] = e.value;
        target.stages = stages;
        showSide(e.side);
        playSound(e.change > 0 ? 'heal' : 'weak');
        pop(e.side, `${e.change > 0 ? '▲' : '▼'} ${STAGE_LABELS[e.stat]}`, e.change > 0 ? 'up' : 'down');
        await Promise.all([say(e.text), wait(700)]);
        break;
      }
      case 'faint': {
        mon(e.side).hp = 0;
        showSide(e.side);
        playSound('faint');
        await Promise.all([say(e.text), animate(e.side, 'gb-faint', 800)]);
        setMons((s) => ({ ...s, [e.side]: null }));
        break;
      }
      case 'xp': {
        const target = m.player[e.index] as BattleMonView;
        setXpShown(e.amount);
        target.expProgress = e.progress;
        if (m.active.player === e.index) showSide('player');
        await say(e.text, 700);
        break;
      }
      case 'level': {
        const target = m.player[e.index] as BattleMonView;
        target.level = e.level; target.hp = e.hp; target.maxHp = e.maxHp; target.expProgress = e.progress;
        if (m.active.player === e.index) showSide('player');
        playSound('levelup');
        pop('player', `Nv ${e.level}!`, 'level');
        await Promise.all([say(e.text, 900), animate('player', 'gb-levelup', 900)]);
        break;
      }
      case 'learn': {
        playSound('save');
        await say(e.text, 800);
        break;
      }
      case 'ball': {
        const [first, ...afterwards] = e.text.split('! ');
        setBall({ item: e.ball, stage: 'fly', n: 0 });
        await Promise.all([say(afterwards.length > 0 ? `${first}!` : e.text), wait(800)]);
        setAnims((a) => ({ ...a, foe: 'gb-absorb' }));
        await wait(400);
        for (let i = 1; i <= e.shakes; i++) {
          setBall({ item: e.ball, stage: 'shake', n: i });
          playSound('move');
          await wait(800);
        }
        if (e.caught) {
          setBall({ item: e.ball, stage: 'caught', n: e.shakes });
          playSound('save');
          setMons((s) => ({ ...s, foe: null }));
        } else {
          setBall({ item: e.ball, stage: 'open', n: e.shakes });
          playSound('back');
          setAnims((a) => ({ ...a, foe: 'gb-in-right' }));
          await wait(500);
        }
        if (afterwards.length > 0) await say(afterwards.join('! '), 700);
        if (!e.caught) { setBall(null); setAnims((a) => ({ ...a, foe: '' })); }
        break;
      }
      case 'run': {
        if (e.ok) { playSound('back'); await Promise.all([say(e.text), animate('player', 'gb-run', 600)]); setMons((s) => ({ ...s, player: null })); }
        else { playSound('error'); await say(e.text); }
        break;
      }
      case 'money': {
        playSound('save');
        await say(e.text, 800);
        break;
      }
      case 'end': {
        if (e.text) await say(e.text, 800);
        break;
      }
      case 'text': {
        await say(e.text);
        break;
      }
    }
  };

  /** Toca os eventos em ordem e, no fim, entrega o menu certo para o estado atual. */
  const play = async (events: BattleEvent[], next: BattleView) => {
    playing.current = true;
    setMode('playing');
    setOutcome(null);
    for (const e of events) {
      if (!alive.current) return;
      await playEvent(e);
    }
    if (!alive.current) return;
    playing.current = false;
    setView(next);
    model.current = { player: clone(next.player.team), foe: clone(next.foe.team), active: { player: next.player.active, foe: next.foe.active } };
    if (next.phase === 'ended') {
      setOutcome(next.outcome);
      setMode('ended');
      if (next.outcome?.result === 'captured') {
        setMons((s) => ({ ...s, foe: null }));
      }
      return;
    }
    if (next.player.team[next.player.active]?.hp === 0 || next.phase === 'replace') {
      setText('Escolha o próximo Pokémon.');
      setMode('team');
    } else {
      setText(`O que ${next.player.team[next.player.active]?.name ?? ''} vai fazer?`);
      setMode('command');
    }
    setMons({
      player: next.player.team[next.player.active] ? clone(next.player.team[next.player.active] as BattleMonView) : null,
      foe: next.foe.team[next.foe.active] && next.foe.team[next.foe.active]!.hp > 0 ? clone(next.foe.team[next.foe.active] as BattleMonView) : null,
    });
  };

  // início / retomada
  useEffect(() => {
    alive.current = true;
    const first = start.view;
    // o modelo começa com o estado ANTES dos eventos: para a batalha nova, é o mesmo estado (HP cheio)
    model.current = { player: clone(first.player.team), foe: clone(first.foe.team), active: { player: first.player.active, foe: first.foe.active } };
    if (start.events.length === 0) {
      setMons({
        player: clone(first.player.team[first.player.active] as BattleMonView),
        foe: clone(first.foe.team[first.foe.active] as BattleMonView),
      });
      setText(`O que ${first.player.team[first.player.active]?.name ?? ''} vai fazer?`);
      setMode('command');
    } else void play(start.events, start.view);
    return () => { alive.current = false; skip.current?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = async (action: BattleActRequest) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // o estado antes dos eventos é o atual; o servidor devolve o que aconteceu
      model.current = { player: clone(view.player.team), foe: clone(view.foe.team), active: { player: view.player.active, foe: view.foe.active } };
      const result = await api.battleAct(saveId, action);
      setBusy(false);
      setHealItem(null);
      await play(result.events, result.view);
    } catch (e) {
      setBusy(false);
      setError((e as Error).message);
      playSound('error');
      setMode('command');
    }
  };

  // Z durante a animação adianta o texto
  useKeys((key) => {
    if (key === 'confirm') skip.current?.();
  }, mode === 'playing');

  useKeys((key) => {
    if (key === 'confirm' || key === 'back') { playSound('confirm'); onExit(outcome); }
  }, mode === 'ended');

  // atalhos de golpe (1–4 por padrão; dá para trocar em Opções → Controles)
  const settings = useSettings();
  useKeys((key) => {
    const slot = ['move1', 'move2', 'move3', 'move4'].indexOf(key);
    if (slot < 0 || !view.player.moves[slot]) return;
    void act({ kind: 'move', slot });
  }, (mode === 'command' || mode === 'fight') && !busy && view.phase === 'choose');

  const commandItems: MenuItem[] = [
    { id: 'fight', label: 'LUTAR' },
    { id: 'bag', label: 'BOLSA' },
    { id: 'team', label: 'POKÉMON' },
    { id: 'run', label: 'FUGIR', disabled: Boolean(view.trainer) },
  ];

  const moveItems: MenuItem[] = view.player.moves.map((move) => ({
    id: String(move.slot),
    label: <span className="gb-mv"><span className="gb-muted">{keyLabel(settings.keys[`move${move.slot + 1}` as BindAction]?.[0] ?? String(move.slot + 1))}</span><span className={`gb-dot gb-dot--${move.type}`} />{move.displayName}</span>,
  }));
  const hoveredMove = view.player.moves.find((move) => String(move.slot) === hover);

  const teamItems: MenuItem[] = view.player.team.map((mon) => ({
    id: String(mon.index),
    label: <span className="gb-teamrow"><Sprite speciesId={mon.spriteId} shiny={mon.shiny} alt="" size={32} /> {mon.name} <span className="gb-muted">Nv{mon.level}</span></span>,
    extra: mon.hp === 0 ? 'DESMAIADO' : `${mon.hp}/${mon.maxHp}${mon.status ? ` · ${STATUS_SHORT[mon.status]}` : ''}`,
    disabled: mode === 'target' ? false : view.phase === 'replace' ? mon.hp === 0 : mon.index === view.player.active || mon.hp === 0,
  }));

  const bagItems: MenuItem[] = [
    { id: 'balls', label: 'BOLAS', extra: view.trainer ? '—' : String(view.balls.reduce((n, b) => n + b.quantity, 0)), disabled: Boolean(view.trainer) },
    { id: 'heals', label: 'CURA', extra: String(view.heals.reduce((n, b) => n + b.quantity, 0)) },
    { id: 'back', label: 'Voltar' },
  ];

  const habitatClass = useMemo(() => `gb-battle--${habitat || 'forest'}`, [habitat]);
  const foe = mons.foe;
  const player = mons.player;

  return (
    <main className="gb-screen">
      <div className="gb-stage">
        <section className={`gb-battle ${habitatClass} ${shake}`} aria-label="Batalha">
          <div className="gb-battle__ground gb-battle__ground--foe" />
          <div className="gb-battle__ground gb-battle__ground--player" />

          {foe ? <InfoBox side="foe" mon={foe} /> : null}
          {player ? <InfoBox side="player" mon={player} xpGain={xpShown} /> : null}

          <div className="gb-battle__sprite gb-battle__sprite--foe">
            {foe ? <div className={`gb-sprite-anim ${anims.foe}`}><Sprite speciesId={foe.spriteId} shiny={foe.shiny} alt={foe.name} size={176} className={anims.foe ? '' : 'gb-bob'} /></div> : null}
            {ball ? <BallIcon item={ball.item} className={`gb-battle-ball gb-battle-ball--${ball.stage}${ball.stage === 'shake' ? ` gb-battle-ball--n${ball.n % 2}` : ''}`} /> : null}
            {popup && popup.side === 'foe' ? <Popup key={popup.id} {...popup} /> : null}
          </div>
          <div className="gb-battle__sprite gb-battle__sprite--player">
            {player ? <div className={`gb-sprite-anim ${anims.player}`}><BackSprite speciesId={player.spriteId} shiny={player.shiny} name={player.name} /></div> : null}
            {popup && popup.side === 'player' ? <Popup key={popup.id} {...popup} /> : null}
          </div>
          {fx ? <BattleFx key={fx.id} type={fx.type} target={fx.side} category={fx.category} /> : null}
        </section>

        <div className="gb-battle-ui">
          <div className="gb-window gb-window--accent gb-dialog" role="status" aria-live="polite">
            {error ? <p style={{ margin: 0, color: 'var(--red)' }}>{error}</p> : null}
            <TypeText text={text} instant={mode !== 'playing'} />
            {mode === 'fight' && hoveredMove ? (
              <p className="gb-muted" style={{ margin: '6px 0 0', fontSize: 20 }}>
                <TypeBadge type={hoveredMove.type} /> {hoveredMove.category === 'status' ? 'Status' : `Poder ${hoveredMove.power}`}
                {hoveredMove.accuracy ? ` · Precisão ${hoveredMove.accuracy}` : ' · Não erra'}
                {hoveredMove.effectiveness !== null ? (hoveredMove.effectiveness === 0 ? ' · Sem efeito' : hoveredMove.effectiveness > 1 ? ' · Super efetivo!' : hoveredMove.effectiveness < 1 ? ' · Pouco efetivo' : '') : ''}
              </p>
            ) : null}
          </div>

          <div className="gb-window gb-battle-menu" aria-label="Ações">
            {mode === 'playing' ? <p className="gb-muted" style={{ margin: 0 }}>Z adianta o texto…</p> : null}
            {mode === 'command' ? (
              <Menu
                label="Comandos" columns={2} items={commandItems} active={!busy}
                onSelect={(id) => {
                  if (id === 'fight') setMode('fight');
                  else if (id === 'bag') setMode('bag');
                  else if (id === 'team') { setHealItem(null); setMode('team'); }
                  else void act({ kind: 'run' });
                }}
              />
            ) : null}
            {mode === 'fight' ? (
              <Menu
                label="Golpes" columns={2} items={moveItems} active={!busy} onMove={setHover}
                onSelect={(id) => void act({ kind: 'move', slot: Number(id) })}
                onBack={() => setMode('command')}
              />
            ) : null}
            {mode === 'bag' ? (
              <Menu label="Bolsa" items={bagItems} active={!busy} onSelect={(id) => setMode(id === 'back' ? 'command' : (id as Mode))} onBack={() => setMode('command')} />
            ) : null}
            {mode === 'balls' ? (
              <Menu
                label="Bolas" active={!busy}
                items={[
                  ...view.balls.map((b): MenuItem => ({
                    id: b.item,
                    label: <span className="gb-ballrow"><BallIcon item={b.item} small /><span>{b.displayName}</span><span className="gb-ballrow__chance">×{b.quantity} · {percent(b.chance)}</span></span>,
                  })),
                  { id: '__back', label: 'Voltar' },
                ]}
                onSelect={(id) => (id === '__back' ? setMode('bag') : void act({ kind: 'ball', item: id }))}
                onBack={() => setMode('bag')}
              />
            ) : null}
            {mode === 'heals' ? (
              <Menu
                label="Cura" active={!busy}
                items={[
                  ...view.heals.map((h): MenuItem => ({ id: h.item, label: <span className="gb-iconrow"><ItemIcon item={h.item} size={24} />{h.displayName}</span>, extra: `×${h.quantity}` })),
                  { id: '__back', label: 'Voltar' },
                ]}
                onSelect={(id) => { if (id === '__back') setMode('bag'); else { setHealItem(id); setText('Usar em qual Pokémon?'); setMode('target'); } }}
                onBack={() => setMode('bag')}
              />
            ) : null}
            {mode === 'target' || mode === 'team' ? (
              <Menu
                label="Equipe" active={!busy} items={teamItems}
                onSelect={(id) => {
                  if (mode === 'target' && healItem) void act({ kind: 'item', item: healItem, target: Number(id) });
                  else void act({ kind: 'switch', to: Number(id) });
                }}
                onBack={view.phase === 'replace' ? undefined : () => { setHealItem(null); setMode(mode === 'target' ? 'heals' : 'command'); }}
              />
            ) : null}
            {mode === 'ended' && outcome ? <OutcomePanel outcome={outcome} /> : null}
          </div>
        </div>
        <KeyHints hints={mode === 'ended' ? [['Z', 'continuar']] : mode === 'playing' ? [['Z', 'adiantar texto']] : [['↑↓←→', 'escolher'], ['Z', 'confirmar'], ['X', 'voltar'], ...(mode === 'command' || mode === 'fight' ? [[`${keyLabel(settings.keys.move1[0] ?? '1')}–${keyLabel(settings.keys.move4[0] ?? '4')}`, 'golpe direto'] as [string, string]] : [])]} />
      </div>
    </main>
  );
}

function BackSprite({ speciesId, shiny, name }: { speciesId: number; shiny: boolean; name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Sprite speciesId={speciesId} shiny={shiny} alt={name} size={200} className="gb-bob gb-flip" />;
  return <Sprite speciesId={speciesId} view="back" shiny={shiny} alt={name} size={200} className="gb-bob" onFail={() => setFailed(true)} />;
}

function Popup({ text, kind }: { text: string; kind: 'up' | 'down' | 'heal' | 'level' }) {
  return <span className={`gb-popup gb-popup--${kind}`}>{text}</span>;
}

/** Texto que "digita" letra por letra, como nos jogos de GBA. */
function TypeText({ text, instant }: { text: string; instant: boolean }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (instant || reducedMotion()) { setShown(text.length); return; }
    setShown(0);
    const timer = window.setInterval(() => setShown((n) => { if (n >= text.length) { window.clearInterval(timer); return n; } return n + 1; }), 18);
    return () => window.clearInterval(timer);
  }, [text, instant]);
  return <p className="gb-typed" style={{ margin: 0, minHeight: 56 }}>{text.slice(0, shown)}<span className="gb-caret" aria-hidden="true">{shown >= text.length ? '▼' : ''}</span></p>;
}

function InfoBox({ side, mon, xpGain }: { side: SideKey; mon: BattleMonView; xpGain?: number }) {
  const [tween, setTween] = useState(mon.hp);
  useEffect(() => {
    if (tween === mon.hp) return;
    const step = Math.max(1, Math.ceil(Math.abs(mon.hp - tween) / 12));
    const timer = window.setInterval(() => setTween((value) => {
      const next = value < mon.hp ? Math.min(mon.hp, value + step) : Math.max(mon.hp, value - step);
      if (next === mon.hp) window.clearInterval(timer);
      return next;
    }), 45);
    return () => window.clearInterval(timer);
  }, [mon.hp, tween]);
  const stages = Object.entries(mon.stages) as [StageKey, number][];
  return (
    <div className={`gb-binfo gb-binfo--${side}`}>
      <div className="gb-spread">
        <span className="gb-label" style={{ textTransform: 'uppercase' }}>{mon.shiny ? '✦ ' : ''}{mon.name}</span>
        <span>Nv{mon.level}</span>
      </div>
      <div className="gb-binfo__tags">
        {mon.status ? <span className={`gb-status gb-status--${mon.status}`} title={STATUS_LABELS[mon.status]}>{STATUS_SHORT[mon.status]}</span> : null}
        {mon.confused ? <span className="gb-status gb-status--confusion" title="confusão">CONF</span> : null}
        {stages.map(([key, value]) => <span key={key} className={`gb-stage-tag ${value > 0 ? 'gb-stage-tag--up' : 'gb-stage-tag--down'}`}>{STAGE_SHORT[key]}{value > 0 ? `+${value}` : value}</span>)}
      </div>
      <HpBar current={mon.hp} max={mon.maxHp} />
      {side === 'player' ? (
        <>
          <div className="gb-spread" style={{ fontSize: 20 }}><span className="gb-muted">{xpGain ? `+${xpGain} XP` : ''}</span><span>{tween}/{mon.maxHp}</span></div>
          <XpBar progress={mon.expProgress} />
        </>
      ) : null}
    </div>
  );
}

function OutcomePanel({ outcome }: { outcome: BattleOutcome }) {
  return (
    <div className="gb-outcome">
      {outcome.trainerName ? <p className="gb-muted" style={{ margin: 0 }}>{outcome.result === 'win' ? 'Você derrotou' : 'Você perdeu para'} {outcome.trainerName}</p> : null}
      <h2 className="gb-title" style={{ fontSize: 22, margin: 0 }}>
        {outcome.result === 'win' ? 'Vitória!' : outcome.result === 'captured' ? 'Capturado!' : outcome.result === 'fled' ? 'Você fugiu' : 'Derrota'}
      </h2>
      {outcome.caught ? (
        <div className="gb-spread" style={{ alignItems: 'center', gap: 12 }}>
          <Sprite speciesId={outcome.caught.speciesId} shiny={outcome.caught.shiny} alt={outcome.caught.name} size={72} />
          <span>
            {outcome.caught.shiny ? '✦ ' : ''}{outcome.caught.name} Nv{outcome.caught.level} <Stars count={outcome.caught.ivStars} />
            <br />
            <span className="gb-muted">{outcome.caught.location.kind === 'team' ? 'Foi para a equipe.' : `Foi para a caixa ${outcome.caught.location.box + 1} do PC.`}</span>
          </span>
        </div>
      ) : null}
      {outcome.badge ? <p style={{ margin: 0, color: 'var(--red)' }}>★ Conquista registrada: {outcome.badge}</p> : null}
      {outcome.rewards.map((r) => <p key={r.item} style={{ margin: 0 }}>Recebeu {r.quantity}× {r.name}</p>)}
      {outcome.money > 0 ? <p style={{ margin: 0 }}>Ganhou ₽ {outcome.money.toLocaleString('pt-BR')}</p> : null}
      {outcome.levels.map((entry) => <p key={entry.name} style={{ margin: 0 }}>▲ {entry.name} está no nível {entry.level}</p>)}
      {outcome.pending.length > 0 ? <p style={{ margin: 0, color: 'var(--red)' }}>Golpes novos esperando: {outcome.pending.join(', ')} (veja no perfil)</p> : null}
      <p className="gb-muted" style={{ margin: 0 }}>Sua equipe foi curada. Z continua.</p>
    </div>
  );
}
