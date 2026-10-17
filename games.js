// Finished-game records, gnubg analysis queue and review data.
// Records and analyses are JSON files under DATA_DIR (default ./data).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const R = require('./shared/rules');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const GAMES_DIR = path.join(DATA_DIR, 'games');
const REVIEW_DIR = path.join(DATA_DIR, 'reviews');
const WORK_DIR = path.join(DATA_DIR, 'work');
for (const d of [GAMES_DIR, REVIEW_DIR, WORK_DIR]) fs.mkdirSync(d, { recursive: true });

const GNUBG_BIN = process.env.GNUBG_BIN || (process.platform === 'win32' ? 'C:\\Program Files (x86)\\gnubg\\gnubg-cli.exe' : 'gnubg');
const PLIES = process.env.ANALYSIS_PLIES || '2';
const SCRIPT = path.join(__dirname, 'analysis', 'analyse.py');

const newGameId = () => crypto.randomBytes(6).toString('hex');
const validId = id => /^[a-f0-9]{12}$/.test(String(id));
const gameFile = id => path.join(GAMES_DIR, id + '.json');
const reviewFile = id => path.join(REVIEW_DIR, id + '.json');
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };

/* ---------- records ---------- */
const snapshot = g => ({ board: [...g.board], bar: { ...g.bar }, off: { ...g.off } });

// room.g.log entries: {type:'move', h, pos, cube} | {type:'double'|'take'|'drop'|'resign'|'timeout', pl, ...}
function saveRecord(room) {
  const g = room.g;
  const turns = g.log.map(e => e.type === 'move'
    ? { type: 'move', pl: e.h.pl, dice: e.h.dice, pos: e.pos, cube: e.cube, moves: [...e.h.moves], plays: e.h.plays.map(p => [...p]) }
    : { ...e });
  // A resign or flag-fall in the middle of a turn leaves an unfinished move: keep it out of the analysis.
  const end = turns[turns.length - 1];
  if (end && (end.type === 'resign' || end.type === 'timeout') && end.phase === 'move') {
    for (let i = turns.length - 2; i >= 0; i--) if (turns[i].type === 'move') { turns[i].incomplete = true; break; }
  }
  const rec = {
    id: g.id, roomId: room.id, finishedAt: Date.now(),
    matchTo: room.settings.matchTo, gameNo: room.gameNo, startScore: g.startScore,
    players: { w: room.seats.w ? room.seats.w.name : 'White', r: room.seats.r ? room.seats.r.name : 'Dark' },
    result: { winner: g.result.winner, points: g.result.points, reason: g.result.reason },
    turns,
  };
  fs.writeFile(gameFile(g.id), JSON.stringify(rec), err => err && console.error('save game', err));
  return rec;
}
const loadRecord = id => (validId(id) ? readJson(gameFile(id)) : null);

/* ---------- .mat export (Jellyfish text format, as gnubg writes it) ---------- */
function toMat(rec) {
  const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length));
  const cells = [];
  for (const t of rec.turns) {
    if (t.type === 'move' && !t.incomplete) {
      const p = x => (x === 'bar' ? 25 : x === 'off' ? 0 : t.pl === 'w' ? x : 25 - x);
      const [a, b] = t.dice;
      // No "*" hit marks: gnubg reads fixed-width columns and a 4-move double with marks would overflow its 28 chars.
      cells.push({ pl: t.pl, text: `${Math.max(a, b)}${Math.min(a, b)}: ${t.plays.map(([f, to]) => `${p(f)}/${p(to)}`).join(' ')}` });
    } else if (t.type === 'double') cells.push({ pl: t.pl, text: ` Doubles => ${t.cube}` });
    else if (t.type === 'take') cells.push({ pl: t.pl, text: ' Takes' });
    else if (t.type === 'drop') cells.push({ pl: t.pl, text: ' Drops' });
  }
  const rows = [];
  for (const c of cells) {
    const row = rows[rows.length - 1];
    if (!row || (c.pl === 'w' && (row.w !== undefined || row.r !== undefined)) || (c.pl === 'r' && row.r !== undefined)) rows.push({ [c.pl]: c.text });
    else row[c.pl] = c.text;
  }
  const s = rec.startScore;
  const lines = [` ${rec.matchTo} point match`, '', ' Game 1', ` ${pad(`White : ${s.w}`, 31)}Dark : ${s.r}`];
  rows.forEach((r, i) => lines.push(`${String(i + 1).padStart(3)}) ${pad(r.w || '', 28)}${r.r || ''}`.trimEnd()));
  const pts = rec.result.points || 1;
  const wins = `Wins ${pts} point${pts > 1 ? 's' : ''}`;
  lines.push(rec.result.winner === 'w' ? `      ${wins}` : `${' '.repeat(34)}${wins}`);
  return lines.join('\n') + '\n';
}

