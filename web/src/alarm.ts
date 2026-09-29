import { useSyncExternalStore } from 'react';

/*
 * Sounds made in the browser (Web Audio), so nothing is downloaded and they work offline:
 * - The focus timer's alarm: four real alarm sounds, a volume, and how long it rings (it can ring until stopped).
 * - Ambient sounds for focus (white, pink and brown noise, rain, waves, a fan), mixed with their own volumes.
 *   They keep playing while you move around the dashboard.
 */
export type AlarmSound = 'classic' | 'digital' | 'bell' | 'chime';
export interface AlarmSettings { sound: AlarmSound; volume: number; ring: number }
export const ALARM_SOUNDS: [AlarmSound, string][] = [['classic', 'Alarm clock'], ['digital', 'Digital watch'], ['bell', 'Bell'], ['chime', 'Soft chime']];
export const RING_FOR: [number, string][] = [[4, 'Once'], [15, '15 seconds'], [30, '30 seconds'], [120, 'Until I stop it']];
const KEY = 'jhino-alarm';

let ctx: AudioContext | null = null;
const ac = () => { if (!ctx) ctx = new AudioContext(); if (ctx.state === 'suspended') void ctx.resume(); return ctx; };

const state = {
  settings: ((): AlarmSettings => { try { return { sound: 'classic', volume: 0.7, ring: 15, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { sound: 'classic', volume: 0.7, ring: 15 }; } })(),
  ringing: false,
  ambient: {} as Record<string, number>,
};
let snap = { ...state, ambient: { ...state.ambient } };
const subs = new Set<() => void>();
const emit = () => { snap = { ...state, ambient: { ...state.ambient } }; subs.forEach((f) => f()); };
export const useSounds = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => snap);

/* ---------- alarm ---------- */
function tone(c: AudioContext, out: AudioNode, at: number, freq: number, len: number, type: OscillatorType, vol: number, decay = false) {
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.008);
  if (decay) g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  else { g.gain.setValueAtTime(vol, at + len - 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + len); }
  o.connect(g).connect(out); o.start(at); o.stop(at + len + 0.02);
}
/** One round of the sound, starting at `at`; returns how long the round lasts. */
function round(c: AudioContext, out: AudioNode, sound: AlarmSound, at: number) {
  if (sound === 'classic') { for (let i = 0; i < 4; i++) tone(c, out, at + i * 0.14, 1050, 0.08, 'square', 0.35); return 1.0; }
  if (sound === 'digital') { tone(c, out, at, 2100, 0.07, 'square', 0.25); tone(c, out, at + 0.13, 2100, 0.07, 'square', 0.25); return 0.9; }
  if (sound === 'bell') { [523.25, 1046.5, 1568, 2093].forEach((f, i) => tone(c, out, at, f, 2.4 - i * 0.4, 'sine', 0.5 / (i + 1), true)); return 2.2; }
  [1046.5, 1318.5, 1568].forEach((f, i) => tone(c, out, at + i * 0.22, f, 1.4, 'triangle', 0.35, true));
  return 2.0;
}
let alarmOut: GainNode | null = null;
let alarmTimer: ReturnType<typeof setTimeout> | undefined;
export function stopAlarm() {
  clearTimeout(alarmTimer);
  if (alarmOut) { try { alarmOut.gain.setTargetAtTime(0, ac().currentTime, 0.03); const o = alarmOut; setTimeout(() => o.disconnect(), 300); } catch { /* closed */ } alarmOut = null; }
  if (state.ringing) { state.ringing = false; emit(); }
}
export function ringAlarm(test?: Partial<AlarmSettings>) {
  stopAlarm();
  let c: AudioContext;
  try { c = ac(); } catch { return; }
  const s = { ...state.settings, ...test };
  const out = c.createGain(); out.gain.value = Math.max(0.02, Math.min(1, s.volume)); out.connect(c.destination); alarmOut = out;
  const until = c.currentTime + (test ? 2.5 : s.ring);
  let t = c.currentTime + 0.05;
  while (t < until) t += round(c, out, s.sound, t) + (s.sound === 'classic' || s.sound === 'digital' ? 0 : 0.3);
  state.ringing = true; emit();
  alarmTimer = setTimeout(stopAlarm, (t - c.currentTime) * 1000 + 200);
}
export function setAlarm(p: Partial<AlarmSettings>) {
  state.settings = { ...state.settings, ...p };
  try { localStorage.setItem(KEY, JSON.stringify(state.settings)); } catch { /* private mode */ }
  emit();
}

/* ---------- ambient sounds ---------- */
export const AMBIENT: [string, string][] = [['rain', 'Rain'], ['waves', 'Ocean waves'], ['fan', 'Fan'], ['brown', 'Brown noise'], ['pink', 'Pink noise'], ['white', 'White noise']];
const chans: Record<string, { gain: GainNode; stop: () => void }> = {};
function noise(c: AudioContext, kind: 'white' | 'pink' | 'brown') {
  const len = c.sampleRate * 4, buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w * 0.5;
      else if (kind === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898; d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    }
  }
  const src = c.createBufferSource(); src.buffer = buf; src.loop = true; return src;
}
function startAmbient(key: string, vol: number) {
  const c = ac(), out = c.createGain(); out.gain.value = 0; out.connect(c.destination);
  out.gain.setTargetAtTime(vol, c.currentTime, 0.4);
  const nodes: AudioScheduledSourceNode[] = [];
  if (key === 'rain') {
    const n = noise(c, 'pink'), hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000; n.connect(hp).connect(lp).connect(out); nodes.push(n);
    const n2 = noise(c, 'brown'), g2 = c.createGain(); g2.gain.value = 0.5; n2.connect(g2).connect(out); nodes.push(n2);
  } else if (key === 'waves') {
    const n = noise(c, 'brown'), g = c.createGain(); g.gain.value = 0.5;
    const lfo = c.createOscillator(), depth = c.createGain(); lfo.frequency.value = 0.09; depth.gain.value = 0.45; lfo.connect(depth).connect(g.gain);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; n.connect(lp).connect(g).connect(out); nodes.push(n, lfo);
  } else if (key === 'fan') {
    const n = noise(c, 'brown'), lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.7;
    const hum = c.createOscillator(), hg = c.createGain(); hum.frequency.value = 58; hg.gain.value = 0.03; hum.connect(hg).connect(out);
    n.connect(lp).connect(out); nodes.push(n, hum);
  } else { const n = noise(c, key as 'white' | 'pink' | 'brown'); n.connect(out); nodes.push(n); }
  nodes.forEach((x) => x.start());
  chans[key] = { gain: out, stop: () => { out.gain.setTargetAtTime(0, c.currentTime, 0.2); setTimeout(() => { nodes.forEach((x) => { try { x.stop(); } catch { /* stopped */ } }); out.disconnect(); }, 900); } };
}
/** 0 turns a sound off. */
export function setAmbient(key: string, vol: number) {
  try {
    if (vol <= 0) { chans[key]?.stop(); delete chans[key]; delete state.ambient[key]; }
    else if (chans[key]) { chans[key].gain.gain.setTargetAtTime(vol, ac().currentTime, 0.1); state.ambient[key] = vol; }
    else { startAmbient(key, vol); state.ambient[key] = vol; }
  } catch { /* no audio */ }
  emit();
}
export const stopAllAmbient = () => Object.keys(chans).forEach((k) => setAmbient(k, 0));
