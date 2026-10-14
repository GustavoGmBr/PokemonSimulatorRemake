import { getSettings } from './settings.ts';

/** Efeitos sonoros curtos gerados na hora (WebAudio) — sem arquivos para baixar. */
export type Sfx = 'move' | 'confirm' | 'back' | 'error' | 'save';

const TONES: Record<Sfx, { freq: number[]; ms: number; type: OscillatorType }> = {
  move: { freq: [660], ms: 35, type: 'square' },
  confirm: { freq: [880, 1175], ms: 60, type: 'square' },
  back: { freq: [440, 330], ms: 60, type: 'square' },
  error: { freq: [200, 160], ms: 90, type: 'sawtooth' },
  save: { freq: [660, 880, 1320], ms: 70, type: 'square' },
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
