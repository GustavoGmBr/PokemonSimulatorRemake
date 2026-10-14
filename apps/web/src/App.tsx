import { useState } from 'react';
import { SavesScreen } from './screens/SavesScreen.tsx';
import { NewGameScreen } from './screens/NewGameScreen.tsx';
import { MenuScreen } from './screens/MenuScreen.tsx';

/** Telas do jogo. Sem URLs: a navegação é como num console. */
export type Screen =
  | { name: 'saves' }
  | { name: 'new-game' }
  | { name: 'menu'; saveId: string; welcome?: string };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'saves' });

  switch (screen.name) {
    case 'saves':
      return (
        <SavesScreen
          key="saves"
          onContinue={(saveId) => setScreen({ name: 'menu', saveId })}
          onNewGame={() => setScreen({ name: 'new-game' })}
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
    case 'menu':
      return (
        <MenuScreen
          key={screen.saveId}
          saveId={screen.saveId}
          welcome={screen.welcome}
          onExit={() => setScreen({ name: 'saves' })}
        />
      );
  }
}
