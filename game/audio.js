// Every sound is synthesized. The opening is as quiet as a chess site (wooden clicks, a soft chime); after the
// awakening a war drum keeps Black's clock, and a low score swells under the waves and the dragon.

let ctx = null;
let master = null;
let musicGain = null;
let sfxGain = null;
let noiseBuf = null;
let started = false;

export function startAudio() {
  if (started) {
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    ctx = new AC();
  } catch {
    return;
  }
  started = true;
  master = ctx.createGain();
  master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  master.connect(comp).connect(ctx.destination);
  sfxGain = ctx.createGain();
  sfxGain.connect(master);
  musicGain = ctx.createGain();
  musicGain.gain.value = 0;
  musicGain.connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  scheduleMusic();
}

const ok = () => ctx && ctx.state === 'running';

function env(g, t, a, peak, decay) {
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + decay);
}

function tone(freq, { type = 'sine', at = 0, dur = 0.2, vol = 0.3, attack = 0.005, slide = 0, out = sfxGain } = {}) {
  if (!ok()) return;
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
  env(g, t, attack, vol, dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + attack + dur + 0.05);
}

function noise({ at = 0, dur = 0.1, vol = 0.3, freq = 1200, q = 1, type = 'bandpass', sweep = 0, out = sfxGain } = {}) {
  if (!ok()) return;
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  env(g, t, 0.003, vol, dur);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}

// A short rate limit per sound, so a hundred captures in one tick don't make a hundred clicks.
const last = {};
function gate(name, gap) {
  const now = performance.now();
  if (last[name] && now - last[name] < gap) return false;
  last[name] = now;
  return true;
}

