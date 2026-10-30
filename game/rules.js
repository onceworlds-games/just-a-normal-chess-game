// Chess on the battlefield: how each piece moves on the 100×100 grid, what blocks it, and who attacks a square.
// Shared by the host's simulation and every page's drawing (legal-move dots, red threatened squares).

import { W, H, REACH, STONE_REACH, ST_AIR, ST_GHOST } from './config.js';

export const T_FLOOR = 0;
export const T_ROCK = 1;
export const T_THRONE = 2;

export const DIRS4 = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // a pawn's facing: N, E, S, W
export const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
export const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
export const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
export const ALL8 = ORTHO.concat(DIAG);

export const idx = (x, y) => y * W + x;
export const team = (side) => (side === 'w' ? 0 : 1);

export function makeWorld() {
  return {
    terr: new Uint8Array(W * H),
    occ: new Int32Array(W * H), // >0 a piece id, <0 a dragon part -(index + 1), 0 empty
    bounds: [0, 0, W - 1, H - 1],
    sealed: true, // the throne is closed (the waves)
    bossOpen: false, // the dragon's parts can be struck
    bossArmed: false, // its parts attack on Black's tick (the fight, while it stands)
    kingOpen: false, // its king can be struck (the torso is gone)
    pieces: new Map(),
    boss: null,
  };
}

export const inBounds = (w, x, y) => x >= w.bounds[0] && x <= w.bounds[2] && y >= w.bounds[1] && y <= w.bounds[3];

/** Can a piece stand on or pass over this square, ignoring who is on it? */
export function open(w, x, y) {
  if (x < 0 || y < 0 || x >= W || y >= H || !inBounds(w, x, y)) return false;
  const t = w.terr[y * W + x];
  if (t === T_ROCK) return false;
  if (t === T_THRONE && w.sealed) return false;
  return true;
}

export function faceToward(x, y, tx, ty) {
  const dx = tx - x;
  const dy = ty - y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 1 : 3;
  return dy > 0 ? 2 : 0;
}

/** The two squares a pawn facing `f` attacks, as offsets. */
export function pawnDiagonals(f) {
  const [fx, fy] = DIRS4[f & 3];
  return [[fx - fy, fy + fx], [fx + fy, fy - fx]];
}

export const reachOf = (p) => (p.s === 's' ? STONE_REACH : REACH);
export const PART_REACH = 3; // the dragon's own pieces strike this far on Black's tick
export const PART_FACE = 2; // its pawn claws face south
export const active = (p) => !!p && !(p.st & ST_AIR);

/** Is the occupant `o` of a square something piece `p` may capture or strike? */
export function capturable(w, p, o) {
  if (o > 0) {
    const q = w.pieces.get(o);
    return !!q && active(q) && team(q.s) !== team(p.s);
  }
  if (o < 0) {
    if (p.s !== 'w' || !w.bossOpen || !w.boss) return false;
    const part = w.boss.parts[-o - 1];
    if (!part || part.hp <= 0) return false;
    return part.g !== 'king' || w.kingOpen;
  }
  return false;
}

/**
 * Every move of piece `p`: { x, y, o } where o is what stands there (0 empty, a piece id, or -(part + 1)).
 * Squares with a friend, an unstrikeable part or a piece still in the air are left out.
 */
export function movesOf(w, p, out = []) {
  out.length = 0;
  if (!active(p) || (p.st & ST_GHOST)) return out;
  const { x, y } = p;
  const look = (tx, ty) => {
    if (!open(w, tx, ty)) return -1;
    const o = w.occ[ty * W + tx];
    if (o === 0) {
      out.push({ x: tx, y: ty, o: 0 });
      return 0;
    }
    if (capturable(w, p, o)) out.push({ x: tx, y: ty, o });
    return 1;
  };
  if (p.k === 'p') {
    const [fx, fy] = DIRS4[p.f & 3];
    if (open(w, x + fx, y + fy) && w.occ[(y + fy) * W + x + fx] === 0) out.push({ x: x + fx, y: y + fy, o: 0 });
    for (const [dx, dy] of pawnDiagonals(p.f)) {
      const tx = x + dx;
      const ty = y + dy;
      if (!open(w, tx, ty)) continue;
      const o = w.occ[ty * W + tx];
      if (o !== 0 && capturable(w, p, o)) out.push({ x: tx, y: ty, o });
    }
  } else if (p.k === 'n' || p.k === 'k') {
    for (const [dx, dy] of p.k === 'n' ? KNIGHT : KING) look(x + dx, y + dy);
  } else {
    const dirs = p.k === 'r' ? ORTHO : p.k === 'b' ? DIAG : ALL8;
    const reach = reachOf(p);
    for (const [dx, dy] of dirs) {
      for (let i = 1; i <= reach; i++) {
        if (look(x + dx * i, y + dy * i) !== 0) break;
      }
    }
  }
  return out;
}

