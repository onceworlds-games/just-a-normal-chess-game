import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim, decodeWorld } from '../game/sim.js';
import { createAutopilot, bestWhiteMove } from '../game/autopilot.js';
import { encodePieces, decodePieces, PIECE_LEN } from '../game/codec.js';
import { W, H, ST_MOVED } from '../game/config.js';
import { integrity } from '../game/boss.js';
import { movesOf } from '../game/rules.js';

function play(sim, pilots, stop, limit = 3 * 3600) {
  while (sim.t < limit && !stop()) {
    for (const p of pilots) p();
    sim.step(0.05);
  }
}
const toBattle = (sim, pilots) => play(sim, pilots, () => sim.phase === 'battle');

function checkWorld(sim) {
  const w = sim.world;
  for (const p of w.pieces.values()) {
    assert.ok(Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.y >= 0 && p.x < W && p.y < H, `piece ${p.id} on the board`);
    assert.equal(w.occ[p.y * W + p.x], p.id, `piece ${p.id} is where the board says`);
  }
  let n = 0;
  for (let i = 0; i < W * H; i++) if (w.occ[i] > 0) n++;
  assert.equal(n, w.pieces.size, 'no ghosts on the board');
}

test('whole games with one commander end in checkmate', () => {
  for (const [seed, diff] of [[11, 'casual'], [12, 'normal'], [21, 'normal']]) {
    const sim = new Sim({ seed, diff, slots: [0] });
    const pilot = createAutopilot(sim, 0, { skill: 0.85 });
    let n = 0;
    while (sim.t < 4 * 3600 && sim.phase !== 'won' && sim.stats.retries < 8) {
      pilot();
      sim.step(0.05);
      if (++n % 3000 === 0) {
        checkWorld(sim);
        const e = sim.encode();
        assert.ok(JSON.stringify(e.g).length < 15000, 'record under the room limit');
        if (e.p) for (const c of e.p) assert.ok(c.length < 15000, 'chunk under the room limit');
      }
    }
    assert.equal(sim.phase, 'won', `${diff} seed ${seed}`);
    assert.ok(sim.turn >= 8, `took ${sim.turn} turns`);
  }
});

test('a white turn: each piece moves once, undo puts it back, End turn hands over to Black', () => {
  const sim = new Sim({ seed: 3, slots: [0] });
  toBattle(sim, [createAutopilot(sim, 0)]);
  assert.equal(sim.side, 'w');
  const w = sim.world;
  const p = [...w.pieces.values()].find((q) => q.s === 'w' && movesOf(w, q).some((m) => m.o === 0));
  const m = movesOf(w, p).find((mv) => mv.o === 0);
  const [fx, fy] = [p.x, p.y];
  assert.ok(sim.cmd(0, { t: 'mv', id: p.id, x: m.x, y: m.y }));
  assert.ok(p.st & ST_MOVED);
  assert.equal(sim.cmd(0, { t: 'mv', id: p.id, x: fx, y: fy }), false, 'only once a turn');
  assert.ok(sim.cmd(0, { t: 'undo' }));
  assert.ok(p.x === fx && p.y === fy && !(p.st & ST_MOVED), 'undone');
  assert.ok(sim.cmd(0, { t: 'end' }));
  assert.equal(sim.side, 'b');
  assert.equal(sim.cmd(0, { t: 'mv', id: p.id, x: m.x, y: m.y }), false, 'not during Black’s turn');
  play(sim, [], () => sim.side === 'w');
  assert.equal(sim.turn, 2);
  assert.ok([...w.pieces.values()].every((q) => !(q.st & ST_MOVED)), 'everyone can move again');
  checkWorld(sim);
});

