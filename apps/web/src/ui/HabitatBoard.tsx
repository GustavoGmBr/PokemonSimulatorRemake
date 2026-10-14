import { useEffect, useMemo, useRef } from 'react';
import type { WildSlotView } from '@pokesim/engine';
import { Sprite } from './bits.tsx';
import { COLS, ROWS, drawHabitat, habitatSpawns } from './habitats.ts';

const stars = (n: number) => (n > 0 ? '★'.repeat(n) : '0★');

interface Props {
  habitat: string;
  slots: WildSlotView[];
  cursor: number;
  alertStars: number;
  disabled?: boolean;
  onHover: (slot: number) => void;
  onPick: (slot: number) => void;
}

/** O mapa do habitat com os Pokémon "soltos" nele; clique em um para enfrentá-lo. */
export function HabitatBoard({ habitat, slots, cursor, alertStars, disabled, onHover, onPick }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const spawns = useMemo(() => habitatSpawns(habitat), [habitat]);

  useEffect(() => {
    if (canvas.current) drawHabitat(canvas.current, habitat);
  }, [habitat]);

  return (
    <div className="gb-map-scroll">
      <div className="gb-map" role="group" aria-label="Mapa de selvagens" style={{ aspectRatio: `${COLS} / ${ROWS}` }}>
        <canvas ref={canvas} className="gb-map__canvas" aria-hidden="true" />
        {slots.map((slot) => {
          const [x, y] = spawns[slot.slot] ?? [COLS / 2, ROWS / 2];
          const mark = slot.shiny ? 'shiny' : slot.ivStars >= alertStars ? 'stars' : null;
          return (
            <button
              key={slot.slot}
              type="button"
              className={`gb-wild${mark ? ` gb-wild--${mark}` : ''}`}
              style={{ left: `${(x / COLS) * 100}%`, top: `${(y / ROWS) * 100}%`, zIndex: Math.round(y * 10) }}
              aria-current={cursor === slot.slot}
              aria-label={`${slot.name}, nível ${slot.level}, ${slot.ivStars} estrelas${slot.shiny ? ', brilhante' : ''}`}
              disabled={disabled}
              onMouseEnter={() => onHover(slot.slot)}
              onFocus={() => onHover(slot.slot)}
              onClick={() => onPick(slot.slot)}
            >
              <span className="gb-wild__tag">
                <b>{slot.shiny ? '✦ ' : ''}{slot.name}</b>
                <span>Nv{slot.level} · <span className="gb-stars">{stars(slot.ivStars)}</span></span>
              </span>
              <Sprite speciesId={slot.speciesId} shiny={slot.shiny} alt="" size={96} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Próximo Pokémon do mapa na direção pedida (para jogar só com o teclado). */
export function neighbour(habitat: string, from: number, direction: 'left' | 'right' | 'up' | 'down', count: number): number {
  const spawns = habitatSpawns(habitat);
  const origin = spawns[from];
  if (!origin) return from;
  let best = from;
  let bestScore = Infinity;
  for (let i = 0; i < Math.min(count, spawns.length); i++) {
    if (i === from) continue;
    const [x, y] = spawns[i] as [number, number];
    const dx = x - origin[0];
    const dy = (y - origin[1]) * 1.6;
    const along = direction === 'left' ? -dx : direction === 'right' ? dx : direction === 'up' ? -dy : dy;
    const across = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
    if (along <= 0.5) continue;
    const score = along + across * 1.4;
    if (score < bestScore) { bestScore = score; best = i; }
  }
  return best;
}
