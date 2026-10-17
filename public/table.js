// Online table client: renders the server's state, sends actions, predicts own moves locally.
const $ = s => document.querySelector(s);
const { OPP, SIGN } = Rules;
const THEMES = { traditional: 'Traditional', brown: 'Brown', blue: 'Blue', gray: 'Gray' };
const PIECES = { ivory: ['Ivory & Ebony', '#f2e7cf', '#2b2623'], classic: ['Classic', '#fff', '#3a3835'], ruby: ['Ruby', '#fff', '#d8322a'] };
const COLOR_NAME = { w: 'White', r: 'Dark' };

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
};
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const roomId = (location.pathname.split('/')[2] || '').toLowerCase();
let token = store.get('tavla.token');
if (!token) { token = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)); store.set('tavla.token', token); }
let prefs = { theme: 'traditional', pieces: 'ivory', oneClick: false, hints: true, lastMove: true, autoRoll: false, pips: true, sound: true };
try { Object.assign(prefs, JSON.parse(store.get('tavla.prefs') || '{}')); } catch (e) {}
if (!THEMES[prefs.theme]) prefs.theme = 'traditional';
const savePrefs = () => store.set('tavla.prefs', JSON.stringify(prefs));

/* ---------- state ---------- */
let ST = null;        // last state from the server
let G = null;         // working copy of ST.g (own moves applied optimistically)
let me = null;        // 'w' | 'r' | null for spectators
let recvAt = 0;
let sel = null, drag = null, dragging = null;
let rollingUntil = 0, lastHistLen = 0, lastGameNo = 0, lastMoveCount = 0, lastChatKey = '';
let dismissedOver = 0, overlayKey = '', fatal = null, needName = false, autoRolled = '';

const bottom = () => me || 'w';
const topPl = () => OPP[bottom()];
const vp = p => (bottom() === 'w' ? p : 25 - p);           // real point <-> on-screen point
const myTurn = () => !!(G && me && G.turn === me);
const canMove = () => myTurn() && G.phase === 'move' && !G.noMoves;
const canRoll = () => myTurn() && G.phase === 'roll';
const nameOf = pl => (ST && ST.seats[pl] ? ST.seats[pl].name : COLOR_NAME[pl]);

/* ---------- socket ---------- */
const socket = io();
function join() {
  socket.emit('join', { id: roomId, token, name: store.get('tavla.name') || 'Guest' }, res => {
    if (res.error) { fatal = res.error; render(); return; }
    me = res.seat;
  });
}
socket.on('connect', () => {
  $('#conn').hidden = true;
  if (store.get('tavla.name')) join(); else { needName = true; render(); }
});
socket.on('disconnect', () => { $('#conn').hidden = false; });
socket.on('state', s => {
  ST = s; recvAt = Date.now();
  G = s.g ? JSON.parse(JSON.stringify(s.g)) : null;
  if (G) {
    const moveCount = G.history.reduce((n, t) => n + t.moves.length, 0);
    if (s.gameNo !== lastGameNo || G.history.length > lastHistLen) {
      rollingUntil = Date.now() + 600; sfx('dice'); setTimeout(renderDice, 620);
    } else if (moveCount > lastMoveCount && G.history[G.history.length - 1].pl !== me) sfx('move');
    if (s.gameNo !== lastGameNo) dismissedOver = 0;
    lastGameNo = s.gameNo; lastHistLen = G.history.length; lastMoveCount = moveCount;
    if (!canMove()) { sel = null; drag = null; dragging = null; }
    const rollKey = s.gameNo + ':' + G.history.length;
    if (prefs.autoRoll && canRoll() && autoRolled !== rollKey) { autoRolled = rollKey; setTimeout(() => canRoll() && socket.emit('roll'), 350); }
  }
  render();
});

