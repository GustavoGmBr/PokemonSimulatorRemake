import { useEffect, useState } from 'react';
import type { PokemonView, SaveDetail } from '@pokesim/engine';
import { api } from '../api.ts';
import { Menu, type MenuItem } from '../ui/Menu.tsx';
import { DialogBox } from '../ui/DialogBox.tsx';
import { HpBar, KeyHints, Sprite, Stars, formatMoney, formatPlayTime } from '../ui/bits.tsx';
import { PokemonSummary } from '../ui/PokemonSummary.tsx';
import { useKeys } from '../ui/useKeys.ts';

export type MenuId = 'battle' | 'wild' | 'pokedex' | 'team' | 'pc' | 'bag' | 'shop' | 'casino' | 'missions' | 'trainer' | 'options' | 'exit';
type Panel = 'overview' | 'team' | 'summary' | 'bag' | 'trainer';

const MENU: { id: MenuId; label: string; info: string; phase?: string }[] = [
  { id: 'battle', label: 'Batalhar', info: 'Ginásios, treinadores e campeões.', phase: 'Fase 2' },
  { id: 'wild', label: 'Selvagens', info: 'Explore rotas e capture POKÉMON.', phase: 'Fase 1' },
  { id: 'pokedex', label: 'Pokédex', info: 'Os 1.025 POKÉMON das nove regiões.' },
  { id: 'team', label: 'Equipe', info: 'Veja os POKÉMON que viajam com você.' },
  { id: 'pc', label: 'PC', info: 'Caixas ilimitadas: guarde, busque e organize seus POKÉMON.' },
  { id: 'bag', label: 'Mochila', info: 'Itens guardados na sua mochila.' },
  { id: 'shop', label: 'Loja', info: 'Compre POKÉ BOLAS, poções e mais.', phase: 'Fase 3' },
  { id: 'casino', label: 'Pokécassino', info: 'Fichas, caça-níqueis e outros jogos.', phase: 'Fase 4' },
  { id: 'missions', label: 'Missões', info: 'Objetivos renovados com recompensas.', phase: 'Fase 3' },
  { id: 'trainer', label: 'Treinador', info: 'Seu cartão de treinador.' },
  { id: 'options', label: 'Opções', info: 'Velocidade do texto e volume dos sons.' },
  { id: 'exit', label: 'Sair', info: 'Voltar para a tela de jornadas.' },
];

interface Props {
  saveId: string;
  welcome?: string;
  /** item do menu que começa selecionado (ao voltar do PC, da Pokédex…) */
  focus?: MenuId;
  onExit: () => void;
  onOpenPc: () => void;
  onOpenPokedex: () => void;
  onOpenOptions: () => void;
}

