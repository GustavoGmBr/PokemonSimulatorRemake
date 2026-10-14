import { useState, type CSSProperties } from 'react';
import { TYPE_LABELS, type TypeName } from '@pokesim/engine';
import { spriteUrl, type SpriteView } from '../api.ts';

export function HpBar({ current, max }: { current: number; max: number }) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
  const color = ratio > 0.5 ? 'var(--green)' : ratio > 0.2 ? 'var(--yellow)' : 'var(--red)';
  return (
    <div className="gb-bar" role="meter" aria-label="HP" aria-valuemin={0} aria-valuemax={max} aria-valuenow={current}>
      <span className="gb-bar__tag">HP</span>
      <div className="gb-bar__track">
        <div className="gb-bar__fill" style={{ width: `${ratio * 100}%`, background: color }} />
      </div>
    </div>
  );
}

export function XpBar({ progress }: { progress: number }) {
  return (
    <div className="gb-xp" role="meter" aria-label="Experiência" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
      <div style={{ width: `${progress * 100}%` }} />
    </div>
  );
}

export function TypeBadge({ type }: { type: TypeName }) {
  return <span className={`gb-type gb-type--${type}`}>{TYPE_LABELS[type]}</span>;
}

export function Stars({ count }: { count: number }) {
  return (
    <span className="gb-stars" aria-label={`${count} de 4 estrelas de IV`}>
      {count > 0 ? '★'.repeat(count) : '0☆'}
    </span>
  );
}

interface SpriteProps {
  speciesId: number;
  view?: SpriteView;
  shiny?: boolean;
  alt: string;
  size?: number;
  className?: string;
}

export function Sprite({ speciesId, view = 'front', shiny = false, alt, size = 64, className }: SpriteProps) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="gb-sprite-missing" style={{ width: size, height: size }} role="img" aria-label={alt}>
        {size >= 70 ? 'sem sprite' : '?'}
      </div>
    );
  }
  return (
    <img
      className={`pixel ${className ?? ''}`}
      src={spriteUrl(speciesId, view, shiny)}
      alt={alt}
      width={size}
      height={size}
      style={{ width: size, height: size, objectFit: 'contain' }}
      onError={() => setFailed(true)}
      draggable={false}
    />
  );
}

export function formatMoney(value: number): string {
  return `₽ ${value.toLocaleString('pt-BR')}`;
}

export function formatPlayTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h${String(m).padStart(2, '0')}m`;
}

export function KeyHints({ hints }: { hints: [string, string][] }) {
  return (
    <div className="gb-keys" aria-hidden="true">
      {hints.map(([key, label]) => (
        <span key={key}>
          <span className="gb-key">{key}</span>
          {label}
        </span>
      ))}
    </div>
  );
}

const BALL_VARIANT: Record<string, string> = {
  'poke-ball': '', 'great-ball': 'great', 'ultra-ball': 'ultra', 'master-ball': 'master',
};

/** Cor da metade de cima das bolas especiais. */
const BALL_COLOR: Record<string, string> = {
  'fast-ball': '#e8b020', 'timer-ball': '#c050b0', 'dusk-ball': '#403060', 'dive-ball': '#2070c0', 'net-ball': '#40a0a0',
  'nest-ball': '#c8a060', 'repeat-ball': '#f0d020', 'heavy-ball': '#707070', 'moon-ball': '#5040c0', 'level-ball': '#70c8e8',
  'love-ball': '#f080b0', 'dream-ball': '#a0b0e0', 'heal-ball': '#f0a0c0', 'luxury-ball': '#c04030', 'friend-ball': '#48a848',
  'sport-ball': '#e86020', 'premier-ball': '#f4f0e0',
};

/** Poké Bola desenhada em CSS; a cor muda conforme o tipo de bola. */
export function BallIcon({ item, small = false, className = '' }: { item: string; small?: boolean; className?: string }) {
  const variant = item in BALL_VARIANT ? BALL_VARIANT[item] : 'other';
  const color = BALL_COLOR[item];
  return (
    <span
      aria-hidden="true"
      className={`gb-pokeball${variant ? ` gb-pokeball--${variant}` : ''}${small ? ' gb-pokeball--small' : ''} ${className}`}
      style={color ? ({ '--ball-top': color } as CSSProperties) : undefined}
    />
  );
}
