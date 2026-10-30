// The whole game as the host's page runs it: the chess opening against Noir, the awakening, the growing battlefield,
// Black's ticks, the waves, the dragon, checkpoints. Pure: no page, no room. Players' pages send commands (cmd) and
// draw the host's snapshots (encode / Sim.decode).

import * as C from './config.js';
import { initialPosition, makeMove, findMove, san, status, legalMoves, boardString, parseBoard, typeOf, colorOf, clonePos } from './chess.js';
import { chooseMove, lureChance } from './ai.js';
import {
  makeWorld, open, idx, team, movesOf, attacksOf, attackedBy, placePiece, removePiece, movePieceTo, faceToward, dist, cheb, active, partAttacks,
  T_ROCK, T_THRONE, T_FLOOR, ALL8, DIRS4,
} from './rules.js';
import {
  makeBoss, PARTS, placeBoss, liftBoss, footprint, canLand, attackSquares, integrity, kingExposed, groupAlive,
  groupCount, WINDUP,
} from './boss.js';
import { WAVE_COUNT, WAVES, waveBursts, waveShots, reinforcements } from './waves.js';
import { generate, isThrone, isRing } from './world.js';
import { rngFor } from './rng.js';
import { encodePieces, decodePieces, encodePositions, decodePositions, encodeHp, decodeHp, isNum, clampInt } from './codec.js';

const { W, H } = C;
const KEEP_BOUNDS = [C.KEEP_X, C.KEEP_Y, C.KEEP_X + 7, C.KEEP_Y + 7];
const MAX_EVENTS = 160;
const BLACK_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

/** Which slot owns each file at the start, for n players: [a..h]. */
export function fileOwners(slots) {
  const n = Math.max(1, slots.length);
  const sizes = { 1: [8], 2: [4, 4], 3: [3, 2, 3], 4: [2, 2, 2, 2] }[Math.min(4, n)];
  const out = [];
  sizes.forEach((size, i) => {
    for (let k = 0; k < size; k++) out.push(slots[i] ?? 0);
  });
  return out;
}

export const chessToWorld = (sq) => ({ x: C.KEEP_X + (sq & 7), y: C.KEEP_Y + 7 - (sq >> 3) });

export class Sim {
  constructor({ seed = 1, diff = 'normal', slots = [0] } = {}) {
    this.seed = seed >>> 0;
    this.diffKey = C.DIFFICULTY[diff] ? diff : 'normal';
    this.diff = C.DIFFICULTY[this.diffKey];
    this.active = [false, false, false, false];
    for (const s of slots) if (s >= 0 && s < C.MAX_SLOTS) this.active[s] = true;
    if (!this.active.some(Boolean)) this.active[0] = true;
    this.t = 0;
    this.phase = 'chess';
    this.ev = [];
    this.evT = [];
    this.seq = 0;
    this.nextId = 1000;
    this.mat = [0, 0, 0, 0];
    this.caps = [0, 0, 0, 0];
    this.lost = [0, 0, 0, 0];
    this.dmg = [0, 0, 0, 0];
    this.auto = [true, true, true, true];
    this.stats = { retries: 0, waves: [] };
    this.result = null;
    this.world = makeWorld();
    this.world.bounds = KEEP_BOUNDS.slice();
    this.kingId = 0;
    this.castleAt = 0;
    this.awake = null;
    this.wave = { n: 0, st: 'none', t0: 0, until: 0, k: 0, rd: [], shots: 0 };
    this.grow = { side: 0, next: 0 };
    this.nextTick = 0;
    this.tickN = 0;
    this.hidden = [];
    this.ck = null;
    this.paused = false;
    this.startChess();
  }

  // ---------------------------------------------------------------- shared helpers

  slots() {
    const out = [];
    for (let s = 0; s < C.MAX_SLOTS; s++) if (this.active[s]) out.push(s);
    return out;
  }

  players() {
    return Math.max(1, this.slots().length);
  }

  emit(type, ...args) {
    this.ev.push([++this.seq, type, ...args]);
    this.evT.push(this.t);
    if (this.ev.length > MAX_EVENTS) {
      this.ev.splice(0, this.ev.length - MAX_EVENTS);
      this.evT.splice(0, this.evT.length - MAX_EVENTS);
    }
  }

  /** Events of the last few seconds (what a snapshot carries). */
  recentEvents(window = 2.5) {
    const out = [];
    for (let i = 0; i < this.ev.length; i++) if (this.evT[i] >= this.t - window) out.push(this.ev[i]);
    return out;
  }

  rng(tag, n = 0) {
    return rngFor(this.seed, tag, n, Math.round(this.t * 20));
  }

  newId() {
    return this.nextId++;
  }

  // ---------------------------------------------------------------- chess

  startChess() {
    const owners = fileOwners(this.slots());
    const own = new Array(64).fill(-1);
    for (let sq = 0; sq < 16; sq++) own[sq] = owners[sq & 7];
    this.phase = 'chess';
    this.chess = { pos: initialPosition(), own, moves: [], last: null, think: 0, wc: 600, bc: 600, turnT: this.t, capB: [], ply: 0 };
    this.result = null;
  }

  ownerOk(slot, owner) {
    return owner === slot || owner < 0 || !this.active[owner];
  }

  applyChess(m) {
    const ch = this.chess;
    const text = san(ch.pos, m);
    const own = ch.own.slice();
    const mover = own[m.from];
    own[m.to] = mover;
    own[m.from] = -1;
    if (m.ep) own[m.to + (ch.pos.t === 'w' ? -8 : 8)] = -1;
    if (m.castle === 'K') {
      own[m.from + 1] = own[m.from + 3];
      own[m.from + 3] = -1;
    } else if (m.castle === 'Q') {
      own[m.from - 1] = own[m.from - 4];
      own[m.from - 4] = -1;
    }
    const elapsed = this.t - ch.turnT;
    if (ch.pos.t === 'w') ch.wc = Math.max(0, ch.wc - elapsed);
    else ch.bc = Math.max(0, ch.bc - elapsed);
    ch.turnT = this.t;
    ch.pos = makeMove(ch.pos, m);
    ch.own = own;
    ch.moves.push(text);
    ch.last = [m.from, m.to];
    ch.ply++;
    this.emit('m', m.from, m.to, m.c !== '.' ? 1 : 0, text.includes('+') || text.includes('#') ? 1 : 0, m.castle ? 1 : 0);
    return text;
  }

  chessMove(slot, from, to, promo) {
    const ch = this.chess;
    if (this.phase !== 'chess' || ch.pos.t !== 'w') return false;
    if (!this.ownerOk(slot, ch.own[from])) return false;
    const m = findMove(ch.pos, from, to, promo);
    if (!m) return false;
    this.applyChess(m);
    const st = status(ch.pos);
    if (m.c !== '.' || st !== 'play') this.awaken(m.to);
    else ch.think = this.t + this.rng('think', ch.ply).range(0.6, 1.4);
    return true;
  }

  noirMove() {
    const ch = this.chess;
    const r = this.rng('noir', ch.ply);
    const loose = { casual: 90, normal: 30, hard: 8 }[this.diffKey];
    const m = chooseMove(ch.pos, { depth: this.diff.depth, rng: r, lure: lureChance(ch.pos.fm), loose, noMate: true });
    if (!m) {
      this.awaken(-1);
      return;
    }
    if (m.c !== '.') ch.capB.push(m.c);
    this.applyChess(m);
    const st = status(ch.pos);
    if (st === 'checkmate') this.lose('mate');
    else if (st !== 'play') this.awaken(-1);
  }

  // ---------------------------------------------------------------- the awakening

  awaken(capSq) {
    const ch = this.chess;
    const gen = generate(this.seed);
    this.gen = gen;
    const w = makeWorld();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (isThrone(x, y)) w.terr[y * W + x] = T_THRONE;
    for (const pos of gen.ring) w.terr[pos] = T_ROCK;
    for (const pos of gen.rocks) w.terr[pos] = T_ROCK;
    w.bounds = C.START_BOUNDS.slice();
    w.sealed = true;
    this.world = w;
    const ghosts = [];
    let id = 1;
    for (let sq = 0; sq < 64; sq++) {
      const p = ch.pos.b[sq];
      if (p === '.') continue;
      const { x, y } = chessToWorld(sq);
      if (colorOf(p) === 'w') {
        const owner = this.active[ch.own[sq]] ? ch.own[sq] : this.slots()[0];
        const piece = this.makePiece('w', typeOf(p), x, y, { id: id++, o: owner, cd: this.t + C.CINEMATIC });
        placePiece(w, piece);
        if (piece.k === 'k') this.kingId = piece.id;
      } else ghosts.push([typeOf(p), x, y]);
    }
    const boss = makeBoss(C.BOSS_X, C.BOSS_Y, 1);
    w.boss = boss;
    placeBoss(w, boss);
    this.hidden = gen.white.map((g) => ({ ...g, s: 'w' })).concat(gen.black.map((g) => ({ ...g, s: 'b' })));
    this.revealInside();
    const cap = capSq >= 0 ? chessToWorld(capSq) : { x: C.KEEP_X + 3, y: C.KEEP_Y + 3 };
    this.awake = { t0: this.t, gh: ghosts, cap: [cap.x, cap.y] };
    this.phase = 'awaken';
    this.emit('A');
  }