/** Squares piece `p` attacks (where an enemy would be taken on its next move), empty ones included. */
export function attacksOf(w, p, out = []) {
  out.length = 0;
  if (!active(p) || (p.st & ST_GHOST)) return out;
  const { x, y } = p;
  if (p.k === 'p') {
    for (const [dx, dy] of pawnDiagonals(p.f)) if (open(w, x + dx, y + dy)) out.push({ x: x + dx, y: y + dy });
  } else if (p.k === 'n' || p.k === 'k') {
    for (const [dx, dy] of p.k === 'n' ? KNIGHT : KING) if (open(w, x + dx, y + dy)) out.push({ x: x + dx, y: y + dy });
  } else {
    const dirs = p.k === 'r' ? ORTHO : p.k === 'b' ? DIAG : ALL8;
    const reach = reachOf(p);
    for (const [dx, dy] of dirs) {
      for (let i = 1; i <= reach; i++) {
        const tx = x + dx * i;
        const ty = y + dy * i;
        if (!open(w, tx, ty)) break;
        out.push({ x: tx, y: ty });
        if (w.occ[ty * W + tx] !== 0) break;
      }
    }
  }
  return out;
}

/**
 * Is (x, y) attacked by an active piece of team `by` (0 white, 1 black)? `ignore` is a piece id treated as absent (the
 * piece that would move away), `extra` an optional square treated as blocked (where it would land).
 */
export function attackedBy(w, x, y, by, ignore = 0) {
  const armed = by === 1 && w.bossArmed && w.boss;
  const partAt = (tx, ty) => {
    if (!armed || tx < 0 || ty < 0 || tx >= W || ty >= H) return null;
    const o = w.occ[ty * W + tx];
    if (o >= 0) return null;
    const part = w.boss.parts[-o - 1];
    return part && part.hp > 0 ? part : null;
  };
  const pieceAt = (tx, ty) => {
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return null;
    const o = w.occ[ty * W + tx];
    if (o <= 0 || o === ignore) return null;
    const q = w.pieces.get(o);
    return q && active(q) && !(q.st & ST_GHOST) && team(q.s) === by ? q : null;
  };
  for (const [dx, dy] of KNIGHT) {
    const q = pieceAt(x + dx, y + dy) ?? partAt(x + dx, y + dy);
    if (q && q.k === 'n') return true;
  }
  for (const [dx, dy] of KING) {
    const part = partAt(x + dx, y + dy);
    if (part) {
      if (part.k === 'k') return true;
      if (part.k === 'p' && dx !== 0 && dy !== 0) for (const [ax, ay] of pawnDiagonals(PART_FACE)) if (ax === -dx && ay === -dy) return true;
    }
    const q = pieceAt(x + dx, y + dy);
    if (!q) continue;
    if (q.k === 'k') return true;
    if (q.k === 'p' && dx !== 0 && dy !== 0) {
      // the pawn stands at (x+dx, y+dy): does one of its diagonals point back here?
      for (const [ax, ay] of pawnDiagonals(q.f)) if (ax === -dx && ay === -dy) return true;
    }
  }
  for (let d = 0; d < 8; d++) {
    const [dx, dy] = ALL8[d];
    const diag = d >= 4;
    for (let i = 1; i <= REACH; i++) {
      const tx = x + dx * i;
      const ty = y + dy * i;
      if (!open(w, tx, ty)) break;
      const o = w.occ[ty * W + tx];
      if (o === 0 || o === ignore) continue;
      if (o < 0) {
        const part = partAt(tx, ty);
        if (part && i <= PART_REACH && (part.k === 'q' || (diag ? part.k === 'b' : part.k === 'r'))) return true;
        break;
      }
      const q = w.pieces.get(o);
      if (!q) break;
      if (active(q) && !(q.st & ST_GHOST) && team(q.s) === by && i <= reachOf(q) && (q.k === 'q' || (diag ? q.k === 'b' : q.k === 'r'))) return true;
      break;
    }
  }
  return false;
}

/** Squares a living dragon part attacks on Black's tick, as if it were the piece it is drawn as. */
export function partAttacks(w, part, x, y, out = []) {
  out.length = 0;
  const add = (tx, ty) => {
    if (open(w, tx, ty)) out.push({ x: tx, y: ty });
  };
  if (part.k === 'n') for (const [dx, dy] of KNIGHT) add(x + dx, y + dy);
  else if (part.k === 'k') for (const [dx, dy] of KING) add(x + dx, y + dy);
  else if (part.k === 'p') for (const [dx, dy] of pawnDiagonals(PART_FACE)) add(x + dx, y + dy);
  else {
    const dirs = part.k === 'r' ? ORTHO : part.k === 'b' ? DIAG : ALL8;
    for (const [dx, dy] of dirs) {
      for (let i = 1; i <= PART_REACH; i++) {
        const tx = x + dx * i;
        const ty = y + dy * i;
        if (!open(w, tx, ty)) break;
        out.push({ x: tx, y: ty });
        if (w.occ[ty * W + tx] !== 0) break;
      }
    }
  }
  return out;
}

export function placePiece(w, p) {
  w.pieces.set(p.id, p);
  w.occ[p.y * W + p.x] = p.id;
}

export function removePiece(w, p) {
  if (w.occ[p.y * W + p.x] === p.id) w.occ[p.y * W + p.x] = 0;
  w.pieces.delete(p.id);
}

export function movePieceTo(w, p, x, y) {
  if (w.occ[p.y * W + p.x] === p.id) w.occ[p.y * W + p.x] = 0;
  p.x = x;
  p.y = y;
  w.occ[y * W + x] = p.id;
}

export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
export const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
