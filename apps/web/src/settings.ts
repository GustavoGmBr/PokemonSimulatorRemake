import { useSyncExternalStore } from 'react';

/** Preferências do jogador, guardadas no navegador (por aparelho, não por save). */
export type TextSpeed = 'slow' | 'normal' | 'fast' | 'instant';

export interface Settings {
  textSpeed: TextSpeed;
  /** 0 = mudo, 1–3 = volume dos efeitos */
  volume: 0 | 1 | 2 | 3;
}

export const TEXT_SPEED_CPS: Record<TextSpeed, number> = { slow: 30, normal: 60, fast: 120, instant: 100_000 };
export const TEXT_SPEED_LABEL: Record<TextSpeed, string> = { slow: 'Lenta', normal: 'Normal', fast: 'Rápida', instant: 'Instantânea' };
export const TEXT_SPEEDS: TextSpeed[] = ['slow', 'normal', 'fast', 'instant'];

const DEFAULTS: Settings = { textSpeed: 'normal', volume: 2 };
const STORAGE_KEY = 'pokesim.settings.v1';

function load(): Settings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      textSpeed: TEXT_SPEEDS.includes(parsed.textSpeed as TextSpeed) ? (parsed.textSpeed as TextSpeed) : DEFAULTS.textSpeed,
      volume: [0, 1, 2, 3].includes(parsed.volume as number) ? (parsed.volume as Settings['volume']) : DEFAULTS.volume,
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