  beginRts() {
    this.phase = 'rts';
    this.wave = { n: 0, st: 'break', t0: this.t, until: this.t + C.FIRST_BREAK, k: 0, rd: [], shots: 0 };
    this.grow = { side: 0, next: this.t + C.GROW_EVERY };
    this.nextTick = this.t + C.BLACK_TICK;
    this.checkpoint();
  }

  makePiece(s, k, x, y, extra = {}) {
    return {
      id: extra.id ?? this.newId(),
      s,
      k,
      x,
      y,
      o: extra.o ?? -1,
      cd: extra.cd ?? this.t,
      hp: extra.hp ?? 1,
      mh: extra.mh ?? extra.hp ?? 1,
      f: extra.f ?? (s === 'w' ? faceToward(x, y, C.BOSS_X, C.BOSS_Y) : 2),
      st: extra.st ?? 0,
      w: extra.w ?? 0,
      c: 0,
      ox: -1,
      oy: -1,
      stuck: 0,
      na: 0,
      at: 0,
      as: 0,
      lt: extra.lt ?? this.t,
    };
  }

  // ---------------------------------------------------------------- the growing board

  inside(x, y, b = this.world.bounds) {
    return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
  }

  revealInside() {
    const keep = [];
    const w = this.world;
    for (const h of this.hidden) {
      if (!this.inside(h.x, h.y)) {
        keep.push(h);
        continue;
      }
      if (w.occ[idx(h.x, h.y)] !== 0 || w.terr[idx(h.x, h.y)] !== T_FLOOR) continue;
      const p = this.makePiece(h.s, h.k, h.x, h.y, { id: h.id, cd: this.t + 0.8 });
      if (h.s === 'w') p.o = this.ownerFor(p);
      else p.f = faceToward(p.x, p.y, C.KEEP_X + 4, C.KEEP_Y + 4);
      placePiece(w, p);
    }
    this.hidden = keep;
  }

  growBoard() {
    const b = this.world.bounds;
    const full = b[0] <= 0 && b[1] <= 0 && b[2] >= W - 1 && b[3] >= H - 1;
    if (full) return;
    for (let tries = 0; tries < 4; tries++) {
      const side = this.grow.side;
      this.grow.side = (side + 1) % 4;
      if (side === 0 && b[1] > 0) b[1]--;
      else if (side === 1 && b[2] < W - 1) b[2]++;
      else if (side === 2 && b[3] < H - 1) b[3]++;
      else if (side === 3 && b[0] > 0) b[0]--;
      else continue;
      this.emit('g', side);
      break;
    }
    this.revealInside();
  }

  /** The player a newly found white piece joins: the nearest army, weighted toward whoever holds the least. */
  ownerFor(p) {
    const slots = this.slots();
    if (slots.length === 1) return slots[0];
    const sum = slots.map(() => ({ x: 0, y: 0, n: 0, v: 0 }));
    for (const q of this.world.pieces.values()) {
      if (q.s !== 'w') continue;
      const i = slots.indexOf(q.o);
      if (i < 0) continue;
      sum[i].x += q.x;
      sum[i].y += q.y;
      sum[i].n++;
      sum[i].v += C.VALUE[q.k] + 1;
    }
    const avg = sum.reduce((a, s) => a + s.v, 0) / slots.length || 1;
    const king = this.world.pieces.get(this.kingId);
    let best = slots[0];
    let bestScore = Infinity;
    slots.forEach((s, i) => {
      const c = sum[i];
      const cx = c.n ? c.x / c.n : king ? king.x : C.KEEP_X + 4;
      const cy = c.n ? c.y / c.n : king ? king.y : C.KEEP_Y + 4;
      const score = dist(p.x, p.y, cx, cy) + 14 * (c.v / avg - 1);
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    });
    return best;
  }

  // ---------------------------------------------------------------- slots joining and leaving

  setSlots(list) {
    const next = [false, false, false, false];
    for (const s of list) if (s >= 0 && s < C.MAX_SLOTS) next[s] = true;
    if (!next.some(Boolean)) return;
    const added = [];
    for (let s = 0; s < C.MAX_SLOTS; s++) if (next[s] && !this.active[s]) added.push(s);
    this.active = next;
    if (this.phase === 'chess') {
      // Orphaned files stay movable by anyone (ownerOk); nothing to move.
      return;
    }
    // Pieces of players who left go to the others.
    for (const p of this.world.pieces.values()) {
      if (p.s === 'w' && !this.active[p.o]) p.o = this.ownerFor(p);
    }
    for (const s of added) if (this.phase === 'rts') this.dropSquad(s, reinforcements(Math.max(3, this.wave.n)).concat(['n', 'b']));
  }

  // ---------------------------------------------------------------- commands from players

  cmd(slot, msg) {
    if (!msg || typeof msg !== 'object' || !this.active[slot]) return false;
    switch (msg.t) {
      case 'cm':
        return this.chessMove(slot, clampInt(msg.from, 0, 63) ?? -1, clampInt(msg.to, 0, 63) ?? -1, typeof msg.promo === 'string' ? msg.promo : 'q');
      case 'mv':
        return this.cmdMove(slot, msg);
      case 'go':
        return this.cmdGo(slot, msg);
      case 'halt':
        return this.cmdHalt(slot, msg);
      case 'promo':
        return this.cmdPromo(slot, msg);
      case 'castle':
        return this.cmdCastle(slot);
      case 'ready':
        return this.cmdReady(slot, !!msg.on);
      case 'auto':
        this.auto[slot] = !!msg.on;
        return true;
      case 'retry':
        return this.retry();
      case 'resign':
        if (this.phase === 'chess') this.lose('resign');
        return true;
      case 'pause':
        this.paused = !!msg.on && this.players() === 1;
        return true;
      default:
        return false;
    }
  }

  ownPiece(slot, id) {
    const p = this.world.pieces.get(id);
    return p && p.s === 'w' && p.o === slot && active(p) ? p : null;
  }

  cmdMove(slot, msg) {
    if (this.phase !== 'rts') return false;
    const p = this.ownPiece(slot, msg.id);
    const x = clampInt(msg.x, 0, W - 1);
    const y = clampInt(msg.y, 0, H - 1);
    if (!p || x === null || y === null || this.t < p.cd - 0.15) return false;
    const m = movesOf(this.world, p).find((m) => m.x === x && m.y === y);
    if (!m) return false;
    p.st &= ~C.ST_ORDER;
    this.whiteMove(p, m);
    return true;
  }

  cmdGo(slot, msg) {
    if (this.phase !== 'rts' || !Array.isArray(msg.o)) return false;
    let n = 0;
    for (const entry of msg.o.slice(0, 400)) {
      if (!Array.isArray(entry)) continue;
      const p = this.ownPiece(slot, entry[0]);
      const x = clampInt(entry[1], 0, W - 1);
      const y = clampInt(entry[2], 0, H - 1);
      if (!p || x === null || y === null) continue;
      p.ox = x;
      p.oy = y;
      p.stuck = 0;
      p.st |= C.ST_ORDER;
      if (p.k === 'p' && (x !== p.x || y !== p.y)) p.f = faceToward(p.x, p.y, x, y);
      n++;
    }
    return n > 0;
  }

  cmdHalt(slot, msg) {
    if (!Array.isArray(msg.ids)) return false;
    for (const id of msg.ids.slice(0, 400)) {
      const p = this.ownPiece(slot, id);
      if (p) p.st &= ~C.ST_ORDER;
    }
    return true;
  }

  cmdPromo(slot, msg) {
    if (this.phase !== 'rts') return false;
    const p = this.ownPiece(slot, msg.id);
    const k = msg.k;
    const cost = C.PROMO_COST[k];
    if (!p || p.k !== 'p' || !cost || this.mat[slot] < cost) return false;
    this.mat[slot] -= cost;
    p.k = k;
    p.st |= C.ST_VET;
    p.cd = this.t + 0.6;
    this.emit('P', idx(p.x, p.y), k);
    return true;
  }

  cmdCastle(slot) {
    if (this.phase !== 'rts' || this.t < this.castleAt) return false;
    const king = this.ownPiece(slot, this.kingId);
    if (!king) return false;
    let rook = null;
    let best = Infinity;
    const danger = this.dangerMap();
    for (const q of this.world.pieces.values()) {
      if (q.s !== 'w' || q.k !== 'r' || !active(q) || (q.o !== slot && this.slots().length > 1 && this.active[q.o])) continue;
      // The nearest rook standing somewhere safe; an unsafe one only if there is nothing else.
      const unsafe = danger.has(idx(q.x, q.y)) || attackedBy(this.world, q.x, q.y, 1, king.id);
      const d = dist(q.x, q.y, king.x, king.y) + (unsafe ? 1000 : 0);
      if (d < best) {
        best = d;
        rook = q;
      }
    }
    if (!rook) return false;
    const kx = king.x;
    const ky = king.y;
    const w = this.world;
    w.occ[idx(kx, ky)] = 0;
    w.occ[idx(rook.x, rook.y)] = 0;
    king.x = rook.x;
    king.y = rook.y;
    rook.x = kx;
    rook.y = ky;
    w.occ[idx(king.x, king.y)] = king.id;
    w.occ[idx(rook.x, rook.y)] = rook.id;
    king.cd = this.t + 1;
    rook.cd = this.t + 1;
    king.st &= ~C.ST_ORDER;
    rook.st &= ~C.ST_ORDER;
    this.castleAt = this.t + C.CASTLE_CD;
    this.emit('K', idx(king.x, king.y), idx(rook.x, rook.y));
    return true;
  }

