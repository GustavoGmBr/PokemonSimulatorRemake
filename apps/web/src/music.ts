import { useEffect } from 'react';
import { getSettings, useSettings } from './settings.ts';

/**
 * Trilha sonora gerada na hora (WebAudio, sem arquivos): melodia, baixo e percussão em loop.
 * Cada tela pede uma faixa com useMusic(); a mais recente que estiver montada é a que toca.
 */
export type Track = 'menu' | 'wild' | 'battle' | 'gym' | 'casino' | 'shop';

interface Song {
  bpm: number;
  /** nota raiz (MIDI) */
  root: number;
  /** semitons acima da raiz por passo de 1/8; null = pausa */
  lead: (number | null)[];
  bass: (number | null)[];
  wave: OscillatorType;
  drums: boolean;
}

const N = null;
const SONGS: Record<Track, Song> = {
  menu: { bpm: 84, root: 60, wave: 'triangle', drums: false,
    lead: [0, N, 4, N, 7, N, 4, N, 5, N, 9, N, 7, N, N, N, 4, N, 7, N, 12, N, 9, N, 7, N, 4, N, 2, N, N, N],
    bass: [-24, N, N, N, -17, N, N, N, -19, N, N, N, -12, N, N, N, -24, N, N, N, -17, N, N, N, -19, N, N, N, -14, N, N, N] },
  wild: { bpm: 126, root: 62, wave: 'square', drums: true,
    lead: [0, 2, 4, N, 7, N, 4, 2, 0, N, 4, N, 9, N, 7, N, 5, 7, 9, N, 12, N, 9, 7, 5, N, 4, N, 2, N, 0, N],
    bass: [-24, N, -24, N, -17, N, -17, N, -19, N, -19, N, -12, N, -12, N, -24, N, -24, N, -17, N, -17, N, -19, N, -14, N, -12, N, -14, N] },
  battle: { bpm: 156, root: 57, wave: 'square', drums: true,
    lead: [0, 0, 3, 0, 5, 3, 0, N, 7, 7, 10, 7, 12, 10, 7, N, 8, 8, 12, 8, 13, 12, 8, N, 7, 5, 3, 5, 7, N, N, N],
    bass: [-24, -24, N, -24, -24, N, -21, N, -22, -22, N, -22, -22, N, -19, N, -20, -20, N, -20, -20, N, -17, N, -19, -19, N, -19, -17, N, -19, N] },
  gym: { bpm: 168, root: 55, wave: 'sawtooth', drums: true,
    lead: [0, N, 0, 3, 7, N, 12, N, 10, N, 7, N, 3, N, 7, N, 8, N, 8, 12, 15, N, 12, N, 10, N, 8, N, 7, 5, 3, N],
    bass: [-24, -24, -12, -24, -24, -12, -24, -12, -22, -22, -10, -22, -22, -10, -22, -10, -20, -20, -8, -20, -20, -8, -19, -7, -19, -19, -7, -19, -17, -5, -19, N] },
  casino: { bpm: 132, root: 64, wave: 'square', drums: true,
    lead: [0, N, 4, 7, N, 4, 0, N, 5, N, 9, 12, N, 9, 5, N, 7, N, 11, 14, N, 11, 7, N, 4, 5, 7, N, 4, 2, 0, N],
    bass: [-24, N, -12, N, -24, N, -12, N, -19, N, -7, N, -19, N, -7, N, -17, N, -5, N, -17, N, -5, N, -24, N, -12, N, -19, N, -12, N] },
  shop: { bpm: 100, root: 65, wave: 'triangle', drums: false,
    lead: [0, 4, 7, N, 12, N, 7, 4, 2, 5, 9, N, 14, N, 9, 5, 4, 7, 11, N, 12, N, 7, N, 5, N, 4, N, 0, N, N, N],
    bass: [-24, N, N, -17, N, N, -19, N, -21, N, N, -14, N, N, -16, N, -24, N, N, -17, N, N, -19, N, -17, N, -19, N, -24, N, N, N] },
};

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let timer: number | null = null;
let playing: Track | null = null;
let step = 0;
let nextTime = 0;
let unlocked = false;

