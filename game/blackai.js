// The Black Court: the AI that moves Black's army. Each black turn it picks its best single move again and again
// (every piece at most once) until nothing is worth doing or it reaches its move limit. A move is worth what it takes,
// minus what it risks (a piece left where White can take it, worse if nothing defends it), plus escaping a threat,
// closing in on White (hunters), holding a post near the dragon (guards) and pushing pawns.

import { VALUE, ST_ELITE, ST_GHOST, ROLE } from './config.js';
import { movesOf, attacksOf, attackedBy, active, dist, idx } from './rules.js';

const TEAM_W = 0;
const TEAM_B = 1;

export function pieceValue(q, kingId) {
  if (q.id === kingId) return 60;
  return (VALUE[q.k] || 1) * (q.st & ST_ELITE ? 1.5 : 1);
}

/** Run fn with piece p standing on (x, y) (and the square's occupant lifted off), then put everything back. */
function suppose(w, p, x, y, fn) {
  const from = idx(p.x, p.y);
  const to = idx(x, y);
  const was = w.occ[to];
  const px = p.x;
  const py = p.y;
  w.occ[from] = 0;
  w.occ[to] = p.id;
  p.x = x;
  p.y = y;
  try {
    return fn();
  } finally {
    p.x = px;
    p.y = py;
    w.occ[to] = was;
    w.occ[from] = p.id;
  }
}

/**
 * Black's best move now: { p, m, score } or null. `moved` holds the ids that already moved this turn.
 * opts: { kingId, risk, aggression, threshold }
 */
export function bestBlackMove(w, moved, { kingId = 0, risk = 1, aggression = 1, threshold = 2.5 } = {}) {
  const whites = [];
  for (const q of w.pieces.values()) if (q.s === 'w' && active(q)) whites.push(q);
  if (!whites.length) return null;
  const king = w.pieces.get(kingId);
  const nearest = (x, y) => {
    let d = Infinity;
    for (const q of whites) {
      const e = dist(x, y, q.x, q.y) - (q === king ? 2 : 0);
      if (e < d) d = e;
    }
    return d;
  };
  let best = null;
  const sq = [];
  for (const p of w.pieces.values()) {
    if (p.s === 'w' || !active(p) || p.st & ST_GHOST || moved.has(p.id)) continue;
    const v = VALUE[p.k] || 1;
    const threatened = attackedBy(w, p.x, p.y, TEAM_W);
    const guarded = threatened && attackedBy(w, p.x, p.y, TEAM_B, p.id);
    const dNow = nearest(p.x, p.y);
    const role = p.w;
    // A guard wakes up when White comes within reach of its post.
    const post = p.px === undefined ? null : [p.px, p.py];
    const roused = role === ROLE.guard && dNow < 4.5;
    for (const m of movesOf(w, p)) {
      if (m.o < 0) continue;
      let s = 0;
      let victim = null;
      let strike = false;
      if (m.o > 0) {
        victim = w.pieces.get(m.o);
        if (!victim || victim.s !== 'w') continue;
        s += 10 * pieceValue(victim, kingId) * (victim.hp > 1 ? 0.5 : 1);
        // Hitting an armoured king leaves the attacker where it stands.
        strike = victim.hp > 1;
      }
      const tx = strike ? p.x : m.x;
      const ty = strike ? p.y : m.y;
      const after = suppose(w, p, tx, ty, () => {
        const exposed = attackedBy(w, tx, ty, TEAM_W);
        const defended = exposed && attackedBy(w, tx, ty, TEAM_B, p.id);
        let threat = 0;
        for (const a of attacksOf(w, p, sq)) {
          const o = w.occ[idx(a.x, a.y)];
          if (o <= 0) continue;
          const q = w.pieces.get(o);
          if (q && q.s === 'w' && q !== victim) threat += Math.min(9, pieceValue(q, kingId) * 0.3);
        }
        return { exposed, defended, threat, d: nearest(tx, ty) };
      });
      // Hunters are bold: they press a threat even where White can answer, which is how a sharp player wins pieces.
      const boldness = role === ROLE.hunter ? 0.5 : 1;
      if (after.exposed) s -= 10 * v * risk * boldness * (after.defended ? 0.5 : 1);
      if (threatened && !after.exposed) s += 7 * v * (guarded ? 0.5 : 1);
      if (!after.exposed) s += after.threat * aggression;
      if (role === ROLE.pawn || role === ROLE.summoned) s += after.exposed ? -0.4 : 0.9 * aggression;
      else if (role === ROLE.hunter || roused) s += 1.4 * aggression * (dNow - after.d);
      if (role === ROLE.guard && post) {
        const away = dist(m.x, m.y, post[0], post[1]);
        if (away > 3) s -= 2 * (away - 3);
      }
      if (!best || s > best.score) best = { p, m, score: s };
    }
  }
  return best && best.score > threshold ? best : null;
}

export { suppose };
