// Seeded randomness. The simulation never keeps a running generator: every decision draws from a fresh one made from
// (seed, tag, step), so a new host carries on with exactly the same luck.

export function hash(...parts) {
  let h = 2166136261 >>> 0;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= 0x9e3779b9;
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
  }
  return h >>> 0;
}

export function mulberry(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngFor(...parts) {
  const r = mulberry(hash(...parts));
  r.int = (n) => Math.floor(r() * n);
  r.range = (a, b) => a + r() * (b - a);
  r.pick = (list) => list[Math.floor(r() * list.length)];
  r.shuffle = (list) => {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = list[i];
      list[i] = list[j];
      list[j] = t;
    }
    return list;
  };
  return r;
}
