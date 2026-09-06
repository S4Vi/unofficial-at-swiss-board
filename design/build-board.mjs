/**
 * Builds the AT XXII Swiss board: the whole tournament as ONE connected flow,
 * in the style of the RLCS / PGL Major Swiss graphics.
 *
 * Structure is identical across every theme (it is settled):
 *   - X axis  = rounds 1..5, one column each.
 *   - Y axis  = record buckets within a round, best record at the top.
 *   - Winners arrow UP-RIGHT into the (w+1, l) bucket of the next round.
 *   - Losers  arrow DOWN-RIGHT into the (w, l+1) bucket.
 *   - A team's journey is the path you trace through those buckets.
 *
 * Only the THEME varies between artboards.
 *
 * Run: node design/build-board.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(resolve(HERE, '../docs/data/tournament.json'), 'utf8'));
const byId = new Map(data.matches.map((m) => [m.id, m]));
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const truncate = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/* ================= shared layout (never varies) ================= */
const COL_W = 292;
const GUTTER = 86;
const ROW_H = 36;
const B_HEAD = 30;
const B_PAD = 7;
const B_GAP = 30;
const PAD_L = 44;
const TRACE_TEAM = 'The Tuskers Co.';

const rounds = data.bracket.map((b) => ({
  round: b.round,
  buckets: b.buckets.map((bk) => ({ record: bk.record, matches: bk.matchIds.map((id) => byId.get(id)) })),
}));

const stackHeight = (r) =>
  r.buckets.reduce((a, bk) => a + B_HEAD + B_PAD * 2 + bk.matches.length * ROW_H, 0) +
  (r.buckets.length - 1) * B_GAP;

const BRACKET_H = Math.max(...rounds.map(stackHeight));
const BRACKET_W = PAD_L + rounds.length * COL_W + (rounds.length - 1) * GUTTER + PAD_L;

const pos = new Map();
const rowPos = new Map();
rounds.forEach((r, i) => {
  const x = PAD_L + i * (COL_W + GUTTER);
  let y = (BRACKET_H - stackHeight(r)) / 2;
  for (const bk of r.buckets) {
    const h = B_HEAD + B_PAD * 2 + bk.matches.length * ROW_H;
    pos.set(`${r.round}:${bk.record}`, { x, y, w: COL_W, h });
    bk.matches.forEach((m, j) => {
      const ry = y + B_HEAD + B_PAD + j * ROW_H;
      rowPos.set(m.id, { cx: x + COL_W / 2, cy: ry + ROW_H / 2 });
    });
    y += h + B_GAP;
  }
});

const links = [];
rounds.forEach((r, i) => {
  const next = rounds[i + 1];
  if (!next) return;
  for (const bk of r.buckets) {
    const [w, l] = bk.record.split('-').map(Number);
    const from = pos.get(`${r.round}:${bk.record}`);
    for (const [target, kind] of [
      [`${w + 1}-${l}`, 'win'],
      [`${w}-${l + 1}`, 'loss'],
    ]) {
      const to = pos.get(`${next.round}:${target}`);
      if (!to) continue;
      links.push({ x1: from.x + from.w, y1: from.y + from.h / 2, x2: to.x, y2: to.y + to.h / 2, kind });
    }
  }
});

const traced = data.standings.find((t) => t.name === TRACE_TEAM);
const traceIds = new Set(traced.path.map((p) => p.matchId));
const tracePts = traced.path.map((p) => rowPos.get(p.matchId)).filter(Boolean);

const DECIDED = data.matches.filter((m) => m.winner).length;
const spread = {};
for (const t of data.standings) {
  const k = `${t.wins}-${t.losses}`;
  spread[k] = (spread[k] ?? 0) + 1;
}
const spreadEntries = Object.entries(spread).sort(
  (a, b) => Number.parseInt(b[0], 10) - Number.parseInt(a[0], 10) || a[0].localeCompare(b[0]),
);

const DISCLAIMER =
  'UNOFFICIAL COMMUNITY PROJECT &mdash; not affiliated with CCP Games or the Alliance Tournament organisers.';

