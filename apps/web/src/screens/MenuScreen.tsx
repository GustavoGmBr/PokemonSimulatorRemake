import { useEffect, useState } from 'react';
import { HEAL_EFFECTS, isTrainingItem, type HistoryState, type PokemonView, type SaveDetail } from '@pokesim/engine';
import { api } from '../api.ts';
import { Menu, type MenuItem } from '../ui/Menu.tsx';
import { DialogBox } from '../ui/DialogBox.tsx';
import { HpBar, ItemIcon, KeyHints, Sprite, Stars, formatMoney, formatPlayTime } from '../ui/bits.tsx';
import { PokemonSummary } from '../ui/PokemonSummary.tsx';
import { TeamsPanel } from '../ui/TeamsPanel.tsx';
import { useKeys } from '../ui/useKeys.ts';

export type MenuId = 'battle' | 'wild' | 'pokedex' | 'team' | 'pc' | 'bag' | 'teams' | 'shop' | 'casino' | 'tournament' | 'market' | 'missions' | 'trainer' | 'options' | 'exit';
type Panel = 'overview' | 'team' | 'summary' | 'bag' | 'teams' | 'trainer';

const MENU: { id: MenuId; label: string; info: string; phase?: string }[] = [
  { id: 'battle', label: 'Batalhar', info: 'Ginásios, Elite dos 4, campeões e treinadores aleatórios.' },
  { id: 'wild', label: 'Selvagens', info: 'Procure POKÉMON no mapa, gire, escolha e capture.' },
  { id: 'pokedex', label: 'Pokédex', info: 'Os 1.025 POKÉMON das nove regiões.' },
  { id: 'team', label: 'Equipe', info: 'Veja os POKÉMON que viajam com você.' },
  { id: 'teams', label: 'Equipes', info: 'Salve equipes com nome e monte qualquer uma com um clique.' },
  { id: 'pc', label: 'PC', info: 'Caixas ilimitadas: guarde, busque e organize seus POKÉMON.' },
  { id: 'bag', label: 'Mochila', info: 'Use poções, reviver e outros itens nos seus POKÉMON.' },
  { id: 'shop', label: 'Loja', info: 'Compre POKÉ BOLAS, poções e mais com carrinho.' },
  { id: 'tournament', label: 'Torneios', info: 'Oito rodadas eliminatórias por categoria, com prêmios.' },
  { id: 'casino', label: 'Pokécassino', info: 'Fichas, 7 jogos, aposta de POKÉMON e prêmios.' },
  { id: 'missions', label: 'Missões', info: 'Dez objetivos a cada 2 horas, com recompensas e bônus final.' },
  { id: 'market', label: 'Mercado', info: 'Compre POKÉMON (renova a cada hora) e venda os da sua coleção.' },
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
  onOpenWild: () => void;
  onOpenShop: () => void;
  onOpenBattle: () => void;
  onOpenCasino: () => void;
  onOpenTournament: () => void;
  onOpenMissions: () => void;
  onOpenMarket: () => void;
}

