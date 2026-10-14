import { useEffect, useRef } from 'react';

export type GameKey =
  | 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back'
  | 'prev' | 'next' | 'filter' | 'goto' | 'tool';

/** Mapa estilo GBA: setas, Z/Enter/Espaço = A, X/Esc/Backspace = B. */
const KEYMAP: Record<string, GameKey> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right',
  z: 'confirm', Z: 'confirm', Enter: 'confirm', ' ': 'confirm',
  x: 'back', X: 'back', Escape: 'back', Backspace: 'back',
  // atalhos extras: Q/E (ou PageUp/PageDown) trocam de aba/caixa; F busca; G "ir para"; T ferramenta de teste
  q: 'prev', Q: 'prev', PageUp: 'prev', e: 'next', E: 'next', PageDown: 'next',
  f: 'filter', F: 'filter', g: 'goto', G: 'goto', t: 'tool', T: 'tool',
};

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
      const key = KEYMAP[event.key];
      if (!key) return;
      event.preventDefault();
      ref.current(key, event);
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [active]);
}