/* ---------- gnubg queue ---------- */
const status = new Map();       // id -> 'queued' | 'running' | 'error'
const queue = [];
let busy = false;

function requestAnalysis(id) {
  if (!validId(id) || !fs.existsSync(gameFile(id))) return { status: 'missing' };
  if (fs.existsSync(reviewFile(id))) return { status: 'done' };
  if (!status.has(id) || status.get(id) === 'error') { status.set(id, 'queued'); queue.push(id); pump(); }
  return { status: status.get(id), position: queue.indexOf(id) + 1 };
}
function getAnalysis(id) {
  if (!validId(id)) return { status: 'missing' };
  const review = readJson(reviewFile(id));
  if (review) return { status: 'done', review };
  return { status: status.get(id) || (fs.existsSync(gameFile(id)) ? 'none' : 'missing'), position: queue.indexOf(id) + 1 };
}

function pump() {
  if (busy || !queue.length) return;
  busy = true;
  const id = queue.shift();
  status.set(id, 'running');
  const rec = loadRecord(id);
  const mat = path.join(WORK_DIR, id + '.mat'), out = path.join(WORK_DIR, id + '.out.json');
  const done = err => {
    if (err) { console.error('analysis', id, err.message || err); status.set(id, 'error'); }
    else status.delete(id);
    for (const f of [mat, out]) fs.rm(f, { force: true }, () => {});
    busy = false; pump();
  };
  try { fs.writeFileSync(mat, toMat(rec)); } catch (e) { return done(e); }
  execFile(GNUBG_BIN, ['-t', '-q', '-p', SCRIPT], {
    env: { ...process.env, TAVLA_MAT: mat, TAVLA_OUT: out, TAVLA_PLIES: PLIES }, timeout: 5 * 60 * 1000, maxBuffer: 16 * 1024 * 1024, windowsHide: true,
  }, err => {
    if (err) return done(err);
    try {
      const review = buildReview(rec, JSON.parse(fs.readFileSync(out, 'utf8')));
      fs.writeFileSync(reviewFile(id), JSON.stringify(review));
      done();
    } catch (e) { done(e); }
  });
}

/* ---------- review building ---------- */
// Thresholds on equity lost per decision (gnubg's doubtful/bad/very bad are 0.04/0.08/0.16).
function rate(loss) {
  if (loss < 0.0005) return 'best';
  if (loss < 0.02) return 'excellent';
  if (loss < 0.04) return 'good';
  if (loss < 0.08) return 'inaccuracy';
  if (loss < 0.16) return 'mistake';
  return 'blunder';
}

// gnubg move tuples are in the mover's numbering (25 = bar, 0 = off); turn them into our notation + real-board plays.
function convertMove(tuples, pos, pl) {
  const g = { board: [...pos.board], bar: { ...pos.bar }, off: { ...pos.off } };
  const sg = R.SIGN[pl], op = R.OPP[pl];
  const plays = [], parts = [];
  for (const [f, t] of tuples) {
    const from = f === 25 ? 'bar' : pl === 'w' ? f : 25 - f;
    const to = t <= 0 ? 'off' : pl === 'w' ? t : 25 - t;
    let hit = false;
    if (from === 'bar') g.bar[pl]--; else g.board[from] -= sg;
    if (to === 'off') g.off[pl]++;
    else { if (g.board[to] === -sg) { g.board[to] = 0; g.bar[op]++; hit = true; } g.board[to] += sg; }
    plays.push([from, to, hit]);
    parts.push(`${f === 25 ? 'bar' : f}/${t <= 0 ? 'off' : t}${hit ? '*' : ''}`);
  }
  return { notation: parts.join(' '), plays };
}

