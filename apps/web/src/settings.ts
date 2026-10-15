import { useSyncExternalStore } from 'react';

/** Preferências do jogador, guardadas no navegador (por aparelho, não por save). */
export type TextSpeed = 'slow' | 'normal' | 'fast' | 'instant';

/** Ações cujas teclas o jogador pode trocar (Enter e Esc continuam sempre valendo como Confirmar e Voltar). */
export type BindAction =
  | 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'prev' | 'next' | 'filter' | 'goto'
  | 'move1' | 'move2' | 'move3' | 'move4';
export type KeyBindings = Record<BindAction, string[]>;

export const BIND_ACTIONS: { id: BindAction; label: string }[] = [
  { id: 'up', label: 'Cima' }, { id: 'down', label: 'Baixo' }, { id: 'left', label: 'Esquerda' }, { id: 'right', label: 'Direita' },
  { id: 'confirm', label: 'Confirmar (A)' }, { id: 'back', label: 'Voltar (B)' },
  { id: 'prev', label: 'Anterior / Girar' }, { id: 'next', label: 'Próximo / Evoluir' },
  { id: 'filter', label: 'Buscar / Filtros' }, { id: 'goto', label: 'Ir para / Golpes' },
  { id: 'move1', label: 'Golpe 1 (batalha)' }, { id: 'move2', label: 'Golpe 2 (batalha)' },
  { id: 'move3', label: 'Golpe 3 (batalha)' }, { id: 'move4', label: 'Golpe 4 (batalha)' },
];

export const DEFAULT_KEYS: KeyBindings = {
  up: ['ArrowUp', 'w'], down: ['ArrowDown', 's'], left: ['ArrowLeft', 'a'], right: ['ArrowRight', 'd'],
  confirm: ['z', 'Enter', ' '], back: ['x', 'Escape', 'Backspace'],
  prev: ['q', 'PageUp'], next: ['e', 'PageDown'], filter: ['f'], goto: ['g'],
  move1: ['1'], move2: ['2'], move3: ['3'], move4: ['4'],
};

/** Nome amigável de uma tecla. */
export function keyLabel(key: string): string {
  const names: Record<string, string> = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ' ': 'Espaço', Escape: 'Esc', Backspace: '⌫', Enter: 'Enter',
    PageUp: 'PgUp', PageDown: 'PgDn',
  };
  return names[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}

export interface Settings {
  keys: KeyBindings;
  textSpeed: TextSpeed;
  /** 0 = mudo, 1–3 = volume dos efeitos */
  volume: 0 | 1 | 2 | 3;
  /** 0 = sem música, 1–3 = volume da trilha */
  music: 0 | 1 | 2 | 3;
  /** tema de cores e moldura ('' = clássico, ou o id de uma região) */
  theme: string;
  contrast: Contrast;
}

export type Contrast = 'normal' | 'dark' | 'high';
export const CONTRASTS: Contrast[] = ['normal', 'dark', 'high'];
export const CONTRAST_LABEL: Record<Contrast, string> = { normal: 'Normal', dark: 'Escuro', high: 'Alto contraste' };
export const THEMES: { id: string; label: string }[] = [
  { id: '', label: 'Clássico' }, { id: 'kanto', label: 'Kanto' }, { id: 'johto', label: 'Johto' }, { id: 'hoenn', label: 'Hoenn' },
  { id: 'sinnoh', label: 'Sinnoh' }, { id: 'unova', label: 'Unova' }, { id: 'kalos', label: 'Kalos' }, { id: 'alola', label: 'Alola' },
  { id: 'galar', label: 'Galar' }, { id: 'paldea', label: 'Paldea' },
];

export const TEXT_SPEED_CPS: Record<TextSpeed, number> = { slow: 30, normal: 60, fast: 120, instant: 100_000 };
export const TEXT_SPEED_LABEL: Record<TextSpeed, string> = { slow: 'Lenta', normal: 'Normal', fast: 'Rápida', instant: 'Instantânea' };
export const TEXT_SPEEDS: TextSpeed[] = ['slow', 'normal', 'fast', 'instant'];

const DEFAULTS: Settings = { keys: DEFAULT_KEYS, textSpeed: 'normal', volume: 2, music: 1, theme: '', contrast: 'normal' };
const STORAGE_KEY = 'pokesim.settings.v1';

function load(): Settings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const keys = { ...DEFAULT_KEYS };
    for (const action of BIND_ACTIONS) {
      const saved = parsed.keys?.[action.id];
      if (Array.isArray(saved) && saved.length > 0 && saved.every((k) => typeof k === 'string')) keys[action.id] = saved;
    }
    return {
      keys,
      textSpeed: TEXT_SPEEDS.includes(parsed.textSpeed as TextSpeed) ? (parsed.textSpeed as TextSpeed) : DEFAULTS.textSpeed,
      volume: [0, 1, 2, 3].includes(parsed.volume as number) ? (parsed.volume as Settings['volume']) : DEFAULTS.volume,
      music: [0, 1, 2, 3].includes(parsed.music as number) ? (parsed.music as Settings['music']) : DEFAULTS.music,
      theme: THEMES.some((t) => t.id === parsed.theme) ? (parsed.theme as string) : DEFAULTS.theme,
      contrast: CONTRASTS.includes(parsed.contrast as Contrast) ? (parsed.contrast as Contrast) : DEFAULTS.contrast,
    };
  } catch {
    return DEFAULTS; // armazenamento bloqueado: segue com o padrão
  }
}

let current: Settings = load();
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* sem armazenamento: vale só até fechar a aba */
  }
  listeners.forEach((listener) => listener());
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSettings,
    getSettings,
  );
}