export const sfx = {
  move() {
    if (!gate('move', 40)) return;
    noise({ dur: 0.045, vol: 0.5, freq: 1700, q: 2.2 });
    tone(220, { dur: 0.06, vol: 0.18, slide: 0.7 });
  },
  capture() {
    if (!gate('cap', 50)) return;
    noise({ dur: 0.05, vol: 0.55, freq: 2400, q: 2 });
    noise({ at: 0.05, dur: 0.06, vol: 0.45, freq: 1500, q: 2 });
    tone(160, { at: 0.04, dur: 0.08, vol: 0.2, slide: 0.6 });
  },
  castle() {
    noise({ dur: 0.05, vol: 0.45, freq: 1700, q: 2 });
    noise({ at: 0.12, dur: 0.05, vol: 0.45, freq: 1500, q: 2 });
  },
  check() {
    if (!gate('check', 400)) return;
    tone(880, { dur: 0.12, vol: 0.18, type: 'triangle' });
    tone(1175, { at: 0.1, dur: 0.18, vol: 0.16, type: 'triangle' });
  },
  start() {
    tone(523, { dur: 0.15, vol: 0.16, type: 'triangle' });
    tone(784, { at: 0.12, dur: 0.25, vol: 0.16, type: 'triangle' });
  },
  illegal() {
    if (!gate('ill', 150)) return;
    tone(140, { dur: 0.12, vol: 0.14, type: 'square', slide: 0.8 });
  },
  select() {
    if (!gate('sel', 40)) return;
    tone(1400, { dur: 0.03, vol: 0.06, type: 'triangle' });
  },
  order() {
    if (!gate('ord', 60)) return;
    tone(660, { dur: 0.05, vol: 0.08, type: 'triangle' });
    tone(990, { at: 0.05, dur: 0.06, vol: 0.07, type: 'triangle' });
  },
  tick(n = 1) {
    // Black moves: a war drum, heavier with more pieces moving.
    if (!gate('tick', 300)) return;
    const v = Math.min(0.75, 0.35 + n * 0.01);
    tone(78, { dur: 0.35, vol: v, slide: 0.45 });
    noise({ dur: 0.18, vol: v * 0.6, freq: 260, q: 0.7, type: 'lowpass' });
    noise({ at: 0.02, dur: 0.09, vol: 0.25, freq: 1800, q: 1.5 });
  },
  clockTick() {
    if (!gate('ct', 600)) return;
    noise({ dur: 0.02, vol: 0.12, freq: 3200, q: 4 });
  },
  lost() {
    if (!gate('lost', 70)) return;
    noise({ dur: 0.09, vol: 0.4, freq: 900, q: 1.2, sweep: 0.4 });
    tone(110, { dur: 0.12, vol: 0.18, slide: 0.5 });
  },
  shatter() {
    if (!gate('shat', 60)) return;
    noise({ dur: 0.16, vol: 0.4, freq: 4200, q: 0.8, sweep: 0.5 });
    noise({ at: 0.03, dur: 0.12, vol: 0.3, freq: 2400, q: 3 });
  },
  hit() {
    if (!gate('hit', 45)) return;
    tone(420 + Math.random() * 80, { dur: 0.09, vol: 0.18, type: 'square', slide: 0.5 });
    noise({ dur: 0.05, vol: 0.35, freq: 3000, q: 1.5 });
  },
  breakPart() {
    if (!gate('brk', 80)) return;
    noise({ dur: 0.35, vol: 0.6, freq: 1800, q: 0.6, sweep: 0.25 });
    tone(90, { dur: 0.4, vol: 0.4, slide: 0.4 });
  },
  summon() {
    if (!gate('sum', 300)) return;
    noise({ dur: 0.9, vol: 0.32, freq: 300, q: 0.8, sweep: 6 });
    tone(110, { dur: 0.6, vol: 0.12, type: 'sawtooth', slide: 2 });
  },
  land() {
    if (!gate('land', 120)) return;
    tone(70, { dur: 0.2, vol: 0.35, slide: 0.6 });
    noise({ dur: 0.1, vol: 0.25, freq: 500, q: 0.8, type: 'lowpass' });
  },
  warn() {
    if (!gate('warn', 250)) return;
    tone(330, { dur: 0.16, vol: 0.12, type: 'sawtooth' });
    tone(311, { at: 0.18, dur: 0.2, vol: 0.12, type: 'sawtooth' });
  },
  boom(big = 1) {
    if (!gate('boom', 90)) return;
    tone(55, { dur: 0.5 * big, vol: 0.6, slide: 0.5 });
    noise({ dur: 0.45 * big, vol: 0.55, freq: 1600, q: 0.6, type: 'lowpass', sweep: 0.15 });
  },
  rake() {
    noise({ dur: 0.7, vol: 0.5, freq: 600, q: 0.9, sweep: 4 });
    tone(65, { dur: 0.6, vol: 0.45, slide: 0.5 });
  },
  zap() {
    if (!gate('zap', 90)) return;
    tone(1800, { dur: 0.25, vol: 0.12, type: 'sawtooth', slide: 0.2 });
    noise({ dur: 0.2, vol: 0.25, freq: 5000, q: 1 });
  },
  roar() {
    if (!ok()) return;
    const t = ctx.currentTime;
    for (const [f, d] of [[55, 0], [58, 0.01], [82, 0.03]]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * 1.4, t + d);
      o.frequency.exponentialRampToValueAtTime(f, t + 1.6);
      const flt = ctx.createBiquadFilter();
      flt.type = 'lowpass';
      flt.frequency.setValueAtTime(300, t);
      flt.frequency.linearRampToValueAtTime(1400, t + 0.4);
      flt.frequency.linearRampToValueAtTime(200, t + 1.9);
      const g = ctx.createGain();
      env(g, t + d, 0.12, 0.28, 1.8);
      o.connect(flt).connect(g).connect(sfxGain);
      o.start(t + d);
      o.stop(t + 2.2);
    }
    noise({ dur: 1.6, vol: 0.35, freq: 700, q: 0.5, sweep: 0.3 });
  },
  heartbeat() {
    tone(60, { dur: 0.12, vol: 0.5, slide: 0.7 });
    tone(55, { at: 0.22, dur: 0.16, vol: 0.4, slide: 0.7 });
  },
  rumble() {
    noise({ dur: 2.4, vol: 0.4, freq: 120, q: 0.6, type: 'lowpass', sweep: 1.5 });
    tone(40, { dur: 2.2, vol: 0.4, slide: 1.3, attack: 0.4 });
  },
  wave() {
    for (const [f, d] of [[146.8, 0], [220, 0.02], [293.7, 0.04]]) tone(f, { at: d, dur: 1.1, vol: 0.13, type: 'sawtooth', attack: 0.08 });
    tone(73.4, { dur: 1.2, vol: 0.3, attack: 0.05 });
  },
  clear() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, { at: i * 0.09, dur: 0.3, vol: 0.12, type: 'triangle' }));
  },
  promote() {
    [660, 880, 1320].forEach((f, i) => tone(f, { at: i * 0.07, dur: 0.18, vol: 0.12, type: 'triangle' }));
  },
  victory() {
    const notes = [392, 523, 659, 784, 1047, 784, 1047, 1319];
    notes.forEach((f, i) => tone(f, { at: i * 0.13, dur: 0.45, vol: 0.14, type: 'triangle' }));
    tone(130.8, { dur: 2.2, vol: 0.3, attack: 0.1 });
  },
  defeat() {
    [392, 349, 311, 262].forEach((f, i) => tone(f, { at: i * 0.28, dur: 0.6, vol: 0.12, type: 'triangle' }));
    tone(65, { dur: 1.8, vol: 0.3 });
  },
  ui() {
    if (!gate('ui', 40)) return;
    tone(900, { dur: 0.03, vol: 0.06, type: 'triangle' });
  },
};

