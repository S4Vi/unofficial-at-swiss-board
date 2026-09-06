/**
 * Fetch the official ATXXII prelims sheet, parse it, and write docs/data/tournament.json.
 *
 * Run: node scripts/scrape.mjs
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { parseWorkbook, deriveStructure } from './lib/parse.mjs';

const SHEET_ID = '1HcZovqugjNkB54IQOAav4akK_KSCjZuJLtAhn92-8L4';

// The .xlsx export is the only source that keeps the bold formatting the winner
// is encoded in. The CSV export and the htmlview page both lose it.
const SOURCE_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx`;
const SHEET_HUMAN_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/htmlview`;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'docs/data/tournament.json');

/** Structural expectations. Violations mean the sheet changed shape - fail, don't publish. */
const EXPECT = {
  minTeams: 8,
  minRounds: 1,
  // Rounds 6-7 are already reserved in the sheet, so the round count is a floor.
  knownRounds: 5,
};

async function fetchWorkbook() {
  const res = await fetch(SOURCE_URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Sheet fetch failed: HTTP ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024) throw new Error(`Sheet fetch returned only ${buf.length} bytes`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buf);
  return workbook;
}

/**
 * Assert the Swiss invariants. A silently-empty or scrambled parse would publish
 * a broken site, so any violation exits non-zero and leaves the old JSON in place.
 */
function validate(matches, { rounds, standings }) {
  const errors = [];
  const warnings = [];

  if (matches.length === 0) errors.push('No matches parsed at all.');
  if (standings.length < EXPECT.minTeams)
    errors.push(`Only ${standings.length} teams found (expected >= ${EXPECT.minTeams}).`);
  if (rounds.length < EXPECT.minRounds) errors.push('No rounds found.');
  if (rounds.length < EXPECT.knownRounds)
    errors.push(`Only ${rounds.length} rounds found; ${EXPECT.knownRounds} are known to exist.`);

  const ids = matches.map((m) => m.id);
  const dupeIds = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupeIds.length) errors.push(`Duplicate match ids: ${[...new Set(dupeIds)].join(', ')}`);

  const missingRound = matches.filter((m) => !m.round);
  if (missingRound.length)
    errors.push(`${missingRound.length} match(es) have no round label (ids ${missingRound.slice(0, 5).map((m) => m.id).join(', ')}).`);

  for (const m of matches) {
    if (m.red === m.blue) errors.push(`Match ${m.id} has the same team on both sides: ${m.red}`);
  }

  // In Swiss, a team plays at most once per round.
  for (const round of rounds) {
    const seen = new Map();
    for (const m of matches.filter((x) => x.round === round)) {
      for (const name of [m.red, m.blue]) seen.set(name, (seen.get(name) ?? 0) + 1);
    }
    const twice = [...seen.entries()].filter(([, n]) => n > 1);
    if (twice.length)
      errors.push(`Round ${round}: ${twice.map(([n, c]) => `${n} appears ${c}x`).join('; ')}`);
  }

  // Uneven round sizes are legal (byes) but worth surfacing.
  const sizes = new Set(rounds.map((r) => matches.filter((m) => m.round === r).length));
  if (sizes.size > 1) warnings.push(`Round sizes differ: ${[...sizes].join(', ')}`);

  return { errors, warnings };
}

async function main() {
  console.log(`Fetching ${SOURCE_URL}`);
  const workbook = await fetchWorkbook();

  const matches = parseWorkbook(workbook);
  const structure = deriveStructure(matches);
  const { errors, warnings } = validate(matches, structure);

  for (const w of warnings) console.warn(`  warn: ${w}`);
  if (errors.length) {
    console.error('\nSheet failed validation - refusing to write output:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const decided = matches.filter((m) => m.winner).length;
  const floats = matches.filter((m) => m.isFloat).length;

  const payload = {
    // Stamped further down, and only when the substance actually changed, so
    // that "updated" means "the results moved" rather than "a robot looked".
    updatedAt: null,
    source: { sheetId: SHEET_ID, url: SHEET_HUMAN_URL },
    tournament: {
      name: 'Alliance Tournament XXII - Preliminaries',
      format: 'swiss',
      rounds: structure.rounds,
      teamCount: structure.standings.length,
      matchCount: matches.length,
      decidedCount: decided,
    },
    matches,
    bracket: structure.bracket,
    standings: structure.standings,
  };

  // Only rewrite when something other than the timestamp moved. Otherwise a
  // scrape every 30 minutes would churn out 48 identical commits a day.
  const previous = await readFile(OUT, 'utf8').catch(() => null);
  if (previous) {
    try {
      const prev = JSON.parse(previous);
      const { updatedAt: prevStamp, ...prevBody } = prev;
      const { updatedAt: _ignored, ...nextBody } = payload;
      if (JSON.stringify(prevBody) === JSON.stringify(nextBody)) {
        console.log(`
No change since ${prevStamp ?? 'the last scrape'} - leaving the data file untouched.`);
        console.log(`  ${structure.standings.length} teams | ${matches.length} matches (${decided} decided)`);
        return;
      }
    } catch {
      // Unreadable previous file: fall through and overwrite it.
    }
  }

  payload.updatedAt = new Date().toISOString();

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  console.log(
    `\nOK  ${structure.standings.length} teams | ${structure.rounds.length} rounds | ` +
      `${matches.length} matches (${decided} decided, ${matches.length - decided} pending) | ` +
      `${floats} float pairing(s)`,
  );
  for (const r of structure.bracket) {
    console.log(
      `  Round ${r.round}: ${r.matchCount} matches  [${r.buckets.map((b) => `${b.record}:${b.matchIds.length}`).join('  ')}]`,
    );
  }
  console.log(`\nWrote ${OUT}`);
}

main().catch((err) => {
  console.error(`Scrape failed: ${err.message}`);
  process.exit(1);
});
