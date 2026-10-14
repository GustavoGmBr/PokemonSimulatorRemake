import { useEffect, useState, type ReactNode } from 'react';
import { useKeys } from './useKeys.ts';
import { playSound } from '../sound.ts';

export interface MenuItem<Id extends string = string> {
  id: Id;
  label: ReactNode;
  extra?: ReactNode;
  disabled?: boolean;
}

interface MenuProps<Id extends string> {
  items: MenuItem<Id>[];
  onSelect: (id: Id) => void;
  onBack?: () => void;
  onMove?: (id: Id) => void;
  active?: boolean;
  columns?: 1 | 2;
  initialId?: Id;
  label: string;
}

/** Lista de opções com cursor ▶, controlada por setas + Z/X ou mouse. */
export function Menu<Id extends string>({
  items, onSelect, onBack, onMove, active = true, columns = 1, initialId, label,
}: MenuProps<Id>) {
  const initial = Math.max(0, items.findIndex((item) => item.id === initialId));
  const [index, setIndex] = useState(initial);
  const current = Math.min(index, items.length - 1);

  useEffect(() => {
    const item = items[current];
    if (item) onMove?.(item.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, items.length]);

  const move = (delta: number) => {
    if (items.length === 0) return;
    setIndex((i) => (Math.min(i, items.length - 1) + delta + items.length) % items.length);
    playSound('move');
  };

  useKeys((key) => {
    if (key === 'up') move(-columns);
    else if (key === 'down') move(columns);
    else if (key === 'left' && columns > 1) move(-1);
    else if (key === 'right' && columns > 1) move(1);
    else if (key === 'confirm') {
      const item = items[current];
      if (item && !item.disabled) {
        playSound('confirm');
        onSelect(item.id);
      }
    } else if (key === 'back' && onBack) {
      playSound('back');
      onBack();
    }
  }, active);

  return (
    <ul className={`gb-menu${columns === 2 ? ' gb-menu--grid' : ''}`} aria-label={label}>
      {items.map((item, i) => (
        <li key={item.id}>
          <button
            type="button"
            className="gb-menu__item"
            aria-current={i === current}
            disabled={item.disabled}
            onMouseEnter={() => setIndex(i)}
            onFocus={() => setIndex(i)}
            onClick={() => !item.disabled && onSelect(item.id)}
          >
            <span className="gb-cursor" aria-hidden="true">▶</span>
            {item.label}
            {item.extra ? <span className="gb-menu__extra">{item.extra}</span> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}