/* ---------- actions ---------- */
function roll() { if (canRoll()) socket.emit('roll'); }
function tryMove(from, to) {
  const m = Rules.findMove(G, me, from, to);
  if (!m) return false;
  const hit = to !== 'off' && G.board[to] * SIGN[me] === -1;
  const note = Rules.applyMove(G, me, from, to, m.idx);
  G.history[G.history.length - 1].moves.push(note);
  G.hl.push(from, to);
  sel = null;
  sfx(hit ? 'hit' : 'move');
  socket.emit('move', { from, to });
  render();
  return true;
}
function onPoint(pt, button) {
  if (!canMove()) return;
  if (sel !== null && tryMove(sel, pt)) return;
  if (pt === 'off') { sel = null; render(); return; }
  const src = G.bar[me] ? 'bar' : pt;
  if (src !== 'bar' && !Rules.own(G, me, src)) { sel = null; render(); return; }
  const ts = Rules.targetsFrom(G, me, src);
  if (!ts.length) { sel = null; toast('No legal move from that point'); render(); return; }
  if (prefs.oneClick) {
    ts.sort((a, b) => (button === 'right' ? a.v - b.v : b.v - a.v));
    tryMove(src, ts[0].dest); return;
  }
  sel = sel === src ? null : src; sfx('tick'); render();
}

/* ---------- board rendering ---------- */
function renderBoard() {
  const g = G;
  let h = boardBase();
  if (!g) { $('#board').innerHTML = h; return; }

  const targets = canMove() && sel !== null && prefs.hints ? Rules.targetsFrom(g, me, sel) : [];
  if (prefs.lastMove) for (const p of new Set(g.hl)) if (typeof p === 'number') h += `<polygon class="hl last" points="${triPts(vp(p))}"/>`;
  if (sel !== null) h += sel === 'bar' ? `<rect class="hl" x="${B.BX}" y="330" width="${B.BW}" height="308"/>` : `<polygon class="hl" points="${triPts(vp(sel))}"/>`;
  h += boardPieces(g, g.cube, bottom(), dragging);
  for (const t of targets) {
    if (t.dest === 'off') { h += `<circle class="dot" cx="${B.TX + B.TW / 2}" cy="${B.Y1 - 26 - g.off[me] * 19 - 14}" r="13"/>`; continue; }
    const val = g.board[t.dest] * SIGN[me], v = vp(t.dest), x = ptX(v);
    if (val === -1) h += `<circle class="capture" cx="${x}" cy="${stackY(v, 0, 1)}" r="${B.CR - 2}"/>`;
    else { const k = Math.max(0, val); h += `<circle class="dot" cx="${x}" cy="${k < 5 ? stackY(v, k, k + 1) : stackY(v, 4, 5)}" r="13"/>`; }
  }
  for (let v = 1; v <= 24; v++) h += `<rect class="hit" x="${ptX(v) - 34}" y="${v >= 13 ? B.Y0 : 330}" width="68" height="308"/>`;
  h += `<rect class="hit" x="${B.BX}" y="${B.Y0}" width="${B.BW}" height="616"/><rect class="hit" x="${B.TX}" y="${B.Y0}" width="${B.TW}" height="616"/>`;
  $('#board').innerHTML = h;
}
function renderDice() {
  const el = $('#dice');
  if (canRoll() && $('#overlay').hidden) {
    el.innerHTML = `<button class="btn-green roll-btn" id="rollBtn">Roll Dice</button>`; $('#rollBtn').onclick = roll; return;
  }
  if (!G || !G.dice.length || G.phase === 'over') { el.innerHTML = ''; return; }
  // Always show the two dice that were rolled; a double gets a "×n moves left" counter.
  const d = G.dice, dbl = d.length === 4, left = d.filter(x => !x.used).length;
  const rolling = Date.now() < rollingUntil ? 'rolling' : '', dead = G.noMoves && !rolling;
  const faces = dbl ? [{ v: d[0].v, used: left <= 2 }, { v: d[0].v, used: left === 0 }] : d;
  el.innerHTML = faces.map(f => dieHTML(f.v, G.turn, `${f.used || dead ? 'used' : ''} ${rolling}`)).join('') +
    (dbl && left > 0 && !dead && !rolling ? `<span class="dbl">×${left}</span>` : '');
}