// ---------------------------------------------------------------- music

let mode = 'none'; // 'none' | 'calm' | 'war' | 'boss'
let nextBeat = 0;
let beat = 0;
let timer = 0;

export function setMusic(next) {
  if (next === mode) return;
  mode = next;
  if (!ok()) return;
  const t = ctx.currentTime;
  const target = { none: 0.0001, calm: 0.45, war: 0.7, boss: 0.8 }[mode] ?? 0.0001;
  musicGain.gain.cancelScheduledValues(t);
  musicGain.gain.setValueAtTime(Math.max(0.0001, musicGain.gain.value), t);
  musicGain.gain.exponentialRampToValueAtTime(target, t + 1.5);
}

export function duck(on) {
  if (!ok()) return;
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(on ? 0.35 : 0.9, t, 0.2);
}

// D minor: i - VI - III - VII, a bar each.
const CHORDS = [[146.8, 174.6, 220], [116.5, 146.8, 174.6], [174.6, 220, 261.6], [130.8, 164.8, 196]];
const BASS = [73.4, 58.3, 87.3, 65.4];

function scheduleMusic() {
  clearInterval(timer);
  timer = setInterval(() => {
    if (!ok()) return;
    const bpm = mode === 'boss' ? 132 : 112;
    const step = 60 / bpm / 2; // eighth notes
    if (nextBeat < ctx.currentTime) nextBeat = ctx.currentTime + 0.05;
    while (nextBeat < ctx.currentTime + 0.25) {
      if (mode !== 'none') playStep(beat, nextBeat, step);
      beat = (beat + 1) % 64;
      nextBeat += step;
    }
  }, 60);
}

function playStep(b, t, step) {
  const bar = Math.floor(b / 8) % 4;
  const at = t - ctx.currentTime;
  const war = mode === 'war' || mode === 'boss';
  // Pad: a chord at the top of each bar.
  if (b % 8 === 0) {
    for (const f of CHORDS[bar]) tone(f, { at, dur: step * 8, vol: 0.035, type: 'sawtooth', attack: 0.4, out: musicGain });
  }
  // Bass ostinato.
  if (war && b % 2 === 0) tone(BASS[bar] * (b % 4 === 2 ? 2 : 1), { at, dur: step * 1.6, vol: 0.12, type: 'triangle', out: musicGain });
  else if (!war && b % 8 === 0) tone(BASS[bar], { at, dur: step * 7, vol: 0.1, type: 'triangle', attack: 0.3, out: musicGain });
  // Drums: timpani on 1 and the "and" of 3, a snare-ish hit on 2 and 4.
  if (war) {
    if (b % 8 === 0 || b % 8 === 5) tone(65, { at, dur: 0.28, vol: 0.3, slide: 0.55, out: musicGain });
    if (b % 4 === 2) noise({ at, dur: 0.12, vol: 0.13, freq: 1900, q: 0.8, out: musicGain });
    if (mode === 'boss') noise({ at, dur: 0.03, vol: 0.05, freq: 7000, q: 1, out: musicGain });
  }
  // A brass-like call over the boss fight.
  if (mode === 'boss' && b % 32 === 0) {
    const root = CHORDS[bar][0] * 2;
    [1, 1.5, 1.335, 1.2].forEach((r, i) => tone(root * r, { at: at + i * step * 2, dur: step * 2.2, vol: 0.05, type: 'sawtooth', attack: 0.04, out: musicGain }));
  }
}
