// Legal chess for the opening: an 8×8 board of piece letters (white upper case), castling, en passant, promotion,
// check, mate and standard notation. Square index = rank * 8 + file, rank 0 being White's first rank.

export const FILES = 'abcdefgh';
export const sqName = (sq) => FILES[sq & 7] + ((sq >> 3) + 1);
export const sqOf = (name) => FILES.indexOf(name[0]) + (Number(name[1]) - 1) * 8;
export const colorOf = (p) => (p === '.' ? null : p === p.toUpperCase() ? 'w' : 'b');
export const typeOf = (p) => p.toLowerCase();

const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

export function initialPosition() {
  const back = 'RNBQKBNR';
  const b = new Array(64).fill('.');
  for (let f = 0; f < 8; f++) {
    b[f] = back[f];
    b[8 + f] = 'P';
    b[48 + f] = 'p';
    b[56 + f] = back[f].toLowerCase();
  }
  return { b, t: 'w', cr: 'KQkq', ep: -1, hm: 0, fm: 1 };
}

export function clonePos(pos) {
  return { b: pos.b.slice(), t: pos.t, cr: pos.cr, ep: pos.ep, hm: pos.hm, fm: pos.fm };
}

const at = (b, f, r) => (f < 0 || f > 7 || r < 0 || r > 7 ? null : b[r * 8 + f]);

/** Is square `sq` attacked by side `by` ('w' or 'b')? */
export function attacked(b, sq, by) {
  const f = sq & 7;
  const r = sq >> 3;
  const up = by === 'w' ? 'P' : 'p';
  const dir = by === 'w' ? -1 : 1; // a white pawn attacks from the rank below
  if (at(b, f - 1, r + dir) === up || at(b, f + 1, r + dir) === up) return true;
  const n = by === 'w' ? 'N' : 'n';
  for (const [df, dr] of KNIGHT) if (at(b, f + df, r + dr) === n) return true;
  const k = by === 'w' ? 'K' : 'k';
  for (const [df, dr] of KING) if (at(b, f + df, r + dr) === k) return true;
  const rook = by === 'w' ? 'R' : 'r';
  const bishop = by === 'w' ? 'B' : 'b';
  const queen = by === 'w' ? 'Q' : 'q';
  for (const [df, dr] of ROOK_DIRS) {
    for (let i = 1; i < 8; i++) {
      const p = at(b, f + df * i, r + dr * i);
      if (p === null) break;
      if (p === '.') continue;
      if (p === rook || p === queen) return true;
      break;
    }
  }
  for (const [df, dr] of BISHOP_DIRS) {
    for (let i = 1; i < 8; i++) {
      const p = at(b, f + df * i, r + dr * i);
      if (p === null) break;
      if (p === '.') continue;
      if (p === bishop || p === queen) return true;
      break;
    }
  }
  return false;
}

export function kingSquare(b, side) {
  return b.indexOf(side === 'w' ? 'K' : 'k');
}

export function inCheck(pos, side = pos.t) {
  const k = kingSquare(pos.b, side);
  return k >= 0 && attacked(pos.b, k, side === 'w' ? 'b' : 'w');
}

/** Moves that follow the pieces' patterns, ignoring whether they leave the king in check. */
export function pseudoMoves(pos) {
  const { b, t } = pos;
  const out = [];
  const enemy = t === 'w' ? 'b' : 'w';
  const add = (from, to, extra) => out.push({ from, to, p: b[from], c: b[to], promo: null, castle: null, ep: false, ...extra });
  for (let sq = 0; sq < 64; sq++) {
    const p = b[sq];
    if (p === '.' || colorOf(p) !== t) continue;
    const f = sq & 7;
    const r = sq >> 3;
    const type = typeOf(p);
    if (type === 'p') {
      const dir = t === 'w' ? 1 : -1;
      const start = t === 'w' ? 1 : 6;
      const last = t === 'w' ? 7 : 0;
      const one = at(b, f, r + dir);
      const pushPawn = (to, extra = {}) => {
        if ((to >> 3) === last) for (const q of 'qrbn') add(sq, to, { ...extra, promo: t === 'w' ? q.toUpperCase() : q });
        else add(sq, to, extra);
      };
      if (one === '.') {
        pushPawn(sq + dir * 8);
        if (r === start && at(b, f, r + 2 * dir) === '.') add(sq, sq + dir * 16);
      }
      for (const df of [-1, 1]) {
        const target = at(b, f + df, r + dir);
        if (target === null) continue;
        const to = (r + dir) * 8 + f + df;
        if (target !== '.' && colorOf(target) === enemy) pushPawn(to);
        else if (to === pos.ep) add(sq, to, { ep: true, c: t === 'w' ? 'p' : 'P' });
      }
    } else if (type === 'n' || type === 'k') {
      for (const [df, dr] of type === 'n' ? KNIGHT : KING) {
        const target = at(b, f + df, r + dr);
        if (target === null) continue;
        if (target === '.' || colorOf(target) === enemy) add(sq, (r + dr) * 8 + f + df);
      }
      if (type === 'k') {
        const home = t === 'w' ? 4 : 60;
        if (sq === home) {
          const rights = t === 'w' ? pos.cr.replace(/[kq]/g, '') : pos.cr.replace(/[KQ]/g, '').toUpperCase();
          const rook = t === 'w' ? 'R' : 'r';
          if (rights.includes('K') && b[home + 1] === '.' && b[home + 2] === '.' && b[home + 3] === rook &&
            !attacked(b, home, enemy) && !attacked(b, home + 1, enemy) && !attacked(b, home + 2, enemy)) {
            add(home, home + 2, { castle: 'K' });
          }
          if (rights.includes('Q') && b[home - 1] === '.' && b[home - 2] === '.' && b[home - 3] === '.' && b[home - 4] === rook &&
            !attacked(b, home, enemy) && !attacked(b, home - 1, enemy) && !attacked(b, home - 2, enemy)) {
            add(home, home - 2, { castle: 'Q' });
          }
        }
      }
    } else {
      const dirs = type === 'r' ? ROOK_DIRS : type === 'b' ? BISHOP_DIRS : ROOK_DIRS.concat(BISHOP_DIRS);
      for (const [df, dr] of dirs) {
        for (let i = 1; i < 8; i++) {
          const target = at(b, f + df * i, r + dr * i);
          if (target === null) break;
          const to = (r + dr * i) * 8 + f + df * i;
          if (target === '.') add(sq, to);
          else {
            if (colorOf(target) === enemy) add(sq, to);
            break;
          }
        }
      }
    }
  }
  return out;
}