/* ---------- panel + players ---------- */
const fmt = ms => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const clockLeft = pl => (ST && !ST.g ? ST.settings.clockMin * 60000 : ST ? Math.max(0, ST.clock[pl] - (ST.clock.running === pl ? Date.now() - recvAt : 0)) : 0);
function renderPlayer(el, pl) {
  const seat = ST && ST.seats[pl];
  if (!seat) {
    el.className = 'pbar empty';
    el.innerHTML = `<div class="avatar ${pl}">?</div><div class="pinfo"><div class="pline">Waiting for opponent…</div><div class="psub">${COLOR_NAME[pl]}</div></div>`;
    return;
  }
  const g = G, active = g && g.turn === pl && g.phase !== 'over';
  el.className = 'pbar';
  const ms = clockLeft(pl);
  el.innerHTML = `<div class="avatar ${pl}">${esc(seat.name[0].toUpperCase())}</div>
    <div class="pinfo"><div class="pline">${esc(seat.name)}${pl === me ? ' <span class="rt">(you)</span>' : ''}${seat.connected ? '' : ' <span class="offline">OFFLINE</span>'}${g && g.cube.owner === pl ? `<span class="badge">CUBE ×${g.cube.v}</span>` : ''}</div>
      <div class="psub">${g && prefs.pips ? `<span class="pp">Pips <b>${Rules.pips(g, pl)}</b></span>` : ''}${g ? `<span>Off <b>${g.off[pl]}</b></span>` : `<span>${COLOR_NAME[pl]}</span>`}</div></div>
    <div class="score" title="Match score">${ST.score[pl]}</div>
    <div class="clock ${active && ST.clock.running === pl ? 'active' : ''} ${ms < 30000 ? 'low' : ''} ${ST.settings.clockMin ? '' : 'none'}" data-clock="${pl}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="9"/><path d="M12 12V6"/></svg><span>${fmt(ms)}</span></div>`;
}
function hintText() {
  if (!ST) return ['Connecting…', true];
  if (!G) return [me ? 'Waiting for an opponent to join' : 'Waiting for players', true];
  if (G.phase === 'over') return ['Game over', true];
  if (G.phase === 'double') return me === OPP[G.pendingDouble] ? [`${nameOf(G.pendingDouble)} offers a double`, false] : [`Waiting for ${nameOf(OPP[G.pendingDouble])} to answer the double`, true];
  if (!me) return [`Watching · ${nameOf(G.turn)} to play`, true];
  if (!myTurn()) return [`${nameOf(G.turn)} is ${G.phase === 'roll' ? 'about to roll' : 'moving'}…`, true];
  if (G.phase === 'roll') return ['Your turn — roll the dice or double', false];
  if (G.noMoves) return ['No legal moves — passing your turn', false];
  if (G.bar[me]) return ['You have a checker on the bar — enter it first', false];
  if (sel !== null) return ['Choose a destination', false];
  return [prefs.oneClick ? 'Click a checker: left = higher die, right = lower' : 'Drag or click a checker to move', false];
}
function renderPanel() {
  const [t, wait] = hintText();
  $('#hint').className = 'hint' + (wait ? ' wait' : '');
  $('#hint').innerHTML = `<span class="d"></span>${esc(t)}`;
  $('#note').hidden = !(G && G.noMoves && G.phase === 'move'); $('#note').textContent = 'No legal moves';
  if (ST) {
    const s = ST.settings;
    $('#metaTitle').textContent = `Match to ${s.matchTo} · ${s.clockMin ? `${s.clockMin} min + ${s.inc}s` : 'No clock'}`;
    $('#metaSub').textContent = `Table ${ST.id}${ST.spectators.length ? ` · ${ST.spectators.length} watching` : ''}${me ? '' : ' · You are watching'}`;
  }
  const seated = !!me, g = G;
  $('#undoBtn').disabled = !(myTurn() && g.phase === 'move' && g.undoCount > 0);
  $('#doubleBtn').disabled = !(canRoll() && g.cube.owner !== OPP[me] && g.cube.v < 64);
  $('#resignBtn').disabled = !(seated && g && g.phase !== 'over');
  document.querySelectorAll('#resignPop [data-pts]').forEach(e => { const v = e.dataset.pts * (g ? g.cube.v : 1); e.textContent = `−${v} pt${v > 1 ? 's' : ''}`; });
  const b = $('#primaryBtn');
  let label = 'Waiting…', enabled = false;
  if (!g) label = 'Waiting for opponent…';
  else if (g.phase === 'over') { label = seated ? (ST.matchOver ? 'New Match' : 'Next Game') : 'Game over'; enabled = seated; }
  else if (canRoll()) { label = 'Roll Dice'; enabled = true; }
  else if (g.phase === 'double' && me === OPP[g.pendingDouble]) label = 'Answer the double';
  else if (myTurn()) label = 'Your move';
  else label = seated ? `Waiting for ${nameOf(g.turn)}…` : 'Watching';
  b.textContent = label; b.disabled = !enabled;
}
function renderMoves() {
  const el = $('#moves');
  if (!G) { el.innerHTML = '<div class="empty">The game starts when both players are seated.</div>'; return; }
  const rows = [];
  for (const t of G.history) {
    const last = rows[rows.length - 1];
    if (t.pl === 'r' && last && last.w && !last.r) last.r = t; else rows.push({ [t.pl]: t });
  }
  const cur = G.history[G.history.length - 1];
  const cell = t => !t ? '<div></div>' : `<div class="mcell ${t === cur && G.phase !== 'over' ? 'cur' : ''}"><span class="md ${t.pl}"><span>${t.dice[0]}</span><span>${t.dice[1]}</span></span><span class="nt">${t.moves.join(' ') || (t === cur && G.phase !== 'over' ? '…' : '—')}</span></div>`;
  el.innerHTML = `<div class="mrow" style="font-size:12px;color:var(--muted);font-weight:700"><span class="n">#</span><div class="mcell">${esc(nameOf('w'))}</div><div class="mcell">${esc(nameOf('r'))}</div></div>` +
    rows.map((r, i) => `<div class="mrow"><span class="n">${i + 1}.</span>${cell(r.w)}${cell(r.r)}</div>`).join('');
  el.scrollTop = el.scrollHeight;
}
function renderChat() {
  if (!ST) return;
  const key = ST.chat.length + ':' + (ST.chat.length ? ST.chat[ST.chat.length - 1].t : 0);
  if (key === lastChatKey) return;
  lastChatKey = key;
  const el = $('#msgs');
  el.innerHTML = ST.chat.map(m => m.sys ? `<div class="sys">${m.text}</div>` : `<div class="m"><b class="${me && m.seat === me ? 'me' : ''}">${esc(m.name)}:</b> ${esc(m.text)}</div>`).join('');
  el.scrollTop = el.scrollHeight;
}
function renderPlayers() {
  if (!ST) return;
  const seatRow = pl => {
    const s = ST.seats[pl];
    if (!s) return `<div class="user"><div class="avatar ${pl}">?</div><div class="grow"><div class="nm">Empty seat</div><div class="sb">${COLOR_NAME[pl]} · share the link to invite</div></div></div>`;
    return `<div class="user"><div class="avatar ${pl}">${esc(s.name[0].toUpperCase())}</div><div class="grow"><div class="nm">${esc(s.name)}${pl === me ? ' <span class="rt">(you)</span>' : ''}</div><div class="sb">${COLOR_NAME[pl]} · ${s.connected ? 'online' : 'offline'}</div></div>${s.connected ? '<span class="on-dot"></span>' : ''}</div>`;
  };
  $('#playersList').innerHTML = `<div class="sec">Playing</div>${seatRow('w')}${seatRow('r')}
    <div class="sec">Watching · ${ST.spectators.length}</div>
    ${ST.spectators.map(n => `<div class="user"><div class="avatar" style="background:#4b4946">${esc(n[0].toUpperCase())}</div><div class="grow"><div class="nm">${esc(n)}</div><div class="sb">Spectator</div></div></div>`).join('') || '<div class="empty" style="padding:12px">Nobody is watching</div>'}
    <div class="sec">Invite</div><div style="padding:0 14px"><div class="share"><input readonly value="${esc(location.href)}"><button class="btn-green" data-copy>Copy</button></div></div>`;
}
function renderSettings() {
  $('#boardWrap').dataset.theme = prefs.theme;
  document.body.dataset.pieces = prefs.pieces;
  $('#themes').innerHTML = Object.entries(THEMES).map(([k, n]) => {
    const tmp = $('#boardWrap').cloneNode(false); tmp.dataset.theme = k; document.body.appendChild(tmp);
    const cs = getComputedStyle(tmp), v = {}; ['--felt-1', '--pa', '--pb'].forEach(x => (v[x] = cs.getPropertyValue(x).trim())); tmp.remove();
    return `<button class="theme ${prefs.theme === k ? 'on' : ''}" data-theme="${k}"><div class="pv" style="background:${v['--felt-1']}">${[1, 2, 3, 4].map(i => `<i style="background:${i % 2 ? v['--pa'] : v['--pb']}"></i>`).join('')}</div><span>${n}</span></button>`;
  }).join('');
  $('#pieces').innerHTML = Object.entries(PIECES).map(([k, [n, a, b]]) => `<button class="piece ${prefs.pieces === k ? 'on' : ''}" data-pieces="${k}"><i style="background:${a}"></i><i style="background:${b};margin-left:-12px"></i>${n}</button>`).join('');
  document.querySelectorAll('[data-set]').forEach(b => b.classList.toggle('on', !!prefs[b.dataset.set]));
}

