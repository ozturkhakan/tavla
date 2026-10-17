// Backgammon rules shared by the server (authoritative) and the browser (move hints).
// Board: index 1..24, positive = white ('w') checkers, negative = red/dark ('r').
// White moves 24 -> 1 and bears off from 1..6; red moves 1 -> 24 and bears off from 19..24.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Rules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const OPP = { w: 'r', r: 'w' };
  const SIGN = { w: 1, r: -1 };

  function newPosition() {
    const board = Array(25).fill(0);
    Object.assign(board, { 24: 2, 13: 5, 8: 3, 6: 5, 1: -2, 12: -5, 17: -3, 19: -5 });
    return { board, bar: { w: 0, r: 0 }, off: { w: 0, r: 0 }, dice: [] };
  }

  const own = (g, pl, p) => g.board[p] * SIGN[pl] > 0;
  const canLand = (g, pl, p) => g.board[p] * SIGN[pl] >= -1;

  function allHome(g, pl) {
    if (g.bar[pl]) return false;
    if (pl === 'w') { for (let q = 7; q <= 24; q++) if (g.board[q] > 0) return false; }
    else { for (let q = 1; q <= 18; q++) if (g.board[q] < 0) return false; }
    return true;
  }

  // Where a checker of `pl` on `from` ('bar' or 1..24) lands with die `d`, or null if illegal.
  function dest(g, pl, from, d) {
    if (g.bar[pl] > 0 && from !== 'bar') return null;
    if (from === 'bar') {
      if (!g.bar[pl]) return null;
      const p = pl === 'w' ? 25 - d : d;
      return canLand(g, pl, p) ? p : null;
    }
    if (!own(g, pl, from)) return null;
    const t = pl === 'w' ? from - d : from + d;
    if (t >= 1 && t <= 24) return canLand(g, pl, t) ? t : null;
    if (!allHome(g, pl)) return null;
    if (t === 0 || t === 25) return 'off';
    if (pl === 'w') { for (let q = from + 1; q <= 6; q++) if (g.board[q] > 0) return null; }
    else { for (let q = 19; q < from; q++) if (g.board[q] < 0) return null; }
    return 'off';
  }

  function targetsFrom(g, pl, from) {
    const out = [], seen = new Set();
    g.dice.forEach((d, i) => {
      if (d.used || seen.has(d.v)) return;
      seen.add(d.v);
      const t = dest(g, pl, from, d.v);
      if (t !== null) out.push({ from, dest: t, idx: i, v: d.v });
    });
    return out;
  }

  function sources(g, pl) {
    if (g.bar[pl]) return ['bar'];
    const a = [];
    for (let p = 1; p <= 24; p++) if (own(g, pl, p)) a.push(p);
    return a;
  }

  const allMoves = (g, pl) => sources(g, pl).flatMap(f => targetsFrom(g, pl, f));

  // Pick the die for a from->to move; when several dice work (bearing off) use the smallest.
  function findMove(g, pl, from, to) {
    return targetsFrom(g, pl, from).filter(t => t.dest === to).sort((a, b) => a.v - b.v)[0] || null;
  }

  function pips(g, pl) {
    let s = g.bar[pl] * 25;
    for (let p = 1; p <= 24; p++) { const n = g.board[p] * SIGN[pl]; if (n > 0) s += n * (pl === 'w' ? p : 25 - p); }
    return s;
  }

  const label = (pl, p) => (p === 'bar' ? 'bar' : p === 'off' ? 'off' : pl === 'w' ? p : 25 - p);

  // Mutates g. Returns the move's notation, e.g. "13/8*".
  function applyMove(g, pl, from, to, idx) {
    const sg = SIGN[pl], op = OPP[pl];
    let hit = false;
    if (from === 'bar') g.bar[pl]--; else g.board[from] -= sg;
    if (to === 'off') g.off[pl]++;
    else {
      if (g.board[to] === -sg) { g.board[to] = 0; g.bar[op]++; hit = true; }
      g.board[to] += sg;
    }
    g.dice[idx].used = true;
    return `${label(pl, from)}/${label(pl, to)}${hit ? '*' : ''}`;
  }

  // 1 = single, 2 = gammon, 3 = backgammon (for `winner` having borne off all 15).
  function winKind(g, winner) {
    const loser = OPP[winner];
    if (g.off[loser] > 0) return 1;
    if (g.bar[loser] > 0) return 3;
    for (let p = 1; p <= 24; p++) {
      const n = g.board[p] * SIGN[loser];
      if (n > 0 && (winner === 'w' ? p <= 6 : p >= 19)) return 3;
    }
    return 2;
  }

  const die = () => 1 + Math.floor(Math.random() * 6);
  function diceFor(a, b) {
    return (a === b ? [a, a, a, a] : [Math.max(a, b), Math.min(a, b)]).map(v => ({ v, used: false }));
  }

  return { OPP, SIGN, newPosition, own, dest, targetsFrom, sources, allMoves, findMove, pips, label, applyMove, winKind, die, diceFor };
});
