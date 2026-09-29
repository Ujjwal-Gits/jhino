import { useSyncExternalStore } from 'react';

/*
 * Sounds made in the browser (Web Audio), so nothing is downloaded and they work offline:
 * - The focus timer's alarm: four real alarm sounds, a volume, and how long it rings (it can ring until stopped).
 * - Ambient sounds for focus (rain, a storm, waves, a stream, birds, a fire, a fan and three noises), mixed with their own volumes.
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
// Natural sounds are rendered once (40 seconds, looped with a crossfade) from layers: rain is a hiss plus
// thousands of separate drops, waves are swells that build and break, a fire is a low roar with crackles
// and pops, a stream is water noise with bubbles, the forest is wind with birdsong. Plain noises and the fan
// are made live.
export const AMBIENT: [string, string][] = [
  ['rain', 'Rain'], ['storm', 'Thunderstorm'], ['waves', 'Ocean waves'], ['stream', 'Forest stream'], ['birds', 'Birds and breeze'],
  ['fire', 'Fireplace'], ['fan', 'Fan'], ['brown', 'Brown noise'], ['pink', 'Pink noise'], ['white', 'White noise'],
];
const chans: Record<string, { gain: GainNode; stop: () => void }> = {};
const rand = Math.random;
function pinkGen() {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  return () => {
    const w = rand() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898; const o = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926; return o;
  };
}
function brownGen() { let l = 0; return () => { l = (l + 0.02 * (rand() * 2 - 1)) / 1.02; return l * 3.5; }; }
const onePole = () => { let y = 0; return (x: number, k: number) => (y += (x - y) * k); };
type St = [Float32Array, Float32Array];
const panL = (p: number) => Math.cos(((p + 1) * Math.PI) / 4), panR = (p: number) => Math.sin(((p + 1) * Math.PI) / 4);

/** A short burst of filtered noise: a raindrop, a crackle, a splash. */
function burst(b: St, sr: number, at: number, dur: number, gain: number, bright: number, pan: number, decay = 5) {
  const n = Math.floor(dur * sr), i0 = Math.floor(at * sr), f = onePole(), gl = gain * panL(pan), gr = gain * panR(pan);
  for (let j = 0; j < n && i0 + j < b[0].length; j++) {
    const e = Math.exp((-decay * j) / n), x = f(rand() * 2 - 1, bright) * e;
    b[0][i0 + j] += x * gl; b[1][i0 + j] += x * gr;
  }
}
/** A sine that glides in pitch: a bird note, a water bubble. */
function glide(b: St, sr: number, at: number, dur: number, f0: number, f1: number, gain: number, pan: number, shape: 'arch' | 'decay', vib = 0) {
  const n = Math.floor(dur * sr), i0 = Math.floor(at * sr); let ph = 0;
  const gl = gain * panL(pan), gr = gain * panR(pan);
  for (let j = 0; j < n && i0 + j < b[0].length; j++) {
    const t = j / n, f = f0 + (f1 - f0) * (shape === 'decay' ? Math.sqrt(t) : t) + (vib ? Math.sin(j / sr * 2 * Math.PI * 28) * vib : 0);
    ph += (2 * Math.PI * f) / sr;
    const e = shape === 'arch' ? Math.sin(Math.PI * t) ** 2 : Math.exp(-6 * t) * Math.min(1, j / (sr * 0.002));
    const x = Math.sin(ph) * e;
    b[0][i0 + j] += x * gl; b[1][i0 + j] += x * gr;
  }
}
function rainLayer(b: St, sr: number, sec: number, heavy: number) {
  const n = b[0].length;
  for (let c = 0; c < 2; c++) {
    const pk = pinkGen(), low = onePole(), hp = onePole(), br = brownGen(), bl = onePole();
    for (let i = 0; i < n; i++) { const x = pk(); b[c][i] += (x - hp(x, 0.06)) * (0.16 + 0.12 * heavy) + low(x, 0.5) * 0.04 + bl(br(), 0.05) * 0.05 * heavy; }
  }
  const drops = Math.floor(sec * (55 + 90 * heavy));
  for (let k = 0; k < drops; k++) {
    const near = rand() ** 3;
    burst(b, sr, rand() * sec, 0.004 + near * 0.022, 0.02 + near * 0.32, 0.08 + rand() * 0.55, rand() * 2 - 1, 5 + rand() * 4);
  }
}
function render(kind: string, sr: number, sec: number): St {
  const n = Math.floor(sec * sr); const b: St = [new Float32Array(n), new Float32Array(n)];
  if (kind === 'rain') rainLayer(b, sr, sec, 0);
  else if (kind === 'storm') {
    rainLayer(b, sr, sec, 1);
    for (let t = 3 + rand() * 4; t < sec - 6; t += 11 + rand() * 9) {
      const len = 5 + rand() * 4, i0 = Math.floor(t * sr), m = Math.floor(len * sr), close = rand();
      for (let c = 0; c < 2; c++) {
        const br = brownGen(), lp1 = onePole(), lp2 = onePole(), hits = [0, 0.15 + rand() * 0.4, 0.6 + rand() * 1.2];
        for (let j = 0; j < m && i0 + j < n; j++) {
          const ts = j / sr; let e = 0;
          for (const h of hits) if (ts >= h) e += Math.exp(-(ts - h) / (0.8 + rand() * 0.002 + len / 5)) * (h ? 0.7 : 1);
          const crack = close > 0.6 && ts < 0.25 ? (rand() * 2 - 1) * (1 - ts / 0.25) * 0.5 : 0;
          b[c][i0 + j] += lp2(lp1(br(), 0.02), 0.05) * e * 0.45 + crack * 0.15;
        }
      }
    }
  } else if (kind === 'waves') {
    const env = new Float32Array(n);
    for (let t = rand() * 2; t < sec; t += 6.5 + rand() * 5) {
      const rise = 2.5 + rand() * 2, fall = 3.5 + rand() * 2.5, peak = 0.6 + rand() * 0.4;
      for (let j = 0, m = Math.floor((rise + fall) * sr), i0 = Math.floor(t * sr); j < m; j++) {
        const ts = j / sr, e = ts < rise ? peak * Math.sin((Math.PI / 2) * (ts / rise)) ** 3 : peak * Math.exp(-(ts - rise) / (fall / 3));
        const i = (i0 + j) % n; env[i] = Math.max(env[i], e);
      }
    }
    for (let c = 0; c < 2; c++) {
      const br = brownGen(), pk = pinkGen(), lp = onePole(), foam = onePole(), off = c ? Math.floor(sr * 0.35) : 0;
      for (let i = 0; i < n; i++) {
        const e = env[(i + off) % n];
        b[c][i] += lp(br(), 0.012 + 0.22 * e) * (0.18 + 0.9 * e) + (pk() - foam(pk(), 0.1)) * 0.22 * e * e;
      }
    }
  } else if (kind === 'stream') {
    for (let c = 0; c < 2; c++) {
      const bp1 = onePole(), bp2 = onePole(), mod = onePole();
      for (let i = 0; i < n; i++) { const w = rand() * 2 - 1, x = bp1(w, 0.35) - bp2(w, 0.04); const m = 0.6 + mod(rand() * 2 - 1, 0.002) * 12; b[c][i] += x * 0.22 * Math.max(0.2, m); }
    }
    for (let k = 0, cnt = Math.floor(sec * 38); k < cnt; k++) {
      const f0 = 350 + rand() ** 2 * 1300, d = 0.012 + rand() * 0.035;
      glide(b, sr, rand() * sec, d, f0, f0 * (1.6 + rand()), 0.02 + rand() ** 3 * 0.12, rand() * 1.6 - 0.8, 'decay');
    }
  } else if (kind === 'birds') {
    for (let c = 0; c < 2; c++) {
      const pk = pinkGen(), lp = onePole(), sway = 2 * Math.PI * (0.05 + c * 0.013);
      for (let i = 0; i < n; i++) b[c][i] += lp(pk(), 0.015) * (0.35 + 0.25 * Math.sin((i / sr) * sway + c)) * 0.9;
    }
    const species = Array.from({ length: 4 }, () => ({ f: 2200 + rand() * 2600, sweep: (rand() - 0.4) * 1800, note: 0.05 + rand() * 0.12, gap: 0.03 + rand() * 0.09, notes: 2 + Math.floor(rand() * 5), vib: rand() < 0.4 ? 60 + rand() * 120 : 0, pan: rand() * 1.8 - 0.9, gain: 0.04 + rand() * 0.08 }));
    for (let t = 0.5; t < sec - 2; t += 0.8 + rand() * 3.2) {
      const s = species[Math.floor(rand() * species.length)]; let at = t;
      for (let k = 0; k < s.notes; k++) { const f = s.f * (1 + (rand() - 0.5) * 0.08); glide(b, sr, at, s.note, f, f + s.sweep, s.gain, s.pan, 'arch', s.vib); at += s.note + s.gap; }
    }
  } else if (kind === 'fire') {
    for (let c = 0; c < 2; c++) {
      const br = brownGen(), lp = onePole(), mod = onePole();
      for (let i = 0; i < n; i++) b[c][i] += lp(br(), 0.03) * (0.5 + mod(rand() * 2 - 1, 0.0005) * 30) * 0.7;
    }
    for (let t = 0; t < sec; t += rand() * 0.18) {
      const cluster = rand() < 0.15 ? 3 + Math.floor(rand() * 6) : 1, pan = rand() * 1.6 - 0.8;
      for (let k = 0; k < cluster; k++) { const pop = rand() ** 5; burst(b, sr, t + k * rand() * 0.03, 0.0008 + pop * 0.012, 0.08 + pop * 0.9, pop > 0.3 ? 0.25 : 0.9, pan, 7); }
    }
  }
  return b;
}
/** Render, loop smoothly (the tail fades into the head), and bring every sound to a similar loudness. */
const cache: Record<string, AudioBuffer> = {};
async function natural(c: AudioContext, kind: string) {
  if (cache[kind]) return cache[kind];
  await new Promise((ok) => setTimeout(ok, 0));
  const sr = c.sampleRate, LEN = 40, FADE = 3, b = render(kind, sr, LEN + FADE), n = Math.floor(LEN * sr), f = Math.floor(FADE * sr);
  const out = c.createBuffer(2, n, sr);
  let sq = 0;
  const ch = [0, 1].map((k) => { const src = b[k], o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = i < f ? src[i] * (i / f) + src[n + i] * (1 - i / f) : src[i]; for (let i = 0; i < n; i += 7) sq += o[i] * o[i]; return o; });
  const rms = Math.sqrt(sq / ((n / 7) * 2)) || 1, g = 0.14 / rms;
  ch.forEach((o, k) => { for (let i = 0; i < n; i++) o[i] = Math.tanh(o[i] * g); out.copyToChannel(o, k); });
  return (cache[kind] = out);
}
function noise(c: AudioContext, kind: 'white' | 'pink' | 'brown') {
  const len = c.sampleRate * 4, buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch), g = kind === 'pink' ? pinkGen() : kind === 'brown' ? brownGen() : () => (rand() * 2 - 1) * 0.5; for (let i = 0; i < len; i++) d[i] = g(); }
  const src = c.createBufferSource(); src.buffer = buf; src.loop = true; return src;
}
async function startAmbient(key: string, vol: number) {
  const c = ac(), out = c.createGain(); out.gain.value = 0; out.connect(c.destination);
  const nodes: AudioScheduledSourceNode[] = [];
  chans[key] = { gain: out, stop: () => { out.gain.setTargetAtTime(0, c.currentTime, 0.25); setTimeout(() => { nodes.forEach((x) => { try { x.stop(); } catch { /* stopped */ } }); out.disconnect(); }, 1200); } };
  if (key === 'fan') {
    const n = noise(c, 'brown'), lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.7;
    const hum = c.createOscillator(), hg = c.createGain(); hum.frequency.value = 58; hg.gain.value = 0.03; hum.connect(hg).connect(out);
    n.connect(lp).connect(out); nodes.push(n, hum);
  } else if (key === 'white' || key === 'pink' || key === 'brown') { const n = noise(c, key); n.connect(out); nodes.push(n); }
  else {
    const buf = await natural(c, key);
    if (chans[key]?.gain !== out) return; // turned off while it was being made
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true; src.connect(out); nodes.push(src);
  }
  nodes.forEach((x) => x.start());
  out.gain.setTargetAtTime(vol, c.currentTime, 0.5);
}
/** 0 turns a sound off. */
export function setAmbient(key: string, vol: number) {
  try {
    if (vol <= 0) { chans[key]?.stop(); delete chans[key]; delete state.ambient[key]; }
    else if (chans[key]) { chans[key].gain.gain.setTargetAtTime(vol, ac().currentTime, 0.1); state.ambient[key] = vol; }
    else { state.ambient[key] = vol; void startAmbient(key, vol).catch(() => {}); }
  } catch { /* no audio */ }
  emit();
}
export const stopAllAmbient = () => Object.keys(chans).forEach((k) => setAmbient(k, 0));