export function MenuScreen({ saveId, welcome, focus, onExit, onOpenPc, onOpenPokedex, onOpenOptions, onOpenWild, onOpenShop, onOpenBattle, onOpenCasino, onOpenTournament, onOpenMissions, onOpenMarket }: Props) {
  const [save, setSave] = useState<SaveDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<MenuId>(focus ?? 'team');
  const [panel, setPanel] = useState<Panel>('overview');
  const [notice, setNotice] = useState<string | null>(welcome ?? null);
  const [selectedMon, setSelectedMon] = useState<PokemonView | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () => api.getSave(saveId).then(setSave, (e: Error) => setError(e.message));
  useEffect(() => { void reload(); }, [saveId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ponto indicador: missões prontas para resgatar e Pokémon especial (shiny/4★) no Mercado.
  const [readyMissions, setReadyMissions] = useState(0);
  const [marketHot, setMarketHot] = useState(false);
  useEffect(() => {
    if (panel !== 'overview') return;
    api.missions(saveId).then((m) => setReadyMissions(m.missions.filter((x) => x.done && !x.claimed).length), () => undefined);
    api.market(saveId).then((m) => setMarketHot(m.stock.some((e) => e.available && (e.shiny || e.stars >= 4))), () => undefined);
  }, [saveId, panel]);

  const menu = MENU;

  const nameOf = (item: string) => save?.inventory.find((entry) => entry.item === item)?.displayName ?? item;

  /** Usa o mesmo item em cada Pokémon da equipe em que ele funcione, até acabar a quantidade. */
  const useOnTeam = (item: string) => void act(async () => {
    if (!save) return '';
    let used = 0;
    let healed = 0;
    let levels = 0;
    let note = '';
    for (const mon of save.team) {
      try {
        const result = await api.useItem(saveId, item, mon.id);
        used += 1;
        healed += result.healed;
        levels += Math.max(0, result.pokemon.level - mon.level);
        note = result.message ?? note;
      } catch (e) {
        if (/não tem/i.test((e as Error).message)) break; // acabou o item
      }
    }
    if (used === 0) return `${nameOf(item)} não teve efeito em ninguém da equipe.`;
    const extra = healed > 0 ? ` (+${healed} HP no total)` : levels > 0 ? ` (+${levels} nível${levels > 1 ? 'is' : ''} no total)` : '';
    return `${nameOf(item)} usado em ${used} POKÉMON da equipe${extra}.`;
  });

  /** Cura a equipe toda: Reviver nos desmaiados e a menor poção que resolve em cada um. */
  const healTeam = () => void act(async () => {
    if (!save) return '';
    const stock = new Map(save.inventory.filter((entry) => entry.item in HEAL_EFFECTS).map((entry) => [entry.item, entry.quantity]));
    const potions = Object.entries(HEAL_EFFECTS).filter(([, effect]) => !effect.revive).sort(([, a], [, b]) => a.heal - b.heal).map(([name]) => name);
    const revives = Object.entries(HEAL_EFFECTS).filter(([, effect]) => effect.revive).sort(([, a], [, b]) => a.heal - b.heal).map(([name]) => name);
    const has = (name: string) => (stock.get(name) ?? 0) > 0;
    let cured = 0;
    let spent = 0;
    for (const mon of save.team) {
      let hp = mon.currentHp;
      const max = mon.stats.hp;
      if (hp <= 0) {
        const revive = revives.find(has);
        if (!revive) continue;
        hp = (await api.useItem(saveId, revive, mon.id)).pokemon.currentHp;
        stock.set(revive, (stock.get(revive) ?? 0) - 1);
        spent += 1;
      }
      for (let guard = 0; hp < max && guard < 12; guard++) {
        const need = max - hp;
        const available = potions.filter(has);
        const pick = available.find((name) => (HEAL_EFFECTS[name]?.heal ?? 0) >= need) ?? available[available.length - 1];
        if (!pick) break;
        hp = (await api.useItem(saveId, pick, mon.id)).pokemon.currentHp;
        stock.set(pick, (stock.get(pick) ?? 0) - 1);
        spent += 1;
      }
      if (hp > mon.currentHp) cured += 1;
    }
    if (spent === 0) return save.team.every((mon) => mon.currentHp >= mon.stats.hp) ? 'A equipe já está com o HP cheio.' : 'Faltam poções ou Reviver na mochila.';
    return `Equipe curada: ${cured} POKÉMON, ${spent} item${spent > 1 ? 'ns' : ''} usado${spent > 1 ? 's' : ''}.`;
  });

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
    label: entry.id === 'missions' && readyMissions > 0
      ? <span>{entry.label}<span className="gb-dot" role="img" aria-label={`${readyMissions} missões prontas`} title={`${readyMissions} prontas para resgatar`} /></span>
      : entry.id === 'market' && marketHot
        ? <span>{entry.label}<span className="gb-dot" role="img" aria-label="Pokémon especial no mercado" title="Shiny ou 4★ à venda" /></span>
        : entry.label,
    extra: entry.phase ? 'em breve' : undefined,
  }));

  const choose = (id: MenuId) => {
    const entry = menu.find((m) => m.id === id);
    if (id === 'exit') return onExit();
    if (id === 'wild') return onOpenWild();
    if (id === 'battle') return onOpenBattle();
    if (id === 'shop') return onOpenShop();
    if (id === 'casino') return onOpenCasino();
    if (id === 'tournament') return onOpenTournament();
    if (id === 'missions') return onOpenMissions();
    if (id === 'market') return onOpenMarket();
    if (id === 'team') return setPanel('team');
    if (id === 'pc') return onOpenPc();
    if (id === 'pokedex') return onOpenPokedex();
    if (id === 'options') return onOpenOptions();
    if (id === 'bag') return setPanel('bag');
    if (id === 'teams') return setPanel('teams');
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
          ? ['Escolha um item (cura, Doce ou Essência de IV) e depois o POKÉMON. X para voltar.']
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
                inventory={save.inventory}
                paused={Boolean(notice) || busy}
                onHeal={healTeam}
                onUseAll={useOnTeam}
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
                onUseAll={useOnTeam}
                onUse={(item, mon) => void act(async () => {
                  const result = await api.useItem(saveId, item, mon.id);
                  if (result.message) return result.message;
                  const revived = mon.currentHp === 0;
                  return revived
                    ? `${mon.name.toUpperCase()} voltou à vida com ${result.pokemon.currentHp} HP!`
                    : `${mon.name.toUpperCase()} recuperou ${result.healed} HP!`;
                })}
              /> : null}
            {panel === 'teams' ? <TeamsPanel saveId={saveId} paused={Boolean(notice) || busy} onBack={() => setPanel('overview')} onChanged={() => void reload()} /> : null}
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

