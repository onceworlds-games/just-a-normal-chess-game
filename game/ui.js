// Everything around the board: the two player bars with their clocks, the side panel (the lobby, the move list, the
// war room) and the banners and result card over the board. Names from other players go in with textContent only.

import { pieceSvg } from './pieces.js';
import { SLOT_COLORS, NAMES, DIFFICULTY, DIFF_KEYS } from './config.js';

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v; // only ever our own markup (piece icons)
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const set = (el, text) => {
  const s = String(text);
  if (el.textContent !== s) el.textContent = s;
};

export function fmtClock(sec) {
  sec = Math.max(0, sec);
  if (sec < 10) return `0:0${sec.toFixed(1)}`;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (m >= 60) return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const NOIR_AVATAR = `<div class="av-tile noir">${pieceSvg('p', 'b', 34)}</div>`;
const DRAGON_AVATAR = `<div class="av-tile dragon">${pieceSvg('n', 'd', 34)}<i class="eye"></i></div>`;

export function avatarImg(url, name) {
  const wrap = h('div', { class: 'av-tile' });
  const initial = h('span', { class: 'initial' }, (name || '?').slice(0, 1).toUpperCase());
  wrap.append(initial);
  if (url) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.alt = '';
    img.onload = () => {
      initial.remove();
      wrap.append(img);
    };
    img.src = url;
  }
  return wrap;
}

function bar(id) {
  const root = document.getElementById(id);
  root.innerHTML = '';
  const av = h('div', { class: 'pb-av' });
  const name = h('span', { class: 'pb-name' });
  const rating = h('span', { class: 'pb-rating' });
  const extra = h('div', { class: 'pb-extra' });
  const clock = h('div', { class: 'clock' }, h('span', { class: 'clock-t' }, '10:00'));
  root.append(av, h('div', { class: 'pb-mid' }, h('div', { class: 'pb-line' }, name, rating), extra), clock);
  return { root, av, name, rating, extra, clock, clockT: clock.firstChild, avKey: '' };
}

export function createUI(handlers) {
  const app = document.getElementById('app');
  const panel = document.getElementById('panel');
  const hud = document.getElementById('hud');
  const top = bar('barTop');
  const bot = bar('barBot');
  const minimap = h('canvas', { class: 'minimap', width: 220, height: 220, 'aria-label': 'Map' });
  let panelMode = '';
  let refs = {};
  let modalKey = '';

  const ui = {
    minimap,
    setPhase(phase) {
      if (app.dataset.phase !== phase) app.dataset.phase = phase;
    },
    setAvatar(b, key, make) {
      if (b.avKey === key) return;
      b.avKey = key;
      const node = typeof make === 'function' ? make() : make;
      b.av.replaceChildren(typeof node === 'string' ? h('div', { html: node }) : node);
    },
    top,
    bot,
    noirAvatar: NOIR_AVATAR,
    dragonAvatar: DRAGON_AVATAR,
    set,

    // ------------------------------------------------------------ banners
    banner(big, small = '', tone = '') {
      const el = h('div', { class: `banner ${tone}` }, h('div', { class: 'b-big' }, big), small ? h('div', { class: 'b-small' }, small) : null);
      hud.querySelectorAll('.banner').forEach((b) => b.remove());
      hud.append(el);
      setTimeout(() => el.classList.add('out'), 2300);
      setTimeout(() => el.remove(), 2800);
    },
    toast(text) {
      const el = h('div', { class: 'toast' }, text);
      hud.append(el);
      setTimeout(() => el.classList.add('out'), 1800);
      setTimeout(() => el.remove(), 2300);
    },
    hudNode: hud,

    // ------------------------------------------------------------ panel
    panel(mode, build) {
      if (panelMode === mode) return refs;
      panelMode = mode;
      refs = {};
      panel.replaceChildren(build(refs));
      return refs;
    },
    refs: () => refs,
    panelMode: () => panelMode,

    // ------------------------------------------------------------ the result card
    modal(key, build) {
      const box = document.getElementById('modal');
      if (!key) {
        if (modalKey) {
          box.hidden = true;
          box.replaceChildren();
          modalKey = '';
        }
        return;
      }
      if (modalKey === key) return;
      modalKey = key;
      box.replaceChildren(build());
      box.hidden = false;
    },
  };
  return ui;
}

