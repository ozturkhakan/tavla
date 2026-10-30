// Computer opponent: picks a full play for a roll, answers doubles and decides when to double.
// Positions are scored with a hand-tuned heuristic; "hard" also looks one roll ahead.
const R = require('./shared/rules');

// noise: random spread added to scores; blunder: chance of playing any legal play at all.
const LEVELS = {
  easy: { noise: 10, blunder: 0.4, lookahead: false, doubles: false },
  medium: { noise: 0, blunder: 0, lookahead: false, doubles: true },
  hard: { noise: 0, blunder: 0, lookahead: true, doubles: true },
};
const LEVEL_NAMES = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

const clone = g => ({ board: [...g.board], bar: { ...g.bar }, off: { ...g.off }, dice: g.dice.map(d => ({ ...d })) });
const posKey = g => g.board.join(',') + '|' + g.bar.w + g.bar.r + '|' + g.off.w + ',' + g.off.r;

// Every distinct legal play for the dice in g: [{ seq: [[from, to], ...], pos }].
// Follows the rules the server does not enforce for humans: use as many dice as possible, and the higher die if only one fits.
function plays(g, pl) {
  const out = new Map(), seen = new Set();
  let most = 0;
  (function walk(pos, seq, used) {
    const key = posKey(pos) + '|' + pos.dice.map(d => +d.used).join('');
    if (seen.has(key)) return;
    seen.add(key);
    const ms = R.allMoves(pos, pl);
    if (!ms.length || pos.off[pl] === 15) {
      if (seq.length < most) return;
      if (seq.length > most) { most = seq.length; out.clear(); }
      const k = posKey(pos);
      if (!out.has(k)) out.set(k, { seq, pos, used });
      return;
    }
    for (const m of ms) {
      const next = clone(pos);
      R.applyMove(next, pl, m.from, m.dest, m.idx);
      walk(next, [...seq, [m.from, m.dest]], [...used, m.v]);
    }
  })(clone(g), [], []);
  let list = [...out.values()];
  if (most === 1 && g.dice.length === 2 && g.dice[0].v !== g.dice[1].v) {
    const hi = Math.max(g.dice[0].v, g.dice[1].v);
    if (list.some(p => p.used[0] === hi)) list = list.filter(p => p.used[0] === hi);
  }
  return list;
}

/* ---------- evaluation ---------- */
// Rolls out of 36 that hit a blot `d` pips away (ignoring blocking points).
const SHOTS = [0, 11, 12, 14, 15, 15, 17, 6, 6, 5, 3, 2, 3, 0, 0, 1, 1, 0, 1, 0, 1, 0, 0, 0, 1];

// Checker counts by distance from home: mine[i] for my checkers i pips from off (25 = bar),
// opp[i] for the opponent's checkers at the same board spot (so they are 25 - i pips from their off).
function view(pos, pl) {
  const mine = Array(26).fill(0), opp = Array(26).fill(0), sg = R.SIGN[pl];
  for (let p = 1; p <= 24; p++) {
    const i = pl === 'w' ? p : 25 - p, n = pos.board[p] * sg;
    if (n > 0) mine[i] = n; else if (n < 0) opp[i] = -n;
  }
  mine[25] = pos.bar[pl];
  opp[0] = pos.bar[R.OPP[pl]];   // the opponent enters from my far side, i.e. "below" index 1
  return { mine, opp };
}