function TeamPanel({ team, inventory, paused, onHeal, onUseAll, active, onOpen, onBack }: {
  team: PokemonView[];
  inventory: SaveDetail['inventory'];
  paused: boolean;
  onHeal: () => void;
  onUseAll: (item: string) => void;
  
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
            <span className="gb-mon__sprite"><Sprite speciesId={mon.spriteId} shiny={mon.shiny} alt="" size={80} /></span>
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
      <TeamShortcuts team={team} inventory={inventory} disabled={paused} onHeal={onHeal} onUseAll={onUseAll} />
    </section>
  );
}

const ALL_TEAM = '__team__';
const usable = (item: string): boolean => item in HEAL_EFFECTS || isTrainingItem(item);

const BAG_SECTIONS: { id: string; label: string; categories: string[] }[] = [
  { id: 'cura', label: 'Cura', categories: ['cura'] },
  { id: 'bolas', label: 'Bolas', categories: ['captura'] },
  { id: 'treino', label: 'Treino', categories: ['treino', 'ivs'] },
  { id: 'evolucao', label: 'Evolução', categories: ['evolucao'] },
  { id: 'formas', label: 'Formas', categories: ['mega', 'primal'] },
  { id: 'outros', label: 'Outros', categories: [] },
];

function sectionOf(category: string): string {
  return BAG_SECTIONS.find((section) => section.categories.includes(category))?.id ?? 'outros';
}

/** Atalhos da equipe: curar todos e doces em todos de uma vez. */
function TeamShortcuts({ team, inventory, disabled, onHeal, onUseAll }: {
  team: PokemonView[];
  inventory: SaveDetail['inventory'];
  disabled: boolean;
  onHeal: () => void;
  onUseAll: (item: string) => void;
}) {
  const hurt = team.some((mon) => mon.currentHp < mon.stats.hp);
  const hasHeal = inventory.some((entry) => entry.item in HEAL_EFFECTS);
  const candies = inventory.filter((entry) => entry.item === 'rare-candy' || entry.item.startsWith('exp-candy'));
  if (team.length === 0) return null;
  return (
    <div className="gb-row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }} aria-label="Atalhos da equipe">
      <button type="button" className="gb-button" disabled={disabled || !hurt || !hasHeal} title={!hurt ? 'A equipe está com o HP cheio.' : !hasHeal ? 'Sem poções na mochila.' : ''} onClick={onHeal}>Curar equipe</button>
      {candies.map((entry) => (
        <button key={entry.item} type="button" className="gb-button" disabled={disabled} onClick={() => onUseAll(entry.item)}>
          {entry.displayName} em todos (×{entry.quantity})
        </button>
      ))}
    </div>
  );
}

