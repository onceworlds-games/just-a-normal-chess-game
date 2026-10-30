// Effects in board coordinates (1 = one square): shards, rings, sparks, numbers, flying pieces, shockwaves. Drawn with
// the camera, so they move and zoom with the board. Camera shake is a decaying trauma value.

import { blit } from './pieces.js';

export function createFx() {
  const list = [];
  let trauma = 0;
  let reduced = false;
  let quality = 'high';
  const cap = () => (quality === 'low' ? 350 : quality === 'medium' ? 700 : 1200);

  const push = (p) => {
    if (list.length >= cap()) list.shift();
    list.push(p);
    return p;
  };

  const fx = {
    setOptions(o) {
      reduced = !!o.reducedMotion;
      quality = o.quality ?? quality;
    },
    shake(amount) {
      if (reduced) return;
      trauma = Math.min(1, trauma + amount);
    },
    shakeOffset(t) {
      const s = trauma * trauma;
      return { x: Math.sin(t * 47.3) * 14 * s + Math.sin(t * 13.1) * 6 * s, y: Math.cos(t * 41.7) * 12 * s + Math.sin(t * 17.9) * 5 * s };
    },
    shards(x, y, color, n = 10, power = 1) {
      const count = quality === 'low' ? Math.ceil(n / 2) : n;
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = (1.2 + Math.random() * 3) * power;
        push({ k: 'shard', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7, z: 0.2, vz: 2 + Math.random() * 4 * power, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 18, size: 0.08 + Math.random() * 0.12, color, life: 0, max: 0.7 + Math.random() * 0.5 });
      }
    },
    dust(x, y, color = 'rgba(80,70,60,0.5)', n = 6) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
        push({ k: 'puff', x, y, vx: Math.cos(a) * 1.2, vy: Math.sin(a) * 1.2, r: 0.12, color, life: 0, max: 0.45 });
      }
    },
    ring(x, y, color, r1 = 1.2, max = 0.45, width = 0.12) {
      push({ k: 'ring', x, y, r0: 0.2, r1, color, width, life: 0, max });
    },
    sparks(x, y, color = '#ffd36b', n = 8) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = 3 + Math.random() * 5;
        push({ k: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, color, life: 0, max: 0.25 + Math.random() * 0.25 });
      }
    },
    text(x, y, text, color = '#fff', size = 0.5, max = 0.9) {
      push({ k: 'text', x, y, text, color, size, life: 0, max });
    },
    flash(x, y, color = 'rgba(255,255,255,0.8)', max = 0.25) {
      push({ k: 'flash', x, y, color, life: 0, max });
    },
    /** A piece flung off (a broken dragon part, a captured piece): spins up and falls, then shatters. */
    debris(x, y, type, color, power = 1, size = 1) {
      const a = Math.random() * Math.PI * 2;
      const v = (1 + Math.random() * 2) * power;
      push({ k: 'debris', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6, z: 0.3, vz: 4 + Math.random() * 3 * power, rot: 0, vr: (Math.random() - 0.5) * 10, type, color, size, life: 0, max: 1.6 });
    },
    /** A piece flying along an arc from (x0, y0) to (x1, y1), landing at time `at` (seconds of max). */
    arc(x0, y0, x1, y1, type, color, max = 1.5, height = 4, size = 1) {
      push({ k: 'arc', x0, y0, x1, y1, type, color, height, size, life: 0, max });
    },
    /** A shockwave travelling along a line. */
    sweep(x0, y0, x1, y1, color = 'rgba(255,80,60,0.9)', max = 0.55) {
      push({ k: 'sweep', x0, y0, x1, y1, color, life: 0, max });
    },
    beam(x0, y0, x1, y1, color = 'rgba(255,90,70,0.95)', max = 0.4, width = 0.3) {
      push({ k: 'beam', x0, y0, x1, y1, color, width, life: 0, max });
    },
    clear() {
      list.length = 0;
    },
    count() {
      return list.length;
    },

    update(dt) {
      trauma = Math.max(0, trauma - dt * 1.6);
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        p.life += dt;
        if (p.life >= p.max) {
          if (p.k === 'debris') fx.shards(p.x, p.y, p.color === 'd' ? '#3a3837' : p.color === 's' ? '#8f8a83' : '#f2f2f2', 8, 0.8);
          list.splice(i, 1);
          continue;
        }
        if (p.k === 'shard' || p.k === 'debris') {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vz -= 14 * dt;
          p.z += p.vz * dt;
          if (p.z < 0) {
            p.z = 0;
            p.vz *= -0.35;
            p.vx *= 0.6;
            p.vy *= 0.6;
            if (p.k === 'debris' && p.life > 0.5) p.life = p.max - 0.001;
          }
          p.rot += p.vr * dt;
        } else if (p.k === 'puff' || p.k === 'spark') {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vx *= 1 - 3 * dt;
          p.vy *= 1 - 3 * dt;
        } else if (p.k === 'text') {
          p.y -= dt * 0.9;
        }
      }
    },

    draw(ctx, cam) {
      const s = cam.scale;
      for (const p of list) {
        const t = p.life / p.max;
        if (p.k === 'shard') {
          const [sx, sy] = cam.toScreen(p.x, p.y - p.z * 0.35);
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate(p.rot);
          ctx.globalAlpha = 1 - t * t;
          ctx.fillStyle = p.color;
          const z = p.size * s;
          ctx.beginPath();
          ctx.moveTo(-z, -z * 0.6);
          ctx.lineTo(z * 0.8, -z * 0.3);
          ctx.lineTo(z * 0.2, z * 0.8);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        } else if (p.k === 'puff') {
          const [sx, sy] = cam.toScreen(p.x, p.y);
          ctx.globalAlpha = 1 - t;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(sx, sy, (p.r + t * 0.25) * s, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        } else if (p.k === 'ring') {
          const [sx, sy] = cam.toScreen(p.x, p.y);
          const e = 1 - (1 - t) * (1 - t);
          ctx.globalAlpha = 1 - t;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = Math.max(1, p.width * s * (1 - t * 0.6));
          ctx.beginPath();
          ctx.arc(sx, sy, (p.r0 + (p.r1 - p.r0) * e) * s, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        } else if (p.k === 'spark') {
          const [sx, sy] = cam.toScreen(p.x, p.y);
          ctx.globalAlpha = 1 - t;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = Math.max(1, 0.05 * s);
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx - p.vx * 0.04 * s, sy - p.vy * 0.04 * s);
          ctx.stroke();
          ctx.globalAlpha = 1;
        } else if (p.k === 'text') {
          const [sx, sy] = cam.toScreen(p.x, p.y);
          const px = Math.max(12, p.size * s);
          const pop = t < 0.15 ? 0.7 + (t / 0.15) * 0.45 : 1.15 - Math.min(0.15, (t - 0.15) * 0.5);
          ctx.globalAlpha = t > 0.7 ? (1 - t) / 0.3 : 1;
          ctx.font = `800 ${Math.round(px * pop)}px Figtree, system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineWidth = Math.max(2, px * 0.16);
          ctx.strokeStyle = 'rgba(0,0,0,0.75)';
          ctx.strokeText(p.text, sx, sy);
          ctx.fillStyle = p.color;
          ctx.fillText(p.text, sx, sy);
          ctx.globalAlpha = 1;
        } else if (p.k === 'flash') {
          const [sx, sy] = cam.toScreen(p.x - 0.5, p.y - 0.5);
          ctx.globalAlpha = (1 - t) * 0.9;
          ctx.fillStyle = p.color;
          ctx.fillRect(sx, sy, s, s);
          ctx.globalAlpha = 1;
        } else if (p.k === 'debris') {
          const [sx, sy] = cam.toScreen(p.x, p.y);
          ctx.save();
          ctx.globalAlpha = 0.25 * (1 - t);
          ctx.fillStyle = '#000';
          ctx.beginPath();
          ctx.ellipse(sx, sy + 0.3 * s, 0.35 * s, 0.12 * s, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.translate(sx, sy - p.z * 0.4 * s);
          ctx.rotate(p.rot);
          blit(ctx, p.type, p.color, 0, 0, s * p.size);
          ctx.restore();
        } else if (p.k === 'arc') {
          const e = t < 1 ? t : 1;
          const x = p.x0 + (p.x1 - p.x0) * e;
          const y = p.y0 + (p.y1 - p.y0) * e;
          const h = Math.sin(Math.PI * e) * p.height;
          const [gx, gy] = cam.toScreen(x, y);
          ctx.globalAlpha = 0.25 * e;
          ctx.fillStyle = '#000';
          ctx.beginPath();
          ctx.ellipse(gx, gy + 0.3 * s, 0.3 * s * (0.5 + e * 0.5), 0.1 * s, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.save();
          ctx.translate(gx, gy - h * s);
          ctx.rotate((1 - e) * 6);
          blit(ctx, p.type, p.color, 0, 0, s * p.size * (1 + Math.sin(Math.PI * e) * 0.35));
          ctx.restore();
        } else if (p.k === 'sweep') {
          const e = Math.min(1, t * 1.3);
          const [ax, ay] = cam.toScreen(p.x0, p.y0);
          const [bx, by] = cam.toScreen(p.x1, p.y1);
          const hx = ax + (bx - ax) * e;
          const hy = ay + (by - ay) * e;
          const tail = Math.max(0, e - 0.35);
          const tx = ax + (bx - ax) * tail;
          const ty = ay + (by - ay) * tail;
          const g = ctx.createLinearGradient(tx, ty, hx, hy);
          g.addColorStop(0, 'rgba(255,80,60,0)');
          g.addColorStop(1, p.color);
          ctx.strokeStyle = g;
          ctx.lineWidth = s * 0.8;
          ctx.lineCap = 'round';
          ctx.globalAlpha = 1 - t * 0.6;
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(hx, hy);
          ctx.stroke();
          ctx.globalAlpha = 1;
        } else if (p.k === 'beam') {
          const [ax, ay] = cam.toScreen(p.x0, p.y0);
          const [bx, by] = cam.toScreen(p.x1, p.y1);
          ctx.globalAlpha = 1 - t;
          ctx.strokeStyle = p.color;
          ctx.lineCap = 'round';
          ctx.lineWidth = s * p.width * (1 - t * 0.5);
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(255,240,220,0.9)';
          ctx.lineWidth = s * p.width * 0.3;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    },
  };
  return fx;
}
