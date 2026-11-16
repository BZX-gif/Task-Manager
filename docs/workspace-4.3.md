# Command 4.3 · The forward view

4.2 answered *what needs me now*. 4.3 adds the two questions that come next:

1. **What does the next fortnight already look like?** → **Forecast**
2. **What actually happened, and how did it feel?** → **Journal**

Both are built on data the app already had. Nothing is simulated, nothing is
estimated from a model, and nothing leaves the device.

The third change is at the front door: quick capture now understands the way
people actually type.

---

## Natural-language capture

`src/client/lib/quickparse.js` is a pure parser; `ui/quickcapture.js` mirrors
every field it finds back into the visible pickers **before** anything is
saved. There are no hidden auto-created records.

| You type | It understands |
|---|---|
| `today`, `tonight`, `tomorrow`, `tmr`, `day after tomorrow`, `next week` | dates relative to the local day |
| `monday` … `sunday`, `mon` … `sun`, `next friday` | the next upcoming weekday |
| `20/11`, `20/11/2026`, `2026-11-20`, `Nov 20`, `20 Nov` | explicit dates; a bare date already behind you rolls forward a year |
| `9:30pm`, `21:30`, `at 6pm`, `noon`, `midnight` | time of day (24h, stored as `HH:MM`) |
| `15m`, `45 min`, `1.5h`, `2 hours`, `for 90 minutes` | estimate, clamped to 5–600 minutes |
| `!high`, `!h`, `!1`, `p1`, `!!`, `!low`, `!m`, `!3` | priority |
| `#work`, `#life-admin`, `#learn` | category by id, name or unique prefix |
| `daily`, `every day`, `weekdays`, `every weekday`, `weekly`, `every monday`, `every mon, wed and fri`, `monthly`, `every 1st` | a real recurrence series (`lib/recurrence.js`) |

Design rules the parser follows:

- **Only what was typed.** An unrecognised `#tag` stays in the title; no
  default date, time or category is invented.
- **Visible first.** Detected fields appear as chips under the input, and the
  date/priority/category controls move to match them.
- **Correctable.** Any manual change to the pickers wins over a later re-parse
  unless the sentence itself names a new value.
- **Reversible repetition.** A repeating sentence shows a *Keep repeating*
  toggle; if it is saved, the mission becomes the first occurrence of a series
  (`seriesId` = its own id, `occurrenceDate` = its date).

Coverage: `tests/unit/quickparse.test.js` (14 cases) and two jsdom integration
flows in `tests/integration/workspace.test.js`.

---

## Forecast

**Where**: sidebar → *YOUR DAY* → **Forecast** (`src/client/views/forecast.js`),
command palette, or `O`.

The view answers one question — *if nothing changes, how heavy is the road
ahead?* — over 7, 14 or 30 days.

| Panel | What it shows |
|---|---|
| Advice banner | The single most useful sentence: clashes, an overloaded day, carried-over work, or genuine room. |
| Metrics | Committed time, daily average against a focused-day capacity, days needing a decision, carried-over missions. |
| Committed load chart | Minutes already promised per day, coloured by load state, with the capacity line overlaid. |
| Where the time goes | Committed minutes by category, as shares of the horizon. |
| Day by day | Every day as a selectable card: load bar, status, and clash count. Clicking opens the day planner. |
| Following you forward | Open missions from earlier days, with a direct link to the mission. |

Model: `src/client/lib/forecast.js`.

- Commitments come from the same `scheduleFor(state, day)` the timetable and
  planner use, so the forecast can never disagree with the schedule.
- **Sleep and protected windows are not commitments.** They are rest, not work.
- Capacity is the working-day span from Settings (clamped to 2–15 hours,
  defaulting to 8), so the view responds to real preferences.
- Status thresholds: light < 35 %, balanced < 68 %, full < 92 %, overloaded
  ≥ 92 %, and any overlap is a **clash** regardless of load.
- Overdue work is reported separately rather than silently folded into
  future days.

Coverage: `tests/unit/forecast.test.js` (10 cases) and a jsdom flow that adds a
scheduled mission and checks it appears on the right day.

---

## Journal

**Where**: sidebar → *YOUR SPACE* → **Journal** (`src/client/views/journal.js`),
command palette, or `J`.

One entry per day, in the user's own words. Deliberately not a streak game.

| Field | Purpose |
|---|---|
| What happened | Free text, 4 000 characters, with a prompt that changes by time of day and day of month. |
| One thing that went right | A single line. Enough to notice a good day later. |
| The next step | Carried into the next session's reading of the entry. |
| Mood | Five honest options: Heavy · Low · Steady · Good · Bright. |
| Energy | Low · Medium · High. |

Surfaces:

- **Compose** for today, or any of the last seven days (a written day is marked
  with a dot).
- **Metrics** for the last 30 days: entries, current streak, average mood,
  recorded wins — plus one factual, non-judgemental summary sentence.
- **Recent entries** timeline with mood dots, note preview and the recorded win.

Model: `src/client/lib/journal.js` — `normalizeEntry`, `saveEntry`,
`journalStats`, `promptFor`, `summaryLine`. Empty entries are **deleted**, not
stored blank; an edit preserves fields that were not part of the patch.

Schema: state **v7** adds `journal: { "YYYY-MM-DD": entry }`. The migration
(`migrateStateV6ToV7`) is additive: existing records and IDs are untouched.

Coverage: `tests/unit/journal.test.js` (9 cases) and a jsdom flow that writes
today, then yesterday, and asserts both the stored data and the timeline.

---

## Small things in the same release

- **Keyboard shortcut sheet** — press `?` (or run *Keyboard shortcuts* from the
  palette). Shortcuts are suppressed while typing, and the sheet says so.
- **New shortcuts** — `J` Journal, `O` Forecast, `?` shortcuts. All existing
  shortcuts are unchanged.
- **Design layer** — forecast advice tones, load-coloured day cards, category
  balance rows, journal day strip, mood palette, timeline entries and the
  shortcut sheet. All styles are additive and scoped to the new surfaces.
- **Version** — `4.3` in the shell, the client and the footer; service worker
  cache `v4-3-0`.

---

## Verification (recorded)

```
npm run verify
  ✔ lint passed (66 source files, 20 CC API calls verified)
  ✔ tsc (worker + client) — no errors
  ✔ client built (v4.3)
  ✔ tests 281 pass / 0 fail   (21 unit + 5 integration files)

node scripts/smoke-render.mjs
  SMOKE OK — no failures
  (populated + empty workspace, every view including Journal and Forecast,
   quick-capture parse = 5 fields, console errors: none)
```

Migration safety was re-checked: legacy v1 and v3 payloads still load, are
migrated forward to v7 and keep every record.

No new network calls, no new dependencies, no remote assets.
