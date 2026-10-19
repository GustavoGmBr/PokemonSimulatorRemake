import { useEffect, useRef, useState } from 'react';
import {
  STAGE_LABELS, STATUS_LABELS,
  type BattleMonView, type BattleOutcome, type DoublesActRequest, type DoublesMoveView, type DoublesTurnResult, type DoublesView,
  type DuelEvent, type Pos, type SideKey, type TypeName,
} from '@pokesim/engine';
import { api } from '../api.ts';
import { Menu, type MenuItem } from '../ui/Menu.tsx';
import { HpBar, KeyHints, Sprite, TypeBadge } from '../ui/bits.tsx';
import { useKeys } from '../ui/useKeys.ts';
import { playSound } from '../sound.ts';
import { BattleFx, fxKindOf } from '../ui/BattleFx.tsx';
import { useMusic } from '../music.ts';
import { BackSprite, OutcomePanel, Popup, STAGE_SHORT, STATUS_SHORT, TypeText, auraOf } from './BattleScreen.tsx';

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const POS: Pos[] = [0, 1];
const SIDE_NAME = ['esquerda', 'direita'];

type Mode = 'playing' | 'choose' | 'target' | 'switch' | 'replace' | 'ended';
type Pick = { kind: 'move'; slot: number; target?: { side: 'foe'; pos: Pos } } | { kind: 'switch'; to: number } | null;
type Slots = Record<SideKey, [BattleMonView | null, BattleMonView | null]>;
type Popup2 = { id: number; side: SideKey; pos: Pos; text: string; kind: 'up' | 'down' | 'heal' | 'level' | 'dmg' | 'crit' };

interface Model { player: BattleMonView[]; foe: BattleMonView[]; active: Record<SideKey, [number, number]> }

interface Props {
  saveId: string;
  start: DoublesTurnResult;
  habitat?: string;
  onExit: (outcome: BattleOutcome | null) => void;
}

const emptySlots = (): Slots => ({ player: [null, null], foe: [null, null] });

