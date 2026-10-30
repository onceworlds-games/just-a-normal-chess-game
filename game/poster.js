// Store pictures (?poster=cover|action|win|icon|badge-<id>): one staged frame from a real run of the simulation, drawn
// by the game's own renderer. No room, no SDK.

import { createRenderer } from './render.js';
import { createFx } from './fx.js';
import { Sim } from './sim.js';
import { createAutopilot } from './autopilot.js';
import { drawPiece } from './pieces.js';
import { attackedBy, active } from './rules.js';

function play(sim, until, max = 200000) {
  const pilot = createAutopilot(sim, 0, { skill: 0.9, seed: 3 });
  let n = 0;
  while (!until() && n++ < max) {
    pilot();
    sim.step(0.05);
  }
}

export async function runPoster(name) {
  document.body.innerHTML = '';
  document.body.style.cssText = 'margin:0;overflow:hidden;background:#1c1b19';
  const W = window.innerWidth;
  const H = window.innerHeight;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0';
  document.body.append(canvas);
  try {
    await document.fonts.load('900 80px Figtree');
    await document.fonts.load('700 30px Figtree');
  } catch {}
  await document.fonts.ready;

  if (name === 'icon' || name.startsWith('badge-')) {
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (name === 'icon') drawIcon(ctx, W, H);
    else drawBadge(ctx, W, H, name.slice(6));
    document.body.dataset.ready = '1';
    return;
  }

  const fx = createFx();
  const r = createRenderer(canvas, fx);
  r.resize(W, H, 1);
  const cam = r.cam;
  const sim = new Sim({ seed: 20261030, diff: 'normal', slots: [0] });
  const frame = { mySlot: 0, solo: true, sel: new Set() };
  let title = false;
  let split = false;

  if (name === 'cover') {
    play(sim, () => sim.wave.st === 'boss' && sim.t > sim.wave.t0 + 30);
    const b = sim.world.boss;
    if (!b.atk.some((a) => a.k === 'rain')) sim.planAttack('rain');
    const atk = b.atk.find((a) => a.k === 'rain');
    if (atk) sim.t = atk.t0 + (atk.t1 - atk.t0) * 0.7;
    cam.tcx = b.x + 0.5;
    cam.tcy = b.y - 1.6;
    cam.tscale = H / 14.5;
    title = true;
  } else if (name === 'action') {
    // Scan a run for the thickest fight (a 16×9 window with the most black and white pieces), then replay the same run
    // (it is deterministic) to that moment.
    const scan = new Sim({ seed: 20261030, diff: 'normal', slots: [0] });
    const best = { score: -1, t: 0, x: 50, y: 60 };
    const pilotScan = createAutopilot(scan, 0, { skill: 0.9, seed: 3 });
    let next = 0;
    while (scan.t < 60 * 40 && !(scan.wave.st === 'bossintro')) {
      pilotScan();
      scan.step(0.05);
      if (scan.phase !== 'rts' || scan.wave.st !== 'fight' || scan.t < next) continue;
      next = scan.t + 1;
      const all = [...scan.world.pieces.values()].filter((p) => !(p.st & 1));
      const bd = scan.world.bounds;
      for (const p of all) {
        if (p.s === 'w') continue;
        if (p.x - bd[0] < 9 || bd[2] - p.x < 9 || p.y - bd[1] < 6 || bd[3] - p.y < 6) continue;
        let nb = 0;
        let nw = 0;
        for (const q of all) if (Math.abs(q.x - p.x) <= 7 && Math.abs(q.y - p.y) <= 4) q.s === 'w' ? nw++ : nb++;
        const score = Math.min(nb, nw) * 2 + nb;
        if (score > best.score) Object.assign(best, { score, t: scan.t, x: p.x, y: p.y });
      }
    }
    play(sim, () => sim.t >= best.t);
    cam.tcx = best.x + 0.5;
    cam.tcy = best.y + 0.5;
    cam.tscale = H / 9.5;
  } else if (name === 'win') {
    // The twist: an ordinary chess game torn open onto the dragon.
    play(sim, () => sim.wave.st === 'boss' && sim.t > sim.wave.t0 + 6);
    const b = sim.world.boss;
    cam.tcx = b.x - 4.5;
    cam.tcy = b.y + 0.4;
    cam.tscale = H / 14;
    split = true;
  }
  cam.snap();
  const t = sim.t;
  const w = sim.world;
  // Arcs for pieces in the air, as the game draws them.
  for (const p of w.pieces.values()) {
    if (!(p.st & 1)) continue;
    const left = Math.max(0.2, p.cd - t);
    if (p.s === 'w') fx.arc(p.x + 0.5, p.y - 7, p.x + 0.5, p.y + 0.5, p.k, 'w', left + 0.6, 1, 1);
    else if (w.boss) fx.arc(w.boss.x + 0.5, w.boss.y - 1, p.x + 0.5, p.y + 0.5, p.k, 'b', left + 1.2, 5, 1);
  }
  fx.update(0.75);
  const threats = [];
  for (const p of w.pieces.values()) if (p.s === 'w' && active(p) && attackedBy(w, p.x, p.y, 1)) threats.push([p.x, p.y, true]);
  if (name === 'action') {
    // A capture or two in mid-burst.
    const blacks = [...w.pieces.values()].filter((p) => p.s !== 'w' && active(p) && Math.abs(p.x - cam.cx) < 8 && Math.abs(p.y - cam.cy) < 5);
    for (const p of blacks.slice(0, 2)) {
      fx.shards(p.x + 0.5, p.y + 0.5, '#3b3937', 14, 1.2);
      fx.ring(p.x + 0.5, p.y + 0.5, 'rgba(255,255,255,0.7)', 1, 0.5, 0.1);
    }
    fx.update(0.12);
  }
  const f = {
    ...frame,
    now: 12.3,
    t,
    world: w,
    awake: sim.awake,
    growNext: sim.grow.next,
    growSide: sim.grow.side,
    tickIn: 1.2,
    attacks: w.boss?.atk ?? [],
    threats,
  };
  for (let i = 0; i < 4; i++) r.draw({ ...f, now: 12.0 + i * 0.1 });
  const ctx = canvas.getContext('2d');
  if (title) drawTitle(ctx, W, H);
  if (split) drawChessHalf(ctx, W, H);
  document.body.dataset.ready = '1';
}