  cmdReady(slot, on) {
    if (this.phase !== 'rts' || this.wave.st !== 'break') return false;
    const rd = new Set(this.wave.rd);
    if (on) rd.add(slot);
    else rd.delete(slot);
    this.wave.rd = [...rd].sort();
    return true;
  }

  // ---------------------------------------------------------------- moves and captures

  /** A white piece makes move m (already checked legal). */
  whiteMove(p, m) {
    const w = this.world;
    let cd = C.CD[p.k];
    if (m.o > 0) {
      const q = w.pieces.get(m.o);
      if (q && q.hp > 1) {
        q.hp--;
        cd *= C.STRIKE_CD;
        this.emit('k', idx(q.x, q.y), idx(p.x, p.y), q.hp);
      } else if (q) {
        this.kill(q, p);
        movePieceTo(w, p, m.x, m.y);
        p.c++;
        if (p.o >= 0) {
          this.mat[p.o] += C.VALUE[q.k] || 1;
          this.caps[p.o]++;
        }
        if (p.k === 'p' && p.c >= C.PAWN_PROMOTES) this.promote(p, 'q');
      }
    } else if (m.o < 0) {
      this.strikePart(p, -m.o - 1);
      cd *= C.STRIKE_CD;
    } else {
      movePieceTo(w, p, m.x, m.y);
    }
    if (p.k === 'p' && !(p.st & C.ST_ORDER) && w.boss) {
      // An idle pawn turns back toward the dragon once it is level with it on its own axis.
      const f = p.f;
      const [fx, fy] = DIRS4[f];
      if ((fx && Math.sign(w.boss.x - p.x) !== fx) || (fy && Math.sign(w.boss.y - p.y) !== fy)) p.f = faceToward(p.x, p.y, w.boss.x, w.boss.y);
    }
    p.cd = this.t + cd;
    p.at = 0;
  }

  promote(p, k) {
    p.k = k;
    p.st |= C.ST_VET;
    this.emit('P', idx(p.x, p.y), k);
  }

  kill(victim, killer) {
    const w = this.world;
    this.emit('x', idx(victim.x, victim.y), victim.k, victim.s, killer ? killer.s : '-');
    removePiece(w, victim);
    if (victim.s === 'w') {
      if (victim.o >= 0) this.lost[victim.o]++;
      if (victim.id === this.kingId) this.lose('king');
    }
  }

  strikePart(p, i) {
    const boss = this.world.boss;
    const part = boss?.parts[i];
    if (!part || part.hp <= 0) return;
    const dmg = C.DAMAGE[p.k] + (p.st & C.ST_VET ? 1 : 0);
    part.hp = Math.max(0, part.hp - dmg);
    if (p.o >= 0) this.dmg[p.o] += dmg;
    this.emit('h', i, dmg, idx(p.x, p.y));
    if (part.hp <= 0) this.breakPart(part, p.o);
  }

  breakPart(part, slot) {
    const w = this.world;
    const boss = w.boss;
    const x = boss.x + part.dx;
    const y = boss.y + part.dy;
    if (boss.grounded && w.occ[idx(x, y)] === -(part.i + 1)) w.occ[idx(x, y)] = 0;
    this.emit('B', part.i);
    if (slot >= 0) this.mat[slot] += 5;
    if (part.g === 'king') {
      this.win();
      return;
    }
    if (!groupAlive(boss, part.g)) this.emit('G', part.g);
  }

  // ---------------------------------------------------------------- Black's tick

  whites() {
    const out = [];
    for (const p of this.world.pieces.values()) if (p.s === 'w' && active(p)) out.push(p);
    return out;
  }