function BagPanel({ save, paused, onBack, onUse, onUseAll }: {
  save: SaveDetail;
  paused: boolean;
  onBack: () => void;
  onUse: (item: string, mon: PokemonView) => void;
  onUseAll: (item: string) => void;
}) {
  const [picking, setPicking] = useState<string | null>(null);
  const [sectionId, setSectionId] = useState<string>('cura');
  const itemName = picking ? save.inventory.find((entry) => entry.item === picking)?.displayName ?? '' : '';
  const sections = BAG_SECTIONS
    .map((section) => ({ ...section, entries: save.inventory.filter((entry) => sectionOf(entry.category) === section.id) }))
    .filter((section) => section.entries.length > 0);
  const current = sections.find((section) => section.id === sectionId) ?? sections[0];
  // Setas esquerda/direita trocam de seção (as de cima/baixo ficam com a lista).
  useKeys((key) => {
    if (!sections.length || (key !== 'left' && key !== 'right')) return;
    const index = Math.max(0, sections.findIndex((section) => section.id === current?.id));
    const next = sections[(index + (key === 'right' ? 1 : sections.length - 1)) % sections.length];
    if (next) setSectionId(next.id);
  }, !paused && !picking);
  return (
    <section className="gb-window" aria-labelledby="bag-title">
      <h2 id="bag-title" className="gb-title" style={{ marginBottom: 10 }}>{picking ? `Usar ${itemName} em…` : 'Mochila'}</h2>
      {save.inventory.length === 0 ? <p className="gb-muted">A mochila está vazia.</p> : null}
      {!picking && sections.length > 0 ? (
        <div className="gb-tabs" role="tablist" aria-label="Seções da mochila">
          {sections.map((section) => (
            <button key={section.id} type="button" role="tab" aria-selected={section.id === current?.id} className="gb-tab" onClick={() => setSectionId(section.id)}>
              {section.label} ({section.entries.length})
            </button>
          ))}
        </div>
      ) : null}
      {!picking && current ? (
        <Menu
          key={current.id}
          label={current.label}
          active={!paused}
          onBack={onBack}
          items={[...current.entries].sort((a, b) => Number(usable(b.item)) - Number(usable(a.item)) || a.displayName.localeCompare(b.displayName)).map((entry): MenuItem => ({
            id: entry.item,
            label: <span className="gb-iconrow"><ItemIcon item={entry.item} size={24} />{entry.displayName}</span>,
            extra: `×${entry.quantity}`,
            disabled: !usable(entry.item),
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
          items={[
            ...(save.team.length > 1 ? [{ id: ALL_TEAM, label: '★ Toda a equipe', extra: `${save.team.length} POKÉMON` } as MenuItem] : []),
            ...save.team.map((mon): MenuItem => ({
              id: mon.id,
              label: `${mon.name} Nv${mon.level}`,
              extra: mon.currentHp === 0 ? 'desmaiado' : `${mon.currentHp}/${mon.stats.hp}`,
            })),
          ]}
          onSelect={(id) => {
            if (id === ALL_TEAM) { if (picking) onUseAll(picking); setPicking(null); return; }
            const mon = save.team.find((m) => m.id === id);
            if (mon && picking) onUse(picking, mon);
            setPicking(null);
          }}
        />
      ) : null}
      {!picking ? <p className="gb-hint" style={{ marginBottom: 0 }}>←/→ trocam a seção. Itens esmaecidos são usados em outros lugares (bolas na captura; pedras, Mega e G-Max no perfil do POKÉMON).</p> : null}
    </section>
  );
}

function KeyBack({ onBack, active }: { onBack: () => void; active: boolean }) {
  useKeys((key) => { if (key === 'back') onBack(); }, active);
  return null;
}

function TrainerCard({ save, onBack }: { save: SaveDetail; onBack: () => void }) {
  useKeys((key) => { if (key === 'back') onBack(); });
  const [history, setHistory] = useState<HistoryState | null>(null);
  useEffect(() => { api.history(save.id).then(setHistory, () => undefined); }, [save.id]);
  const stats = history?.stats;
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
      {stats ? (
        <>
          <h3 className="gb-title" style={{ fontSize: 20, margin: '12px 0 4px' }}>Estatísticas</h3>
          <div className="gb-grid-2" style={{ fontSize: 22 }}>
            <span>VITÓRIAS / DERROTAS</span><span>{stats.victories} / {stats.defeats}</span>
            <span>CAPTURAS</span><span>{stats.captures}</span>
            <span>SHINIES ENCONTRADOS</span><span>{stats.shinyEncounters}</span>
            <span>TREINADORES VENCIDOS</span><span>{stats.trainersBeaten}</span>
            <span>TÍTULOS DE TORNEIO</span><span>{stats.tournamentTitles}</span>
            <span>POKÉMON NA COLEÇÃO</span><span>{stats.pokemonOwned}</span>
            <span>VENDIDOS</span><span>{stats.sold} ({formatMoney(stats.moneyEarnedSales)})</span>
          </div>
          <h3 className="gb-title" style={{ fontSize: 20, margin: '12px 0 4px' }}>Histórico</h3>
          <ul className="gb-history" aria-label="Histórico">
            {history && history.events.length > 0 ? history.events.map((event) => (
              <li key={event.id}><span className="gb-muted">{new Date(event.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span> {event.text}</li>
            )) : <li className="gb-muted">Nada por aqui ainda.</li>}
          </ul>
        </>
      ) : null}
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
