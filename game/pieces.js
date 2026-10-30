// The piece set, drawn in code: chunky flat pieces with a soft left-to-right shade and a dark outline, in a 100×100 box
// standing on y≈92. Sprites are cached per colour and pixel size.

const SHAPES = {
  p: [
    'M22 92 C22 84 26 80 33 80 L67 80 C74 80 78 84 78 92 Z',
    'M38 52 C38 63 33 72 28 80 L72 80 C67 72 62 63 62 52 Z',
    'M32 53 C32 47 38 45 50 45 C62 45 68 47 68 53 C68 56 63 58 50 58 C37 58 32 56 32 53 Z',
    'M35 31 A15 15 0 1 0 65 31 A15 15 0 1 0 35 31 Z',
  ],
  r: [
    'M17 92 C17 85 21 82 28 82 L72 82 C79 82 83 85 83 92 Z',
    'M24 82 L24 74 L76 74 L76 82 Z',
    'M31 74 L34 40 L66 40 L69 74 Z',
    'M26 41 L26 32 L74 32 L74 41 Z',
    'M26 32 L26 14 L37 14 L37 21 L45 21 L45 14 L55 14 L55 21 L63 21 L63 14 L74 14 L74 32 Z',
  ],
  b: [
    'M19 92 C19 85 23 82 30 82 L70 82 C77 82 81 85 81 92 Z',
    'M33 82 C35 75 38 70 40 65 L60 65 C62 70 65 75 67 82 Z',
    'M31 67 C31 62 37 60 50 60 C63 60 69 62 69 67 C69 70 63 72 50 72 C37 72 31 70 31 67 Z',
    'M50 14 C67 26 72 41 65 54 C63 59 57 62 50 62 C43 62 37 59 35 54 C28 41 33 26 50 14 Z',
    'M44 10 A6 6 0 1 0 56 10 A6 6 0 1 0 44 10 Z',
  ],
  n: [
    'M19 92 C19 85 23 82 30 82 L72 82 C79 82 83 85 83 92 Z',
    'M29 82 C30 71 37 63 45 57 C39 59 33 61 27 61 C20 61 15 56 15 50 C15 45 19 42 23 38 L39 24 C43 20 47 17 51 16 L55 7 L61 15 C73 18 82 33 82 51 C82 63 79 73 76 82 Z',
  ],
  q: [
    'M17 92 C17 85 21 82 28 82 L72 82 C79 82 83 85 83 92 Z',
    'M25 82 C26 77 29 75 33 75 L67 75 C71 75 74 77 75 82 Z',
    'M33 75 L20 33 L32 52 L35 26 L44 49 L50 22 L56 49 L65 26 L68 52 L80 33 L67 75 Z',
    'M16 31 A6 6 0 1 0 28 31 A6 6 0 1 0 16 31 Z',
    'M29 24 A6 6 0 1 0 41 24 A6 6 0 1 0 29 24 Z',
    'M44 19 A6 6 0 1 0 56 19 A6 6 0 1 0 44 19 Z',
    'M59 24 A6 6 0 1 0 71 24 A6 6 0 1 0 59 24 Z',
    'M72 31 A6 6 0 1 0 84 31 A6 6 0 1 0 72 31 Z',
  ],
  k: [
    'M17 92 C17 85 21 82 28 82 L72 82 C79 82 83 85 83 92 Z',
    'M25 82 C26 77 29 75 33 75 L67 75 C71 75 74 77 75 82 Z',
    'M31 75 C26 64 18 55 20 46 C22 37 33 33 40 40 C44 44 47 48 50 53 C53 48 56 44 60 40 C67 33 78 37 80 46 C82 55 74 64 69 75 Z',
    'M43 53 C43 41 46 35 50 32 C54 35 57 41 57 53 Z',
    'M46 6 L54 6 L54 13 L61 13 L61 20 L54 20 L54 31 L46 31 L46 20 L39 20 L39 13 L46 13 Z',
  ],
};

// Small marks drawn over the body (stroke only).
const DETAILS = {
  b: ['M57 29 L45 43'],
  n: ['M46 33 L47 33'],
  q: ['M30 67 C40 64 60 64 70 67'],
  k: ['M30 67 C40 64 60 64 70 67'],
  r: ['M33 56 L67 56'],
};

