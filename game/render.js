// The board, its pieces, the dragon and every mark on the squares. One camera over the 100×100 world: the opening is
// just the camera framing the 8×8 chess board in the middle of it.

import { W, H, KEEP_X, KEEP_Y, BOSS_X, BOSS_Y, CINEMATIC, ST_AIR, ST_ELITE, ST_GHOST, ST_VET, SLOT_COLORS, CD, STRIKE_CD } from './config.js';
import { blit, drawPiece } from './pieces.js';
import { attackSquares } from './boss.js';
import { attackedBy, active, T_ROCK, T_THRONE } from './rules.js';
import { hash } from './rng.js';

export const COLORS = {
  light: '#ebecd0',
  dark: '#779556',
  void: '#1c1b19',
  page: '#302e2b',
  select: 'rgba(255,255,51,0.5)',
  last: 'rgba(255,255,51,0.38)',
  dot: 'rgba(0,0,0,0.14)',
};

const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, t) => a + (b - a) * t;

// The dragon's drawing: per group, the pivot its parts swing around and how big they are.
const PART_SIZE = { head: 2.35, king: 1.55, torso: 1.6, neck: 1.5, lwing: 1.75, rwing: 1.75, lfeath: 1.7, rfeath: 1.7, tail: 1.55, sting: 1.7, larm: 1.45, rarm: 1.45 };
const DRAW_ORDER = ['tail', 'sting', 'lfeath', 'rfeath', 'lwing', 'rwing', 'larm', 'rarm', 'torso', 'king', 'neck', 'head'];

