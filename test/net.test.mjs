// Two pages in one room, without a browser: a fake hub carries state and messages between two real createNet()s.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNet } from '../game/net.js';
import { createAutopilot } from '../game/autopilot.js';
import { movesOf, active } from '../game/rules.js';

function hub() {
  const rooms = [];
  const state = {};
  const shared = { match: { phase: 'lobby', n: 0, id: '', seed: 0, participants: [] }, host: 'a' };
  function makeRoom(id) {
    const handlers = {};
    const me = { id, name: id.toUpperCase(), ready: false, connected: true };
    shared.ready ??= {};
    const room = {
      me,
      get players() {
        return new Map(rooms.map((r) => [r.me.id, r.me]));
      },
      get host() {
        return shared.host;
      },
      get isHost() {
        return shared.host === id;
      },
      connected: true,
      kind: 'private',
      state,
      get match() {
        return shared.match;
      },
      get spectators() {
        // Like the SDK: player objects, the connected players outside the match.
        if (shared.match.phase !== 'playing') return [];
        return rooms.map((r) => r.me).filter((p) => !shared.match.participants.includes(p.id));
      },
      get canStart() {
        // Like the SDK: everyone but the host has readied.
        return rooms.every((r) => r.me.id === shared.host || shared.ready[r.me.id]);
      },
      on(ev, fn) {
        (handlers[ev] ??= []).push(fn);
      },
      emit(ev, ...args) {
        for (const fn of handlers[ev] ?? []) fn(...args);
      },
      setState(k, v) {
        if (v === null) delete state[k];
        else state[k] = JSON.parse(JSON.stringify(v));
        for (const r of rooms) if (r !== room) r.emit('state', k, state[k], id);
      },
      send(data, opts) {
        const copy = JSON.parse(JSON.stringify(data));
        for (const r of rooms) if (r !== room && (!opts?.to || opts.to === r.me.id)) r.emit('message', copy, me, 0, 0);
      },
      setReady(on) {
        shared.ready[id] = !!on;
        me.ready = !!on;
      },
      clearReady() {
        for (const k of Object.keys(shared.ready)) shared.ready[k] = false;
      },
      admit(ids) {
        shared.match.participants = [...shared.match.participants, ...ids];
        shared.admitted = (shared.admitted ?? []).concat(ids);
      },
      startMatch() {
        shared.match = { phase: 'playing', n: 1, id: 'm1', seed: 4242, participants: rooms.map((r) => r.me.id) };
        for (const r of rooms) r.emit('matchstart', shared.match);
      },
      endMatch() {},
      setPresence() {},
    };
    rooms.push(room);
    return room;
  }
  return { makeRoom, shared, rooms };
}