  targetFor(a, whites, king) {
    let best = null;
    let bd = Infinity;
    for (const q of whites) {
      const d = dist(a.x, a.y, q.x, q.y);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    if (king && dist(a.x, a.y, king.x, king.y) < Math.min(bd + 4, 14)) return king;
    return best;
  }

  blackTurn() {
    const w = this.world;
    const r = rngFor(this.seed, 'tick', this.tickN++);
    const whites = this.whites();
    const king = w.pieces.get(this.kingId);
    const actors = [];
    for (const p of w.pieces.values()) {
      if (p.s === 'w' || !active(p) || p.st & C.ST_GHOST) continue;
      if (this.t - (p.lt ?? -99) < C.SUMMON_SICK) continue;
      actors.push(p);
    }
    r.shuffle(actors);
    const taken = new Set();
    const claimed = new Set();
    const plans = [];
    const planned = new Set();
    const cunning = this.diff.cunning;
    // Captures first: every black piece that can take something does.
    for (const a of actors) {
      let best = null;
      let bv = -1;
      for (const m of movesOf(w, a)) {
        if (m.o <= 0 || taken.has(m.o)) continue;
        const q = w.pieces.get(m.o);
        if (!q || q.s !== 'w') continue;
        const v = (q.id === this.kingId ? 100 : BLACK_VALUE[q.k]) + r() * 0.5;
        if (v > bv) {
          bv = v;
          best = m;
        }
      }
      if (best) {
        taken.add(best.o);
        claimed.add(idx(best.x, best.y));
        plans.push([a, best]);
        planned.add(a.id);
      }
    }
    // Then everyone else closes in on its prey.
    for (const a of actors) {
      if (planned.has(a.id) || !whites.length) continue;
      const target = this.targetFor(a, whites, king);
      if (!target) continue;
      const cur = dist(a.x, a.y, target.x, target.y);
      const careful = r() < cunning;
      let best = null;
      let bs = cur + (careful && attackedBy(w, a.x, a.y, 0) ? 3 : 0) - 0.05;
      for (const m of movesOf(w, a)) {
        if (m.o !== 0 || claimed.has(idx(m.x, m.y))) continue;
        let s = dist(m.x, m.y, target.x, target.y) + r() * 0.35;
        if (careful && attackedBy(w, m.x, m.y, 0, a.id)) s += 3;
        if (s < bs) {
          bs = s;
          best = m;
        }
      }
      if (best) {
        claimed.add(idx(best.x, best.y));
        plans.push([a, best]);
      }
    }
    // Everything happens at once.
    for (const [a, m] of plans) {
      if (m.o > 0) {
        const q = w.pieces.get(m.o);
        if (!q || this.phase !== 'rts') continue;
        this.kill(q, a);
        if (!w.pieces.has(a.id)) continue;
        movePieceTo(w, a, m.x, m.y);
        a.c++;
        if (a.k === 'p' && a.c >= C.BLACK_PAWN_PROMOTES) this.promote(a, 'q');
      }
    }
    for (const [a, m] of plans) {
      if (m.o === 0 && w.pieces.has(a.id) && w.occ[idx(m.x, m.y)] === 0) movePieceTo(w, a, m.x, m.y);
    }
    // The dragon's own pieces strike whatever stands where they attack.
    if (w.bossArmed && w.boss && this.phase === 'rts') {
      const boss = w.boss;
      const sq = [];
      // It strikes a few times per tick, more as it gets desperate.
      let strikes = Math.round(({ 1: 1, 2: 2, 3: 2 }[boss.ph] ?? 1) * (1 + 0.3 * (this.players() - 1)) * (this.diffKey === 'hard' ? 1.3 : this.diffKey === 'casual' ? 0.7 : 1));
      for (const part of r.shuffle(boss.parts.filter((p) => p.hp > 0))) {
        if (strikes <= 0) break;
        partAttacks(w, part, boss.x + part.dx, boss.y + part.dy, sq);
        let best = null;
        let bv = -1;
        for (const s of sq) {
          const o = w.occ[idx(s.x, s.y)];
          if (o <= 0) continue;
          const q = w.pieces.get(o);
          if (!q || q.s !== 'w' || !active(q)) continue;
          const v = (q.id === this.kingId ? 100 : BLACK_VALUE[q.k]) + r() * 0.5;
          if (v > bv) {
            bv = v;
            best = q;
          }
        }
        if (best) {
          strikes--;
          this.emit('y', part.i, idx(best.x, best.y));
          this.kill(best, null);
          if (this.phase !== 'rts') return;
        }
      }
    }
    // Pawns turn toward their prey for the next tick (what the red squares show until then).
    const after = this.whites();
    for (const a of actors) {
      if (a.k !== 'p' || !w.pieces.has(a.id)) continue;
      const target = this.targetFor(a, after, w.pieces.get(this.kingId));
      if (!target) continue;
      const f1 = faceToward(a.x, a.y, target.x, target.y);
      const [fx, fy] = DIRS4[f1];
      const free = (f) => {
        const [ax, ay] = DIRS4[f];
        return open(w, a.x + ax, a.y + ay) && w.occ[idx(a.x + ax, a.y + ay)] === 0;
      };
      if (free(f1)) a.f = f1;
      else {
        const dx = target.x - a.x;
        const dy = target.y - a.y;
        const f2 = f1 === 0 || f1 === 2 ? (dx > 0 ? 1 : dx < 0 ? 3 : f1) : dy > 0 ? 2 : dy < 0 ? 0 : f1;
        if (free(f2)) a.f = f2;
        else {
          // Boxed in on both useful sides: turn to any open side, the one that loses least ground.
          const opts = [0, 1, 2, 3].filter(free).sort((p, q) => {
            const [px, py] = DIRS4[p];
            const [qx, qy] = DIRS4[q];
            return dist(a.x + px, a.y + py, target.x, target.y) - dist(a.x + qx, a.y + qy, target.x, target.y);
          });
          a.f = opts.length ? opts[0] : f2;
        }
      }
    }
    this.emit('T', plans.length);
  }

  // ---------------------------------------------------------------- white pieces acting by themselves

  safeCapture(p, m) {
    const w = this.world;
    if (m.o < 0) return true;
    const q = w.pieces.get(m.o);
    if (!q) return false;
    if (q.hp > 1) return true; // a strike: it stays where it is
    if (q.st & C.ST_GHOST || this.regicides?.has(q.id)) return true;
    const exposed = attackedBy(w, m.x, m.y, 1, p.id);
    if (p.id === this.kingId) return !exposed;
    return !exposed || (C.VALUE[q.k] || 1) >= C.VALUE[p.k];
  }

  bestCapture(p, moves) {
    const w = this.world;
    let best = null;
    let bv = -Infinity;
    for (const m of moves) {
      if (m.o === 0 || !this.safeCapture(p, m)) continue;
      let v;
      if (m.o > 0) {
        const q = w.pieces.get(m.o);
        v = (q.st & C.ST_GHOST ? 20 : C.VALUE[q.k] || 1) + 10 + (this.regicides?.has(q.id) ? 100 : 0);
      } else {
        const part = w.boss.parts[-m.o - 1];
        v = (part.g === 'king' ? 15 : 5) + 4 / Math.max(1, part.hp);
      }
      if (v > bv) {
        bv = v;
        best = m;
      }
    }
    return best;
  }

  /** Squares under a telegraphed attack → the soonest impact time. */
  dangerMap() {
    const boss = this.world.boss;
    const map = new Map();
    if (!boss || !boss.atk.length) return map;
    for (const atk of boss.atk) {
      for (const pos of attackSquares(this.world, atk)) {
        const t1 = map.get(pos);
        if (t1 === undefined || atk.t1 < t1) map.set(pos, atk.t1);
      }
    }
    return map;
  }

  automate() {
    const w = this.world;
    const danger = this.dangerMap();
    this.danger = danger;
    const king = w.pieces.get(this.kingId);
    if (king && active(king) && this.t >= king.cd && this.diff.reflex >= 0) {
      // The king's reflex: threatened, it steps to safety by itself after a moment (never on Hard).
      const threatened = danger.has(idx(king.x, king.y)) || attackedBy(w, king.x, king.y, 1);
      if (!threatened) king.th = 0;
      else if (!king.th) king.th = this.t;
      else if (this.t - king.th >= this.diff.reflex) {
        king.th = 0;
        if (!this.dodge(king, danger, true) && this.t >= this.castleAt) this.cmdCastle(king.o);
      }
    }
    // The royal guard: whoever can take a piece that attacks the king does, at once.
    const regicides = new Set();
    if (king && active(king) && attackedBy(w, king.x, king.y, 1)) {
      const sq = [];
      for (const q of w.pieces.values()) {
        if (q.s === 'w' || !active(q) || cheb(q.x, q.y, king.x, king.y) > C.REACH) continue;
        if (attacksOf(w, q, sq).some((a) => a.x === king.x && a.y === king.y)) regicides.add(q.id);
      }
    }
    this.regicides = regicides;
    for (const p of w.pieces.values()) {
      if (p.s !== 'w' || !active(p) || this.t < p.cd || this.t < p.na) continue;
      p.na = this.t + 0.25;
      const hit = danger.get(idx(p.x, p.y));
      const autoOn = this.auto[p.o] || !this.active[p.o];
      if (hit !== undefined) {
        // In the line of an attack: hold the strike, and step out when it is about to land (the king at once).
        if (p.id !== this.kingId && autoOn && hit - this.t < 1.4) this.dodge(p, danger);
        continue;
      }
      if (p.st & C.ST_ORDER) {
        this.march(p);
        continue;
      }
      if (!autoOn) continue;
      const moves = movesOf(w, p);
      const cap = this.bestCapture(p, moves);
      if (!cap) {
        p.at = 0;
        continue;
      }
      const key = cap.o;
      if (key > 0 && this.regicides.has(key)) {
        this.whiteMove(p, cap);
        continue;
      }
      if (p.at !== key) {
        p.at = key;
        p.as = this.t;
        continue;
      }
      if (this.t - p.as >= C.AUTO_DELAY) this.whiteMove(p, cap);
    }
  }

  dodge(p, danger, royal = false) {
    const w = this.world;
    let best = null;
    let bs = Infinity;
    for (const m of movesOf(w, p)) {
      if (danger.has(idx(m.x, m.y))) continue;
      if (m.o !== 0 && !this.safeCapture(p, m)) continue;
      const exposed = attackedBy(w, m.x, m.y, 1, p.id);
      if (royal && exposed) continue;
      let s = exposed ? 5 : 0;
      if (m.o < 0) s += 3; // a strike leaves it standing where it is
      s += dist(m.x, m.y, p.x, p.y) * 0.1;
      if (s < bs) {
        bs = s;
        best = m;
      }
    }
    if (best && best.o >= 0) {
      this.whiteMove(p, best);
      return true;
    }
    return false;
  }

  march(p) {
    const w = this.world;
    const tx = p.ox;
    const ty = p.oy;
    const moves = movesOf(w, p);
    const cap = this.bestCapture(p, moves);
    if (cap) {
      this.whiteMove(p, cap);
      if (cap.o > 0 && p.x === tx && p.y === ty) p.st &= ~C.ST_ORDER;
      return;
    }
    const cur = dist(p.x, p.y, tx, ty);
    if (cur < 0.5 || (p.k === 'n' && cur < 1.5)) {
      p.st &= ~C.ST_ORDER;
      return;
    }
    let best = null;
    let bs = cur - 0.4;
    for (const m of moves) {
      if (m.o !== 0 || this.danger?.has(idx(m.x, m.y))) continue;
      let s = dist(m.x, m.y, tx, ty);
      if (p.id === this.kingId ? attackedBy(w, m.x, m.y, 1, p.id) : attackedBy(w, m.x, m.y, 1, p.id) && C.VALUE[p.k] >= 3) s += p.id === this.kingId ? 99 : 2.5;
      if (s < bs) {
        bs = s;
        best = m;
      }
    }
    if (best) {
      p.stuck = 0;
      this.whiteMove(p, best);
      if (dist(p.x, p.y, tx, ty) < 0.5) p.st &= ~C.ST_ORDER;
    } else if (++p.stuck >= 4) p.st &= ~C.ST_ORDER;
  }

  // ---------------------------------------------------------------- summons

  /** A free square near[0]-near[1] squares from `anchor` (or from a random white piece). */
  landingSquare(r, near, reserved, anchor = null) {
    const w = this.world;
    const whites = this.whites();
    const king = w.pieces.get(this.kingId);
    for (let tries = 0; tries < 50 && whites.length; tries++) {
      const t = anchor && tries < 40 ? anchor : r.pick(whites);
      const a = r() * Math.PI * 2;
      const d = r.range(near[0], near[1]);
      const x = Math.round(t.x + Math.cos(a) * d);
      const y = Math.round(t.y + Math.sin(a) * d);
      if (!open(w, x, y) || w.occ[idx(x, y)] !== 0 || reserved.has(idx(x, y))) continue;
      if (king && cheb(x, y, king.x, king.y) < 3) continue;
      let crowded = false;
      for (const pos of reserved) if (cheb(x, y, pos % W, Math.floor(pos / W)) < 2) crowded = true;
      if (crowded && tries < 40) continue;
      return { x, y };
    }
    return this.edgeSquare(r, reserved);
  }

  /** A free square on the board's edge, on the side nearest a random white piece. */
  edgeSquare(r, reserved) {
    const w = this.world;
    const b = w.bounds;
    const whites = this.whites();
    for (let tries = 0; tries < 60; tries++) {
      const t = whites.length ? r.pick(whites) : { x: (b[0] + b[2]) >> 1, y: (b[1] + b[3]) >> 1 };
      const sides = [t.y - b[1], b[2] - t.x, b[3] - t.y, t.x - b[0]];
      let side = sides.indexOf(Math.min(...sides));
      if (r() < 0.35) side = r.int(4);
      const jitter = r.int(13) - 6;
      let x;
      let y;
      if (side === 0) [x, y] = [t.x + jitter, b[1] + r.int(2)];
      else if (side === 1) [x, y] = [b[2] - r.int(2), t.y + jitter];
      else if (side === 2) [x, y] = [t.x + jitter, b[3] - r.int(2)];
      else [x, y] = [b[0] + r.int(2), t.y + jitter];
      if (!open(w, x, y) || w.occ[idx(x, y)] !== 0 || reserved.has(idx(x, y))) continue;
      return { x, y };
    }
    return null;
  }

  summon(list, { edge = false, near = [4, 7], wave = 0, tag = 'sum' } = {}) {
    const r = this.rng(tag, this.nextId);
    const reserved = new Set();
    const w = this.world;
    let n = 0;
    let anchor = null;
    const whites = this.whites();
    for (const spec of list) {
      // Each group of up to 8 converges on one white piece: an assault, not a drizzle.
      if (n % 8 === 0 && whites.length) anchor = r.pick(whites);
      const sq = edge ? this.edgeSquare(r, reserved) : this.landingSquare(r, near, reserved, anchor);
      if (!sq) continue;
      reserved.add(idx(sq.x, sq.y));
      const land = this.t + C.SUMMON_FLIGHT + n * 0.06;
      const king = w.pieces.get(this.kingId);
      const p = this.makePiece('b', spec.k, sq.x, sq.y, {
        hp: spec.hp ?? 1,
        st: C.ST_AIR | (spec.elite ? C.ST_ELITE : 0) | (edge ? 32 : 0),
        cd: land,
        lt: land,
        w: wave,
        f: king ? faceToward(sq.x, sq.y, king.x, king.y) : 2,
      });
      placePiece(w, p);
      n++;
    }
    if (n) this.emit('S', n, edge ? 1 : 0);
    return n;
  }

  dropSquad(slot, kinds) {
    const w = this.world;
    const r = this.rng('squad', slot * 31 + this.nextId);
    let cx = 0;
    let cy = 0;
    let n = 0;
    for (const p of w.pieces.values()) {
      if (p.s === 'w' && p.o === slot) {
        cx += p.x;
        cy += p.y;
        n++;
      }
    }
    const king = w.pieces.get(this.kingId);
    if (n) {
      cx = Math.round(cx / n);
      cy = Math.round(cy / n);
    } else if (king) {
      cx = king.x;
      cy = king.y;
    } else {
      cx = C.KEEP_X + 4;
      cy = C.KEEP_Y + 4;
    }
    let placed = 0;
    for (let ring = 1; ring < 12 && placed < kinds.length; ring++) {
      for (let tries = 0; tries < 24 && placed < kinds.length; tries++) {
        const x = cx + r.int(ring * 2 + 1) - ring;
        const y = cy + r.int(ring * 2 + 1) - ring;
        if (!open(this.world, x, y) || w.occ[idx(x, y)] !== 0 || attackedBy(w, x, y, 1)) continue;
        const land = this.t + 1.2 + placed * 0.08;
        placePiece(w, this.makePiece('w', kinds[placed], x, y, { o: slot, st: C.ST_AIR, cd: land, lt: land }));
        placed++;
      }
    }
    return placed;
  }

  land() {
    for (const p of this.world.pieces.values()) {
      if (p.st & C.ST_AIR && this.t >= p.cd) {
        p.st &= ~C.ST_AIR;
        p.lt = this.t;
        if (p.s === 'w') p.cd = this.t + 0.4;
      }
    }
  }

  // ---------------------------------------------------------------- waves

  startWave(n) {
    this.wave = { n, st: 'fight', t0: this.t, until: 0, k: 0, rd: [], shots: 0 };
    this.stats.waves[n - 1] = this.t;
    this.emit('W', n);
    this.checkpoint();
  }

  waveLogic() {
    const wv = this.wave;
    if (wv.st === 'break') {
      const ready = this.slots().every((s) => wv.rd.includes(s));
      if (this.t >= wv.until || ready) this.startWave(wv.n + 1);
    } else if (wv.st === 'fight') {
      const bursts = waveBursts(wv.n, this.diffKey, this.players());
      while (wv.k < bursts.length && this.t >= wv.t0 + bursts[wv.k].at) {
        const b = bursts[wv.k];
        this.summon(b.pieces, { edge: b.edge, near: b.near, wave: wv.n, tag: `w${wv.n}.${wv.k}` });
        wv.k++;
      }
      const shots = waveShots(wv.n);
      while (wv.shots < shots.length && this.t >= wv.t0 + shots[wv.shots].at) {
        this.planAttack(shots[wv.shots].kind, 1.2);
        wv.shots++;
      }
      if (wv.k >= bursts.length) {
        let left = 0;
        for (const p of this.world.pieces.values()) if (p.s === 'b' && p.w === wv.n) left++;
        // Stragglers that never reach anyone stop holding the wave up.
        if (left && this.t > wv.t0 + bursts[bursts.length - 1].at + 75) {
          for (const p of this.world.pieces.values()) if (p.s === 'b' && p.w === wv.n) p.w = 0;
          left = 0;
        }
        if (!left) this.clearWave();
      }
    } else if (wv.st === 'bossintro') {
      if (!wv.k && this.t >= wv.t0 + 2.5) {
        wv.k = 1;
        this.wakeRocks();
      }
      if (this.t >= wv.t0 + C.BOSS_INTRO) this.startBoss();
    }
  }

  clearWave() {
    const n = this.wave.n;
    this.emit('C', n);
    if (n >= WAVE_COUNT) {
      this.wave = { n, st: 'bossintro', t0: this.t, until: this.t + C.BOSS_INTRO, k: 0, rd: [], shots: 0 };
      this.emit('I', 0);
      return;
    }
    this.wave = { n, st: 'break', t0: this.t, until: this.t + C.BREAK, k: 0, rd: [], shots: 0 };
    for (const s of this.slots()) this.dropSquad(s, reinforcements(n));
  }

  wakeRocks() {
    const w = this.world;
    const r = rngFor(this.seed, 'rocks');
    const ring = (this.gen ?? generate(this.seed)).ring;
    let k = 0;
    for (const pos of ring) {
      if (w.terr[pos] !== T_ROCK) continue;
      w.terr[pos] = T_FLOOR;
      const x = pos % W;
      const y = Math.floor(pos / W);
      if (r() < 0.13 && w.occ[pos] === 0 && this.inside(x, y)) {
        placePiece(w, this.makePiece('s', 'r', x, y, { hp: 2, mh: 2, lt: this.t + 1 }));
        k++;
      }
    }
    w.sealed = false;
    this.emit('I', 1, k);
  }

  startBoss() {
    const w = this.world;
    const boss = w.boss;
    const mult = this.diff.boss * C.bossScale(this.players());
    boss.parts.forEach((p, i) => {
      p.mh = Math.round(PARTS[i].hp * mult);
      p.hp = p.mh;
    });
    boss.mm = mult;
    boss.ph = 1;
    // The board rallies: whoever arrives short of an army gets one, so the fight (and its checkpoint) can be won.
    const want = Math.round(140 * C.playerScale(this.players()));
    const have = this.whites().length;
    if (have < want) {
      const r = this.rng('rally', have);
      const pool = ['p', 'p', 'p', 'p', 'p', 'n', 'n', 'b', 'b', 'r', 'r', 'q'];
      const slots = this.slots();
      const per = Math.ceil((want - have) / slots.length);
      for (const s of slots) {
        const kinds = [];
        for (let i = 0; i < per; i++) kinds.push(r.pick(pool));
        for (let i = 0; i < kinds.length; i += 8) this.dropSquad(s, kinds.slice(i, i + 8));
      }
      this.emit('H', want - have);
    }
    boss.nextAtk = this.t + 3;
    boss.nextSum = this.t + 12;
    boss.nextDecree = this.t + 20;
    boss.nextFlight = this.t + 25;
    boss.nextRoar = this.t + 20;
    this.wave = { n: WAVE_COUNT, st: 'boss', t0: this.t, until: 0, k: 0, rd: [], shots: 0 };
    this.emit('Q', 1);
    this.checkpoint();
  }

  // ---------------------------------------------------------------- the dragon

  updateBossFlags() {
    const w = this.world;
    const boss = w.boss;
    w.bossOpen = !!boss && boss.ph >= 1 && !boss.fly && boss.grounded && this.t >= boss.inv && !boss.dead;
    w.bossArmed = !!boss && boss.ph >= 1 && !boss.fly && boss.grounded && !boss.dead;
    w.kingOpen = !!boss && kingExposed(boss);
  }

  clusterCenter(r, avoid = null) {
    const whites = this.whites();
    if (!whites.length) return null;
    const king = this.world.pieces.get(this.kingId);
    let best = null;
    let bn = -1;
    const sample = whites.length > 120 ? r.shuffle(whites.slice()).slice(0, 120) : whites;
    for (const p of sample) {
      if (avoid && dist(p.x, p.y, avoid[0], avoid[1]) < 4) continue;
      // Only Check goes for the king: the dragon's other blows land elsewhere.
      if (king && cheb(p.x, p.y, king.x, king.y) <= 3) continue;
      let n = 0;
      for (const q of whites) if (Math.abs(q.x - p.x) <= 2 && Math.abs(q.y - p.y) <= 2) n++;
      n += r() * 0.5;
      if (n > bn) {
        bn = n;
        best = p;
      }
    }
    return best ? [best.x, best.y] : [whites[0].x, whites[0].y];
  }

  availableAttacks() {
    const boss = this.world.boss;
    const out = [];
    const add = (k, wgt) => out.push([k, wgt]);
    if (groupAlive(boss, 'lwing') || groupAlive(boss, 'rwing')) add('rake', 2);
    if (groupAlive(boss, 'lfeath') || groupAlive(boss, 'rfeath')) add('rain', 3);
    if (groupAlive(boss, 'head')) add('fork', 2);
    if (groupAlive(boss, 'sting')) add('sting', 1);
    if (boss.ph >= 2 && this.t >= boss.nextDecree && this.world.pieces.get(this.kingId)) add('decree', 4);
    if (boss.ph >= 2 && this.t >= boss.nextFlight && (groupAlive(boss, 'lwing') || groupAlive(boss, 'rwing'))) add('land', 4);
    if (boss.ph >= 3 && this.t >= boss.nextRoar) add('roar', 3);
    return out;
  }

  /** Telegraph an attack; it lands at atk.t1. `slow` stretches the warning (the waves' practice shots). */
  planAttack(kind, slow = 1) {
    const w = this.world;
    const boss = w.boss;
    if (!boss || boss.dead) return null;
    const r = this.rng('atk', boss.atk.length + this.seq);
    const wind = WINDUP[kind] * Math.max(0.9, this.diff.attackGap) * slow;
    const atk = { id: ++this.seq, k: kind, t0: this.t, t1: this.t + wind };
    const whites = this.whites();
    if (!whites.length) return null;
    const ph = Math.max(1, boss.ph);
    if (kind === 'rake') {
      const rows = groupAlive(boss, 'lwing');
      const cols = groupAlive(boss, 'rwing');
      const axis = rows && cols ? r.int(2) : rows ? 0 : 1;
      const count = boss.ph === 0 ? 2 : ph >= 2 ? 3 : 2;
      const tally = new Map();
      for (const p of whites) {
        if (Math.abs((axis === 0 ? p.x : p.y) - (axis === 0 ? boss.x : boss.y)) > 16) continue;
        const line = axis === 0 ? p.y : p.x;
        tally.set(line, (tally.get(line) ?? 0) + (p.id === this.kingId ? -3 : 1) + r() * 0.3);
      }
      const lines = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, count).map(([line]) => line);
      if (!lines.length) return null;
      const b = w.bounds;
      const lo = axis === 0 ? Math.max(b[0], boss.x - 16) : Math.max(b[1], boss.y - 16);
      const hi = axis === 0 ? Math.min(b[2], boss.x + 16) : Math.min(b[3], boss.y + 16);
      atk.lines = lines.map((line) => [axis, line, lo, hi]);
      atk.side = axis === 0 ? 'l' : 'r';
    } else if (kind === 'rain') {
      const feathers = groupCount(boss, 'lfeath') + groupCount(boss, 'rfeath');
      const beams = Math.max(1, Math.min(feathers, boss.ph === 0 ? 2 : ph));
      const king = w.pieces.get(this.kingId);
      const picks = r.shuffle(whites.slice()).filter((p) => !king || cheb(p.x, p.y, king.x, king.y) > 3).slice(0, beams);
      if (!picks.length) return null;
      atk.xs = picks.map((p) => [p.x, p.y]);
    } else if (kind === 'fork' || kind === 'sting') {
      const c = this.clusterCenter(r, boss.lastC);
      if (!c) return null;
      atk.c = c;
      boss.lastC = c;
    } else if (kind === 'decree') {
      const king = w.pieces.get(this.kingId);
      if (!king) return null;
      const count = boss.ph >= 3 ? 2 : 1;
      atk.g = [];
      const dirs = r.shuffle([0, 1, 2, 3, 4, 5, 6, 7]);
      for (const d of dirs) {
        if (atk.g.length >= count) break;
        const [dx, dy] = ALL8[d];
        const k = 4 + r.int(3);
        const gx = king.x + dx * k;
        const gy = king.y + dy * k;
        if (!open(w, gx, gy) || w.occ[idx(gx, gy)] !== 0) continue;
        const ghost = this.makePiece('b', d < 4 ? 'r' : 'b', gx, gy, { st: C.ST_GHOST, w: 63 });
        placePiece(w, ghost);
        const back = ALL8.findIndex(([ax, ay]) => ax === -dx && ay === -dy);
        atk.g.push([gx, gy, back, ghost.id]);
      }
      if (!atk.g.length) return null;
      boss.nextDecree = this.t + 22;
    } else if (kind === 'land') {
      const target = this.flightTarget(r);
      if (!target) {
        boss.nextFlight = this.t + 10;
        return null;
      }
      const tl = this.t + 1.4;
      atk.t1 = tl + wind;
      atk.c = target;
      atk.fp = footprint(boss, 0, 0).map((f) => [f.x, f.y]);
      boss.fly = { t0: this.t, tl, t1: atk.t1, fx: boss.x, fy: boss.y, tx: target[0], ty: target[1] };
      boss.nextFlight = this.t + 38;
    } else if (kind === 'roar') {
      boss.nextRoar = this.t + 28;
    } else return null;
    boss.atk.push(atk);
    boss.last = kind;
    return atk;
  }

