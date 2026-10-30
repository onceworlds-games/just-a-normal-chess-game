import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim, decodeWorld } from '../game/sim.js';
import { createAutopilot } from '../game/autopilot.js';
import { encodePieces, decodePieces, PIECE_LEN } from '../game/codec.js';
import { W, H, ST_AIR } from '../game/config.js';
import { integrity } from '../game/boss.js';

function run(sim, pilots, minutes, stop = () => false) {
  while (sim.t < minutes * 60 && sim.phase !== 'won' && !stop()) {
    for (const p of pilots) p();
    sim.step(0.05);
  }
}

function checkWorld(sim) {
  const w = sim.world;
  for (const p of w.pieces.values()) {
    assert.ok(Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.y >= 0 && p.x < W && p.y < H, `piece ${p.id} on the board`);
    assert.ok(Number.isFinite(p.cd), `piece ${p.id} cooldown`);
    assert.equal(w.occ[p.y * W + p.x], p.id, `piece ${p.id} is where the board says`);
  }
  let occupied = 0;
  for (let i = 0; i < W * H; i++) if (w.occ[i] > 0) occupied++;
  assert.equal(occupied, w.pieces.size, 'no ghosts on the board');
}

test('a whole game with one commander ends in checkmate', () => {
  const sim = new Sim({ seed: 11, diff: 'normal', slots: [0] });
  const pilot = createAutopilot(sim, 0, { skill: 0.85 });
  let checks = 0;
  while (sim.t < 120 * 60 && sim.phase !== 'won') {
    pilot();
    sim.step(0.05);
    if (++checks % 2000 === 0) checkWorld(sim);
    const e = sim.encode();
    if (checks % 500 === 0) {
      assert.ok(JSON.stringify(e.g).length < 15000, 'record under the room limit');
      if (e.p) for (const c of e.p) assert.ok(c.length < 15000, 'chunk under the room limit');
    }
  }
  assert.equal(sim.phase, 'won');
  assert.ok(sim.t > 20 * 60, `took ${(sim.t / 60).toFixed(1)} minutes`);
});

test('two players: pieces are split, both armies act, no errors', () => {
  const sim = new Sim({ seed: 5, diff: 'casual', slots: [0, 1] });
  const pilots = [createAutopilot(sim, 0, { seed: 1 }), createAutopilot(sim, 1, { seed: 2 })];
  run(sim, pilots, 12);
  const owners = new Set([...sim.world.pieces.values()].filter((p) => p.s === 'w').map((p) => p.o));
  assert.deepEqual([...owners].sort(), [0, 1]);
  assert.ok(sim.wave.n >= 3);
  checkWorld(sim);
});

test('players can only command their own pieces', () => {
  const sim = new Sim({ seed: 9, slots: [0, 1] });
  // Chess: slot 1 owns e-h, so it can't move the a-pawn.
  assert.equal(sim.cmd(1, { t: 'cm', from: 8, to: 16 }), false);
  assert.equal(sim.cmd(0, { t: 'cm', from: 8, to: 16 }), true);
  assert.equal(sim.cmd(3, { t: 'cm', from: 9, to: 17 }), false, 'an empty slot');
  assert.equal(sim.cmd(0, { t: 'nope' }), false);
  assert.equal(sim.cmd(0, null), false);
  // Battlefield: someone else's piece, a bad square, garbage.
  run(sim, [createAutopilot(sim, 0), createAutopilot(sim, 1)], 3, () => sim.phase === 'rts');
  const mine = [...sim.world.pieces.values()].find((p) => p.s === 'w' && p.o === 0);
  assert.equal(sim.cmd(1, { t: 'mv', id: mine.id, x: mine.x, y: mine.y - 1 }), false);
  assert.equal(sim.cmd(0, { t: 'mv', id: mine.id, x: 999, y: -5 }), false);
  assert.equal(sim.cmd(0, { t: 'go', o: 'x' }), false);
  assert.equal(sim.cmd(0, { t: 'promo', id: mine.id, k: 'k' }), false);
});

test('pieces survive the codec', () => {
  const sim = new Sim({ seed: 3, slots: [0] });
  run(sim, [createAutopilot(sim, 0)], 15);
  const parts = encodePieces(sim.world.pieces.values());
  for (const s of parts) assert.equal(s.length % PIECE_LEN, 0);
  const back = decodePieces(parts);
  assert.equal(back.size, sim.world.pieces.size);
  for (const p of sim.world.pieces.values()) {
    const q = back.get(p.id);
    assert.ok(q);
    for (const k of ['s', 'k', 'x', 'y', 'o', 'hp', 'f', 'st']) assert.equal(q[k], p[k], `${k} of ${p.id}`);
    assert.ok(Math.abs(q.cd - Math.max(0, p.cd)) < 0.06);
  }
  assert.equal(decodePieces(['garbage!']).size, 0);
});

test('a new host carries on from the room record, through the fight', () => {
  const sim = new Sim({ seed: 21, diff: 'normal', slots: [0] });
  const pilot = createAutopilot(sim, 0, { skill: 0.9 });
  run(sim, [pilot], 60, () => sim.wave.st === 'boss' && sim.t > sim.wave.t0 + 20);
  assert.equal(sim.wave.st, 'boss');
  const e = sim.encode();
  const g = JSON.parse(JSON.stringify(e.g));
  const next = Sim.fromRoom(g, e.p, e.r, [0]);
  assert.equal(next.phase, 'rts');
  assert.equal(next.wave.st, 'boss');
  assert.equal(next.world.pieces.size, sim.world.pieces.size);
  assert.ok(Math.abs(integrity(next.world.boss) - integrity(sim.world.boss)) < 0.001);
  const view = decodeWorld(g, e.p, e.r);
  assert.equal(view.pieces.size, sim.world.pieces.size);
  run(next, [createAutopilot(next, 0, { skill: 0.9 })], 200);
  assert.equal(next.phase, 'won');
});

test('a lost king goes back to the start of the wave', () => {
  const sim = new Sim({ seed: 8, slots: [0] });
  run(sim, [createAutopilot(sim, 0)], 30, () => sim.wave.n >= 3 && sim.wave.st === 'fight' && sim.t > sim.wave.t0 + 10);
  const n = sim.wave.n;
  const king = sim.world.pieces.get(sim.kingId);
  sim.kill(king, null);
  assert.equal(sim.phase, 'lost');
  assert.ok(sim.cmd(0, { t: 'retry' }));
  assert.equal(sim.phase, 'rts');
  assert.equal(sim.wave.n, n);
  assert.equal(sim.wave.st, 'fight');
  assert.ok(sim.world.pieces.get(sim.kingId), 'the king is back');
  checkWorld(sim);
  run(sim, [createAutopilot(sim, 0)], sim.t / 60 + 2);
  checkWorld(sim);
});

test('the board grows to 100x100 and summons land on open squares', () => {
  const sim = new Sim({ seed: 13, slots: [0] });
  const pilot = createAutopilot(sim, 0);
  let landed = 0;
  while (sim.t < 30 * 60 && sim.phase !== 'won') {
    pilot();
    sim.step(0.05);
    for (const p of sim.world.pieces.values()) if (p.st & ST_AIR) assert.equal(sim.world.terr[p.y * W + p.x], 0, 'lands on floor');
    if (sim.wave.n >= 1) landed++;
  }
  assert.deepEqual(sim.world.bounds, [0, 0, 99, 99]);
  assert.ok(landed > 0);
});
