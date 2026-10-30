// Compact text for the host's snapshots: every piece in 17 characters of URL-safe base 64, split over a few room
// state keys (each value must stay under 16 KB). Decoding validates everything: snapshots come from another page.

import { W, H, TYPES, SIDES } from './config.js';

const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const IDX = new Int16Array(128).fill(-1);
for (let i = 0; i < A.length; i++) IDX[A.charCodeAt(i)] = i;

export function enc(n, len) {
  const max = 64 ** len - 1;
  let v = Math.max(0, Math.min(max, Math.round(n) || 0));
  let s = '';
  for (let i = 0; i < len; i++) {
    s = A[v & 63] + s;
    v = Math.floor(v / 64);
  }
  return s;
}

export function dec(s, at, len) {
  let v = 0;
  for (let i = 0; i < len; i++) {
    const c = s.charCodeAt(at + i);
    const d = c < 128 ? IDX[c] : -1;
    if (d < 0) return -1;
    v = v * 64 + d;
  }
  return v;
}

export const PIECE_LEN = 17;
export const CHUNKS = 3;

export function encodePiece(p) {
  const kind = SIDES.indexOf(p.s) * 6 + TYPES.indexOf(p.k);
  return (
    enc(p.id, 3) +
    enc(kind, 1) +
    enc(p.y * W + p.x, 3) +
    enc((p.o ?? -1) + 1, 1) +
    enc(Math.max(0, p.cd ?? 0) * 10, 3) +
    enc(p.hp ?? 1, 1) +
    enc(p.mh ?? 1, 1) +
    enc(((p.f ?? 0) & 3) | ((p.st ?? 0) << 2), 2) +
    enc(Math.min(63, p.w ?? 0), 1) +
    enc(Math.min(63, p.c ?? 0), 1)
  );
}

/** One piece from s at offset `at`, or null if it doesn't parse. */
export function decodePiece(s, at) {
  const id = dec(s, at, 3);
  const kind = dec(s, at + 3, 1);
  const pos = dec(s, at + 4, 3);
  const o = dec(s, at + 7, 1);
  const cd = dec(s, at + 8, 3);
  const hp = dec(s, at + 11, 1);
  const mh = dec(s, at + 12, 1);
  const fl = dec(s, at + 13, 2);
  const w = dec(s, at + 15, 1);
  const c = dec(s, at + 16, 1);
  if (id <= 0 || kind < 0 || kind >= 18 || pos < 0 || pos >= W * H || o < 0 || o > 4 || cd < 0 || hp < 0 || mh < 0 || fl < 0 || w < 0 || c < 0) return null;
  return {
    id,
    s: SIDES[Math.floor(kind / 6)],
    k: TYPES[kind % 6],
    x: pos % W,
    y: Math.floor(pos / W),
    o: o - 1,
    cd: cd / 10,
    hp,
    mh: Math.max(1, mh),
    f: fl & 3,
    st: fl >> 2,
    w,
    c,
  };
}

/** Pieces → CHUNKS strings, by id. */
export function encodePieces(pieces) {
  const parts = new Array(CHUNKS).fill('');
  for (const p of pieces) parts[p.id % CHUNKS] += encodePiece(p);
  return parts;
}

export function decodePieces(strings, into = new Map()) {
  into.clear();
  for (const s of strings) {
    if (typeof s !== 'string' || s.length % PIECE_LEN !== 0) continue;
    for (let at = 0; at < s.length; at += PIECE_LEN) {
      const p = decodePiece(s, at);
      if (p && !into.has(p.id)) into.set(p.id, p);
    }
  }
  return into;
}

export function encodePositions(list) {
  let s = '';
  for (const pos of list) s += enc(pos, 3);
  return s;
}

export function decodePositions(s) {
  const out = [];
  if (typeof s !== 'string' || s.length % 3 !== 0) return out;
  for (let at = 0; at < s.length; at += 3) {
    const pos = dec(s, at, 3);
    if (pos >= 0 && pos < W * H) out.push(pos);
  }
  return out;
}

export function encodeHp(parts) {
  let s = '';
  for (const p of parts) s += enc(Math.max(0, p.hp), 2);
  return s;
}

export function decodeHp(s, count) {
  const out = [];
  if (typeof s !== 'string' || s.length !== count * 2) return null;
  for (let i = 0; i < count; i++) {
    const v = dec(s, i * 2, 2);
    if (v < 0) return null;
    out.push(v);
  }
  return out;
}

export const clampInt = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export { H };