test('a friend sees the host battle and moves their own pieces through it', async () => {
  const h = hub();
  const ra = h.makeRoom('a');
  const rb = h.makeRoom('b');
  const hooks = { loadRun: async () => null, saveRun: () => {} };
  const a = createNet(null, ra, hooks);
  const b = createNet(null, rb, hooks);
  // The friend readies; the host's Play (which writes its lobby choices first) must still start the match.
  assert.equal(a.start(), false, 'not before the friend is ready');
  rb.setReady(true);
  a.setLobby({ resume: false });
  assert.ok(ra.canStart, 'Play does not un-ready the friend');
  assert.ok(a.start());
  await new Promise((r) => setTimeout(r, 0));
  a.update(0.05);
  assert.ok(a.sim, 'the host runs the game');
  assert.equal(b.sim, null);
  assert.deepEqual(a.slots, { a: 0, b: 1 });
  b.update(0.05);
  assert.equal(b.mySlot(), 1, 'the friend knows their slot');
  assert.equal(b.g.ph, 'chess');
  // The friend (e-h files) plays the opening's first move through the room.
  b.send({ t: 'cm', from: 12, to: 28 });
  assert.equal(a.sim.chess.pos.b[28], 'P', 'the host applied the friend move');
  // Play on to the battlefield with both pilots acting on the host's simulation.
  const pa = createAutopilot(a.sim, 0, { seed: 1 });
  const pb = createAutopilot(a.sim, 1, { seed: 2 });
  for (let i = 0; i < 20 * 60 * 3 && !(a.sim.phase === 'battle' && a.sim.turn >= 3 && a.sim.side === 'w'); i++) {
    pa();
    pb();
    a.update(0.05);
    if (i % 4 === 0) b.update(0.05);
  }
  a.update(0.25);
  b.update(0.05);
  assert.equal(b.g.ph, 'battle');
  const hostWorld = a.sim.world;
  const view = b.world;
  assert.ok(view && view.pieces.size > 20);
  assert.equal(view.pieces.size, hostWorld.pieces.size, 'the friend sees every piece');
  for (const p of hostWorld.pieces.values()) {
    const q = view.pieces.get(p.id);
    assert.ok(q && q.x === p.x && q.y === p.y && q.k === p.k && q.o === p.o, `piece ${p.id}`);
  }
  // The friend moves one of their pieces with a legal move, as their page would.
  const mine = [...view.pieces.values()].find((p) => p.s === 'w' && p.o === 1 && active(p) && !(p.st & 2) && movesOf(view, p).some((m) => m.o === 0));
  assert.ok(mine, 'the friend has a ready piece');
  const m = movesOf(view, mine).find((mv) => mv.o === 0);
  b.send({ t: 'mv', id: mine.id, x: m.x, y: m.y });
  const moved = a.sim.world.pieces.get(mine.id);
  assert.ok(moved.x === m.x && moved.y === m.y, 'the host moved the friend piece');
  // Its own prediction shows it at once.
  b.dirty = true;
  b.update(0.01);
  assert.equal(b.world.pieces.get(mine.id).x, m.x);
  // The friend can't move the host's pieces.
  const hostPiece = [...view.pieces.values()].find((p) => p.s === 'w' && p.o === 0 && active(p) && !(p.st & 2) && movesOf(view, p).some((mv) => mv.o === 0));
  const hm = movesOf(view, hostPiece).find((mv) => mv.o === 0);
  b.send({ t: 'mv', id: hostPiece.id, x: hm.x, y: hm.y });
  assert.notEqual(a.sim.world.pieces.get(hostPiece.id).x * 1000 + a.sim.world.pieces.get(hostPiece.id).y, hm.x * 1000 + hm.y);
  // The host leaves: the friend takes over from the room's record and the battle goes on.
  a.update(0.25);
  const before = a.sim.world.pieces.size;
  const seqBefore = a.sim.seq;
  h.shared.host = 'b';
  rb.emit('host', 'b');
  b.update(0.05);
  assert.ok(b.sim, 'the friend is the host now');
  assert.equal(b.sim.world.pieces.size, before);
  assert.ok(b.sim.seq >= seqBefore, 'event numbers carry on');
  assert.ok(b.sim.ck && b.sim.ck.turn >= 1, 'the checkpoint came along');
  for (let i = 0; i < 400; i++) b.update(0.05);
  assert.equal(b.sim.phase, 'battle');
  // A fallen king retries from the checkpoint, not the opening.
  const ckTurn = b.sim.ck.turn;
  b.sim.kill(b.sim.world.pieces.get(b.sim.kingId), null);
  assert.ok(b.sim.retry());
  assert.equal(b.sim.phase, 'battle');
  assert.equal(b.sim.turn, ckTurn);
});

test('a friend who arrives mid-run is seated at the next wave break', async () => {
  const h = hub();
  const ra = h.makeRoom('a');
  const hooks = { loadRun: async () => null, saveRun: () => {} };
  const a = createNet(null, ra, hooks);
  a.start();
  await new Promise((r) => setTimeout(r, 0));
  a.update(0.05);
  const pilot = createAutopilot(a.sim, 0, { seed: 4 });
  for (let i = 0; i < 20000 && !(a.sim.phase === 'battle' && a.sim.turn >= 2); i++) {
    pilot();
    a.update(0.05);
  }
  const rc = h.makeRoom('c');
  createNet(null, rc, hooks);
  assert.ok(!('c' in a.slots));
  for (let i = 0; i < 40000 && !('c' in a.slots); i++) {
    pilot();
    a.update(0.05);
  }
  assert.equal(a.slots.c, 1, 'seated on White’s turn');
  assert.deepEqual(h.shared.admitted, ['c']);
  assert.ok([...a.sim.world.pieces.values()].some((p) => p.s === 'w' && p.o === 1), 'with a squad of their own');
});
