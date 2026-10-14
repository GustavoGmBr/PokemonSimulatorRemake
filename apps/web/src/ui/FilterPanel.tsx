import { useState } from 'react';
import { useKeys } from './useKeys.ts';
import { playSound } from '../sound.ts';

export interface FilterRow {
  id: string;
  label: string;
  value: string;
  /** cycle: ←→ troca o valor · text: Z abre o campo · action: Z executa */
  kind: 'cycle' | 'text' | 'action';
}

interface Props {
  title: string;
  rows: FilterRow[];
  active: boolean;
  onCycle: (id: string, direction: 1 | -1) => void;
  onEdit?: (id: string) => void;
  onAction?: (id: string) => void;
  onBack?: () => void;
  /** Q/E nas linhas de ciclo (passo grande, ex.: 10 em 10) */
  onBigCycle?: (id: string, direction: 1 | -1) => void;
}

/** Lista de filtros estilo opções do GBA: ↑↓ escolhe a linha, ←→ muda o valor. */
export function FilterPanel({ title, rows, active, onCycle, onEdit, onAction, onBack, onBigCycle }: Props) {
  const [index, setIndex] = useState(0);
  const current = Math.min(index, rows.length - 1);

  useKeys((key) => {
    const row = rows[current];
    if (!row) return;
    if (key === 'up') { setIndex((current + rows.length - 1) % rows.length); playSound('move'); }
    else if (key === 'down') { setIndex((current + 1) % rows.length); playSound('move'); }
    else if (key === 'left' && row.kind === 'cycle') { onCycle(row.id, -1); playSound('move'); }
    else if (key === 'right' && row.kind === 'cycle') { onCycle(row.id, 1); playSound('move'); }
    else if (onBigCycle && row.kind === 'cycle' && (key === 'prev' || key === 'next')) { onBigCycle(row.id, key === 'next' ? 1 : -1); playSound('move'); }
    else if (key === 'confirm') {
      playSound('confirm');
      if (row.kind === 'text') onEdit?.(row.id);
      else if (row.kind === 'action') onAction?.(row.id);
      else onCycle(row.id, 1);
    } else if (key === 'back' && onBack) { playSound('back'); onBack(); }
  }, active);

  return (
    <section className="gb-window" aria-label={title}>
      <h3 className="gb-title" style={{ fontSize: 20, marginBottom: 6 }}>{title}</h3>
      <ul className="gb-menu" style={{ gap: 0 }}>
        {rows.map((row, i) => (
          <li key={row.id}>
            <button
              type="button"
              className="gb-menu__item gb-filter-row"
              aria-current={active && i === current}
              onMouseEnter={() => setIndex(i)}
              onClick={() => {
                setIndex(i);
                if (row.kind === 'text') onEdit?.(row.id);
                else if (row.kind === 'action') onAction?.(row.id);
                else onCycle(row.id, 1);
              }}
            >
              <span className="gb-cursor" aria-hidden="true">▶</span>
              <span>{row.label}</span>
              <span className="gb-filter-row__value">
                {row.kind === 'cycle' ? <span aria-hidden="true">◀ </span> : null}
                {row.value}
                {row.kind === 'cycle' ? <span aria-hidden="true"> ▶</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
