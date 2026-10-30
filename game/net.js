// The room: who is here, who runs the simulation (the host), and the snapshots everyone draws. The host steps the Sim
// and writes it to room state 5 times a second; everyone else decodes those and sends commands to the host.

import { Sim, decodeWorld } from './sim.js';
import { MAX_SLOTS, DIFF_KEYS } from './config.js';
import { CHUNKS } from './codec.js';

const STEP = 0.05;
const PUBLISH = 0.2;

/** A room for a page opened outside Onceworlds (or the store pictures): one player, always the host. */
export function stubRoom() {
  const handlers = {};
  const me = { id: 'me', name: 'You', presence: null, team: 0, ready: false, connected: true };
  const players = new Map([['me', me]]);
  let t0 = performance.now();
  const room = {
    me,
    players,
    online: players,
    host: 'me',
    isHost: true,
    connected: true,
    kind: 'solo',
    state: {},
    private: {},
    match: { phase: 'lobby', n: 0, id: '', seed: 0, participants: [] },
    participants: [],
    spectators: [],
    spectating: false,
    canStart: true,
    allReady: true,
    notReady: [],
    get running() {
      return room.match.phase === 'playing';
    },
    matchNow: () => (room.match.phase === 'playing' ? performance.now() - t0 : 0),
    on(ev, fn) {
      (handlers[ev] ??= []).push(fn);
    },
    emit(ev, ...args) {
      for (const fn of handlers[ev] ?? []) fn(...args);
    },
    setState(k, v) {
      if (v === null) delete room.state[k];
      else room.state[k] = v;
    },
    setPresence() {},
    presenceAt: () => null,
    send() {},
    setReady() {},
    clearReady() {},
    admit() {},
    hideLobby() {},
    startMatch() {
      t0 = performance.now();
      const n = room.match.n + 1;
      room.match = { phase: 'playing', n, id: `solo${n}.${Date.now()}`, seed: Math.floor(Math.random() * 2 ** 31), participants: ['me'] };
      room.participants = ['me'];
      setTimeout(() => room.emit('matchstart', room.match), 0);
    },
    endMatch() {
      const previous = room.match;
      room.match = { phase: 'lobby', n: previous.n, id: '', seed: 0, participants: [] };
      room.participants = [];
      setTimeout(() => room.emit('matchend', room.match, previous), 0);
    },
    pauseMatch() {},
    leave() {},
  };
  return room;
}