/* ---------- overlays (one at a time) ---------- */
function renderOverlay() {
  const ov = $('#overlay');
  let key = '', html = '';
  if (fatal) {
    key = 'fatal';
    html = `<div class="modal"><header class="neutral"><h2>Table not found</h2></header><div class="body"><p>${esc(fatal)}</p></div><div class="acts"><a class="btn-green" href="/" style="text-decoration:none">Create a new table</a></div></div>`;
  } else if (needName) {
    key = 'name';
    html = `<div class="modal"><header><h2>Join table</h2><p>Choose a name to play</p></header><form class="body" id="nameForm"><label class="field"><span>Your name</span><input id="nameInput" maxlength="20" required autocomplete="nickname"></label><button class="btn-green" style="width:100%;height:48px;font-size:17px">Join</button></form></div>`;
  } else if (ST && !G && me) {
    key = 'waiting';
    html = `<div class="modal"><header class="neutral"><h2>Waiting for opponent</h2><p>Send this link to a friend</p></header><div class="body"><div class="share"><input readonly value="${esc(location.href)}" onclick="this.select()"><button class="btn-green" data-copy>Copy</button></div><p>The game starts as soon as they open it. Anyone else who opens the link can watch.</p></div></div>`;
  } else if (G && G.phase === 'double' && me === OPP[G.pendingDouble]) {
    key = 'double:' + ST.gameNo + ':' + G.cube.v;
    html = `<div class="modal"><header class="neutral"><h2>Double offered</h2><p>${esc(nameOf(G.pendingDouble))} doubles to ×${G.cube.v * 2}</p></header><div class="body"><p>Accept to keep playing for ${G.cube.v * 2} point${G.cube.v * 2 > 1 ? 's' : ''} (you take the cube). Decline to give up this game for ${G.cube.v} point${G.cube.v > 1 ? 's' : ''}.</p></div>
      <div class="acts"><button class="btn-green" data-answer="1">Accept ×${G.cube.v * 2}</button><button class="btn-gray" data-answer="0">Decline</button></div></div>`;
  } else if (G && G.phase === 'over' && G.result && dismissedOver !== ST.gameNo) {
    const r = G.result, iWon = me && r.winner === me, mine = !!me;
    key = 'over:' + ST.gameNo;
    const how = { single: 'single game', gammon: 'gammon', backgammon: 'backgammon', resign: 'resignation', drop: 'declined double', time: 'time' }[r.reason];
    const title = mine ? (iWon ? (r.matchOver ? 'Match Won!' : 'You Won!') : (r.matchOver ? 'Match Lost' : `${esc(nameOf(r.winner))} Won`)) : `${esc(nameOf(r.winner))} Won${r.matchOver ? ' the Match' : ''}`;
    html = `<div class="modal"><header class="${!mine || iWon ? '' : 'loss'}"><h2>${title}</h2><p>by ${how}</p></header>
      <div class="vs"><div><div class="avatar w">${esc(nameOf('w')[0].toUpperCase())}</div><div class="who">${esc(nameOf('w'))}</div></div><div class="big">${ST.score.w} – ${ST.score.r}</div><div><div class="avatar r">${esc(nameOf('r')[0].toUpperCase())}</div><div class="who">${esc(nameOf('r'))}</div></div></div>
      <div class="pts">${r.points ? `+${r.points} point${r.points > 1 ? 's' : ''} to ${esc(nameOf(r.winner))} · ` : ''}first to ${ST.settings.matchTo}</div>
      <div class="acts">${r.gameId ? `<a class="btn-green" href="/review/${r.gameId}?as=${me || 'w'}" target="_blank" rel="noopener" style="text-decoration:none">★ Game Review</a>` : ''}
        ${mine ? `<button class="${r.gameId ? 'btn-gray' : 'btn-green'}" data-next>${r.matchOver ? 'New Match' : 'Next Game'}</button>` : ''}<button class="btn-gray" data-dismiss>Look at the board</button></div></div>`;
  }
  if (key === overlayKey) return;
  overlayKey = key;
  ov.hidden = !key;
  ov.innerHTML = html;
  if (key === 'name') {
    $('#nameInput').value = store.get('tavla.name') || '';
    $('#nameInput').focus();
    $('#nameForm').onsubmit = e => { e.preventDefault(); const n = $('#nameInput').value.trim(); if (!n) return; store.set('tavla.name', n); needName = false; join(); render(); };
  }
}