export function MenuScreen({ saveId, welcome, focus, onExit, onOpenPc, onOpenPokedex, onOpenOptions }: Props) {
  const [save, setSave] = useState<SaveDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<MenuId>(focus ?? 'team');
  const [panel, setPanel] = useState<Panel>('overview');
  const [notice, setNotice] = useState<string | null>(welcome ?? null);
  const [selectedMon, setSelectedMon] = useState<PokemonView | null>(null);

  useEffect(() => {
    api.getSave(saveId).then(setSave, (e: Error) => setError(e.message));
  }, [saveId]);

  if (error) {
    return (
      <main className="gb-screen">
        <div className="gb-stage">
          <DialogBox pages={[error]} onFinish={onExit} />
        </div>
      </main>
    );
  }
  if (!save) {
    return (
      <main className="gb-screen">
        <div className="gb-stage"><DialogBox pages={['Carregando…']} active={false} /></div>
      </main>
    );
  }

  const menuActive = panel === 'overview' && !notice;
  const items: MenuItem<MenuId>[] = MENU.map((entry) => ({
    id: entry.id,
    label: entry.label,
    extra: entry.phase ? 'em breve' : undefined,
  }));

  const choose = (id: MenuId) => {
    const entry = MENU.find((m) => m.id === id);
    if (id === 'exit') return onExit();
    if (id === 'team') return setPanel('team');
    if (id === 'pc') return onOpenPc();
    if (id === 'pokedex') return onOpenPokedex();
    if (id === 'options') return onOpenOptions();
    if (id === 'bag') return setPanel('bag');
    if (id === 'trainer') return setPanel('trainer');
    setNotice(`${entry?.label.toUpperCase()} ainda está em construção. Chega na ${entry?.phase} do remake!`);
  };

  const info = MENU.find((m) => m.id === hovered)?.info ?? '';
  const dialog = notice
    ? [notice]
    : panel === 'team'
      ? ['Escolha um POKÉMON para ver os detalhes.']
      : panel === 'summary' && selectedMon
        ? [`${selectedMon.name.toUpperCase()} · ${selectedMon.ivTotal}/186 de IV. X para voltar.`]
        : panel === 'bag'
          ? ['Itens da sua mochila. X para voltar.']
          : panel === 'trainer'
            ? ['Seu cartão de treinador. X para voltar.']
            : [info];

  return (
    <main className="gb-screen">
      <div className="gb-stage">
        <Header save={save} />

        <div className="gb-row" style={{ alignItems: 'flex-start' }}>
          <nav className="gb-window gb-side" style={{ maxWidth: 340, padding: '14px 8px' }} aria-label="Menu principal">
            <Menu
              label="Menu principal"
              items={items}
              active={menuActive}
              initialId={hovered}
              onMove={setHovered}
              onSelect={choose}
            />
          </nav>

          <div className="gb-grow gb-stack" style={{ gap: 20 }}>
            {panel === 'overview' || panel === 'team' ? (
              <TeamPanel
                team={save.team}
                active={panel === 'team' && !notice}
                onOpen={(mon) => { setSelectedMon(mon); setPanel('summary'); }}
                onBack={() => setPanel('overview')}
              />
            ) : null}
            {panel === 'summary' && selectedMon ? (
              <PokemonSummary mon={selectedMon} onBack={() => setPanel('team')} />
            ) : null}
            {panel === 'bag' ? <BagPanel save={save} onBack={() => setPanel('overview')} /> : null}
            {panel === 'trainer' ? <TrainerCard save={save} onBack={() => setPanel('overview')} /> : null}
            {panel === 'overview' ? <JourneyPanel save={save} /> : null}
          </div>
        </div>

        <DialogBox pages={dialog} active={Boolean(notice)} onFinish={notice ? () => setNotice(null) : undefined} />
        <KeyHints hints={[['↑↓←→', 'mover'], ['Z', 'confirmar'], ['X', 'voltar']]} />
      </div>
    </main>
  );
}

function Header({ save }: { save: SaveDetail }) {
  return (
    <header className="gb-window gb-spread" style={{ alignItems: 'center', padding: '12px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div aria-hidden="true" style={{ width: 48, height: 48, background: 'var(--red)', border: '4px solid var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-title)', fontWeight: 700, fontSize: 22, color: 'var(--paper)' }}>
          {save.trainerName.charAt(0).toUpperCase()}
        </div>
        <div>
          <div className="gb-title" style={{ fontSize: 26 }}>{save.trainerName}</div>
          <div className="gb-muted" style={{ fontSize: 20 }}>Tempo de jogo {formatPlayTime(save.playTimeSeconds)}</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, fontSize: 24 }}>
        <span>{formatMoney(save.money)}</span>
        <span>FICHAS {save.chips.toLocaleString('pt-BR')}</span>
        <span>INSÍGNIAS {save.badges}</span>
      </div>
    </header>
  );
}

