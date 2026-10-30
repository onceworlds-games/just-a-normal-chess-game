// Chess on the battlefield: how each piece moves on the 14x20 board, what blocks it, and who attacks a square.
// Shared by the host's simulation, Black's AI and every page's drawing (legal-move dots, red threatened squares).

import { W, H, ST_AIR, ST_GHOST, PART_REACH, BLACK_PAWN_ROW, WHITE_PAWN_ROW } from './config.js';

export const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
export const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
export const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
export const ALL8 = ORTHO.concat(DIAG);

export const idx = (x, y) => y * W + x;
export const team = (side) => (side === 'w' ? 0 : 1);
export const onBoard = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

export function makeWorld() {
  return {
    occ: new Int32Array(W * H), // >0 a piece id, <0 a dragon part -(index + 1), 0 empty
    pieces: new Map(),
    boss: null,
    bossOpen: false, // its parts can be struck
    kingOpen: false, // its king can be struck (the torso is gone)
  };
}

/** A pawn moves toward the other side: White north, Black south. */
export const forward = (p) => (p.s === 'w' ? -1 : 1);
export const pawnStart = (p) => (p.s === 'w' ? WHITE_PAWN_ROW : BLACK_PAWN_ROW);
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

/** Every move of piece `p`: { x, y, o } where o is what stands there (0 empty, a piece id, or -(part + 1)). */
export function movesOf(w, p, out = []) {
  out.length = 0;
  if (!active(p) || p.st & ST_GHOST) return out;
  const { x, y } = p;
  const look = (tx, ty) => {
    if (!onBoard(tx, ty)) return -1;
    const o = w.occ[ty * W + tx];
    if (o === 0) {
      out.push({ x: tx, y: ty, o: 0 });
      return 0;
    }
    if (capturable(w, p, o)) out.push({ x: tx, y: ty, o });
    return 1;
  };
  if (p.k === 'p') {
    const fy = forward(p);
    if (onBoard(x, y + fy) && w.occ[(y + fy) * W + x] === 0) {
      out.push({ x, y: y + fy, o: 0 });
      if (y === pawnStart(p) && onBoard(x, y + 2 * fy) && w.occ[(y + 2 * fy) * W + x] === 0) out.push({ x, y: y + 2 * fy, o: 0 });
    }
    for (const dx of [-1, 1]) {
      const tx = x + dx;
      const ty = y + fy;
      if (!onBoard(tx, ty)) continue;
      const o = w.occ[ty * W + tx];
      if (o !== 0 && capturable(w, p, o)) out.push({ x: tx, y: ty, o });
    }
  } else if (p.k === 'n' || p.k === 'k') {
    for (const [dx, dy] of p.k === 'n' ? KNIGHT : KING) look(x + dx, y + dy);
  } else {
    const dirs = p.k === 'r' ? ORTHO : p.k === 'b' ? DIAG : ALL8;
    for (const [dx, dy] of dirs) {
      for (let i = 1; ; i++) {
        if (look(x + dx * i, y + dy * i) !== 0) break;
      }
    }
  }
  return out;
}

/** Squares piece `p` attacks (where an enemy would be taken on its next move), empty ones included. */
export function attacksOf(w, p, out = []) {
  out.length = 0;
  if (!active(p) || p.st & ST_GHOST) return out;
  const { x, y } = p;
  if (p.k === 'p') {
    for (const dx of [-1, 1]) if (onBoard(x + dx, y + forward(p))) out.push({ x: x + dx, y: y + forward(p) });
  } else if (p.k === 'n' || p.k === 'k') {
    for (const [dx, dy] of p.k === 'n' ? KNIGHT : KING) if (onBoard(x + dx, y + dy)) out.push({ x: x + dx, y: y + dy });
  } else {
    const dirs = p.k === 'r' ? ORTHO : p.k === 'b' ? DIAG : ALL8;
    for (const [dx, dy] of dirs) {
      for (let i = 1; ; i++) {
        const tx = x + dx * i;
        const ty = y + dy * i;
        if (!onBoard(tx, ty)) break;
        out.push({ x: tx, y: ty });
        if (w.occ[ty * W + tx] !== 0) break;
      }
    }
  }
  return out;
}

/**
 * Is (x, y) attacked by team `by` (0 white, 1 black)? `ignore` is a piece id treated as absent (the piece that
 * would move away). Black's attackers include the dragon's parts while it is armed.
 */
export function attackedBy(w, x, y, by, ignore = 0) {
  const armed = by === 1 && w.boss && w.bossArmed;
  const partAt = (tx, ty) => {
    if (!armed || !onBoard(tx, ty)) return null;
    const o = w.occ[ty * W + tx];
    if (o >= 0) return null;
    const part = w.boss.parts[-o - 1];
    return part && part.hp > 0 ? part : null;
  };
  const pieceAt = (tx, ty) => {
    if (!onBoard(tx, ty)) return null;
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
    if (part && (part.k === 'k' || (part.k === 'p' && dy === -1 && dx !== 0))) return true;
    const q = pieceAt(x + dx, y + dy);
    if (!q) continue;
    if (q.k === 'k') return true;
    // A pawn at (x+dx, y+dy) attacks (x, y) when it stands one rank behind it, diagonally.
    if (q.k === 'p' && dx !== 0 && dy === -forward(q)) return true;
  }
  for (let d = 0; d < 8; d++) {
    const [dx, dy] = ALL8[d];
    const diag = d >= 4;
    for (let i = 1; ; i++) {
      const tx = x + dx * i;
      const ty = y + dy * i;
      if (!onBoard(tx, ty)) break;
      const o = w.occ[ty * W + tx];
      if (o === 0 || o === ignore) continue;
      if (o < 0) {
        const part = partAt(tx, ty);
        if (part && i <= PART_REACH && (part.k === 'q' || (diag ? part.k === 'b' : part.k === 'r'))) return true;
        break;
      }
      const q = w.pieces.get(o);
      if (q && active(q) && !(q.st & ST_GHOST) && team(q.s) === by && (q.k === 'q' || (diag ? q.k === 'b' : q.k === 'r'))) return true;
      break;
    }
  }
  return false;
}

/** Squares a living dragon part attacks, as if it were the piece it is drawn as (sliders reach PART_REACH). */
export function partAttacks(w, part, x, y, out = []) {
  out.length = 0;
  const add = (tx, ty) => {
    if (onBoard(tx, ty)) out.push({ x: tx, y: ty });
  };
  if (part.k === 'n') for (const [dx, dy] of KNIGHT) add(x + dx, y + dy);
  else if (part.k === 'k') for (const [dx, dy] of KING) add(x + dx, y + dy);
  else if (part.k === 'p') for (const dx of [-1, 1]) add(x + dx, y + 1);
  else {
    const dirs = part.k === 'r' ? ORTHO : part.k === 'b' ? DIAG : ALL8;
    for (const [dx, dy] of dirs) {
      for (let i = 1; i <= PART_REACH; i++) {
        const tx = x + dx * i;
        const ty = y + dy * i;
        if (!onBoard(tx, ty)) break;
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
