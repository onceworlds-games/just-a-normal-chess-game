import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, movesOf, attacksOf, attackedBy, placePiece, pawnDiagonals, faceToward, T_ROCK } from '../game/rules.js';
import { rngFor } from '../game/rng.js';

const piece = (id, s, k, x, y, extra = {}) => ({ id, s, k, x, y, o: 0, cd: 0, hp: 1, mh: 1, f: 0, st: 0, w: 0, c: 0, ...extra });

test('sliders stop at rocks, friends and their reach', () => {
  const w = makeWorld();
  const rook = piece(1, 'w', 'r', 10, 10);
  placePiece(w, rook);
  w.terr[10 * 100 + 13] = T_ROCK;
  placePiece(w, piece(2, 'w', 'p', 10, 7));
  placePiece(w, piece(3, 'b', 'p', 7, 10));
  const moves = movesOf(w, rook);
  const has = (x, y) => moves.some((m) => m.x === x && m.y === y);
  assert.ok(has(11, 10) && has(12, 10) && !has(13, 10), 'rock blocks east');
  assert.ok(has(10, 8) && !has(10, 7), 'friend blocks north');
  assert.ok(has(7, 10) && !has(6, 10), 'captures west and stops');
  assert.ok(has(10, 18) && !has(10, 19), 'reach of 8 south');
});

test('pawns move forward and capture forward diagonals for every facing', () => {
  for (let f = 0; f < 4; f++) {
    const w = makeWorld();
    const p = piece(1, 'b', 'p', 20, 20, { f });
    placePiece(w, p);
    const [a, b] = pawnDiagonals(f);
    placePiece(w, piece(2, 'w', 'n', 20 + a[0], 20 + a[1]));
    const moves = movesOf(w, p);
    assert.equal(moves.length, 2, `facing ${f}: one step and one capture`);
    assert.ok(attackedBy(w, 20 + a[0], 20 + a[1], 1));
    assert.ok(attackedBy(w, 20 + b[0], 20 + b[1], 1));
  }
  assert.equal(faceToward(0, 0, 5, 1), 1);
  assert.equal(faceToward(0, 0, -1, -5), 0);
});

test('attackedBy agrees with attacksOf on random battlefields', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const r = rngFor(seed, 'rules');
    const w = makeWorld();
    w.bounds = [0, 0, 39, 39];
    let id = 1;
    for (let i = 0; i < 40; i++) {
      const x = r.int(40);
      const y = r.int(40);
      if (w.occ[y * 100 + x]) continue;
      if (r() < 0.1) {
        w.terr[y * 100 + x] = T_ROCK;
        continue;
      }
      placePiece(w, piece(id++, r() < 0.5 ? 'w' : r() < 0.85 ? 'b' : 's', r.pick(['p', 'n', 'b', 'r', 'q', 'k']), x, y, { f: r.int(4) }));
    }
    const attacked = new Set();
    for (const p of w.pieces.values()) if (p.s !== 'w') for (const a of attacksOf(w, p)) attacked.add(a.y * 100 + a.x);
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 40; x++) {
        if (w.terr[y * 100 + x] === T_ROCK) continue;
        assert.equal(attackedBy(w, x, y, 1), attacked.has(y * 100 + x), `seed ${seed} square ${x},${y}`);
      }
    }
  }
});