function TeamPanel({ team, active, onOpen, onBack }: {
  team: PokemonView[];
  active: boolean;
  onOpen: (mon: PokemonView) => void;
  onBack: () => void;
}) {
  const [index, setIndex] = useState(0);
  useKeys((key) => {
    const n = team.length;
    if (n === 0) { if (key === 'back') onBack(); return; }
    if (key === 'left') setIndex((i) => (i + n - 1) % n);
    else if (key === 'right') setIndex((i) => (i + 1) % n);
    else if (key === 'up') setIndex((i) => (i - 2 + n * 2) % n);
    else if (key === 'down') setIndex((i) => (i + 2) % n);
    else if (key === 'confirm') { const mon = team[index]; if (mon) onOpen(mon); }
    else if (key === 'back') onBack();
  }, active);

  const slots = Array.from({ length: 6 }, (_, i) => team[i] ?? null);
  return (
    <section className="gb-window gb-window--sky" aria-labelledby="team-title" style={{ border: '4px solid var(--ink)' }}>
      <h2 id="team-title" className="gb-title gb-title--shadow" style={{ marginBottom: 12 }}>Equipe principal</h2>
      <div className="gb-grid-2">
        {slots.map((mon, i) => mon ? (
          <button
            key={mon.id}
            type="button"
            className="gb-mon"
            aria-current={active && i === index}
            onMouseEnter={() => active && setIndex(i)}
            onClick={() => onOpen(mon)}
          >
            <span className="gb-mon__sprite"><Sprite speciesId={mon.speciesId} shiny={mon.shiny} alt="" size={80} /></span>
            <span className="gb-mon__body">
              <span className="gb-mon__head">
                <span>{mon.favorite ? <span className="gb-fav">♥ </span> : null}{mon.name}{mon.shiny ? ' ✦' : ''}</span>
                <span>Nv{mon.level}</span>
              </span>
              <HpBar current={mon.currentHp} max={mon.stats.hp} />
              <span className="gb-spread" style={{ fontSize: 20 }}>
                <Stars count={mon.ivStars} />
                <span>{mon.currentHp}/{mon.stats.hp}</span>
              </span>
            </span>
          </button>
        ) : (
          <div key={`empty-${i}`} className="gb-mon" style={{ opacity: 0.55, minHeight: 90, justifyContent: 'center' }}>
            <span className="gb-muted">— vazio —</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function BagPanel({ save, onBack }: { save: SaveDetail; onBack: () => void }) {
  useKeys((key) => { if (key === 'back') onBack(); });
  return (
    <section className="gb-window" aria-labelledby="bag-title">
      <h2 id="bag-title" className="gb-title" style={{ marginBottom: 10 }}>Mochila</h2>
      {save.inventory.length === 0 ? <p className="gb-muted">A mochila está vazia.</p> : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {save.inventory.map((entry) => (
            <li key={entry.item} className="gb-spread" style={{ padding: '6px 4px', borderBottom: '2px solid var(--rim)', fontSize: 26 }}>
              <span>{entry.displayName}</span>
              <span>×{entry.quantity}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TrainerCard({ save, onBack }: { save: SaveDetail; onBack: () => void }) {
  useKeys((key) => { if (key === 'back') onBack(); });
  return (
    <section className="gb-window" aria-labelledby="card-title" style={{ background: 'var(--paper-2)' }}>
      <div className="gb-spread">
        <h2 id="card-title" className="gb-title">Cartão de treinador</h2>
        <span className="gb-muted">ID {save.id.slice(0, 5).toUpperCase()}</span>
      </div>
      <div className="gb-grid-2" style={{ marginTop: 12, fontSize: 26 }}>
        <span>NOME</span><span>{save.trainerName.toUpperCase()}</span>
        <span>DINHEIRO</span><span>{formatMoney(save.money)}</span>
        <span>POKÉDEX</span><span>{save.pokedexCaught}</span>
        <span>INSÍGNIAS</span><span>{save.badges}</span>
        <span>TEMPO</span><span>{formatPlayTime(save.playTimeSeconds)}</span>
        <span>INÍCIO</span><span>{new Date(save.createdAt).toLocaleDateString('pt-BR')}</span>
      </div>
    </section>
  );
}

function JourneyPanel({ save }: { save: SaveDetail }) {
  return (
    <section className="gb-window" aria-labelledby="journey-title">
      <h2 id="journey-title" className="gb-title" style={{ fontSize: 22, marginBottom: 6 }}>Jornada</h2>
      <div className="gb-spread" style={{ fontSize: 24 }}>
        <span>KANTO</span>
        <span>GINÁSIOS {Math.min(save.badges, 8)}/8</span>
      </div>
      <div style={{ height: 12, border: '3px solid var(--ink)', background: '#e0d8b8', marginTop: 6 }}>
        <div style={{ height: '100%', width: `${(Math.min(save.badges, 8) / 8) * 100}%`, background: 'var(--red)' }} />
      </div>
      <p className="gb-hint" style={{ margin: '8px 0 0' }}>As batalhas de ginásio chegam na Fase 2.</p>
    </section>
  );
}