test('two players: own pieces only, and Black waits until both are done', () => {
  const sim = new Sim({ seed: 9, slots: [0, 1] });
  assert.equal(sim.cmd(1, { t: 'cm', from: 8, to: 16 }), false, 'slot 1 owns e-h in the opening');
  assert.equal(sim.cmd(3, { t: 'cm', from: 9, to: 17 }), false, 'an empty slot');
  toBattle(sim, [createAutopilot(sim, 0), createAutopilot(sim, 1)]);
  const w = sim.world;
  const mine = [...w.pieces.values()].find((p) => p.s === 'w' && p.o === 0 && movesOf(w, p).some((m) => m.o === 0));
  const m = movesOf(w, mine).find((mv) => mv.o === 0);
  assert.equal(sim.cmd(1, { t: 'mv', id: mine.id, x: m.x, y: m.y }), false);
  sim.cmd(0, { t: 'end' });
  assert.equal(sim.side, 'w', 'still waiting for slot 1');
  sim.cmd(1, { t: 'end' });
  assert.equal(sim.side, 'b');
  const owners = new Set([...w.pieces.values()].filter((p) => p.s === 'w').map((p) => p.o));
  assert.deepEqual([...owners].sort(), [0, 1]);
});

test('pieces survive the codec', () => {
  const sim = new Sim({ seed: 3, slots: [0] });
  play(sim, [createAutopilot(sim, 0)], () => sim.phase === 'battle' && sim.turn >= 6);
  const parts = encodePieces(sim.world.pieces.values());
  for (const s of parts) assert.equal(s.length % PIECE_LEN, 0);
  const back = decodePieces(parts);
  assert.equal(back.size, sim.world.pieces.size);
  for (const p of sim.world.pieces.values()) for (const k of ['s', 'k', 'x', 'y', 'o', 'hp', 'st', 'w']) assert.equal(back.get(p.id)[k], p[k], `${k} of ${p.id}`);
  assert.equal(decodePieces(['garbage!']).size, 0);
});

test('a new host carries on from the room record and wins', () => {
  const sim = new Sim({ seed: 21, slots: [0] });
  play(sim, [createAutopilot(sim, 0)], () => sim.phase === 'battle' && sim.turn >= 10 && sim.side === 'w');
  const e = sim.encode();
  const g = JSON.parse(JSON.stringify(e.g));
  const next = Sim.fromRoom(g, e.p, [0], sim.ck);
  assert.equal(next.phase, 'battle');
  assert.equal(next.turn, sim.turn);
  assert.equal(next.world.pieces.size, sim.world.pieces.size);
  assert.ok(Math.abs(integrity(next.world.boss) - integrity(sim.world.boss)) < 1e-9);
  assert.equal(decodeWorld(g, e.p).pieces.size, sim.world.pieces.size);
  play(next, [createAutopilot(next, 0)], () => next.phase === 'won' || next.stats.retries > 8, 4 * 3600);
  assert.equal(next.phase, 'won');
});

test('a fallen king goes back to the last checkpoint', () => {
  const sim = new Sim({ seed: 8, slots: [0] });
  play(sim, [createAutopilot(sim, 0)], () => sim.phase === 'battle' && sim.turn >= 7 && sim.side === 'w');
  const ckTurn = sim.ck.turn;
  const king = sim.world.pieces.get(sim.kingId);
  while (sim.phase === 'battle') sim.hit(king, null);
  assert.equal(sim.phase, 'lost');
  assert.ok(sim.cmd(0, { t: 'retry' }));
  assert.equal(sim.phase, 'battle');
  assert.equal(sim.turn, ckTurn);
  assert.ok(sim.world.pieces.get(sim.kingId), 'the king is back');
  checkWorld(sim);
});

test('the king has armour; the commander never walks into a capture it could avoid', () => {
  const sim = new Sim({ seed: 5, diff: 'normal', slots: [0] });
  toBattle(sim, [createAutopilot(sim, 0)]);
  const king = sim.world.pieces.get(sim.kingId);
  assert.equal(king.hp, 3);
  assert.equal(sim.hit(king, null), false);
  assert.equal(king.hp, 2);
  const pick = bestWhiteMove(sim, 0, { r: () => 0.5 });
  assert.ok(pick && pick.score > 0);
});
