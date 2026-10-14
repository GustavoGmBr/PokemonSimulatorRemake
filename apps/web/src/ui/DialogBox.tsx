import { useEffect, useState } from 'react';
import { useKeys } from './useKeys.ts';
import { TEXT_SPEED_CPS, useSettings } from '../settings.ts';

interface DialogBoxProps {
  /** cada item é uma "página" do diálogo */
  pages: string[];
  /** chamado ao avançar a última página */
  onFinish?: () => void;
  active?: boolean;
  /** caracteres por segundo; padrão = velocidade escolhida nas Opções */
  speed?: number;
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Caixa de texto que "digita" como nos jogos; Z ou clique avança. */
export function DialogBox({ pages, onFinish, active = true, speed }: DialogBoxProps) {
  const settings = useSettings();
  const cps = speed ?? TEXT_SPEED_CPS[settings.textSpeed];
  const [page, setPage] = useState(0);
  const [shown, setShown] = useState(0);
  const text = pages[Math.min(page, pages.length - 1)] ?? '';
  const done = shown >= text.length;

  const pagesKey = pages.join('\u0000');
  useEffect(() => {
    setPage(0);
  }, [pagesKey]);

  useEffect(() => {
    if (reducedMotion() || cps >= 10_000) {
      setShown(text.length);
      return;
    }
    setShown(0);
    const timer = window.setInterval(() => {
      setShown((n) => {
        if (n >= text.length) {
          window.clearInterval(timer);
          return n;
        }
        return n + 1;
      });
    }, 1000 / cps);
    return () => window.clearInterval(timer);
  }, [text, cps]);

  const advance = () => {
    if (!done) {
      setShown(text.length);
    } else if (page < pages.length - 1) {
      setPage(page + 1);
    } else {
      onFinish?.();
    }
  };

  useKeys((key) => {
    if (key === 'confirm' || key === 'back') advance();
  }, active);

  const hasMore = page < pages.length - 1 || Boolean(onFinish);
  return (
    <div
      className="gb-window gb-window--accent gb-dialog"
      onClick={active ? advance : undefined}
      role="status"
      aria-live="polite"
    >
      <p>
        <span aria-hidden="true">{text.slice(0, shown)}</span>
        <span className="sr-only">{text}</span>
        {done && hasMore && active ? <span className="gb-caret" aria-hidden="true">▼</span> : null}
      </p>
    </div>
  );
}