/* ================= themes ================= */
/* ramp[i] maps a record differential of (i-3): index 0 = -3, index 6 = +3 */
const THEMES = [
  {
    id: 'Main',
    name: 'Broadcast',
    blurb: 'Navy + condensed caps. The current one.',
    fonts: 'https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Archivo:wght@400;500;600;700&display=swap',
    display: "Oswald, sans-serif",
    body: "Archivo, 'Segoe UI', sans-serif",
    bg: '#0b1526',
    panel: '#16243b',
    edge: '#24405f',
    ink: '#e8eef7',
    dim: '#6e88a8',
    faint: '#55708f',
    mid: '#8fa6c4',
    win: '#7dd3a0',
    loss: '#e05d5d',
    accent: '#f5a524',
    trace: '#f5a524',
    float: '#b47ee0',
    ramp: ['#c94a4a', '#e05d5d', '#e8a08a', '#8fa6c4', '#a3d9b1', '#7dd3a0', '#4ade80'],
    rowLine: 'rgba(11,21,38,0.7)',
    bannerBg: '#f5a524',
    bannerInk: '#23180a',
    connector: 'curve',
    connW: 2,
    connOp: 0.5,
    bucketRadius: '0',
    bucketBorder: (c) => `1.5px solid ${c}44`,
    bucketLeft: (c) => `4px solid ${c}`,
    headBg: (c) => `${c}1c`,
    glow: null,
  },
  {
    id: 'NeonMajor',
    name: 'Neon Major',
    blurb: 'PGL-style neon glow on near-black. Loudest option.',
    fonts: 'https://fonts.googleapis.com/css2?family=Saira+Condensed:wght@600;700;800&family=Saira:wght@400;500;600&display=swap',
    display: "'Saira Condensed', sans-serif",
    body: 'Saira, sans-serif',
    bg: 'radial-gradient(ellipse 90% 70% at 20% 0%, #241033 0%, #14071d 45%, #0a040e 100%)',
    panel: 'rgba(28,12,40,0.82)',
    edge: '#40206a',
    ink: '#f6ecff',
    dim: '#9b7fb8',
    faint: '#6d5486',
    mid: '#b79ad0',
    win: '#22e07a',
    loss: '#ff2d78',
    accent: '#ffd23f',
    trace: '#ffd23f',
    float: '#5fd8ff',
    ramp: ['#ff2d78', '#ff5c92', '#ff8fb0', '#b79ad0', '#7de5aa', '#22e07a', '#00ff88'],
    rowLine: 'rgba(255,255,255,0.05)',
    bannerBg: '#ff2d78',
    bannerInk: '#1a0009',
    connector: 'glow',
    connW: 2.5,
    connOp: 0.75,
    bucketRadius: '9px',
    bucketBorder: (c) => `1.5px solid ${c}`,
    bucketLeft: (c) => `1.5px solid ${c}`,
    headBg: (c) => `${c}22`,
    glow: (c) => `box-shadow: 0 0 16px ${c}44, inset 0 0 22px ${c}14;`,
  },
  {
    id: 'CapsuleerHUD',
    name: 'Capsuleer HUD',
    blurb: 'In-game overlay. Hairlines, mono numerals, right-angle traces.',
    fonts: 'https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap',
    display: "'Chakra Petch', sans-serif",
    body: "'Chakra Petch', sans-serif",
    mono: "'IBM Plex Mono', monospace",
    bg: '#05090b',
    bgImage:
      'linear-gradient(rgba(45,212,231,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(45,212,231,0.035) 1px, transparent 1px)',
    bgSize: '34px 34px',
    panel: 'rgba(9,19,23,0.86)',
    edge: 'rgba(45,212,231,0.28)',
    ink: '#dff6fa',
    dim: '#4d7a86',
    faint: '#2b6473',
    mid: '#5f9dab',
    win: '#2dd4e7',
    loss: '#f0a930',
    accent: '#f0a930',
    trace: '#f0a930',
    float: '#a882f0',
    ramp: ['#c2701a', '#e09628', '#f0a930', '#4d7a86', '#22a8bd', '#2dd4e7', '#7ae7f3'],
    rowLine: 'rgba(45,212,231,0.09)',
    bannerBg: 'rgba(240,169,48,0.12)',
    bannerInk: '#f0a930',
    bannerBorder: '1px solid rgba(240,169,48,0.45)',
    connector: 'orthogonal',
    connW: 1.4,
    connOp: 0.65,
    bucketRadius: '0',
    bucketBorder: (c) => `1px solid ${c}55`,
    bucketLeft: (c) => `2px solid ${c}`,
    headBg: (c) => `${c}14`,
    glow: null,
  },
  {
    id: 'Editorial',
    name: 'Editorial Light',
    blurb: 'Light, printed-programme feel. Easiest to read for long stretches.',
    fonts: 'https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,300;0,500;0,600;1,400&family=Public+Sans:wght@400;500;600;700&display=swap',
    display: "'Newsreader', serif",
    body: "'Public Sans', sans-serif",
    bg: '#faf7f0',
    panel: '#ffffff',
    edge: '#e2dcd0',
    ink: '#16150f',
    dim: '#8c8272',
    faint: '#a39684',
    mid: '#6f6555',
    win: '#0f7a4f',
    loss: '#a8392f',
    accent: '#b8860b',
    trace: '#a8392f',
    float: '#7b5ea8',
    ramp: ['#8f2f26', '#a8392f', '#c98a5e', '#8c8272', '#4a9b6e', '#0f7a4f', '#0a5c3b'],
    rowLine: '#efeae0',
    bannerBg: '#16150f',
    bannerInk: '#f5efe2',
    connector: 'curve',
    connW: 1.3,
    connOp: 0.55,
    bucketRadius: '0',
    bucketBorder: (c) => `1px solid ${c}55`,
    bucketLeft: (c) => `3px solid ${c}`,
    headBg: (c) => `${c}12`,
    glow: null,
    light: true,
  },
  {
    id: 'AmarrGold',
    name: 'Amarr Gold',
    blurb: 'Warm gold on charcoal, serif display. Ceremonial rather than sporty.',
    fonts: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=Jost:wght@300;400;500;600&display=swap',
    display: "'Cormorant Garamond', serif",
    body: 'Jost, sans-serif',
    bg: 'radial-gradient(ellipse 100% 80% at 50% 0%, #1c1710 0%, #100d08 50%, #080704 100%)',
    panel: '#15110a',
    edge: '#3d3venue',
    ink: '#f2e8d2',
    dim: '#8a7a5c',
    faint: '#6b5c42',
    mid: '#a8946f',
    win: '#e0c060',
    loss: '#a05242',
    accent: '#d4af37',
    trace: '#7fd4c4',
    float: '#9a86c4',
    ramp: ['#8c4237', '#a05242', '#b87a5a', '#8a7a5c', '#c9ad6a', '#e0c060', '#f5dc8a'],
    rowLine: 'rgba(212,175,55,0.08)',
    bannerBg: 'rgba(212,175,55,0.11)',
    bannerInk: '#d4af37',
    bannerBorder: '1px solid rgba(212,175,55,0.4)',
    connector: 'curve',
    connW: 1.6,
    connOp: 0.6,
    bucketRadius: '0',
    bucketBorder: (c) => `1px solid ${c}3a`,
    bucketLeft: (c) => `2px solid ${c}`,
    headBg: (c) => `${c}16`,
    glow: null,
  },
];
// small typo guard for a hand-written token
THEMES.find((t) => t.id === 'AmarrGold').edge = '#3d3424';

