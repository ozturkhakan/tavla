// Board drawing shared by the live table and the review page (SVG, viewBox 1000x660).
// "View" points v are 1..24 as seen from the bottom player; real points p map with viewPoint().
const B = { L: 24, R: 488, COL: 68, BX: 432, BW: 56, TX: 908, TW: 68, Y0: 22, Y1: 638, PH: 262, CR: 29 };

function ptX(v) {
  if (v <= 6) return B.R + (6 - v) * B.COL + 34; if (v <= 12) return B.L + (12 - v) * B.COL + 34;
  if (v <= 18) return B.L + (v - 13) * B.COL + 34; return B.R + (v - 19) * B.COL + 34;
}
const stackY = (v, i, n) => { const step = n > 5 ? 232 / (n - 1) : 58; return v >= 13 ? B.Y0 + B.CR + 1 + i * step : B.Y1 - B.CR - 1 - i * step; };
const triPts = v => { const x = ptX(v); return v >= 13 ? `${x - 33},${B.Y0} ${x + 33},${B.Y0} ${x},${B.Y0 + B.PH}` : `${x - 33},${B.Y1} ${x + 33},${B.Y1} ${x},${B.Y1 - B.PH}`; };
const viewPoint = (p, bottom) => (bottom === 'w' ? p : 25 - p);

function checker(pl, x, y, extra = '', cls = '') {
  return `<g transform="translate(${x},${y})"><g class="${cls}">
    <circle r="${B.CR}" fill="url(#g${pl})" stroke="var(--c${pl}-edge)" stroke-width="2"/>
    <circle r="${B.CR - 8}" fill="none" stroke="rgba(0,0,0,.16)" stroke-width="2"/>
    <circle r="${B.CR - 9.5}" fill="none" stroke="rgba(255,255,255,${pl === 'w' ? 0.8 : 0.14})" stroke-width="1"/>
    ${extra}</g></g>`;
}

function dieHTML(v, pl, cls = '') {
  const on = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] }[v];
  return `<div class="die ${pl} ${cls}">${Array.from({ length: 9 }, (_, i) => `<i class="${on.includes(i) ? 'on' : ''}"></i>`).join('')}</div>`;
}

// Frame, field, points and point numbers.
function boardBase() {
  let h = `<defs>
    <radialGradient id="gw" cx=".38" cy=".32" r=".75"><stop offset="0" style="stop-color:var(--cw-1)"/><stop offset=".6" style="stop-color:var(--cw-2)"/><stop offset="1" style="stop-color:var(--cw-3)"/></radialGradient>
    <radialGradient id="gr" cx=".38" cy=".32" r=".75"><stop offset="0" style="stop-color:var(--cr-1)"/><stop offset=".6" style="stop-color:var(--cr-2)"/><stop offset="1" style="stop-color:var(--cr-3)"/></radialGradient>
    <filter id="wood" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.006 0.16" numOctaves="3" seed="4"/>
      <feColorMatrix values="0 0 0 0 .12  0 0 0 0 .06  0 0 0 0 .02  2.2 0 0 0 -.85"/></filter>
    <filter id="leather" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="9"/>
      <feColorMatrix values="0 0 0 0 .35  0 0 0 0 .25  0 0 0 0 .12  .9 0 0 0 -.3"/></filter>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".10"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".12"/></linearGradient>
    <marker id="ah-best" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#81b64c"/></marker>
    <marker id="ah-played" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#f7c045"/></marker>
    <marker id="ah-bad" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#e85d4f"/></marker>
  </defs>
  <rect width="1000" height="660" style="fill:var(--frame)"/>
  <rect x="${B.BX}" y="${B.Y0}" width="${B.BW}" height="616" style="fill:var(--frame-2)"/>
  <rect x="${B.TX}" y="${B.Y0}" width="${B.TW}" height="616" style="fill:var(--frame-2)"/>
  <rect width="1000" height="660" filter="url(#wood)" style="opacity:var(--grain)"/>
  <rect width="1000" height="660" fill="url(#sheen)" style="opacity:var(--grain)"/>
  <rect x="${B.L}" y="${B.Y0}" width="408" height="616" style="fill:var(--felt-1)"/>
  <rect x="${B.R}" y="${B.Y0}" width="408" height="616" style="fill:var(--felt-1)"/>
  <rect x="${B.L}" y="${B.Y0}" width="408" height="616" filter="url(#leather)" style="opacity:var(--grain)"/>
  <rect x="${B.R}" y="${B.Y0}" width="408" height="616" filter="url(#leather)" style="opacity:var(--grain)"/>
  <line x1="${B.TX}" x2="${B.TX + B.TW}" y1="330" y2="330" stroke="rgba(0,0,0,.35)" stroke-width="2"/>`;
  for (let v = 1; v <= 24; v++) {
    h += `<polygon points="${triPts(v)}" style="fill:var(${v % 2 ? '--pa' : '--pb'});stroke:var(--pt-edge);stroke-width:1.5;stroke-linejoin:round"/>`;
    h += `<text x="${ptX(v)}" y="${v >= 13 ? B.Y0 - 7 : B.Y1 + 16}" text-anchor="middle" font-size="11" font-weight="700" style="fill:var(--num)" font-family="Segoe UI,Arial,sans-serif">${v}</text>`;
  }
  return h;
}

