// The Endgame: a dragon made of black chess pieces, at the top of the battlefield behind Black's army. Each part
// stands on a square next to its king; striking a part with a legal move chips it, and a part at 0 falls off. Groups
// of parts power its attacks; the torso shields the king.

import { W, H } from './config.js';
import { idx, onBoard, KNIGHT, ALL8 } from './rules.js';

const R = Math.PI;
// g: group, k: the piece it is drawn as, dx/dy: its square from the king, hp: base hit points, rot: drawing angle.
export const PARTS = [
  { g: 'king', k: 'k', dx: 0, dy: 0, hp: 8, rot: 0 },
  { g: 'torso', k: 'q', dx: 0, dy: -1, hp: 3, rot: 0 },
  { g: 'torso', k: 'b', dx: -1, dy: 0, hp: 3, rot: -0.1 },
  { g: 'torso', k: 'b', dx: 1, dy: 0, hp: 3, rot: 0.1 },
  { g: 'torso', k: 'r', dx: 0, dy: 1, hp: 3, rot: 0 },
  { g: 'head', k: 'n', dx: 0, dy: -2, hp: 5, rot: 0 },
  { g: 'lwing', k: 'r', dx: -2, dy: -1, hp: 3, rot: -R * 0.3 },
  { g: 'lwing', k: 'r', dx: -3, dy: -2, hp: 3, rot: -R * 0.28 },
  { g: 'lfeath', k: 'q', dx: -3, dy: -1, hp: 2, rot: -R * 0.6 },
  { g: 'lfeath', k: 'q', dx: -4, dy: -2, hp: 2, rot: -R * 0.52 },
  { g: 'rwing', k: 'r', dx: 2, dy: -1, hp: 3, rot: R * 0.3 },
  { g: 'rwing', k: 'r', dx: 3, dy: -2, hp: 3, rot: R * 0.28 },
  { g: 'rfeath', k: 'q', dx: 3, dy: -1, hp: 2, rot: R * 0.6 },
  { g: 'rfeath', k: 'q', dx: 4, dy: -2, hp: 2, rot: R * 0.52 },
  { g: 'larm', k: 'p', dx: -1, dy: 1, hp: 2, rot: -0.5 },
  { g: 'rarm', k: 'p', dx: 1, dy: 1, hp: 2, rot: 0.5 },
  { g: 'tail', k: 'r', dx: 0, dy: 2, hp: 2, rot: R },
  { g: 'tail', k: 'r', dx: -1, dy: 2, hp: 2, rot: R * 0.6 },
  { g: 'sting', k: 'p', dx: -2, dy: 2, hp: 3, rot: -R * 0.35 },
];

export const GROUP_LABEL = {
  lwing: 'Left wing', rwing: 'Right wing', lfeath: 'Left feathers', rfeath: 'Right feathers', head: 'Head', tail: 'Tail',
  sting: 'Stinger', torso: 'Heart guard', king: 'King', larm: 'Claw', rarm: 'Claw',
};

export function makeBoss(x, y, mult = 1) {
  return {
    x,
    y,
    parts: PARTS.map((p, i) => ({ i, g: p.g, k: p.k, dx: p.dx, dy: p.dy, rot: p.rot, mh: Math.max(1, Math.round(p.hp * mult)), hp: Math.max(1, Math.round(p.hp * mult)) })),
    ph: 1, // 1-3: the fight's phases
    atk: [], // announced attacks: they land as Black's next turn begins
    next: 2, // the black turn on which it announces its next attack
    last: '',
    dead: false,
    deadAt: 0,
    mm: mult,
  };
}

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

/** Squares the dragon's living parts stand on. */
export function footprint(boss) {
  const out = [];
  for (const p of boss.parts) if (p.hp > 0) out.push({ x: boss.x + p.dx, y: boss.y + p.dy, part: p });
  return out;
}

export function placeBoss(w, boss) {
  for (const { x, y, part } of footprint(boss)) if (onBoard(x, y)) w.occ[idx(x, y)] = -(part.i + 1);
}

/** The squares an announced attack hits. */
export function attackSquares(w, atk) {
  const out = [];
  const add = (x, y) => {
    if (onBoard(x, y)) out.push(y * W + x);
  };
  if (atk.k === 'rake') {
    for (const [axis, line, a = 0, b = (axis === 0 ? W : H) - 1] of atk.lines) {
      if (axis === 0) for (let x = a; x <= b; x++) add(x, line);
      else for (let y = a; y <= b; y++) add(line, y);
    }
  } else if (atk.k === 'rain') {
    for (const [cx, cy] of atk.xs) {
      add(cx, cy);
      for (let i = 1; i <= 2; i++) for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) add(cx + dx * i, cy + dy * i);
    }
  } else if (atk.k === 'fork') {
    const [cx, cy] = atk.c;
    add(cx, cy);
    for (const [dx, dy] of KNIGHT) add(cx + dx, cy + dy);
  } else if (atk.k === 'sting') {
    const [cx, cy] = atk.c;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) add(cx + dx, cy + dy);
  } else if (atk.k === 'decree') {
    for (const [gx, gy, d] of atk.g) {
      const [dx, dy] = ALL8[d];
      for (let i = 1; i <= 8; i++) {
        const x = gx + dx * i;
        const y = gy + dy * i;
        if (!onBoard(x, y)) break;
        add(x, y);
        // The line stops where a piece would stop it (the first one in the way takes the shot).
        if (w && w.occ[y * W + x] !== 0) break;
      }
    }
  }
  return out;
}

export const ATTACK_NAME = {
  rake: 'Rook Rake', rain: "Queen's Rain", fork: 'Knight Fork', sting: 'Tail Sting', decree: 'Check', summon: 'Summon',
};