  flightTarget(r) {
    const w = this.world;
    const boss = w.boss;
    const c = this.clusterCenter(r);
    if (!c) return null;
    for (let tries = 0; tries < 60; tries++) {
      const a = r() * Math.PI * 2;
      const d = 4 + r() * 8;
      const x = Math.round(c[0] + Math.cos(a) * d);
      const y = Math.round(c[1] + Math.sin(a) * d);
      if (Math.abs(x - boss.x) + Math.abs(y - boss.y) < 6) continue;
      // Lift for the check so its own squares count as open ground.
      if (this.canLandAt(x, y)) return [x, y];
    }
    return null;
  }

  canLandAt(x, y) {
    const w = this.world;
    const boss = w.boss;
    for (const f of footprint(boss, x, y)) {
      if (!open(w, f.x, f.y)) return false;
      const o = w.occ[idx(f.x, f.y)];
      if (o < 0) continue; // its own body
    }
    return canLand(w, boss, x, y);
  }

  resolveAttack(atk) {
    const w = this.world;
    const boss = w.boss;
    if (atk.k === 'roar') {
      this.emit('R');
      this.blackTurn();
      this.nextTick = this.t + C.BLACK_TICK;
      return;
    }
    if (atk.k === 'decree') {
      let hit = 0;
      for (const [gx, gy, d, gid] of atk.g) {
        const ghost = w.pieces.get(gid);
        if (!ghost) continue;
        const [dx, dy] = ALL8[d];
        for (let i = 1; i <= 10; i++) {
          const x = gx + dx * i;
          const y = gy + dy * i;
          if (!open(w, x, y)) break;
          const o = w.occ[idx(x, y)];
          if (o === 0) continue;
          const q = o > 0 ? w.pieces.get(o) : null;
          if (q && q.s === 'w') {
            this.kill(q, ghost);
            hit++;
          }
          break;
        }
        removePiece(w, ghost);
      }
      this.emit('a', 'decree', atk.id, hit);
      if (!hit) this.emit('F');
      return;
    }
    if (atk.k === 'land') return; // the flight lands it
    let hit = 0;
    for (const pos of attackSquares(w, atk)) {
      const o = w.occ[pos];
      if (o <= 0) continue;
      const q = w.pieces.get(o);
      if (q && q.s === 'w' && active(q)) {
        this.kill(q, null);
        hit++;
        if (this.phase !== 'rts') break;
      }
    }
    this.emit('a', atk.k, atk.id, hit);
  }

