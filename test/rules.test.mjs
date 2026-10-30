import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, movesOf, attacksOf, attackedBy, placePiece } from '../game/rules.js';
import { W, H } from '../game/config.js';
import { rngFor } from '../game/rng.js';

const piece = (id, s, k, x, y, extra = {}) => ({ id, s, k, x, y, o: 0, cd: 0, hp: 1, mh: 1, f: 0, st: 0, w: 0, c: 0, ...extra });

test('sliders stop at friends and capture enemies; pawns march and double-step from their row', () => {
  const w = makeWorld();
  const rook = piece(1, 'w', 'r', 5, 10);
  placePiece(w, rook);
  placePiece(w, piece(2, 'w', 'p', 5, 7));
  placePiece(w, piece(3, 'b', 'p', 2, 10));
  const has = (p, x, y) => movesOf(w, p).some((m) => m.x === x && m.y === y);
  assert.ok(has(rook, 5, 8) && !has(rook, 5, 7), 'friend blocks north');
  assert.ok(has(rook, 2, 10) && !has(rook, 1, 10), 'captures west and stops');
  assert.ok(has(rook, 13, 10) && has(rook, 5, 19), 'reaches the edge');
  const wp = piece(4, 'w', 'p', 9, H - 2);
  const bp = piece(5, 'b', 'p', 9, 6);
  placePiece(w, wp);
  placePiece(w, bp);
  assert.ok(has(wp, 9, H - 3) && has(wp, 9, H - 4), 'white pawn: one or two north');
  assert.ok(has(bp, 9, 7) && has(bp, 9, 8), 'black pawn: one or two south');
  placePiece(w, piece(6, 'w', 'n', 10, 7));
  assert.ok(has(bp, 10, 7), 'black pawn captures diagonally south');
  assert.ok(attackedBy(w, 10, 7, 1), 'and attacks that square');
  assert.ok(!attackedBy(w, 8, 5, 1), 'not behind it');
});

test('attackedBy agrees with attacksOf on random battlefields', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const r = rngFor(seed, 'rules');
    const w = makeWorld();
    let id = 1;
    for (let i = 0; i < 40; i++) {
      const x = r.int(W);
      const y = r.int(H);
      if (w.occ[y * W + x]) continue;
      placePiece(w, piece(id++, r() < 0.5 ? 'w' : 'b', r.pick(['p', 'n', 'b', 'r', 'q', 'k']), x, y));
    }
    const attacked = new Set();
    for (const p of w.pieces.values()) if (p.s !== 'w') for (const a of attacksOf(w, p)) attacked.add(a.y * W + a.x);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) assert.equal(attackedBy(w, x, y, 1), attacked.has(y * W + x), `seed ${seed} square ${x},${y}`);
  }
});