export const PALETTES = {
  w: { light: '#ffffff', dark: '#d2d0cc', line: '#4b4847', detail: '#4b4847' },
  b: { light: '#6b6866', dark: '#3f3d3b', line: '#232120', detail: '#8d8a87' },
  s: { light: '#aaa49b', dark: '#6f6a63', line: '#353230', detail: '#4d4945' },
  g: { light: '#6a4b95', dark: '#2f1e48', line: '#140b22', detail: '#c9a6ff' },
  d: { light: '#4f4c4a', dark: '#2a2827', line: '#120f0f', detail: '#ff3b30' }, // the dragon's pieces
};

const paths = {};
function pathsFor(type) {
  if (!paths[type]) {
    paths[type] = {
      shapes: SHAPES[type].map((d) => new Path2D(d)),
      details: (DETAILS[type] ?? []).map((d) => new Path2D(d)),
    };
  }
  return paths[type];
}

/** Draw a piece into ctx with its box at (x, y) and size s (pixels). */
export function drawPiece(ctx, type, color, x, y, s, { alpha = 1 } = {}) {
  const pal = PALETTES[color] ?? PALETTES.w;
  const { shapes, details } = pathsFor(type);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s / 100, s / 100);
  ctx.globalAlpha *= alpha;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const grad = ctx.createLinearGradient(18, 0, 84, 0);
  grad.addColorStop(0, pal.light);
  grad.addColorStop(0.55, pal.light);
  grad.addColorStop(1, pal.dark);
  // Outline first, thick, under everything; then each shape's fill and a thin inner line between overlapping parts.
  ctx.strokeStyle = pal.line;
  ctx.lineWidth = 9;
  for (const p of shapes) ctx.stroke(p);
  for (const p of shapes) {
    ctx.fillStyle = grad;
    ctx.fill(p);
    ctx.lineWidth = 3.4;
    ctx.stroke(p);
  }
  ctx.strokeStyle = pal.detail;
  ctx.lineWidth = type === 'n' ? 7 : 3.4;
  for (const p of details) ctx.stroke(p);
  if (color === 'd' || color === 'g') {
    // The dragon's pieces (and its Check ghosts) have a hot rim of light.
    ctx.globalCompositeOperation = 'source-atop';
    const rim = ctx.createLinearGradient(0, 100, 0, 30);
    rim.addColorStop(0, color === 'd' ? 'rgba(255,60,40,0.35)' : 'rgba(200,150,255,0.35)');
    rim.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rim;
    ctx.fillRect(0, 0, 100, 100);
  }
  ctx.restore();
}

const cache = new Map();

/** A cached canvas of a piece `size` pixels square (rounded to 2 px). */
export function sprite(type, color, size) {
  const s = Math.max(8, Math.min(256, Math.round(size / 2) * 2));
  const key = type + color + s;
  let c = cache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    const pad = Math.ceil(s * 0.06);
    c.width = s + pad * 2;
    c.height = s + pad * 2;
    c.pad = pad;
    drawPiece(c.getContext('2d'), type, color, pad, pad, s);
    cache.set(key, c);
    if (cache.size > 600) cache.delete(cache.keys().next().value);
  }
  return c;
}

/** Draw a cached sprite centred on (cx, cy) at `size` pixels. */
export function blit(ctx, type, color, cx, cy, size, alpha = 1) {
  const c = sprite(type, color, size);
  const scale = size / (c.width - c.pad * 2);
  const w = c.width * scale;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * alpha;
  ctx.drawImage(c, cx - w / 2, cy - w / 2, w, w);
  ctx.globalAlpha = prev;
}

/** A piece as an inline SVG string (for the DOM: captured pieces, the panel). */
export function pieceSvg(type, color, size = 22) {
  const pal = PALETTES[color] ?? PALETTES.w;
  const body = SHAPES[type].map((d) => `<path d="${d}"/>`).join('');
  const det = (DETAILS[type] ?? []).map((d) => `<path d="${d}" fill="none" stroke="${pal.detail}" stroke-width="${type === 'n' ? 7 : 3.4}"/>`).join('');
  const id = `g${type}${color}`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="${id}" x1="18" x2="84" y1="0" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${pal.light}"/><stop offset=".55" stop-color="${pal.light}"/><stop offset="1" stop-color="${pal.dark}"/></linearGradient></defs><g stroke="${pal.line}" stroke-width="9" stroke-linejoin="round" fill="none">${body}</g><g fill="url(#${id})" stroke="${pal.line}" stroke-width="3.4" stroke-linejoin="round">${body}</g>${det}</svg>`;
}
