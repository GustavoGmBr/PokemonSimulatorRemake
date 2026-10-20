import { useEffect, useState } from 'react';
import { TitleScreen } from './screens/TitleScreen.tsx';
import { SavesScreen } from './screens/SavesScreen.tsx';
import { NewGameScreen } from './screens/NewGameScreen.tsx';
import { MenuScreen, type MenuId } from './screens/MenuScreen.tsx';
import { PcScreen } from './screens/PcScreen.tsx';
import { PokedexScreen } from './screens/PokedexScreen.tsx';
import { WildScreen } from './screens/WildScreen.tsx';
import { ChallengesScreen } from './screens/ChallengesScreen.tsx';
import { CasinoScreen } from './screens/CasinoScreen.tsx';
import { TournamentScreen } from './screens/TournamentScreen.tsx';
import { MissionsScreen } from './screens/MissionsScreen.tsx';
import { MarketScreen } from './screens/MarketScreen.tsx';
import { PcSellScreen } from './screens/PcSellScreen.tsx';
import { ShopScreen } from './screens/ShopScreen.tsx';
import { OptionsScreen } from './screens/OptionsScreen.tsx';
import { usePlayTime } from './usePlayTime.ts';
import { useMusic, type Track } from './music.ts';
import { useSettings } from './settings.ts';
import { YoutubeDock } from './ui/YoutubeDock.tsx';

const TRACKS: Partial<Record<Screen['name'], Track>> = { wild: 'wild', shop: 'shop', market: 'shop', casino: 'casino' };

/** Aplica tema (região) e contraste ao documento. */
function useAppearance() {
  const { theme, contrast } = useSettings();
  useEffect(() => {
    const root = document.documentElement;
    if (theme) root.dataset.theme = theme; else delete root.dataset.theme;
    root.dataset.contrast = contrast;
  }, [theme, contrast]);
}

/** Telas do jogo. Sem URLs: a navegação é como num console. */
export type Screen =
  | { name: 'title' }
  | { name: 'saves' }
  | { name: 'new-game' }
  | { name: 'menu'; saveId: string; welcome?: string; focus?: MenuId }
  | { name: 'pc'; saveId: string }
  | { name: 'pokedex'; saveId: string }
  | { name: 'wild'; saveId: string }
  | { name: 'shop'; saveId: string }
  | { name: 'challenges'; saveId: string }
  | { name: 'casino'; saveId: string }
  | { name: 'tournament'; saveId: string }
  | { name: 'missions'; saveId: string }
  | { name: 'market'; saveId: string }
  | { name: 'pcsell'; saveId: string }
  | { name: 'options'; back: Screen };

function saveIdOf(screen: Screen): string | null {
  return 'saveId' in screen ? screen.saveId : screen.name === 'options' ? saveIdOf(screen.back) : null;
}

function Screens() {
  const [screen, setScreen] = useState<Screen>({ name: 'title' });
  usePlayTime(saveIdOf(screen));
  useAppearance();
  useMusic(TRACKS[screen.name] ?? 'menu');

  switch (screen.name) {
    case 'title':
      return (
        <TitleScreen
          key="title"
          onContinue={(saveId) => setScreen({ name: 'menu', saveId })}
          onSaves={() => setScreen({ name: 'saves' })}
          onNewGame={() => setScreen({ name: 'new-game' })}
          onOptions={() => setScreen({ name: 'options', back: screen })}
        />
      );
    case 'saves':
      return (
        <SavesScreen
          key="saves"
          onContinue={(saveId) => setScreen({ name: 'menu', saveId })}
          onNewGame={() => setScreen({ name: 'new-game' })}
          onOptions={() => setScreen({ name: 'options', back: screen })}
        />
      );
    case 'new-game':
      return (
        <NewGameScreen
          key="new-game"
          onCancel={() => setScreen({ name: 'saves' })}
          onCreated={(saveId, welcome) => setScreen({ name: 'menu', saveId, welcome })}
        />
      );
    case 'menu': {
      const { saveId } = screen;
      return (
        <MenuScreen
          key={`menu-${saveId}-${screen.focus ?? ''}`}
          saveId={saveId}
          welcome={screen.welcome}
          focus={screen.focus}
          onExit={() => setScreen({ name: 'saves' })}
          onOpenPc={() => setScreen({ name: 'pc', saveId })}
          onOpenPokedex={() => setScreen({ name: 'pokedex', saveId })}
          onOpenOptions={() => setScreen({ name: 'options', back: { name: 'menu', saveId, focus: 'options' } })}
          onOpenWild={() => setScreen({ name: 'wild', saveId })}
          onOpenShop={() => setScreen({ name: 'shop', saveId })}
          onOpenBattle={() => setScreen({ name: 'challenges', saveId })}
          onOpenCasino={() => setScreen({ name: 'casino', saveId })}
          onOpenTournament={() => setScreen({ name: 'tournament', saveId })}
          onOpenMissions={() => setScreen({ name: 'missions', saveId })}
          onOpenMarket={() => setScreen({ name: 'market', saveId })}
        />
      );
    }
    case 'pc':
      return <PcScreen key={`pc-${screen.saveId}`} saveId={screen.saveId} onBack={() => setScreen({ name: 'menu', saveId: screen.saveId, focus: 'pc' })} onOpenSell={() => setScreen({ name: 'pcsell', saveId: screen.saveId })} />;
    case 'pcsell':
      return <PcSellScreen key={`ps-${screen.saveId}`} saveId={screen.saveId} onBack={() => setScreen({ name: 'pc', saveId: screen.saveId })} />;
    case 'pokedex':
      return <PokedexScreen key={`dex-${screen.saveId}`} saveId={screen.saveId} onBack={() => setScreen({ name: 'menu', saveId: screen.saveId, focus: 'pokedex' })} />;
    case 'wild':
      return <WildScreen key={`wild-${screen.saveId}`} saveId={screen.saveId} onBack={() => setScreen({ name: 'menu', saveId: screen.saveId, focus: 'wild' })} />;
    case 'shop':
      return <ShopScreen key={`shop-${screen.saveId}`} saveId={screen.saveId} onBack={() => setScreen({ name: 'menu', saveId: screen.saveId, focus: 'shop' })} />;
    case 'challenges':
      return <ChallengesScreen key={`ch-${screen.saveId}`} saveId={screen.saveId} onBack={() => setScreen({ name: 'menu', saveId: screen.saveId, focus: 'battle' })} />;
    case 'casino':
      return <CasinoScreen key={`cs-${screen.saveId}`} saveId={screen.saveId} onBack={() => setScreen({ name: 'menu', saveId: screen.saveId, focus: 'casino' })} />;
    case 'tournament':
      return <TournamentScreen key={`tn-${screen.saveId}`} saveId={screen.saveId} onBack={() => setScreen({ name: 'menu', saveId: screen.saveId, focus: 'tournament' })} />;
    case 'missions':
      return <MissionsScreen key={`ms-${screen.saveId}`} saveId={screen.saveId} onBack={() => setScreen({ name: 'menu', saveId: screen.saveId, focus: 'missions' })} />;
    case 'market':
      return <MarketScreen key={`mk-${screen.saveId}`} saveId={screen.saveId} onBack={() => setScreen({ name: 'menu', saveId: screen.saveId, focus: 'market' })} />;
    case 'options':
      return <OptionsScreen key="options" onBack={() => setScreen(screen.back)} />;
  }
}

export function App() {
  return (
    <>
      <Screens />
      <YoutubeDock />
    </>
  );
}
