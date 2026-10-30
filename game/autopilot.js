// A scripted commander: plays White through the whole game by sending the same commands a player would. Used by the
// tests (a full run must finish) and to stage the store pictures from a real battle.

import { legalMoves } from './chess.js';
import { movesOf, attackedBy, active, dist } from './rules.js';
import { ST_ORDER } from './config.js';
import { rngFor } from './rng.js';

export function createAutopilot(sim, slot, { skill = 0.8, seed = 7 } = {}) {
  let nextThink = 0;
  let nextOrders = 0;
  let n = 0;
  return function think() {
    const t = sim.t;
    const r = rngFor(seed, slot, n++);
    if (sim.phase === 'chess') {
      if (sim.chess.pos.t !== 'w' || t < nextThink) return;
      nextThink = t + 0.4;
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
    if (sim.phase !== 'rts' || t < nextThink) return;
    nextThink = t + 0.35 + (1 - skill) * 0.6;
    const w = sim.world;
    const mine = [];
    for (const p of w.pieces.values()) if (p.s === 'w' && p.o === slot && active(p)) mine.push(p);
    // Dodge: pieces standing where Black will take them step to a safe square (a capture if there is one).
    for (const p of mine) {
      if (t < p.cd || r() > skill) continue;
      if (!attackedBy(w, p.x, p.y, 1)) continue;
      const moves = movesOf(w, p);
      const safe = moves.filter((m) => !attackedBy(w, m.x, m.y, 1, p.id));
      const pick = safe.find((m) => m.o !== 0) ?? safe[0];
      if (pick) sim.cmd(slot, { t: 'mv', id: p.id, x: pick.x, y: pick.y });
      else if (p.id === sim.kingId) sim.cmd(slot, { t: 'castle' });
    }
    // Dodge telegraphed attacks too.
    const boss = w.boss;
    if (boss && boss.atk.length && r() < skill) {
      const danger = new Set();
      for (const atk of boss.atk) for (const pos of sim.attackSquaresFor(atk)) danger.add(pos);
      for (const p of mine) {
        if (t < p.cd || !danger.has(p.y * 100 + p.x)) continue;
        const out = movesOf(w, p).find((m) => !danger.has(m.y * 100 + m.x) && !attackedBy(w, m.x, m.y, 1, p.id));
        if (out) sim.cmd(slot, { t: 'mv', id: p.id, x: out.x, y: out.y });
      }
    }
    if (t < nextOrders) return;
    nextOrders = t + 3;
    // Spend material on promotions.
    for (const p of mine) {
      if (p.k === 'p' && sim.mat[slot] >= 15 && r() < 0.5) sim.cmd(slot, { t: 'promo', id: p.id, k: 'q' });
    }
    const orders = [];
    if (sim.wave.st === 'boss' && boss) {
      // Everyone but the king and a guard of four closes on the dragon.
      const king = w.pieces.get(sim.kingId);
      const guard = king ? mine.filter((p) => p.id !== king.id).sort((a, b) => dist(a.x, a.y, king.x, king.y) - dist(b.x, b.y, king.x, king.y)).slice(0, 4) : [];
      for (const p of mine) {
        if (p.id === sim.kingId || guard.includes(p) || p.st & ST_ORDER) continue;
        const a = r() * Math.PI * 2;
        const rad = 'rbq'.includes(p.k) ? 5 : 3;
        orders.push([p.id, Math.round(boss.x + Math.cos(a) * rad), Math.round(boss.y + Math.sin(a) * rad)]);
      }
    } else {
      // Hunt black pieces near our army.
      const blacks = [];
      for (const q of w.pieces.values()) if (q.s !== 'w' && active(q)) blacks.push(q);
      for (const p of mine) {
        if (p.id === sim.kingId || p.st & ST_ORDER || r() > 0.6) continue;
        let best = null;
        let bd = 14;
        for (const q of blacks) {
          const d = dist(p.x, p.y, q.x, q.y);
          if (d < bd) {
            bd = d;
            best = q;
          }
        }
        if (best) orders.push([p.id, best.x, best.y]);
      }
    }
    if (orders.length) sim.cmd(slot, { t: 'go', o: orders });
    if (sim.wave.st === 'break') sim.cmd(slot, { t: 'ready', on: true });
  };
}
