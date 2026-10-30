// Boot, layout, input, camera and everything that turns the host's snapshots into sound and motion.

import * as C from './config.js';
import { legalMoves, inCheck, kingSquare, colorOf, typeOf, parseBoard, findMove, initialPosition } from './chess.js';
import { movesOf, attacksOf, attackedBy, active, idx } from './rules.js';
import { attackSquares, GROUP_LABEL, ATTACK_NAME, integrity, kingExposed } from './boss.js';
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
else boot().catch((err) => console.error(err));

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
    sel: 0, // the selected piece (battle)
    chessSel: -1,
    hover: null,
    drag: null,
    lastSeq: -1,
    evInit: false,
    evMid: '',
    chessIds: null,
    chessBoardKey: '',
    cineMarks: new Set(),
    kingThreat: false,
    save: null,
    saveLoaded: false,
    tips: {},
    arcSeen: new Set(),
    camInit: false,
    keys: new Set(),
    resignArmed: 0,
    endArmed: 0,
    closed: false,
    holdChess: false,
    lastChess: null,
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
      state.save = run && run.v === 2 && run.ck ? run : null;
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
    state.net = createNet(ow, room, { loadRun: loadSave, saveRun, onMatch: () => {}, onRoster: () => {}, onState: () => {}, onSimStart: () => {} });
    room.on('close', (reason) => {
      state.closed = true;
      const msg = { kicked: 'You were removed', replaced: 'Playing in another tab', disconnected: 'Disconnected' }[reason] ?? 'Disconnected';
      ui.modal(`close-${reason}`, () =>
        h('div', { class: 'card result' }, h('div', { class: 'r-head lost' }, h('div', { class: 'r-title' }, msg)), h('div', { class: 'r-foot' }, h('button', { class: 'btn green big', onclick: rejoin }, reason === 'replaced' ? 'Play here' : 'Rejoin'))),
      );
    });
    loadSave();
  }
  async function rejoin() {
    state.closed = false;
    ui.modal(null);
    attach(await joinRoom());
  }

  const soloHost = () => state.net?.sim && state.room?.isHost && state.net.sim.players() === 1;
  ow?.on?.('pause', () => {
    duck(true);
    if (soloHost()) state.net.send({ t: 'pause', on: true });
  });
  ow?.on?.('resume', () => {
    duck(false);
    if (soloHost()) state.net.send({ t: 'pause', on: false });
  });
  document.addEventListener('visibilitychange', () => {
    if (state.net && soloHost()) state.net.send({ t: 'pause', on: document.hidden });
  });

  // ---------------------------------------------------------------- layout and camera

  const app = document.getElementById('app');
  const box = document.getElementById('boardBox');
  const pixelRatio = () => Math.min(ow?.settings?.pixelRatio?.(2) ?? window.devicePixelRatio ?? 1, 2.5);
  function layout() {
    const Wd = window.innerWidth;
    const Hd = window.innerHeight;
    const wide = Wd >= 820 && Wd / Hd > 1.15;
    app.dataset.wide = wide ? '1' : '0';
    const barH = Wd < 500 ? 46 : 52;
    const war = state.phase === 'rts';
    let size;
    if (wide) size = Math.min(Wd - (Hd < 520 ? 270 : 360) - 56, Hd - barH * 2 - (Hd < 520 ? 16 : 40));
    else size = Math.min(Wd - 12, Hd - barH * 2 - (war ? 120 : 200));
    app.style.setProperty('--board', `${Math.max(200, Math.floor(size))}px`);
    app.style.setProperty('--bar', `${barH}px`);
    // The platform's menu sits in the top-left corner: keep the top bar's name clear of it.
    const menu = (ow?.ui?.reserved ?? []).find?.((r) => r.kind === 'menu');
    const top = document.getElementById('barTop').getBoundingClientRect();
    let pad = 0;
    if (menu) {
      if (menu.y < top.bottom && menu.y + menu.h > top.top && menu.x < top.left + 160) pad = Math.max(0, menu.x + menu.w - top.left + 8);
    } else if (ow && top.top < 70 && top.left < 150) pad = 150 - top.left;
    document.getElementById('barTop').style.paddingLeft = pad ? `${pad}px` : '';
    const r = box.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) renderer.resize(r.width, r.height, pixelRatio());
  }
  window.addEventListener('resize', layout);
  ow?.on?.('reserved', layout);
  new ResizeObserver(() => {
    const r = box.getBoundingClientRect();
    renderer.resize(r.width, r.height, pixelRatio());
    if (state.phase === 'lobby' || state.phase === 'chess') frameChess(true);
    else if (state.camInit && !state.userCam) frameBoard(false);
  }).observe(box);

  function frameChess(snap) {
    const [w, hgt] = renderer.size();
    cam.tcx = C.KEEP_X + 4;
    cam.tcy = C.KEEP_Y + 4;
    cam.tscale = Math.min(w, hgt) / 8;
    if (snap) cam.snap();
  }
  /** The whole battlefield on screen. */
  function frameBoard(snap) {
    const [w, hgt] = renderer.size();
    // A little headroom above the board: the dragon's head and wings rise over its top rank.
    cam.tcx = C.W / 2;
    cam.tcy = C.H / 2 - 0.7;
    cam.tscale = Math.min(w / (C.W + 0.6), hgt / (C.H + 1.8));
    if (snap) cam.snap();
  }
  const clampCam = () => {
    const [w, hgt] = renderer.size();
    const fit = Math.min(w / (C.W + 0.6), hgt / (C.H + 1.8));
    cam.tscale = Math.max(fit, Math.min(fit * 3, cam.tscale));
    cam.tcx = Math.max(0, Math.min(C.W, cam.tcx));
    cam.tcy = Math.max(-1, Math.min(C.H, cam.tcy));
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
  const mine = (p) => p && p.s === 'w' && mySlot() >= 0 && (p.o === mySlot() || solo());
  const myTurn = () => {
    const g = state.net?.g;
    return !!g && g.ph === 'battle' && g.side === 'w' && mySlot() >= 0 && !(g.done ?? []).includes(mySlot()) && !g.pz;
  };

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

  document.addEventListener('pointerdown', () => startAudio(), { passive: true });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    startAudio();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
    const [px, py] = local(e);
    pointers.set(e.pointerId, { x: px, y: py });
    if (pointers.size === 2 && state.phase === 'rts') {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), scale: cam.tscale, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, cx: cam.tcx, cy: cam.tcy };
      down = null;
      state.drag = null;
      return;
    }
    const [sx, sy] = squareAt(px, py);
    down = { px, py, sx, sy, button: e.button, mode: null, cx: cam.tcx, cy: cam.tcy };
  });
  canvas.addEventListener('pointermove', (e) => {
    const [px, py] = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: px, y: py });
    if (e.pointerType === 'mouse') state.hover = squareAt(px, py);
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      cam.tscale = pinch.scale * (d / Math.max(1, pinch.d));
      clampCam();
      cam.tcx = pinch.cx - ((a.x + b.x) / 2 - pinch.mx) / cam.tscale;
      cam.tcy = pinch.cy - ((a.y + b.y) / 2 - pinch.my) / cam.tscale;
      clampCam();
      cam.snap();
      state.userCam = true;
      return;
    }
    if (!down) return;
    if (!down.mode && Math.hypot(px - down.px, py - down.py) > 7) {
      const p = pieceAt(currentWorld(), down.sx, down.sy);
      if (state.phase === 'chess') down.mode = p && canMoveChess(p) ? 'drag' : 'none';
      else if (state.phase === 'rts') down.mode = down.button === 0 && p && canMovePiece(p) ? 'drag' : 'pan';
      else down.mode = 'none';
      if (down.mode === 'drag') {
        if (state.phase === 'chess') selectChess(p.sq);
        else select(p.id);
      }
    }
    if (down.mode === 'pan') {
      cam.tcx = down.cx - (px - down.px) / cam.scale;
      cam.tcy = down.cy - (py - down.py) / cam.scale;
      clampCam();
      cam.snap();
      state.userCam = true;
    } else if (down.mode === 'drag') {
      const p = pieceAt(currentWorld(), down.sx, down.sy);
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
    const d = down;
    down = null;
    state.drag = null;
    if (e.type === 'pointercancel') return;
    const [sx, sy] = squareAt(px, py);
    if (d.mode === 'drag') {
      if (state.phase === 'chess') {
        const to = sqOfWorld(sx, sy);
        if (to >= 0 && to !== state.chessSel) tryChessMove(state.chessSel, to);
      } else if (!(sx === d.sx && sy === d.sy)) tryMove(sx, sy, true);
      return;
    }
    if (d.mode === 'pan' || d.mode === 'none') return;
    if (state.phase === 'chess') clickChess(sx, sy);
    else if (state.phase === 'rts') {
      if (d.button === 2) state.sel = 0;
      else clickBattle(sx, sy);
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
    const [w, hgt] = renderer.size();
    cam.tcx = wx - (px - w / 2) / cam.tscale;
    cam.tcy = wy - (py - hgt / 2) / cam.tscale;
    clampCam();
    cam.snap();
    state.userCam = true;
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const k = e.key.toLowerCase();
    state.keys.add(k);
    if (state.phase !== 'rts') return;
    if ((k === ' ' || k === 'enter') && !e.repeat) {
      e.preventDefault();
      endTurn();
    } else if ((k === 'z' || k === 'backspace') && !e.repeat) {
      e.preventDefault();
      undo();
    } else if (k === 'escape') state.sel = 0;
    else if (k === 'k' && !e.repeat) centerKing();
    else if (k === 'f' && !e.repeat) {
      state.userCam = false;
      frameBoard(false);
    } else if ((k === '=' || k === '+') && !e.repeat) {
      cam.tscale *= 1.25;
      clampCam();
      state.userCam = true;
    } else if (k === '-' && !e.repeat) {
      cam.tscale *= 0.8;
      clampCam();
    }
  });
  window.addEventListener('keyup', (e) => state.keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => state.keys.clear());

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
    if (state.chessSel >= 0 && sq !== state.chessSel && legalMoves(cd.pos).some((m) => m.from === state.chessSel && m.to === sq)) {
      tryChessMove(state.chessSel, sq);
      return;
    }
    const p = [...chessWorld(cd).pieces.values()].find((q) => q.sq === sq);
    state.chessSel = p && canMoveChess(p) && state.chessSel !== sq ? sq : -1;
    if (state.chessSel >= 0) sfx.select();
  }
  function tryChessMove(from, to) {
    const m = findMove(chessData().pos, from, to, 'q');
    state.chessSel = -1;
    if (!m) {
      sfx.illegal();
      return;
    }
    state.net.send({ t: 'cm', from, to, promo: 'q' });
  }

  // -------- the battle

  function canMovePiece(p) {
    return myTurn() && mine(p) && active(p) && !(p.st & C.ST_MOVED);
  }
  function select(id) {
    state.sel = id;
    sfx.select();
    tip('select', 'Every piece can move once a turn');
  }
  function clickBattle(x, y) {
    const w = state.net?.world;
    if (!w) return;
    const p = pieceAt(w, x, y);
    if (state.sel && tryMove(x, y, false)) return;
    if (p && canMovePiece(p)) {
      if (state.sel === p.id) state.sel = 0;
      else select(p.id);
      return;
    }
    if (p && mine(p) && p.st & C.ST_MOVED && myTurn()) {
      ui.toast('Already moved this turn');
      sfx.illegal();
    }
    state.sel = 0;
  }
  /** Move the selected piece to (x, y) if that's one of its moves. */
  function tryMove(x, y, fromDrag) {
    const w = state.net?.world;
    const p = w?.pieces.get(state.sel);
    if (!p || !canMovePiece(p)) return false;
    const m = movesOf(w, p).find((mv) => mv.x === x && mv.y === y);
    if (!m) {
      if (fromDrag) sfx.illegal();
      return false;
    }
    state.net.send({ t: 'mv', id: p.id, x, y });
    if (m.o > 0) sfx.capture();
    else if (m.o < 0) sfx.hit();
    else sfx.move();
    state.sel = 0;
    // Select the next of your pieces that still can move? No: let the player pick. Note the first move once.
    tip('end', 'Space or End turn when you are done');
    return true;
  }
  function endTurn() {
    if (!myTurn()) return;
    const w = state.net.world;
    const king = w?.pieces.get(state.net.g.kid);
    const now = performance.now();
    if (king && king.o === mySlot() && attackedBy(w, king.x, king.y, 1) && now - state.endArmed > 2500) {
      // Ending in check needs a second press.
      state.endArmed = now;
      ui.toast('Your king is in check · press again to end');
      sfx.check();
      return;
    }
    state.endArmed = 0;
    state.sel = 0;
    state.net.send({ t: 'end', on: true });
    sfx.ui();
  }
  function undo() {
    if (!myTurn()) return;
    if (state.net.send({ t: 'undo' }) !== false) sfx.ui();
    state.sel = 0;
  }
  function centerKing() {
    const king = state.net?.world?.pieces.get(state.net.g?.kid);
    if (!king) return;
    cam.tcx = king.x + 0.5;
    cam.tcy = king.y + 0.5;
    cam.tscale = Math.max(cam.tscale, renderer.size()[1] / 12);
    clampCam();
    state.userCam = true;
  }

  // ---------------------------------------------------------------- the side panel

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
    ui.set(r.wait, watching ? 'Watching · you join on White\'s next turn' : isHost ? (waitingFor.length ? `Waiting for ${waitingFor.slice(0, 2).join(', ')}` : '') : 'Waiting for the host');
    r.cont.hidden = !(isHost && state.save && state.save.ck && !watching);
    if (!r.cont.hidden) ui.set(r.cont, `Continue · Turn ${state.save.turn ?? 1}`);
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
        onEnd: endTurn,
        onUndo: undo,
        onEndAll: () => {
          state.net.send({ t: 'endall' });
          sfx.ui();
        },
        onPause: () => {
          state.net.send({ t: 'pause', on: !state.net.g?.pz });
          sfx.ui();
        },
        onKing: centerKing,
      }),
    );
    if (fresh) layout();
    const { g, world, t } = view;
    const boss = world?.boss;
    const mine0 = world ? [...world.pieces.values()].filter((p) => mine(p) && active(p)) : [];
    const moved = mine0.filter((p) => p.st & C.ST_MOVED).length;
    const iDone = (g.done ?? []).includes(mySlot());
    if (g.ph === 'awaken') {
      ui.set(r.turnT, 'The board awakens');
      ui.set(r.turnS, '');
      ui.set(r.turnR, '');
    } else if (g.ph === 'won') {
      ui.set(r.turnT, 'Checkmate');
      ui.set(r.turnS, `in ${g.res?.turn ?? g.turn} turns`);
      ui.set(r.turnR, '');
    } else if (g.side === 'b') {
      ui.set(r.turnT, 'Black is moving');
      ui.set(r.turnS, `Turn ${g.turn}`);
      ui.set(r.turnR, '');
    } else if (mySlot() < 0) {
      ui.set(r.turnT, 'Watching');
      ui.set(r.turnS, `Turn ${g.turn}`);
      ui.set(r.turnR, '');
    } else {
      ui.set(r.turnT, iDone ? 'Waiting for friends' : 'Your move');
      ui.set(r.turnS, `Turn ${g.turn}`);
      ui.set(r.turnR, `${moved}/${mine0.length}`);
    }
    const canAct = myTurn();
    r.end.disabled = !canAct;
    ui.set(r.end, iDone && g.side === 'w' && g.ph === 'battle' ? 'Waiting…' : 'End turn');
    r.end.classList.toggle('glow', canAct && moved >= Math.min(3, mine0.length));
    r.end.classList.toggle('warn', canAct && state.endArmed > 0 && performance.now() - state.endArmed < 2500);
    r.undo.disabled = !canAct || !(g.un ?? []).includes(mySlot());
    r.undo.hidden = mySlot() < 0;
    r.endAll.hidden = !(state.room.isHost && !solo() && g.side === 'w' && g.ph === 'battle');
    r.pause.hidden = !solo() || !state.room.isHost;
    ui.set(r.pause, g.pz ? 'Resume' : 'Pause');
    // The dragon.
    if (boss) {
      const pct = boss.dead ? 0 : Math.round(integrity(boss) * 100);
      ui.set(r.bossP, boss.dead ? '' : `${pct}%`);
      r.hp.style.width = `${pct}%`;
      r.hp.parentElement.classList.toggle('exposed', kingExposed(boss));
      ui.set(r.bossS, boss.dead ? 'Checkmated' : boss.ph >= 3 ? 'Phase 3 · its king is exposed' : boss.ph === 2 ? 'Phase 2' : 'Phase 1 · break its heart guard');
      const next = (boss.atk ?? [])[0];
      ui.set(r.next, next ? `${ATTACK_NAME[next.k] ?? 'Attack'} lands when Black moves` : '');
    }
    // Selection.
    const p = world?.pieces.get(state.sel);
    const key = p ? p.id + p.k : '';
    if (r.selIcons.dataset.key !== key) {
      r.selIcons.dataset.key = key;
      r.selIcons.replaceChildren(...(p ? selectionIcons([p.k]) : []));
    }
    ui.set(r.selName, p ? `${C.NAMES[p.k]}${p.id === g.kid ? ` · armour ${p.hp}` : ''}` : canAct ? 'Pick a piece' : '');
    // The team (twice a second).
    if (!state.teamAt || performance.now() - state.teamAt > 500) {
      state.teamAt = performance.now();
      const counts = [0, 0, 0, 0];
      if (world) for (const q of world.pieces.values()) if (q.s === 'w' && q.o >= 0 && q.o < 4) counts[q.o]++;
      const names = slotNames();
      r.team.replaceChildren(...(g.sl ?? [0]).map((s) => teamRow(names[s] ?? `Player ${s + 1}`, s, counts[s], (g.done ?? []).includes(s), s === mySlot())));
    }
  }

  function slotNames() {
    const out = {};
    for (const [id, s] of Object.entries(state.net?.slots ?? {})) out[s] = state.room.players.get(id)?.name ?? (id === state.room.me.id ? state.room.me.name : 'Player');
    return out;
  }

  // ---------------------------------------------------------------- bars

  function updateBars(view) {
    const { g, t } = view;
    const room = state.room;
    const { top, bot } = ui;
    const me = room.me;
    if (state.phase === 'rts' && !view.hold) {
      ui.setAvatar(top, 'dragon', ui.dragonAvatar);
      ui.set(top.name, 'The Endgame');
      ui.set(top.rating, '');
      const boss = view.world?.boss;
      if (top.extra.dataset.key !== 'hp') {
        top.extra.dataset.key = 'hp';
        state.hpBar = h('div', { class: 'hp' }, h('i'));
        top.extra.replaceChildren(state.hpBar);
      }
      if (boss) {
        state.hpBar.firstChild.style.width = `${boss.dead ? 0 : integrity(boss) * 100}%`;
        state.hpBar.classList.toggle('exposed', kingExposed(boss));
      }
      // The clocks say whose turn it is.
      ui.set(top.clockT, g.ph === 'battle' ? (g.side === 'b' ? 'Black' : '—') : '—');
      top.clock.classList.toggle('run', g.ph === 'battle' && g.side === 'b');
      top.clock.classList.remove('low');
      ui.setAvatar(bot, `me${avatarCache.get(me.id) ?? ''}`, () => avatarFor(me.id, me.name));
      ui.set(bot.name, me.name || 'You');
      const slot = mySlot();
      ui.set(bot.rating, slot >= 0 && !solo() ? C.SLOT_NAMES[slot] : '');
      bot.rating.style.color = slot >= 0 && !solo() ? C.SLOT_COLORS[slot] : '';
      const caps = Array.isArray(g.cap) && slot >= 0 ? g.cap[slot] ?? 0 : 0;
      const ek = `c${caps}`;
      if (bot.extra.dataset.key !== ek) {
        bot.extra.dataset.key = ek;
        bot.extra.replaceChildren(h('span', { class: 'mat' }, caps ? `${caps} taken` : ''));
      }
      ui.set(bot.clockT, g.ph === 'battle' || g.ph === 'won' ? `Turn ${g.res?.turn ?? g.turn ?? 1}` : runClock(t));
      bot.clock.classList.toggle('run', g.ph === 'battle' && g.side === 'w');
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
        // A white move (the opening's moves carry check and castle flags).
        if (state.phase === 'chess') {
          const [, , cap, check, castled] = a;
          if (castled) sfx.castle();
          else if (cap) sfx.capture();
          else sfx.move();
          if (check) sfx.check();
        } else if (!a[2]) sfx.move();
        break;
      }
      case 'b': {
        const [, to, cap] = a;
        if (!cap) sfx.move();
        const [x, y] = pos(to);
        fx.dust(x, y + 0.3, 'rgba(40,30,25,0.35)', 4);
        break;
      }
      case 'u':
        sfx.ui();
        break;
      case 'A':
        state.cineMarks.clear();
        award('awakening');
        break;
      case 'x': {
        const [p, k, side] = a;
        const [x, y] = pos(p);
        if (side === 'w') {
          fx.shards(x, y, '#f4f4f2', 12, 1);
          fx.debris(x, y, k, 'w', 0.8, 0.8);
          sfx.lost();
        } else {
          fx.shards(x, y, '#3b3937', 12, 1);
          fx.ring(x, y, 'rgba(255,255,255,0.6)', 0.9, 0.3, 0.08);
          sfx.capture();
        }
        break;
      }
      case 'k': {
        const [p, , left] = a;
        const [x, y] = pos(p);
        fx.sparks(x, y, '#ffd36b', 12);
        fx.text(x, y - 0.5, left === 1 ? 'Last armour' : 'Armour', '#ffd36b', 0.4, 0.8);
        sfx.hit();
        fx.shake(0.15);
        break;
      }
      case 'C':
        ui.banner('Check', a[0] === 1 ? 'One hit left on your king' : 'Your king took a hit', 'bad');
        sfx.check();
        break;
      case 'h': {
        const [i, dmg] = a;
        renderer.partHit(i, now);
        const sq = partSquare(world, i);
        if (sq) {
          fx.sparks(sq[0], sq[1], '#ff9b6b', 8);
          fx.text(sq[0] + (Math.random() - 0.5) * 0.4, sq[1] - 0.5, `-${dmg}`, '#ffcf6b', 0.55, 0.9);
        }
        sfx.hit();
        fx.shake(0.06);
        break;
      }
      case 'B': {
        const [i] = a;
        const part = world?.boss?.parts[i];
        const sq = partSquare(world, i);
        if (part && sq) {
          fx.debris(sq[0], sq[1], part.k, 'd', 1.5, 1.1);
          fx.shards(sq[0], sq[1], '#2e2c2b', 18, 1.4);
          fx.ring(sq[0], sq[1], 'rgba(255,90,60,0.8)', 1.6, 0.5, 0.12);
        }
        sfx.breakPart();
        fx.shake(0.3);
        break;
      }
      case 'G':
        if (a[0] !== 'king') ui.toast(`${GROUP_LABEL[a[0]] ?? 'Part'} broken`);
        break;
      case 'y': {
        const [i, p] = a;
        renderer.partLunge(i, p % C.W, Math.floor(p / C.W), now);
        break;
      }
      case 'a': {
        const [kind, id, , data] = a;
        if (!id) {
          // Announced: it lands as Black's next turn begins.
          ui.banner(ATTACK_NAME[kind] ?? 'Attack', kind === 'decree' ? 'Move your king, block, or take the ghost' : 'Get out of the red', 'bad');
          sfx.warn();
          state.flapUntil = now + 1;
        } else attackFx(kind, data);
        break;
      }
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
      case 'W':
        if (a[0] === 1) {
          setMusic('war');
          tip('turn', 'Your move: every piece can move once');
        } else sfx.start();
        break;
      case 'T':
        sfx.tick(8);
        break;
      case 'S':
        sfx.summon();
        state.flapUntil = now + 1.2;
        break;
      case 'H':
        ui.toast(`Reinforcements: ${a[0]}`);
        sfx.promote();
        break;
      case 'Q': {
        const [ph] = a;
        const b = world?.boss;
        if (ph === 2) ui.banner('Phase 2', 'Check attacks begin', 'bad');
        else if (ph === 3) {
          ui.banner('The king is exposed', 'Checkmate it', 'bad');
          sfx.shatter();
          if (b) {
            fx.shards(b.x + 0.5, b.y + 0.5, 'rgba(230,80,80,0.9)', 26, 1.6);
            fx.ring(b.x + 0.5, b.y + 0.5, 'rgba(255,120,120,0.9)', 2.4, 0.5, 0.2);
          }
        }
        sfx.roar();
        fx.shake(0.45);
        if (b) fx.ring(b.x + 0.5, b.y + 0.5, 'rgba(220,40,30,0.75)', 9, 1.1, 0.4);
        setMusic('boss');
        break;
      }
      case 'M': {
        const boss = world?.boss;
        if (boss) {
          for (const part of boss.parts) {
            if (part.g === 'king') continue;
            const sq = partSquare(world, part.i) ?? [boss.x + part.dx + 0.5, boss.y + part.dy + 0.5];
            fx.debris(sq[0], sq[1], part.k, 'd', 2, 1.1);
          }
        }
        fx.shake(1);
        sfx.victory();
        setMusic('calm');
        ui.banner('Checkmate', 'The Endgame has fallen', 'good');
        award('checkmate');
        if (g?.diff === 'hard') award('grandmaster');
        if (!(g?.st?.re > 0)) award('royal-escort');
        try {
          ow?.leaderboards?.submit?.('fewest-turns', g?.res?.turn ?? 99, { lowerIsBetter: true });
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
      case 'r':
        renderer.resetTweens();
        fx.clear();
        state.sel = 0;
        ui.banner('Checkpoint', 'Try again', 'good');
        setMusic('war');
        break;
      default:
        break;
    }
  }

  function attackFx(kind, data) {
    let d = null;
    try {
      d = typeof data === 'string' ? JSON.parse(data) : null;
    } catch {}
    if (kind === 'rake' && Array.isArray(d)) {
      for (const [axis, line, lo = 0, hi = axis === 0 ? C.W - 1 : C.H - 1] of d) {
        if (axis === 0) fx.sweep(hi + 1, line + 0.5, lo, line + 0.5);
        else fx.sweep(line + 0.5, lo, line + 0.5, hi + 1);
      }
      sfx.rake();
      fx.shake(0.45);
    } else if (kind === 'rain' && Array.isArray(d)) {
      for (const [cx, cy] of d) {
        fx.beam(cx - 2, cy - 2, cx + 3, cy + 3);
        fx.beam(cx + 3, cy - 2, cx - 2, cy + 3);
        fx.ring(cx + 0.5, cy + 0.5, 'rgba(255,120,90,0.9)', 1.8, 0.4, 0.15);
      }
      sfx.zap();
      fx.shake(0.25);
    } else if ((kind === 'fork' || kind === 'sting') && Array.isArray(d)) {
      const [cx, cy] = d;
      fx.ring(cx + 0.5, cy + 0.5, 'rgba(255,90,60,0.9)', kind === 'fork' ? 2.6 : 2, 0.5, 0.3);
      fx.shards(cx + 0.5, cy + 0.5, '#ff7a4a', 18, 1.6);
      sfx.boom(1);
      fx.shake(0.4);
    } else if (kind === 'decree' && Array.isArray(d)) {
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
      for (const [gx, gy, dd] of d) {
        const [dx, dy] = dirs[dd] ?? [0, 0];
        fx.beam(gx + 0.5, gy + 0.5, gx + 0.5 + dx * 8, gy + 0.5 + dy * 8, 'rgba(170,110,255,0.95)', 0.45, 0.35);
      }
      sfx.zap();
      fx.shake(0.3);
    }
  }

  // ---------------------------------------------------------------- results

  function results(view) {
    const { g } = view;
    const room = state.room;
    if (g.ph === 'won') {
      ui.modal(`won${g.mid}`, () => {
        const names = slotNames();
        const rows = (g.sl ?? [0]).map((s) =>
          h('div', { class: 'r-row' }, h('i', { class: 'dot', style: `background:${C.SLOT_COLORS[s]}` }), h('span', {}, names[s] ?? 'Player'), h('span', { class: 'muted' }, `${g.cap?.[s] ?? 0} taken · ${g.dmg?.[s] ?? 0} damage`)),
        );
        return h(
          'div',
          { class: 'card result' },
          h('div', { class: 'r-head won' }, h('span', { class: 'r-icon', html: pieceSvg('k', 'w', 44) }), h('div', {}, h('div', { class: 'r-title' }, 'You Won!'), h('div', { class: 'r-sub' }, 'by Checkmate'))),
          h('div', { class: 'r-stats' }, stat('Turns', String(g.res?.turn ?? g.turn)), stat('Time', runClock(g.res?.t ?? 0)), stat('Retries', String(g.st?.re ?? 0)), stat('Difficulty', C.DIFFICULTY[g.diff]?.label ?? 'Normal')),
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
          h('div', { class: 'r-head lost' }, h('span', { class: 'r-icon', html: pieceSvg('k', 'b', 44) }), h('div', {}, h('div', { class: 'r-title' }, chess ? 'Noir Won' : 'Checkmated'), h('div', { class: 'r-sub' }, chess ? (reason === 'resign' ? 'by resignation' : 'by checkmate') : 'Your king has fallen'))),
          h('div', { class: 'r-foot' },
            mySlot() >= 0 ? h('button', { class: 'btn green big', onclick: () => state.net.send({ t: 'retry' }) }, chess ? 'Rematch' : g.ck ? `Retry from turn ${g.ck.turn}` : 'Retry') : null,
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
      state.sel = 0;
      state.chessSel = -1;
      state.drag = null;
      layout();
      if (state.phase === 'chess' || state.phase === 'lobby') {
        frameChess(true);
        setMusic('none');
        renderer.resetTweens();
        state.chessIds = null;
        state.camInit = false;
        state.userCam = false;
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
      else if (g) buildWar(view);
      updateBars({ g: g ?? {}, t, world: view.world, hold: state.holdChess && !!state.lastChess });
      if (state.closed) {
        // The room closed: its card (and its Rejoin) stays until the player acts.
      } else if (g && state.phase !== 'lobby') results(view);
      else ui.modal(null);
    } catch (err) {
      console.error(err);
    }

    // Keyboard panning.
    if (state.phase === 'rts' && state.keys.size) {
      const sp = (500 / cam.scale) * dt;
      let moved = false;
      if (state.keys.has('w') || state.keys.has('arrowup')) (cam.tcy -= sp), (moved = true);
      if (state.keys.has('s') || state.keys.has('arrowdown')) (cam.tcy += sp), (moved = true);
      if (state.keys.has('a') || state.keys.has('arrowleft')) (cam.tcx -= sp), (moved = true);
      if (state.keys.has('d') || state.keys.has('arrowright')) (cam.tcx += sp), (moved = true);
      if (moved) {
        clampCam();
        state.userCam = true;
      }
    }

    // Draw.
    const f = { now, t, mySlot: mySlot(), solo: solo(), sel: new Set(state.sel ? [state.sel] : []) };
    if (state.phase === 'lobby' || state.phase === 'chess') {
      const cd = state.phase === 'chess' ? chessData() : { pos: initialPosition(), own: new Array(64).fill(0), last: null };
      f.world = chessWorld(cd);
      f.chessOnly = true;
      frameChess(false);
      if (cd.last) f.last = cd.last.map((sq) => [chessToWorld(sq).x, chessToWorld(sq).y]);
      if (state.phase === 'chess' && inCheck(cd.pos)) {
        const k = chessToWorld(kingSquare(cd.pos.b, cd.pos.t));
        f.check = [k.x, k.y];
      }
      if (state.chessSel >= 0) {
        const { x, y } = chessToWorld(state.chessSel);
        f.selSquares = [[x, y]];
        f.legal = legalMoves(cd.pos).filter((m) => m.from === state.chessSel).map((m) => ({ ...chessToWorld(m.to), o: m.c !== '.' ? 1 : 0 }));
      }
      if (state.drag) f.dragging = { ...state.drag, color: 'w' };
    } else if (view.world) {
      const w = view.world;
      f.world = w;
      f.awake = g.aw;
      f.attacks = w.boss?.atk ?? [];
      cinematic(view, now);
      // The dragon's posture: wings raised for a summon or an announcement.
      if (w.boss) w.boss._flap = state.flapUntil && now < state.flapUntil ? 0.25 * Math.sin(((state.flapUntil - now) / 1.2) * Math.PI) : 0;
      // Pieces arriving: reinforcements drop in, summoned pawns fly from the dragon.
      for (const p of w.pieces.values()) {
        if (!(p.st & C.ST_AIR) || state.arcSeen.has(p.id)) continue;
        state.arcSeen.add(p.id);
      }
      for (const e of evs) {
        if (e[1] !== 'S' || state.arcSeen.has(`S${e[0]}`)) continue;
        state.arcSeen.add(`S${e[0]}`);
      }
      if (state.arcSeen.size > 3000) state.arcSeen.clear();
      // Your pieces in danger, and the king.
      const danger = new Set();
      for (const atk of w.boss?.atk ?? []) for (const pos of attackSquares(w, atk)) danger.add(pos);
      const threats = [];
      for (const p of w.pieces.values()) {
        if (p.s !== 'w' || !active(p)) continue;
        if (attackedBy(w, p.x, p.y, 1) || danger.has(idx(p.x, p.y))) threats.push([p.x, p.y, mine(p)]);
      }
      f.threats = threats;
      if (g.ph === 'battle' && g.side === 'w' && threats.some((th) => th[2])) tip('red', 'Red: Black can take it next turn');
      const king = w.pieces.get(g.kid);
      const kingThreat = !!king && (attackedBy(w, king.x, king.y, 1) || danger.has(idx(king.x, king.y)));
      if (kingThreat && !state.kingThreat && g.ph === 'battle' && g.side === 'w') {
        sfx.check();
        ui.banner('Check', 'Black can hit your king', 'bad');
      }
      state.kingThreat = kingThreat;
      if (kingThreat && king) f.check = [king.x, king.y];
      f.arrows = kingThreat && king ? [[king.x, king.y, '#ff3b30', 'k']] : [];
      if (g.side === 'w' && Array.isArray(g.lb)) f.lastBlack = g.lb;
      const p = w.pieces.get(state.sel);
      if (p && canMovePiece(p)) {
        f.selSquares = [[p.x, p.y]];
        f.legal = movesOf(w, p).map((m) => ({ ...m, danger: danger.has(idx(m.x, m.y)) || (m.o >= 0 && attackedBy(w, m.x, m.y, 1, p.id)) }));
      } else state.sel = 0;
      f.hover = state.hover;
      if (state.drag) f.dragging = { ...state.drag, color: 'w' };
      // Tell friends where you're looking.
      if (!solo() && (!state.presAt || now - state.presAt > 0.5)) {
        state.presAt = now;
        try {
          state.room.setPresence({ cx: Math.round(cam.cx * 10) / 10, cy: Math.round(cam.cy * 10) / 10 });
        } catch {}
      }
    }
    try {
      renderer.draw(f);
    } catch (err) {
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
        frameBoard(true);
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
    mark('defend', 9.6, () => ui.banner('Destroy its army', 'Checkmate the dragon'));
    // Camera: hold on the board, then pull back over the whole battlefield as it opens and the dragon assembles.
    const [w, hgt] = renderer.size();
    const ez = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
    const chess = [C.KEEP_X + 4, C.KEEP_Y + 4, Math.min(w, hgt) / 8];
    const top = [C.BOSS_X + 0.5, C.BOSS_Y + 2, Math.min(w / 10, hgt / 9)];
    const all = [C.W / 2, C.H / 2 - 0.7, Math.min(w / (C.W + 0.6), hgt / (C.H + 1.8))];
    const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * ez(k));
    let target = chess;
    if (c >= 2.8 && c < 5.4) target = mix(chess, all, (c - 2.8) / 2.2);
    else if (c >= 5.4 && c < 8.8) target = mix(all, top, (c - 5.4) / 1.6);
    else if (c >= 8.8) target = mix(top, all, (c - 8.8) / 1.1);
    [cam.tcx, cam.tcy, cam.tscale] = target;
    if (c > C.CINEMATIC + 0.4 && !state.camInit) state.camInit = true;
  }

  requestAnimationFrame(frame);

  // Debug jumps when the page runs on its own (never on Onceworlds): ?jump=awaken|battle|mid|boss|late
  const jump = params.get('jump');
  if (!ow && jump) {
    const { createAutopilot } = await import('./autopilot.js');
    state.room.startMatch();
    await new Promise((r) => setTimeout(r, 80));
    const sim = state.net.sim;
    if (!sim) return;
    const pilot = createAutopilot(sim, 0, { skill: 0.9 });
    const blacks = () => [...sim.world.pieces.values()].filter((p) => p.s !== 'w').length;
    const until = {
      awaken: () => sim.phase === 'awaken',
      battle: () => sim.phase === 'battle',
      mid: () => sim.phase === 'battle' && sim.turn >= 8 && sim.side === 'w',
      boss: () => sim.phase === 'battle' && sim.side === 'w' && sim.world.boss && integrity(sim.world.boss) < 0.8,
      late: () => sim.phase === 'battle' && sim.side === 'w' && sim.world.boss && sim.world.boss.ph >= 3,
    }[jump] ?? (() => true);
    let n = 0;
    while (!until() && n < 400000) {
      for (let i = 0; i < 3000 && !until(); i++, n++) {
        pilot();
        sim.step(0.05);
      }
      await new Promise((r) => setTimeout(r, 0));
    }
    state.evInit = false;
    window.__jumped = true;
    state.camInit = jump === 'awaken';
    if (jump !== 'awaken') frameBoard(true);
  }

  // ?auto (only outside Onceworlds): White plays itself at a watchable pace, for recording the game.
  if (!ow && params.has('auto')) {
    const { bestWhiteMove } = await import('./autopilot.js');
    const pace = Number(params.get('pace')) || 1;
    const opening = [[12, 28], [6, 21], [5, 26], [11, 19], [1, 18]]; // e4, Nf3, Bc4, d3, Nc3
    let nextAt = performance.now() + 2500;
    let moves = 0;
    if (state.room.match.phase !== 'playing') setTimeout(() => state.room.startMatch(), 1800);
    const tick = () => {
      requestAnimationFrame(tick);
      const sim = state.net?.sim;
      if (!sim || performance.now() < nextAt) return;
      if (sim.phase === 'chess' && sim.chess.pos.t === 'w') {
        const pos = sim.chess.pos;
        const caps = legalMoves(pos).filter((m) => m.c !== '.');
        let m = caps[0];
        if (!m) {
          const [from, to] = opening[Math.min(opening.length - 1, Math.floor(sim.chess.ply / 2))] ?? [];
          m = legalMoves(pos).find((mv) => mv.from === from && mv.to === to) ?? legalMoves(pos)[Math.floor(Math.random() * legalMoves(pos).length)];
        }
        if (m) {
          state.chessSel = m.from;
          setTimeout(() => {
            state.chessSel = -1;
            state.net.send({ t: 'cm', from: m.from, to: m.to, promo: 'q' });
          }, 450 / pace);
        }
        nextAt = performance.now() + 1700 / pace;
      } else if (sim.phase === 'battle' && sim.side === 'w' && !sim.done.has(0)) {
        const pick = moves < 9 ? bestWhiteMove(sim, 0, { skill: 0.9 }) : null;
        if (pick) {
          state.sel = pick.p.id;
          setTimeout(() => {
            state.net.send({ t: 'mv', id: pick.p.id, x: pick.m.x, y: pick.m.y });
            if (pick.m.o > 0) sfx.capture();
            else if (pick.m.o < 0) sfx.hit();
            else sfx.move();
            state.sel = 0;
          }, 380 / pace);
          moves++;
          nextAt = performance.now() + 760 / pace;
        } else {
          state.net.send({ t: 'end', on: true });
          moves = 0;
          nextAt = performance.now() + 900 / pace;
        }
      } else if (sim.phase === 'lost') {
        state.net.send({ t: 'retry' });
        nextAt = performance.now() + 3000;
      } else nextAt = performance.now() + 200;
    };
    requestAnimationFrame(tick);
  }
}