/** The position after a move (the move must come from pseudoMoves or legalMoves of this position). */
export function makeMove(pos, m) {
  const b = pos.b.slice();
  const t = pos.t;
  b[m.to] = m.promo ?? m.p;
  b[m.from] = '.';
  if (m.ep) b[m.to + (t === 'w' ? -8 : 8)] = '.';
  if (m.castle === 'K') {
    b[m.from + 1] = b[m.from + 3];
    b[m.from + 3] = '.';
  } else if (m.castle === 'Q') {
    b[m.from - 1] = b[m.from - 4];
    b[m.from - 4] = '.';
  }
  let cr = pos.cr;
  const strip = (chars) => {
    for (const ch of chars) cr = cr.replace(ch, '');
  };
  if (m.p === 'K') strip('KQ');
  if (m.p === 'k') strip('kq');
  for (const sq of [m.from, m.to]) {
    if (sq === 0) strip('Q');
    if (sq === 7) strip('K');
    if (sq === 56) strip('q');
    if (sq === 63) strip('k');
  }
  const ep = typeOf(m.p) === 'p' && Math.abs(m.to - m.from) === 16 ? (m.from + m.to) / 2 : -1;
  return {
    b,
    t: t === 'w' ? 'b' : 'w',
    cr,
    ep,
    hm: typeOf(m.p) === 'p' || m.c !== '.' ? 0 : pos.hm + 1,
    fm: t === 'b' ? pos.fm + 1 : pos.fm,
  };
}

export function legalMoves(pos) {
  const side = pos.t;
  const out = [];
  for (const m of pseudoMoves(pos)) {
    const next = makeMove(pos, m);
    if (!inCheck(next, side)) out.push(m);
  }
  return out;
}

function insufficient(b) {
  const rest = b.filter((p) => p !== '.' && typeOf(p) !== 'k');
  if (rest.length === 0) return true;
  if (rest.length === 1 && (typeOf(rest[0]) === 'n' || typeOf(rest[0]) === 'b')) return true;
  return false;
}

/** 'play' | 'checkmate' | 'stalemate' | 'draw' for the side to move. */
export function status(pos) {
  if (legalMoves(pos).length === 0) return inCheck(pos) ? 'checkmate' : 'stalemate';
  if (pos.hm >= 100 || insufficient(pos.b)) return 'draw';
  return 'play';
}

/** Standard algebraic notation of a legal move, with + or #. */
export function san(pos, m) {
  let s;
  if (m.castle) s = m.castle === 'K' ? 'O-O' : 'O-O-O';
  else {
    const type = typeOf(m.p);
    const capture = m.c !== '.';
    if (type === 'p') {
      s = (capture ? FILES[m.from & 7] + 'x' : '') + sqName(m.to);
      if (m.promo) s += '=' + m.promo.toUpperCase();
    } else {
      const rivals = legalMoves(pos).filter((o) => o.to === m.to && o.p === m.p && o.from !== m.from);
      let dis = '';
      if (rivals.length) {
        const sameFile = rivals.some((o) => (o.from & 7) === (m.from & 7));
        const sameRank = rivals.some((o) => (o.from >> 3) === (m.from >> 3));
        if (!sameFile) dis = FILES[m.from & 7];
        else if (!sameRank) dis = String((m.from >> 3) + 1);
        else dis = sqName(m.from);
      }
      s = type.toUpperCase() + dis + (capture ? 'x' : '') + sqName(m.to);
    }
  }
  const next = makeMove(pos, m);
  if (inCheck(next)) s += legalMoves(next).length === 0 ? '#' : '+';
  return s;
}

/** The legal move from→to (promotion to a queen unless `promo` says otherwise), or null. */
export function findMove(pos, from, to, promo) {
  const moves = legalMoves(pos).filter((m) => m.from === from && m.to === to);
  if (!moves.length) return null;
  if (moves.length === 1) return moves[0];
  const want = (promo ?? 'q').toLowerCase();
  return moves.find((m) => m.promo && m.promo.toLowerCase() === want) ?? moves[0];
}

export function boardString(b) {
  return b.join('');
}

export function parseBoard(s) {
  if (typeof s !== 'string' || s.length !== 64 || !/^[.PNBRQKpnbrqk]{64}$/.test(s)) return null;
  return s.split('');
}