function render() {
  renderOverlay(); renderBoard(); renderDice(); renderPanel();
  renderPlayer($('#p-top'), topPl()); renderPlayer($('#p-bottom'), bottom());
  renderMoves(); renderChat(); renderPlayers();
}

/* ---------- misc ---------- */
let toastT;
function toast(t) { const e = $('#toast'); e.textContent = t; e.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => e.classList.remove('show'), 1700); }
let actx;
function sfx(kind) {
  if (!prefs.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const n = { move: [1, 220], hit: [1, 140], tick: [1, 520], dice: [3, 300] }[kind];
    for (let i = 0; i < n[0]; i++) {
      const o = actx.createOscillator(), gn = actx.createGain(), t = actx.currentTime + i * 0.07;
      o.type = 'triangle'; o.frequency.value = n[1] * (1 + i * 0.25) + Math.random() * 30;
      gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(0.12, t + 0.01); gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(gn).connect(actx.destination); o.start(t); o.stop(t + 0.14);
    }
  } catch (e) {}
}
function copyLink() {
  const done = () => toast('Link copied — send it to your opponent');
  if (navigator.clipboard) navigator.clipboard.writeText(location.href).then(done, () => toast(location.href));
  else toast(location.href);
}

/* ---------- input ---------- */
const svg = $('#board');
svg.addEventListener('contextmenu', e => e.preventDefault());
function svgPt(e) { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); }
function pointAt(x, y) {   // returns a real point, 'bar', 'off' or null
  if (x >= B.TX && x <= B.TX + B.TW) return 'off';
  if (x >= B.BX && x < B.BX + B.BW) return 'bar';
  const isTop = y < 330;
  let v = null;
  if (x >= B.L && x < B.L + 408) { const c = Math.floor((x - B.L) / B.COL); v = isTop ? 13 + c : 12 - c; }
  if (x >= B.R && x < B.R + 408) { const c = Math.floor((x - B.R) / B.COL); v = isTop ? 19 + c : 6 - c; }
  return v === null ? null : vp(v);
}
const legalDrop = (src, pt) => pt !== null && Rules.targetsFrom(G, me, src).some(t => t.dest === pt);
svg.addEventListener('pointerdown', e => {
  if (e.button !== 0 && e.button !== 2) return;
  const v = svgPt(e), pt = pointAt(v.x, v.y); if (pt === null) return;
  if (prefs.oneClick || e.button === 2) { onPoint(pt, e.button === 2 ? 'right' : 'left'); return; }
  if (!canMove()) return;
  if (sel !== null && legalDrop(sel, pt)) { tryMove(sel, pt); return; }
  const src = G.bar[me] ? 'bar' : pt;
  if (src !== 'bar' && !Rules.own(G, me, src)) { sel = null; render(); return; }
  if (!Rules.targetsFrom(G, me, src).length) { sel = null; toast('No legal move from that point'); render(); return; }
  drag = { src, sx: e.clientX, sy: e.clientY, moved: false, was: sel === src };
  if (sel !== src) { sel = src; sfx('tick'); render(); }
  svg.setPointerCapture(e.pointerId);
});
svg.addEventListener('pointermove', e => {
  if (!drag) return;
  if (!drag.moved) {
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return;
    drag.moved = true; dragging = drag.src; svg.classList.add('dragging'); renderBoard();
    svg.insertAdjacentHTML('beforeend', '<g id="dragHover" pointer-events="none"></g>' + checker(me, 0, 0).replace('<g transform', '<g id="dragChk" pointer-events="none" transform'));
  }
  const v = svgPt(e), pt = pointAt(v.x, v.y);
  const chk = $('#dragChk'); if (!chk) return;
  chk.setAttribute('transform', `translate(${v.x},${v.y}) scale(1.1)`);
  $('#dragHover').innerHTML = !legalDrop(drag.src, pt) ? '' : pt === 'off'
    ? `<rect class="drop" x="${B.TX + 3}" y="333" width="${B.TW - 6}" height="302" rx="6"/>`
    : `<polygon class="drop" points="${triPts(vp(pt))}"/>`;
});
function endDrag(e, cancel) {
  if (!drag) return;
  const d = drag; drag = null; dragging = null; svg.classList.remove('dragging');
  if (d.moved) {
    const v = cancel ? null : svgPt(e), pt = v ? pointAt(v.x, v.y) : null;
    if (!(canMove() && pt !== null && tryMove(d.src, pt))) render();
  } else if (d.was) { sel = null; render(); }
}
svg.addEventListener('pointerup', e => endDrag(e, false));
svg.addEventListener('pointercancel', e => endDrag(e, true));