  flight() {
    const w = this.world;
    const boss = w.boss;
    const fly = boss.fly;
    if (!fly) return;
    if (boss.grounded && this.t >= fly.tl) {
      liftBoss(w, boss);
      this.emit('U');
    }
    if (this.t >= fly.t1) {
      boss.x = fly.tx;
      boss.y = fly.ty;
      for (const f of footprint(boss)) {
        const o = w.occ[idx(f.x, f.y)];
        if (o > 0) {
          const q = w.pieces.get(o);
          if (q) this.kill(q, null);
          if (this.phase !== 'rts') return;
        }
      }
      placeBoss(w, boss);
      boss.fly = null;
      boss.inv = this.t + 0.6;
      boss.atk = boss.atk.filter((a) => a.k !== 'land');
      this.emit('L');
      this.emit('a', 'land', 0, 0);
    }
  }

  bossLogic() {
    const w = this.world;
    const boss = w.boss;
    if (!boss) return;
    // Practice shots and the fight's attacks resolve the same way.
    for (const atk of boss.atk.slice()) {
      if (this.t >= atk.t1 && atk.k !== 'land') {
        boss.atk.splice(boss.atk.indexOf(atk), 1);
        this.resolveAttack(atk);
        if (this.phase !== 'rts') return;
      }
    }
    this.flight();
    if (this.phase !== 'rts' || this.wave.st !== 'boss' || boss.dead) return;
    if (boss.ph === 1 && integrity(boss) <= 0.6) {
      boss.ph = 2;
      boss.inv = this.t + 1.5;
      boss.nextFlight = this.t + 6;
      boss.nextDecree = this.t + 12;
      this.emit('Q', 2);
    }
    if (boss.ph < 3 && kingExposed(boss)) {
      boss.ph = 3;
      boss.inv = this.t + 1.5;
      boss.nextRoar = this.t + 8;
      boss.nextDecree = Math.min(boss.nextDecree, this.t + 6);
      this.emit('Q', 3);
    }
    if (this.t >= boss.nextAtk && boss.grounded && !boss.fly) {
      const options = this.availableAttacks().filter(([k]) => k !== boss.last || this.availableAttacks().length === 1);
      let total = options.reduce((a, [, wgt]) => a + wgt, 0);
      const r = this.rng('pick', this.seq);
      let roll = r() * total;
      let kind = null;
      for (const [k, wgt] of options) {
        roll -= wgt;
        if (roll <= 0) {
          kind = k;
          break;
        }
      }
      const atk = kind ? this.planAttack(kind) : null;
      const gap = ({ 1: 8, 2: 7, 3: 6 }[boss.ph] ?? 8) * this.diff.attackGap;
      boss.nextAtk = this.t + gap + (atk ? atk.t1 - atk.t0 : 0) * 0.6;
    }
    if (this.t >= (boss.nextHelp ?? 0)) {
      // The board keeps sending help while the dragon stands.
      boss.helps = (boss.helps ?? 0) + 1;
      if (boss.nextHelp) for (const s of this.slots()) this.dropSquad(s, ['p', 'p', boss.helps % 2 ? 'n' : 'b'].concat(boss.helps % 2 === 0 ? ['r'] : [], boss.helps % 4 === 0 ? ['q'] : []));
      boss.nextHelp = this.t + 30;
    }
    if (this.t >= boss.nextSum && boss.grounded) {
      const r = this.rng('bsum', this.seq);
      const count = Math.round((3 + boss.ph * 2) * this.diff.enemies * C.playerScale(this.players()));
      const pool = ['p', 'p', 'p', 'p', 'n', 'n', 'b', 'b', 'r', 'q'];
      const list = [];
      for (let i = 0; i < count; i++) list.push({ k: r.pick(pool), hp: 1 });
      this.summon(list, { near: [4, 7], wave: 63, tag: 'bsum' });
      boss.nextSum = this.t + ({ 1: 20, 2: 17, 3: 14 }[boss.ph] ?? 17);
    }
  }

