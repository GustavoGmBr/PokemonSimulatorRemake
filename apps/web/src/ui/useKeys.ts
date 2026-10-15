import { useEffect, useRef } from 'react';
import { BIND_ACTIONS, getSettings } from '../settings.ts';

export type GameKey =
  | 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back'
  | 'prev' | 'next' | 'filter' | 'goto' | 'tool' | 'move1' | 'move2' | 'move3' | 'move4';

const norm = (key: string) => (key.length === 1 ? key.toLowerCase() : key);

/** Tecla -> ação, conforme as teclas escolhidas em Opções → Controles (Enter e Esc sempre valem; T = ferramenta de teste). */
function actionOf(key: string): GameKey | undefined {
  const pressed = norm(key);
  if (pressed === 'Enter') return 'confirm';
  if (pressed === 'Escape') return 'back';
  const keys = getSettings().keys;
  for (const action of BIND_ACTIONS) if (keys[action.id].some((k) => norm(k) === pressed)) return action.id;
  return pressed === 't' ? 'tool' : undefined;
}

/**
 * Escuta o teclado enquanto `active` for true. Só uma camada da tela deve estar
 * ativa por vez (o menu em foco), assim as teclas não "vazam" para trás.
 */
export function useKeys(handler: (key: GameKey, event: KeyboardEvent) => void, active = true): void {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    if (!active) return;
    const listener = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
      if (typing && event.key !== 'Enter' && event.key !== 'Escape') return;
      const key = actionOf(event.key);
      if (!key) return;
      event.preventDefault();
      ref.current(key, event);
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [active]);
}
