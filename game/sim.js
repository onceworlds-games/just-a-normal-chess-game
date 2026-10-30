// The whole game as the host's page runs it: the chess opening against Noir, the awakening, then a turn-based battle
// against Black's army and the dragon at the top of the board. Pure: no page, no room. Players' pages send commands
// (cmd) and draw the host's snapshots (encode / decodeWorld).

import * as C from './config.js';
import { initialPosition, makeMove, findMove, san, status, boardString, parseBoard, typeOf, colorOf } from './chess.js';
import { chooseMove, lureChance } from './ai.js';
import { makeWorld, idx, onBoard, movesOf, attackedBy, partAttacks, placePiece, removePiece, movePieceTo, active, dist, cheb, ALL8 } from './rules.js';
import { makeBoss, PARTS, placeBoss, footprint, attackSquares, integrity, kingExposed, groupAlive, groupCount } from './boss.js';
import { bestBlackMove, pieceValue } from './blackai.js';
import { rngFor } from './rng.js';
import { encodePieces, decodePieces, encodeHp, decodeHp, isNum, clampInt } from './codec.js';

const { W, H, ROLE } = C;
const MAX_EVENTS = 160;

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

/** Black's army for a difficulty and a number of players: [{ k, x, y, role, elite }]. */
export function armyLayout(diffKey, players) {
  const out = [];
  const add = (k, x, y, role, elite = false) => out.push({ k, x, y, role, elite });
  const back = {
    casual: ['', 'r', '', 'b', '', 'n', 'q', '', 'n', '', 'b', '', 'r', ''],
    normal: ['r', '', 'n', 'b', '', 'n', 'q', '', 'b', 'n', '', 'b', '', 'r'],
    hard: ['r', '', 'n', 'b', 'r', 'n', 'q', '', 'b', 'n', 'r', 'b', '', 'r'],
  }[diffKey] ?? [];
  back.forEach((k, x) => k && add(k, x, 5, k === 'n' || k === 'b' ? ROLE.hunter : ROLE.guard));
  const pawns = { casual: [3, 10], normal: [2, 11], hard: [0, 13] }[diffKey] ?? [2, 11];
  for (let x = pawns[0]; x <= pawns[1]; x++) add('p', x, C.BLACK_PAWN_ROW, ROLE.pawn);
  // Guards on the dragon's flanks.
  const guards = diffKey === 'casual'
    ? []
    : diffKey === 'normal'
      ? [['n', 2, 2], ['n', 11, 2]]
      : [['n', 2, 2], ['b', 0, 3], ['n', 11, 2], ['b', 13, 3]];
  for (const [k, x, y] of guards) add(k, x, y, ROLE.guard);
  // Hard, and every extra player, adds a second line of pawns and crowned pieces.
  const extra = Math.max(0, players - 1);
  if (extra >= 1) {
    for (let x = 2; x < 12; x++) add('p', x, 7, ROLE.pawn);
    add('q', 4, 4, ROLE.guard, true);
    add('q', 9, 4, ROLE.guard, true);
  }
  if (extra >= 2) {
    for (const x of [0, 1, 12, 13]) add('p', x, 7, ROLE.pawn);
    add('r', 3, 3, ROLE.guard, true);
    add('r', 10, 3, ROLE.guard, true);
  }
  if (extra >= 3) {
    for (const x of [2, 4, 9, 11]) add('n', x, 8, ROLE.hunter);
  }
  return out;
}