  // ---------------------------------------------------------------- endings, checkpoints

  lose(reason) {
    if (this.phase === 'won' || this.phase === 'lost') return;
    this.phase = 'lost';
    this.result = { t: this.t, reason };
    this.emit('D', reason);
  }

  win() {
    const boss = this.world.boss;
    boss.dead = true;
    boss.deadAt = this.t;
    boss.atk = [];
    for (const p of [...this.world.pieces.values()]) {
      if (p.s !== 'w') removePiece(this.world, p);
    }
    this.phase = 'won';
    this.result = { t: this.t, reason: 'mate' };
    this.emit('M');
  }

  /** A record of the battle to come back to (the start of a wave or of the fight). */
  snapshot() {
    const w = this.world;
    const rocks = [];
    for (let i = 0; i < W * H; i++) if (w.terr[i] === T_ROCK) rocks.push(i);
    const pieces = [...w.pieces.values()].filter((p) => !(p.st & C.ST_GHOST));
    return {
      t: this.t,
      n: this.wave.n,
      st: this.wave.st,
      pcs: encodePieces(pieces),
      rocks: encodePositions(rocks),
      bd: w.bounds.slice(),
      sealed: w.sealed,
      gs: this.grow.side,
      bo: w.boss ? { x: w.boss.x, y: w.boss.y, ph: w.boss.ph, hp: encodeHp(w.boss.parts), mm: w.boss.mm ?? 1 } : null,
      mat: this.mat.slice(),
      kid: this.kingId,
      nid: this.nextId,
      diff: this.diffKey,
      seed: this.seed,
    };
  }

  checkpoint() {
    this.ck = this.snapshot();
  }

  /** Rebuild the battlefield from a snapshot; times inside it are moved to now. */
  restore(ck) {
    if (!ck || !Array.isArray(ck.pcs)) return false;
    const shift = this.t - (isNum(ck.t) ? ck.t : this.t);
    const gen = this.gen ?? generate(this.seed);
    this.gen = gen;
    const w = makeWorld();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (isThrone(x, y)) w.terr[y * W + x] = T_THRONE;
    for (const pos of decodePositions(ck.rocks)) w.terr[pos] = T_ROCK;
    if (Array.isArray(ck.bd) && ck.bd.length === 4 && ck.bd.every((v) => Number.isInteger(v) && v >= 0 && v < W)) w.bounds = ck.bd.slice();
    else w.bounds = C.START_BOUNDS.slice();
    w.sealed = ck.sealed !== false;
    const pieces = decodePieces(ck.pcs);
    for (const p of pieces.values()) {
      const q = this.makePiece(p.s, p.k, p.x, p.y, { id: p.id, o: p.o, hp: p.hp, mh: p.mh, f: p.f, st: p.st & ~C.ST_ORDER, w: p.w });
      q.c = p.c;
      q.cd = p.cd + shift;
      q.lt = this.t - 10;
      if (q.st & C.ST_AIR) q.lt = q.cd;
      if (q.s === 'w' && !this.active[q.o]) q.o = this.slots()[0];
      if (w.occ[idx(q.x, q.y)] === 0) placePiece(w, q);
    }
    const boss = makeBoss(C.BOSS_X, C.BOSS_Y, 1);
    if (ck.bo) {
      boss.x = clampInt(ck.bo.x, 6, W - 7) ?? C.BOSS_X;
      boss.y = clampInt(ck.bo.y, 6, H - 7) ?? C.BOSS_Y;
      boss.ph = clampInt(ck.bo.ph, 0, 3) ?? 0;
      boss.mm = isNum(ck.bo.mm) ? ck.bo.mm : 1;
      const hp = decodeHp(ck.bo.hp, boss.parts.length);
      boss.parts.forEach((p, i) => {
        p.mh = Math.round(PARTS[i].hp * boss.mm);
        p.hp = hp ? Math.min(hp[i], p.mh) : p.mh;
      });
    }
    boss.nextAtk = this.t + 3;
    boss.nextSum = this.t + 12;
    boss.nextDecree = this.t + 20;
    boss.nextFlight = this.t + 25;
    boss.nextRoar = this.t + 20;
    w.boss = boss;
    placeBoss(w, boss);
    this.world = w;
    this.hidden = gen.white.map((g) => ({ ...g, s: 'w' })).concat(gen.black.map((g) => ({ ...g, s: 'b' }))).filter((h) => !this.inside(h.x, h.y));
    this.kingId = clampInt(ck.kid, 1, 262143) ?? this.kingId;
    this.nextId = Math.max(this.nextId, clampInt(ck.nid, 1000, 262143) ?? 1000);
    if (Array.isArray(ck.mat)) this.mat = [0, 1, 2, 3].map((i) => (isNum(ck.mat[i]) ? Math.max(0, ck.mat[i]) : 0));
    this.grow = { side: clampInt(ck.gs, 0, 3) ?? 0, next: this.t + C.GROW_EVERY };
    this.nextTick = this.t + C.BLACK_TICK + 1;
    const n = clampInt(ck.n, 0, WAVE_COUNT) ?? 0;
    const st = ['break', 'fight', 'boss'].includes(ck.st) ? ck.st : 'break';
    this.wave = st === 'break'
      ? { n, st, t0: this.t, until: this.t + C.FIRST_BREAK, k: 0, rd: [], shots: 0 }
      : { n, st, t0: this.t, until: 0, k: 0, rd: [], shots: 0 };
    this.phase = 'rts';
    this.result = null;
    this.awake = this.awake ?? { t0: -99, gh: [], cap: [C.KEEP_X + 3, C.KEEP_Y + 3] };
    this.ck = ck;
    return true;
  }

  retry() {
    if (this.phase !== 'lost') return false;
    if (!this.ck) {
      // Lost the opening: a fresh game of chess.
      this.stats.retries++;
      this.startChess();
      this.emit('r');
      return true;
    }
    this.stats.retries++;
    this.restore(this.ck);
    this.emit('r');
    return true;
  }

  attackSquaresFor(atk) {
    return attackSquares(this.world, atk);
  }

  // ---------------------------------------------------------------- the clock

  step(dt) {
    if (this.paused || this.phase === 'won') {
      if (!this.paused) this.t += dt;
      return;
    }
    this.t += dt;
    if (this.phase === 'chess') {
      if (this.chess.pos.t === 'b' && this.t >= this.chess.think) this.noirMove();
      return;
    }
    if (this.phase === 'awaken') {
      if (this.t >= this.awake.t0 + C.CINEMATIC) this.beginRts();
      return;
    }
    if (this.phase !== 'rts') return;
    this.updateBossFlags();
    if (this.t >= this.grow.next) {
      this.grow.next += C.GROW_EVERY;
      if (this.grow.next < this.t) this.grow.next = this.t + C.GROW_EVERY;
      this.growBoard();
    }
    this.land();
    this.waveLogic();
    if (this.phase !== 'rts') return;
    if (this.t >= this.nextTick) {
      this.nextTick += C.BLACK_TICK;
      if (this.nextTick < this.t) this.nextTick = this.t + C.BLACK_TICK;
      this.blackTurn();
      if (this.phase !== 'rts') return;
    }
    this.bossLogic();
    if (this.phase !== 'rts') return;
    this.updateBossFlags();
    this.automate();
    if (this.phase === 'rts' && !this.whites().length && ![...this.world.pieces.values()].some((p) => p.s === 'w')) this.lose('army');
  }

  // ---------------------------------------------------------------- snapshots for the room

  /** { g, p: [chunks], r }: the room state the host writes. */
  encode() {
    const w = this.world;
    const boss = w.boss;
    const g = {
      v: 1,
      ph: this.phase,
      t: Math.round(this.t * 100) / 100,
      seed: this.seed,
      diff: this.diffKey,
      sl: this.slots(),
      ev: this.recentEvents(),
      res: this.result,
      st: { re: this.stats.retries },
      pz: this.paused,
    };
    if (this.phase === 'chess' || (this.phase === 'lost' && !this.awake)) {
      const ch = this.chess;
      g.ch = { b: boardString(ch.pos.b), t: ch.pos.t, cr: ch.pos.cr, ep: ch.pos.ep, fm: ch.pos.fm, own: ch.own.map((o) => (o < 0 ? '.' : String(o))).join(''), mv: ch.moves, last: ch.last, wc: ch.wc, bc: ch.bc, tt: ch.turnT, cb: ch.capB.join('') };
      return { g, p: null, r: null };
    }
    g.aw = this.awake;
    g.wv = this.wave;
    g.bd = w.bounds;
    g.gn = this.grow.next;
    g.gs = this.grow.side;
    g.nt = this.nextTick;
    g.sd = w.sealed;
    g.mat = this.mat;
    g.cap = this.caps;
    g.lost = this.lost;
    g.dmg = this.dmg;
    g.auto = this.auto;
    g.ca = this.castleAt;
    g.kid = this.kingId;
    g.ck = this.ck ? { n: this.ck.n, st: this.ck.st } : null;
    if (boss) {
      g.bo = { x: boss.x, y: boss.y, ph: boss.ph, inv: boss.inv, fly: boss.fly, atk: boss.atk, hp: encodeHp(boss.parts), mm: boss.mm ?? 1, dead: boss.dead, da: boss.deadAt, gr: boss.grounded };
    }
    const rocks = [];
    for (let i = 0; i < W * H; i++) if (w.terr[i] === T_ROCK) rocks.push(i);
    return { g, p: encodePieces(w.pieces.values()), r: encodePositions(rocks) };
  }
}

