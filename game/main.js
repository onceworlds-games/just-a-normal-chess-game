// Boot, layout, input, camera and everything that turns the host's snapshots into sound and motion.

import * as C from './config.js';
import { legalMoves, inCheck, kingSquare, colorOf, typeOf, parseBoard, findMove, initialPosition } from './chess.js';
import { movesOf, attacksOf, attackedBy, active, idx } from './rules.js';
import { attackSquares, footprint, GROUP_LABEL, integrity, kingExposed, groupAlive } from './boss.js';
import { WAVES, WAVE_COUNT } from './waves.js';
import { createRenderer } from './render.js';
import { createFx } from './fx.js';
import { createNet, stubRoom } from './net.js';
import { startAudio, sfx, setMusic, duck } from './audio.js';
import { createUI, h, fmtClock, lobbyPanel, seatRow, emptySeat, chessPanel, fillMoves, noirLine, warPanel, teamRow, selectionIcons, avatarImg } from './ui.js';
import { pieceSvg } from './pieces.js';
import { chessToWorld } from './sim.js';

const ow = window.onceworlds;
const params = new URLSearchParams(location.search);

// ?debug (only on a page outside Onceworlds): errors printed on screen, for browsers whose console can't be seen.
if (!ow && params.has('debug')) {
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;left:0;right:0;bottom:0;max-height:40%;overflow:auto;margin:0;padding:6px;font:11px monospace;background:rgba(120,0,0,.85);color:#fff;z-index:99;white-space:pre-wrap';
  const say = (t) => {
    if (!pre.isConnected) document.body.append(pre);
    pre.textContent += `${t}\n`;
  };
  window.addEventListener('error', (e) => say(`error: ${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => say(`rejection: ${e.reason && (e.reason.stack || e.reason)}`));
  const orig = console.error;
  console.error = (...a) => {
    say(`console.error: ${a.map((x) => (x && x.stack) || x).join(' ')}`);
    orig.apply(console, a);
  };
}

if (params.has('poster')) import('./poster.js').then((m) => m.runPoster(params.get('poster')));
else boot().catch((err) => {
  console.error(err);
});

async function joinRoom() {
  if (!ow?.rooms) return stubRoom();
  try {
    return await ow.rooms.join({ private: true, maxPlayers: 4, minPlayers: 1, lobby: 'game' });
  } catch (err) {
    console.warn('[chess] join failed, playing alone', err);
    return stubRoom();
  }
}

async function boot() {
  const roomPromise = joinRoom(); // join first, before anything heavy
  try {
    ow?.ui?.setLook?.({ accent: '#81b64c', panel: '#262522', text: '#ffffff' });
    ow?.controls?.set?.(null);
  } catch {}
  const canvas = document.getElementById('cv');
  const fx = createFx();
  const renderer = createRenderer(canvas, fx);
  const cam = renderer.cam;
  const ui = createUI();
  const settings = () => ({ quality: ow?.settings?.quality ?? 'high', reducedMotion: !!ow?.settings?.reducedMotion });
  fx.setOptions(settings());
  ow?.settings?.on?.('change', () => fx.setOptions(settings()));

  const state = {
    room: null,
    net: null,
    phase: 'lobby',
    sel: new Set(),
    chessSel: -1,
    legalCache: null,
    orders: new Map(), // my march orders: id → [x, y]
    inspect: null,
    flag: null,
    hover: null,
    box: null,
    drag: null,
    lastSeq: -1,
    evInit: false,
    chessIds: null,
    chessBoardKey: '',
    awakeT0: null,
    cineMarks: new Set(),
    kingThreat: false,
    save: null,
    saveLoaded: false,
    tips: {},
    lastClick: { id: 0, at: 0 },
    arcSeen: new Set(),
    camInit: false,
    keys: new Set(),
    resignArmed: 0,
    myPrevPieces: 0,
    lastTickN: 0,
    clockSec: -1,
  };
  window.__chess = state; // for debugging in the console
  state.cam = cam;
  state.renderer = renderer;

  // ---------------------------------------------------------------- saves

  async function loadSave() {
    if (state.saveLoaded) return state.save;
    state.saveLoaded = true;
    try {
      const run = await ow?.save?.get?.('run');
      state.save = run && run.v === 1 && run.ck ? run : null;
      const tips = await ow?.save?.get?.('tips');
      if (tips && typeof tips === 'object') state.tips = tips;
    } catch {}
    return state.save;
  }
  function saveRun(run) {
    state.save = run;
    try {
      ow?.save?.set?.('run', run);
    } catch {}
  }
  function tip(key, text) {
    if (state.tips[key]) return;
    state.tips[key] = 1;
    try {
      ow?.save?.set?.('tips', state.tips);
    } catch {}
    const el = h('div', { class: 'tip' }, text);
    ui.hudNode.querySelectorAll('.tip').forEach((t) => t.remove());
    ui.hudNode.append(el);
    setTimeout(() => el.classList.add('out'), 5200);
    setTimeout(() => el.remove(), 5800);
  }
  const award = (id) => {
    try {
      ow?.badges?.award?.(id);
    } catch {}
  };

  // ---------------------------------------------------------------- the room

  function attach(room) {
    state.room = room;
    state.evInit = false;
    state.lastSeq = -1;
    state.net = createNet(ow, room, {
      loadRun: loadSave,
      saveRun,
      onMatch: () => refreshPanel(true),
      onRoster: () => refreshPanel(true),
      onState: () => {},
      onSimStart: () => {},
    });
    room.on('close', (reason) => {
      const msg = { kicked: 'You were removed', replaced: 'Playing in another tab', disconnected: 'Disconnected' }[reason] ?? 'Disconnected';
      ui.modal(`close-${reason}`, () =>
        h('div', { class: 'card result' }, h('div', { class: 'r-head lost' }, h('div', { class: 'r-title' }, msg)), h('div', { class: 'r-foot' }, h('button', { class: 'btn green big', onclick: rejoin }, reason === 'replaced' ? 'Play here' : 'Rejoin'))),
      );
    });
    room.on('chat', () => {});
    loadSave().then(() => refreshPanel(true));
    refreshPanel(true);
  }
  async function rejoin() {
    ui.modal(null);
    attach(await joinRoom());
  }

  ow?.on?.('pause', () => {
    duck(true);
    if (soloHost()) state.net.send({ t: 'pause', on: true });
  });
  ow?.on?.('resume', () => {
    duck(false);
    if (soloHost()) state.net.send({ t: 'pause', on: false });
  });
  document.addEventListener('visibilitychange', () => {
    if (!state.net) return;
    if (soloHost()) state.net.send({ t: 'pause', on: document.hidden });
  });
  const soloHost = () => state.net?.sim && state.room?.isHost && state.net.sim.players() === 1;

  // ---------------------------------------------------------------- layout

  const app = document.getElementById('app');
  const box = document.getElementById('boardBox');
  function layout() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const wide = W >= 820 && W / H > 1.15;
    app.dataset.wide = wide ? '1' : '0';
    const barH = W < 500 ? 46 : 52;
    const war = state.phase === 'rts';
    let size;
    if (wide) size = Math.min(W - (H < 520 ? 270 : 360) - 56, H - barH * 2 - (H < 520 ? 16 : 40));
    else size = Math.min(W - 12, H - barH * 2 - (war ? 120 : 200));
    app.style.setProperty('--board', `${Math.max(200, Math.floor(size))}px`);
    app.style.setProperty('--bar', `${barH}px`);
    // The platform's menu sits in the top-left corner: keep the top bar's name clear of it.
    const menu = (ow?.ui?.reserved ?? []).find?.((r) => r.kind === 'menu');
    const top = document.getElementById('barTop').getBoundingClientRect();
    let pad = 0;
    if (menu) {
      if (menu.y < top.bottom && menu.y + menu.h > top.top && menu.x < top.left + 160) pad = Math.max(0, menu.x + menu.w - top.left + 8);
    } else if (ow && top.top < 70 && top.left < 150) pad = 150 - top.left;
    document.getElementById('barTop').style.paddingLeft = `${pad ? pad : ''}${pad ? 'px' : ''}`;
    placeMinimap(wide);
    const r = box.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) renderer.resize(r.width, r.height, Math.min(ow?.settings?.pixelRatio?.(2) ?? window.devicePixelRatio ?? 1, 2.5));
  }
  function placeMinimap(wide) {
    const r = ui.refs();
    if (state.phase !== 'rts') return;
    const docked = wide && window.innerHeight >= 520;
    const target = docked ? r.mapSlot : ui.hudNode;
    if (target && ui.minimap.parentElement !== target) target.append(ui.minimap);
    ui.minimap.classList.toggle('floating', !docked);
  }
  window.addEventListener('resize', layout);
  ow?.on?.('reserved', layout);
  const ro = new ResizeObserver(() => {
    const r = box.getBoundingClientRect();
    renderer.resize(r.width, r.height, Math.min(ow?.settings?.pixelRatio?.(2) ?? window.devicePixelRatio ?? 1, 2.5));
    if (state.phase === 'lobby' || state.phase === 'chess') frameChess(true);
  });
  ro.observe(box);

  function frameChess(snap) {
    const [w, hgt] = renderer.size();
    cam.tcx = C.KEEP_X + 4;
    cam.tcy = C.KEEP_Y + 4;
    cam.tscale = Math.min(w, hgt) / 8;
    if (snap) cam.snap();
  }
  function frameWar(snap) {
    const [w, hgt] = renderer.size();
    const king = state.net?.world?.pieces.get(state.net.g?.kid);
    cam.tcx = king ? king.x + 0.5 : C.KEEP_X + 4;
    cam.tcy = king ? king.y - 4 : C.KEEP_Y;
    const roomy = app.dataset.wide === '1' && window.innerHeight >= 520;
    cam.tscale = Math.max(roomy ? 18 : 24, Math.min(64, Math.min(w, hgt) / (roomy ? 20 : 11)));
    if (snap) cam.snap();
  }
  const clampCam = () => {
    cam.tcx = Math.max(-4, Math.min(C.W + 4, cam.tcx));
    cam.tcy = Math.max(-4, Math.min(C.H + 4, cam.tcy));
    const [w, hgt] = renderer.size();
    const min = Math.max(4, Math.min(w, hgt) / 104);
    cam.tscale = Math.max(min, Math.min(110, cam.tscale));
  };

  // ---------------------------------------------------------------- what the page shows now

  function phaseOf() {
    const room = state.room;
    const g = state.net?.g;
    if (!room || room.match?.phase !== 'playing' || !g || g.mid !== room.match.id) return 'lobby';
    if (g.ph === 'chess' || (g.ph === 'lost' && g.ch)) return 'chess';
    return 'rts';
  }

  function chessData() {
    const net = state.net;
    if (net.sim && net.sim.phase === 'chess') {
      const ch = net.sim.chess;
      return { pos: ch.pos, own: ch.own, moves: ch.moves, last: ch.last, wc: ch.wc, bc: ch.bc, tt: ch.turnT, capB: ch.capB };
    }
    if (net.sim && net.sim.phase === 'lost' && !net.sim.awake) {
      const ch = net.sim.chess;
      return { pos: ch.pos, own: ch.own, moves: ch.moves, last: ch.last, wc: ch.wc, bc: ch.bc, tt: ch.turnT, capB: ch.capB };
    }
    const ch = net.g?.ch;
    const b = ch && parseBoard(ch.b);
    if (!b) {
      const pos = initialPosition();
      return { pos, own: new Array(64).fill(0), moves: [], last: null, wc: 600, bc: 600, tt: 0, capB: [] };
    }
    return {
      pos: { b, t: ch.t === 'b' ? 'b' : 'w', cr: String(ch.cr ?? ''), ep: Number.isInteger(ch.ep) ? ch.ep : -1, hm: 0, fm: ch.fm ?? 1 },
      own: String(ch.own ?? '').split('').map((c) => (c === '.' ? -1 : Number(c) || 0)),
      moves: Array.isArray(ch.mv) ? ch.mv.filter((m) => typeof m === 'string') : [],
      last: Array.isArray(ch.last) ? ch.last : null,
      wc: ch.wc ?? 600,
      bc: ch.bc ?? 600,
      tt: ch.tt ?? 0,
      capB: typeof ch.cb === 'string' ? ch.cb.split('') : [],
    };
  }

  /** The chess position as a little world, with ids that follow each piece from square to square (so moves slide). */
  function chessWorld(cd) {
    const key = cd.pos.b.join('');
    if (!state.chessIds || key !== state.chessBoardKey) {
      const ids = state.chessIds;
      if (ids && cd.last && state.chessBoardKey) {
        const [from, to] = cd.last;
        const next = ids.slice();
        next[to] = ids[from] || to + 1;
        next[from] = 0;
        const p = cd.pos.b[to];
        if (typeOf(p) === 'k' && Math.abs(to - from) === 2) {
          const rookFrom = to > from ? from + 3 : from - 4;
          const rookTo = to > from ? from + 1 : from - 1;
          next[rookTo] = ids[rookFrom] || rookTo + 1;
          next[rookFrom] = 0;
        }
        for (let sq = 0; sq < 64; sq++) if (cd.pos.b[sq] === '.') next[sq] = 0;
        for (let sq = 0; sq < 64; sq++) if (cd.pos.b[sq] !== '.' && !next[sq]) next[sq] = 100 + sq;
        state.chessIds = next;
      } else {
        state.chessIds = cd.pos.b.map((p, sq) => (p === '.' ? 0 : sq + 1));
      }
      state.chessBoardKey = key;
    }
    const pieces = new Map();
    for (let sq = 0; sq < 64; sq++) {
      const p = cd.pos.b[sq];
      if (p === '.') continue;
      const { x, y } = chessToWorld(sq);
      const id = state.chessIds[sq] || sq + 1;
      pieces.set(id, { id, s: colorOf(p), k: typeOf(p), x, y, o: cd.own[sq] ?? -1, cd: 0, hp: 1, mh: 1, f: 0, st: 0, sq });
    }
    return { pieces, bounds: [C.KEEP_X, C.KEEP_Y, C.KEEP_X + 7, C.KEEP_Y + 7], terr: null, boss: null };
  }

  const sqOfWorld = (x, y) => {
    const f = x - C.KEEP_X;
    const r = 7 - (y - C.KEEP_Y);
    return f >= 0 && f < 8 && r >= 0 && r < 8 ? r * 8 + f : -1;
  };

  const mySlot = () => state.net?.mySlot() ?? -1;
  const solo = () => (state.net?.g?.sl?.length ?? 1) <= 1;
  const mine = (p) => p && p.s === 'w' && (p.o === mySlot() || (solo() && mySlot() >= 0));

  // ---------------------------------------------------------------- input

  const pointers = new Map();
  let down = null;
  let pinch = null;

  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const squareAt = (px, py) => {
    const [x, y] = cam.toWorld(px, py);
    return [Math.floor(x), Math.floor(y)];
  };

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    startAudio();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
    const [px, py] = local(e);
    pointers.set(e.pointerId, { x: px, y: py });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), scale: cam.tscale, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, cx: cam.tcx, cy: cam.tcy };
      down = null;
      state.box = null;
      state.drag = null;
      return;
    }
    const [sx, sy] = squareAt(px, py);
    down = { px, py, sx, sy, t: performance.now(), button: e.button, touch: e.pointerType !== 'mouse', mode: null, shift: e.shiftKey || e.metaKey || e.ctrlKey, cx: cam.tcx, cy: cam.tcy };
    if (down.touch) {
      down.timer = setTimeout(() => {
        if (down && !down.mode && state.phase === 'rts') {
          down.mode = 'box';
          if (navigator.vibrate) try { navigator.vibrate(15); } catch {}
          state.box = { x0: down.px, y0: down.py, x1: down.px, y1: down.py };
        }
      }, 430);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const [px, py] = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: px, y: py });
    if (e.pointerType === 'mouse') state.hover = squareAt(px, py);
    if (pinch && pointers.size >= 2 && state.phase === 'rts') {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      cam.tscale = pinch.scale * (d / Math.max(1, pinch.d));
      clampCam();
      cam.tcx = pinch.cx - (mx - pinch.mx) / cam.tscale;
      cam.tcy = pinch.cy - (my - pinch.my) / cam.tscale;
      cam.scale = cam.tscale;
      cam.cx = cam.tcx;
      cam.cy = cam.tcy;
      return;
    }
    if (!down) return;
    const moved = Math.hypot(px - down.px, py - down.py);
    if (!down.mode && moved > 7) {
      clearTimeout(down.timer);
      const w = currentWorld();
      const p = w ? pieceAt(w, down.sx, down.sy) : null;
      if (state.phase === 'chess') {
        if (p && canMoveChess(p)) {
          down.mode = 'drag';
          selectChess(p.sq);
        } else down.mode = 'none';
      } else if (state.phase === 'rts') {
        if (down.button === 1 || down.button === 2) down.mode = 'pan';
        else if (p && mine(p) && active(p)) {
          down.mode = 'drag';
          if (!state.sel.has(p.id) || state.sel.size !== 1) selectOnly(p.id);
        } else if (down.touch) down.mode = 'pan';
        else down.mode = 'box';
      } else down.mode = 'none';
    }
    if (down.mode === 'pan') {
      cam.tcx = down.cx - (px - down.px) / cam.scale;
      cam.tcy = down.cy - (py - down.py) / cam.scale;
      cam.cx = cam.tcx;
      cam.cy = cam.tcy;
      clampCam();
    } else if (down.mode === 'box') {
      state.box = { x0: down.px, y0: down.py, x1: px, y1: py };
    } else if (down.mode === 'drag') {
      const w = currentWorld();
      const p = w ? pieceAt(w, down.sx, down.sy) : null;
      if (p) state.drag = { id: p.id, k: p.k, color: 'w', px, py };
    }
  });
  const endPointer = (e) => {
    const [px, py] = local(e);
    pointers.delete(e.pointerId);
    if (pinch) {
      if (pointers.size < 2) pinch = null;
      return;
    }
    if (!down) return;
    clearTimeout(down.timer);
    const d = down;
    down = null;
    if (e.type === 'pointercancel') {
      state.box = null;
      state.drag = null;
      return;
    }
    const [sx, sy] = squareAt(px, py);
    if (d.mode === 'box' && state.box) {
      boxSelect(state.box, d.shift);
      state.box = null;
      return;
    }
    if (d.mode === 'drag') {
      state.drag = null;
      if (state.phase === 'chess') {
        const to = sqOfWorld(sx, sy);
        if (to >= 0 && to !== state.chessSel) tryChessMove(state.chessSel, to);
      } else if (state.phase === 'rts') commandAt(sx, sy, true);
      return;
    }
    if (d.mode === 'pan' || d.mode === 'none') return;
    // A click or a tap.
    if (state.phase === 'chess') clickChess(sx, sy);
    else if (state.phase === 'rts') {
      if (d.button === 2) {
        if (state.sel.size) commandAt(sx, sy, false);
      } else clickWar(sx, sy, d.shift);
    }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', () => (state.hover = null));
  canvas.addEventListener('wheel', (e) => {
    if (state.phase !== 'rts') return;
    e.preventDefault();
    const [px, py] = local(e);
    const [wx, wy] = cam.toWorld(px, py);
    cam.tscale *= Math.exp(-e.deltaY * 0.0015);
    clampCam();
    // Keep the point under the cursor still.
    const [w, hgt] = renderer.size();
    cam.tcx = wx - (px - w / 2) / cam.tscale;
    cam.tcy = wy - (py - hgt / 2) / cam.tscale;
    cam.scale = cam.tscale;
    cam.cx = cam.tcx;
    cam.cy = cam.tcy;
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const k = e.key.toLowerCase();
    state.keys.add(k);
    if (state.phase !== 'rts') return;
    if (k === ' ') {
      e.preventDefault();
      centerKing();
    } else if (k === 'escape') clearSel();
    else if (k === 'a' && !e.repeat && (e.ctrlKey || e.metaKey || e.shiftKey)) {
      e.preventDefault();
      selectAllInView();
    } else if (k === 'q' && !e.repeat) selectAllInView();
    else if (k === 'h' && !e.repeat) halt();
    else if (k === 'c' && !e.repeat) castle();
    else if (k === 'f' && !e.repeat) toggleAuto();
    else if (['1', '2', '3', '4'].includes(k) && !e.repeat) promote(['n', 'b', 'r', 'q'][Number(k) - 1]);
    else if ((k === '=' || k === '+') && !e.repeat) zoomBy(1.25);
    else if (k === '-' && !e.repeat) zoomBy(0.8);
  });
  window.addEventListener('keyup', (e) => state.keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => state.keys.clear());

  function zoomBy(f) {
    cam.tscale *= f;
    clampCam();
  }

  function currentWorld() {
    if (state.phase === 'chess') return chessWorld(chessData());
    return state.net?.world ?? null;
  }
  function pieceAt(w, x, y) {
    if (!w) return null;
    if (!w.occ) {
      for (const p of w.pieces.values()) if (p.x === x && p.y === y) return p;
      return null;
    }
    if (x < 0 || y < 0 || x >= C.W || y >= C.H) return null;
    const o = w.occ[y * C.W + x];
    return o > 0 ? w.pieces.get(o) : null;
  }

  // -------- the opening

  function canMoveChess(p) {
    const cd = chessData();
    if (cd.pos.t !== 'w' || p.s !== 'w' || state.room?.spectating) return false;
    const owner = cd.own[p.sq];
    const slots = state.net?.g?.sl ?? [0];
    return owner === mySlot() || owner < 0 || !slots.includes(owner) || solo();
  }
  function selectChess(sq) {
    state.chessSel = sq;
    sfx.select();
  }
  function clickChess(x, y) {
    const sq = sqOfWorld(x, y);
    const cd = chessData();
    if (sq < 0) {
      state.chessSel = -1;
      return;
    }
    if (state.chessSel >= 0 && sq !== state.chessSel) {
      const legal = legalMoves(cd.pos).some((m) => m.from === state.chessSel && m.to === sq);
      if (legal) {
        tryChessMove(state.chessSel, sq);
        return;
      }
    }
    const w = chessWorld(cd);
    const p = [...w.pieces.values()].find((q) => q.sq === sq);
    if (p && canMoveChess(p)) state.chessSel = state.chessSel === sq ? -1 : sq;
    else state.chessSel = -1;
    if (state.chessSel >= 0) sfx.select();
  }
  function tryChessMove(from, to) {
    const cd = chessData();
    const m = findMove(cd.pos, from, to, 'q');
    state.chessSel = -1;
    if (!m) {
      sfx.illegal();
      return;
    }
    state.net.send({ t: 'cm', from, to, promo: 'q' });
  }

  // -------- the battlefield

  function selectOnly(id) {
    state.sel = new Set([id]);
    state.inspect = null;
    sfx.select();
    tip('select', 'Click a dot to move · anywhere else to march');
  }
  function clearSel() {
    state.sel.clear();
    state.inspect = null;
  }
  function clickWar(x, y, shift) {
    const w = state.net?.world;
    if (!w) return;
    const p = pieceAt(w, x, y);
    const now = performance.now();
    if (p && mine(p)) {
      if (state.lastClick.id === p.id && now - state.lastClick.at < 320) {
        // Double click: every piece of yours of this kind on screen.
        const [w0, h0] = renderer.size();
        const [x0, y0] = cam.toWorld(0, 0);
        const [x1, y1] = cam.toWorld(w0, h0);
        state.sel = new Set([...w.pieces.values()].filter((q) => mine(q) && q.k === p.k && active(q) && q.x >= x0 - 1 && q.x <= x1 && q.y >= y0 - 1 && q.y <= y1).map((q) => q.id));
        state.lastClick = { id: 0, at: 0 };
        sfx.select();
        return;
      }
      state.lastClick = { id: p.id, at: now };
      if (shift) {
        if (state.sel.has(p.id)) state.sel.delete(p.id);
        else state.sel.add(p.id);
        sfx.select();
      } else if (state.sel.size === 1 && state.sel.has(p.id)) clearSel();
      else selectOnly(p.id);
      return;
    }
    if (state.sel.size) {
      commandAt(x, y, false);
      return;
    }
    if (p && p.s !== 'w') {
      state.inspect = { id: p.id, until: now + 2600 };
      return;
    }
    clearSel();
  }

  /** Selected pieces act on square (x, y): a legal move for one piece, a march for the rest. */
  function commandAt(x, y, fromDrag) {
    const w = state.net?.world;
    if (!w || x < 0 || y < 0 || x >= C.W || y >= C.H) return;
    const ids = [...state.sel].filter((id) => mine(w.pieces.get(id)));
    if (!ids.length) return;
    if (ids.length === 1) {
      const p = w.pieces.get(ids[0]);
      const m = movesOf(w, p).find((m) => m.x === x && m.y === y);
      if (m && state.net.time() >= p.cd - 0.15) {
        state.net.send({ t: 'mv', id: p.id, x, y });
        state.orders.delete(p.id);
        if (m.o) sfx.capture();
        else sfx.move();
        if (!fromDrag) state.sel.clear();
        return;
      }
      if (p.x === x && p.y === y) return;
    }
    // March: keep the group's shape, squeezed a little, around the target.
    let cx = 0;
    let cy = 0;
    for (const id of ids) {
      const p = w.pieces.get(id);
      cx += p.x;
      cy += p.y;
    }
    cx /= ids.length;
    cy /= ids.length;
    const squeeze = ids.length > 1 ? 0.55 : 0;
    const out = ids.map((id) => {
      const p = w.pieces.get(id);
      const tx = Math.round(x + Math.max(-7, Math.min(7, (p.x - cx) * squeeze)));
      const ty = Math.round(y + Math.max(-7, Math.min(7, (p.y - cy) * squeeze)));
      const ox = Math.max(0, Math.min(C.W - 1, tx));
      const oy = Math.max(0, Math.min(C.H - 1, ty));
      state.orders.set(id, [ox, oy, performance.now()]);
      return [id, ox, oy];
    });
    state.net.send({ t: 'go', o: out });
    state.flag = [x, y, performance.now() / 1000];
    sfx.order();
    tip('march', 'Drag a box to select many');
  }

  function boxSelect(b, add) {
    const w = state.net?.world;
    if (!w) return;
    const [ax, ay] = cam.toWorld(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1));
    const [bx, by] = cam.toWorld(Math.max(b.x0, b.x1), Math.max(b.y0, b.y1));
    const next = add ? new Set(state.sel) : new Set();
    for (const p of w.pieces.values()) {
      if (!mine(p) || !active(p)) continue;
      if (p.x + 0.5 >= ax && p.x + 0.5 <= bx && p.y + 0.5 >= ay && p.y + 0.5 <= by) next.add(p.id);
    }
    state.sel = next;
    if (next.size) sfx.select();
  }
  function selectAllInView() {
    const w = state.net?.world;
    if (!w) return;
    const [w0, h0] = renderer.size();
    boxSelect({ x0: 0, y0: 0, x1: w0, y1: h0 }, false);
  }
  function centerKing() {
    const w = state.net?.world;
    const king = w?.pieces.get(state.net.g?.kid);
    if (!king) return;
    cam.tcx = king.x + 0.5;
    cam.tcy = king.y + 0.5;
  }
  function halt() {
    const ids = [...state.sel];
    if (!ids.length) return;
    for (const id of ids) state.orders.delete(id);
    state.net.send({ t: 'halt', ids });
    sfx.ui();
  }
  function castle() {
    if (state.net.send({ t: 'castle' }) !== false) sfx.castle();
  }
  function toggleAuto() {
    const g = state.net?.g;
    const s = mySlot();
    if (!g || s < 0) return;
    const on = !(Array.isArray(g.auto) ? g.auto[s] !== false : true);
    state.net.send({ t: 'auto', on });
    if (g.auto) g.auto[s] = on;
    sfx.ui();
  }
  function promote(k) {
    const w = state.net?.world;
    if (!w || state.sel.size !== 1) return;
    const p = w.pieces.get([...state.sel][0]);
    if (!p || p.k !== 'p' || !mine(p)) return;
    state.net.send({ t: 'promo', id: p.id, k });
  }

  // ---------------------------------------------------------------- the side panel

  function refreshPanel(force) {
    if (force) state.panelDirty = true;
  }

  function buildLobby() {
    const room = state.room;
    const r = ui.panel('lobby', (refs) =>
      lobbyPanel(refs, {
        onDiff: (k) => {
          if (state.room.isHost) {
            state.net.setLobby({ diff: k, resume: false });
            sfx.ui();
          }
        },
        onPlay: () => {
          startAudio();
          if (!state.room.isHost) return;
          state.net.setLobby({ resume: false });
          if (!state.net.start()) sfx.illegal();
          else sfx.start();
        },
        onReady: () => {
          startAudio();
          state.room.setReady(!state.room.me.ready);
          sfx.ui();
        },
        onContinue: () => {
          startAudio();
          if (!state.room.isHost || !state.save) return;
          state.net.setLobby({ resume: true });
          setTimeout(() => {
            if (!state.net.start()) sfx.illegal();
          }, 60);
        },
        onInvite: () => {
          try {
            ow?.ui?.showInvite?.();
          } catch {}
        },
      }),
    );
    const lob = state.net.lobby();
    for (const b of r.seg) {
      b.classList.toggle('on', b.dataset.k === lob.diff);
      b.disabled = !room.isHost;
    }
    const isHost = room.isHost;
    const watching = room.match?.phase === 'playing' && room.spectating;
    r.play.hidden = !isHost || watching;
    r.ready.hidden = isHost || watching;
    r.ready.textContent = room.me.ready ? 'Not ready' : 'Ready';
    r.ready.classList.toggle('grey', !!room.me.ready);
    r.ready.classList.toggle('green', !room.me.ready);
    const waitingFor = (room.notReady ?? []).map((id) => room.players.get(id)?.name).filter(Boolean);
    r.play.disabled = !room.canStart;
    ui.set(r.wait, watching ? 'Watching · you join at the next wave break' : isHost ? (waitingFor.length ? `Waiting for ${waitingFor.slice(0, 2).join(', ')}` : '') : 'Waiting for the host');
    r.cont.hidden = !(isHost && state.save && state.save.ck && !watching);
    if (!r.cont.hidden) ui.set(r.cont, `Continue · ${state.save.n >= WAVE_COUNT ? 'The Endgame' : `Wave ${Math.max(1, state.save.n)}`}`);
    // Seats, the host first.
    const key = [...room.players.values()].map((p) => `${p.id}:${p.name}:${p.ready ? 1 : 0}:${p.connected === false ? 0 : 1}:${avatarCache.get(p.id) ?? ''}`).join('|') + room.host;
    if (r.seats.dataset.key !== key) {
      r.seats.dataset.key = key;
      const list = [...room.players.values()].sort((a, b) => (a.id === room.host ? -1 : b.id === room.host ? 1 : 0)).slice(0, 4);
      const rows = list.map((p, i) => seatRow(p, i, { isHost: p.id === room.host, me: p.id === room.me.id, ready: p.ready, avatar: avatarFor(p.id, p.name) }));
      for (let i = list.length; i < 4; i++) rows.push(emptySeat(r.onInvite, room.kind === 'private' && !!ow?.ui?.showInvite));
      r.seats.replaceChildren(...rows);
    }
  }

  const avatarCache = new Map();
  function avatarFor(id, name) {
    let url = avatarCache.get(id);
    if (url === undefined && ow?.player?.avatarUrl) {
      avatarCache.set(id, null);
      Promise.resolve(ow.player.avatarUrl(id, 'head')).then((u) => {
        avatarCache.set(id, u || null);
        state.panelDirty = true;
        state.barKey = '';
      }).catch(() => {});
    }
    return avatarImg(url || null, name);
  }

  function buildChess(cd, frozen = false) {
    const r = ui.panel('chess', (refs) =>
      chessPanel(refs, {
        onResign: (btn) => {
          const now = performance.now();
          if (now - state.resignArmed < 3000) {
            state.resignArmed = 0;
            state.net.send({ t: 'resign' });
          } else {
            state.resignArmed = now;
            btn.lastChild.textContent = 'Resign?';
            setTimeout(() => (btn.lastChild.textContent = 'Resign'), 3000);
          }
        },
      }),
    );
    fillMoves(r.list, cd.moves);
    const [line, mood] = frozen ? ['Finally.', 'hungry'] : noirLine(cd.moves.length);
    ui.set(r.says, line);
    r.says.className = `says ${mood}`;
    const lost = state.net.g?.ph === 'lost';
    ui.set(r.status, frozen ? '' : lost ? 'Game over' : cd.pos.t === 'w' ? (solo() ? 'Your move' : 'White to move') : 'Noir is thinking');
    r.status.classList.toggle('thinking', cd.pos.t === 'b' && !lost && !frozen);
    r.resign.hidden = frozen;
  }

  function buildWar(view) {
    const fresh = ui.panelMode() !== 'war';
    const r = ui.panel('war', (refs) =>
      warPanel(refs, {
        onReadyWave: () => {
          const g = state.net.g;
          const on = !(g?.wv?.rd ?? []).includes(mySlot());
          state.net.send({ t: 'ready', on });
          sfx.ui();
        },
        onPromo: promote,
        onHalt: halt,
        onCastle: castle,
        onAuto: toggleAuto,
        onPause: () => {
          const g = state.net.g;
          state.net.send({ t: 'pause', on: !g?.pz });
          sfx.ui();
        },
        onSelectAll: selectAllInView,
        onKing: centerKing,
        minimap: ui.minimap,
      }),
    );
    if (fresh) layout();
    const { g, world, t } = view;
    const wv = g.wv ?? {};
    const boss = world?.boss;
    // The wave card.
    if (g.ph === 'awaken') {
      ui.set(r.waveT, 'The Endgame');
      ui.set(r.waveS, 'awakens');
      ui.set(r.waveR, '');
      r.waveBtn.hidden = true;
      r.prog.style.width = '0%';
    } else if (wv.st === 'break') {
      ui.set(r.waveT, `Wave ${wv.n + 1}`);
      ui.set(r.waveS, WAVES[wv.n]?.name ?? '');
      ui.set(r.waveR, fmtClock(Math.max(0, (wv.until ?? 0) - t)));
      r.waveBtn.hidden = mySlot() < 0;
      const ready = (wv.rd ?? []).includes(mySlot());
      ui.set(r.waveBtn, ready ? 'Ready ✓' : solo() ? 'Start now' : 'Ready');
      r.waveBtn.classList.toggle('grey', ready);
      r.prog.style.width = `${Math.min(100, (1 - Math.max(0, (wv.until - t) / (wv.n === 0 ? C.FIRST_BREAK : C.BREAK))) * 100)}%`;
    } else if (wv.st === 'fight') {
      ui.set(r.waveT, `Wave ${wv.n}`);
      ui.set(r.waveS, WAVES[wv.n - 1]?.name ?? '');
      const left = view.waveLeft;
      ui.set(r.waveR, `${left} left`);
      r.waveBtn.hidden = true;
      const total = WAVES[wv.n - 1]?.bursts ?? 1;
      r.prog.style.width = `${Math.min(100, ((wv.k ?? 0) / total) * 100)}%`;
    } else if (g.ph === 'won') {
      ui.set(r.waveT, 'Checkmate');
      ui.set(r.waveS, 'The Endgame has fallen');
      ui.set(r.waveR, '');
      r.waveBtn.hidden = true;
      r.prog.style.width = '0%';
    } else if (wv.st === 'bossintro' || wv.st === 'boss') {
      ui.set(r.waveT, 'The Endgame');
      ui.set(r.waveS, boss ? (boss.ph >= 3 ? 'Phase 3 · the king is exposed' : boss.ph === 2 ? 'Phase 2' : wv.st === 'bossintro' ? 'awakens' : 'Phase 1') : '');
      ui.set(r.waveR, boss ? `${Math.round(integrity(boss) * 100)}%` : '');
      r.waveBtn.hidden = true;
      r.prog.style.width = boss ? `${integrity(boss) * 100}%` : '0%';
    }
    r.prog.parentElement.classList.toggle('boss', wv.st === 'boss' || wv.st === 'bossintro');
    // Selection.
    const sel = [...state.sel].map((id) => world?.pieces.get(id)).filter(Boolean);
    const selKey = sel.map((p) => p.id + p.k).join(',');
    if (r.selIcons.dataset.key !== selKey) {
      r.selIcons.dataset.key = selKey;
      const kinds = [...new Set(sel.map((p) => p.k))];
      r.selIcons.replaceChildren(...selectionIcons(kinds.length ? kinds : []));
    }
    const mat = Array.isArray(g.mat) ? g.mat[mySlot()] ?? 0 : 0;
    if (!sel.length) ui.set(r.selName, mySlot() < 0 ? 'Watching' : 'Select a piece');
    else if (sel.length === 1) {
      const p = sel[0];
      const left = p.cd - t;
      ui.set(r.selName, `${C.NAMES[p.k]}${left > 0.05 ? ` · ${left.toFixed(1)}s` : ' · ready'}`);
    } else ui.set(r.selName, `${sel.length} pieces`);
    const pawn = sel.length === 1 && sel[0].k === 'p';
    r.promo.hidden = !pawn;
    for (const b of r.promo.children) b.disabled = mat < C.PROMO_COST[b.dataset.k];
    r.halt.hidden = !sel.some((p) => p.st & C.ST_ORDER);
    const king = world?.pieces.get(g.kid);
    r.castle.hidden = !(king && king.o === mySlot());
    r.castle.disabled = t < (g.ca ?? 0);
    ui.set(r.castle, t < (g.ca ?? 0) ? `Castle ${Math.ceil(g.ca - t)}s` : 'Castle');
    const autoOn = Array.isArray(g.auto) ? g.auto[mySlot()] !== false : true;
    r.auto.setAttribute('aria-checked', autoOn ? 'true' : 'false');
    r.auto.classList.toggle('on', autoOn);
    r.pause.hidden = !solo() || !state.room.isHost;
    ui.set(r.pause, g.pz ? 'Resume' : 'Pause');
    // The team (twice a second).
    if (!state.teamAt || performance.now() - state.teamAt > 500) {
      state.teamAt = performance.now();
      const counts = [0, 0, 0, 0];
      if (world) for (const p of world.pieces.values()) if (p.s === 'w' && p.o >= 0 && p.o < 4) counts[p.o]++;
      const names = slotNames();
      const rows = (g.sl ?? [0]).map((s) => teamRow(names[s] ?? `Player ${s + 1}`, s, counts[s], Array.isArray(g.mat) ? g.mat[s] ?? 0 : 0, s === mySlot()));
      r.team.replaceChildren(...rows);
    }
  }

  function slotNames() {
    const out = {};
    const slots = state.net?.slots ?? {};
    for (const [id, s] of Object.entries(slots)) out[s] = state.room.players.get(id)?.name ?? (id === state.room.me.id ? state.room.me.name : 'Player');
    return out;
  }

  // ---------------------------------------------------------------- bars

  function updateBars(view) {
    const { g, t } = view;
    const room = state.room;
    const top = ui.top;
    const bot = ui.bot;
    const me = room.me;
    if (state.phase === 'rts' && !view.hold) {
      ui.setAvatar(top, 'dragon', ui.dragonAvatar);
      ui.set(top.name, 'The Endgame');
      ui.set(top.rating, '');
      const boss = view.world?.boss;
      const wv = g.wv ?? {};
      const key = `rts${wv.st}${boss?.ph}`;
      if (top.extra.dataset.key !== key) {
        top.extra.dataset.key = key;
        if ((wv.st === 'boss' || wv.st === 'bossintro') && boss) {
          state.hpBar = h('div', { class: 'hp' }, h('i'));
          top.extra.replaceChildren(state.hpBar);
        } else {
          state.hpBar = null;
          top.extra.replaceChildren(h('span', { class: 'pb-sub' }, wv.st === 'fight' ? `Wave ${wv.n} of ${WAVE_COUNT}` : wv.st === 'break' ? `Wave ${wv.n + 1} next` : 'Awakening'));
        }
      }
      if (state.hpBar && boss) state.hpBar.firstChild.style.width = `${boss.dead ? 0 : Math.max(0, integrity(boss)) * 100}%`;
      if (state.hpBar && boss) state.hpBar.classList.toggle('exposed', kingExposed(boss));
      // Black's clock counts down to its next move.
      const left = Math.max(0, (g.nt ?? 0) - t);
      ui.set(top.clockT, g.ph === 'rts' ? `0:0${left.toFixed(1)}` : '—');
      top.clock.classList.toggle('run', g.ph === 'rts');
      top.clock.classList.toggle('low', g.ph === 'rts' && left < 1.2);
      // Yours: the run's time.
      ui.setAvatar(bot, `me${avatarCache.get(me.id) ?? ''}`, () => avatarFor(me.id, me.name));
      ui.set(bot.name, me.name || 'You');
      const slot = mySlot();
      ui.set(bot.rating, slot >= 0 && !solo() ? C.SLOT_NAMES[slot] : '');
      bot.rating.style.color = slot >= 0 && !solo() ? C.SLOT_COLORS[slot] : '';
      const mat = Array.isArray(g.mat) && slot >= 0 ? g.mat[slot] ?? 0 : 0;
      const ek = `m${mat}`;
      if (bot.extra.dataset.key !== ek) {
        bot.extra.dataset.key = ek;
        bot.extra.replaceChildren(h('span', { class: 'mat' }, `+${mat}`));
      }
      ui.set(bot.clockT, runClock(g.res && typeof g.res.t === 'number' ? g.res.t : t));
      bot.clock.classList.add('run');
      bot.clock.classList.remove('low');
      return;
    }
    // The opening (and the lobby): Noir above, White below, chess clocks.
    ui.setAvatar(top, 'noir', ui.noirAvatar);
    ui.set(top.name, 'Noir');
    ui.set(top.rating, '(1450)');
    const cd = state.phase === 'chess' ? chessData() : view.hold ? state.lastChess : null;
    const capKey = cd ? `c${cd.capB.join('')}` : 'c';
    if (top.extra.dataset.key !== capKey) {
      top.extra.dataset.key = capKey;
      top.extra.replaceChildren(...(cd ? capturedIcons(cd.capB, 'w') : []));
    }
    if (bot.extra.dataset.key !== 'none') {
      bot.extra.dataset.key = 'none';
      bot.extra.replaceChildren();
    }
    const players = [...room.players.values()];
    ui.setAvatar(bot, `me${avatarCache.get(me.id) ?? ''}`, () => avatarFor(me.id, me.name));
    ui.set(bot.name, players.length > 1 ? `${me.name || 'You'} + ${players.length - 1}` : me.name || 'You');
    ui.set(bot.rating, '');
    let wc = 600;
    let bc = 600;
    let turn = '';
    if (cd) {
      const elapsed = Math.max(0, t - cd.tt);
      turn = view.hold ? '' : cd.pos.t;
      wc = cd.wc - (turn === 'w' ? elapsed : 0);
      bc = cd.bc - (turn === 'b' ? elapsed : 0);
    }
    ui.set(top.clockT, fmtClock(bc));
    ui.set(bot.clockT, fmtClock(wc));
    top.clock.classList.toggle('run', turn === 'b' && g?.ph === 'chess');
    bot.clock.classList.toggle('run', turn === 'w' && g?.ph === 'chess');
    top.clock.classList.remove('low');
    bot.clock.classList.remove('low');
  }

  function runClock(sec) {
    const m = Math.floor(sec / 60);
    const ss = String(Math.floor(sec % 60)).padStart(2, '0');
    return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  }

  function capturedIcons(list, color) {
    const order = 'qrbnp';
    const sorted = list.map((c) => c.toLowerCase()).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const value = sorted.reduce((s, k) => s + (C.VALUE[k] ?? 0), 0);
    const out = sorted.map((k) => h('span', { class: 'cap', html: pieceSvg(k, color, 18) }));
    if (value) out.push(h('span', { class: 'mat' }, `+${value}`));
    return out;
  }

  // ---------------------------------------------------------------- events → sound and motion

  function partSquare(world, i) {
    const boss = world?.boss;
    const part = boss?.parts[i];
    if (!part) return null;
    const pose = renderer.partPose(boss, part, performance.now() / 1000, state.net.time());
    return [pose.x, pose.y];
  }

  function handleEvent(e, world, g) {
    const [, type, ...a] = e;
    const now = performance.now() / 1000;
    const pos = (p) => [(p % C.W) + 0.5, Math.floor(p / C.W) + 0.5];
    switch (type) {
      case 'm': {
        const [, , cap, check, castled] = a;
        if (castled) sfx.castle();
        else if (cap) sfx.capture();
        else sfx.move();
        if (check) sfx.check();
        break;
      }
      case 'A':
        state.awakeT0 = null;
        state.cineMarks.clear();
        award('awakening');
        break;
      case 'x': {
        const [p, k, side] = a;
        const [x, y] = pos(p);
        if (side === 'w') {
          fx.shards(x, y, '#f4f4f2', 10, 1);
          fx.debris(x, y, k, 'w', 0.8, 0.8);
          sfx.lost();
        } else {
          fx.shards(x, y, side === 's' ? '#8f8a83' : '#3b3937', 12, 1);
          fx.ring(x, y, 'rgba(255,255,255,0.6)', 0.9, 0.3, 0.08);
          sfx.capture();
        }
        break;
      }
      case 'k': {
        const [p] = a;
        const [x, y] = pos(p);
        fx.sparks(x, y, '#ffd36b', 10);
        fx.text(x, y - 0.4, 'Armour', '#ffd36b', 0.36, 0.7);
        sfx.hit();
        break;
      }
      case 'h': {
        const [i, dmg] = a;
        renderer.partHit(i, now);
        const sq = partSquare(world, i);
        if (sq) {
          fx.sparks(sq[0], sq[1], '#ff9b6b', 6);
          fx.text(sq[0] + (Math.random() - 0.5) * 0.6, sq[1] - 0.5, `-${dmg}`, '#ffcf6b', 0.5, 0.8);
        }
        sfx.hit();
        fx.shake(0.04);
        break;
      }
      case 'B': {
        const [i] = a;
        const part = world?.boss?.parts[i];
        const sq = partSquare(world, i);
        if (part && sq) {
          fx.debris(sq[0], sq[1], part.k, 'd', 1.6, 1.2);
          fx.shards(sq[0], sq[1], '#2e2c2b', 16, 1.4);
          fx.ring(sq[0], sq[1], 'rgba(255,90,60,0.8)', 1.6, 0.5, 0.12);
        }
        sfx.breakPart();
        fx.shake(0.3);
        break;
      }
      case 'G': {
        const [grp] = a;
        if (grp !== 'king') ui.toast(`${GROUP_LABEL[grp] ?? 'Part'} broken`);
        break;
      }
      case 'y': {
        const [i, p] = a;
        renderer.partLunge(i, p % C.W, Math.floor(p / C.W), now);
        break;
      }
      case 'a':
        attackFx(a[0], a[1], world);
        break;
      case 'P': {
        const [p, k] = a;
        const [x, y] = pos(p);
        fx.ring(x, y, 'rgba(214,170,74,0.95)', 1.4, 0.6, 0.14);
        fx.text(x, y - 0.6, C.NAMES[k] ?? 'Queen', '#f2d27a', 0.5, 1);
        sfx.promote();
        const piece = world?.pieces.get(world.occ?.[p]);
        if (piece && mine(piece)) award('promotion');
        break;
      }
      case 'W': {
        const [n] = a;
        ui.banner(`Wave ${n}`, WAVES[n - 1]?.name ?? '');
        sfx.wave();
        setMusic('war');
        if (n === 1) tip('tick', 'Black moves every 5 seconds');
        break;
      }
      case 'C': {
        const [n] = a;
        if (n < WAVE_COUNT) {
          ui.banner(`Wave ${n} cleared`, 'Reinforcements', 'good');
          setMusic('calm');
        }
        sfx.clear();
        if (n === 5) award('wave-5');
        if (n === WAVE_COUNT) award('wave-10');
        break;
      }
      case 'S':
        sfx.summon();
        state.flapUntil = now + 1.2;
        break;
      case 'U':
        sfx.roar();
        fx.shake(0.25);
        break;
      case 'L': {
        const boss = world?.boss;
        if (boss) {
          fx.ring(boss.x + 0.5, boss.y + 0.5, 'rgba(60,40,30,0.7)', 9, 0.7, 0.4);
          fx.dust(boss.x + 0.5, boss.y + 1, 'rgba(70,60,50,0.55)', 14);
        }
        sfx.boom(1.4);
        fx.shake(0.7);
        break;
      }
      case 'R':
        sfx.roar();
        fx.shake(0.5);
        ui.banner('Roar', 'Black moves out of turn', 'bad');
        break;
      case 'T':
        sfx.tick(a[0] ?? 0);
        break;
      case 'Q': {
        const [ph] = a;
        if (ph === 1) {
          ui.banner('The Endgame', 'Break its pieces · checkmate its king', 'bad');
          setMusic('boss');
          tip('boss', 'Strike its pieces. Its king is last.');
        } else if (ph === 2) {
          ui.banner('Phase 2', 'It takes flight', 'bad');
          sfx.roar();
          fx.shake(0.4);
        } else if (ph === 3) {
          ui.banner('The king is exposed', 'Checkmate it', 'bad');
          sfx.roar();
          sfx.shatter();
          fx.shake(0.5);
          const b = world?.boss;
          if (b) {
            // The shield around its king breaks.
            fx.shards(b.x + 0.5, b.y + 0.5, 'rgba(230,80,80,0.9)', 26, 1.6);
            fx.ring(b.x + 0.5, b.y + 0.5, 'rgba(255,120,120,0.9)', 2.4, 0.5, 0.2);
          }
        }
        if (world?.boss) {
          fx.ring(world.boss.x + 0.5, world.boss.y + 0.5, 'rgba(220,40,30,0.75)', 14, 1.1, 0.5);
          fx.ring(world.boss.x + 0.5, world.boss.y + 0.5, 'rgba(255,120,80,0.5)', 9, 0.8, 0.3);
        }
        break;
      }
      case 'K': {
        const [k, r] = a;
        for (const p of [k, r]) {
          const [x, y] = pos(p);
          fx.ring(x, y, 'rgba(255,255,255,0.8)', 1, 0.4, 0.1);
        }
        sfx.castle();
        break;
      }
      case 'I': {
        const [stage] = a;
        if (stage === 0) {
          ui.banner('The rocks awaken', '', 'bad');
          setMusic('boss');
          sfx.rumble();
          state.ringShakeUntil = now + 2.6;
          if (world?.boss) {
            cam.tcx = world.boss.x + 0.5;
            cam.tcy = world.boss.y + 1.5;
            cam.tscale = Math.max(cam.tscale * 0.8, Math.min(renderer.size()[0], renderer.size()[1]) / 30);
          }
        } else if (stage === 1) {
          sfx.boom(1.6);
          sfx.roar();
          fx.shake(0.8);
          const b = world?.boss;
          if (b) {
            for (let i = 0; i < 70; i++) {
              const ang = (i / 70) * Math.PI * 2;
              const r = 9.5 + Math.random() * 1.6;
              fx.shards(b.x + 0.5 + Math.cos(ang) * r, b.y + 0.5 + Math.sin(ang) * r, '#8f8a83', 3, 1.2);
            }
          }
        }
        break;
      }
      case 'M': {
        const boss = world?.boss;
        if (boss) for (const part of boss.parts) {
          if (part.g === 'king') continue;
          const sq = partSquare(world, part.i) ?? [boss.x + part.dx + 0.5, boss.y + part.dy + 0.5];
          fx.debris(sq[0], sq[1], part.k, 'd', 2, 1.2);
        }
        fx.shake(1);
        sfx.victory();
        setMusic('calm');
        ui.banner('Checkmate', 'The Endgame has fallen', 'good');
        award('checkmate');
        if (g?.diff === 'hard') award('grandmaster');
        if (!(g?.st?.re > 0)) award('royal-escort');
        try {
          ow?.leaderboards?.submit?.('fastest-checkmate', Math.round((g?.res?.t ?? 0) / 6) / 10, { lowerIsBetter: true });
        } catch {}
        if (state.room.isHost) {
          try {
            ow?.save?.delete?.('run');
          } catch {}
          state.save = null;
        }
        break;
      }
      case 'D':
        sfx.defeat();
        setMusic('none');
        break;
      case 'F':
        ui.toast('Check blocked');
        break;
      case 'H':
        ui.toast(`Reinforcements: ${a[0]} pieces`);
        break;
      case 'r':
        renderer.resetTweens();
        fx.clear();
        state.sel.clear();
        state.orders.clear();
        ui.banner('Checkpoint', 'Try again', 'good');
        setMusic('war');
        break;
      default:
        break;
    }
  }

  function attackFx(kind, id, world) {
    const boss = world?.boss;
    if (kind === 'rake') {
      // The shockwave runs along each line from the dragon's side.
      const atk = state.lastAttacks?.get(id);
      if (atk?.lines) for (const [axis, line, lo, hi] of atk.lines) {
        if (axis === 0) fx.sweep(atk.side === 'l' ? hi + 1 : lo, line + 0.5, atk.side === 'l' ? lo : hi + 1, line + 0.5);
        else fx.sweep(line + 0.5, lo, line + 0.5, hi + 1);
      }
      sfx.rake();
      fx.shake(0.45);
    } else if (kind === 'rain') {
      const atk = state.lastAttacks?.get(id);
      if (atk?.xs) for (const [cx, cy] of atk.xs) {
        fx.beam(cx - 3, cy - 3, cx + 4, cy + 4);
        fx.beam(cx + 4, cy - 3, cx - 3, cy + 4);
        fx.ring(cx + 0.5, cy + 0.5, 'rgba(255,120,90,0.9)', 2, 0.4, 0.15);
      }
      sfx.zap();
      fx.shake(0.25);
    } else if (kind === 'fork' || kind === 'sting') {
      const atk = state.lastAttacks?.get(id);
      if (atk?.c) {
        const [cx, cy] = atk.c;
        fx.ring(cx + 0.5, cy + 0.5, 'rgba(255,90,60,0.9)', kind === 'fork' ? 3 : 2.6, 0.5, 0.3);
        fx.shards(cx + 0.5, cy + 0.5, '#ff7a4a', 18, 1.6);
        fx.dust(cx + 0.5, cy + 0.5, 'rgba(60,40,30,0.5)', 10);
      }
      sfx.boom(1);
      fx.shake(0.4);
    } else if (kind === 'decree') {
      const atk = state.lastAttacks?.get(id);
      if (atk?.g) for (const [gx, gy, d] of atk.g) {
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
        const [dx, dy] = dirs[d] ?? [0, 0];
        fx.beam(gx + 0.5, gy + 0.5, gx + 0.5 + dx * 10, gy + 0.5 + dy * 10, 'rgba(170,110,255,0.95)', 0.45, 0.35);
      }
      sfx.zap();
      fx.shake(0.3);
    } else if (kind === 'land') {
      // handled by 'L'
    }
  }

  // ---------------------------------------------------------------- the minimap

  let mapAt = 0;
  function drawMinimap(view) {
    const c = ui.minimap;
    if (!c.isConnected) return;
    const now = performance.now();
    if (now - mapAt < 180) return;
    mapAt = now;
    const size = c.clientWidth || 200;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(size * ratio)) {
      c.width = Math.round(size * ratio);
      c.height = Math.round(size * ratio);
    }
    const g = c.getContext('2d');
    const s = c.width / C.W;
    g.fillStyle = '#1c1b19';
    g.fillRect(0, 0, c.width, c.width);
    const w = view.world;
    if (!w) return;
    const b = w.bounds;
    g.fillStyle = '#5f7a45';
    g.fillRect(b[0] * s, b[1] * s, (b[2] - b[0] + 1) * s, (b[3] - b[1] + 1) * s);
    if (w.terr) {
      g.fillStyle = '#8e8a84';
      for (let y = b[1]; y <= b[3]; y++) for (let x = b[0]; x <= b[2]; x++) if (w.terr[y * C.W + x] === 1) g.fillRect(x * s, y * s, s, s);
    }
    const dot = Math.max(2, s * 1.2);
    for (const p of w.pieces.values()) {
      if (p.s === 'w') g.fillStyle = mine(p) ? '#ffffff' : C.SLOT_COLORS[p.o] ?? '#ddd';
      else if (p.st & C.ST_AIR) g.fillStyle = 'rgba(230,60,50,0.5)';
      else g.fillStyle = p.s === 's' ? '#b4aea5' : '#e2382c';
      g.fillRect(p.x * s - dot / 4, p.y * s - dot / 4, dot, dot);
    }
    if (w.boss && !w.boss.dead) {
      g.fillStyle = '#7a1414';
      for (const f of footprint(w.boss)) g.fillRect(f.x * s, f.y * s, s, s);
    }
    const king = w.pieces.get(view.g.kid);
    if (king) {
      g.strokeStyle = state.kingThreat ? '#ff3b30' : '#f2d27a';
      g.lineWidth = Math.max(1.5, s * 0.8);
      g.beginPath();
      g.arc((king.x + 0.5) * s, (king.y + 0.5) * s, s * 2.2, 0, Math.PI * 2);
      g.stroke();
    }
    // The camera, and where friends are looking.
    const [vw, vh] = renderer.size();
    const [x0, y0] = cam.toWorld(0, 0);
    const [x1, y1] = cam.toWorld(vw, vh);
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = Math.max(1, ratio);
    g.strokeRect(x0 * s, y0 * s, (x1 - x0) * s, (y1 - y0) * s);
    for (const p of state.room.players.values()) {
      if (p.id === state.room.me.id) continue;
      const pr = p.presence;
      const slot = state.net.slots[p.id];
      if (!pr || !Number.isFinite(pr.cx) || !Number.isFinite(pr.cy) || !Number.isInteger(slot)) continue;
      g.strokeStyle = C.SLOT_COLORS[slot] ?? '#fff';
      g.strokeRect((pr.cx - 8) * s, (pr.cy - 6) * s, 16 * s, 12 * s);
    }
  }
  const mapNav = (e) => {
    const r = ui.minimap.getBoundingClientRect();
    cam.tcx = ((e.clientX - r.left) / r.width) * C.W;
    cam.tcy = ((e.clientY - r.top) / r.height) * C.H;
    clampCam();
  };
  ui.minimap.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    mapNav(e);
    ui.minimap.setPointerCapture?.(e.pointerId);
    ui.minimap.dataset.drag = '1';
  });
  ui.minimap.addEventListener('pointermove', (e) => {
    if (ui.minimap.dataset.drag) mapNav(e);
  });
  ui.minimap.addEventListener('pointerup', () => delete ui.minimap.dataset.drag);

  // ---------------------------------------------------------------- results

  function results(view) {
    const { g } = view;
    const room = state.room;
    if (g.ph === 'won') {
      ui.modal(`won${g.mid}`, () => {
        const names = slotNames();
        const t = g.res?.t ?? 0;
        const rows = (g.sl ?? [0]).map((s) =>
          h('div', { class: 'r-row' }, h('i', { class: 'dot', style: `background:${C.SLOT_COLORS[s]}` }), h('span', {}, names[s] ?? 'Player'), h('span', { class: 'muted' }, `${g.cap?.[s] ?? 0} taken · ${g.dmg?.[s] ?? 0} damage`)),
        );
        return h(
          'div',
          { class: 'card result' },
          h('div', { class: 'r-head won' }, h('span', { class: 'r-icon', html: pieceSvg('k', 'w', 44) }), h('div', {}, h('div', { class: 'r-title' }, 'You Won!'), h('div', { class: 'r-sub' }, 'by Checkmate'))),
          h('div', { class: 'r-stats' },
            stat('Time', fmtClock(t)),
            stat('Waves', `${WAVE_COUNT}/${WAVE_COUNT}`),
            stat('Retries', String(g.st?.re ?? 0)),
            stat('Difficulty', C.DIFFICULTY[g.diff]?.label ?? 'Normal')),
          h('div', { class: 'r-rows' }, rows),
          h('div', { class: 'r-foot' }, room.isHost ? h('button', { class: 'btn green big', onclick: () => room.endMatch() }, 'New Game') : h('div', { class: 'wait' }, 'Waiting for the host')),
        );
      });
    } else if (g.ph === 'lost') {
      const chess = !!g.ch;
      const reason = g.res?.reason;
      ui.modal(`lost${g.mid}${g.st?.re ?? 0}`, () =>
        h(
          'div',
          { class: 'card result' },
          h('div', { class: 'r-head lost' }, h('span', { class: 'r-icon', html: pieceSvg('k', 'b', 44) }), h('div', {}, h('div', { class: 'r-title' }, chess ? 'Noir Won' : 'Defeat'), h('div', { class: 'r-sub' }, chess ? (reason === 'resign' ? 'by resignation' : 'by checkmate') : reason === 'army' ? 'Your army is gone' : 'Your king has fallen'))),
          h('div', { class: 'r-foot' },
            mySlot() >= 0 ? h('button', { class: 'btn green big', onclick: () => state.net.send({ t: 'retry' }) }, chess ? 'Rematch' : g.ck ? `Retry ${g.ck.st === 'boss' ? 'the Endgame' : g.ck.n ? `wave ${g.ck.n}` : 'from the start'}` : 'Retry') : null,
            room.isHost ? h('button', { class: 'btn grey', onclick: () => room.endMatch() }, 'Main menu') : null),
        ),
      );
    } else ui.modal(null);
  }
  const stat = (label, value) => h('div', { class: 'stat' }, h('div', { class: 'stat-v' }, value), h('div', { class: 'stat-l' }, label));

  // ---------------------------------------------------------------- the frame

  let last = performance.now();
  attach(await roomPromise);
  layout();
  frameChess(true);

  function frame() {
    requestAnimationFrame(frame);
    state.frames = (state.frames ?? 0) + 1;
    const nowMs = performance.now();
    const dt = Math.min(0.1, (nowMs - last) / 1000);
    last = nowMs;
    const now = nowMs / 1000;
    const net = state.net;
    if (!net) return;
    try {
      net.update(dt);
    } catch (err) {
      console.error(err);
    }
    const prevPhase = state.phase;
    state.phase = phaseOf();
    if (state.phase !== prevPhase) {
      ui.setPhase(state.phase);
      state.sel.clear();
      state.chessSel = -1;
      state.drag = null;
      state.box = null;
      layout();
      if (state.phase === 'chess' || state.phase === 'lobby') {
        frameChess(true);
        setMusic('none');
        renderer.resetTweens();
        state.chessIds = null;
        state.camInit = false;
        if (state.phase === 'chess') sfx.start();
      }
      try {
        ow?.ui?.setOrientation?.('any');
      } catch {}
    }
    const g = net.g;
    const t = net.time();
    const view = { g, t, world: state.phase === 'rts' ? net.world : null };

    // Events (only new ones; a page that just loaded doesn't replay old ones).
    const evs = net.sim ? net.sim.ev : Array.isArray(g?.ev) ? g.ev : [];
    if (g?.bo?.atk) {
      state.lastAttacks ??= new Map();
      for (const atk of g.bo.atk) state.lastAttacks.set(atk.id, atk);
      if (state.lastAttacks.size > 40) state.lastAttacks = new Map([...state.lastAttacks].slice(-20));
    }
    if (net.sim?.world?.boss) {
      state.lastAttacks ??= new Map();
      for (const atk of net.sim.world.boss.atk) state.lastAttacks.set(atk.id, atk);
    }
    if (g && g.mid !== state.evMid) {
      state.evMid = g.mid;
      state.evInit = false;
    }
    if (!state.evInit && g) {
      state.evInit = true;
      state.lastSeq = evs.reduce((m, e) => Math.max(m, Array.isArray(e) ? e[0] : 0), 0);
    }
    for (const e of evs) {
      if (!Array.isArray(e) || e[0] <= state.lastSeq) continue;
      state.lastSeq = e[0];
      try {
        handleEvent(e, view.world, g);
      } catch (err) {
        console.error(err);
      }
    }

    // Panel and bars.
    try {
      if (state.phase === 'lobby') buildLobby();
      else if (state.phase === 'chess') {
        state.lastChess = chessData();
        buildChess(state.lastChess);
      } else if (state.holdChess && state.lastChess) buildChess(state.lastChess, true);
      else if (g) {
        view.waveLeft = 0;
        if (view.world && g.wv?.st === 'fight') for (const p of view.world.pieces.values()) if (p.s === 'b' && p.w === g.wv.n) view.waveLeft++;
        buildWar(view);
      }
      updateBars({ g: g ?? {}, t, world: view.world, hold: state.holdChess && !!state.lastChess });
      if (g && state.phase !== 'lobby') results(view);
      else ui.modal(null);
    } catch (err) {
      console.error(err);
    }

    // Keyboard panning.
    if (state.phase === 'rts' && state.keys.size) {
      const sp = (600 / cam.scale) * dt;
      if (state.keys.has('w') || state.keys.has('arrowup')) cam.tcy -= sp;
      if (state.keys.has('s') || state.keys.has('arrowdown')) cam.tcy += sp;
      if (state.keys.has('a') || state.keys.has('arrowleft')) cam.tcx -= sp;
      if (state.keys.has('d') || state.keys.has('arrowright')) cam.tcx += sp;
      clampCam();
    }

    // Draw.
    const f = { now, t, mySlot: mySlot(), solo: solo(), sel: state.sel };
    if (state.phase === 'lobby' || state.phase === 'chess') {
      const cd = state.phase === 'chess' ? chessData() : { pos: initialPosition(), own: new Array(64).fill(0), last: null };
      f.world = chessWorld(cd);
      f.chessOnly = true;
      frameChess(false);
      if (cd.last) f.last = cd.last.map((sq) => {
        const { x, y } = chessToWorld(sq);
        return [x, y];
      });
      if (state.phase === 'chess' && inCheck(cd.pos)) {
        const k = chessToWorld(kingSquare(cd.pos.b, cd.pos.t));
        f.check = [k.x, k.y];
      }
      if (state.chessSel >= 0) {
        const { x, y } = chessToWorld(state.chessSel);
        f.selSquares = [[x, y]];
        f.legal = legalMoves(cd.pos).filter((m) => m.from === state.chessSel).map((m) => {
          const w = chessToWorld(m.to);
          return { x: w.x, y: w.y, o: m.c !== '.' ? 1 : 0 };
        });
      }
      if (state.drag) {
        const p = f.world.pieces.get(state.drag.id);
        if (p) f.dragging = { ...state.drag, k: p.k, color: 'w' };
      }
    } else if (view.world) {
      const w = view.world;
      f.world = w;
      f.awake = g.aw;
      f.growNext = g.gn;
      f.growSide = g.gs;
      f.tickIn = g.ph === 'rts' ? Math.max(0, (g.nt ?? 0) - t) : undefined;
      f.attacks = w.boss?.atk ?? [];
      f.ringShake = state.ringShakeUntil && now < state.ringShakeUntil ? 1 : 0;
      cinematic(view, now);
      // Boss posture from what it is about to do.
      if (w.boss) {
        const b = w.boss;
        let flap = 0;
        let curl = 0;
        let rear = 0;
        for (const atk of b.atk) {
          const k = Math.max(0, Math.min(1, (t - atk.t0) / Math.max(0.1, atk.t1 - atk.t0)));
          if (atk.k === 'rake') flap = Math.max(flap, k * 0.35);
          if (atk.k === 'sting') curl = Math.max(curl, k);
          if (atk.k === 'fork' || atk.k === 'decree' || atk.k === 'roar') rear = Math.max(rear, k * 0.6);
        }
        if (state.flapUntil && now < state.flapUntil) flap = Math.max(flap, 0.25 * Math.sin(((state.flapUntil - now) / 1.2) * Math.PI));
        b._flap = flap;
        b._curl = curl;
        b._rear = rear;
      }
      // Pieces in the air: arcs from the dragon (or up from a rift), drops from the sky for White.
      for (const p of w.pieces.values()) {
        if (!(p.st & C.ST_AIR) || state.arcSeen.has(p.id)) continue;
        state.arcSeen.add(p.id);
        const left = Math.max(0.15, p.cd - t);
        if (p.s === 'w') fx.arc(p.x + 0.5, p.y - 7, p.x + 0.5, p.y + 0.5, p.k, 'w', left, 1, 1);
        else if (p.st & 32) fx.arc(p.x + 0.5, p.y + 0.5, p.x + 0.5, p.y + 0.5, p.k, 'b', left, 1.2, 1);
        else if (w.boss) fx.arc(w.boss.x + 0.5, w.boss.y - 1, p.x + 0.5, p.y + 0.5, p.k, 'b', left, 5, 1);
      }
      if (state.arcSeen.size > 3000) state.arcSeen.clear();
      // Your pieces in danger, and the king.
      const threats = [];
      const [vw, vh] = renderer.size();
      const [x0, y0] = cam.toWorld(0, 0);
      const [x1, y1] = cam.toWorld(vw, vh);
      const king = w.pieces.get(g.kid);
      const danger = new Set();
      for (const atk of w.boss?.atk ?? []) for (const pos of attackSquares(w, atk)) danger.add(pos);
      let kingThreat = false;
      if (king && active(king)) kingThreat = attackedBy(w, king.x, king.y, 1) || danger.has(idx(king.x, king.y));
      if (cam.scale > 9) {
        for (const p of w.pieces.values()) {
          if (p.s !== 'w' || !active(p) || p.x < x0 - 1 || p.x > x1 || p.y < y0 - 1 || p.y > y1) continue;
          if (attackedBy(w, p.x, p.y, 1)) threats.push([p.x, p.y, mine(p)]);
        }
      }
      f.threats = threats;
      if (threats.some((th) => th[2])) tip('red', 'Red: about to be taken');
      if (kingThreat && !state.kingThreat && g.ph === 'rts') {
        sfx.check();
        ui.banner('Check', 'Your king is in danger', 'bad');
      }
      state.kingThreat = kingThreat;
      if (kingThreat && king) f.check = [king.x, king.y];
      // Arrows to what you can't see: the king in danger, the last few enemies of a wave.
      const arrows = [];
      if (king && kingThreat) arrows.push([king.x, king.y, '#ff3b30', 'k']);
      if (view.waveLeft && view.waveLeft <= 6) for (const p of w.pieces.values()) if (p.s === 'b' && p.w === g.wv.n) arrows.push([p.x, p.y, '#e2382c', null]);
      f.arrows = arrows;
      // Selection marks.
      const selSquares = [];
      for (const id of state.sel) {
        const p = w.pieces.get(id);
        if (p && mine(p)) selSquares.push([p.x, p.y]);
        else state.sel.delete(id);
      }
      f.selSquares = selSquares;
      if (state.sel.size === 1) {
        const p = w.pieces.get([...state.sel][0]);
        if (p) f.legal = movesOf(w, p).map((m) => ({ ...m, danger: danger.has(idx(m.x, m.y)) || (m.o >= 0 && attackedBy(w, m.x, m.y, 1, p.id)) }));
      }
      const orders = [];
      for (const [id, [ox, oy, at]] of state.orders) {
        const p = w.pieces.get(id);
        if (!p || (!(p.st & C.ST_ORDER) && performance.now() - at > 900)) {
          state.orders.delete(id);
          continue;
        }
        if (state.sel.has(id)) orders.push([p.x, p.y, ox, oy]);
      }
      f.orders = orders;
      if (state.inspect) {
        const p = w.pieces.get(state.inspect.id);
        if (!p || performance.now() > state.inspect.until) state.inspect = null;
        else f.inspect = attacksOf(w, p).map((s) => [s.x, s.y]);
      }
      if (state.flag) f.flag = state.flag;
      f.box = state.box;
      f.hover = state.hover;
      if (state.drag) {
        const p = w.pieces.get(state.drag.id);
        if (p) f.dragging = { ...state.drag, k: p.k, color: 'w' };
      }
      drawMinimap(view);
      // Tell friends where you're looking (the minimap shows it).
      if (!solo() && (!state.presAt || now - state.presAt > 0.5)) {
        state.presAt = now;
        try {
          state.room.setPresence({ cx: Math.round(cam.cx * 10) / 10, cy: Math.round(cam.cy * 10) / 10 });
        } catch {}
      }
    }
    try {
      renderer.draw(f);
      state.drawn = (state.drawn ?? 0) + 1;
    } catch (err) {
      state.drawErr = String(err && err.stack || err);
      console.error(err);
    }
  }

  /** The awakening, timed to the host's clock: sounds, banners and the camera pulling back. */
  function cinematic(view, now) {
    const { g, t } = view;
    const aw = g.aw;
    if (!aw || typeof aw.t0 !== 'number') return;
    const c = t - aw.t0;
    if (c < 0 || c > C.CINEMATIC + 1) {
      if (!state.camInit && c > C.CINEMATIC) {
        state.camInit = true;
        frameWar(true);
      }
      state.holdChess = false;
      return;
    }
    state.holdChess = c < 7.9;
    const mark = (key, at, fn) => {
      if (c >= at && !state.cineMarks.has(key)) {
        state.cineMarks.add(key);
        if (c - at < 1.5) fn();
      }
    };
    mark('beat1', 0.1, () => sfx.heartbeat());
    mark('beat2', 1.0, () => sfx.heartbeat());
    mark('lift', 1.3, () => {
      sfx.rumble();
      fx.shake(0.3);
    });
    mark('grow', 3.0, () => {
      sfx.rumble();
      fx.shake(0.4);
    });
    mark('roar', 8.0, () => {
      sfx.roar();
      fx.shake(0.9);
      ui.banner('The Endgame', 'has awakened', 'bad');
      setMusic('calm');
    });
    mark('defend', 9.6, () => ui.banner('Defend your king', 'Ten waves are coming'));
    // Camera: hold on the board; pull back to see the field tear open; push in on the dragon as it assembles; then
    // settle over your army for the first break.
    const [w, hgt] = renderer.size();
    const ez = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
    const chess = [C.KEEP_X + 4, C.KEEP_Y + 4, Math.min(w, hgt) / 8];
    const wide = [C.BOSS_X + 0.5, (C.BOSS_Y + C.KEEP_Y + 8) / 2, Math.max(8, Math.min(w / 34, hgt / 44))];
    const close = [C.BOSS_X + 0.5, C.BOSS_Y + 0.5, Math.max(10, Math.min(w, hgt) / 19)];
    const mix = (a, b2, k) => a.map((v, i) => v + (b2[i] - v) * ez(k));
    let target = chess;
    if (c >= 2.8 && c < 5.2) target = mix(chess, wide, (c - 2.8) / 2.2);
    else if (c >= 5.2 && c < 9.3) target = mix(wide, close, (c - 5.2) / 1.8);
    else if (c >= 9.3) {
      const king = view.world?.pieces.get(g.kid);
      const roomy = app.dataset.wide === '1' && window.innerHeight >= 520;
      const army = [king ? king.x + 0.5 : C.KEEP_X + 4, king ? king.y - 5 : C.KEEP_Y - 1, Math.max(roomy ? 14 : 22, Math.min(w, hgt) / (roomy ? 22 : 12))];
      target = mix(close, army, (c - 9.3) / 1.2);
    }
    [cam.tcx, cam.tcy, cam.tscale] = target;
    if (c > C.CINEMATIC + 0.4 && !state.camInit) state.camInit = true;
  }

  requestAnimationFrame(frame);

  // Debug jumps when the page runs on its own (never on Onceworlds): ?jump=awaken|rts|wave5|boss
  const jump = params.get('jump');
  if (!ow && jump) {
    const { createAutopilot } = await import('./autopilot.js');
    state.room.startMatch();
    await new Promise((r) => setTimeout(r, 80));
    const sim = state.net.sim;
    if (!sim) return;
    const pilot = createAutopilot(sim, 0, { skill: 0.9 });
    const until = {
      awaken: () => sim.phase === 'awaken',
      rts: () => sim.phase === 'rts',
      wave5: () => sim.wave.n >= 5 && sim.wave.st === 'fight' && sim.t > sim.wave.t0 + 40,
      boss: () => sim.wave.st === 'boss' && sim.t > sim.wave.t0 + 25,
    }[jump] ?? (() => true);
    sim.paused = false;
    let n = 0;
    while (!until() && n < 120000) {
      for (let i = 0; i < 3000 && !until(); i++, n++) {
        pilot();
        sim.step(0.05);
      }
      await new Promise((r) => setTimeout(r, 0));
    }
    state.evInit = false;
    window.__jumped = true;
    if (jump === 'boss') {
      state.camInit = true;
      const b = sim.world.boss;
      const [w, hgt] = renderer.size();
      cam.tcx = b.x + 0.5;
      cam.tcy = b.y + 0.5;
      cam.tscale = Math.min(w, hgt) / 17;
      cam.snap();
    } else state.camInit = jump === 'awaken';
  }
}