// Score of `pos` for `pl` (higher is better), roughly in pips.
function evaluate(pos, pl) {
  const op = R.OPP[pl];
  if (pos.off[pl] === 15) return 1000;
  if (pos.off[op] === 15) return -1000;
  const { mine, opp } = view(pos, pl);
  const myPips = R.pips(pos, pl), oppPips = R.pips(pos, op);
  let myBack = 0, oppBack = 25;
  for (let i = 25; i >= 1; i--) if (mine[i]) { myBack = i; break; }
  for (let i = 0; i <= 24; i++) if (opp[i]) { oppBack = i; break; }
  let s = oppPips - myPips;

  // Pure race: pips, checkers off and wasted pips on deep stacks.
  if (myBack < oppBack) {
    s += (pos.off[pl] - pos.off[op]) * 2;
    for (let i = 1; i <= 3; i++) s -= Math.max(0, mine[i] - 2) * 0.6;
    return s + 8;   // a little extra for having escaped
  }

  // Blots: chance of being hit times what a hit costs.
  for (let i = 1; i <= 24; i++) {
    if (mine[i] !== 1) continue;
    let miss = 1;
    for (let j = 0; j < i; j++) if (opp[j]) miss *= 1 - SHOTS[Math.min(24, i - j)] / 36;
    const risk = 1 - miss;
    if (risk > 0) s -= risk * (25 - i + 6 + (i <= 6 ? 4 : 0));
  }

  // Made points, home board and primes.
  let run = 0, prime = 0, home = 0;
  for (let i = 1; i <= 24; i++) {
    if (mine[i] >= 2) {
      run++; prime = Math.max(prime, run);
      s += i <= 6 ? 3.5 : i <= 9 ? 2.5 : i >= 19 ? 2 : 1;   // home, bar area, anchors, the rest
      if (i <= 6) home++;
      if (i === 5 || i === 4 || i === 7) s += 1.5;
      if (mine[i] > 3) s -= (mine[i] - 3) * 0.7;
    } else run = 0;
  }
  s += prime >= 3 ? (prime - 2) * (prime - 2) * 2 : 0;

  // Opponent on the bar is worth more the more of my home board is closed.
  s += opp[0] * (3 + home * 1.8);
  if (home === 6 && opp[0]) s += 10;

  // My checkers stuck far back behind the opponent's points.
  let oppHome = 0, oppRun = 0, oppPrime = 0;
  for (let i = 24; i >= 1; i--) {
    if (opp[i] >= 2) { oppRun++; oppPrime = Math.max(oppPrime, oppRun); if (i >= 19) oppHome++; } else oppRun = 0;
  }
  s -= mine[25] * (3 + oppHome * 1.8);
  s -= oppPrime >= 3 ? (oppPrime - 2) * (oppPrime - 2) * 2 : 0;
  return s;
}

// Rough chance that `pl` wins from `pos` with `onRoll` to play next.
function winChance(pos, pl, onRoll) {
  // Scale fitted to the bot's own self-play results: the further from home, the less a lead is worth.
  const s = evaluate(pos, pl) + (onRoll === pl ? 2 : -2);
  const myPips = Math.max(1, R.pips(pos, pl));
  return 1 / (1 + Math.exp(-s / (2 + myPips * 0.33)));
}

/* ---------- decisions ---------- */
const ROLLS = [];
for (let a = 1; a <= 6; a++) for (let b = a; b <= 6; b++) ROLLS.push([a, b, a === b ? 1 : 2]);

// Average score for `pl` after the opponent replies to `pos` with their best play for each roll.
function lookahead(pos, pl) {
  const op = R.OPP[pl];
  let sum = 0;
  for (const [a, b, w] of ROLLS) {
    const g = { ...pos, dice: R.diceFor(a, b) };
    const replies = plays(g, op);
    let best = replies.length ? -Infinity : evaluate(pos, op);
    for (const r of replies) best = Math.max(best, evaluate(r.pos, op));
    sum += -best * w;
  }
  return sum / 36;
}

// The play (list of [from, to]) the bot makes with the dice in g.
function choosePlay(g, pl, level) {
  const cfg = LEVELS[level] || LEVELS.medium;
  const list = plays(g, pl);
  if (!list.length) return [];
  if (Math.random() < cfg.blunder) return list[Math.floor(Math.random() * list.length)].seq;
  for (const p of list) p.score = evaluate(p.pos, pl) + (cfg.noise ? (Math.random() - 0.5) * 2 * cfg.noise : 0);
  list.sort((a, b) => b.score - a.score);
  if (cfg.lookahead && list.length > 1) {
    const top = list.slice(0, 6);
    for (const p of top) p.score = lookahead(p.pos, pl);
    top.sort((a, b) => b.score - a.score);
    return top[0].seq;
  }
  return list[0].seq;
}

// Should `pl` (on roll, holding or sharing the cube) offer a double?
function wantsDouble(g, pl, level, score, matchTo) {
  if (!(LEVELS[level] || LEVELS.medium).doubles) return false;
  if (g.cube.owner === R.OPP[pl] || g.cube.v >= 64) return false;
  if (score[pl] + g.cube.v >= matchTo) return false;   // already enough to win the match
  const p = winChance(g, pl, pl);
  return p >= 0.7 && p < 0.92;   // above that, play on for a gammon
}

// Take a double offered to `pl`?
function takesDouble(g, pl, level) {
  const p = winChance(g, pl, R.OPP[pl]);
  return p >= ((LEVELS[level] || LEVELS.medium).doubles ? 0.33 : 0.2);
}

module.exports = { LEVELS, LEVEL_NAMES, plays, evaluate, choosePlay, wantsDouble, takesDouble, winChance };