/** A normal game of chess on the left, with a torn edge where the battlefield shows through. */
function drawChessHalf(ctx, W, H) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const fx = createFx();
  const r = createRenderer(c, fx);
  r.resize(W, H, 1);
  const rows = ['r.bqkbnr', 'pppp.ppp', '..n.....', '....p...', '..B.P...', '.....N..', 'PPPP.PPP', 'RNBQK..R'];
  const pieces = new Map();
  let id = 1;
  rows.forEach((row, ry) => {
    [...row].forEach((ch, fx2) => {
      if (ch === '.') return;
      const s = ch === ch.toUpperCase() ? 'w' : 'b';
      pieces.set(id, { id, s, k: ch.toLowerCase(), x: 46 + fx2, y: 58 + ry, o: 0, cd: 0, hp: 1, mh: 1, f: 0, st: 0 });
      id++;
    });
  });
  const board = H * 0.98 / 8;
  r.cam.tcx = 50 - (W * 0.3 - W / 2) / board;
  r.cam.tcy = 62;
  r.cam.tscale = board;
  r.cam.snap();
  r.draw({ now: 1, t: 0, chessOnly: true, world: { pieces, bounds: [46, 58, 53, 65], terr: null, boss: null }, last: [[50, 59], [50, 61]], mySlot: 0, solo: true, sel: new Set() });
  // The tear: a jagged diagonal from top to bottom.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const y = (i / steps) * H;
    const x = W * 0.6 - (i / steps) * W * 0.12 + (i % 2 ? 18 : -18) + Math.sin(i * 2.3) * 10;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.save();
  ctx.shadowColor = 'rgba(255,40,20,0.9)';
  ctx.shadowBlur = 30;
  ctx.fillStyle = '#302e2b';
  ctx.fill();
  ctx.restore();
  ctx.clip();
  ctx.drawImage(c, 0, 0);
  ctx.restore();
  // The torn edge glows.
  ctx.strokeStyle = 'rgba(255,90,50,0.9)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const y = (i / steps) * H;
    const x = W * 0.6 - (i / steps) * W * 0.12 + (i % 2 ? 18 : -18) + Math.sin(i * 2.3) * 10;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.stroke();
}