// ---------------------------------------------------------------- panel builders

export function lobbyPanel(refs, { onDiff, onPlay, onReady, onContinue, onInvite }) {
  refs.seg = DIFF_KEYS.map((k) => h('button', { class: 'seg-b', 'data-k': k, onclick: () => onDiff(k) }, DIFFICULTY[k].label));
  refs.seats = h('div', { class: 'seats' });
  refs.play = h('button', { class: 'btn green big', onclick: () => onPlay() }, 'Play');
  refs.ready = h('button', { class: 'btn green big', onclick: () => onReady() }, 'Ready');
  refs.cont = h('button', { class: 'btn grey', onclick: () => onContinue() }, 'Continue');
  refs.wait = h('div', { class: 'wait' });
  refs.onInvite = onInvite;
  return h(
    'div',
    { class: 'pn lobby' },
    h('div', { class: 'pn-head' }, h('span', { class: 'pn-icon', html: pieceSvg('p', 'w', 26) }), 'Play vs Noir'),
    h('div', { class: 'pn-body' },
      h('div', { class: 'bot' }, h('div', { html: NOIR_AVATAR, class: 'bot-av' }), h('div', { class: 'bot-txt' }, h('div', { class: 'bot-name' }, 'Noir', h('span', { class: 'pb-rating' }, '1450')), h('div', { class: 'bubble' }, 'Just a normal game. Promise.'))),
      h('div', { class: 'label' }, 'Difficulty'),
      h('div', { class: 'seg' }, refs.seg),
      h('div', { class: 'label' }, 'Team White'),
      refs.seats,
    ),
    h('div', { class: 'pn-foot' }, refs.wait, refs.cont, refs.play, refs.ready),
  );
}

export function seatRow(player, slot, { isHost, me, ready, avatar }) {
  return h(
    'div',
    { class: 'seat' },
    avatar,
    h('i', { class: 'dot', style: `background:${SLOT_COLORS[slot] ?? '#888'}` }),
    h('span', { class: 'seat-name' }, player.name || 'Player', me ? h('span', { class: 'you' }, ' (you)') : null),
    h('span', { class: `seat-st ${isHost ? 'host' : ready ? 'ok' : ''}` }, isHost ? 'Host' : ready ? 'Ready' : 'Not ready'),
  );
}

export function emptySeat(onInvite, canInvite) {
  return h('div', { class: 'seat empty' }, h('div', { class: 'av-tile ghost' }), h('span', { class: 'seat-name' }, 'Open seat'), canInvite ? h('button', { class: 'btn small', onclick: onInvite }, 'Invite') : null);
}

export function chessPanel(refs, { onResign }) {
  refs.list = h('div', { class: 'moves' });
  refs.says = h('div', { class: 'says' });
  refs.status = h('div', { class: 'status' });
  refs.resign = h('button', { class: 'btn grey icon-btn', onclick: () => onResign(refs.resign) }, h('span', { html: '<svg width="18" height="18" viewBox="0 0 24 24"><path d="M5 21V4h11l-1 3h5l-2 7h-9l1-3H7v10z" fill="currentColor"/></svg>' }), 'Resign');
  return h(
    'div',
    { class: 'pn chess' },
    h('div', { class: 'pn-head' }, h('span', { class: 'pn-icon', html: pieceSvg('n', 'w', 26) }), 'Moves'),
    h('div', { class: 'noir-row' }, h('div', { html: NOIR_AVATAR, class: 'noir-av' }), refs.says),
    h('div', { class: 'pn-body scroll' }, refs.list),
    h('div', { class: 'pn-foot row' }, refs.status, refs.resign),
  );
}

