import { useEffect, useState } from 'react';
import { HEAL_EFFECTS, type PokemonView, type SaveDetail } from '@pokesim/engine';
import { api } from '../api.ts';
import { Menu, type MenuItem } from '../ui/Menu.tsx';
import { DialogBox } from '../ui/DialogBox.tsx';
import { HpBar, KeyHints, Sprite, Stars, formatMoney, formatPlayTime } from '../ui/bits.tsx';
import { PokemonSummary } from '../ui/PokemonSummary.tsx';
import { useKeys } from '../ui/useKeys.ts';

export type MenuId = 'battle' | 'wild' | 'pokedex' | 'team' | 'pc' | 'bag' | 'shop' | 'casino' | 'missions' | 'trainer' | 'options' | 'exit' | 'devkit' | 'devprogress' | 'devall' | 'devhurt';
type Panel = 'overview' | 'team' | 'summary' | 'bag' | 'trainer';

const MENU: { id: MenuId; label: string; info: string; phase?: string }[] = [
  { id: 'battle', label: 'Batalhar', info: 'Ginásios, Elite dos 4, campeões e treinadores aleatórios.' },
  { id: 'wild', label: 'Selvagens', info: 'Procure POKÉMON no mapa, gire, escolha e capture.' },
  { id: 'pokedex', label: 'Pokédex', info: 'Os 1.025 POKÉMON das nove regiões.' },
  { id: 'team', label: 'Equipe', info: 'Veja os POKÉMON que viajam com você.' },
  { id: 'pc', label: 'PC', info: 'Caixas ilimitadas: guarde, busque e organize seus POKÉMON.' },
  { id: 'bag', label: 'Mochila', info: 'Use poções, reviver e outros itens nos seus POKÉMON.' },
  { id: 'shop', label: 'Loja', info: 'Compre POKÉ BOLAS, poções e mais com carrinho.' },
  { id: 'casino', label: 'Pokécassino', info: 'Fichas, caça-níqueis e outros jogos.', phase: 'Fase 4' },
  { id: 'missions', label: 'Missões', info: 'Objetivos renovados com recompensas.', phase: 'Fase 3' },
  { id: 'trainer', label: 'Treinador', info: 'Seu cartão de treinador.' },
  { id: 'options', label: 'Opções', info: 'Velocidade do texto e volume dos sons.' },
  { id: 'exit', label: 'Sair', info: 'Voltar para a tela de jornadas.' },
];

const DEV_MENU: { id: MenuId; label: string; info: string; phase?: string }[] = [
  { id: 'devkit', label: '[TESTE] Kit', info: 'Dá bolas, curas e ₽ 20.000 para testar.' },
  { id: 'devprogress', label: '[TESTE] Próximo desafio', info: 'Vence o próximo ginásio, Elite dos 4 ou campeão (libera giros, lendários, regiões e busca específica).' },
  { id: 'devall', label: '[TESTE] Vencer tudo', info: 'Vence todos os desafios das 9 regiões.' },
  { id: 'devhurt', label: '[TESTE] Ferir equipe', info: 'Reduz o HP da equipe para testar poções.' },
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
  onOpenWild: () => void;
  onOpenShop: () => void;
  onOpenBattle: () => void;
}

