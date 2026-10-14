import { useEffect } from 'react';
import { api } from './api.ts';

const PING_SECONDS = 30;

/**
 * Conta o tempo de jogo: a cada 30 s com a aba visível, avisa o servidor.
 * Ao esconder a aba ou sair, envia o que faltou. Falhas de rede só adiam a contagem.
 */
export function usePlayTime(saveId: string | null): void {
  useEffect(() => {
    if (!saveId) return;
    let pending = 0;
    let last = Date.now();
    let sending = false;

    const tick = () => {
      const now = Date.now();
      if (document.visibilityState === 'visible') pending += Math.round((now - last) / 1000);
      last = now;
    };
    const flush = () => {
      tick();
      if (pending < 1 || sending) return;
      const seconds = Math.min(pending, 120);
      sending = true;
      api.playTime(saveId, seconds).then(
        () => { pending -= seconds; },
        () => { /* tenta de novo no próximo ciclo */ },
      ).finally(() => { sending = false; });
    };

    const timer = window.setInterval(flush, PING_SECONDS * 1000);
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); else last = Date.now(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, [saveId]);
}
