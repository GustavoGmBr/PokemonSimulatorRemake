import { useMemo } from 'react';

/**
 * Retrato pixel-art de treinador, desenhado na hora (SVG, grade 16×24) — sem arquivos para baixar.
 * O visual vem só do nome e do título, então o mesmo líder é igual em qualquer tela.
 */
export type TrainerRole = 'leader' | 'elite' | 'champion' | 'captain' | 'cup' | 'trainer';

export function roleOf(title: string | undefined): TrainerRole {
  const t = (title ?? '').toLowerCase();
  if (t.startsWith('campe')) return 'champion';
  if (t.startsWith('elite')) return 'elite';
  if (t.startsWith('líder') || t.startsWith('lider')) return 'leader';
  if (t.startsWith('capit')) return 'captain';
  if (t.startsWith('copa')) return 'cup';
  return 'trainer';
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const SKIN = ['#f8d8b8', '#e8b890', '#c88c60', '#8c5a3a', '#f0c8a0'];
const HAIR = ['#2c2018', '#6a3a1c', '#c8902c', '#d84a38', '#4a5ab8', '#e8e0d0', '#38a070', '#8a4ab8'];
const OUTFIT = ['#d84a38', '#3868c8', '#38a058', '#e8a830', '#8a4ab8', '#38a8b8', '#c85898', '#6a6a78', '#a86030'];

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v + amount)));
  const r = c((n >> 16) & 255), g = c((n >> 8) & 255), b = c(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

interface Px { x: number; y: number; w: number; h: number; c: string }

export function trainerPixels(name: string, role: TrainerRole): Px[] {
  const h = hash(name);
  const pick = <T,>(list: readonly T[], shift: number): T => list[(h >>> shift) % list.length] as T;
  const skin = pick(SKIN, 0), hair = pick(HAIR, 3), outfit = pick(OUTFIT, 7);
  const style = (h >>> 11) % 3; // 0 curto, 1 espetado, 2 comprido
  const hat = (h >>> 14) % 4 === 0 && role !== 'champion';
  const female = (h >>> 16) % 2 === 0;
  const ink = '#20202a';
  const dark = shade(outfit, -50), light = shade(outfit, 55);
  const out: Px[] = [];
  const r = (x: number, y: number, w: number, hh: number, c: string) => out.push({ x, y, w, h: hh, c });

  // capa (atrás do corpo): Elite e Campeão
  if (role === 'champion') r(1, 10, 14, 12, '#b02838');
  else if (role === 'elite') r(2, 10, 12, 11, dark);
  // cabelo atrás (comprido)
  if (style === 2 || female) r(3, 3, 10, 9, hair);
  // pernas e sapatos
  const pants = role === 'trainer' ? '#4a5470' : shade(outfit, -80);
  r(4, 18, 3, 4, pants); r(9, 18, 3, 4, pants);
  r(3, 22, 4, 1, ink); r(9, 22, 4, 1, ink);
  // tronco
  r(3, 11, 10, 7, outfit);
  r(6, 11, 4, 2, light);
  r(3, 16, 10, 1, dark);
  if (role === 'leader' || role === 'captain') r(7, 13, 2, 2, '#f8f4e4'); // emblema
  if (role === 'elite') { r(3, 11, 2, 7, dark); r(11, 11, 2, 7, dark); }
  if (role === 'champion') { r(5, 12, 6, 1, '#f8d030'); r(7, 14, 2, 2, '#f8d030'); }
  // braços
  r(1, 11, 2, 6, outfit); r(13, 11, 2, 6, outfit);
  r(1, 17, 2, 2, skin); r(13, 17, 2, 2, skin);
  // pescoço e rosto
  r(7, 10, 2, 1, shade(skin, -25));
  r(4, 4, 8, 6, skin);
  // olhos e boca
  r(6, 6, 1, 2, ink); r(9, 6, 1, 2, ink);
  r(7, 8, 2, 1, shade(skin, -55));
  if (female) { r(5, 8, 1, 1, shade(skin, 20)); r(10, 8, 1, 1, shade(skin, 20)); }
  // cabelo / franja
  r(3, 2, 10, 2, hair); r(3, 4, 1, 3, hair); r(12, 4, 1, 3, hair);
  if (style === 1) { r(4, 1, 2, 1, hair); r(7, 0, 2, 2, hair); r(10, 1, 2, 1, hair); }
  if (style === 0 && !female) r(4, 4, 3, 1, hair);
  if (style === 2 || female) { r(3, 7, 1, 5, hair); r(12, 7, 1, 5, hair); }
  // chapéu / coroa
  if (hat) { r(3, 1, 10, 2, outfit); r(3, 3, 11, 1, dark); }
  if (role === 'champion') { r(4, 0, 8, 2, '#f8d030'); r(4, 0, 1, 1, '#fff4b0'); r(7, 0, 2, 1, '#fff4b0'); r(11, 0, 1, 1, '#fff4b0'); }
  if (role === 'cup') r(4, 0, 8, 2, '#c8d0d8');
  return out;
}

interface Props { name: string; title?: string; size?: number; role?: TrainerRole; className?: string }

export function TrainerSprite({ name, title, size = 96, role, className }: Props) {
  const kind = role ?? roleOf(title);
  const pixels = useMemo(() => trainerPixels(name, kind), [name, kind]);
  return (
    <svg className={`gb-trainer ${className ?? ''}`} viewBox="0 0 16 23" width={size * (16 / 23)} height={size} role="img" aria-label={title ? `${title} ${name}` : name} shapeRendering="crispEdges">
      {pixels.map((p, i) => <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} fill={p.c} />)}
    </svg>
  );
}