/** White's recruits, revealed on the flanks when the board opens: [{ k, x, y }]. */
export function recruitLayout(players) {
  const out = [];
  const side = (x0, dir) => {
    out.push({ k: 'r', x: x0, y: 19 }, { k: 'n', x: x0 + dir, y: 19 }, { k: 'b', x: x0 + 2 * dir, y: 19 });
    out.push({ k: 'p', x: x0, y: 18 }, { k: 'p', x: x0 + dir, y: 18 }, { k: 'p', x: x0 + 2 * dir, y: 18 });
  };
  side(0, 1);
  side(13, -1);
  if (players >= 2) out.push({ k: 'n', x: 1, y: 17 }, { k: 'n', x: 12, y: 17 }, { k: 'p', x: 0, y: 17 }, { k: 'p', x: 13, y: 17 });
  if (players >= 3) out.push({ k: 'b', x: 2, y: 17 }, { k: 'b', x: 11, y: 17 }, { k: 'q', x: 0, y: 16 });
  if (players >= 4) out.push({ k: 'r', x: 1, y: 16 }, { k: 'r', x: 12, y: 16 }, { k: 'q', x: 13, y: 16 });
  return out;
}

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
    this.caps = [0, 0, 0, 0];
    this.lost = [0, 0, 0, 0];
    this.dmg = [0, 0, 0, 0];
    this.stats = { retries: 0 };
    this.result = null;
    this.world = makeWorld();
    this.kingId = 0;
    this.awake = null;
    this.turn = 0;
    this.side = 'w';
    this.done = new Set();
    this.undo = new Map();
    this.bt = null; // Black's turn in progress
    this.blackTurns = 0;
    this.lastBlack = [];
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
  recentEvents(window = 3) {
    const out = [];
    for (let i = 0; i < this.ev.length; i++) if (this.evT[i] >= this.t - window) out.push(this.ev[i]);
    return out;
  }

  rng(tag, n = 0) {
    return rngFor(this.seed, tag, n, this.turn, this.blackTurns);
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

  makePiece(s, k, x, y, extra = {}) {
    return {
      id: extra.id ?? this.newId(),
      s,
      k,
      x,
      y,
      o: extra.o ?? -1,
      cd: extra.cd ?? 0,
      hp: extra.hp ?? 1,
      mh: extra.mh ?? extra.hp ?? 1,
      f: s === 'w' ? 0 : 2,
      st: extra.st ?? 0,
      w: extra.w ?? 0,
      c: 0,
      px: extra.px,
      py: extra.py,
    };
  }

  /** The slot whose files are nearest a square (recruits and reinforcements join the player on that side). */
  slotForX(x) {
    const owners = fileOwners(this.slots());
    const f = Math.max(0, Math.min(7, x - C.KEEP_X));
    return owners[f] ?? this.slots()[0];
  }

  awaken(capSq) {
    const ch = this.chess;
    const w = makeWorld();
    this.world = w;
    const ghosts = [];
    let id = 1;
    for (let sq = 0; sq < 64; sq++) {
      const p = ch.pos.b[sq];
      if (p === '.') continue;
      const { x, y } = chessToWorld(sq);
      if (colorOf(p) === 'w') {
        const owner = this.active[ch.own[sq]] ? ch.own[sq] : this.slots()[0];
        const king = typeOf(p) === 'k';
        const piece = this.makePiece('w', typeOf(p), x, y, { id: id++, o: owner, hp: king ? this.diff.kingHp : 1 });
        placePiece(w, piece);
        if (king) this.kingId = piece.id;
      } else ghosts.push([typeOf(p), x, y]);
    }
    for (const r of recruitLayout(this.players())) {
      if (w.occ[idx(r.x, r.y)] !== 0) continue;
      placePiece(w, this.makePiece('w', r.k, r.x, r.y, { id: id++, o: this.slotForX(r.x) }));
    }
    const boss = makeBoss(C.BOSS_X, C.BOSS_Y, this.diff.boss * C.bossScale(this.players()));
    w.boss = boss;
    placeBoss(w, boss);
    this.nextId = Math.max(this.nextId, 100);
    for (const a of armyLayout(this.diffKey, this.players())) {
      if (w.occ[idx(a.x, a.y)] !== 0) continue;
      placePiece(w, this.makePiece('b', a.k, a.x, a.y, { w: a.role, hp: a.elite ? 2 : 1, st: a.elite ? C.ST_ELITE : 0, px: a.x, py: a.y }));
    }
    this.updateFlags();
    const cap = capSq >= 0 ? chessToWorld(capSq) : { x: C.KEEP_X + 3, y: C.KEEP_Y + 3 };
    this.awake = { t0: this.t, gh: ghosts, cap: [cap.x, cap.y] };
    this.phase = 'awaken';
    this.emit('A');
  }

  beginBattle() {
    this.phase = 'battle';
    this.turn = 1;
    this.side = 'w';
    this.done = new Set();
    this.undo = new Map();
    this.emit('W', 1);
    this.checkpoint();
  }

  updateFlags() {
    const w = this.world;
    const boss = w.boss;
    w.bossOpen = !!boss && !boss.dead;
    w.bossArmed = !!boss && !boss.dead;
    w.kingOpen = !!boss && kingExposed(boss);
  }

  // ---------------------------------------------------------------- slots joining and leaving

  setSlots(list) {
    const next = [false, false, false, false];
    for (const s of list) if (s >= 0 && s < C.MAX_SLOTS) next[s] = true;
    if (!next.some(Boolean)) return;
    const added = [];
    for (let s = 0; s < C.MAX_SLOTS; s++) if (next[s] && !this.active[s]) added.push(s);
    this.active = next;
    if (this.players() > 1) this.paused = false;
    if (this.phase === 'chess') return;
    // Pieces of players who left go to the others; a newcomer gets a share of the army.
    for (const p of this.world.pieces.values()) if (p.s === 'w' && !this.active[p.o]) p.o = this.slotForX(p.x);
    if (added.length) this.rebalance();
    for (const s of [...this.done]) if (!this.active[s]) this.done.delete(s);
    this.maybeEndWhiteTurn();
  }

  /** Give every player a fair share of the white army (a friend who arrives mid-battle, a continued run). */
  rebalance() {
    const slots = this.slots();
    if (slots.length < 2) return;
    const held = new Map(slots.map((s) => [s, 0]));
    for (const p of this.world.pieces.values()) if (p.s === 'w' && held.has(p.o)) held.set(p.o, held.get(p.o) + 1);
    if (![...held.values()].some((n) => n === 0)) return;
    const whites = [...this.world.pieces.values()].filter((p) => p.s === 'w' && p.id !== this.kingId).sort((a, b) => a.x - b.x || a.id - b.id);
    whites.forEach((p, i) => (p.o = slots[Math.floor((i * slots.length) / whites.length)]));
  }

  // ---------------------------------------------------------------- commands from players

  cmd(slot, msg) {
    if (!msg || typeof msg !== 'object' || !this.active[slot]) return false;
    switch (msg.t) {
      case 'cm':
        return this.chessMove(slot, clampInt(msg.from, 0, 63) ?? -1, clampInt(msg.to, 0, 63) ?? -1, typeof msg.promo === 'string' ? msg.promo : 'q');
      case 'mv':
        return this.cmdMove(slot, msg);
      case 'undo':
        return this.cmdUndo(slot);
      case 'end':
        return this.cmdEnd(slot, msg.on !== false);
      case 'endall':
        if (this.phase !== 'battle' || this.side !== 'w') return false;
        for (const s of this.slots()) this.done.add(s);
        this.maybeEndWhiteTurn();
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

  canMove(slot) {
    return this.phase === 'battle' && this.side === 'w' && !this.done.has(slot) && !this.paused;
  }

  cmdMove(slot, msg) {
    if (!this.canMove(slot)) return false;
    const w = this.world;
    const p = w.pieces.get(msg.id);
    const x = clampInt(msg.x, 0, W - 1);
    const y = clampInt(msg.y, 0, H - 1);
    if (!p || p.s !== 'w' || p.o !== slot || !active(p) || p.st & C.ST_MOVED || x === null || y === null) return false;
    const m = movesOf(w, p).find((mv) => mv.x === x && mv.y === y);
    if (!m) return false;
    const entry = { id: p.id, fx: p.x, fy: p.y, k: p.k, victim: null, part: null };
    if (m.o > 0) {
      const q = w.pieces.get(m.o);
      if (q.hp > 1) {
        q.hp--;
        entry.armour = q.id;
        this.emit('k', idx(q.x, q.y), idx(p.x, p.y), q.hp);
      } else {
        entry.victim = { ...q };
        this.kill(q, p);
        movePieceTo(w, p, x, y);
        if (p.o >= 0) this.caps[p.o]++;
      }
    } else if (m.o < 0) {
      const i = -m.o - 1;
      const dmg = C.DAMAGE[p.k] + (p.st & C.ST_VET ? 1 : 0);
      entry.part = { i, hp: w.boss.parts[i].hp };
      this.strikePart(p, i, dmg);
    } else {
      movePieceTo(w, p, x, y);
    }
    if (p.k === 'p' && p.y === 0) {
      p.k = 'q';
      p.st |= C.ST_VET;
      entry.promoted = true;
      this.emit('P', idx(p.x, p.y), 'q');
    }
    p.st |= C.ST_MOVED;
    if (!this.undo.has(slot)) this.undo.set(slot, []);
    this.undo.get(slot).push(entry);
    this.emit('m', idx(entry.fx, entry.fy), idx(p.x, p.y), m.o ? 1 : 0);
    return true;
  }

  cmdUndo(slot) {
    if (!this.canMove(slot) || this.phase !== 'battle') return false;
    const stack = this.undo.get(slot);
    const e = stack?.pop();
    if (!e) return false;
    const w = this.world;
    const p = w.pieces.get(e.id);
    if (!p) return false;
    if ((e.fx !== p.x || e.fy !== p.y) && w.occ[idx(e.fx, e.fy)] !== 0) {
      stack.push(e);
      return false;
    }
    const tx = p.x;
    const ty = p.y;
    if (e.fx !== p.x || e.fy !== p.y) movePieceTo(w, p, e.fx, e.fy);
    p.k = e.k;
    if (e.promoted) p.st &= ~C.ST_VET;
    p.st &= ~C.ST_MOVED;
    if (e.victim && w.occ[idx(tx, ty)] === 0) {
      placePiece(w, { ...e.victim });
      if (p.o >= 0) this.caps[p.o] = Math.max(0, this.caps[p.o] - 1);
    }
    if (e.armour) {
      const q = w.pieces.get(e.armour);
      if (q) q.hp++;
    }
    if (e.part) {
      const part = w.boss.parts[e.part.i];
      const broke = part.hp <= 0;
      if (p.o >= 0) this.dmg[p.o] = Math.max(0, this.dmg[p.o] - (e.part.hp - Math.max(0, part.hp)));
      part.hp = e.part.hp;
      if (broke) placeBoss(w, w.boss);
      this.updateFlags();
    }
    this.emit('u', idx(tx, ty), idx(p.x, p.y));
    return true;
  }

  cmdEnd(slot, on) {
    if (this.phase !== 'battle' || this.side !== 'w') return false;
    if (on) this.done.add(slot);
    else this.done.delete(slot);
    this.maybeEndWhiteTurn();
    return true;
  }

  maybeEndWhiteTurn() {
    if (this.phase !== 'battle' || this.side !== 'w') return;
    if (this.slots().every((s) => this.done.has(s))) this.startBlackTurn();
  }

  // ---------------------------------------------------------------- captures and strikes

  /** Hit a white piece: it falls, unless it is the king and its armour holds (then it's Check). True if it fell. */
  hit(victim, killer) {
    if (victim.id === this.kingId && victim.hp > 1) {
      victim.hp--;
      this.emit('k', idx(victim.x, victim.y), killer ? idx(killer.x, killer.y) : -1, victim.hp);
      this.emit('C', victim.hp);
      return false;
    }
    this.kill(victim, killer);
    return true;
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

  strikePart(p, i, dmg) {
    const boss = this.world.boss;
    const part = boss?.parts[i];
    if (!part || part.hp <= 0) return;
    const hit = Math.min(part.hp, dmg);
    part.hp -= hit;
    if (p.o >= 0) this.dmg[p.o] += hit;
    this.emit('h', i, dmg, idx(p.x, p.y));
    if (part.hp <= 0) this.breakPart(part);
  }

  breakPart(part) {
    const w = this.world;
    const boss = w.boss;
    const x = boss.x + part.dx;
    const y = boss.y + part.dy;
    if (onBoard(x, y) && w.occ[idx(x, y)] === -(part.i + 1)) w.occ[idx(x, y)] = 0;
    this.emit('B', part.i);
    if (part.g === 'king') {
      this.win();
      return;
    }
    if (!groupAlive(boss, part.g)) this.emit('G', part.g);
    this.updateFlags();
    if (boss.ph === 1 && integrity(boss) <= 0.6) {
      boss.ph = 2;
      this.emit('Q', 2);
    }
    if (boss.ph < 3 && kingExposed(boss)) {
      boss.ph = 3;
      this.emit('Q', 3);
    }
  }

  // ---------------------------------------------------------------- Black's turn

  startBlackTurn() {
    this.side = 'b';
    this.blackTurns++;
    this.lastBlack = [];
    this.bt = { stage: 'attack', moved: new Set(), strikes: 0, moves: 0, at: this.t + 0.45 };
    for (const p of this.world.pieces.values()) if (p.s === 'w') p.st &= ~C.ST_MOVED;
    this.undo = new Map();
    this.emit('T', this.turn);
  }

  /** One beat of Black's turn; returns the seconds until the next. */
  blackBeat() {
    const bt = this.bt;
    const w = this.world;
    const boss = w.boss;
    if (bt.stage === 'attack') {
      bt.stage = 'strikes';
      if (!boss || boss.dead || !boss.atk.length) return 0.05;
      for (const atk of boss.atk) this.resolveAttack(atk);
      boss.atk = [];
      return C.BEAT_ATTACK;
    }
    if (bt.stage === 'strikes') {
      const limit = Math.round((this.diff.strikes + (boss && boss.ph >= 2 ? 1 : 0)) * (1 + 0.3 * (this.players() - 1)));
      if (boss && !boss.dead && bt.strikes < limit) {
        const s = this.partStrike(bt);
        if (s) {
          bt.strikes++;
          return C.BEAT_STRIKE;
        }
      }
      bt.stage = 'moves';
      return 0.05;
    }
    if (bt.stage === 'moves') {
      const max = Math.round(this.diff.maxMoves * C.playerScale(this.players()));
      const pick = bt.moves < max ? bestBlackMove(w, bt.moved, { kingId: this.kingId, risk: this.diff.risk, aggression: this.diff.aggression * (this.turn > 8 ? 1.25 : 1) }) : null;
      if (!pick) {
        bt.stage = 'announce';
        return 0.2;
      }
      this.blackMove(pick.p, pick.m);
      bt.moved.add(pick.p.id);
      bt.moves++;
      return bt.moves < 8 ? C.BEAT_MOVE : Math.max(0.12, C.BEAT_MOVE * 0.55);
    }
    if (bt.stage === 'announce') {
      bt.stage = 'end';
      return this.announce() ? 0.6 : 0.05;
    }
    this.endBlackTurn();
    return 0;
  }

  blackMove(p, m) {
    const w = this.world;
    const fx = p.x;
    const fy = p.y;
    if (m.o > 0) {
      const q = w.pieces.get(m.o);
      if (q && !this.hit(q, p)) {
        // The king's armour held: the attacker stays where it was.
        this.lastBlack.push([fx, fy, fx, fy]);
        return;
      }
      if (this.phase !== 'battle') return;
    }
    movePieceTo(w, p, m.x, m.y);
    if (p.k === 'p' && p.y === H - 1) {
      p.k = 'q';
      p.st |= C.ST_VET;
      this.emit('P', idx(p.x, p.y), 'q');
    }
    this.lastBlack.push([fx, fy, m.x, m.y]);
    this.emit('b', idx(fx, fy), idx(m.x, m.y), m.o > 0 ? 1 : 0);
  }

  /** A part of the dragon strikes a white piece standing where it attacks (the part stays put). */
  partStrike(bt) {
    const w = this.world;
    const boss = w.boss;
    const sq = [];
    let best = null;
    let bv = -1;
    for (const part of boss.parts) {
      if (part.hp <= 0 || bt.moved.has(-part.i - 1)) continue;
      partAttacks(w, part, boss.x + part.dx, boss.y + part.dy, sq);
      for (const s of sq) {
        const o = w.occ[idx(s.x, s.y)];
        if (o <= 0) continue;
        const q = w.pieces.get(o);
        if (!q || q.s !== 'w' || !active(q)) continue;
        const v = pieceValue(q, this.kingId);
        if (v > bv) {
          bv = v;
          best = { part, q };
        }
      }
    }
    if (!best) return false;
    bt.moved.add(-best.part.i - 1);
    this.emit('y', best.part.i, idx(best.q.x, best.q.y));
    this.hit(best.q, null);
    return true;
  }

  endBlackTurn() {
    this.bt = null;
    if (this.phase !== 'battle') return;
    this.side = 'w';
    this.turn++;
    this.done = new Set();
    this.undo = new Map();
    // Reinforcements now and then.
    if (this.turn % C.HELP_EVERY === 0) this.help();
    if ((this.turn - 1) % C.CHECKPOINT_EVERY === 0) this.checkpoint();
    this.emit('W', this.turn);
  }

  help() {
    const w = this.world;
    let n = 0;
    for (const s of this.slots()) {
      const kinds = this.turn % (C.HELP_EVERY * 2) === 0 ? ['p', 'n'] : ['p'];
      for (const k of kinds) {
        // A free square on the back two ranks, nearest this player's pieces.
        let best = null;
        let bd = Infinity;
        let cx = 0;
        let cy = 0;
        let c = 0;
        for (const p of w.pieces.values()) {
          if (p.s === 'w' && p.o === s) {
            cx += p.x;
            cy += p.y;
            c++;
          }
        }
        cx = c ? cx / c : W / 2;
        for (let y = H - 1; y >= H - 3; y--) {
          for (let x = 0; x < W; x++) {
            if (w.occ[idx(x, y)] !== 0 || attackedBy(w, x, y, 1)) continue;
            const d = Math.abs(x - cx) + (H - 1 - y) * 0.5;
            if (d < bd) {
              bd = d;
              best = [x, y];
            }
          }
        }
        if (!best) continue;
        placePiece(w, this.makePiece('w', k, best[0], best[1], { o: s }));
        n++;
      }
    }
    if (n) this.emit('H', n);
  }

  // ---------------------------------------------------------------- the dragon's attacks

  whites() {
    const out = [];
    for (const p of this.world.pieces.values()) if (p.s === 'w' && active(p)) out.push(p);
    return out;
  }

  /** At the end of Black's turn the dragon may announce an attack; it lands as Black's next turn begins. */
  announce() {
    const w = this.world;
    const boss = w.boss;
    let any = false;
    if (!boss || boss.dead || this.phase !== 'battle') return false;
    // Summons refill its lines while the torso stands.
    let blacks = 0;
    for (const p of w.pieces.values()) if (p.s !== 'w') blacks++;
    if (boss.ph === 1 && (boss.summons ?? 0) < 4 && this.blackTurns % 4 === 0 && blacks < 12 * C.playerScale(this.players())) {
      boss.summons = (boss.summons ?? 0) + 1;
      any = this.summon() || any;
    }
    if (this.blackTurns < boss.next) return any;
    const r = this.rng('atk');
    const opts = [];
    if (groupAlive(boss, 'lwing') || groupAlive(boss, 'rwing')) opts.push(['rake', 3]);
    if (groupAlive(boss, 'lfeath') || groupAlive(boss, 'rfeath')) opts.push(['rain', 3]);
    if (groupAlive(boss, 'head')) opts.push(['fork', 2]);
    if (groupAlive(boss, 'sting')) opts.push(['sting', 2]);
    if (boss.ph >= 2 && w.pieces.get(this.kingId)) opts.push(['decree', 3]);
    const pool = opts.filter(([k]) => k !== boss.last || opts.length === 1);
    let roll = r() * pool.reduce((a, [, wgt]) => a + wgt, 0);
    let kind = null;
    for (const [k, wgt] of pool) {
      roll -= wgt;
      if (roll <= 0) {
        kind = k;
        break;
      }
    }
    boss.next = this.blackTurns + (boss.ph === 1 ? 3 : 2);
    const atk = kind ? this.planAttack(kind, r) : null;
    if (!atk) return any;
    boss.atk.push(atk);
    boss.last = kind;
    this.emit('a', kind, 0);
    return true;
  }

  clusterCenter(r) {
    const whites = this.whites();
    const king = this.world.pieces.get(this.kingId);
    let best = null;
    let bn = -1;
    for (const p of whites) {
      if (king && cheb(p.x, p.y, king.x, king.y) <= 2) continue;
      let n = r() * 0.5;
      for (const q of whites) if (Math.abs(q.x - p.x) <= 1 && Math.abs(q.y - p.y) <= 2) n++;
      if (n > bn) {
        bn = n;
        best = p;
      }
    }
    return best ? [best.x, best.y] : null;
  }

  planAttack(kind, r) {
    const w = this.world;
    const boss = w.boss;
    const whites = this.whites();
    if (!whites.length) return null;
    const king = w.pieces.get(this.kingId);
    const atk = { id: ++this.seq, k: kind, turn: this.blackTurns };
    if (kind === 'rake') {
      // The left wing rakes ranks, the right wing files; it picks the lines with the most white pieces.
      const rows = groupAlive(boss, 'lwing');
      const cols = groupAlive(boss, 'rwing');
      const axis = rows && cols ? r.int(2) : rows ? 0 : 1;
      const tally = new Map();
      for (const p of whites) {
        const line = axis === 0 ? p.y : p.x;
        if (axis === 0 && line <= 4) continue;
        tally.set(line, (tally.get(line) ?? 0) + (p.id === this.kingId ? -2 : 1) + r() * 0.3);
      }
      const count = boss.ph >= 2 ? 2 : 1;
      const lines = [...tally.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, count).map(([line]) => {
        // Seven squares of that line, centred on its white pieces.
        const on = whites.filter((p) => (axis === 0 ? p.y : p.x) === line).map((p) => (axis === 0 ? p.x : p.y));
        const mid = on.length ? Math.round(on.reduce((a, b) => a + b, 0) / on.length) : axis === 0 ? W >> 1 : H >> 1;
        const len = axis === 0 ? W : H;
        const a = Math.max(0, Math.min(len - 7, mid - 3));
        return [axis, line, a, a + 6];
      });
      if (!lines.length) return null;
      atk.lines = lines;
    } else if (kind === 'rain') {
      const beams = Math.max(1, Math.min(groupCount(boss, 'lfeath') + groupCount(boss, 'rfeath'), boss.ph));
      const picks = r.shuffle(whites.slice()).filter((p) => !king || cheb(p.x, p.y, king.x, king.y) > 2).slice(0, beams);
      if (!picks.length) return null;
      atk.xs = picks.map((p) => [p.x, p.y]);
    } else if (kind === 'fork' || kind === 'sting') {
      const c = this.clusterCenter(r);
      if (!c) return null;
      atk.c = c;
    } else if (kind === 'decree') {
      if (!king) return null;
      atk.g = [];
      for (const d of r.shuffle([0, 1, 2, 3, 4, 5, 6, 7])) {
        if (atk.g.length >= (boss.ph >= 3 ? 2 : 1)) break;
        const [dx, dy] = ALL8[d];
        const k = 3 + r.int(3);
        const gx = king.x + dx * k;
        const gy = king.y + dy * k;
        if (!onBoard(gx, gy) || w.occ[idx(gx, gy)] !== 0) continue;
        const ghost = this.makePiece('b', d < 4 ? 'r' : 'b', gx, gy, { st: C.ST_GHOST });
        placePiece(w, ghost);
        const back = ALL8.findIndex(([ax, ay]) => ax === -dx && ay === -dy);
        atk.g.push([gx, gy, back, ghost.id]);
      }
      if (!atk.g.length) return null;
    }
    return atk;
  }

  resolveAttack(atk) {
    const w = this.world;
    let hit = 0;
    if (atk.k === 'decree') {
      for (const [gx, gy, d, gid] of atk.g) {
        const ghost = w.pieces.get(gid);
        if (!ghost) continue;
        const [dx, dy] = ALL8[d];
        for (let i = 1; i <= 8; i++) {
          const x = gx + dx * i;
          const y = gy + dy * i;
          if (!onBoard(x, y)) break;
          const o = w.occ[idx(x, y)];
          if (o === 0) continue;
          const q = o > 0 ? w.pieces.get(o) : null;
          if (q && q.s === 'w') {
            this.hit(q, ghost);
            hit++;
          }
          break;
        }
        removePiece(w, ghost);
      }
      this.emit('a', 'decree', atk.id, hit, JSON.stringify(atk.g.map(([x, y, d]) => [x, y, d])));
      if (!hit) this.emit('F');
      return;
    }
    for (const pos of attackSquares(w, atk)) {
      const o = w.occ[pos];
      if (o <= 0) continue;
      const q = w.pieces.get(o);
      if (q && q.s === 'w' && active(q)) {
        this.hit(q, null);
        hit++;
        if (this.phase !== 'battle') break;
      }
    }
    this.emit('a', atk.k, atk.id, hit, JSON.stringify(atk.lines ?? atk.xs ?? atk.c ?? null));
  }

  summon() {
    const w = this.world;
    const r = this.rng('sum');
    const count = Math.round((this.diffKey === 'hard' ? 3 : 2) * C.playerScale(this.players()));
    let n = 0;
    for (let tries = 0; tries < 60 && n < count; tries++) {
      const x = 2 + r.int(W - 4);
      const y = 5 + r.int(3);
      if (w.occ[idx(x, y)] !== 0) continue;
      placePiece(w, this.makePiece('b', 'p', x, y, { w: ROLE.summoned }));
      n++;
    }
    if (n) this.emit('S', n);
    return n > 0;
  }

  // ---------------------------------------------------------------- endings, checkpoints

  lose(reason) {
    if (this.phase === 'won' || this.phase === 'lost') return;
    this.phase = 'lost';
    this.result = { t: this.t, reason, turn: this.turn };
    this.bt = null;
    this.emit('D', reason);
  }

  win() {
    const w = this.world;
    const boss = w.boss;
    boss.dead = true;
    boss.deadAt = this.t;
    boss.atk = [];
    for (const p of [...w.pieces.values()]) if (p.s !== 'w') removePiece(w, p);
    for (const { x, y } of footprint(boss)) if (onBoard(x, y) && w.occ[idx(x, y)] < 0) w.occ[idx(x, y)] = 0;
    this.phase = 'won';
    this.bt = null;
    this.result = { t: this.t, reason: 'mate', turn: this.turn };
    this.updateFlags();
    this.emit('M');
  }

  snapshot() {
    const w = this.world;
    const pieces = [...w.pieces.values()].filter((p) => !(p.st & C.ST_GHOST));
    return {
      t: this.t,
      turn: this.turn,
      bturns: this.blackTurns,
      pcs: encodePieces(pieces),
      posts: pieces.filter((p) => p.px !== undefined).map((p) => [p.id, p.px, p.py]),
      bo: w.boss ? { hp: encodeHp(w.boss.parts), mm: w.boss.mm, ph: w.boss.ph, next: w.boss.next, su: w.boss.summons ?? 0 } : null,
      kid: this.kingId,
      nid: this.nextId,
      diff: this.diffKey,
      seed: this.seed,
    };
  }

  checkpoint() {
    this.ck = this.snapshot();
  }

  /** Rebuild the battle from a snapshot, at the start of White's turn. */
  restore(ck) {
    if (!ck || !Array.isArray(ck.pcs)) return false;
    const w = makeWorld();
    const posts = new Map(Array.isArray(ck.posts) ? ck.posts.filter((e) => Array.isArray(e)).map(([id, x, y]) => [id, [x, y]]) : []);
    for (const p of decodePieces(ck.pcs).values()) {
      const post = posts.get(p.id);
      const q = this.makePiece(p.s, p.k, p.x, p.y, { id: p.id, o: p.o, hp: p.hp, mh: p.mh, st: p.st & ~(C.ST_MOVED | C.ST_AIR), w: p.w, px: post?.[0], py: post?.[1] });
      q.c = p.c;
      if (q.s === 'w' && !this.active[q.o]) q.o = this.slotForX(q.x);
      if (w.occ[idx(q.x, q.y)] === 0) placePiece(w, q);
    }
    const mult = isNum(ck.bo?.mm) ? ck.bo.mm : this.diff.boss;
    const boss = makeBoss(C.BOSS_X, C.BOSS_Y, mult);
    const hp = decodeHp(ck.bo?.hp, boss.parts.length);
    if (hp) boss.parts.forEach((p, i) => (p.hp = Math.min(hp[i], p.mh)));
    boss.ph = clampInt(ck.bo?.ph, 1, 3) ?? 1;
    boss.next = isNum(ck.bo?.next) ? ck.bo.next : 2;
    boss.summons = isNum(ck.bo?.su) ? ck.bo.su : 0;
    w.boss = boss;
    placeBoss(w, boss);
    this.world = w;
    this.updateFlags();
    this.kingId = clampInt(ck.kid, 1, 262143) ?? this.kingId;
    this.nextId = Math.max(this.nextId, clampInt(ck.nid, 100, 262143) ?? 100);
    this.turn = clampInt(ck.turn, 1, 9999) ?? 1;
    this.blackTurns = clampInt(ck.bturns, 0, 9999) ?? 0;
    boss.next = Math.max(boss.next, this.blackTurns + 1);
    this.side = 'w';
    this.done = new Set();
    this.undo = new Map();
    this.bt = null;
    this.lastBlack = [];
    this.phase = 'battle';
    this.result = null;
    this.awake = this.awake ?? { t0: -99, gh: [], cap: [C.KEEP_X + 3, C.KEEP_Y + 3] };
    this.ck = ck;
    this.rebalance();
    return true;
  }

  retry() {
    if (this.phase !== 'lost') return false;
    this.stats.retries++;
    if (!this.ck) this.startChess();
    else this.restore(this.ck);
    this.emit('r');
    return true;
  }

  // ---------------------------------------------------------------- the clock

  step(dt) {
    if (this.paused) return;
    this.t += dt;
    if (this.phase === 'chess') {
      if (this.chess.pos.t === 'b' && this.t >= this.chess.think) this.noirMove();
      return;
    }
    if (this.phase === 'awaken') {
      if (this.t >= this.awake.t0 + C.CINEMATIC) this.beginBattle();
      return;
    }
    if (this.phase !== 'battle' || this.side !== 'b' || !this.bt) return;
    let guard = 0;
    while (this.bt && this.t >= this.bt.at && guard++ < 50) {
      const wait = this.blackBeat();
      if (this.bt) this.bt.at = this.t + wait;
      if (this.phase !== 'battle') break;
    }
  }

  // ---------------------------------------------------------------- snapshots for the room

  /** { g, p: [chunks] }: the room state the host writes. */
  encode() {
    const w = this.world;
    const boss = w.boss;
    const g = {
      v: 2,
      ph: this.phase,
      t: Math.round(this.t * 100) / 100,
      seed: this.seed,
      diff: this.diffKey,
      sl: this.slots(),
      sq: this.seq,
      ev: this.recentEvents(),
      res: this.result,
      st: { re: this.stats.retries },
      pz: this.paused,
    };
    if (this.phase === 'chess' || (this.phase === 'lost' && !this.awake)) {
      const ch = this.chess;
      g.ch = { b: boardString(ch.pos.b), t: ch.pos.t, cr: ch.pos.cr, ep: ch.pos.ep, fm: ch.pos.fm, own: ch.own.map((o) => (o < 0 ? '.' : String(o))).join(''), mv: ch.moves, last: ch.last, wc: ch.wc, bc: ch.bc, tt: ch.turnT, cb: ch.capB.join('') };
      return { g, p: null };
    }
    g.aw = this.awake;
    g.turn = this.turn;
    g.side = this.side;
    g.done = [...this.done];
    g.bt = this.blackTurns;
    g.lb = this.lastBlack.slice(-40);
    g.cap = this.caps;
    g.lost = this.lost;
    g.dmg = this.dmg;
    g.kid = this.kingId;
    g.ck = this.ck ? { turn: this.ck.turn } : null;
    g.un = this.slots().filter((s) => this.undo.get(s)?.length);
    if (boss) g.bo = { ph: boss.ph, atk: boss.atk, hp: encodeHp(boss.parts), mm: boss.mm, dead: boss.dead, da: boss.deadAt, next: boss.next, su: boss.summons ?? 0 };
    return { g, p: encodePieces(w.pieces.values()) };
  }
}

/** Rebuild a battlefield to draw (or to take over as the new host) from room state. */
export function decodeWorld(g, chunks, into = null) {
  if (!g || typeof g !== 'object') return null;
  const w = into ?? makeWorld();
  w.occ.fill(0);
  w.pieces = decodePieces(Array.isArray(chunks) ? chunks : [], w.pieces instanceof Map ? w.pieces : new Map());
  for (const p of w.pieces.values()) if (w.occ[p.y * W + p.x] === 0) w.occ[p.y * W + p.x] = p.id;
  w.boss = null;
  w.bossOpen = false;
  w.bossArmed = false;
  w.kingOpen = false;
  if (g.bo && typeof g.bo === 'object') {
    const boss = makeBoss(C.BOSS_X, C.BOSS_Y, isNum(g.bo.mm) ? g.bo.mm : 1);
    const hp = decodeHp(g.bo.hp, boss.parts.length);
    if (hp) boss.parts.forEach((p, i) => (p.hp = Math.min(hp[i], 4095)));
    boss.ph = clampInt(g.bo.ph, 1, 3) ?? 1;
    boss.atk = Array.isArray(g.bo.atk) ? g.bo.atk.filter((a) => a && typeof a.k === 'string').slice(0, 8) : [];
    boss.dead = !!g.bo.dead;
    boss.deadAt = isNum(g.bo.da) ? g.bo.da : 0;
    boss.next = isNum(g.bo.next) ? g.bo.next : 0;
    boss.summons = isNum(g.bo.su) ? g.bo.su : 0;
    w.boss = boss;
    if (!boss.dead) placeBoss(w, boss);
    w.bossOpen = !boss.dead;
    w.bossArmed = !boss.dead;
    w.kingOpen = kingExposed(boss);
  }
  return w;
}

/** A new host carries on from the room's record. */
Sim.fromRoom = function fromRoom(g, chunks, slots, ck = null) {
  if (!g || typeof g !== 'object' || !isNum(g.seed)) return null;
  const sim = new Sim({ seed: g.seed, diff: g.diff, slots });
  sim.t = isNum(g.t) ? g.t : 0;
  const lastEv = Array.isArray(g.ev) && g.ev.length ? Math.max(...g.ev.map((e) => (Array.isArray(e) && isNum(e[0]) ? e[0] : 0))) : 0;
  sim.seq = Math.max(lastEv, isNum(g.sq) ? g.sq : 0);
  sim.ev = Array.isArray(g.ev) ? g.ev.slice(-MAX_EVENTS) : [];
  sim.evT = sim.ev.map(() => sim.t - 10);
  sim.stats.retries = isNum(g.st?.re) ? g.st.re : 0;
  if (ck && Array.isArray(ck.pcs)) sim.ck = ck;
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
  const w = decodeWorld(g, chunks);
  if (!w) return sim;
  // Guard posts aren't in snapshots: a new host's guards hold where they stand.
  for (const p of w.pieces.values()) if (p.s !== 'w' && p.w === ROLE.guard) [p.px, p.py] = [p.x, p.y];
  if (w.boss) {
    w.boss.atk = w.boss.atk.map((a) => ({ ...a }));
    w.boss.parts.forEach((p, i) => (p.mh = Math.max(1, Math.round(PARTS[i].hp * (isNum(g.bo?.mm) ? g.bo.mm : 1)))));
  }
  sim.world = w;
  sim.phase = ['awaken', 'battle', 'won', 'lost'].includes(g.ph) ? g.ph : 'battle';
  sim.awake = g.aw && typeof g.aw === 'object' ? g.aw : { t0: -99, gh: [], cap: [C.KEEP_X + 3, C.KEEP_Y + 3] };
  sim.turn = clampInt(g.turn, 0, 9999) ?? 1;
  sim.blackTurns = clampInt(g.bt, 0, 9999) ?? 0;
  sim.side = g.side === 'b' ? 'b' : 'w';
  sim.done = new Set(Array.isArray(g.done) ? g.done.filter((s) => clampInt(s, 0, 3) !== null) : []);
  sim.lastBlack = Array.isArray(g.lb) ? g.lb.filter((e) => Array.isArray(e)).slice(-40) : [];
  // A black turn in progress starts over from its moves (what already happened stays).
  if (sim.side === 'b') sim.bt = { stage: 'moves', moved: new Set(), strikes: 99, moves: 0, at: sim.t + 0.3 };
  const arr = (a) => [0, 1, 2, 3].map((i) => (Array.isArray(a) && isNum(a[i]) ? a[i] : 0));
  sim.caps = arr(g.cap);
  sim.lost = arr(g.lost);
  sim.dmg = arr(g.dmg);
  sim.kingId = clampInt(g.kid, 1, 262143) ?? 0;
  sim.result = g.res ?? null;
  sim.nextId = Math.max(100, ...[...w.pieces.keys()].map((id) => id + 1));
  return sim;
};
