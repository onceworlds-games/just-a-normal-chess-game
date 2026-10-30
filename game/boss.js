// The Endgame: a dragon made of black chess pieces. Each part stands on a square next to its king; striking a part with
// a legal move chips it, and a part at 0 falls off. Groups of parts power the attacks; the torso shields the king.

import { W, H } from './config.js';
import { idx, open, KNIGHT, ALL8 } from './rules.js';

const R = Math.PI;
// g: group, k: the piece it is drawn as, dx/dy: its square from the king, hp: base hit points, rot: drawing angle.
export const PARTS = [
  { g: 'king', k: 'k', dx: 0, dy: 0, hp: 600, rot: 0 },
  { g: 'torso', k: 'q', dx: 0, dy: -1, hp: 150, rot: 0 },
  { g: 'torso', k: 'r', dx: -1, dy: -1, hp: 150, rot: -0.2 },
  { g: 'torso', k: 'r', dx: 1, dy: -1, hp: 150, rot: 0.2 },
  { g: 'torso', k: 'b', dx: -1, dy: 0, hp: 150, rot: -0.1 },
  { g: 'torso', k: 'b', dx: 1, dy: 0, hp: 150, rot: 0.1 },
  { g: 'torso', k: 'r', dx: -1, dy: 1, hp: 150, rot: 0 },
  { g: 'torso', k: 'r', dx: 0, dy: 1, hp: 150, rot: 0 },
  { g: 'torso', k: 'r', dx: 1, dy: 1, hp: 150, rot: 0 },
  { g: 'neck', k: 'r', dx: 0, dy: -2, hp: 150, rot: 0 },
  { g: 'head', k: 'n', dx: 0, dy: -3, hp: 410, rot: 0 },
  { g: 'lwing', k: 'r', dx: -2, dy: -2, hp: 120, rot: -R * 0.3 },
  { g: 'lwing', k: 'r', dx: -3, dy: -3, hp: 120, rot: -R * 0.3 },
  { g: 'lwing', k: 'r', dx: -4, dy: -4, hp: 120, rot: -R * 0.28 },
  { g: 'lwing', k: 'r', dx: -5, dy: -5, hp: 120, rot: -R * 0.25 },
  { g: 'lfeath', k: 'q', dx: -3, dy: -1, hp: 80, rot: -R * 0.62 },
  { g: 'lfeath', k: 'q', dx: -4, dy: -2, hp: 80, rot: -R * 0.6 },
  { g: 'lfeath', k: 'q', dx: -5, dy: -3, hp: 80, rot: -R * 0.56 },
  { g: 'lfeath', k: 'q', dx: -6, dy: -4, hp: 80, rot: -R * 0.5 },
  { g: 'rwing', k: 'r', dx: 2, dy: -2, hp: 120, rot: R * 0.3 },
  { g: 'rwing', k: 'r', dx: 3, dy: -3, hp: 120, rot: R * 0.3 },
  { g: 'rwing', k: 'r', dx: 4, dy: -4, hp: 120, rot: R * 0.28 },
  { g: 'rwing', k: 'r', dx: 5, dy: -5, hp: 120, rot: R * 0.25 },
  { g: 'rfeath', k: 'q', dx: 3, dy: -1, hp: 80, rot: R * 0.62 },
  { g: 'rfeath', k: 'q', dx: 4, dy: -2, hp: 80, rot: R * 0.6 },
  { g: 'rfeath', k: 'q', dx: 5, dy: -3, hp: 80, rot: R * 0.56 },
  { g: 'rfeath', k: 'q', dx: 6, dy: -4, hp: 80, rot: R * 0.5 },
  { g: 'larm', k: 'p', dx: -2, dy: 1, hp: 100, rot: -0.5 },
  { g: 'rarm', k: 'p', dx: 2, dy: 1, hp: 100, rot: 0.5 },
  { g: 'tail', k: 'r', dx: 0, dy: 2, hp: 80, rot: R },
  { g: 'tail', k: 'r', dx: 0, dy: 3, hp: 80, rot: R },
  { g: 'tail', k: 'r', dx: -1, dy: 4, hp: 80, rot: R * 0.78 },
  { g: 'tail', k: 'r', dx: -2, dy: 5, hp: 80, rot: R * 0.55 },
  { g: 'tail', k: 'r', dx: -3, dy: 5, hp: 80, rot: R * 0.5 },
  { g: 'tail', k: 'r', dx: -4, dy: 5, hp: 80, rot: R * 0.42 },
  { g: 'tail', k: 'r', dx: -5, dy: 4, hp: 80, rot: R * 0.25 },
  { g: 'sting', k: 'p', dx: -6, dy: 3, hp: 150, rot: -R * 0.3 },
];