function ensure(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (!master) { master = ctx.createGain(); master.connect(ctx.destination); }
    if (!noise) {
      noise = ctx.createBuffer(1, ctx.sampleRate / 4, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    return ctx;
  } catch { return null; }
}

function note(c: AudioContext, freq: number, at: number, len: number, type: OscillatorType, vol: number) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type; osc.frequency.value = freq;
  gain.gain.setValueAtTime(vol, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + len);
  osc.connect(gain).connect(master!);
  osc.start(at); osc.stop(at + len + 0.02);
}

function hat(c: AudioContext, at: number, vol: number, len: number) {
  const src = c.createBufferSource();
  const gain = c.createGain();
  src.buffer = noise;
  gain.gain.setValueAtTime(vol, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + len);
  src.connect(gain).connect(master!);
  src.start(at); src.stop(at + len + 0.02);
}

function schedule() {
  const c = ctx; const song = playing ? SONGS[playing] : null;
  if (!c || !song || !master) return;
  const eighth = 60 / song.bpm / 2;
  while (nextTime < c.currentTime + 0.4) {
    const i = step % song.lead.length;
    const lead = song.lead[i]; const bass = song.bass[i % song.bass.length];
    if (lead !== null && lead !== undefined) note(c, hz(song.root + lead), nextTime, eighth * 1.6, song.wave, 0.5);
    if (bass !== null && bass !== undefined) note(c, hz(song.root + bass), nextTime, eighth * 1.8, 'triangle', 0.8);
    if (song.drums) {
      if (i % 2 === 0) hat(c, nextTime, i % 4 === 0 ? 0.5 : 0.22, 0.04);
      if (i % 8 === 4) hat(c, nextTime, 0.7, 0.11); // caixa
      if (i % 8 === 0) note(c, 70, nextTime, 0.12, 'sine', 1); // bumbo
    }
    nextTime += eighth;
    step += 1;
  }
}

function volumeNow(): number { return getSettings().music * 0.018; }

function stop() {
  if (timer !== null) { window.clearInterval(timer); timer = null; }
  if (master && ctx) master.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
  playing = null;
}

function start(track: Track) {
  const c = ensure();
  if (!c || !master) return;
  if (c.state === 'suspended') void c.resume();
  if (playing === track && timer !== null) { master.gain.setTargetAtTime(volumeNow(), c.currentTime, 0.1); return; }
  playing = track; step = 0; nextTime = c.currentTime + 0.12;
  master.gain.cancelScheduledValues(c.currentTime);
  master.gain.setValueAtTime(0, c.currentTime);
  master.gain.linearRampToValueAtTime(volumeNow(), c.currentTime + 0.4);
  if (timer !== null) window.clearInterval(timer);
  timer = window.setInterval(schedule, 120);
}

const stack: { id: number; track: Track }[] = [];
let counter = 0;

/** Aplica a faixa do topo da pilha (ou silêncio), respeitando o volume de música e o desbloqueio do navegador. */
export function refreshMusic(): void {
  const top = stack[stack.length - 1];
  if (!top || getSettings().music === 0 || !unlocked) { stop(); return; }
  start(top.track);
}

if (typeof window !== 'undefined') {
  const unlock = () => { unlocked = true; refreshMusic(); };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend(); else void ctx.resume();
  });
}

/** Pede a faixa enquanto o componente estiver montado. */
export function useMusic(track: Track | null): void {
  const settingsKey = useSettings().music;
  useEffect(() => {
    if (!track) return undefined;
    const id = (counter += 1);
    stack.push({ id, track });
    refreshMusic();
    return () => {
      const at = stack.findIndex((s) => s.id === id);
      if (at >= 0) stack.splice(at, 1);
      refreshMusic();
    };
  }, [track]);
  useEffect(() => { refreshMusic(); }, [settingsKey]);
}
