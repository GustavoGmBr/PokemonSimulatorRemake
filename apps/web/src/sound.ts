import { getSettings } from './settings.ts';

/** Efeitos sonoros curtos gerados na hora (WebAudio) — sem arquivos para baixar. */
export type Sfx = 'move' | 'confirm' | 'back' | 'error' | 'save' | 'hit' | 'super' | 'weak' | 'faint' | 'levelup' | 'miss' | 'heal';

const TONES: Record<Sfx, { freq: number[]; ms: number; type: OscillatorType }> = {
  move: { freq: [660], ms: 35, type: 'square' },
  confirm: { freq: [880, 1175], ms: 60, type: 'square' },
  back: { freq: [440, 330], ms: 60, type: 'square' },
  error: { freq: [200, 160], ms: 90, type: 'sawtooth' },
  save: { freq: [660, 880, 1320], ms: 70, type: 'square' },
  hit: { freq: [180, 120], ms: 60, type: 'sawtooth' },
  super: { freq: [300, 220, 160, 110], ms: 55, type: 'sawtooth' },
  weak: { freq: [140, 120], ms: 70, type: 'triangle' },
  faint: { freq: [330, 247, 185, 123], ms: 110, type: 'square' },
  levelup: { freq: [523, 659, 784, 1047], ms: 85, type: 'square' },
  miss: { freq: [420, 330], ms: 50, type: 'triangle' },
  heal: { freq: [660, 784, 988], ms: 60, type: 'triangle' },
};

let context: AudioContext | null = null;

export function playSound(sfx: Sfx): void {
  const { volume } = getSettings();
  if (volume === 0) return;
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume();
    const tone = TONES[sfx];
    const gainValue = 0.025 * volume;
    let start = context.currentTime;
    for (const freq of tone.freq) {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = tone.type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(gainValue, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.ms / 1000);
      osc.connect(gain).connect(context.destination);
      osc.start(start);
      osc.stop(start + tone.ms / 1000);
      start += tone.ms / 1000;
    }
  } catch {
    /* sem áudio disponível: o jogo segue mudo */
  }
}
