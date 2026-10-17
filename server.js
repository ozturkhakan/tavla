// Tavla online: private backgammon tables shared by link.
// The server owns the game state and validates every action; clients only render it.
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const R = require('./shared/rules');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));
app.get('/t/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'table.html')));
app.get('/healthz', (req, res) => res.send('ok'));

/* ---------- rooms ---------- */
const rooms = new Map();
const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
function newId() {
  let id;
  do { id = Array.from(crypto.randomBytes(6), b => ALPHA[b % ALPHA.length]).join(''); } while (rooms.has(id));
  return id;
}
const clean = (s, n) => String(s || '').replace(/[<>]/g, '').trim().slice(0, n);
const pick = (v, allowed, def) => (allowed.includes(Number(v)) ? Number(v) : def);

function createRoom(opts = {}) {
  const room = {
    id: newId(),
    settings: {
      matchTo: pick(opts.matchTo, [1, 3, 5, 7, 9, 11, 12, 15], 5),
      clockMin: pick(opts.clockMin, [0, 1, 3, 5, 10, 15], 5),
      inc: pick(opts.inc, [0, 3, 5, 10, 15], 5),
    },
    seats: { w: null, r: null },          // {token, name, sockets:Set}
    specs: new Map(),                     // socketId -> name
    score: { w: 0, r: 0 },
    matchOver: false,
    gameNo: 0,
    g: null,
    clock: { w: 0, r: 0, running: null, since: 0 },
    chat: [],
    timer: null,
    emptySince: Date.now(),
  };
  rooms.set(room.id, room);
  return room;
}

function sys(room, text) { room.chat.push({ sys: true, text, t: Date.now() }); trimChat(room); }
function trimChat(room) { if (room.chat.length > 100) room.chat.splice(0, room.chat.length - 100); }
const nameOf = (room, pl) => (room.seats[pl] ? room.seats[pl].name : pl === 'w' ? 'White' : 'Dark');

/* ---------- clocks ---------- */
const hasClock = room => room.settings.clockMin > 0;
function remaining(room, pl) {
  const c = room.clock;
  return Math.max(0, c[pl] - (c.running === pl ? Date.now() - c.since : 0));
}
function runClock(room, pl) {
  if (!hasClock(room)) return;
  const c = room.clock;
  if (c.running) c[c.running] = remaining(room, c.running);
  c.running = pl; c.since = Date.now();
}
function stopClock(room) {
  const c = room.clock;
  if (c.running) c[c.running] = remaining(room, c.running);
  c.running = null;
}

/* ---------- game flow ---------- */
function startGame(room) {
  clearTimeout(room.timer);
  if (room.gameNo === 0) {
    room.clock = { w: room.settings.clockMin * 60000, r: room.settings.clockMin * 60000, running: null, since: 0 };
  }
  room.gameNo++;
  const g = Object.assign(R.newPosition(), {
    turn: null, phase: 'move', cube: { v: 1, owner: null }, pendingDouble: null,
    history: [], undo: [], hl: [], result: null, noMoves: false,
  });
  // Opening roll: each side throws one die, higher die moves first using both.
  let a, b;
  do { a = R.die(); b = R.die(); } while (a === b);
  g.turn = a > b ? 'w' : 'r';
  g.dice = R.diceFor(a, b);
  g.history.push({ pl: g.turn, dice: [a, b], moves: [] });
  room.g = g;
  sys(room, `Game ${room.gameNo} — opening roll: <b>${nameOf(room, 'w')}</b> ${a}, <b>${nameOf(room, 'r')}</b> ${b}. <b>${nameOf(room, g.turn)}</b> starts.`);
  runClock(room, g.turn);
  afterRoll(room);
}

function afterRoll(room) {
  const g = room.g;
  g.undo = []; g.noMoves = false;
  if (!R.allMoves(g, g.turn).length) {
    g.noMoves = true;
    room.timer = setTimeout(() => { if (room.g === g && g.phase === 'move') { endTurn(room); broadcast(room); } }, 1600);
  }
}

function endTurn(room) {
  const g = room.g;
  clearTimeout(room.timer);
  if (hasClock(room)) { room.clock[g.turn] = remaining(room, g.turn) + room.settings.inc * 1000; room.clock.running = null; }
  g.turn = R.OPP[g.turn];
  g.phase = 'roll'; g.dice = []; g.undo = []; g.noMoves = false;
  runClock(room, g.turn);
}

function finishGame(room, winner, points, reason) {
  const g = room.g;
  clearTimeout(room.timer);
  stopClock(room);
  room.score[winner] += points;
  if (room.score[winner] >= room.settings.matchTo || reason === 'time') room.matchOver = true;
  g.phase = 'over';
  g.pendingDouble = null;
  g.result = { winner, points, reason, matchOver: room.matchOver };
  const how = { single: 'single game', gammon: 'gammon', backgammon: 'backgammon', resign: 'resignation', drop: 'declined double', time: 'time' }[reason];
  sys(room, `<b>${nameOf(room, winner)}</b> wins ${points ? `${points} point${points > 1 ? 's' : ''} ` : ''}by ${how}. Score ${room.score.w}–${room.score.r}.`);
}

/* ---------- state sent to clients ---------- */
function publicState(room) {
  const seat = pl => room.seats[pl] && { name: room.seats[pl].name, connected: room.seats[pl].sockets.size > 0 };
  const g = room.g && { ...room.g, undo: undefined, undoCount: room.g.undo.length };
  return {
    id: room.id, settings: room.settings, score: room.score, matchOver: room.matchOver, gameNo: room.gameNo,
    seats: { w: seat('w'), r: seat('r') }, spectators: [...room.specs.values()],
    g, chat: room.chat.slice(-60),
    clock: { w: remaining(room, 'w'), r: remaining(room, 'r'), running: room.clock.running },
  };
}
const broadcast = room => io.to(room.id).emit('state', publicState(room));

/* ---------- sockets ---------- */
io.on('connection', socket => {
  const ctx = () => {
    const room = rooms.get(socket.data.roomId);
    return room ? { room, seat: socket.data.seat, g: room.g } : null;
  };
  // Run a player action; only the seated player whose turn it is may act (checked per action).
  const act = fn => (...args) => {
    const c = ctx();
    if (!c || !c.g) return;
    if (fn(c, ...args) !== false) broadcast(c.room);
    else socket.emit('state', publicState(c.room));
  };

  socket.on('create', (opts, cb) => {
    const room = createRoom(opts || {});
    if (typeof cb === 'function') cb({ id: room.id });
  });

  socket.on('join', ({ id, token, name } = {}, cb) => {
    const room = rooms.get(String(id || ''));
    if (!room) return typeof cb === 'function' && cb({ error: 'This table does not exist (it may have expired).' });
    token = clean(token, 64); name = clean(name, 20) || 'Guest';
    let seat = ['w', 'r'].find(pl => room.seats[pl] && room.seats[pl].token === token);
    if (!seat) seat = ['w', 'r'].find(pl => !room.seats[pl]);
    if (seat) {
      const isNew = !room.seats[seat];
      room.seats[seat] = room.seats[seat] || { token, name, sockets: new Set() };
      room.seats[seat].name = name;
      room.seats[seat].sockets.add(socket.id);
      if (isNew) sys(room, `<b>${name}</b> sat down as ${seat === 'w' ? 'White' : 'Dark'}`);
    } else {
      seat = null;
      room.specs.set(socket.id, name);
      sys(room, `<b>${name}</b> is watching`);
    }
    socket.data = { roomId: room.id, seat, name };
    socket.join(room.id);
    room.emptySince = null;
    if (room.seats.w && room.seats.r && !room.g) startGame(room);
    if (typeof cb === 'function') cb({ seat });
    broadcast(room);
  });

  socket.on('roll', act(({ room, seat, g }) => {
    if (seat !== g.turn || g.phase !== 'roll') return false;
    const a = R.die(), b = R.die();
    g.dice = R.diceFor(a, b);
    g.hl = [];
    g.history.push({ pl: seat, dice: [a, b], moves: [] });
    g.phase = 'move';
    afterRoll(room);
  }));

  socket.on('move', act(({ room, seat, g }, { from, to } = {}) => {
    if (seat !== g.turn || g.phase !== 'move' || g.noMoves) return false;
    const okFrom = from === 'bar' || (Number.isInteger(from) && from >= 1 && from <= 24);
    const okTo = to === 'off' || (Number.isInteger(to) && to >= 1 && to <= 24);
    if (!okFrom || !okTo) return false;
    const m = R.findMove(g, seat, from, to);
    if (!m) return false;
    g.undo.push(JSON.stringify({ board: g.board, bar: g.bar, off: g.off, dice: g.dice, hl: g.hl }));
    const note = R.applyMove(g, seat, from, to, m.idx);
    g.history[g.history.length - 1].moves.push(note);
    g.hl.push(from, to);
    if (g.off[seat] === 15) {
      const kind = R.winKind(g, seat);
      finishGame(room, seat, kind * g.cube.v, ['', 'single', 'gammon', 'backgammon'][kind]);
    } else if (!R.allMoves(g, seat).length) {
      endTurn(room);
    }
  }));

  socket.on('undo', act(({ seat, g }) => {
    if (seat !== g.turn || g.phase !== 'move' || !g.undo.length) return false;
    Object.assign(g, JSON.parse(g.undo.pop()));
    g.history[g.history.length - 1].moves.pop();
  }));

  socket.on('double', act(({ room, seat, g }) => {
    if (seat !== g.turn || g.phase !== 'roll' || g.cube.owner === R.OPP[seat] || g.cube.v >= 64) return false;
    g.phase = 'double';
    g.pendingDouble = seat;
    runClock(room, R.OPP[seat]);
    sys(room, `<b>${nameOf(room, seat)}</b> offers a double to ×${g.cube.v * 2}`);
  }));

  socket.on('answerDouble', act(({ room, seat, g }, accept) => {
    if (g.phase !== 'double' || seat !== R.OPP[g.pendingDouble]) return false;
    const offerer = g.pendingDouble;
    if (accept) {
      g.cube = { v: g.cube.v * 2, owner: seat };
      g.phase = 'roll';
      g.pendingDouble = null;
      runClock(room, offerer);
      sys(room, `<b>${nameOf(room, seat)}</b> accepts — cube is now ×${g.cube.v}`);
    } else {
      finishGame(room, offerer, g.cube.v, 'drop');
    }
  }));

  socket.on('resign', act(({ room, seat, g }, level) => {
    level = [1, 2, 3].includes(level) ? level : 1;
    if (!seat || g.phase === 'over') return false;
    finishGame(room, R.OPP[seat], level * g.cube.v, 'resign');
  }));

  socket.on('next', act(({ room, seat, g }) => {
    if (!seat || g.phase !== 'over' || !room.seats.w || !room.seats.r) return false;
    if (room.matchOver) { room.score = { w: 0, r: 0 }; room.matchOver = false; room.gameNo = 0; }
    startGame(room);
  }));

  socket.on('chat', text => {
    const c = ctx();
    text = clean(text, 300);
    if (!c || !text) return;
    c.room.chat.push({ name: socket.data.name, seat: c.seat, text, t: Date.now() });
    trimChat(c.room);
    broadcast(c.room);
  });

  socket.on('disconnect', () => {
    const c = ctx();
    if (!c) return;
    const { room } = c;
    if (c.seat && room.seats[c.seat]) room.seats[c.seat].sockets.delete(socket.id);
    room.specs.delete(socket.id);
    if (!io.sockets.adapter.rooms.get(room.id)?.size) room.emptySince = Date.now();
    broadcast(room);
  });
});

/* ---------- flag fall + cleanup ---------- */
setInterval(() => {
  for (const room of rooms.values()) {
    const pl = room.clock.running;
    if (pl && room.g && room.g.phase !== 'over' && remaining(room, pl) <= 0) {
      room.clock[pl] = 0;
      finishGame(room, R.OPP[pl], 0, 'time');
      broadcast(room);
    }
  }
}, 250);
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, room] of rooms) if (room.emptySince && room.emptySince < cutoff) rooms.delete(id);
}, 5 * 60 * 1000);

server.listen(PORT, () => console.log(`Tavla running on http://localhost:${PORT}`));
