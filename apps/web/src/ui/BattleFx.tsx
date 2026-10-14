import type { CSSProperties } from 'react';
import type { SideKey, TypeName } from '@pokesim/engine';

type Mode = 'shot' | 'burst' | 'rain' | 'ring' | 'slash';
interface FxConfig {
  mode: Mode;
  color: string;
  shape?: 'round' | 'leaf' | 'bolt' | 'star' | 'diamond' | 'square';
  ms: number;
}

/** Cada tipo tem a sua animação própria: projéteis, explosões, chuva, anéis ou cortes. */
const FX: Record<TypeName, FxConfig> = {
  normal: { mode: 'burst', color: '#f8f4e4', shape: 'star', ms: 650 },
  fighting: { mode: 'burst', color: '#d84a38', shape: 'star', ms: 650 },
  flying: { mode: 'slash', color: '#dfe8ff', ms: 600 },
  poison: { mode: 'shot', color: '#a050c8', shape: 'round', ms: 850 },
  ground: { mode: 'rain', color: '#b08850', shape: 'square', ms: 850 },
  rock: { mode: 'rain', color: '#8a8a78', shape: 'diamond', ms: 850 },
  bug: { mode: 'shot', color: '#98c030', shape: 'round', ms: 800 },
  ghost: { mode: 'shot', color: '#604a98', shape: 'round', ms: 900 },
  steel: { mode: 'slash', color: '#c8d0d8', ms: 600 },
  fire: { mode: 'shot', color: '#f08030', shape: 'square', ms: 850 },
  water: { mode: 'shot', color: '#4890f0', shape: 'round', ms: 850 },
  grass: { mode: 'shot', color: '#58c048', shape: 'leaf', ms: 850 },
  electric: { mode: 'shot', color: '#f8d030', shape: 'bolt', ms: 750 },
  psychic: { mode: 'ring', color: '#f85888', ms: 850 },
  ice: { mode: 'shot', color: '#98d8d8', shape: 'diamond', ms: 850 },
  dragon: { mode: 'shot', color: '#7038f8', shape: 'star', ms: 900 },
  dark: { mode: 'slash', color: '#30283c', ms: 650 },
  fairy: { mode: 'shot', color: '#f4a0c8', shape: 'star', ms: 900 },
};

export function fxKindOf(type: TypeName, category: string): { ms: number } {
  const config = FX[type] ?? FX.normal;
  return { ms: category === 'status' ? 800 : config.ms };
}

/** Posição (em % da arena) do centro de cada lado. */
const SPOT: Record<SideKey, [number, number]> = { player: [21, 70], foe: [77, 35] };

const N = 9;

/** Efeito visual de um golpe sobre o alvo. */
export function BattleFx({ type, target, category }: { type: TypeName; target: SideKey; category: string }) {
  const base = FX[type] ?? FX.normal;
  const config: FxConfig = category === 'status' ? { ...base, mode: 'ring' } : base;
  const from = SPOT[target === 'foe' ? 'player' : 'foe'];
  const at = SPOT[target];
  const style = {
    '--c': config.color,
    '--sx': `${from[0]}%`, '--sy': `${from[1]}%`, '--ex': `${at[0]}%`, '--ey': `${at[1]}%`,
  } as CSSProperties;
  const items = config.mode === 'ring' ? 2 : config.mode === 'slash' ? 3 : N;
  return (
    <div className={`gb-fx gb-fx--${config.mode} gb-fx--${config.shape ?? 'round'}`} style={style} aria-hidden="true">
      {Array.from({ length: items }, (_, i) => {
        const angle = (i / items) * Math.PI * 2;
        const jitter = ((i * 37) % 11) - 5;
        const particle = {
          '--i': i,
          '--j': jitter * 5,
          '--k': (((i * 53) % 9) - 4) * 5,
          '--dx': `${Math.round(Math.cos(angle) * 70)}px`,
          '--dy': `${Math.round(Math.sin(angle) * 55)}px`,
        } as CSSProperties;
        return <i key={i} style={particle} />;
      })}
    </div>
  );
}
