# Unofficial AT XXII Swiss Board

A community-built viewer for the EVE Online **Alliance Tournament XXII** preliminaries.
The official schedule lives in a Google Sheet with no interface; this renders it as a
proper Swiss bracket — the whole tournament as one connected flow, so you can see who
played who, who beat who, and trace any team's journey through all five rounds.

> **Unofficial.** Not affiliated with, endorsed by, or sponsored by CCP hf or the
> Alliance Tournament organisers. EVE Online and all related marks are trademarks of
> CCP hf. All tournament data belongs to its authors; this project only reformats a
> publicly shared sheet.

## How to read the board

- **Columns are rounds** (1 → 5).
- **Blocks within a column** are record buckets: every team currently on `2-1`, say.
- **Green arrows carry winners up** into the next-best record; **red arrows drop losers down**.
- **Click any team** to trace its path across every round, open its round-by-round
  detail and deep-link it. Click it again, press Escape, or click away to clear.
  Hovering deliberately does nothing but show that a row is clickable - the board
  never changes under a passing cursor.
- **Drag anywhere to pan** the board; `Fit` re-fits it to the window.
- **◆** marks a *down-float* — a pairing where the two sides had unequal records, which
  Swiss does when a bucket holds an odd number of teams.
- **Amber match numbers and times** are matches that have not been played yet.
- **Every match shows its scheduled start.** The sheet keeps times in EVE time (UTC);
  the toolbar toggle converts them to your own zone.

## How the data works

One unauthenticated request pulls every tab of the sheet with formatting intact:

```
https://docs.google.com/spreadsheets/d/<SHEET_ID>/export?format=xlsx
```

**The winner is encoded as bold text.** The sheet has no results column — played rows get
a light-green fill and the winning team's cell is bold. That single fact drives the whole
design: the CSV export and the `htmlview` page both discard formatting, and SheetJS's
community build strips styles, so this uses the `.xlsx` export read through `exceljs`,
which exposes `cell.font.bold`.

A row counts as a real match only if column `A` parses as a number **and** both team cells
are non-empty. That one rule rejects every kind of junk in the workbook:

- `Break` separators and `DAY N - <date>` header rows,
- pre-numbered but empty placeholder rows reserved for **Rounds 6 and 7**,
- 19 stale copy-paste rows at the bottom of Weekend 3 that duplicate Weekend 1 pairings.

**Dates come from one header per tab.** Each weekend tab carries a single
`DAY N - <date>` row (`DAY FOUR - 6 September`) marking where its second day starts;
everything above it belongs to the day before. Those headers give a day and month but
**never a year**, so `TOURNAMENT_YEAR` in `scripts/scrape.mjs` supplies it. 2026 is the
only nearby year in which all three weekends fall on a Saturday and Sunday, which is how
the schedule is laid out. Bump that constant for the next tournament.

Combining the date with the sheet's UTC clock times gives each match a real instant
(`startsAt`), which is what makes the local-time toggle a formatting choice rather than
a guess.

**Rounds span weekend tabs** — Round 3 is split across Weekends 1 and 2, Round 5 across 2
and 3 — so matches are grouped by the round label in column `L`, never by tab.

The scraper asserts the tournament's structure and **exits non-zero rather than publishing
a broken dataset**, which leaves the last good `tournament.json` in place.

## Layout

```
scripts/scrape.mjs        fetch, validate, write docs/data/tournament.json
scripts/lib/parse.mjs     row filter, bold-winner rule, bucket derivation
scripts/schedule-window.mjs  how often to scrape right now, from the match times
docs/index.html           page shell
docs/app.js               bracket / standings / rounds views + team tracing
docs/styles.css           Broadcast theme
docs/data/tournament.json generated; committed by the scrape workflow
design/build-board.mjs    regenerates the design-canvas artboards from real data
.github/workflows/scrape.yml
```

## Running it locally

```bash
npm ci
node scripts/scrape.mjs      # refresh docs/data/tournament.json
npx serve docs               # then open the printed URL
```

The site is static and reads `data/tournament.json` at load — no build step, no framework.

## Data shape

`docs/data/tournament.json` carries `matches`, `bracket` (buckets per round) and
`standings` (each team's ordered path). Every match reserves empty slots for
`lineups`, `bans`, `points` and `survivors`, joined on the stable match `id` — none of
that exists in the source sheet yet, so nothing renders it.

## Deep links

- `#view=standings` / `#view=rounds`
- `#team=Dracarys.` opens that team's path

## Updating

The scrape cadence follows the tournament instead of a fixed clock, because the
board is idle far more than it is live - five match days spread over three
weekends, each 13:30-22:00 UTC with a match every 15 minutes.

`scripts/schedule-window.mjs` reads `startsAt` off the committed data and sorts
the current moment into one of four tiers:

| tier | when | cadence |
|---|---|---|
| **live** | 20 min before a match until 60 min after it starts | every 10 min, and each run then re-scrapes itself every 2 min for 8 min |
| **watch** | an event starts within 36h, or the last one just ended with results outstanding | every 30 min |
| **idle** | between weekends | twice a day |
| **archive** | every match decided, 12h past the last one | once a day |

The workflow registers one cron per tier; a run fired by the wrong cron for the
current tier exits after the checkout, before any toolchain setup. The live tier
polls inside the run because scheduled runs are commonly delayed 5-15 minutes,
which is most of a match. If the data is missing or unreadable the gate fails
open and scrapes anyway.

Either way it commits only when the data actually changed. You can trigger a run
by hand from the **Actions** tab, and check what the gate would decide at any
instant:

```bash
node scripts/schedule-window.mjs --at 2026-09-12T14:00:00Z --trigger "*/10 * * * *"
```
