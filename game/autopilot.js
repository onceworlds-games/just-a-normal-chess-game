// A scripted commander: plays White through the whole game by sending the same commands a player would. Used by the
// tests (a full game must finish), the balance runs and the store pictures and video.

import { legalMoves } from './chess.js';
import { movesOf, attackedBy, attacksOf, active, dist, idx } from './rules.js';
import { VALUE, ST_MOVED, ST_ELITE, H } from './config.js';
import { attackSquares } from './boss.js';
import { suppose } from './blackai.js';
import { rngFor } from './rng.js';

const val = (q, kingId) => (q.id === kingId ? 60 : (VALUE[q.k] || 1) * (q.st & ST_ELITE ? 1.5 : 1));

/** White's best single move for `slot` now, or null. */
export function bestWhiteMove(sim, slot, { skill = 0.85, r = Math.random, bold = 0 } = {}) {
  const w = sim.world;
  const boss = w.boss;
  const kingId = sim.kingId;
  const danger = new Set();
  for (const atk of boss?.atk ?? []) for (const pos of attackSquares(w, atk)) danger.add(pos);
  const blacks = [];
  for (const q of w.pieces.values()) if (q.s !== 'w' && active(q)) blacks.push(q);
  // Where to head: the nearest black piece, or once Black's army thins out, the nearest living part of the dragon.
  const parts = boss && !boss.dead && blacks.length < 14 ? boss.parts.filter((p) => p.hp > 0 && (p.g !== 'king' || w.kingOpen)).map((p) => [boss.x + p.dx, boss.y + p.dy]) : [];
  const target = (x, y) => {
    let d = Infinity;
    for (const q of blacks) d = Math.min(d, dist(x, y, q.x, q.y));
    for (const [px, py] of parts) d = Math.min(d, dist(x, y, px, py) - 0.5);
    return d;
  };
  let best = null;
  const sq = [];
  // Ahead on material, trades favour White: a defended piece is worth risking.
  let mw = 0;
  let mb = 0;
  for (const q of w.pieces.values()) if (active(q)) q.s === 'w' ? (mw += VALUE[q.k] || 0) : (mb += VALUE[q.k] || 0);
  const tradeOff = mw > mb * 1.15 || bold ? 0.3 : 0.5;
  const king0 = w.pieces.get(kingId);
  const kingInCheck = !!king0 && attackedBy(w, king0.x, king0.y, 1);
  for (const p of w.pieces.values()) {
    if (p.s !== 'w' || p.o !== slot || !active(p) || p.st & ST_MOVED) continue;
    const v = val(p, kingId);
    const threatened = attackedBy(w, p.x, p.y, 1) || danger.has(idx(p.x, p.y));
    const dNow = target(p.x, p.y);
    for (const m of movesOf(w, p)) {
      let s = 0;
      if (m.o > 0) {
        const q = w.pieces.get(m.o);
        s += 10 * val(q, kingId) * (q.hp > 1 ? 0.4 : 1);
      } else if (m.o < 0) {
        const part = boss.parts[-m.o - 1];
        s += part.g === 'king' ? 40 : 8 + 6 / Math.max(1, part.hp);
        // A strike leaves the piece where it is.
        if (threatened) s -= 10 * v * 0.8;
        s += r() * skill;
        if (!best || s > best.score) best = { p, m, score: s };
        continue;
      }
      const king = w.pieces.get(kingId);
      const after = suppose(w, p, m.x, m.y, () => {
        const exposed = attackedBy(w, m.x, m.y, 1) || danger.has(idx(m.x, m.y));
        // Never open a line onto the king.
        const bare = !!king && p !== king && attackedBy(w, king.x, king.y, 1);
        const defended = exposed && attackedBy(w, m.x, m.y, 0, p.id);
        let threat = 0;
        for (const a of attacksOf(w, p, sq)) {
          const o = w.occ[idx(a.x, a.y)];
          const q = o > 0 ? w.pieces.get(o) : null;
          if (q && q.s !== 'w') threat += Math.min(9, val(q, kingId) * 0.25);
        }
        return { exposed, defended, threat, d: target(m.x, m.y), bare };
      });
      if (after.bare && !kingInCheck) s -= 600;
      if (after.exposed) s -= 10 * v * (after.defended && p.id !== kingId ? tradeOff : 1);
      if (threatened && !after.exposed) s += 7 * v;
      if (!after.exposed) s += after.threat;
      if (p.id === kingId) s -= threatened ? 0 : 3;
      else s += (1.2 + bold) * (dNow - after.d) * (p.k === 'p' ? 0.6 : 1);
      if (p.k === 'p' && m.y === 0) s += 20;
      s += r() * (1 - skill) * 6;
      if (!best || s > best.score) best = { p, m, score: s };
    }
  }
  return best && best.score > 0.5 ? best : null;
}

export function createAutopilot(sim, slot, { skill = 0.85, seed = 7 } = {}) {
  let n = 0;
  let next = 0;
  let quiet = 0;
  let seen = 0;
  let lastTurn = -1;
  return function think() {
    const r = rngFor(seed, slot, n++);
    if (sim.phase === 'chess') {
      if (sim.chess.pos.t !== 'w' || sim.t < next) return;
      next = sim.t + 0.4;
      const moves = legalMoves(sim.chess.pos).filter((m) => sim.ownerOk(slot, sim.chess.own[m.from]));
      if (!moves.length) return;
      const caps = moves.filter((m) => m.c !== '.');
      const m = caps.length && r() < 0.9 ? caps[0] : moves[Math.floor(r() * moves.length)];
      sim.cmd(slot, { t: 'cm', from: m.from, to: m.to });
      return;
    }
    if (sim.phase === 'lost') {
      sim.cmd(slot, { t: 'retry' });
      return;
    }
    if (sim.phase !== 'battle' || sim.side !== 'w' || sim.done.has(slot)) return;
    // Turns without a capture make it bolder, as a player would get.
    if (sim.turn !== lastTurn) {
      lastTurn = sim.turn;
      let caps = 0;
      for (const e of sim.ev) if (e[0] > seen && (e[1] === 'x' || e[1] === 'h')) caps++;
      seen = sim.seq;
      quiet = caps ? 0 : quiet + 1;
    }
    const bold = quiet >= 3 ? 1.5 : 0;
    // A whole turn at once: move while anything is worth it, then end the turn.
    for (let i = 0; i < 80; i++) {
      const pick = bestWhiteMove(sim, slot, { skill, r, bold });
      if (!pick) break;
      if (!sim.cmd(slot, { t: 'mv', id: pick.p.id, x: pick.m.x, y: pick.m.y })) break;
      if (sim.phase !== 'battle') return;
    }
    sim.cmd(slot, { t: 'end' });
  };
}

export { H };