export function createNet(ow, room, hooks) {
  const net = {
    room,
    sim: null,
    g: null,
    chunks: new Array(CHUNKS).fill(''),
    rocks: '',
    world: null,
    dirty: true,
    recvAt: 0,
    slots: {},
    acc: 0,
    sincePub: 0,
    lastPub: [],
    lastRocks: null,
    pending: new Map(), // my predicted moves: id → { x, y, at }
    savedCk: -1,
  };

  const matchId = () => room.match?.id ?? '';
  const playing = () => room.match?.phase === 'playing';

  net.mySlot = () => {
    const s = net.slots[room.me.id];
    return Number.isInteger(s) ? s : -1;
  };

  function readSlots() {
    const v = room.state['host:slots'];
    if (v && typeof v === 'object' && v.mid === matchId() && v.map && typeof v.map === 'object') {
      const out = {};
      for (const [id, s] of Object.entries(v.map)) if (Number.isInteger(s) && s >= 0 && s < MAX_SLOTS) out[id] = s;
      net.slots = out;
    } else if (!net.sim) net.slots = {};
  }

  function writeSlots() {
    room.setState('host:slots', { mid: matchId(), map: net.slots });
  }

  function activeSlotList() {
    return [...new Set(Object.values(net.slots))].sort();
  }

  // ---------------------------------------------------------------- the lobby (host's choices)

  net.lobby = () => {
    const v = room.state['host:lobby'];
    const diff = v && DIFF_KEYS.includes(v.diff) ? v.diff : 'normal';
    return { diff, resume: !!(v && v.resume) };
  };

  net.setLobby = (patch) => {
    if (!room.isHost) return;
    const before = net.lobby();
    const next = { ...before, ...patch };
    if (next.diff === before.diff && next.resume === before.resume) return;
    room.setState('host:lobby', next);
    // Friends ready up again when the difficulty changes, so they see it before they agree.
    if (next.diff !== before.diff) room.clearReady?.();
  };

  // ---------------------------------------------------------------- starting and adopting

  net.start = () => {
    if (!room.isHost || room.match.phase !== 'lobby') return false;
    if (!room.canStart) return false;
    room.startMatch({ countdown: 0, open: true });
    return true;
  };

  async function beginAsHost(match) {
    const ids = [room.host, ...(match.participants ?? []).filter((id) => id !== room.host)].filter((id) => room.players.has(id) || id === room.me.id);
    net.slots = {};
    ids.slice(0, MAX_SLOTS).forEach((id, i) => (net.slots[id] = i));
    const slots = activeSlotList();
    const lobby = net.lobby();
    let sim = null;
    if (lobby.resume && hooks.loadRun) {
      const save = await hooks.loadRun();
      if (save && save.ck) {
        sim = new Sim({ seed: save.seed, diff: save.diff, slots });
        if (!sim.restore(save.ck)) sim = null;
        else sim.stats.retries = save.retries ?? 0;
      }
    }
    if (!sim) sim = new Sim({ seed: (match.seed >>> 0) || 1, diff: lobby.diff, slots });
    if (room.match.id !== match.id || !room.isHost) return;
    net.sim = sim;
    for (let i = 0; i < CHUNKS; i++) {
      room.setState(`host:p${i}`, null);
      room.setState(`host:ck${i}`, null);
    }
    room.setState('host:r', null);
    room.setState('host:ckm', null);
    net.roomCk = -1;
    net.lastPub = [];
    net.lastRocks = null;
    writeSlots();
    publish(true);
    hooks.onSimStart?.(sim);
  }

  function readCheckpoint() {
    const meta = room.state['host:ckm'];
    if (!meta || typeof meta !== 'object' || meta.mid !== matchId()) return null;
    const pcs = [];
    for (let i = 0; i < CHUNKS; i++) pcs.push(typeof room.state[`host:ck${i}`] === 'string' ? room.state[`host:ck${i}`] : '');
    return { ...meta, pcs };
  }

  /** Take over as host from what the room holds (the old host left), or start a new run. */
  function adopt() {
    if (!room.isHost || !room.connected || !playing()) return;
    if (net.sim && net.simMid === matchId()) return;
    const g = room.state['host:g'];
    readSlots();
    if (g && g.mid === matchId()) {
      const chunks = [];
      for (let i = 0; i < CHUNKS; i++) chunks.push(room.state[`host:p${i}`] ?? '');
      const sim = Sim.fromRoom(g, chunks, room.state['host:r'] ?? '', activeSlotList().length ? activeSlotList() : [0], readCheckpoint());
      if (sim) {
        net.sim = sim;
        net.simMid = matchId();
        if (!Object.keys(net.slots).length) {
          net.slots[room.me.id] = 0;
          writeSlots();
        }
        hooks.onSimStart?.(sim);
        return;
      }
    }
    if (!net.starting) {
      net.starting = true;
      net.simMid = matchId();
      beginAsHost(room.match).finally(() => (net.starting = false));
    }
  }

  function drop() {
    net.sim = null;
    net.simMid = '';
  }

  // ---------------------------------------------------------------- publishing (host)

  function publish(force = false) {
    const sim = net.sim;
    if (!sim) return;
    const e = sim.encode();
    e.g.mid = matchId();
    e.g.by = room.me.id;
    room.setState('host:g', e.g);
    if (e.p) {
      for (let i = 0; i < CHUNKS; i++) {
        if (force || e.p[i] !== net.lastPub[i]) {
          room.setState(`host:p${i}`, e.p[i]);
          net.lastPub[i] = e.p[i];
        }
      }
    }
    if (e.r !== null && (force || e.r !== net.lastRocks)) {
      room.setState('host:r', e.r);
      net.lastRocks = e.r;
    }
    net.g = e.g;
    // The checkpoint lives in room state too, so a new host (or this page after a reload) can still retry from it.
    if (sim.ck && sim.ck.t !== net.roomCk) {
      net.roomCk = sim.ck.t;
      const { pcs, ...meta } = sim.ck;
      room.setState('host:ckm', { mid: matchId(), ...meta });
      pcs.forEach((chunk, i) => room.setState(`host:ck${i}`, chunk));
    }
    // Checkpoints go to the host's save, so the run can be picked up another day.
    if (sim.ck && sim.ck.t !== net.savedCk && hooks.saveRun) {
      net.savedCk = sim.ck.t;
      hooks.saveRun({ v: 1, seed: sim.seed, diff: sim.diffKey, ck: sim.ck, retries: sim.stats.retries, n: sim.ck.n, at: Date.now() });
    }
  }

  // ---------------------------------------------------------------- commands

  net.send = (msg) => {
    if (!playing()) return;
    if (net.sim && room.isHost) {
      const ok = net.sim.cmd(net.mySlot() >= 0 ? net.mySlot() : 0, msg);
      return ok;
    }
    if (msg.t === 'mv') net.pending.set(msg.id, { x: msg.x, y: msg.y, at: performance.now() });
    room.send(msg, { to: room.host });
    return true;
  };

  room.on('message', (data, from) => {
    if (!net.sim || !room.isHost || !data || typeof data !== 'object' || typeof data.t !== 'string') return;
    const id = typeof from === 'string' ? from : from?.id;
    const slot = net.slots[id];
    if (!Number.isInteger(slot)) return;
    net.sim.cmd(slot, data);
  });

  // ---------------------------------------------------------------- room events

  room.on('state', (key) => {
    if (key === 'host:g' || key.startsWith('host:p') || key === 'host:r') {
      net.dirty = true;
      if (key === 'host:g') net.recvAt = performance.now();
    }
    if (key === 'host:slots') readSlots();
    hooks.onState?.(key);
  });
  room.on('matchstart', () => {
    drop();
    adopt();
    hooks.onMatch?.();
  });
  room.on('matchend', () => {
    drop();
    net.g = null;
    net.world = null;
    hooks.onMatch?.();
  });
  room.on('host', () => {
    if (!room.isHost) drop();
    adopt();
    hooks.onMatch?.();
  });
  room.on('reconnect', () => {
    adopt();
    hooks.onMatch?.();
  });
  room.on('matchresume', adopt);
  room.on('disconnect', () => hooks.onMatch?.());
  room.on('leave', (player) => {
    if (!room.isHost || !net.sim || !(player.id in net.slots)) return;
    delete net.slots[player.id];
    const list = activeSlotList();
    if (list.length) net.sim.setSlots(list);
    writeSlots();
  });
  for (const ev of ['join', 'ready', 'rename', 'match', 'away', 'back', 'leave', 'open', 'error']) room.on(ev, () => hooks.onRoster?.());

  /** At a wave break the host seats friends who arrived mid-run, and players who came back after their seat was let go. */
  function admitLate() {
    const sim = net.sim;
    if (!sim || sim.phase !== 'rts' || sim.wave.st !== 'break') return;
    const idOf = (p) => (typeof p === 'string' ? p : p?.id);
    const watching = new Set((room.spectators ?? []).map(idOf));
    const online = [...room.players.values()].filter((p) => p && p.connected !== false && !(p.id in net.slots));
    if (!online.length) return;
    const used = new Set(Object.values(net.slots));
    const admitted = [];
    let changed = false;
    for (const p of online) {
      let s = 0;
      while (used.has(s) && s < MAX_SLOTS) s++;
      if (s >= MAX_SLOTS) break;
      used.add(s);
      net.slots[p.id] = s;
      changed = true;
      if (watching.has(p.id)) admitted.push(p.id);
    }
    if (!changed) return;
    if (admitted.length) room.admit(admitted);
    sim.setSlots(activeSlotList());
    writeSlots();
  }

  // ---------------------------------------------------------------- every frame

  net.update = (dt) => {
    if (room.isHost && playing() && !net.sim) adopt();
    if (net.sim && (!room.isHost || !playing())) drop();
    const sim = net.sim;
    if (sim && room.connected) {
      net.acc += Math.min(dt, 0.25);
      let n = 0;
      while (net.acc >= STEP && n++ < 6) {
        sim.step(STEP);
        net.acc -= STEP;
      }
      net.sincePub += dt;
      if (net.sincePub >= PUBLISH) {
        net.sincePub = 0;
        publish();
        admitLate();
      }
      net.world = sim.world;
      net.g = net.g ?? sim.encode().g;
      return;
    }
    if (net.dirty) {
      net.dirty = false;
      const g = room.state['host:g'];
      if (g && typeof g === 'object' && g.mid === matchId()) {
        net.g = g;
        if (g.ph !== 'chess' && !(g.ph === 'lost' && g.ch)) {
          const chunks = [];
          for (let i = 0; i < CHUNKS; i++) chunks.push(room.state[`host:p${i}`] ?? '');
          net.world = decodeWorld(g, chunks, room.state['host:r'] ?? '', net.world);
          applyPredictions();
        } else net.world = null;
      } else if (!playing()) {
        net.g = null;
        net.world = null;
      }
    }
  };

  function applyPredictions() {
    const w = net.world;
    if (!w) return;
    const now = performance.now();
    for (const [id, p] of net.pending) {
      const piece = w.pieces.get(id);
      if (!piece || now - p.at > 900 || (piece.x === p.x && piece.y === p.y)) {
        net.pending.delete(id);
        continue;
      }
      if (w.occ[p.y * 100 + p.x] !== 0) continue;
      w.occ[piece.y * 100 + piece.x] = 0;
      piece.x = p.x;
      piece.y = p.y;
      w.occ[p.y * 100 + p.x] = id;
    }
  }

  /** The simulation's time as this page should draw it. */
  net.time = () => {
    if (net.sim) return net.sim.t;
    const g = net.g;
    if (!g || typeof g.t !== 'number') return 0;
    if (g.pz) return g.t;
    return g.t + Math.min(0.6, (performance.now() - net.recvAt) / 1000);
  };

  net.adopt = adopt;
  net.publish = publish;
  return net;
}