/** What Noir says as the game goes on without a capture. */
export function noirLine(plies) {
  const move = Math.floor(plies / 2) + 1;
  if (move <= 1) return ['Good luck.', ''];
  if (move <= 3) return ['A normal game. Promise.', ''];
  if (move <= 5) return ['You can take my pieces, you know.', ''];
  if (move <= 7) return ['Go on. Take one.', 'uneasy'];
  if (move <= 9) return ['Take it.', 'uneasy'];
  return ['TAKE IT.', 'hungry'];
}

export function fillMoves(list, moves) {
  if (list.childElementCount === Math.ceil(moves.length / 2) && list.dataset.n === String(moves.length)) return;
  list.dataset.n = String(moves.length);
  list.replaceChildren();
  for (let i = 0; i < moves.length; i += 2) {
    const last = i + 2 >= moves.length;
    list.append(
      h('div', { class: `mv-row ${(i / 2) % 2 ? 'alt' : ''}` },
        h('span', { class: 'mv-n' }, `${i / 2 + 1}.`),
        h('span', { class: `mv ${last && moves.length % 2 === 1 ? 'cur' : ''}` }, moves[i]),
        h('span', { class: `mv ${last && moves.length % 2 === 0 ? 'cur' : ''}` }, moves[i + 1] ?? '')),
    );
  }
  list.parentElement.scrollTop = list.parentElement.scrollHeight;
}

export function warPanel(refs, { onEnd, onUndo, onEndAll, onPause, onKing }) {
  refs.turnT = h('div', { class: 'w-title' });
  refs.turnS = h('div', { class: 'w-sub' });
  refs.turnR = h('div', { class: 'w-right' });
  refs.end = h('button', { class: 'btn green big end-btn', onclick: () => onEnd() }, 'End turn');
  refs.undo = h('button', { class: 'btn grey', onclick: () => onUndo() }, 'Undo');
  refs.endAll = h('button', { class: 'btn small grey', onclick: () => onEndAll() }, 'End for everyone');
  refs.bossT = h('div', { class: 'b-name' }, 'The Endgame');
  refs.bossP = h('div', { class: 'b-pct' });
  refs.hp = h('i');
  refs.bossS = h('div', { class: 'b-sub' });
  refs.next = h('div', { class: 'b-next' });
  refs.selIcons = h('div', { class: 'sel-icons' });
  refs.selName = h('div', { class: 'sel-name' });
  refs.team = h('div', { class: 'team' });
  refs.pause = h('button', { class: 'btn small grey', onclick: () => onPause() }, 'Pause');
  refs.king = h('button', { class: 'btn small grey', onclick: () => onKing() }, h('span', { html: pieceSvg('k', 'w', 18) }), 'King');
  return h(
    'div',
    { class: 'pn war' },
    h('div', { class: 'wave' }, h('div', { class: 'w-top' }, h('div', {}, refs.turnT, refs.turnS), refs.turnR), h('div', { class: 'turn-btns' }, refs.end, refs.undo)),
    h('div', { class: 'bosscard' }, h('div', { class: 'b-top' }, h('span', { class: 'b-av', html: pieceSvg('n', 'd', 26) }), refs.bossT, refs.bossP), h('div', { class: 'prog boss' }, refs.hp), refs.bossS, refs.next),
    h('div', { class: 'selbox' }, h('div', { class: 'sel-head' }, refs.selIcons, refs.selName)),
    h('div', { class: 'pn-body scroll team-wrap' }, refs.team),
    h('div', { class: 'pn-foot row tools' }, refs.king, refs.endAll, refs.pause),
  );
}

export function teamRow(name, slot, pieces, done, me) {
  return h('div', { class: 'team-row' }, h('i', { class: 'dot', style: `background:${SLOT_COLORS[slot] ?? '#888'}` }), h('span', { class: 'tn' }, name, me ? h('span', { class: 'you' }, ' (you)') : null), h('span', { class: 'tp' }, `${pieces}`), h('span', { class: `tm ${done ? 'ok' : ''}` }, done ? 'Done' : 'Moving'));
}

export function selectionIcons(kinds) {
  return kinds.slice(0, 6).map((k) => h('span', { html: pieceSvg(k, 'w', 26) }));
}

export { NAMES, SLOT_COLORS };