$('#undoBtn').onclick = () => socket.emit('undo');
$('#doubleBtn').onclick = () => socket.emit('double');
$('#primaryBtn').onclick = () => { if (G && G.phase === 'over') socket.emit('next'); else roll(); };
$('#resignBtn').onclick = e => { e.stopPropagation(); $('#resignPop').hidden = !$('#resignPop').hidden; };
document.addEventListener('click', e => {
  if (!e.target.closest('.resign-wrap')) $('#resignPop').hidden = true;
  if (e.target.closest('[data-copy]')) copyLink();
  const ans = e.target.closest('[data-answer]'); if (ans) socket.emit('answerDouble', ans.dataset.answer === '1');
  if (e.target.closest('[data-next]')) socket.emit('next');
  if (e.target.closest('[data-dismiss]')) { dismissedOver = ST.gameNo; render(); }
});
document.querySelectorAll('#resignPop [data-res]').forEach(b => (b.onclick = () => { $('#resignPop').hidden = true; socket.emit('resign', +b.dataset.res); }));
$('#copyNav').onclick = copyLink;
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); roll(); }
  if (e.key === 'z' || e.key === 'Z') socket.emit('undo');
  if (e.key === 'Escape') { sel = null; render(); }
});
$('#tabs').addEventListener('click', e => {
  const t = e.target.closest('.tab'); if (!t) return;
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === t));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === 'view-' + t.dataset.tab));
});
$('#themes').addEventListener('click', e => { const s = e.target.closest('.theme'); if (!s) return; prefs.theme = s.dataset.theme; savePrefs(); renderSettings(); });
$('#pieces').addEventListener('click', e => { const s = e.target.closest('.piece'); if (!s) return; prefs.pieces = s.dataset.pieces; savePrefs(); renderSettings(); render(); });
document.querySelectorAll('[data-set]').forEach(b => (b.onclick = () => { const k = b.dataset.set; prefs[k] = !prefs[k]; savePrefs(); renderSettings(); render(); if (k === 'autoRoll' && prefs.autoRoll) roll(); }));
$('#soundBtn').onclick = () => { prefs.sound = !prefs.sound; savePrefs(); $('#soundBtn').style.opacity = prefs.sound ? 1 : 0.45; renderSettings(); toast(prefs.sound ? 'Sound on' : 'Sound off'); };
$('#composer').onsubmit = e => { e.preventDefault(); const v = $('#chatInput').value.trim(); if (!v) return; $('#chatInput').value = ''; socket.emit('chat', v); };
setInterval(() => {
  if (!ST || !ST.clock.running) return;
  const pl = ST.clock.running, c = document.querySelector(`[data-clock="${pl}"]`);
  if (c) { const ms = clockLeft(pl); c.querySelector('span').textContent = fmt(ms); c.classList.toggle('low', ms < 30000); }
}, 250);

$('#soundBtn').style.opacity = prefs.sound ? 1 : 0.45;
renderSettings(); render();