/**
 * Rebuild a battlefield to draw (or to take over as the new host) from room state. Returns a world in the same shape
 * the simulation keeps, plus the record `g`, or null if the record doesn't parse.
 */
export function decodeWorld(g, chunks, rocksStr, into = null) {
  if (!g || typeof g !== 'object') return null;
  const w = into ?? makeWorld();
  w.terr.fill(T_FLOOR);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (isThrone(x, y)) w.terr[y * W + x] = T_THRONE;
  for (const pos of decodePositions(rocksStr)) w.terr[pos] = T_ROCK;
  w.occ.fill(0);
  if (Array.isArray(g.bd) && g.bd.length === 4 && g.bd.every((v) => Number.isInteger(v) && v >= 0 && v < W)) w.bounds = g.bd.slice();
  w.sealed = g.sd !== false;
  w.pieces = decodePieces(Array.isArray(chunks) ? chunks : [], w.pieces instanceof Map ? w.pieces : new Map());
  for (const p of w.pieces.values()) {
    if (w.occ[p.y * W + p.x] === 0) w.occ[p.y * W + p.x] = p.id;
  }
  w.boss = null;
  if (g.bo && typeof g.bo === 'object') {
    const boss = makeBoss(clampInt(g.bo.x, 0, W - 1) ?? C.BOSS_X, clampInt(g.bo.y, 0, H - 1) ?? C.BOSS_Y, isNum(g.bo.mm) ? g.bo.mm : 1);
    const hp = decodeHp(g.bo.hp, boss.parts.length);
    if (hp) boss.parts.forEach((p, i) => (p.hp = Math.min(hp[i], 4095)));
    boss.ph = clampInt(g.bo.ph, 0, 3) ?? 0;
    boss.inv = isNum(g.bo.inv) ? g.bo.inv : 0;
    boss.fly = g.bo.fly && typeof g.bo.fly === 'object' && isNum(g.bo.fly.t1) ? g.bo.fly : null;
    boss.atk = Array.isArray(g.bo.atk) ? g.bo.atk.filter((a) => a && typeof a.k === 'string' && isNum(a.t0) && isNum(a.t1)).slice(0, 12) : [];
    boss.dead = !!g.bo.dead;
    boss.deadAt = isNum(g.bo.da) ? g.bo.da : 0;
    boss.grounded = g.bo.gr !== false;
    boss.mm = isNum(g.bo.mm) ? g.bo.mm : 1;
    w.boss = boss;
    if (boss.grounded) placeBoss(w, boss);
    const t = isNum(g.t) ? g.t : 0;
    w.bossOpen = boss.ph >= 1 && !boss.fly && boss.grounded && t >= boss.inv && !boss.dead;
    w.bossArmed = boss.ph >= 1 && !boss.fly && boss.grounded && !boss.dead;
    w.kingOpen = kingExposed(boss);
  }
  return w;
}

/** A new host carries on from the room's record. */
Sim.fromRoom = function fromRoom(g, chunks, rocksStr, slots) {
  if (!g || typeof g !== 'object' || !isNum(g.seed)) return null;
  const sim = new Sim({ seed: g.seed, diff: g.diff, slots });
  sim.t = isNum(g.t) ? g.t : 0;
  sim.seq = Array.isArray(g.ev) && g.ev.length ? Math.max(...g.ev.map((e) => (Array.isArray(e) && isNum(e[0]) ? e[0] : 0))) : 0;
  sim.ev = Array.isArray(g.ev) ? g.ev.slice(-MAX_EVENTS) : [];
  sim.evT = sim.ev.map(() => sim.t - 10);
  sim.stats.retries = isNum(g.st?.re) ? g.st.re : 0;
  sim.paused = false;
  if (g.ph === 'chess' || (g.ph === 'lost' && g.ch)) {
    const ch = g.ch;
    const b = ch && parseBoard(ch.b);
    if (!b) return sim;
    sim.chess.pos = { b, t: ch.t === 'b' ? 'b' : 'w', cr: typeof ch.cr === 'string' ? ch.cr.replace(/[^KQkq]/g, '') : '', ep: clampInt(ch.ep, -1, 63) ?? -1, hm: 0, fm: clampInt(ch.fm, 1, 999) ?? 1 };
    sim.chess.own = typeof ch.own === 'string' && ch.own.length === 64 ? ch.own.split('').map((c) => (c === '.' ? -1 : Number(c) || 0)) : sim.chess.own;
    sim.chess.moves = Array.isArray(ch.mv) ? ch.mv.filter((s) => typeof s === 'string').slice(0, 400) : [];
    sim.chess.last = Array.isArray(ch.last) ? ch.last : null;
    sim.chess.wc = isNum(ch.wc) ? ch.wc : 600;
    sim.chess.bc = isNum(ch.bc) ? ch.bc : 600;
    sim.chess.turnT = isNum(ch.tt) ? ch.tt : sim.t;
    sim.chess.capB = typeof ch.cb === 'string' ? ch.cb.split('') : [];
    sim.chess.ply = sim.chess.moves.length;
    sim.chess.think = sim.t + 0.5;
    sim.phase = g.ph === 'lost' ? 'lost' : 'chess';
    sim.result = g.res ?? null;
    return sim;
  }
  const w = decodeWorld(g, chunks, rocksStr);
  if (!w) return sim;
  sim.gen = generate(sim.seed);
  for (const p of w.pieces.values()) {
    Object.assign(p, { ox: -1, oy: -1, stuck: 0, na: 0, at: 0, as: 0, lt: p.st & C.ST_AIR ? p.cd : sim.t - 10 });
    p.st &= ~C.ST_ORDER;
  }
  if (w.boss) {
    const bo = g.bo;
    w.boss.nextAtk = sim.t + 2;
    w.boss.nextSum = sim.t + 10;
    w.boss.nextDecree = sim.t + 12;
    w.boss.nextFlight = sim.t + 15;
    w.boss.nextRoar = sim.t + 12;
    w.boss.atk = w.boss.atk.map((a) => ({ ...a }));
    w.boss.parts.forEach((p, i) => (p.mh = Math.round(PARTS[i].hp * (isNum(bo.mm) ? bo.mm : 1))));
    if (w.boss.fly && !w.boss.grounded) liftBoss(w, w.boss);
  }
  sim.world = w;
  sim.hidden = sim.gen.white.map((h) => ({ ...h, s: 'w' })).concat(sim.gen.black.map((h) => ({ ...h, s: 'b' }))).filter((h) => !sim.inside(h.x, h.y));
  sim.phase = ['awaken', 'rts', 'won', 'lost'].includes(g.ph) ? g.ph : 'rts';
  sim.awake = g.aw && typeof g.aw === 'object' ? g.aw : { t0: -99, gh: [], cap: [C.KEEP_X + 3, C.KEEP_Y + 3] };
  const wv = g.wv && typeof g.wv === 'object' ? g.wv : {};
  sim.wave = {
    n: clampInt(wv.n, 0, WAVE_COUNT) ?? 0,
    st: ['break', 'fight', 'bossintro', 'boss'].includes(wv.st) ? wv.st : 'break',
    t0: isNum(wv.t0) ? wv.t0 : sim.t,
    until: isNum(wv.until) ? wv.until : sim.t + C.BREAK,
    k: clampInt(wv.k, 0, 99) ?? 0,
    rd: Array.isArray(wv.rd) ? wv.rd.filter((s) => clampInt(s, 0, 3) !== null) : [],
    shots: clampInt(wv.shots, 0, 99) ?? 0,
  };
  sim.grow = { side: clampInt(g.gs, 0, 3) ?? 0, next: isNum(g.gn) ? g.gn : sim.t + C.GROW_EVERY };
  sim.nextTick = isNum(g.nt) ? g.nt : sim.t + C.BLACK_TICK;
  const arr = (a) => [0, 1, 2, 3].map((i) => (Array.isArray(a) && isNum(a[i]) ? a[i] : 0));
  sim.mat = arr(g.mat);
  sim.caps = arr(g.cap);
  sim.lost = arr(g.lost);
  sim.dmg = arr(g.dmg);
  sim.auto = [0, 1, 2, 3].map((i) => (Array.isArray(g.auto) ? g.auto[i] !== false : true));
  sim.castleAt = isNum(g.ca) ? g.ca : 0;
  sim.kingId = clampInt(g.kid, 1, 262143) ?? 0;
  sim.result = g.res ?? null;
  sim.nextId = Math.max(1000, ...[...w.pieces.keys()].filter((id) => id < 50000).map((id) => id + 1));
  return sim;
};