const bucketColor = (T, record) => {
  const [w, l] = record.split('-').map(Number);
  return T.ramp[Math.max(0, Math.min(6, w - l + 3))];
};

/* ================= render one themed board ================= */
function makeBoard(T) {
  const mono = T.mono ?? T.display;

  const linkPath = (L) => {
    if (T.connector === 'orthogonal') {
      const mid = L.x1 + (L.x2 - L.x1) / 2;
      return `M ${L.x1} ${L.y1} H ${mid} V ${L.y2} H ${L.x2 - 9}`;
    }
    const dx = (L.x2 - L.x1) * 0.5;
    return `M ${L.x1} ${L.y1} C ${L.x1 + dx} ${L.y1}, ${L.x2 - dx} ${L.y2}, ${L.x2 - 9} ${L.y2}`;
  };

  const svgLinks = links
    .map((L) => {
      const c = L.kind === 'win' ? T.win : T.loss;
      const under =
        T.connector === 'glow'
          ? `<path d="${linkPath(L)}" fill="none" stroke="${c}" stroke-opacity="0.18" stroke-width="${T.connW + 5}"/>`
          : '';
      return `${under}<path d="${linkPath(L)}" fill="none" stroke="${c}" stroke-opacity="${T.connOp}" stroke-width="${T.connW}" marker-end="url(#${T.id}-${L.kind})"/>`;
    })
    .join('');

  let tracePath = '';
  tracePts.forEach((p, i) => {
    if (i === 0) {
      tracePath = `M ${p.cx} ${p.cy}`;
    } else {
      const q = tracePts[i - 1];
      if (T.connector === 'orthogonal') {
        const mid = q.cx + (p.cx - q.cx) / 2;
        tracePath += ` H ${mid} V ${p.cy} H ${p.cx}`;
      } else {
        const dx = (p.cx - q.cx) * 0.45;
        tracePath += ` C ${q.cx + dx} ${q.cy}, ${p.cx - dx} ${p.cy}, ${p.cx} ${p.cy}`;
      }
    }
  });

  const tick = (c, s = 10) =>
    `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><path d="M4 12.5l5.5 5.5L20 6.5"/></svg>`;

  const matchRow = (m) => {
    const onTrace = traceIds.has(m.id);
    const side = (name, won) => {
      const isTraced = onTrace && name === TRACE_TEAM;
      return `<div style="display: flex; align-items: center; gap: 6px; height: 16px;">
            <span style="flex-grow: 1; min-width: 0; font-size: 11.5px; line-height: 16px; font-weight: ${won ? '700' : '400'}; color: ${isTraced ? T.trace : won ? T.ink : T.dim}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${esc(name)}">${esc(truncate(name, 30))}</span>
            ${won ? tick(T.win) : '<span style="width: 10px; flex-shrink: 0;"></span>'}
          </div>`;
    };
    return `<div style="display: flex; gap: 7px; height: ${ROW_H}px; box-sizing: border-box; padding: 2px 8px; align-items: center; border-bottom: 1px solid ${T.rowLine}; ${onTrace ? `background: ${T.trace}1c; box-shadow: inset 2px 0 0 ${T.trace};` : ''}">
          <span style="width: 26px; flex-shrink: 0; font-family: ${mono}; font-size: 10px; color: ${m.winner ? T.faint : T.accent};">${m.isFloat ? `<span style="color:${T.float};">&#9670;</span>` : ''}${m.id}</span>
          <div style="flex-grow: 1; min-width: 0;">${side(m.red, m.winner === m.red)}${side(m.blue, m.winner === m.blue)}</div>
        </div>`;
  };

  const bucketBox = (r, bk) => {
    const p = pos.get(`${r.round}:${bk.record}`);
    const c = bucketColor(T, bk.record);
    return `<div style="position: absolute; left: ${p.x}px; top: ${p.y}px; width: ${p.w}px; height: ${p.h}px; box-sizing: border-box; background: ${T.panel}; border: ${T.bucketBorder(c)}; border-left: ${T.bucketLeft(c)}; border-radius: ${T.bucketRadius}; ${T.glow ? T.glow(c) : ''}">
        <div style="display: flex; align-items: center; justify-content: space-between; height: ${B_HEAD}px; padding: 0 9px; background: ${T.headBg(c)}; border-bottom: 1px solid ${c}33;">
          <span style="font-family: ${T.display}; font-size: ${T.id === 'AmarrGold' || T.id === 'Editorial' ? '19' : '16'}px; font-weight: 700; color: ${c}; letter-spacing: 0.05em;">${bk.record.replace('-', '&ndash;')}</span>
          <span style="font-size: 9.5px; color: ${T.mid}; letter-spacing: 0.1em;">${bk.matches.length} MATCH${bk.matches.length === 1 ? '' : 'ES'}</span>
        </div>
        <div style="padding: ${B_PAD}px 0;">${bk.matches.map(matchRow).join('')}</div>
      </div>`;
  };

  const roundHeaders = rounds
    .map((r, i) => {
      const x = PAD_L + i * (COL_W + GUTTER);
      const done = r.buckets.every((bk) => bk.matches.every((m) => m.winner));
      return `<div style="position: absolute; left: ${x}px; top: 0; width: ${COL_W}px; text-align: center;">
        <div style="font-family: ${T.display}; font-size: 19px; font-weight: 600; letter-spacing: 0.14em; color: ${done ? T.ink : T.accent};">ROUND ${r.round}</div>
        <div style="font-size: 9.5px; letter-spacing: 0.12em; color: ${T.faint}; margin-top: 3px;">${done ? 'COMPLETE' : 'IN PROGRESS'} &middot; 29 MATCHES</div>
      </div>`;
    })
    .join('');

  const spreadChips = spreadEntries
    .map(([rec, n]) => {
      const c = bucketColor(T, rec);
      return `<div style="display: flex; align-items: baseline; gap: 6px; padding: 5px 11px; background: ${T.panel}; border-left: 3px solid ${c}; border-radius: ${T.bucketRadius};">
        <span style="font-family: ${T.display}; font-size: 14px; font-weight: 700; color: ${c};">${rec.replace('-', '&ndash;')}</span>
        <span style="font-size: 10.5px; color: ${T.mid};">${n} team${n === 1 ? '' : 's'}</span>
      </div>`;
    })
    .join('');

  const traceLegend = traced.path
    .map((p) => {
      const col = p.result === 'win' ? T.win : p.result === 'loss' ? T.loss : T.accent;
      return `<div style="display: flex; align-items: center; gap: 7px;">
      <span style="font-family: ${mono}; font-size: 10px; color: ${T.faint}; width: 16px;">R${p.round}</span>
      <span style="font-family: ${mono}; font-size: 11px; color: ${T.mid}; width: 26px;">${p.record}</span>
      <span style="font-size: 11px; color: ${col}; font-weight: 600; width: 46px;">${p.result === 'win' ? 'WON' : p.result === 'loss' ? 'LOST' : 'TO PLAY'}</span>
      <span style="font-size: 11px; color: ${T.dim}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(truncate(p.opponent, 26))}</span>
    </div>`;
    })
    .join('');

  const HEADER_H = 208;
  const FOOT_H = 96;
  const W = BRACKET_W;
  const H = HEADER_H + BRACKET_H + FOOT_H;

  const arrow = (c) =>
    `<svg width="30" height="10"><path d="M0 5 L24 5" stroke="${c}" stroke-width="2.5"/><path d="M23 1 L29 5 L23 9 Z" fill="${c}"/></svg>`;

  return {
    W,
    H,
    html: `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="${T.fonts}">
  <style>
    body { margin: 0; }
    a { color: ${T.win}; text-decoration: none; }
    a:hover { color: ${T.accent}; }
  </style>
</helmet>

<div style="width: ${W}px; height: ${H}px; box-sizing: border-box; background: ${T.bg}; ${T.bgImage ? `background-image: ${T.bgImage}; background-size: ${T.bgSize};` : ''} font-family: ${T.body}; color: ${T.ink}; position: relative; overflow: hidden;">

  <div style="display: flex; align-items: center; gap: 10px; padding: 9px ${PAD_L}px; background: ${T.bannerBg}; color: ${T.bannerInk}; font-size: 12px; font-weight: 600; letter-spacing: 0.03em; ${T.bannerBorder ? `border-bottom: ${T.bannerBorder};` : ''}">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${T.bannerInk}" stroke-width="2.2" stroke-linecap="round"><path d="M12 9v5"/><path d="M12 17.5v.01"/><circle cx="12" cy="12" r="9.5"/></svg>
    <span>${DISCLAIMER}</span>
  </div>

  <div style="display: flex; align-items: flex-end; justify-content: space-between; padding: 20px ${PAD_L}px 16px;">
    <div>
      <div style="font-family: ${T.display}; font-size: ${T.display.includes('Cormorant') ? '46' : '38'}px; font-weight: 700; letter-spacing: 0.02em; line-height: 1; ${T.display.includes('Newsreader') || T.display.includes('Cormorant') ? '' : 'text-transform: uppercase;'}">Alliance Tournament XXII <span style="color: ${T.accent};">Swiss Board</span></div>
      <div style="font-size: 12.5px; color: ${T.mid}; margin-top: 7px; letter-spacing: 0.05em;">Every team plays all 5 rounds &middot; paired against equal records &middot; follow a line to follow a team</div>
    </div>
    <div style="display: flex; gap: 22px; align-items: center;">
      <div style="display: flex; align-items: center; gap: 7px;">${arrow(T.win)}<span style="font-size: 11px; color: ${T.mid};">winners rise</span></div>
      <div style="display: flex; align-items: center; gap: 7px;">${arrow(T.loss)}<span style="font-size: 11px; color: ${T.mid};">losers drop</span></div>
      <div style="background: ${T.panel}; border: 1px solid ${T.edge}; padding: 8px 14px; border-radius: ${T.bucketRadius};">
        <div style="font-size: 9.5px; color: ${T.mid}; letter-spacing: 0.1em;">DECIDED</div>
        <div style="font-family: ${T.display}; font-size: 20px; font-weight: 600;">${DECIDED}<span style="color: ${T.faint}; font-size: 14px;">/${data.matches.length}</span></div>
      </div>
    </div>
  </div>

  <div style="position: absolute; left: 0; top: ${HEADER_H - 56}px; width: ${W}px; height: 46px;">${roundHeaders}</div>

  <div style="position: absolute; left: 0; top: ${HEADER_H}px; width: ${W}px; height: ${BRACKET_H}px;">
    <svg width="${W}" height="${BRACKET_H}" style="position: absolute; left: 0; top: 0;">
      <defs>
        <marker id="${T.id}-win" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 Z" fill="${T.win}" fill-opacity="0.8"/></marker>
        <marker id="${T.id}-loss" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 Z" fill="${T.loss}" fill-opacity="0.8"/></marker>
      </defs>
      ${svgLinks}
    </svg>
    ${rounds.map((r) => r.buckets.map((bk) => bucketBox(r, bk)).join('')).join('')}
    <svg width="${W}" height="${BRACKET_H}" style="position: absolute; left: 0; top: 0; pointer-events: none;">
      <path d="${tracePath}" fill="none" stroke="${T.trace}" stroke-width="2.5" stroke-dasharray="7 4" stroke-opacity="0.95"/>
      ${tracePts.map((p) => `<circle cx="${p.cx}" cy="${p.cy}" r="4.5" fill="${T.trace}"/>`).join('')}
    </svg>
  </div>

  <div style="position: absolute; left: 0; top: ${HEADER_H + BRACKET_H}px; width: ${W}px; height: ${FOOT_H}px; box-sizing: border-box; padding: 16px ${PAD_L}px; border-top: 1px solid ${T.edge}; display: flex; gap: 34px; align-items: flex-start;">
    <div style="width: 440px; flex-shrink: 0;">
      <div style="font-size: 9.5px; color: ${T.faint}; letter-spacing: 0.14em; margin-bottom: 7px;">TRACED JOURNEY &middot; <span style="color: ${T.trace};">${esc(traced.name.toUpperCase())}</span> &middot; hovering any team does this</div>
      <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px 24px;">${traceLegend}</div>
    </div>
    <div style="flex-grow: 1;">
      <div style="font-size: 9.5px; color: ${T.faint}; letter-spacing: 0.14em; margin-bottom: 7px;">RECORDS SO FAR &middot; ROUND 5 STILL IN PLAY</div>
      <div style="display: flex; gap: 7px; flex-wrap: wrap;">${spreadChips}</div>
    </div>
    <div style="width: 240px; flex-shrink: 0; text-align: right;">
      <div style="font-size: 9.5px; color: ${T.faint}; letter-spacing: 0.14em; margin-bottom: 7px;">${esc(T.name.toUpperCase())}</div>
      <div style="font-size: 10.5px; color: ${T.dim}; line-height: 1.7;">
        <div><span style="color:${T.float};">&#9670;</span> down-float &mdash; unequal records</div>
        <div><span style="color:${T.accent};">amber match no.</span> &mdash; not yet played</div>
      </div>
    </div>
  </div>
</div>
</x-dc>
</body>
</html>
`,
  };
}

/* ================= emit ================= */
const artboards = [];
const COLS = 3;
const GAP_X = 150;
const GAP_Y = 230;

THEMES.forEach((T, i) => {
  const { W, H, html } = makeBoard(T);
  const file = `${T.id}.dc.html`;
  writeFileSync(resolve(HERE, file), html, 'utf8');
  artboards.push({
    file,
    title: `${T.name} — ${T.blurb}`,
    x: (i % COLS) * (W + GAP_X),
    y: Math.floor(i / COLS) * (H + GAP_Y),
    w: W,
    h: H,
  });
  console.log(`  ${file.padEnd(24)} ${String(html.length).padStart(7)} bytes  ${W}x${H}`);
});

const canvas = {
  artboards,
  annotations: [
    {
      id: 'how-to-read',
      x: 0,
      y: -260,
      w: 900,
      text:
        'Same board, five looks. The structure is identical in all of them — only the styling differs.\n\n' +
        'Columns = rounds. Blocks = every team on that win-loss record. Green arrows carry winners up\n' +
        'into the next record, red arrows drop losers down. The dashed line traces one team\n' +
        '(The Tuskers Co.: won, lost, won, lost) all the way through; on the real site it follows whoever you hover.\n\n' +
        'Pick one and it becomes the site.',
    },
  ],
  launch: { view: 'canvas' },
};
writeFileSync(resolve(HERE, 'canvas.json'), `${JSON.stringify(canvas, null, 2)}\n`, 'utf8');
console.log(`  canvas.json  ${artboards.length} artboards`);
