/**
 * Decide whether this workflow run should actually scrape, and how hard.
 *
 * The tournament is idle far more than it is live: five match days spread over
 * three weekends, each running 13:30-22:00 UTC with a match every 15 minutes.
 * A single fixed cron is therefore always wrong - too slow while results land,
 * pure noise for the five days between weekends. So the schedule is derived
 * from the data itself: `startsAt` on every match already says when the
 * tournament is happening.
 *
 * The workflow registers one cron per tier and this script says whether the
 * cron that fired is the right one for the moment. Manual and push triggers
 * always run.
 *
 * Run: node scripts/schedule-window.mjs --trigger '<cron string or event name>'
 *      node scripts/schedule-window.mjs --at 2026-09-12T14:00:00Z   # dry-run any instant
 */
import { readFile, appendFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.SCHEDULE_DATA ?? resolve(ROOT, 'docs/data/tournament.json');

const MIN = 60_000;
const HOUR = 60 * MIN;

/* Window edges, all relative to match start times.
 * LEAD opens the live window before the day's first match so the board is warm
 * when play starts. TAIL keeps it open after the last match *starts*, covering
 * the match itself plus however long the organisers take to bold the winner. */
const LEAD = 20 * MIN;
const TAIL = 60 * MIN;
const WATCH_AHEAD = 36 * HOUR; // pick the schedule up the day before an event
const ARCHIVE_AFTER = 12 * HOUR; // quiet down once the last match is long over

/* One cron per tier - see .github/workflows/scrape.yml. Keeping them disjoint
 * means two runs never overlap and queue up behind the concurrency group. */
const CRON_TIERS = {
  '*/10 * * * *': ['live'],
  '5,35 * * * *': ['watch'],
  '17 3,15 * * *': ['idle', 'archive'],
};

/** How long a single run keeps polling, and how often, once it starts.
 *  Scheduled runs are commonly delayed 5-15 minutes, so the live run holds the
 *  runner and re-scrapes itself rather than trusting the next cron to be on
 *  time. Everything else scrapes once and exits. */
const POLL = {
  live: { minutes: 8, seconds: 120 },
  watch: { minutes: 0, seconds: 0 },
  idle: { minutes: 0, seconds: 0 },
  archive: { minutes: 0, seconds: 0 },
};

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

/** live | watch | idle | archive, from the match times alone. */
function classify(matches, allDecided, now) {
  const starts = matches
    .map((m) => Date.parse(m.startsAt))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (!starts.length) return { mode: 'idle', reason: 'no match times in the data' };

  const inWindow = starts.some((t) => now >= t - LEAD && now <= t + TAIL);
  if (inWindow) return { mode: 'live', reason: 'inside a match window' };

  const next = starts.find((t) => t > now);
  if (next !== undefined) {
    const hours = ((next - now) / HOUR).toFixed(1);
    return next - now <= WATCH_AHEAD
      ? { mode: 'watch', reason: `next match in ${hours}h`, nextMatchAt: new Date(next).toISOString() }
      : { mode: 'idle', reason: `next match in ${hours}h`, nextMatchAt: new Date(next).toISOString() };
  }

  const last = starts[starts.length - 1];
  if (allDecided && now > last + ARCHIVE_AFTER) {
    return { mode: 'archive', reason: 'every match decided and the tournament is over' };
  }
  return { mode: 'watch', reason: 'past the last match but results are still incomplete' };
}

const now = Date.parse(arg('at') ?? new Date().toISOString());
const trigger = arg('trigger') ?? 'manual';

let state;
try {
  const data = JSON.parse(await readFile(DATA, 'utf8'));
  const { decidedCount, matchCount } = data.tournament ?? {};
  state = classify(data.matches ?? [], decidedCount === matchCount, now);
} catch (err) {
  // No data yet, or unreadable: fail open. A run that shouldn't have happened
  // costs seconds; a tournament that silently stops updating costs the site.
  state = { mode: 'live', reason: `could not read the data (${err.message}) - running anyway` };
}

const scheduled = trigger in CRON_TIERS;
let run = !scheduled || CRON_TIERS[trigger].includes(state.mode);

// Archive shares the twice-daily cron with idle, but only needs one of them.
if (run && scheduled && state.mode === 'archive' && new Date(now).getUTCHours() >= 12) run = false;

const poll = run ? POLL[state.mode] : { minutes: 0, seconds: 0 };
const out = {
  run: String(run),
  mode: state.mode,
  reason: state.reason,
  poll_minutes: String(poll.minutes),
  poll_seconds: String(poll.seconds),
  next_match_at: state.nextMatchAt ?? '',
};

console.log(
  `${run ? 'RUN' : 'SKIP'}  mode=${state.mode}  trigger=${trigger}  (${state.reason})` +
    (poll.minutes ? `  polling every ${poll.seconds}s for ${poll.minutes}m` : ''),
);

if (process.env.GITHUB_OUTPUT) {
  await appendFile(
    process.env.GITHUB_OUTPUT,
    Object.entries(out).map(([k, v]) => `${k}=${v}`).join('\n') + '\n',
  );
}
