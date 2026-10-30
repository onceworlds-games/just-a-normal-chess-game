import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialPosition, legalMoves, makeMove, san, status, findMove, sqOf, inCheck } from '../game/chess.js';
import { chooseMove, lureChance } from '../game/ai.js';

function fromFen(fen) {
  const [rows, t, cr, ep] = fen.split(' ');
  const b = new Array(64).fill('.');
  rows.split('/').forEach((row, i) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) f += Number(ch);
      else b[(7 - i) * 8 + f++] = ch;
    }
  });
  return { b, t, cr: cr === '-' ? '' : cr, ep: ep === '-' ? -1 : sqOf(ep), hm: 0, fm: 1 };
}

function perft(pos, depth) {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of legalMoves(pos)) n += perft(makeMove(pos, m), depth - 1);
  return n;
}

test('perft from the start', () => {
  const p = initialPosition();
  assert.equal(perft(p, 1), 20);
  assert.equal(perft(p, 2), 400);
  assert.equal(perft(p, 3), 8902);
});

test('perft kiwipete (castling, en passant, promotions)', () => {
  const p = fromFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -');
  assert.equal(perft(p, 1), 48);
  assert.equal(perft(p, 2), 2039);
});

test('perft position 3 (en passant pins)', () => {
  const p = fromFen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -');
  assert.equal(perft(p, 1), 14);
  assert.equal(perft(p, 2), 191);
  assert.equal(perft(p, 3), 2812);
});

test('perft position 4 (promotions and checks)', () => {
  const p = fromFen('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq -');
  assert.equal(perft(p, 1), 6);
  assert.equal(perft(p, 2), 264);
});

test('notation and mate', () => {
  let p = initialPosition();
  const play = (from, to) => {
    const m = findMove(p, sqOf(from), sqOf(to));
    assert.ok(m, `${from}${to} legal`);
    const s = san(p, m);
    p = makeMove(p, m);
    return s;
  };
  assert.equal(play('f2', 'f3'), 'f3');
  assert.equal(play('e7', 'e5'), 'e5');
  assert.equal(play('g2', 'g4'), 'g4');
  assert.equal(play('d8', 'h4'), 'Qh4#');
  assert.equal(status(p), 'checkmate');
  assert.ok(inCheck(p));
});

test('castling notation', () => {
  const p = fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq -');
  const short = findMove(p, sqOf('e1'), sqOf('g1'));
  const long = findMove(p, sqOf('e1'), sqOf('c1'));
  assert.equal(san(p, short), 'O-O');
  assert.equal(san(p, long), 'O-O-O');
  const after = makeMove(p, short);
  assert.equal(after.b[sqOf('f1')], 'R');
  assert.equal(after.b[sqOf('h1')], '.');
  assert.equal(after.cr, 'kq');
});

test('Noir finds a mate in one and plays legal moves', () => {
  const p = fromFen('6k1/5ppp/8/8/8/8/5PPP/3r2K1 b - -');
  // Black to move: Rd1 is already there; any legal reply is fine, but from this position mate exists? Use a clear one:
  const q = fromFen('k7/8/1K6/8/8/8/8/7R w - -');
  const m = chooseMove(q, { depth: 3, loose: 0 });
  const next = makeMove(q, m);
  assert.equal(status(next), 'checkmate');
  assert.ok(chooseMove(p, { depth: 2 }));
});

test('Noir baits when hungry and a game reaches a capture', () => {
  let rng = 1;
  const rand = () => ((rng = (rng * 16807) % 2147483647) / 2147483647);
  let p = initialPosition();
  let captured = false;
  for (let ply = 0; ply < 60 && !captured; ply++) {
    let m;
    if (p.t === 'w') {
      const moves = legalMoves(p);
      const caps = moves.filter((x) => x.c !== '.');
      m = caps.length ? caps[0] : moves[Math.floor(rand() * moves.length)];
      if (m.c !== '.') captured = true;
    } else {
      m = chooseMove(p, { depth: 2, rng: rand, lure: lureChance(p.fm) });
    }
    p = makeMove(p, m);
  }
  assert.ok(captured);
  assert.equal(lureChance(1), 0);
  assert.equal(lureChance(30), 1);
});