// Checkers on points, bar and tray plus the cube, for position {board, bar, off} and cube {v, owner}.
// `ghost` (a real point or 'bar') draws that top checker faded, for drag and drop.
function boardPieces(pos, cube, bottom, ghost = null) {
  const top = bottom === 'w' ? 'r' : 'w';
  let h = '';
  for (let p = 1; p <= 24; p++) {
    const val = pos.board[p]; if (!val) continue;
    const pl = val > 0 ? 'w' : 'r', n = Math.abs(val), v = viewPoint(p, bottom), x = ptX(v);
    for (let i = 0; i < n; i++) {
      const isTop = i === n - 1;
      const extra = isTop && n > 5 ? `<text y="6" text-anchor="middle" font-size="17" font-weight="800" font-family="Segoe UI,Arial,sans-serif" style="fill:var(--c${pl}-ink)">${n}</text>` : '';
      h += checker(pl, x, stackY(v, i, n), extra, isTop && ghost === p ? 'lifted-ghost' : '');
    }
  }
  const bx = B.BX + B.BW / 2;
  for (let i = 0; i < pos.bar[top]; i++) h += checker(top, bx, 240 - i * 18);
  for (let i = 0; i < pos.bar[bottom]; i++) h += checker(bottom, bx, 420 + i * 18, '', i === pos.bar[bottom] - 1 && ghost === 'bar' ? 'lifted-ghost' : '');
  if (cube) {
    const cy = cube.owner === bottom ? 575 : cube.owner === top ? 85 : 330;
    h += `<g transform="translate(${bx},${cy})"><rect x="-21" y="-19" width="42" height="42" rx="6" fill="#b9b7b4"/><rect x="-21" y="-21" width="42" height="42" rx="6" fill="#fff"/>
      <text y="6" text-anchor="middle" font-size="${cube.v >= 10 ? 16 : 18}" font-weight="800" font-family="Segoe UI,Arial,sans-serif" fill="#312e2b">${cube.v === 1 ? 64 : cube.v}</text></g>`;
  }
  for (let i = 0; i < pos.off[top]; i++) h += `<rect x="${B.TX + 9}" y="${B.Y0 + 10 + i * 19}" width="${B.TW - 18}" height="16" rx="3" fill="url(#g${top})" stroke="var(--c${top}-edge)" stroke-width="1.5"/>`;
  for (let i = 0; i < pos.off[bottom]; i++) h += `<rect x="${B.TX + 9}" y="${B.Y1 - 26 - i * 19}" width="${B.TW - 18}" height="16" rx="3" fill="url(#g${bottom})" stroke="var(--c${bottom}-edge)" stroke-width="1.5"/>`;
  return h;
}
