/**
 * Parsing rules for the official ATXXII prelims Google Sheet.
 *
 * The sheet has no results column. The winner of a match is encoded purely as
 * BOLD TEXT on the winning team's cell (played rows also carry a light-green
 * fill, FFD9EAD3). That is why we read the .xlsx export with styles intact and
 * not the CSV export, which throws the formatting away.
 */

// Column letters, straight from the sheet header row.
export const COL = {
  match: 'A',
  red: 'B',
  blue: 'C',
  convoStart: 'D',
  bansStart: 'E',
  checksDue: 'F',
  tpDue: 'G',
  matchStart: 'H',
  matchFinish: 'I',
  round: 'L',
};

const TAB_PATTERN = /Prelims Weekend/i;

/* Each weekend tab carries exactly one day header ("DAY FOUR - 6 September")
 * at the row where its second day begins. Everything above it belongs to that
 * weekend's first day, whose date is the stated one minus a day. */
const DAY_HEADER = /^DAY\s+([A-Z]+)\s*[-\u2013]\s*(\d{1,2})\s+([A-Za-z]+)/i;

const ORDINALS = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const iso = (d) => d.toISOString().slice(0, 10);

/** Cell text, trimmed. ExcelJS hands back rich-text objects for styled runs. */
function text(cell) {
  const v = cell?.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('').trim();
    if (v.text !== undefined) return String(v.text).trim();
    if (v.result !== undefined) return String(v.result).trim();
    return '';
  }
  return String(v).trim();
}

/**
 * The whole result signal. A cell is bold when its team won.
 * Rich text can carry boldness per-run, so check there too.
 */
function isBold(cell) {
  if (cell?.font?.bold) return true;
  const rt = cell?.value?.richText;
  return Array.isArray(rt) && rt.length > 0 && rt.every((r) => r.font?.bold);
}

/**
 * Match times -> "HH:MM" in UTC/EVE time.
 *
 * These cells are time-formatted, so ExcelJS hands back a Date on the Excel
 * epoch (1899-12-30) rather than the underlying day fraction; several columns
 * are also shared formulas, where the value arrives wrapped as {formula, result}.
 * In every case the UTC time-of-day is the value we want.
 */
function toTimeOfDay(cell) {
  let v = cell?.value;
  if (v && typeof v === 'object' && !(v instanceof Date) && 'result' in v) v = v.result;

  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}`;
  }
  if (typeof v === 'string') {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) {
      return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
    }
    const hm = /^(\d{1,2}):(\d{2})/.exec(v.trim());
    if (hm) return `${hm[1].padStart(2, '0')}:${hm[2]}`;
    return null;
  }
  // Plain day fraction (0..1), the raw Excel representation.
  if (typeof v === 'number' && v >= 0 && v < 1) {
    const mins = Math.round(v * 24 * 60);
    return `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }
  return null;
}

function roundNumber(label) {
  const m = /(\d+)/.exec(label);
  return m ? Number.parseInt(m[1], 10) : null;
}

/**
 * A row is a real match iff column A parses as a number AND both team cells
 * are non-empty. That single rule rejects every kind of junk in this workbook:
 *
 *  - "Break" separators and "DAY TWO - 30 August" day headers (A is not numeric)
 *  - pre-numbered placeholder rows reserved for Rounds 6-7 (A numeric, teams blank)
 *  - 19 stale copy-paste rows at the bottom of Weekend 3 that duplicate Weekend 1
 *    pairings but carry no match number (A blank)
 */
/**
 * Collect a sheet's day headers, then derive the day that precedes the first
 * one. Returns rows in ascending order, each with the date it starts.
 */
function readDays(sheet, year) {
  const found = [];
  sheet.eachRow((row) => {
    const m = DAY_HEADER.exec(text(row.getCell(COL.match)));
    if (!m) return;
    const month = MONTHS[m[3].slice(0, 3).toLowerCase()];
    if (month === undefined) return;
    found.push({
      row: row.number,
      ordinal: ORDINALS[m[1].toLowerCase()] ?? null,
      date: new Date(Date.UTC(year, month, Number.parseInt(m[2], 10))),
    });
  });
  found.sort((a, b) => a.row - b.row);

  if (found.length === 0) return [];

  // The rows above the first header are the day before it.
  const first = found[0];
  const prior = new Date(first.date);
  prior.setUTCDate(prior.getUTCDate() - 1);
  return [
    { row: 0, ordinal: first.ordinal === null ? null : first.ordinal - 1, date: prior },
    ...found,
  ];
}