function drawTitle(ctx, W, H) {
  const band = ctx.createLinearGradient(0, 0, 0, H * 0.4);
  band.addColorStop(0, 'rgba(20,18,16,0.92)');
  band.addColorStop(0.7, 'rgba(20,18,16,0.55)');
  band.addColorStop(1, 'rgba(20,18,16,0)');
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, W, H * 0.4);
  const size = Math.round(W * 0.066);
  ctx.font = `900 ${size}px Figtree, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.16;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText('Just a Normal Chess Game', W / 2, H * 0.13);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('Just a Normal Chess Game', W / 2, H * 0.13);
}

function disc(ctx, W, H, inner, outer) {
  const g = ctx.createRadialGradient(W / 2, H * 0.45, W * 0.05, W / 2, H / 2, W * 0.62);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function eye(ctx, x, y, r) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 5);
  g.addColorStop(0, 'rgba(255,50,40,0.95)');
  g.addColorStop(0.3, 'rgba(255,40,30,0.45)');
  g.addColorStop(1, 'rgba(255,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r * 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ff2a1f';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawIcon(ctx, W, H) {
  disc(ctx, W, H, '#7d1d16', '#1a0806');
  // The crowned knight head, eye lit.
  const s = W * 0.7;
  const x = (W - s) / 2;
  const y = H * 0.22;
  drawPiece(ctx, 'n', 'd', x, y, s);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, H * 0.3);
  ctx.clip();
  drawPiece(ctx, 'k', 'd', W * 0.35, H * 0.11, W * 0.34);
  ctx.restore();
  eye(ctx, x + s * 0.46, y + s * 0.33, W * 0.014);
}

function drawBadge(ctx, W, H, id) {
  const label = (text) => {
    ctx.font = `900 ${Math.round(W * 0.26)}px Figtree, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = W * 0.05;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText(text, W * 0.74, H * 0.76);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, W * 0.74, H * 0.76);
  };
  const looks = {
    awakening: ['#7d1d16', '#260a07', () => {
      drawPiece(ctx, 'n', 'd', W * 0.14, H * 0.12, W * 0.72);
      eye(ctx, W * 0.14 + W * 0.72 * 0.46, H * 0.12 + W * 0.72 * 0.33, W * 0.02);
    }],
    'wave-5': ['#3d6b28', '#13240c', () => {
      drawPiece(ctx, 'r', 'w', W * 0.16, H * 0.14, W * 0.6);
      label('5');
    }],
    'wave-10': ['#81b64c', '#1d3310', () => {
      drawPiece(ctx, 'q', 'w', W * 0.12, H * 0.12, W * 0.64);
      label('10');
    }],
    checkmate: ['#d6aa4a', '#3a2a0a', () => {
      ctx.save();
      ctx.translate(W * 0.52, H * 0.56);
      ctx.rotate(Math.PI * 0.42);
      drawPiece(ctx, 'k', 'd', -W * 0.34, -H * 0.42, W * 0.68);
      ctx.restore();
    }],
    promotion: ['#4aa3ea', '#0d2236', () => {
      drawPiece(ctx, 'p', 'w', W * 0.06, H * 0.3, W * 0.5);
      drawPiece(ctx, 'q', 'w', W * 0.4, H * 0.12, W * 0.56);
    }],
    grandmaster: ['#b884f0', '#24113d', () => drawPiece(ctx, 'k', 'w', W * 0.16, H * 0.12, W * 0.68)],
    'royal-escort': ['#ef6b8f', '#3a0f1c', () => {
      drawPiece(ctx, 'r', 'w', W * 0.02, H * 0.3, W * 0.46);
      drawPiece(ctx, 'r', 'w', W * 0.52, H * 0.3, W * 0.46);
      drawPiece(ctx, 'k', 'w', W * 0.22, H * 0.1, W * 0.56);
    }],
  };
  const look = looks[id] ?? ['#444', '#111', () => drawPiece(ctx, 'p', 'w', W * 0.2, H * 0.15, W * 0.6)];
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, W * 0.48, 0, Math.PI * 2);
  ctx.clip();
  disc(ctx, W, H, look[0], look[1]);
  look[2]();
  ctx.restore();
}
