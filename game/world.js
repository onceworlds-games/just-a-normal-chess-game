// The battlefield hidden under the void: the rock ring round the throne, boulders, abandoned white squads waiting to be
// found, and a few black pieces asleep at the far edges. Deterministic from the match seed, so a new host rebuilds the
// same hidden pieces.

import { W, H, BOSS_X, BOSS_Y, KEEP_X, KEEP_Y, RING_R0, RING_R1, THRONE_R, START_BOUNDS } from './config.js';
import { rngFor } from './rng.js';

export const GEN_WHITE_ID = 50000;
export const GEN_BLACK_ID = 60000;

const inKeep = (x, y) => x >= KEEP_X - 2 && x <= KEEP_X + 9 && y >= KEEP_Y - 2 && y <= KEEP_Y + 9;
const nearThrone = (x, y, margin) => Math.hypot(x - BOSS_X, y - BOSS_Y) < RING_R1 + margin;
const inStart = (x, y) => x >= START_BOUNDS[0] && x <= START_BOUNDS[2] && y >= START_BOUNDS[1] && y <= START_BOUNDS[3];

export function isThrone(x, y) {
  return Math.hypot(x - BOSS_X, y - BOSS_Y) < THRONE_R;
}

export function isRing(x, y) {
  const d = Math.hypot(x - BOSS_X, y - BOSS_Y);
  return d >= RING_R0 && d < RING_R1;
}

/** { ring: [pos], rocks: [pos], white: [{ id, k, x, y }], black: [{ id, k, x, y }] } */
export function generate(seed) {
  const rng = rngFor(seed, 'world');
  const taken = new Uint8Array(W * H);
  const ring = [];
  const rocks = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (isRing(x, y)) {
        ring.push(y * W + x);
        taken[y * W + x] = 1;
      } else if (isThrone(x, y)) taken[y * W + x] = 1;
    }
  }
  const free = (x, y) => x >= 1 && y >= 1 && x < W - 1 && y < H - 1 && !taken[y * W + x] && !inKeep(x, y) && !nearThrone(x, y, 2);

  // Boulders: small clumps that block lines and give cover. Fewer near the start.
  for (let c = 0; c < 70; c++) {
    const cx = 2 + rng.int(W - 4);
    const cy = 2 + rng.int(H - 4);
    if (!free(cx, cy) || (inStart(cx, cy) && rng() < 0.6)) continue;
    const size = 2 + rng.int(5);
    let x = cx;
    let y = cy;
    for (let i = 0; i < size; i++) {
      if (free(x, y)) {
        taken[y * W + x] = 1;
        rocks.push(y * W + x);
      }
      x += rng.int(3) - 1;
      y += rng.int(3) - 1;
    }
  }

  // White squads: a leader and pawns in front of it, facing the throne.
  const white = [];
  const leaders = ['n', 'n', 'n', 'b', 'b', 'b', 'r', 'r', 'q'];
  for (let s = 0; s < 62; s++) {
    const cx = 2 + rng.int(W - 4);
    const cy = 2 + rng.int(H - 4);
    if (!free(cx, cy)) continue;
    if (inStart(cx, cy) && rng() < 0.55) continue;
    const size = 2 + rng.int(4);
    const kinds = [rng.pick(leaders)];
    for (let i = 1; i < size; i++) kinds.push(rng() < 0.22 ? rng.pick(['n', 'b', 'r']) : 'p');
    let placed = 0;
    for (let tries = 0; tries < 40 && placed < kinds.length; tries++) {
      const x = cx + rng.int(5) - 2;
      const y = cy + rng.int(5) - 2;
      if (!free(x, y)) continue;
      taken[y * W + x] = 1;
      white.push({ id: GEN_WHITE_ID + white.length, k: kinds[placed++], x, y });
    }
  }

  // Sleepers: black pieces far from the start, waking when the board reaches them.
  const black = [];
  for (let s = 0; s < 26; s++) {
    const cx = 2 + rng.int(W - 4);
    const cy = 2 + rng.int(H - 4);
    if (!free(cx, cy) || inStart(cx, cy) || Math.hypot(cx - KEEP_X, cy - KEEP_Y) < 32) continue;
    const kinds = ['p', 'p', rng.pick(['n', 'b', 'r', 'p'])];
    if (rng() < 0.3) kinds.push(rng.pick(['n', 'b']));
    let placed = 0;
    for (let tries = 0; tries < 30 && placed < kinds.length; tries++) {
      const x = cx + rng.int(5) - 2;
      const y = cy + rng.int(5) - 2;
      if (!free(x, y)) continue;
      taken[y * W + x] = 1;
      black.push({ id: GEN_BLACK_ID + black.length, k: kinds[placed++], x, y });
    }
  }
  return { ring, rocks, white, black };
}