export function MenuScreen({ saveId, welcome, focus, onExit, onOpenPc, onOpenPokedex, onOpenOptions, onOpenWild, onOpenShop, onOpenBattle }: Props) {
  const [save, setSave] = useState<SaveDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<MenuId>(focus ?? 'team');
  const [panel, setPanel] = useState<Panel>('overview');
  const [notice, setNotice] = useState<string | null>(welcome ?? null);
  const [selectedMon, setSelectedMon] = useState<PokemonView | null>(null);
  const [devTools, setDevTools] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = () => api.getSave(saveId).then(setSave, (e: Error) => setError(e.message));
  useEffect(() => { void reload(); }, [saveId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.health().then((h) => setDevTools(h.devTools), () => setDevTools(false)); }, []);

  const menu = devTools ? [...MENU.slice(0, -1), ...DEV_MENU, ...MENU.slice(-1)] : MENU;

  /** Executa uma ação do servidor, atualiza o save e mostra o resultado num aviso. */
  const act = async (work: () => Promise<string>) => {
    setBusy(true);
    try {
      setNotice(await work());
      await reload();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

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

  const menuActive = panel === 'overview' && !notice && !busy;
  const items: MenuItem<MenuId>[] = menu.map((entry) => ({
    id: entry.id,
    label: entry.label,
    extra: entry.phase ? 'em breve' : undefined,
  }));

  const choose = (id: MenuId) => {
    const entry = menu.find((m) => m.id === id);
    if (id === 'exit') return onExit();
    if (id === 'wild') return onOpenWild();
    if (id === 'battle') return onOpenBattle();
    if (id === 'shop') return onOpenShop();
    if (id === 'devkit') {
      return void act(async () => {
        const result = await api.devKit(saveId);
        return `[TESTE] +${result.balls} bolas, curas e ₽ 20.000.`;
      });
    }
    if (id === 'devprogress' || id === 'devall') {
      return void act(async () => {
        const result = await api.devProgress(saveId, id === 'devall');
        return result.granted ? `[TESTE] Desafio vencido: ${result.granted}.` : '[TESTE] Todos os desafios já foram vencidos.';
      });
    }
    if (id === 'devhurt') return void act(async () => `[TESTE] ${(await api.devHurt(saveId)).hurt} POKÉMON feridos.`);
    if (id === 'team') return setPanel('team');
    if (id === 'pc') return onOpenPc();
    if (id === 'pokedex') return onOpenPokedex();
    if (id === 'options') return onOpenOptions();
    if (id === 'bag') return setPanel('bag');
    if (id === 'trainer') return setPanel('trainer');
    setNotice(`${entry?.label.toUpperCase()} ainda está em construção. Chega na ${entry?.phase} do remake!`);
  };

  const info = menu.find((m) => m.id === hovered)?.info ?? '';
  const dialog = notice
    ? [notice]
    : panel === 'team'
      ? ['Escolha um POKÉMON para ver os detalhes.']
      : panel === 'summary' && selectedMon
        ? [`${selectedMon.name.toUpperCase()} · ${selectedMon.ivTotal}/186 de IV. X para voltar.`]
        : panel === 'bag'
          ? ['Escolha um item de cura e depois o POKÉMON. X para voltar.']
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
              <PokemonSummary mon={selectedMon} saveId={saveId} onChanged={(next) => { setSelectedMon(next); void reload(); }} onBack={() => setPanel('team')} />
            ) : null}
            {panel === 'bag' ? <BagPanel
                save={save}
                paused={Boolean(notice) || busy}
                onBack={() => setPanel('overview')}
                onUse={(item, mon) => void act(async () => {
                  const result = await api.useItem(saveId, item, mon.id);
                  const revived = mon.currentHp === 0;
                  return revived
                    ? `${mon.name.toUpperCase()} voltou à vida com ${result.pokemon.currentHp} HP!`
                    : `${mon.name.toUpperCase()} recuperou ${result.healed} HP!`;
                })}
              /> : null}
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

function BagPanel({ save, paused, onBack, onUse }: {
  save: SaveDetail;
  paused: boolean;
  onBack: () => void;
  onUse: (item: string, mon: PokemonView) => void;
}) {
  const [picking, setPicking] = useState<string | null>(null);
  const itemName = picking ? save.inventory.find((entry) => entry.item === picking)?.displayName ?? '' : '';
  return (
    <section className="gb-window" aria-labelledby="bag-title">
      <h2 id="bag-title" className="gb-title" style={{ marginBottom: 10 }}>{picking ? `Usar ${itemName} em…` : 'Mochila'}</h2>
      {save.inventory.length === 0 ? <p className="gb-muted">A mochila está vazia.</p> : null}
      {!picking && save.inventory.length > 0 ? (
        <Menu
          label="Itens"
          active={!paused}
          onBack={onBack}
          items={[...save.inventory].sort((a, b) => Number(b.item in HEAL_EFFECTS) - Number(a.item in HEAL_EFFECTS) || a.displayName.localeCompare(b.displayName)).map((entry): MenuItem => ({
            id: entry.item,
            label: entry.displayName,
            extra: `×${entry.quantity}`,
            disabled: !(entry.item in HEAL_EFFECTS),
          }))}
          onSelect={setPicking}
        />
      ) : null}
      {!picking && save.inventory.length === 0 ? <KeyBack onBack={onBack} active={!paused} /> : null}
      {picking ? (
        <Menu
          label="Escolha o POKÉMON"
          active={!paused}
          onBack={() => setPicking(null)}
          items={save.team.map((mon): MenuItem => ({
            id: mon.id,
            label: `${mon.name} Nv${mon.level}`,
            extra: mon.currentHp === 0 ? 'desmaiado' : `${mon.currentHp}/${mon.stats.hp}`,
          }))}
          onSelect={(id) => {
            const mon = save.team.find((m) => m.id === id);
            if (mon && picking) onUse(picking, mon);
            setPicking(null);
          }}
        />
      ) : null}
      {!picking ? <p className="gb-hint" style={{ marginBottom: 0 }}>Itens esmaecidos são usados em outros lugares (bolas na captura, pedras na evolução).</p> : null}
    </section>
  );
}

function KeyBack({ onBack, active }: { onBack: () => void; active: boolean }) {
  useKeys((key) => { if (key === 'back') onBack(); }, active);
  return null;
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
      <p className="gb-hint" style={{ margin: '8px 0 0' }}>Enfrente os líderes em BATALHAR.</p>
    </section>
  );
}