/** Batalha em dupla: dois Pokémon de cada lado, cada um com o seu golpe e o seu alvo. */
export function DoublesBattleScreen({ saveId, start, habitat = 'forest', onExit }: Props) {
  const [view, setView] = useState<DoublesView>(start.view);
  useMusic('gym');
  const [slots, setSlots] = useState<Slots>(emptySlots);
  const [anims, setAnims] = useState<Record<string, string>>({});
  const [text, setText] = useState('');
  const [mode, setMode] = useState<Mode>('playing');
  const [fx, setFx] = useState<{ id: number; type: TypeName; side: SideKey; category: string } | null>(null);
  const [popup, setPopup] = useState<Popup2 | null>(null);
  const [shake, setShake] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<BattleOutcome | null>(null);
  const [hover, setHover] = useState('');
  // escolha em andamento
  const [step, setStep] = useState<Pos>(0);
  const [picks, setPicks] = useState<Pick[]>([null, null]);
  const [pendingMove, setPendingMove] = useState<DoublesMoveView | null>(null);
  const [replaced, setReplaced] = useState<{ pos: Pos; to: number }[]>([]);

  const model = useRef<Model>({ player: [], foe: [], active: { player: [-1, -1], foe: [-1, -1] } });
  const alive = useRef(true);
  const skip = useRef<(() => void) | null>(null);
  const counter = useRef(0);
  const calm = useRef(reducedMotion());

  const wait = (ms: number) => new Promise<void>((resolve) => {
    const finish = () => { window.clearTimeout(timer); skip.current = null; resolve(); };
    const timer = window.setTimeout(finish, calm.current ? Math.min(ms, 120) : ms);
    skip.current = finish;
  });
  const key = (side: SideKey, pos: Pos) => `${side}${pos}`;
  const showSlot = (side: SideKey, pos: Pos) => {
    const m = model.current;
    const index = m.active[side][pos];
    const mon = index >= 0 ? m[side][index] : undefined;
    setSlots((s) => { const next = { ...s, [side]: [...s[side]] as Slots[SideKey] }; next[side][pos] = mon ? clone(mon) : null; return next; });
  };
  const hideSlot = (side: SideKey, pos: Pos) => setSlots((s) => { const next = { ...s, [side]: [...s[side]] as Slots[SideKey] }; next[side][pos] = null; return next; });
  const animate = async (side: SideKey, pos: Pos, name: string, ms: number) => {
    if (calm.current) return;
    setAnims((a) => ({ ...a, [key(side, pos)]: name }));
    await wait(ms);
    if (alive.current) setAnims((a) => ({ ...a, [key(side, pos)]: '' }));
  };
  const say = async (line: string, minimum = 0) => {
    if (!line) { if (minimum) await wait(minimum); return; }
    setText(line);
    await wait(Math.max(minimum, 350 + line.length * 22));
  };
  const pop = (side: SideKey, pos: Pos, label: string, kind: Popup2['kind']) => {
    counter.current += 1;
    setPopup({ id: counter.current, side, pos, text: label, kind });
  };
  const monAt = (side: SideKey, pos: Pos): BattleMonView | undefined => {
    const m = model.current;
    const index = m.active[side][pos];
    return index >= 0 ? m[side][index] : undefined;
  };

  const playEvent = async (e: DuelEvent) => {
    const m = model.current;
    const pos = (e as { pos?: Pos }).pos ?? 0;
    switch (e.k) {
      case 'send': {
        m.active[e.side][pos] = e.index;
        showSlot(e.side, pos);
        await Promise.all([say(e.text), animate(e.side, pos, e.side === 'foe' ? 'gb-in-right' : 'gb-in-left', 600)]);
        break;
      }
      case 'move': {
        counter.current += 1;
        const target: SideKey = e.side === 'player' ? 'foe' : 'player';
        const lunge = e.category === 'status' ? Promise.resolve() : animate(e.side, pos, e.side === 'player' ? 'gb-lunge-player' : 'gb-lunge-foe', 380);
        const effectId = counter.current;
        window.setTimeout(() => { if (alive.current && !calm.current) setFx({ id: effectId, type: e.type, side: e.category === 'status' ? e.side : target, category: e.category }); }, 220);
        await Promise.all([say(e.text, 800), lunge, wait(fxKindOf(e.type, e.category).ms)]);
        if (alive.current) setFx(null);
        break;
      }
      case 'miss': {
        playSound('miss');
        await Promise.all([say(e.text), animate(e.side, pos, 'gb-dodge', 450)]);
        break;
      }
      case 'hit': {
        const target = monAt(e.side, pos);
        if (target) target.hp = e.hp;
        showSlot(e.side, pos);
        playSound(e.cause !== 'move' ? 'hit' : e.effectiveness > 1 ? 'super' : e.effectiveness < 1 ? 'weak' : 'hit');
        if (e.damage > 0) pop(e.side, pos, e.crit ? `CRÍTICO! -${e.damage}` : `-${e.damage}`, e.crit ? 'crit' : 'dmg');
        if (e.crit || e.effectiveness > 1) setShake(e.effectiveness > 1 ? 'gb-shake-big' : 'gb-shake');
        await Promise.all([animate(e.side, pos, 'gb-blink', 560), wait(650)]);
        setShake('');
        if (e.text) await say(e.text, 500);
        break;
      }
      case 'heal': {
        const target = monAt(e.side, pos);
        if (target) target.hp = e.hp;
        showSlot(e.side, pos);
        playSound('heal');
        pop(e.side, pos, `+${e.amount}`, 'heal');
        await Promise.all([say(e.text), wait(600)]);
        break;
      }
      case 'status': {
        const target = monAt(e.side, pos);
        if (target) { if (e.status === 'confusion') target.confused = true; else target.status = e.status; }
        showSlot(e.side, pos);
        playSound('error');
        await Promise.all([say(e.text), animate(e.side, pos, `gb-flash-${e.status}`, 700)]);
        break;
      }
      case 'status-end': {
        const target = monAt(e.side, pos);
        if (target) { if (e.status === 'confusion') target.confused = false; else target.status = null; }
        showSlot(e.side, pos);
        await say(e.text);
        break;
      }
      case 'stage': {
        const target = monAt(e.side, pos);
        if (target) {
          const stages = { ...target.stages };
          if (e.value === 0) delete stages[e.stat]; else stages[e.stat] = e.value;
          target.stages = stages;
        }
        showSlot(e.side, pos);
        playSound(e.change > 0 ? 'heal' : 'weak');
        pop(e.side, pos, `${e.change > 0 ? '▲' : '▼'} ${STAGE_LABELS[e.stat]}`, e.change > 0 ? 'up' : 'down');
        await Promise.all([say(e.text), wait(700)]);
        break;
      }
      case 'faint': {
        const target = monAt(e.side, pos);
        if (target) target.hp = 0;
        showSlot(e.side, pos);
        playSound('faint');
        await Promise.all([say(e.text), animate(e.side, pos, 'gb-faint', 800)]);
        hideSlot(e.side, pos);
        break;
      }
      case 'xp': {
        const target = m.player[e.index];
        if (target) target.expProgress = e.progress;
        await say(e.text, 600);
        break;
      }
      case 'level': {
        const target = m.player[e.index];
        if (target) { target.level = e.level; target.hp = e.hp; target.maxHp = e.maxHp; target.expProgress = e.progress; }
        for (const p of POS) if (m.active.player[p] === e.index) { showSlot('player', p); pop('player', p, `Nv ${e.level}!`, 'level'); }
        playSound('levelup');
        await say(e.text, 900);
        break;
      }
      case 'learn': { playSound('save'); await say(e.text, 800); break; }
      case 'money': { playSound('save'); await say(e.text, 800); break; }
      case 'end': { if (e.text) await say(e.text, 800); break; }
      default: {
        const line = (e as { text?: string }).text;
        if (line) await say(line);
      }
    }
  };

  const settleView = (next: DoublesView) => {
    model.current = { player: clone(next.player.team), foe: clone(next.foe.team), active: { player: [...next.player.active], foe: [...next.foe.active] } };
    const slotOf = (side: SideKey, pos: Pos) => {
      const index = next[side].active[pos];
      const mon = index >= 0 ? next[side].team[index] : undefined;
      return mon && mon.hp > 0 ? clone(mon) : null;
    };
    setSlots({ player: [slotOf('player', 0), slotOf('player', 1)], foe: [slotOf('foe', 0), slotOf('foe', 1)] });
  };

  const beginChoice = (next: DoublesView) => {
    setPicks([null, null]);
    setPendingMove(null);
    setReplaced([]);
    const first = POS.find((p) => next.player.moves[p]) ?? 0;
    setStep(first);
    setText(`O que ${next.player.team[next.player.active[first]]?.name ?? 'seu Pokémon'} vai fazer?`);
    setMode('choose');
  };

  const play = async (events: DuelEvent[], next: DoublesView) => {
    setMode('playing');
    setOutcome(null);
    for (const e of events) {
      if (!alive.current) return;
      await playEvent(e);
    }
    if (!alive.current) return;
    setView(next);
    settleView(next);
    if (next.phase === 'ended') { setOutcome(next.outcome); setMode('ended'); return; }
    if (next.phase === 'replace') {
      setReplaced([]);
      setText(next.replacements > 1 ? 'Escolha quem entra em campo.' : 'Escolha o próximo Pokémon.');
      setMode('replace');
      return;
    }
    beginChoice(next);
  };

  useEffect(() => {
    alive.current = true;
    const first = start.view;
    model.current = { player: clone(first.player.team), foe: clone(first.foe.team), active: { player: [...first.player.active], foe: [...first.foe.active] } };
    if (start.events.length === 0) {
      settleView(first);
      if (first.phase === 'replace') { setText('Escolha o próximo Pokémon.'); setMode('replace'); }
      else if (first.phase === 'ended') { setOutcome(first.outcome); setMode('ended'); }
      else beginChoice(first);
    } else {
      // começa só com quem já estava em campo antes dos eventos
      void play(start.events, start.view);
    }
    return () => { alive.current = false; skip.current?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = async (body: DoublesActRequest) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      model.current = { player: clone(view.player.team), foe: clone(view.foe.team), active: { player: [...view.player.active], foe: [...view.foe.active] } };
      const result = await api.battle2Act(saveId, body);
      setBusy(false);
      await play(result.events, result.view);
    } catch (e) {
      setBusy(false);
      setError((e as Error).message);
      playSound('error');
      beginChoice(view);
    }
  };

  useKeys((k) => { if (k === 'confirm') skip.current?.(); }, mode === 'playing');
  useKeys((k) => { if (k === 'confirm' || k === 'back') { playSound('confirm'); onExit(outcome); } }, mode === 'ended');

  const foeAlive = POS.filter((p) => (view.foe.team[view.foe.active[p]]?.hp ?? 0) > 0);
  const activePlayers = POS.filter((p) => view.player.moves[p]);
  const lastStep = activePlayers[activePlayers.length - 1];

  /** Registra a escolha da posição atual e avança (ou envia o turno). */
  const commit = (pick: Pick) => {
    const next = picks.map((p, i) => (i === step ? pick : p));
    const following = activePlayers.find((p) => p > step);
    setPicks(next);
    setPendingMove(null);
    if (following === undefined || step === lastStep) {
      const actions = POS.map((p) => (view.player.moves[p] ? next[p] ?? null : null));
      void send({ actions });
    } else {
      setStep(following);
      setText(`O que ${view.player.team[view.player.active[following]]?.name ?? ''} vai fazer?`);
      setMode('choose');
    }
  };
  const goBack = () => {
    const previous = [...activePlayers].reverse().find((p) => p < step);
    if (previous === undefined) return;
    setStep(previous);
    setPendingMove(null);
    setText(`O que ${view.player.team[view.player.active[previous]]?.name ?? ''} vai fazer?`);
    setMode('choose');
  };

  const currentMoves = view.player.moves[step] ?? [];
  const bench = view.player.team.filter((m) => m.hp > 0 && !view.player.active.includes(m.index));
  const takenSwitch = new Set(picks.flatMap((p, i) => (p?.kind === 'switch' && i !== step ? [p.to] : [])));
  const hovered = currentMoves.find((m) => String(m.slot) === hover);

  const moveItems: MenuItem[] = [
    ...currentMoves.map((move): MenuItem => ({
      id: `m${move.slot}`,
      label: <span className="gb-mv"><span className={`gb-dot gb-dot--${move.type}`} />{move.displayName}{move.spread ? ' ⇉' : ''}</span>,
    })),
    { id: 'switch', label: 'TROCAR', disabled: bench.filter((m) => !takenSwitch.has(m.index)).length === 0 },
  ];
  const targetItems: MenuItem[] = foeAlive.map((p) => {
    const mon = view.foe.team[view.foe.active[p]] as BattleMonView;
    const eff = pendingMove?.effectiveness[p] ?? null;
    return {
      id: String(p),
      label: <span className="gb-teamrow"><Sprite speciesId={mon.spriteId} shiny={mon.shiny} alt="" size={32} /> {mon.name} <span className="gb-muted">({SIDE_NAME[p]})</span></span>,
      extra: eff === null ? `${mon.hp}/${mon.maxHp}` : eff === 0 ? 'sem efeito' : eff > 1 ? 'super!' : eff < 1 ? 'fraco' : `${mon.hp}/${mon.maxHp}`,
    };
  });
  const switchItems: MenuItem[] = bench.map((mon) => ({
    id: String(mon.index),
    label: <span className="gb-teamrow"><Sprite speciesId={mon.spriteId} shiny={mon.shiny} alt="" size={32} /> {mon.name} <span className="gb-muted">Nv{mon.level}</span></span>,
    extra: `${mon.hp}/${mon.maxHp}`,
    disabled: takenSwitch.has(mon.index),
  }));

  // fase de troca depois de desmaios: preenche as posições vazias, uma por vez
  const emptyPos = POS.filter((p) => !view.player.moves[p] && (view.player.team[view.player.active[p]]?.hp ?? 0) <= 0);
  const replacePos = emptyPos.filter((p) => !replaced.some((r) => r.pos === p))[0];
  const replaceItems: MenuItem[] = bench.map((mon) => ({
    id: String(mon.index),
    label: <span className="gb-teamrow"><Sprite speciesId={mon.spriteId} shiny={mon.shiny} alt="" size={32} /> {mon.name} <span className="gb-muted">Nv{mon.level}</span></span>,
    extra: `${mon.hp}/${mon.maxHp}`,
    disabled: replaced.some((r) => r.to === mon.index),
  }));
  const pickReplacement = (id: string) => {
    if (replacePos === undefined) return;
    const next = [...replaced, { pos: replacePos, to: Number(id) }];
    setReplaced(next);
    const remaining = emptyPos.filter((p) => !next.some((r) => r.pos === p));
    if (next.length >= view.replacements || remaining.length === 0) void send({ replace: next });
  };

  const renderSlot = (side: SideKey, pos: Pos) => {
    const mon = slots[side][pos];
    const id = key(side, pos);
    return (
      <div key={id} className={`gb-b2slot gb-b2slot--${side}${mode === 'target' && side === 'foe' && foeAlive.includes(pos) ? ' is-target' : ''}`}>
        {mon ? <SlotInfo mon={mon} side={side} marked={mode === 'choose' && side === 'player' && pos === step} /> : <div className="gb-b2info gb-b2info--empty" />}
        <div className={`gb-b2sprite${mon ? auraOf(mon) : ''}`}>
          {mon ? (
            <div className={`gb-sprite-anim ${anims[id] ?? ''}`}>
              {side === 'foe'
                ? <Sprite speciesId={mon.spriteId} shiny={mon.shiny} alt={mon.name} size={104} className={anims[id] ? '' : 'gb-bob'} />
                : <BackSprite speciesId={mon.spriteId} shiny={mon.shiny} name={mon.name} />}
            </div>
          ) : null}
          {popup && popup.side === side && popup.pos === pos ? <Popup key={popup.id} text={popup.text} kind={popup.kind} /> : null}
        </div>
      </div>
    );
  };

  return (
    <main className="gb-screen">
      <div className="gb-stage">
        <section className={`gb-battle gb-battle2 gb-battle--${habitat} ${shake}`} aria-label="Batalha em dupla">
          <div className="gb-b2row gb-b2row--foe">{POS.map((p) => renderSlot('foe', p))}</div>
          <div className="gb-b2row gb-b2row--player">{POS.map((p) => renderSlot('player', p))}</div>
          {fx ? <BattleFx key={fx.id} type={fx.type} target={fx.side} category={fx.category} /> : null}
        </section>

        <div className="gb-battle-ui">
          <div className="gb-window gb-window--accent gb-dialog" role="status" aria-live="polite">
            {error ? <p style={{ margin: 0, color: 'var(--red)' }}>{error}</p> : null}
            <TypeText text={mode === 'target' && pendingMove ? `Em quem usar ${pendingMove.displayName}?` : mode === 'switch' ? 'Quem entra no lugar?' : text} instant={mode !== 'playing'} />
            {mode === 'choose' && hovered ? (
              <p className="gb-muted" style={{ margin: '6px 0 0', fontSize: 20 }}>
                <TypeBadge type={hovered.type} /> {hovered.category === 'status' ? 'Status' : `Poder ${hovered.power}`}
                {hovered.accuracy ? ` · Precisão ${hovered.accuracy}` : ' · Não erra'}
                {hovered.spread ? ' · Atinge os dois (×0,75)' : ''}
              </p>
            ) : null}
            {mode === 'choose' && picks.some((p) => p) ? <p className="gb-muted" style={{ margin: '4px 0 0', fontSize: 20 }}>X volta para o Pokémon anterior.</p> : null}
          </div>

          <div className="gb-window gb-battle-menu" aria-label="Ações">
            {mode === 'playing' ? <p className="gb-muted" style={{ margin: 0 }}>Z adianta o texto…</p> : null}
            {mode === 'choose' ? (
              <Menu
                key={`choose-${view.turn}-${step}`}
                label="Golpes" columns={2} items={moveItems} active={!busy} onMove={(id) => setHover(id.startsWith('m') ? id.slice(1) : '')}
                onSelect={(id) => {
                  if (id === 'switch') { setMode('switch'); return; }
                  const move = currentMoves.find((m) => `m${m.slot}` === id);
                  if (!move) return;
                  if (move.needsTarget && foeAlive.length > 1) { setPendingMove(move); setMode('target'); return; }
                  commit({ kind: 'move', slot: move.slot, ...(move.needsTarget && foeAlive[0] !== undefined ? { target: { side: 'foe' as const, pos: foeAlive[0] } } : {}) });
                }}
                onBack={activePlayers.indexOf(step) > 0 ? goBack : undefined}
              />
            ) : null}
            {mode === 'target' && pendingMove ? (
              <Menu
                label="Alvo" items={targetItems} active={!busy}
                onSelect={(id) => commit({ kind: 'move', slot: pendingMove.slot, target: { side: 'foe', pos: Number(id) as Pos } })}
                onBack={() => { setPendingMove(null); setMode('choose'); }}
              />
            ) : null}
            {mode === 'switch' ? (
              <Menu label="Equipe" items={switchItems} active={!busy} onSelect={(id) => commit({ kind: 'switch', to: Number(id) })} onBack={() => setMode('choose')} />
            ) : null}
            {mode === 'replace' ? (
              <Menu label="Equipe" items={replaceItems} active={!busy} onSelect={pickReplacement} />
            ) : null}
            {mode === 'ended' && outcome ? <OutcomePanel outcome={outcome} trainer={{ ...view.trainer, bagLeft: 0 }} /> : null}
          </div>
        </div>
        <KeyHints hints={mode === 'ended' ? [['Z', 'continuar']] : mode === 'playing' ? [['Z', 'adiantar texto']] : [['↑↓←→', 'escolher'], ['Z', 'confirmar'], ['X', 'voltar']]} />
      </div>
    </main>
  );
}

function SlotInfo({ mon, side, marked }: { mon: BattleMonView; side: SideKey; marked: boolean }) {
  const stages = Object.entries(mon.stages) as [keyof typeof STAGE_SHORT, number][];
  return (
    <div className={`gb-b2info gb-b2info--${side}${marked ? ' is-active' : ''}`}>
      <div className="gb-spread">
        <span className="gb-label" style={{ textTransform: 'uppercase' }}>{mon.shiny ? '✦ ' : ''}{mon.name}</span>
        <span>Nv{mon.level}</span>
      </div>
      <div className="gb-binfo__tags">
        {mon.status ? <span className={`gb-status gb-status--${mon.status}`} title={STATUS_LABELS[mon.status]}>{STATUS_SHORT[mon.status]}</span> : null}
        {mon.confused ? <span className="gb-status gb-status--confusion" title="confusão">CONF</span> : null}
        {stages.map(([k, value]) => <span key={k} className={`gb-stage-tag ${value > 0 ? 'gb-stage-tag--up' : 'gb-stage-tag--down'}`}>{STAGE_SHORT[k]}{value > 0 ? `+${value}` : value}</span>)}
      </div>
      <HpBar current={mon.hp} max={mon.maxHp} />
      {side === 'player' ? <div style={{ fontSize: 18, textAlign: 'right' }}>{mon.hp}/{mon.maxHp}</div> : null}
    </div>
  );
}
