/* Unofficial AT XXII Swiss Board.
 *
 * Renders the whole tournament as one connected flow: rounds are columns,
 * record buckets stack within a column, winners arrow up-right into the next
 * record and losers drop down-right. Hovering or clicking a team traces its
 * journey across every round.
 */
(() => {
  'use strict';

  /* Bracket geometry. Mirrors design/build-board.mjs so the site matches the
   * approved design exactly. */
  const COL_W = 292;
  const GUTTER = 86;
  const ROW_H = 36;
  const B_HEAD = 30;
  const B_PAD = 7;
  const B_GAP = 30;
  const PAD_L = 44;
  const HEAD_H = 56;

  const NS = 'http://www.w3.org/2000/svg';

  const el = (id) => document.getElementById(id);
  const svgEl = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };

  const state = {
    data: null,
    byId: new Map(),
    teams: new Map(),
    pos: new Map(), // "round:record" -> box
    rowPos: new Map(), // matchId -> {cx, cy}
    pinned: null,
    hovered: null,
    zoom: 1,
    sort: { key: 'wins', dir: 'desc' },
  };

  /* Ramp by record differential (wins - losses), -3 .. +3. */
  const RAMP = ['#c94a4a', '#e05d5d', '#e8a08a', '#8fa6c4', '#a3d9b1', '#7dd3a0', '#4ade80'];
  function bucketColor(record) {
    const [w, l] = record.split('-').map(Number);
    return RAMP[Math.max(0, Math.min(6, w - l + 3))];
  }

  const dash = (record) => record.replace('-', '\u2013');

  /* ---------------- layout ---------------- */
  function computeLayout() {
    const { bracket } = state.data;
    const stackHeight = (r) =>
      r.buckets.reduce((a, bk) => a + B_HEAD + B_PAD * 2 + bk.matchIds.length * ROW_H, 0) +
      (r.buckets.length - 1) * B_GAP;

    const bracketH = Math.max(...bracket.map(stackHeight));
    state.pos.clear();
    state.rowPos.clear();

    bracket.forEach((r, i) => {
      const x = PAD_L + i * (COL_W + GUTTER);
      let y = HEAD_H + (bracketH - stackHeight(r)) / 2;
      for (const bk of r.buckets) {
        const h = B_HEAD + B_PAD * 2 + bk.matchIds.length * ROW_H;
        state.pos.set(`${r.round}:${bk.record}`, { x, y, w: COL_W, h, round: r.round, record: bk.record });
        bk.matchIds.forEach((id, j) => {
          const ry = y + B_HEAD + B_PAD + j * ROW_H;
          state.rowPos.set(id, { cx: x + COL_W / 2, cy: ry + ROW_H / 2 });
        });
        y += h + B_GAP;
      }
    });

    return {
      width: PAD_L + bracket.length * COL_W + (bracket.length - 1) * GUTTER + PAD_L,
      height: HEAD_H + bracketH + 40,
    };
  }

  /* Bucket-to-bucket flow: winners to (w+1, l), losers to (w, l+1). */
  function computeLinks() {
    const { bracket } = state.data;
    const links = [];
    bracket.forEach((r, i) => {
      const next = bracket[i + 1];
      if (!next) return;
      for (const bk of r.buckets) {
        const [w, l] = bk.record.split('-').map(Number);
        const from = state.pos.get(`${r.round}:${bk.record}`);
        for (const [target, kind] of [
          [`${w + 1}-${l}`, 'win'],
          [`${w}-${l + 1}`, 'loss'],
        ]) {
          const to = state.pos.get(`${next.round}:${target}`);
          if (!to) continue;
          links.push({
            x1: from.x + from.w,
            y1: from.y + from.h / 2,
            x2: to.x,
            y2: to.y + to.h / 2,
            kind,
          });
        }
      }
    });
    return links;
  }

  const curve = (x1, y1, x2, y2, endInset = 0) => {
    const dx = (x2 - x1) * 0.5;
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2 - endInset} ${y2}`;
  };

  /* ---------------- render ---------------- */
  function renderBracket() {
    const size = computeLayout();
    const root = el('bracket');
    root.textContent = '';
    root.style.width = `${size.width}px`;
    root.style.height = `${size.height}px`;

    // connector layer, beneath the buckets
    const svg = svgEl('svg', { width: size.width, height: size.height });
    svg.style.position = 'absolute';
    svg.style.left = '0';
    svg.style.top = '0';
    const defs = svgEl('defs', {});
    for (const [id, color] of [['fl-win', getVar('--win')], ['fl-loss', getVar('--loss')]]) {
      const marker = svgEl('marker', {
        id,
        markerWidth: 7,
        markerHeight: 7,
        refX: 6,
        refY: 3.5,
        orient: 'auto',
      });
      marker.appendChild(svgEl('path', { d: 'M0 0 L7 3.5 L0 7 Z', fill: color, 'fill-opacity': 0.8 }));
      defs.appendChild(marker);
    }
    svg.appendChild(defs);
    for (const L of computeLinks()) {
      svg.appendChild(
        svgEl('path', {
          d: curve(L.x1, L.y1, L.x2, L.y2, 9),
          fill: 'none',
          stroke: L.kind === 'win' ? getVar('--win') : getVar('--loss'),
          'stroke-opacity': 0.5,
          'stroke-width': 2,
          'marker-end': `url(#fl-${L.kind})`,
        }),
      );
    }
    root.appendChild(svg);

    // round headers
    state.data.bracket.forEach((r, i) => {
      const done = r.buckets.every((bk) => bk.matchIds.every((id) => state.byId.get(id).winner));
      const head = document.createElement('div');
      head.className = `round-head${done ? '' : ' is-live'}`;
      head.style.left = `${PAD_L + i * (COL_W + GUTTER)}px`;
      head.style.top = '0px';
      head.innerHTML =
        `<div class="round-head-name">Round ${r.round}</div>` +
        `<div class="round-head-sub">${done ? 'Complete' : 'In progress'} &middot; ${r.matchCount} matches</div>`;
      root.appendChild(head);
    });

    // buckets
    for (const r of state.data.bracket) {
      for (const bk of r.buckets) {
        const p = state.pos.get(`${r.round}:${bk.record}`);
        const c = bucketColor(bk.record);
        const box = document.createElement('div');
        box.className = 'bucket';
        box.style.cssText = `left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;border-color:${c}44;border-left-color:${c};`;

        const head = document.createElement('div');
        head.className = 'bucket-head';
        head.style.cssText = `background:${c}1c;border-bottom-color:${c}33;`;
        head.innerHTML =
          `<span class="bucket-record" style="color:${c}">${dash(bk.record)}</span>` +
          `<span class="bucket-count">${bk.matchIds.length} match${bk.matchIds.length === 1 ? '' : 'es'}</span>`;
        box.appendChild(head);

        const body = document.createElement('div');
        body.className = 'bucket-body';
        for (const id of bk.matchIds) body.appendChild(matchRow(state.byId.get(id)));
        box.appendChild(body);

        root.appendChild(box);
      }
    }

    // trace layer, above everything
    const trace = svgEl('svg', { width: size.width, height: size.height, id: 'trace-layer' });
    root.appendChild(trace);

    fitZoom();
  }

  function matchRow(m) {
    const row = document.createElement('div');
    row.className = `match${m.winner ? '' : ' is-pending'}`;
    row.dataset.matchId = String(m.id);

    const no = document.createElement('span');
    no.className = 'match-no';
    no.innerHTML = `${m.isFloat ? '<span class="match-float" title="Down-float: unequal records">\u25C6</span>' : ''}${m.id}`;
    no.title = m.winner
      ? `Match ${m.id}`
      : `Match ${m.id} \u2014 not yet played${m.times.matchStart ? `, ${m.times.matchStart} EVE` : ''}`;
    row.appendChild(no);

    const teams = document.createElement('div');
    teams.className = 'match-teams';
    teams.appendChild(sideEl(m, m.red));
    teams.appendChild(sideEl(m, m.blue));
    row.appendChild(teams);
    return row;
  }

  function sideEl(m, name) {
    const won = m.winner === name;
    const side = document.createElement('div');
    side.className = `side${won ? ' is-winner' : ''}`;
    side.dataset.team = name;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'side-name';
    btn.textContent = name;
    btn.title = name;
    side.appendChild(btn);

    const check = document.createElement('span');
    check.className = 'side-check';
    if (won) {
      const s = svgEl('svg', { width: 10, height: 10, viewBox: '0 0 24 24', fill: 'none' });
      s.appendChild(
        svgEl('path', {
          d: 'M4 12.5l5.5 5.5L20 6.5',
          stroke: getVar('--win'),
          'stroke-width': 4,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        }),
      );
      check.appendChild(s);
    }
    side.appendChild(check);
    return side;
  }

  const getVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  /* ---------------- team trace ---------------- */
  function activeTeam() {
    return state.pinned ?? state.hovered;
  }

  function applyTrace() {
    const name = activeTeam();
    const bracket = el('bracket');
    const layer = el('trace-layer');
    if (!layer) return;
    layer.textContent = '';

    for (const row of bracket.querySelectorAll('.match.is-traced')) row.classList.remove('is-traced');
    for (const s of bracket.querySelectorAll('.side.is-traced')) s.classList.remove('is-traced');

    if (!name) {
      bracket.classList.remove('is-tracing');
      return;
    }
    bracket.classList.add('is-tracing');

    const team = state.teams.get(name);
    if (!team) return;

    const pts = [];
    for (const p of team.path) {
      const row = bracket.querySelector(`.match[data-match-id="${p.matchId}"]`);
      if (row) {
        row.classList.add('is-traced');
        const side = row.querySelector(`.side[data-team="${cssEscape(name)}"]`);
        if (side) side.classList.add('is-traced');
      }
      const rp = state.rowPos.get(p.matchId);
      if (rp) pts.push(rp);
    }

    if (pts.length > 1) {
      let d = `M ${pts[0].cx} ${pts[0].cy}`;
      for (let i = 1; i < pts.length; i++) {
        const q = pts[i - 1];
        const p = pts[i];
        const dx = (p.cx - q.cx) * 0.45;
        d += ` C ${q.cx + dx} ${q.cy}, ${p.cx - dx} ${p.cy}, ${p.cx} ${p.cy}`;
      }
      layer.appendChild(
        svgEl('path', {
          d,
          fill: 'none',
          stroke: getVar('--accent'),
          'stroke-width': 2.5,
          'stroke-dasharray': '7 4',
          'stroke-opacity': 0.95,
        }),
      );
    }
    for (const p of pts) {
      layer.appendChild(svgEl('circle', { cx: p.cx, cy: p.cy, r: 4.5, fill: getVar('--accent') }));
    }
  }

  // CSS.escape is not universal; attribute selectors here only need quotes handled.
  const cssEscape = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&'));

  function setPinned(name) {
    state.pinned = name;
    // Clearing the pin must also drop the hover, or the trace survives an
    // explicit dismiss just because the cursor never left the team.
    if (!name) state.hovered = null;
    const box = el('pinned');
    if (name) {
      el('pinned-name').textContent = name;
      box.hidden = false;
    } else {
      box.hidden = true;
    }
    applyTrace();
  }

  /* ---------------- zoom ---------------- */
  function setZoom(z) {
    state.zoom = Math.max(0.25, Math.min(2, z));
    el('bracket-zoom').style.transform = `scale(${state.zoom})`;
    const b = el('bracket');
    // Keep the scroll container's scrollable area in step with the scaled content.
    el('bracket-zoom').style.width = `${b.offsetWidth * state.zoom}px`;
    el('bracket-zoom').style.height = `${b.offsetHeight * state.zoom}px`;
    el('zoom-level').textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function fitZoom() {
    const scroll = el('bracket-scroll');
    const b = el('bracket');
    if (!b.offsetWidth) return;
    setZoom((scroll.clientWidth - 8) / b.offsetWidth);
  }

  /* ---------------- standings ---------------- */
  function renderStandings() {
    const tbody = document.querySelector('#standings tbody');
    tbody.textContent = '';
    const { key, dir } = state.sort;
    const mul = dir === 'asc' ? 1 : -1;

    const rowsData = [...state.data.standings].sort((a, b) => {
      if (key === 'name') return mul * a.name.localeCompare(b.name);
      if (key === 'losses') return mul * (a.losses - b.losses) || a.name.localeCompare(b.name);
      return mul * (a.wins - b.wins) || a.losses - b.losses || a.name.localeCompare(b.name);
    });

    rowsData.forEach((t, i) => {
      const tr = document.createElement('tr');

      const rank = document.createElement('td');
      rank.className = 'num';
      rank.textContent = String(i + 1);
      tr.appendChild(rank);

      const nameTd = document.createElement('td');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'team-btn';
      btn.textContent = t.name;
      btn.addEventListener('click', () => openDrawer(t.name));
      nameTd.appendChild(btn);
      tr.appendChild(nameTd);

      const w = document.createElement('td');
      w.className = 'num';
      w.textContent = String(t.wins);
      tr.appendChild(w);

      const l = document.createElement('td');
      l.className = 'num';
      l.textContent = String(t.losses);
      tr.appendChild(l);

      const path = document.createElement('td');
      const pips = document.createElement('div');
      pips.className = 'pips';
      for (const p of t.path) {
        const pip = document.createElement('span');
        pip.className = `pip pip-${p.result}`;
        pip.textContent = p.result === 'win' ? 'W' : p.result === 'loss' ? 'L' : '\u00B7';
        pip.title = `Round ${p.round} \u2014 ${p.result === 'pending' ? 'to play' : p.result} vs ${p.opponent}`;
        pips.appendChild(pip);
      }
      path.appendChild(pips);
      tr.appendChild(path);

      tbody.appendChild(tr);
    });

    for (const th of document.querySelectorAll('#standings th[data-sort]')) {
      th.classList.toggle('is-sorted', th.dataset.sort === key);
    }
  }

  /* ---------------- rounds list ---------------- */
  function renderRounds() {
    const wrap = el('rounds-list');
    wrap.textContent = '';
    for (const r of state.data.bracket) {
      const block = document.createElement('div');
      block.className = 'round-block';

      const h = document.createElement('h2');
      const decided = r.buckets.reduce(
        (a, bk) => a + bk.matchIds.filter((id) => state.byId.get(id).winner).length,
        0,
      );
      h.textContent = `Round ${r.round} \u2014 ${decided}/${r.matchCount} decided`;
      block.appendChild(h);

      for (const bk of r.buckets) {
        const c = bucketColor(bk.record);
        const label = document.createElement('div');
        label.style.cssText = `font-family:var(--display);font-size:14px;letter-spacing:.1em;color:${c};margin-top:14px;`;
        label.textContent = `${dash(bk.record)} \u00B7 ${bk.matchIds.length} matches`;
        block.appendChild(label);

        const grid = document.createElement('div');
        grid.className = 'round-grid';
        for (const id of bk.matchIds) {
          const m = state.byId.get(id);
          const card = matchRow(m);
          card.style.border = `1px solid ${c}33`;
          card.style.borderLeft = `3px solid ${c}`;
          card.style.height = 'auto';
          grid.appendChild(card);
        }
        block.appendChild(grid);
      }
      wrap.appendChild(block);
    }
  }

  /* ---------------- drawer ---------------- */
  function openDrawer(name) {
    const t = state.teams.get(name);
    if (!t) return;
    el('drawer-name').textContent = t.name;
    el('drawer-record').textContent = `${t.wins}\u2013${t.losses} \u00B7 ${t.path.length} matches`;

    const list = el('drawer-path');
    list.textContent = '';
    for (const p of t.path) {
      const li = document.createElement('li');
      li.innerHTML =
        `<span class="rnd">R${p.round}</span>` +
        `<span class="rec">${dash(p.record)}</span>` +
        `<span class="opp"></span>` +
        `<span class="res res-${p.result}">${p.result === 'win' ? 'WON' : p.result === 'loss' ? 'LOST' : 'TO PLAY'}</span>`;
      li.querySelector('.opp').textContent = p.opponent;
      list.appendChild(li);
    }
    el('drawer').hidden = false;
    setPinned(name);
    writeHash();
  }

  function closeDrawer() {
    el('drawer').hidden = true;
  }

  /* ---------------- search ---------------- */
  function runSearch(q) {
    const bracket = el('bracket');
    for (const row of bracket.querySelectorAll('.match.is-hit')) row.classList.remove('is-hit');
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return;
    let first = null;
    for (const side of bracket.querySelectorAll('.side')) {
      if (side.dataset.team.toLowerCase().includes(needle)) {
        const row = side.closest('.match');
        row.classList.add('is-hit');
        if (!first) first = row;
      }
    }
    if (first) first.scrollIntoView({ block: 'center', inline: 'center' });
  }

  /* ---------------- views + deep links ---------------- */
  function showView(name) {
    const known = ['bracket', 'standings', 'rounds'];
    const view = known.includes(name) ? name : 'bracket';
    for (const t of document.querySelectorAll('.tab')) {
      const on = t.dataset.view === view;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
    }
    for (const v of document.querySelectorAll('.view')) {
      v.classList.toggle('is-active', v.id === `view-${view}`);
    }
    el('zoom-controls').hidden = view !== 'bracket';
    if (view === 'bracket') fitZoom();
    return view;
  }

  function currentView() {
    const tab = document.querySelector('.tab.is-active');
    return tab ? tab.dataset.view : 'bracket';
  }

  /* Hash shapes: #view=standings, #view=rounds, #team=<name>.
   * Both keys are prefixed so a value can never collide with an element id -
   * a bare "#standings" makes the browser jump-scroll to the standings table. */
  function writeHash() {
    const parts = [];
    const view = currentView();
    if (view !== 'bracket') parts.push(`view=${view}`);
    if (state.pinned) parts.push(`team=${encodeURIComponent(state.pinned)}`);
    const next = parts.length ? `#${parts.join('&')}` : '';
    if (next !== window.location.hash) {
      history.replaceState(null, '', next || window.location.pathname);
    }
  }

  function readHash() {
    const raw = window.location.hash.replace(/^#/, '');
    if (!raw) {
      showView('bracket');
      return;
    }
    let team = null;
    let view = 'bracket';
    for (const part of raw.split('&')) {
      if (part.startsWith('team=')) team = decodeURIComponent(part.slice(5));
      else if (part.startsWith('view=')) view = part.slice(5);
    }
    showView(view);
    if (team && state.teams.has(team)) openDrawer(team);
  }

  /* ---------------- wiring ---------------- */
  function bindEvents() {
    const bracket = el('bracket');

    bracket.addEventListener('mouseover', (e) => {
      const side = e.target.closest('.side');
      if (!side || state.pinned) return;
      if (state.hovered !== side.dataset.team) {
        state.hovered = side.dataset.team;
        applyTrace();
      }
    });
    bracket.addEventListener('mouseleave', () => {
      if (state.pinned) return;
      state.hovered = null;
      applyTrace();
    });
    bracket.addEventListener('click', (e) => {
      const btn = e.target.closest('.side-name');
      if (!btn) return;
      openDrawer(btn.closest('.side').dataset.team);
    });

    el('pinned-clear').addEventListener('click', () => {
      setPinned(null);
      closeDrawer();
      writeHash();
    });
    el('drawer-close').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      closeDrawer();
      setPinned(null);
      writeHash();
    });

    for (const tab of document.querySelectorAll('.tab')) {
      tab.addEventListener('click', () => {
        showView(tab.dataset.view);
        writeHash();
      });
    }

    for (const b of document.querySelectorAll('.zoom button')) {
      b.addEventListener('click', () => {
        const mode = b.dataset.zoom;
        if (mode === 'fit') fitZoom();
        else setZoom(state.zoom * (mode === 'in' ? 1.25 : 0.8));
      });
    }

    for (const th of document.querySelectorAll('#standings th[data-sort]')) {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        state.sort =
          state.sort.key === key
            ? { key, dir: state.sort.dir === 'asc' ? 'desc' : 'asc' }
            : { key, dir: key === 'name' ? 'asc' : 'desc' };
        renderStandings();
      });
    }

    let searchTimer;
    el('search').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      const v = e.target.value;
      searchTimer = setTimeout(() => runSearch(v), 140);
    });

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (document.querySelector('.tab.is-active').dataset.view === 'bracket') fitZoom();
      }, 160);
    });
  }

  function relativeTime(iso) {
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (!Number.isFinite(mins)) return '\u2013';
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} hr ago`;
    return `${Math.round(hrs / 24)} d ago`;
  }

  function renderChrome() {
    const t = state.data.tournament;
    el('subtitle').textContent =
      `${t.teamCount} teams \u00B7 ${t.rounds.length}-round Swiss \u00B7 every team plays every round \u00B7 hover a team to trace its journey`;
    el('stat-decided').innerHTML = `${t.decidedCount}<small>/${t.matchCount}</small>`;
    el('stat-updated').textContent = relativeTime(state.data.updatedAt);
    el('source-link').href = state.data.source.url;
    el('scraped-at').textContent =
      ` Results last changed ${new Date(state.data.updatedAt).toUTCString()}; the sheet is re-checked every 30 minutes.`;
  }

  async function main() {
    try {
      const res = await fetch(`data/tournament.json?t=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state.data = await res.json();
    } catch (err) {
      el('subtitle').textContent = `Could not load tournament data (${err.message}).`;
      return;
    }

    state.byId = new Map(state.data.matches.map((m) => [m.id, m]));
    state.teams = new Map(state.data.standings.map((t) => [t.name, t]));

    renderChrome();
    renderBracket();
    renderStandings();
    renderRounds();
    bindEvents();
    readHash();
    window.addEventListener('hashchange', readHash);
  }

  main();
})();