function buildReview(rec, raw) {
  const game = raw.games && raw.games[0];
  if (!game) throw new Error('gnubg returned no game');
  const PL = { X: 'w', O: 'r' };
  const ourMoves = rec.turns.filter(t => t.type === 'move' && !t.incomplete);
  const items = [];
  const acc = { w: { loss: 0, decisions: 0, luck: 0, counts: {} }, r: { loss: 0, decisions: 0, luck: 0, counts: {} } };
  const count = (pl, rating, loss) => { const a = acc[pl]; a.decisions++; a.loss += loss; a.counts[rating] = (a.counts[rating] || 0) + 1; };
  let mi = 0, lastDouble = null;

  for (const a of game.game) {
    const pl = PL[a.player], an = a.analysis || {};
    if (a.action === 'move') {
      const t = ourMoves[mi++];
      if (!t) throw new Error('move count mismatch');
      const [d1, d2] = a.dice || [];
      if (a.dice && !((d1 === t.dice[0] && d2 === t.dice[1]) || (d1 === t.dice[1] && d2 === t.dice[0]))) throw new Error(`dice mismatch at move ${mi}`);
      const item = { type: 'move', pl, dice: t.dice, pos: t.pos, cube: t.cube, played: { notation: t.moves.join(' '), plays: t.plays }, luck: an['luck-value'] ?? null };
      if (typeof item.luck === 'number') acc[pl].luck += item.luck;
      if (an.probs) item.probs = an.probs;   // win, gammon, backgammon, lose gammon, lose backgammon (before the roll)
      if (an.moves && an.moves.length > 1) {
        const idx = Number.isInteger(an.imove) ? an.imove : an.moves.findIndex(m => JSON.stringify(m.move) === JSON.stringify(a.move));
        const best = an.moves[0].score, mine = idx >= 0 ? an.moves[idx].score : null;
        item.loss = mine === null ? null : Math.max(0, best - mine);
        item.rating = item.loss === null ? 'unknown' : rate(item.loss);
        item.playedIndex = idx;
        item.options = an.moves.slice(0, 5).map(m => ({ ...convertMove(m.move, t.pos, pl), eq: m.score, probs: m.probs }));
        if (item.loss !== null) count(pl, item.rating, item.loss);
      } else item.rating = t.plays.length ? 'forced' : 'no-move';
      // Pre-roll cube check: was this a missed double?
      const mayDouble = t.cube && t.cube.owner !== R.OPP[pl] && t.cube.v < 64 && items.length > 0;
      if (mayDouble && typeof an['nd-cubeful-eq'] === 'number' && typeof an['dt-cubeful-eq'] === 'number') {
        const nd = an['nd-cubeful-eq'], dbl = Math.min(an['dt-cubeful-eq'], 1);
        if (dbl - nd >= 0.04) {
          item.cubeError = { kind: 'missed-double', loss: dbl - nd, rating: rate(dbl - nd) };
          count(pl, item.cubeError.rating, item.cubeError.loss);
        }
      }
      items.push(item);
    } else if (a.action === 'double') {
      const nd = an['nd-cubeful-eq'], dt = an['dt-cubeful-eq'];
      const loss = typeof nd === 'number' ? Math.max(0, nd - Math.min(dt, 1)) : 0;
      lastDouble = { dt };
      const item = { type: 'double', pl, loss, rating: rate(loss), best: loss > 0 ? 'No double' : 'Double', nd, dt };
      count(pl, item.rating, loss);
      items.push(item);
    } else if (a.action === 'take' || a.action === 'drop') {
      const dt = lastDouble && lastDouble.dt;
      const loss = typeof dt !== 'number' ? 0 : a.action === 'take' ? Math.max(0, dt - 1) : Math.max(0, 1 - dt);
      const item = { type: a.action, pl, loss, rating: rate(loss), best: typeof dt === 'number' ? (dt > 1 ? 'Drop' : 'Take') : null };
      count(pl, item.rating, loss);
      items.push(item);
    }
  }

  const stats = {};
  for (const pl of ['w', 'r']) {
    const a = acc[pl];
    const pr = a.decisions ? (500 * a.loss) / a.decisions : 0;    // Performance Rating: avg equity lost × 500
    stats[pl] = {
      pr: Math.round(pr * 10) / 10,
      accuracy: Math.round(Math.max(0, Math.min(100, 100 - pr)) * 10) / 10,
      decisions: a.decisions, equityLost: Math.round(a.loss * 1000) / 1000,
      luck: Math.round(a.luck * 100) / 100, counts: a.counts,
    };
  }
  return {
    id: rec.id, analysedAt: Date.now(), plies: Number(PLIES), matchTo: rec.matchTo, startScore: rec.startScore,
    players: rec.players, result: rec.result, items, stats,
  };
}

module.exports = { newGameId, snapshot, saveRecord, loadRecord, toMat, requestAnalysis, getAnalysis, buildReview, validId };