export const GROUP_LABEL = {
  lwing: 'Left wing', rwing: 'Right wing', lfeath: 'Feathers', rfeath: 'Feathers', head: 'Head', neck: 'Neck',
  tail: 'Tail', sting: 'Stinger', torso: 'Heart guard', king: 'King', larm: 'Claw', rarm: 'Claw',
};

export function makeBoss(x, y, mult = 1) {
  return {
    x,
    y,
    parts: PARTS.map((p, i) => ({ i, g: p.g, k: p.k, dx: p.dx, dy: p.dy, rot: p.rot, mh: Math.round(p.hp * mult), hp: Math.round(p.hp * mult) })),
    ph: 0, // 0 sealed in its throne (the waves), 1-3 the fight's phases
    inv: 0, // invulnerable until this time
    fly: null,
    atk: [],
    nextAtk: 0,
    nextSum: 0,
    nextDecree: 0,
    nextFlight: 0,
    nextRoar: 0,
    last: '',
    dead: false,
    deadAt: 0,
    grounded: true,
  };
}

export const alive = (part) => part.hp > 0;
export const groupAlive = (boss, g) => boss.parts.some((p) => p.g === g && p.hp > 0);
export const groupCount = (boss, g) => boss.parts.filter((p) => p.g === g && p.hp > 0).length;

/** Share of the dragon's body (everything but the king) still standing, 0..1. */
export function integrity(boss) {
  let hp = 0;
  let mh = 0;
  for (const p of boss.parts) {
    if (p.g === 'king') continue;
    hp += Math.max(0, p.hp);
    mh += p.mh;
  }
  return mh ? hp / mh : 0;
}

export const kingExposed = (boss) => !groupAlive(boss, 'torso');
export const kingPart = (boss) => boss.parts[0];

/** Squares the dragon's living parts stand on if its king were at (x, y). */
export function footprint(boss, x = boss.x, y = boss.y) {
  const out = [];
  for (const p of boss.parts) if (p.hp > 0) out.push({ x: x + p.dx, y: y + p.dy, part: p });
  return out;
}

export function placeBoss(w, boss) {
  for (const { x, y, part } of footprint(boss)) w.occ[idx(x, y)] = -(part.i + 1);
  boss.grounded = true;
}

export function liftBoss(w, boss) {
  for (const { x, y, part } of footprint(boss)) if (w.occ[idx(x, y)] === -(part.i + 1)) w.occ[idx(x, y)] = 0;
  boss.grounded = false;
}

/** Could the dragon land with its king on (x, y)? Every living part needs open ground inside the board. */
export function canLand(w, boss, x, y) {
  for (const { x: px, y: py } of footprint(boss, x, y)) {
    if (px < 0 || py < 0 || px >= W || py >= H || !open(w, px, py)) return false;
  }
  return true;
}

const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

/** The squares an attack hits, from its stored shape. */
export function attackSquares(w, atk) {
  const out = [];
  const add = (x, y) => {
    if (inside(x, y)) out.push(y * W + x);
  };
  if (atk.k === 'rake') {
    for (const [axis, line, a, b] of atk.lines) {
      for (let v = a; v <= b; v++) axis === 0 ? add(v, line) : add(line, v);
    }
  } else if (atk.k === 'rain') {
    for (const [cx, cy] of atk.xs) {
      add(cx, cy);
      for (let i = 1; i <= 3; i++) for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) add(cx + dx * i, cy + dy * i);
    }
  } else if (atk.k === 'fork') {
    const [cx, cy] = atk.c;
    add(cx, cy);
    for (const [dx, dy] of KNIGHT) add(cx + dx, cy + dy);
  } else if (atk.k === 'sting') {
    const [cx, cy] = atk.c;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) add(cx + dx, cy + dy);
    add(cx + 2, cy);
    add(cx - 2, cy);
    add(cx, cy + 2);
    add(cx, cy - 2);
  } else if (atk.k === 'land') {
    const [cx, cy] = atk.c;
    for (const p of atk.fp) add(cx + p[0], cy + p[1]);
  } else if (atk.k === 'decree') {
    for (const [gx, gy, d] of atk.g) {
      const [dx, dy] = ALL8[d];
      for (let i = 1; i <= 10; i++) {
        const x = gx + dx * i;
        const y = gy + dy * i;
        if (!inside(x, y)) break;
        if (w && !open(w, x, y)) break;
        add(x, y);
      }
    }
  }
  return out;
}

/** Seconds of warning each attack gives (before difficulty). */
export const WINDUP = { rake: 3.0, rain: 2.3, fork: 2.1, sting: 2.4, decree: 3.6, land: 4.2, roar: 1.6 };
export const ATTACK_NAME = {
  rake: 'Rook Rake', rain: "Queen's Rain", fork: 'Knight Fork', sting: 'Tail Sting', decree: 'Check', land: 'Flight',
  roar: 'Roar', summon: 'Summon',
};
