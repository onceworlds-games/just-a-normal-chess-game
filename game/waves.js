// Ten waves of black pieces. Each wave is a few summons ("bursts") a set time apart; later waves bring armour,
// elites, rifts at the board's edge, and the dragon practising the attacks it will use in the fight.

import { DIFFICULTY, playerScale } from './config.js';

// mix: pieces per burst. armour: hit points for those types. elite: one-off named pieces { k, hp, burst }.
// edge: false (all from the dragon), 'some' (every other burst from a rift), 'all'. shots: attacks it tries out.
export const WAVES = [
  { name: 'Pawn Storm', bursts: 4, every: 26, mix: { p: 6 }, near: [5, 8] },
  { name: 'Cavalry', bursts: 4, every: 26, mix: { p: 5, n: 2 }, near: [4, 7] },
  { name: 'The Clergy', bursts: 5, every: 26, mix: { p: 5, n: 1, b: 2 }, shots: ['rain'] },
  { name: 'The Towers', bursts: 5, every: 28, mix: { p: 5, n: 2, b: 1, r: 1 }, shots: ['rain', 'rake'] },
  { name: 'The Black Queen', bursts: 6, every: 28, mix: { p: 6, n: 2, b: 2, r: 1 }, elite: [{ k: 'q', hp: 4, burst: 1 }], shots: ['rake', 'rain'] },
  { name: 'Shield Wall', bursts: 6, every: 28, mix: { p: 7, b: 1, r: 2 }, armour: { p: 2 }, edge: 'some', shots: ['rake', 'sting'] },
  { name: 'Night Riders', bursts: 7, every: 28, mix: { p: 3, n: 6, b: 1 }, elite: [{ k: 'n', hp: 3, burst: 1 }, { k: 'n', hp: 3, burst: 4 }], edge: 'some', shots: ['sting', 'rain'] },
  { name: 'Rift Surge', bursts: 7, every: 30, mix: { p: 7, n: 2, b: 2, r: 2 }, edge: 'all', shots: ['rake', 'fork'] },
  { name: 'The Royal Guard', bursts: 8, every: 30, mix: { p: 5, b: 2, r: 2, q: 1 }, armour: { p: 2 }, elite: [{ k: 'r', hp: 3, burst: 0 }, { k: 'r', hp: 3, burst: 4 }], edge: 'some', shots: ['fork', 'rake', 'sting'] },
  { name: 'The Black Court', bursts: 9, every: 30, mix: { p: 7, n: 2, b: 2, r: 2, q: 1 }, armour: { r: 2 }, elite: [{ k: 'q', hp: 5, burst: 2 }, { k: 'q', hp: 5, burst: 6 }], edge: 'some', shots: ['rain', 'rake', 'fork', 'sting'] },
];

export const WAVE_COUNT = WAVES.length;

/**
 * The bursts of wave `n` (1-based) for this difficulty and number of players:
 * [{ at: seconds after the wave starts, pieces: [{ k, hp, elite }], edge: bool, near: [min, max] }].
 */
export function waveBursts(n, diffKey, players) {
  const wave = WAVES[n - 1];
  if (!wave) return [];
  const diff = DIFFICULTY[diffKey] ?? DIFFICULTY.normal;
  const scale = diff.enemies * playerScale(players);
  const out = [];
  for (let b = 0; b < wave.bursts; b++) {
    const pieces = [];
    for (const [k, base] of Object.entries(wave.mix)) {
      // Spread rounding across bursts so totals match base * scale * bursts.
      const total = base * scale * wave.bursts;
      const count = Math.floor((total * (b + 1)) / wave.bursts) - Math.floor((total * b) / wave.bursts);
      const hp = (wave.armour?.[k] ?? 1) + (diff.armour && (k === 'r' || k === 'q') ? 1 : 0);
      for (let i = 0; i < count; i++) pieces.push({ k, hp, elite: false });
    }
    for (const e of wave.elite ?? []) {
      if (e.burst === b) pieces.push({ k: e.k, hp: e.hp + (diff.armour ? 1 : 0), elite: true });
    }
    const edge = wave.edge === 'all' || (wave.edge === 'some' && b % 2 === 1);
    out.push({ at: 2 + b * wave.every, pieces, edge, near: wave.near ?? [4, 7] });
  }
  return out;
}

/** The attacks the dragon tries out during wave n: [{ at, kind }], one after each burst but the first. */
export function waveShots(n) {
  const wave = WAVES[n - 1];
  if (!wave?.shots?.length) return [];
  const out = [];
  for (let b = 1; b < wave.bursts; b++) out.push({ at: 2 + b * wave.every + 9, kind: wave.shots[(b - 1) % wave.shots.length] });
  return out;
}

/** Reinforcements each player gets when wave n is cleared. */
export function reinforcements(n) {
  const out = ['p', 'p'];
  if (n >= 2) out.push('n');
  if (n >= 4) out.push('b');
  if (n >= 6) out.push('r');
  if (n >= 9) out.push('q');
  return out;
}
