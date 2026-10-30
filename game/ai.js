// Noir, the bot that plays Black in the opening. A small alpha-beta search with piece-square tables: it plays
// sensible chess, but after a few moves it starts leaving pieces where White can take them. It wants to be taken.

import { inCheck, makeMove, pseudoMoves, typeOf, colorOf } from './chess.js';

const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const MATE = 100000;

// Tables are written from rank 8 (top) to rank 1, as seen by White.
const PST = {
  p: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  n: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  b: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  r: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  k: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
};

/** Score from White's point of view, in centipawns. */
export function evaluate(b) {
  let s = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = b[sq];
    if (p === '.') continue;
    const type = typeOf(p);
    const f = sq & 7;
    const r = sq >> 3;
    if (colorOf(p) === 'w') s += VAL[type] + PST[type][(7 - r) * 8 + f];
    else s -= VAL[type] + PST[type][r * 8 + f];
  }
  return s;
}

function ordered(pos) {
  const moves = pseudoMoves(pos);
  for (const m of moves) {
    m.o = (m.c !== '.' ? 10 * VAL[typeOf(m.c)] - VAL[typeOf(m.p)] + 1000 : 0) + (m.promo ? 800 : 0);
  }
  return moves.sort((a, b) => b.o - a.o);
}

function search(state, pos, depth, alpha, beta, ply) {
  if (++state.nodes > state.budget) state.out = true;
  if (state.out) return 0;
  if (depth <= 0) return quiesce(state, pos, alpha, beta, 4);
  const side = pos.t;
  let any = false;
  let best = -Infinity;
  for (const m of ordered(pos)) {
    const next = makeMove(pos, m);
    if (inCheck(next, side)) continue;
    any = true;
    const score = -search(state, next, depth - 1, -beta, -alpha, ply + 1);
    if (state.out) return 0;
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  if (!any) return inCheck(pos, side) ? -MATE + ply : 0;
  return best;
}

function quiesce(state, pos, alpha, beta, left) {
  if (++state.nodes > state.budget) state.out = true;
  if (state.out) return 0;
  const stand = pos.t === 'w' ? evaluate(pos.b) : -evaluate(pos.b);
  if (stand >= beta || left <= 0) return stand;
  if (stand > alpha) alpha = stand;
  const side = pos.t;
  for (const m of ordered(pos)) {
    if (m.c === '.' && !m.promo) continue;
    const next = makeMove(pos, m);
    if (inCheck(next, side)) continue;
    const score = -quiesce(state, next, -beta, -alpha, left - 1);
    if (state.out) return 0;
    if (score >= beta) return score;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

/** Every legal root move with its score for the side to move, best first. */
export function scoreMoves(pos, depth, budget = 120000) {
  const side = pos.t;
  const roots = [];
  for (const m of ordered(pos)) {
    const next = makeMove(pos, m);
    if (!inCheck(next, side)) roots.push({ m, next, score: 0 });
  }
  let done = roots.map((r) => ({ ...r, score: 0 }));
  for (let d = 1; d <= depth; d++) {
    const state = { nodes: 0, budget, out: false };
    const scored = [];
    for (const r of roots) {
      const score = -search(state, r.next, d - 1, -Infinity, Infinity, 1);
      if (state.out) break;
      scored.push({ ...r, score });
    }
    if (state.out) break;
    done = scored;
  }
  return done.sort((a, b) => b.score - a.score);
}

/**
 * Noir's move, or null when it has none. `lure` (0..1): the chance it picks the least bad move that leaves White a
 * capture. `loose` (centipawns): how far from the best move it may wander for variety.
 */
export function chooseMove(pos, { depth = 3, rng = Math.random, lure = 0, loose = 25 } = {}) {
  const scored = scoreMoves(pos, depth);
  if (!scored.length) return null;
  if (lure > 0 && rng() < lure) {
    const baits = scored.filter((r) => {
      const replies = pseudoMoves(r.next).filter((w) => w.c !== '.' && !inCheck(makeMove(r.next, w), r.next.t));
      return replies.length > 0;
    });
    // The least bad bait that doesn't simply lose the game.
    const bait = baits.find((r) => r.score > -MATE / 2);
    if (bait) return bait.m;
  }
  const best = scored[0].score;
  const close = scored.filter((r) => r.score >= best - loose);
  return close[Math.floor(rng() * close.length)].m;
}

/** How likely Noir is to bait on this full move number (it gets hungrier the longer nobody takes anything). */
export function lureChance(fullmove) {
  if (fullmove < 5) return 0;
  return Math.min(1, 0.18 + (fullmove - 5) * 0.12);
}