export function createRenderer(canvas, fx) {
  const ctx = canvas.getContext('2d');
  let cssW = 1;
  let cssH = 1;
  let dpr = 1;
  const cam = {
    cx: KEEP_X + 4,
    cy: KEEP_Y + 4,
    scale: 60,
    tcx: KEEP_X + 4,
    tcy: KEEP_Y + 4,
    tscale: 60,
    ox: 0,
    oy: 0,
    toScreen(x, y) {
      return [(x - cam.cx) * cam.scale + cssW / 2 + cam.ox, (y - cam.cy) * cam.scale + cssH / 2 + cam.oy];
    },
    toWorld(px, py) {
      return [(px - cssW / 2 - cam.ox) / cam.scale + cam.cx, (py - cssH / 2 - cam.oy) / cam.scale + cam.cy];
    },
    snap() {
      cam.cx = cam.tcx;
      cam.cy = cam.tcy;
      cam.scale = cam.tscale;
    },
  };
  const tween = new Map(); // piece id → { x, y, fx, fy, tx, ty, t0, dur, hop }
  const partFx = new Map(); // part index → { hit, lunge: [x, y, t0] }
  const rockCache = new Map();
  let lastNow = 0;

  function resize(w, h, ratio) {
    cssW = Math.max(1, w);
    cssH = Math.max(1, h);
    dpr = ratio;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
  }

  /** Where a piece is drawn now (sliding between squares), in board units, its square's centre. */
  function placeOf(p, now) {
    let a = tween.get(p.id);
    if (!a) {
      a = { x: p.x, y: p.y, fx: p.x, fy: p.y, tx: p.x, ty: p.y, t0: now, dur: 0, hop: false, born: now };
      tween.set(p.id, a);
    }
    if (a.tx !== p.x || a.ty !== p.y) {
      const d = Math.hypot(p.x - a.x, p.y - a.y);
      a.fx = a.x;
      a.fy = a.y;
      a.tx = p.x;
      a.ty = p.y;
      a.t0 = now;
      a.dur = d > 12 ? 0 : Math.min(0.32, 0.1 + d * 0.025);
      a.hop = p.k === 'n';
    }
    const k = a.dur ? ease((now - a.t0) / a.dur) : 1;
    a.x = lerp(a.fx, a.tx, k);
    a.y = lerp(a.fy, a.ty, k);
    a.lift = a.hop && k < 1 ? Math.sin(Math.PI * k) * 0.35 : 0;
    return a;
  }

  function forget(world) {
    for (const id of tween.keys()) if (!world.pieces.has(id)) tween.delete(id);
  }

  function rockSprite(size, seed) {
    const s = Math.max(6, Math.round(size / 2) * 2);
    const variant = seed % 4;
    const key = s * 10 + variant;
    let c = rockCache.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = s;
    c.height = s;
    const g = c.getContext('2d');
    const r = (n) => {
      const v = Math.sin((variant + 1) * 12.9898 + n * 78.233) * 43758.5453;
      return v - Math.floor(v);
    };
    const pts = [];
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r(i) * 0.4;
      const rad = 0.36 + r(i + 9) * 0.1;
      pts.push([0.5 + Math.cos(a) * rad, 0.56 + Math.sin(a) * rad * 0.8]);
    }
    g.scale(s, s);
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.beginPath();
    g.ellipse(0.52, 0.86, 0.4, 0.1, 0, 0, Math.PI * 2);
    g.fill();
    const path = new Path2D();
    pts.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
    path.closePath();
    const grad = g.createLinearGradient(0.2, 0.2, 0.8, 0.9);
    grad.addColorStop(0, '#a19c94');
    grad.addColorStop(1, '#5c5852');
    g.fillStyle = grad;
    g.fill(path);
    g.lineWidth = 0.05;
    g.strokeStyle = '#2f2c29';
    g.lineJoin = 'round';
    g.stroke(path);
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.lineWidth = 0.035;
    g.beginPath();
    g.moveTo(pts[5][0] + 0.05, pts[5][1] + 0.05);
    g.lineTo(0.48, 0.38);
    g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.beginPath();
    g.moveTo(0.5, 0.55);
    g.lineTo(0.62, 0.7);
    g.stroke();
    rockCache.set(key, c);
    if (rockCache.size > 120) rockCache.delete(rockCache.keys().next().value);
    return c;
  }

  // ---------------------------------------------------------------- the dragon

  /** Where part i is drawn: { x, y, rot, size } in board units, its square's centre. */
  function partPose(boss, part, t, bx, by) {
    let x = bx + part.dx + 0.5;
    let y = by + part.dy + 0.5;
    let rot = part.rot;
    const breathe = Math.sin(t * 1.3) * 0.05;
    y += breathe * (part.dy < 0 ? 1 : 0.5);
    const swing = (pivotX, pivotY, a) => {
      const dx = x - pivotX;
      const dy = y - pivotY;
      x = pivotX + dx * Math.cos(a) - dy * Math.sin(a);
      y = pivotY + dx * Math.sin(a) + dy * Math.cos(a);
      rot += a;
    };
    const flying = boss._lift ?? 0;
    const flap = flying > 0.2 ? Math.sin(t * 9) * 0.32 : Math.sin(t * 1.7) * 0.075 + (boss._flap ?? 0);
    if (part.g === 'lwing' || part.g === 'lfeath') swing(bx - 0.6, by - 0.6, -flap);
    else if (part.g === 'rwing' || part.g === 'rfeath') swing(bx + 1.6, by - 0.6, flap);
    else if (part.g === 'tail' || part.g === 'sting') {
      const i = Math.abs(part.dx) + Math.abs(part.dy);
      const sway = Math.sin(t * 1.5 - i * 0.6) * 0.07 * (1 + i * 0.25) + (boss._curl ?? 0) * i * 0.05;
      x += sway;
      y += sway * 0.4;
      rot += sway * 0.5;
    } else if (part.g === 'head' || part.g === 'neck') {
      y += Math.sin(t * 1.3 + 0.6) * 0.07 - (boss._rear ?? 0) * 0.5;
      rot += Math.sin(t * 0.7) * 0.05 + (boss._rear ?? 0) * -0.15;
    } else if (part.g === 'larm' || part.g === 'rarm') {
      rot += Math.sin(t * 2 + part.dx) * 0.12;
    }
    const fxp = partFx.get(part.i);
    if (fxp) {
      if (fxp.hit && t - fxp.hit < 0.18) {
        const k = 1 - (t - fxp.hit) / 0.18;
        x += Math.sin(t * 90) * 0.06 * k;
      }
      if (fxp.lunge && t - fxp.lunge[2] < 0.35) {
        const k = Math.sin(((t - fxp.lunge[2]) / 0.35) * Math.PI);
        x += (fxp.lunge[0] + 0.5 - x) * 0.5 * k;
        y += (fxp.lunge[1] + 0.5 - y) * 0.5 * k;
      }
    }
    return { x, y, rot, size: PART_SIZE[part.g] ?? 1.2 };
  }

  /** The dragon's ground position, height and whether it is in the air, from its flight plan. */
  function bossPlace(boss, t) {
    const f = boss.fly;
    if (!f) return { x: boss.x, y: boss.y, h: 0 };
    if (t < f.tl) {
      const k = clamp01((t - f.t0) / Math.max(0.01, f.tl - f.t0));
      return { x: f.fx, y: f.fy, h: ease(k) * 1.6 };
    }
    const k = clamp01((t - f.tl) / Math.max(0.01, f.t1 - f.tl));
    const travel = ease(clamp01(k / 0.75));
    const fall = k > 0.8 ? ease((k - 0.8) / 0.2) : 0;
    return { x: lerp(f.fx, f.tx, travel), y: lerp(f.fy, f.ty, travel), h: (1.6 + Math.sin(Math.PI * clamp01(k / 0.8)) * 3) * (1 - fall) };
  }

  function drawBoss(boss, t, simT, opts = {}) {
    const s = cam.scale;
    const place = bossPlace(boss, simT);
    const lift = place.h;
    boss._lift = lift;
    // Shadow.
    const [sx, sy] = cam.toScreen(place.x + 0.5, place.y + 1);
    ctx.save();
    ctx.globalAlpha = 0.18 / (1 + lift * 0.3);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(sx, sy, 6 * s * (1 + lift * 0.08), 3.4 * s * (1 + lift * 0.08), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Its real squares, faintly: what a legal move can strike.
    if (!lift && !opts.appear) {
      ctx.fillStyle = 'rgba(110,15,15,0.22)';
      for (const part of boss.parts) {
        if (part.hp <= 0) continue;
        const [qx, qy] = cam.toScreen(place.x + part.dx, place.y + part.dy);
        ctx.fillRect(qx, qy, s, s);
      }
    }
    const appear = opts.appear; // part index → 0..1 (the awakening's assembly)
    const parts = boss.parts;
    for (const g of DRAW_ORDER) {
      for (const part of parts) {
        if (part.g !== g || part.hp <= 0) continue;
        let { x, y, rot, size } = partPose(boss, part, t, place.x, place.y);
        y -= lift;
        let alpha = 1;
        if (appear) {
          const k = appear(part.i);
          if (k <= 0) continue;
          const from = opts.from(part.i);
          x = lerp(from[0], x, ease(k));
          y = lerp(from[1], y, ease(k)) - Math.sin(Math.PI * k) * 3;
          alpha = Math.min(1, k * 3);
        }
        const [px, py] = cam.toScreen(x, y);
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(rot);
        const fxp = partFx.get(part.i);
        const flash = fxp?.hit && t - fxp.hit < 0.12;
        blit(ctx, part.k, 'd', 0, 0, s * size, alpha);
        if (flash) {
          ctx.globalCompositeOperation = 'lighter';
          blit(ctx, part.k, 'd', 0, 0, s * size, 0.7);
          ctx.globalCompositeOperation = 'source-over';
        }
        // Wounds: a part below half shows cracks glowing red.
        if (part.hp < part.mh * 0.5 && !appear) {
          ctx.strokeStyle = `rgba(255,70,40,${0.5 + 0.3 * Math.sin(t * 6 + part.i)})`;
          ctx.lineWidth = Math.max(1, s * 0.04);
          ctx.beginPath();
          ctx.moveTo(-s * 0.15, -s * 0.1);
          ctx.lineTo(s * 0.02, s * 0.05);
          ctx.lineTo(-s * 0.05, s * 0.22);
          ctx.stroke();
        }
        if (part.g === 'head') {
          // The crown it took from its king, and the eye.
          // Only the crown: the top half of a king, set on the knight's brow.
          const cs = s * 1.05;
          const cy = -s * size * 0.44;
          ctx.save();
          ctx.beginPath();
          ctx.rect(s * 0.15 - cs * 0.7, cy - cs * 0.6, cs * 1.4, cs * 0.6 + cs * 0.06);
          ctx.clip();
          blit(ctx, 'k', 'd', s * 0.15, cy, cs, alpha);
          ctx.restore();
          const ex = -s * size * 0.04;
          const ey = -s * size * 0.17;
          // It blinks: a moment every few seconds when the light goes out.
          const blink = (t % 5.3) < 0.12 ? 0.08 : 1;
          const pulse = (0.75 + 0.25 * Math.sin(t * 3.1)) * blink;
          const glow = ctx.createRadialGradient(ex, ey, 0, ex, ey, s * 0.35);
          glow.addColorStop(0, `rgba(255,40,30,${0.9 * pulse * alpha})`);
          glow.addColorStop(0.25, `rgba(255,30,20,${0.45 * pulse * alpha})`);
          glow.addColorStop(1, 'rgba(255,0,0,0)');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(ex, ey, s * 0.35, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = blink < 1 ? '#3a0f0d' : '#ff2a1f';
          ctx.beginPath();
          ctx.arc(ex, ey, Math.max(1.5, s * 0.055), 0, Math.PI * 2);
          ctx.fill();
        }
        // Embers rise from a wounded body.
        if (!appear && boss.ph >= 2 && part.hp < part.mh * 0.6 && Math.random() < 0.02) fx.sparks(x, y - 0.2, 'rgba(255,120,60,0.9)', 1);
        if (part.g === 'king' && boss.parts.some((p) => p.g === 'torso' && p.hp > 0) && !appear) {
          // Shielded while its heart guard stands.
          const r = s * 0.78;
          const sh = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, r);
          sh.addColorStop(0, 'rgba(140,20,30,0)');
          sh.addColorStop(0.85, `rgba(200,40,50,${0.25 + 0.1 * Math.sin(t * 2.4)})`);
          sh.addColorStop(1, 'rgba(255,90,90,0.5)');
          ctx.fillStyle = sh;
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }
  }

  // ---------------------------------------------------------------- the frame

  function draw(f) {
    const now = f.now;
    const dt = Math.min(0.1, Math.max(0, now - lastNow));
    lastNow = now;
    // Camera easing and shake.
    const k = 1 - Math.pow(0.0006, dt);
    cam.cx += (cam.tcx - cam.cx) * k;
    cam.cy += (cam.tcy - cam.cy) * k;
    cam.scale += (cam.tscale - cam.scale) * k;
    const shake = fx.shakeOffset(now);
    cam.ox = shake.x;
    cam.oy = shake.y;
    fx.update(dt);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = f.chessOnly ? COLORS.page : COLORS.void;
    ctx.fillRect(0, 0, cssW, cssH);
    const s = cam.scale;
    const world = f.world;
    if (!world) return;
    const [wx0, wy0] = cam.toWorld(0, 0);
    const [wx1, wy1] = cam.toWorld(cssW, cssH);
    const vx0 = Math.max(0, Math.floor(wx0) - 1);
    const vy0 = Math.max(0, Math.floor(wy0) - 1);
    const vx1 = Math.min(W - 1, Math.ceil(wx1) + 1);
    const vy1 = Math.min(H - 1, Math.ceil(wy1) + 1);

    // The board's visible rectangle (it grows during the awakening).
    let b = world.bounds;
    const aw = f.awake;
    const cine = aw && f.t - aw.t0 < CINEMATIC + 0.5 ? f.t - aw.t0 : -1;
    const keepRect = [KEEP_X, KEEP_Y, KEEP_X + 7, KEEP_Y + 7];
    let grow = 1;
    if (cine >= 0) {
      grow = ease((cine - 3) / 3);
      b = [0, 1, 2, 3].map((i) => Math.round(lerp(keepRect[i], world.bounds[i], grow)));
    }

    if (!f.chessOnly) {
      // The unrevealed board under the void: a faint grid, so the battlefield reads as bigger than what's lit.
      const [gx0, gy0] = cam.toScreen(0, 0);
      const [gx1, gy1] = cam.toScreen(W, H);
      ctx.fillStyle = '#22211f';
      ctx.fillRect(gx0, gy0, gx1 - gx0, gy1 - gy0);
      if (s > 7) {
        ctx.fillStyle = 'rgba(255,255,255,0.025)';
        for (let y = vy0; y <= vy1; y++) {
          for (let x = vx0 + ((vx0 + y) & 1); x <= vx1; x += 2) {
            if (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]) continue;
            const [px, py] = cam.toScreen(x, y);
            ctx.fillRect(px, py, s, s);
          }
        }
      }
    }

    // Squares.
    const bx0 = Math.max(vx0, b[0]);
    const by0 = Math.max(vy0, b[1]);
    const bx1 = Math.min(vx1, b[2]);
    const by1 = Math.min(vy1, b[3]);
    const [ox, oy] = cam.toScreen(b[0], b[1]);
    const [ex, ey] = cam.toScreen(b[2] + 1, b[3] + 1);
    ctx.fillStyle = COLORS.light;
    ctx.fillRect(ox, oy, ex - ox, ey - oy);
    ctx.fillStyle = COLORS.dark;
    const pad = s > 6 ? 0.5 : 0;
    for (let y = by0; y <= by1; y++) {
      for (let x = bx0 + (((bx0 + y) & 1) === 1 ? 0 : 1); x <= bx1; x += 2) {
        const [px, py] = cam.toScreen(x, y);
        ctx.fillRect(px - pad * 0.5, py - pad * 0.5, s + pad, s + pad);
      }
    }
    // The throne: dark, scorched squares while sealed; cracked when open.
    if (world.terr && !f.chessOnly) {
      for (let y = by0; y <= by1; y++) {
        for (let x = bx0; x <= bx1; x++) {
          if (world.terr[y * W + x] !== T_THRONE) continue;
          const [px, py] = cam.toScreen(x, y);
          const dark = (x + y) & 1;
          ctx.fillStyle = world.sealed ? (dark ? '#b9ab98' : '#d8ccba') : dark ? 'rgba(120,40,30,0.28)' : 'rgba(120,40,30,0.12)';
          ctx.fillRect(px - 0.25, py - 0.25, s + 0.5, s + 0.5);
        }
      }
    }
    // While sealed, a ward of red light rings the throne.
    if (world.boss && world.sealed && !f.chessOnly) {
      const [cx, cy] = cam.toScreen(world.boss.x + 0.5, world.boss.y + 0.5);
      ctx.strokeStyle = `rgba(190,30,30,${0.35 + 0.15 * Math.sin(now * 2)})`;
      ctx.lineWidth = Math.max(2, s * 0.18);
      ctx.beginPath();
      ctx.arc(cx, cy, s * 8.6, 0, Math.PI * 2);
      ctx.stroke();
    }
    // The old board keeps a thin gold frame after the awakening, with its coordinates.
    if (!f.chessOnly && cine < 0) {
      const [kx, ky] = cam.toScreen(KEEP_X, KEEP_Y);
      ctx.strokeStyle = 'rgba(214,170,74,0.55)';
      ctx.lineWidth = Math.max(1, s * 0.05);
      ctx.strokeRect(kx, ky, s * 8, s * 8);
    }
    // Growth: the side that grows next glows as its time comes.
    if (!f.chessOnly && f.growNext && cine < 0) {
      const left = f.growNext - f.t;
      if (left < 2.5 && left > 0) {
        const side = f.growSide;
        const a = (1 - left / 2.5) * 0.6;
        const [x0, y0] = cam.toScreen(world.bounds[0], world.bounds[1]);
        const [x1, y1] = cam.toScreen(world.bounds[2] + 1, world.bounds[3] + 1);
        ctx.fillStyle = `rgba(235,236,208,${a * 0.5})`;
        if (side === 0) ctx.fillRect(x0, y0 - s, x1 - x0, s);
        else if (side === 1) ctx.fillRect(x1, y0, s, y1 - y0);
        else if (side === 2) ctx.fillRect(x0, y1, x1 - x0, s);
        else ctx.fillRect(x0 - s, y0, s, y1 - y0);
      }
    }

    // Coordinates on the chess board (letters and numbers in the corner, in the other square's colour).
    if (f.chessOnly || (cine >= 0 && cine < 3.2)) {
      const fs = Math.max(11, Math.round(s * 0.21));
      ctx.font = `700 ${fs}px Figtree, system-ui, sans-serif`;
      for (let i = 0; i < 8; i++) {
        const [px, py] = cam.toScreen(KEEP_X + i, KEEP_Y + 7);
        ctx.fillStyle = (i + 7) % 2 ? COLORS.light : COLORS.dark;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText('abcdefgh'[i], px + s - s * 0.06, py + s - s * 0.03);
        const [qx, qy] = cam.toScreen(KEEP_X, KEEP_Y + i);
        ctx.fillStyle = i % 2 ? COLORS.light : COLORS.dark;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(String(8 - i), qx + s * 0.06, qy + s * 0.04);
      }
    }

    // Rocks.
    if (world.terr && !f.chessOnly) {
      const shakeRing = f.ringShake ?? 0;
      for (let y = by0; y <= by1; y++) {
        for (let x = bx0; x <= bx1; x++) {
          if (world.terr[y * W + x] !== T_ROCK) continue;
          let rise = 1;
          if (cine >= 0) rise = ease((cine - 3.4 - Math.hypot(x - BOSS_X, y - BOSS_Y) * 0.02) / 0.6);
          if (rise <= 0) continue;
          const [px, py] = cam.toScreen(x, y);
          const jx = shakeRing ? Math.sin(now * 60 + x * 7 + y) * s * 0.05 * shakeRing : 0;
          const c = rockSprite(s, hash(x, y) % 97);
          ctx.globalAlpha = rise;
          ctx.drawImage(c, px + jx, py + s * (1 - rise) * 0.5, s, s);
          ctx.globalAlpha = 1;
        }
      }
    }

    // Square marks under the pieces.
    const sq = (x, y, color) => {
      const [px, py] = cam.toScreen(x, y);
      ctx.fillStyle = color;
      ctx.fillRect(px, py, s, s);
    };
    if (f.last) for (const [x, y] of f.last) sq(x, y, COLORS.last);
    if (f.selSquares) for (const [x, y] of f.selSquares) sq(x, y, COLORS.select);
    if (f.check) {
      const [x, y] = f.check;
      const [px, py] = cam.toScreen(x + 0.5, y + 0.5);
      const g = ctx.createRadialGradient(px, py, 0, px, py, s * 0.62);
      g.addColorStop(0, 'rgba(255,0,0,1)');
      g.addColorStop(0.25, 'rgba(231,0,0,1)');
      g.addColorStop(0.9, 'rgba(169,0,0,0)');
      g.addColorStop(1, 'rgba(158,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(px - s / 2, py - s / 2, s, s);
    }
    // Threatened white pieces: a red glow on their square, pulsing with Black's clock.
    if (f.threats && f.threats.length) {
      const pulse = f.tickIn !== undefined ? 0.45 + 0.4 * clamp01(1 - f.tickIn / 5) + 0.1 * Math.sin(now * 8) : 0.6;
      for (const [x, y, mine] of f.threats) {
        const [px, py] = cam.toScreen(x + 0.5, y + 0.5);
        const g = ctx.createRadialGradient(px, py, 0, px, py, s * 0.62);
        const a = (mine ? 0.85 : 0.45) * pulse;
        g.addColorStop(0, `rgba(240,40,30,${a})`);
        g.addColorStop(0.7, `rgba(200,20,20,${a * 0.5})`);
        g.addColorStop(1, 'rgba(160,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(px - s / 2, py - s / 2, s, s);
      }
    }
    // Telegraphed attacks.
    if (f.attacks && world.boss) {
      for (const atk of f.attacks) {
        const p = clamp01((f.t - atk.t0) / Math.max(0.1, atk.t1 - atk.t0));
        const squares = attackSquares(world, atk);
        const alpha = 0.16 + 0.32 * p + (p > 0.75 ? 0.15 * Math.sin(now * 30) : 0);
        const color = atk.k === 'decree' ? `rgba(150,70,255,${alpha})` : `rgba(230,40,30,${alpha})`;
        for (const pos of squares) {
          const x = pos % W;
          const y = Math.floor(pos / W);
          if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
          sq(x, y, color);
          // The fill shrinks toward impact: how long is left, at a glance.
          const [px, py] = cam.toScreen(x + 0.5, y + 0.5);
          const r = s * 0.42 * (1 - p);
          ctx.strokeStyle = atk.k === 'decree' ? 'rgba(220,190,255,0.8)' : 'rgba(255,220,200,0.75)';
          ctx.lineWidth = Math.max(1, s * 0.04);
          ctx.strokeRect(px - r, py - r, r * 2, r * 2);
        }
      }
    }
    // Landing marks for summoned pieces still in the air.
    if (!f.chessOnly) {
      for (const p of world.pieces.values()) {
        if (!(p.st & ST_AIR) || p.x < vx0 || p.x > vx1 || p.y < vy0 || p.y > vy1) continue;
        const left = Math.max(0, p.cd - f.t);
        const [px, py] = cam.toScreen(p.x + 0.5, p.y + 0.5);
        const black = p.s !== 'w';
        ctx.strokeStyle = black ? (p.st & 32 ? 'rgba(170,90,255,0.9)' : 'rgba(200,30,30,0.9)') : 'rgba(255,255,255,0.85)';
        ctx.lineWidth = Math.max(1.5, s * 0.06);
        ctx.beginPath();
        ctx.arc(px, py, s * 0.38, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp01(1 - left / 1.6));
        ctx.stroke();
        blit(ctx, p.k, black ? 'b' : 'w', px, py, s * 0.86, 0.28);
      }
    }
    // Inspecting an enemy: the squares it attacks.
    if (f.inspect) {
      ctx.strokeStyle = 'rgba(230,50,40,0.9)';
      ctx.lineWidth = Math.max(1.5, s * 0.06);
      for (const [x, y] of f.inspect) {
        const [px, py] = cam.toScreen(x, y);
        ctx.strokeRect(px + s * 0.08, py + s * 0.08, s * 0.84, s * 0.84);
      }
    }
    // March orders of selected pieces.
    if (f.orders && f.orders.length) {
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.setLineDash([s * 0.15, s * 0.15]);
      ctx.lineWidth = Math.max(1, s * 0.04);
      for (const [x0, y0, x1, y1] of f.orders) {
        const [ax, ay] = cam.toScreen(x0 + 0.5, y0 + 0.5);
        const [bxp, byp] = cam.toScreen(x1 + 0.5, y1 + 0.5);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bxp, byp);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    if (f.flag) {
      const [x, y, at] = f.flag;
      const k = clamp01((now - at) / 0.35);
      const [px, py] = cam.toScreen(x + 0.5, y + 0.5);
      ctx.strokeStyle = `rgba(255,255,255,${1 - k})`;
      ctx.lineWidth = Math.max(2, s * 0.08);
      ctx.beginPath();
      ctx.arc(px, py, s * (0.2 + k * 0.4), 0, Math.PI * 2);
      ctx.stroke();
    }

    // Pieces, back to front.
    const pieces = [];
    for (const p of world.pieces.values()) {
      if (p.st & ST_AIR) continue;
      if (p.x < vx0 - 1 || p.x > vx1 + 1 || p.y < vy0 - 1 || p.y > vy1 + 1) {
        tween.delete(p.id);
        continue;
      }
      pieces.push(p);
    }
    pieces.sort((a, c) => a.y - c.y);
    const small = s < 11;
    for (const p of pieces) {
      if (f.dragging && f.dragging.id === p.id) continue;
      const a = placeOf(p, now);
      // During the awakening, pieces outside the old board appear as the board reaches them.
      let pop = 1;
      if (cine >= 0) {
        if (p.x < b[0] || p.x > b[2] || p.y < b[1] || p.y > b[3]) continue;
        const inKeep = p.x >= KEEP_X && p.x <= KEEP_X + 7 && p.y >= KEEP_Y && p.y <= KEEP_Y + 7;
        if (!inKeep) pop = clamp01((cine - 3 - 3 * Math.max(Math.abs(p.x - KEEP_X - 3.5) / 20, Math.abs(p.y - KEEP_Y - 3.5) / 30)) / 0.3);
        if (pop <= 0) continue;
      }
      const born = clamp01((now - a.born) / 0.25);
      const [px, py] = cam.toScreen(a.x + 0.5, a.y + 0.5 - a.lift);
      if (small) {
        ctx.fillStyle = p.s === 'w' ? (p.o === f.mySlot || f.solo ? '#ffffff' : SLOT_COLORS[p.o] ?? '#ffffff') : p.s === 's' ? '#8f8a83' : '#1d1b1a';
        const r = Math.max(1.5, s * 0.36);
        ctx.fillRect(px - r, py - r, r * 2, r * 2);
        continue;
      }
      const color = p.st & ST_GHOST ? 'g' : p.s === 's' ? 's' : p.s;
      const size = s * 0.94 * (p.st & ST_ELITE ? 1.08 : 1) * (f.sel && f.sel.has(p.id) ? 1.06 : 1) * (0.6 + 0.4 * born) * pop;
      // Who owns it (with friends): a coloured disc under the piece.
      if (p.s === 'w' && !f.solo && p.o >= 0) {
        ctx.fillStyle = SLOT_COLORS[p.o] ?? '#fff';
        ctx.globalAlpha = p.o === f.mySlot ? 0.95 : 0.7;
        ctx.beginPath();
        ctx.ellipse(px, py + s * 0.33, s * 0.36, s * 0.11, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (p.st & ST_ELITE) {
        const g = ctx.createRadialGradient(px, py, s * 0.1, px, py, s * 0.6);
        g.addColorStop(0, 'rgba(255,200,60,0.35)');
        g.addColorStop(1, 'rgba(255,200,60,0)');
        ctx.fillStyle = g;
        ctx.fillRect(px - s * 0.6, py - s * 0.6, s * 1.2, s * 1.2);
      }
      const ghost = p.st & ST_GHOST ? 0.55 + 0.3 * Math.sin(now * 7) : 1;
      blit(ctx, p.k, color, px, py, size, ghost);
      if (p.st & ST_VET && p.s === 'w') {
        ctx.fillStyle = '#d6aa4a';
        ctx.beginPath();
        ctx.arc(px + s * 0.3, py - s * 0.32, Math.max(2, s * 0.07), 0, Math.PI * 2);
        ctx.fill();
      }
      // Armour: a pip for each hit it can still take.
      if (p.hp > 1) {
        for (let i = 0; i < p.hp; i++) {
          const [qx, qy] = [px - s * 0.38 + i * s * 0.16, py - s * 0.4];
          ctx.fillStyle = '#e8c35a';
          ctx.strokeStyle = '#3a2a10';
          ctx.lineWidth = Math.max(1, s * 0.025);
          ctx.beginPath();
          ctx.arc(qx, qy, Math.max(2, s * 0.06), 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
      // Recharging (yours): a thin bar along the square's foot filling back up.
      if (p.s === 'w' && (p.o === f.mySlot || f.solo) && f.t < p.cd && !f.chessOnly) {
        const rem = p.cd - f.t;
        const full = rem > CD[p.k] + 0.05 ? CD[p.k] * STRIKE_CD : CD[p.k];
        const k = clamp01(1 - rem / full);
        const [qx, qy] = cam.toScreen(a.x, a.y + 1);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(qx + s * 0.1, qy - s * 0.09, s * 0.8, Math.max(2, s * 0.055));
        ctx.fillStyle = '#81b64c';
        ctx.fillRect(qx + s * 0.1, qy - s * 0.09, s * 0.8 * k, Math.max(2, s * 0.055));
      }
    }
    if (pieces.length < world.pieces.size * 0.5 && Math.random() < 0.02) forget(world);

    // The dragon.
    if (world.boss && !f.chessOnly) {
      const boss = world.boss;
      if (cine >= 0) {
        // Assembling: every part flies in from the void, one after another.
        drawBoss(boss, now, f.t, {
          appear: (i) => clamp01((cine - 4.6 - i * 0.07) / 0.9),
          from: (i) => {
            const a = (hash('part', i) % 360) * (Math.PI / 180);
            return [BOSS_X + 0.5 + Math.cos(a) * 24, BOSS_Y + 0.5 + Math.sin(a) * 18];
          },
        });
      } else if (!boss.dead) drawBoss(boss, now, f.t);
      else if (f.t - boss.deadAt < 600) {
        // The king tipped over: resigned.
        const k = ease(clamp01((f.t - boss.deadAt) / 1.2));
        const [px, py] = cam.toScreen(boss.x + 0.5, boss.y + 0.5);
        ctx.save();
        ctx.translate(px, py + s * 0.3 * k);
        ctx.rotate(k * Math.PI * 0.5);
        blit(ctx, 'k', 'd', 0, 0, s * 1.3);
        ctx.restore();
      }
    }
    // The black army flying into the dragon (the awakening).
    if (cine >= 0 && aw.gh) {
      aw.gh.forEach(([type, x, y], i) => {
        const start = 1.2 + i * 0.09;
        const k = clamp01((cine - start) / 1.7);
        if (k >= 1) return;
        const tx = BOSS_X + 0.5 + ((i * 37) % 7) - 3;
        const ty = BOSS_Y + 0.5 + ((i * 53) % 5) - 2;
        const e = ease(k);
        const gx = lerp(x + 0.5, tx, e);
        const gy = lerp(y + 0.5, ty, e) - Math.sin(Math.PI * k) * 5;
        const [px, py] = cam.toScreen(gx, gy);
        const shiver = k === 0 && cine > 0.6 ? Math.sin(now * 70 + i) * s * 0.04 : 0;
        ctx.save();
        ctx.translate(px + shiver, py);
        ctx.rotate(k * (i % 2 ? 5 : -5));
        blit(ctx, type, 'b', 0, 0, s * (1 + Math.sin(Math.PI * k) * 0.3));
        if (type === 'k' && cine > 0.3 && k < 0.3) {
          ctx.fillStyle = '#ff2a1f';
          ctx.shadowColor = '#ff2a1f';
          ctx.shadowBlur = s * 0.4;
          ctx.beginPath();
          ctx.arc(-s * 0.02, -s * 0.06, Math.max(1.5, s * 0.05), 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
        ctx.restore();
      });
    }

    // The piece being dragged (the opening): under the pointer, a little larger.
    if (f.dragging) {
      blit(ctx, f.dragging.k, f.dragging.color, f.dragging.px, f.dragging.py, s * 1.08);
    }

    fx.draw(ctx, cam);

    // Edge arrows: the last enemies of a wave, and your king when it is in danger off screen.
    if (f.arrows) {
      for (const [x, y, color, label] of f.arrows) {
        const [px, py] = cam.toScreen(x + 0.5, y + 0.5);
        if (px > 0 && py > 0 && px < cssW && py < cssH) continue;
        const cx = cssW / 2;
        const cy = cssH / 2;
        const ang = Math.atan2(py - cy, px - cx);
        const m = 26;
        const tx = Math.max(m, Math.min(cssW - m, cx + Math.cos(ang) * cssW));
        const ty = Math.max(m, Math.min(cssH - m, cy + Math.sin(ang) * cssH));
        ctx.save();
        ctx.translate(tx, ty);
        ctx.rotate(ang);
        ctx.fillStyle = color;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(14, 0);
        ctx.lineTo(-8, -10);
        ctx.lineTo(-4, 0);
        ctx.lineTo(-8, 10);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        if (label) blit(ctx, label, 'w', tx - Math.cos(ang) * 26, ty - Math.sin(ang) * 26, 26);
      }
    }
    // Box selection.
    if (f.box) {
      const { x0, y0, x1, y1 } = f.box;
      ctx.fillStyle = 'rgba(129,182,76,0.15)';
      ctx.strokeStyle = 'rgba(129,182,76,0.9)';
      ctx.lineWidth = 1.5;
      ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    }
    // Legal moves of the selected piece (over pieces, as on the chess site).
    if (f.legal) {
      for (const m of f.legal) {
        const [px, py] = cam.toScreen(m.x + 0.5, m.y + 0.5);
        const bad = m.danger;
        if (m.o !== 0) {
          ctx.strokeStyle = bad ? 'rgba(200,30,30,0.45)' : COLORS.dot;
          ctx.lineWidth = s * 0.09;
          ctx.beginPath();
          ctx.arc(px, py, s * 0.44, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.fillStyle = bad ? 'rgba(200,30,30,0.42)' : COLORS.dot;
          ctx.beginPath();
          ctx.arc(px, py, s * 0.16, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    if (f.hover && !f.chessOnly && s > 14) {
      const [px, py] = cam.toScreen(f.hover[0], f.hover[1]);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = Math.max(1, s * 0.05);
      ctx.strokeRect(px + 1, py + 1, s - 2, s - 2);
    }
  }

  return {
    cam,
    resize,
    draw,
    size: () => [cssW, cssH],
    partHit(i, now) {
      const e = partFx.get(i) ?? {};
      e.hit = now;
      partFx.set(i, e);
    },
    partLunge(i, x, y, now) {
      const e = partFx.get(i) ?? {};
      e.lunge = [x, y, now];
      partFx.set(i, e);
    },
    partPose(boss, part, now, simT) {
      const place = bossPlace(boss, simT);
      return partPose(boss, part, now, place.x, place.y);
    },
    resetTweens() {
      tween.clear();
    },
  };
}

export { drawPiece };
