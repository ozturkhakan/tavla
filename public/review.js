// Game review: replays a finished game with gnubg's verdict on every decision.
const $ = s => document.querySelector(s);
const { OPP, SIGN } = Rules;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gameId = (location.pathname.split('/')[2] || '').toLowerCase();

const RT = {
  best: { label: 'Best', sym: '★', color: '#81b64c', text: 'is the best move' },
  excellent: { label: 'Excellent', sym: '!', color: '#96bc4b', text: 'is excellent' },
  good: { label: 'Good', sym: '✓', color: '#77915f', text: 'is good' },
  inaccuracy: { label: 'Inaccuracy', sym: '?!', color: '#f7c045', text: 'is an inaccuracy' },
  mistake: { label: 'Mistake', sym: '?', color: '#e69f43', text: 'is a mistake' },
  blunder: { label: 'Blunder', sym: '??', color: '#e85d4f', text: 'is a blunder' },
  forced: { label: 'Forced', sym: '→', color: '#6e6c6a', text: 'was the only legal move' },
  'no-move': { label: 'No move', sym: '–', color: '#55524f', text: '' },
  unknown: { label: 'Unrated', sym: '·', color: '#55524f', text: '' },
};
const COUNTED = ['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];
const REASON = { single: 'single game', gammon: 'gammon', backgammon: 'backgammon', resign: 'resignation', drop: 'declined double', time: 'time' };
const badge = r => { const m = RT[r] || RT.unknown; return `<span class="rbadge" style="background:${m.color}">${m.sym}</span>`; };

let RV = null, frames = [], idx = 0, optSel = null;
let bottom = new URLSearchParams(location.search).get('as') === 'r' ? 'r' : 'w';
try {
  const p = JSON.parse(localStorage.getItem('tavla.prefs') || '{}');
  if (p.theme) $('#boardWrap').dataset.theme = p.theme;
  if (p.pieces) document.body.dataset.pieces = p.pieces;
} catch (e) {}

/* ---------- positions ---------- */
const clonePos = p => ({ board: [...p.board], bar: { ...p.bar }, off: { ...p.off } });
function step(g, pl, from, to) {
  const sg = SIGN[pl];
  if (from === 'bar') g.bar[pl]--; else g.board[from] -= sg;
  if (to === 'off') g.off[pl]++;
  else { if (g.board[to] === -sg) { g.board[to] = 0; g.bar[OPP[pl]]++; } g.board[to] += sg; }
}
function applyPlays(pos, pl, plays) { const g = clonePos(pos); for (const [f, t] of plays) step(g, pl, f, t); return g; }

// One frame per item, plus the start and the final position.
function buildFrames(rv) {
  const out = [];
  const first = rv.items.find(i => i.type === 'move');
  let pos = first ? clonePos(first.pos) : null, cube = { v: 1, owner: null }, winW = 0.5;
  out.push({ kind: 'start', pos, cube, winW });
  let turn = 0;
  for (const it of rv.items) {
    if (it.type === 'move') {
      turn++;
      cube = it.cube || cube;
      if (it.probs) winW = it.pl === 'w' ? it.probs[0] : 1 - it.probs[0];   // pre-roll chances (not every gnubg build sends them)
      out.push({ kind: 'move', item: it, pos: it.pos, cube, winW, turn });
      pos = applyPlays(it.pos, it.pl, it.played.plays);
      // Chances after the played move (mover's view) carry into the next frame.
      const mine = (it.options || []).find(o => o.rank === it.playedIndex + 1);
      if (mine) winW = it.pl === 'w' ? mine.probs[0] : 1 - mine.probs[0];
    } else {
      out.push({ kind: it.type, item: it, pos, cube, winW, turn });
      if (it.type === 'take') cube = { v: cube.v * 2, owner: it.pl };
    }
  }
  out.push({ kind: 'end', pos, cube, winW: rv.result.winner === 'w' ? 1 : 0, turn });
  return out;
}

/* ---------- board ---------- */
function spot(g, pl, p, isTo) {
  const bx = B.BX + B.BW / 2;
  if (p === 'bar') { const n = Math.max(1, g.bar[pl]); return pl === bottom ? [bx, 420 + (n - 1) * 18] : [bx, 240 - (n - 1) * 18]; }
  if (p === 'off') { const n = Math.max(1, g.off[pl]); return pl === bottom ? [B.TX + B.TW / 2, B.Y1 - 18 - (n - 1) * 19] : [B.TX + B.TW / 2, B.Y0 + 18 + (n - 1) * 19]; }
  const v = viewPoint(p, bottom), n = Math.max(1, Math.abs(g.board[p]));
  return [ptX(v), stackY(v, n - 1, n)];
}
function arrows(pos, pl, plays, color, marker, dashed) {
  const g = clonePos(pos);
  let s = '';
  for (const [f, t] of plays) {
    const a = spot(g, pl, f);
    step(g, pl, f, t);
    const b = spot(g, pl, t);
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, cut = Math.min(22, len / 3);
    const ex = b[0] - (dx / len) * cut, ey = b[1] - (dy / len) * cut;
    s += `<path class="arrow" d="M${a[0]} ${a[1]} L${ex} ${ey}" stroke="${color}" ${dashed ? 'stroke-dasharray="2 14"' : ''} marker-end="url(#${marker})"/>`;
  }
  return s;
}
function renderBoard() {
  const f = frames[idx];
  let h = boardBase();
  if (f && f.pos) {
    h += boardPieces(f.pos, f.cube, bottom);
    const it = f.item;
    if (f.kind === 'move' && it.played.plays.length) {
      const opts = it.options || [];
      if (optSel !== null && opts[optSel]) h += arrows(it.pos, it.pl, opts[optSel].plays, '#81b64c', 'ah-best');
      else {
        const bad = ['inaccuracy', 'mistake', 'blunder'].includes(it.rating);
        if (bad && opts[0]) h += arrows(it.pos, it.pl, opts[0].plays, '#81b64c', 'ah-best');
        h += arrows(it.pos, it.pl, it.played.plays, bad ? '#e85d4f' : '#f7c045', bad ? 'ah-bad' : 'ah-played', bad);
      }
    }
  }
  $('#board').innerHTML = h;
  $('#dice').innerHTML = f && f.kind === 'move' ? f.item.dice.map(v => dieHTML(v, f.item.pl)).join('') : '';
}

/* ---------- side panel ---------- */
const name = pl => esc(RV.players[pl]);
const pct = x => `${(x * 100).toFixed(1)}%`;
function renderPlayers() {
  const bar = pl => {
    const s = RV.stats[pl];
    return `<div class="avatar ${pl}">${name(pl)[0].toUpperCase()}</div>
      <div class="pinfo"><div class="pline">${name(pl)}${RV.result.winner === pl ? ' <span class="badge">WINNER</span>' : ''}</div>
      <div class="psub"><span>PR <b>${s.pr.toFixed(1)}</b></span><span>Luck <b>${s.luck > 0 ? '+' : ''}${s.luck.toFixed(2)}</b></span></div></div>
      <span class="acc-chip" title="Accuracy">${s.accuracy.toFixed(1)}%</span>`;
  };
  $('#p-top').innerHTML = bar(OPP[bottom]);
  $('#p-bottom').innerHTML = bar(bottom);
}
function renderEval() {
  const f = frames[idx], wB = bottom === 'w' ? f.winW : 1 - f.winW;
  $('#evalbar').classList.toggle('flip', bottom === 'r');
  $('#evalfill').style.height = `${wB * 100}%`;
  $('#evalTop').textContent = Math.round((1 - wB) * 100);
  $('#evalBot').textContent = Math.round(wB * 100);
}
function graphSVG() {
  const W = 300, H = 90, n = frames.length - 1;
  const x = i => (i / n) * W, y = f => (1 - f.winW) * H;
  let d = `M0 ${H} ` + frames.map((f, i) => `L${x(i).toFixed(1)} ${y(f).toFixed(1)}`).join(' ') + ` L${W} ${H} Z`;
  let dots = '';
  frames.forEach((f, i) => {
    const r = f.item && (f.item.rating || '');
    if (['mistake', 'blunder'].includes(r)) dots += `<circle cx="${x(i)}" cy="${y(f)}" r="3.2" fill="${RT[r].color}" stroke="#262522" stroke-width="1"/>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" id="graphSvg">
    <path d="${d}" fill="#f1ece2"/><line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="#8b8987" stroke-width=".6" stroke-dasharray="3 3"/>
    ${dots}<line id="gcur" x1="0" x2="0" y1="0" y2="${H}" stroke="#81b64c" stroke-width="2"/></svg>`;
}
function renderSummary() {
  const s = RV.stats;
  const r = RV.result;
  $('#rvSub').innerHTML = `${name('w')} vs ${name('r')} · <b>${name(r.winner)}</b> won ${r.points ? `${r.points} pt${r.points > 1 ? 's' : ''} ` : ''}by ${REASON[r.reason] || r.reason}`;
  const card = pl => `<div class="sum-p ${pl}"><span class="nm"><span class="dot" style="background:${pl === 'w' ? '#f1ece2' : '#2b2623'};box-shadow:inset 0 0 0 1px #6e6c6a"></span>${name(pl)}</span>
    <span class="lbl">Accuracy</span><span class="acc">${s[pl].accuracy.toFixed(1)}</span><span class="pr">PR <b>${s[pl].pr.toFixed(1)}</b> · ${s[pl].decisions} decisions</span></div>`;
  const row = k => {
    const a = s.w.counts[k] || 0, b = s.r.counts[k] || 0;
    return `<div class="crow"><span class="c ${a ? '' : 'z'}">${a}</span><span class="rlabel">${badge(k)}</span><span class="c ${b ? '' : 'z'}">${b}</span></div>`;
  };
  $('#rvBody').innerHTML = `
    <div class="sum">${card('w')}${card('r')}</div>
    <div class="counts">${COUNTED.map(row).join('')}
      <div class="crow"><span class="c">${s.w.luck > 0 ? '+' : ''}${s.w.luck.toFixed(2)}</span><span class="rlabel" style="color:var(--muted)">Luck</span><span class="c">${s.r.luck > 0 ? '+' : ''}${s.r.luck.toFixed(2)}</span></div>
    </div>
    <div class="sec">Winning chances · ${name('w')} (light)</div>
    <div class="graph">${graphSVG()}</div>
    <div class="coach" id="coach"></div>
    <div class="sec">Moves</div>
    <div class="rv-moves" id="rvMoves"></div>
    <div class="empty" style="padding:8px 14px 18px">Analysed by GNU Backgammon (${RV.plies}-ply). Equity is the expected points won; PR is average equity lost per decision × 500.</div>`;
  $('#graphSvg').addEventListener('click', e => {
    const r = e.currentTarget.getBoundingClientRect();
    go(Math.round(((e.clientX - r.left) / r.width) * (frames.length - 1)));
  });
  $('#rvMoves').innerHTML = frames.map((f, i) => {
    if (!f.item) return '';
    const it = f.item;
    const txt = it.type === 'move' ? (it.played.notation || '<i>no legal move</i>')
      : it.type === 'double' ? `Doubles → ${f.cube.v * 2}` : it.type === 'take' ? 'Takes' : 'Drops';
    const dice = it.type === 'move' ? `<span class="dd"><span>${it.dice[0]}</span><span>${it.dice[1]}</span></span>` : '<span></span>';
    return `<div class="rv-row" data-i="${i}"><span class="n">${f.turn}.</span><span class="c" style="background:${it.pl === 'w' ? '#f1ece2' : '#2b2623'};box-shadow:inset 0 0 0 1px #6e6c6a"></span>${dice}<span class="mv">${txt}</span>${['forced', 'no-move'].includes(it.rating) ? '<span></span>' : badge(it.rating)}</div>`;
  }).join('');
  $('#rvMoves').addEventListener('click', e => { const r = e.target.closest('[data-i]'); if (r) go(+r.dataset.i); });
}
function renderCoach() {
  const f = frames[idx], el = $('#coach');
  if (!el) return;
  let c = '#6e6c6a', h = '';
  if (f.kind === 'start') h = `<div class="head">Starting position</div><div class="detail">Step through the game with <b>→</b>, or click any move or the graph.</div>`;
  else if (f.kind === 'end') {
    const r = RV.result; c = '#81b64c';
    h = `<div class="head">${name(r.winner)} wins</div><div class="detail">${r.points ? `${r.points} point${r.points > 1 ? 's' : ''} ` : ''}by ${REASON[r.reason] || r.reason}.</div>`;
  } else if (f.kind === 'move') {
    const it = f.item, m = RT[it.rating] || RT.unknown, opts = it.options || [];
    c = m.color;
    if (it.rating === 'no-move') h = `<div class="head">${badge('no-move')}${name(it.pl)} rolled ${it.dice.join('-')} — no legal move</div>`;
    else {
      h = `<div class="head">${badge(it.rating)}<span>${name(it.pl)}: <b>${esc(it.played.notation)}</b> ${m.text}</span></div>`;
      const mine = opts.find(o => o.rank === it.playedIndex + 1), best = opts[0];
      if (best && it.playedIndex > 0) {
        const winDiff = mine ? (best.probs[0] - mine.probs[0]) * 100 : null;
        h += `<div class="detail">−${it.loss.toFixed(3)} equity${winDiff !== null ? ` · ${winDiff >= 0 ? '−' : '+'}${Math.abs(winDiff).toFixed(1)}% winning chances` : ''}<br>Best was <b>${esc(best.notation)}</b> <span style="color:#81b64c">(green arrows)</span></div>`;
      } else if (mine) h += `<div class="detail">Winning chances after this move: <b>${pct(mine.probs[0])}</b> · gammon ${pct(mine.probs[1])}</div>`;
      if (opts.length > 1) {
        h += `<div class="opts">${opts.map((o, k) => `<div class="opt ${optSel === k ? 'sel' : ''}" data-opt="${k}"><span class="rk">${o.rank}.</span>
          <span class="mv">${esc(o.notation)}${o.rank === it.playedIndex + 1 ? '<small>PLAYED</small>' : ''}</span>
          <span class="eq">${o.rank === 1 ? o.eq.toFixed(3) : (o.eq - best.eq).toFixed(3)}</span><span class="win">${pct(o.probs[0])}</span></div>`).join('')}</div>`;
      }
    }
    if (it.cubeError) h += `<div class="warn">⚠ Missed double — ${name(it.pl)} should have doubled before this roll (−${it.cubeError.loss.toFixed(3)})</div>`;
  } else {
    const it = f.item, m = RT[it.rating];
    c = m.color;
    const what = it.type === 'double' ? `doubles to ×${f.cube.v * 2}` : it.type === 'take' ? 'takes' : 'drops';
    h = `<div class="head">${badge(it.rating)}<span>${name(it.pl)} ${what} — ${m.label.toLowerCase()}</span></div>`;
    if (it.best) h += `<div class="detail">${it.loss > 0.0005 ? `−${it.loss.toFixed(3)} equity · ` : ''}Correct decision: <b>${it.best}</b></div>`;
  }
  el.style.setProperty('--c', c);
  el.innerHTML = h;
  el.querySelectorAll('[data-opt]').forEach(o => o.onclick = () => { optSel = optSel === +o.dataset.opt ? null : +o.dataset.opt; renderBoard(); renderCoach(); });
}
function go(i) {
  idx = Math.max(0, Math.min(frames.length - 1, i));
  optSel = null;
  renderBoard(); renderEval(); renderCoach();
  document.querySelectorAll('.rv-row').forEach(r => r.classList.toggle('cur', +r.dataset.i === idx));
  const cur = document.querySelector('.rv-row.cur'), box = $('#rvMoves');
  if (cur && box) {   // keep the current row visible inside the move list without scrolling the panel
    const top = cur.offsetTop;   // .rv-moves is position:relative, so this is already relative to the box
    if (top < box.scrollTop || top + cur.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top - box.clientHeight / 2;
  }
  const g = $('#gcur'); if (g) { const x = (idx / (frames.length - 1)) * 300; g.setAttribute('x1', x); g.setAttribute('x2', x); }
  const f = frames[idx];
  $('#posLabel').textContent = f.kind === 'start' ? 'Start' : f.kind === 'end' ? 'Final position' : `Turn ${f.turn}`;
}

/* ---------- loading ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function load() {
  const rec = await fetch(`/api/games/${gameId}`);
  if (!rec.ok) return fail('This game could not be found. Reviews are kept for games played on this server.');
  let a = await (await fetch(`/api/games/${gameId}/analysis`)).json();
  if (a.status === 'none' || a.status === 'error') a = await (await fetch(`/api/games/${gameId}/analysis`, { method: 'POST' })).json();
  const t0 = Date.now();
  while (a.status !== 'done') {
    if (a.status === 'error') return fail('The analysis failed. Please try again in a minute.');
    if (Date.now() - t0 > 5 * 60 * 1000) return fail('The analysis is taking too long. Please try again later.');
    $('#rvWaitTxt').textContent = a.status === 'queued' && a.position > 1 ? `Waiting in line (#${a.position})…` : 'GNU Backgammon is checking every move…';
    await sleep(1500);
    a = await (await fetch(`/api/games/${gameId}/analysis`)).json();
  }
  RV = a.review;
  frames = buildFrames(RV);
  renderPlayers(); renderSummary();
  go(1);
}
function fail(msg) {
  $('#rvSub').textContent = 'Review unavailable';
  $('#rvBody').innerHTML = `<div class="rv-wait"><b>Could not load the review</b><span>${esc(msg)}</span><a class="btn-gray" href="/" style="display:grid;place-items:center;padding:0 16px;text-decoration:none;margin-top:8px">Back to Tavla</a></div>`;
}

document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => {
  if (!RV) return;
  const k = b.dataset.go;
  go(k === 'first' ? 0 : k === 'last' ? frames.length - 1 : k === 'prev' ? idx - 1 : idx + 1);
});
$('#flipBtn').onclick = () => { bottom = OPP[bottom]; if (RV) { renderPlayers(); go(idx); } };
document.addEventListener('keydown', e => {
  if (!RV) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); go(idx + 1); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); go(idx - 1); }
  if (e.key === 'Home') go(0);
  if (e.key === 'End') go(frames.length - 1);
  if (e.key === 'f' || e.key === 'F') $('#flipBtn').click();
});
$('#board').innerHTML = boardBase();
load();