export function parseWorkbook(workbook, { year } = {}) {
  const matches = [];

  for (const sheet of workbook.worksheets) {
    if (!TAB_PATTERN.test(sheet.name)) continue;
    const weekend = roundNumber(sheet.name);
    const days = year ? readDays(sheet, year) : [];

    sheet.eachRow((row) => {
      const cell = (letter) => row.getCell(letter);

      const id = Number.parseInt(text(cell(COL.match)), 10);
      if (!Number.isFinite(id)) return;

      const redCell = cell(COL.red);
      const blueCell = cell(COL.blue);
      const red = text(redCell);
      const blue = text(blueCell);
      if (!red || !blue) return;

      const redWon = isBold(redCell);
      const blueWon = isBold(blueCell);

      // The last day header at or above this row governs it.
      let day = null;
      for (const d of days) {
        if (d.row <= row.number) day = d;
      }
      const times = {
        convoStart: toTimeOfDay(cell(COL.convoStart)),
        bansStart: toTimeOfDay(cell(COL.bansStart)),
        checksDue: toTimeOfDay(cell(COL.checksDue)),
        tpDue: toTimeOfDay(cell(COL.tpDue)),
        matchStart: toTimeOfDay(cell(COL.matchStart)),
        matchFinish: toTimeOfDay(cell(COL.matchFinish)),
      };

      // All sheet times are UTC / EVE time, so the date and the clock combine
      // directly into an instant with no zone maths.
      let startsAt = null;
      if (day && times.matchStart) {
        const [hh, mm] = times.matchStart.split(':').map(Number);
        startsAt = new Date(
          Date.UTC(
            day.date.getUTCFullYear(),
            day.date.getUTCMonth(),
            day.date.getUTCDate(),
            hh,
            mm,
          ),
        ).toISOString();
      }

      matches.push({
        id,
        weekend,
        day: day ? day.ordinal : null,
        date: day ? iso(day.date) : null,
        startsAt,
        round: roundNumber(text(cell(COL.round))),
        sheet: sheet.name.trim(),
        red,
        blue,
        // Both bold would be ambiguous; treat it as undecided rather than guessing.
        winner: redWon && !blueWon ? red : blueWon && !redWon ? blue : null,
        times,
        // Reserved for features not yet in the source sheet. Joined on `id`.
        lineups: null,
        bans: null,
        points: null,
        survivors: null,
      });
    });
  }

  matches.sort((a, b) => a.id - b.id);
  return matches;
}

/**
 * Walk the rounds in order, tracking each team's record BEFORE each round.
 * That pre-round record is the match's bucket ("2-1"), which is what gives the
 * Swiss bracket its column-of-buckets shape.
 *
 * Rounds cross weekend tabs (round 3 spans weekends 1-2, round 5 spans 2-3),
 * so we group by the round label and never by sheet.
 */
export function deriveStructure(matches) {
  const rounds = [...new Set(matches.map((m) => m.round))].filter(Boolean).sort((a, b) => a - b);

  const teams = new Map();
  const team = (name) => {
    if (!teams.has(name)) teams.set(name, { name, wins: 0, losses: 0, path: [] });
    return teams.get(name);
  };
  for (const m of matches) {
    team(m.red);
    team(m.blue);
  }

  for (const round of rounds) {
    const inRound = matches.filter((m) => m.round === round);

    // Snapshot records before applying this round's results.
    for (const m of inRound) {
      const r = team(m.red);
      const b = team(m.blue);
      m.redRecord = `${r.wins}-${r.losses}`;
      m.blueRecord = `${b.wins}-${b.losses}`;
      // Odd-sized buckets force Swiss "down-floats", so the two sides do not
      // always share a record. Bucket the match by the higher-seeded side and
      // flag it so the renderer can draw a crossing connector.
      m.isFloat = m.redRecord !== m.blueRecord;
      m.bucket = r.wins >= b.wins ? m.redRecord : m.blueRecord;
    }

    for (const m of inRound) {
      if (!m.winner) continue;
      const loser = m.winner === m.red ? m.blue : m.red;
      team(m.winner).wins += 1;
      team(loser).losses += 1;
    }
  }

  for (const m of matches) {
    const loser = m.winner ? (m.winner === m.red ? m.blue : m.red) : null;
    for (const name of [m.red, m.blue]) {
      team(name).path.push({
        matchId: m.id,
        round: m.round,
        opponent: name === m.red ? m.blue : m.red,
        side: name === m.red ? 'red' : 'blue',
        record: name === m.red ? m.redRecord : m.blueRecord,
        result: !m.winner ? 'pending' : m.winner === name ? 'win' : 'loss',
      });
    }
    m.loser = loser;
  }

  const standings = [...teams.values()]
    .map((t) => ({ ...t, path: t.path.sort((a, b) => a.round - b.round) }))
    .sort((a, b) => b.wins - a.wins || a.losses - b.losses || a.name.localeCompare(b.name));

  // Buckets per round, ordered best record first, for direct rendering.
  const bracket = rounds.map((round) => {
    const inRound = matches.filter((m) => m.round === round);
    const byBucket = new Map();
    for (const m of inRound) {
      if (!byBucket.has(m.bucket)) byBucket.set(m.bucket, []);
      byBucket.get(m.bucket).push(m.id);
    }
    const buckets = [...byBucket.entries()]
      .map(([record, matchIds]) => ({ record, matchIds }))
      .sort((a, b) => Number.parseInt(b.record, 10) - Number.parseInt(a.record, 10));
    return { round, matchCount: inRound.length, buckets };
  });

  return { rounds, standings, bracket };
}
