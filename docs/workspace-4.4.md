# Command 4.4 · The calendar and the HYB button

4.3 answered *what does the next fortnight look like* and *what actually
happened*. Both answers were lists. 4.4 gives them the two shapes people
actually reach for:

1. **Where does everything land on a month?** → **Calendar**
2. **What am I planning, across the whole of my life, in one place?** → **HYB**

HYB is the hybrid layer: study, work, body, people, events and ideas. A *plan*
is deliberately lighter than a mission and heavier than a note — it has a lane,
a day, an optional clock time, a length, an energy and a status, and it can be
finished day by day or turned into a real mission or a real time block when it
deserves one.

Nothing here is a new data source. The calendar reads the missions, time
blocks, HYB plans, routines, deadlines and journal entries the app already
writes; HYB writes into the same store, with the same migrations, backups and
undo behaviour as everything else.

---

## The HYB button

**Where**: the topbar, next to the capture controls; the mobile drawer; a
floating button above the dock on touch screens; the sidebar (*YOUR DAY* →
**HYB Studio**); the command palette; and the key `H`.

Pressing it opens the **HYB deck** — a right-hand panel (a bottom sheet under
700px) with four parts:

| Part | What it does |
|---|---|
| Quick add | One line of natural language, with a lane picker and day/time/length fields. Everything understood is mirrored back as chips **before** anything is saved. |
| Tabs | **Today**, **Next 7 days**, **Someday** (undated) and **Finished**. |
| Rows | Each plan shows its lane stripe, title, meta line, steps progress and the actions: finish, skip, put on schedule, edit. |
| Footer | The current streak, a hint line, and buttons for HYB Studio and a full plan. |

The button is never decoration: it carries a live count of what is still open
today, and a pulse dot when something is waiting.

### Typing a plan

`src/client/lib/hyb.js#parseHybInput` reuses the quick-capture parser and adds
two tokens of its own. Undetected fields stay `null` — nothing is invented.

| You type | It understands |
|---|---|
| `@study`, `@work`, `@body`, `@personal`, `@event`, `@idea` (a prefix works: `@bod`) | the lane |
| `~deep`, `~steady`, `~light` | the energy — how demanding it is, not how long |
| `tomorrow`, `monday`, `20/11`, `next week` | the day |
| `6pm`, `18:30`, `at noon` | the clock time |
| `90m`, `1.5h`, `for 45 minutes` | the length |
| `!high`, `!low`, `p1` | the priority |
| `daily`, `every day`, `weekdays`, `every weekday`, `weekly` | the repeat rule |
| `#mock`, `#gs-paper` | tags — read, then removed from the title |

`Mock paper tomorrow 6pm for 3h @study ~deep !high #gs` saves as one plan
titled *Mock paper*, on tomorrow at 18:00 for 180 minutes, in the study lane,
deep energy, high priority, tagged `gs`.

### Repeats are honest

A repeating plan is a series, not a task. `occursOn` never lets a series appear
before its start date; finishing writes into a per-day `log`
(`{"2026-11-17": "done" | "skipped"}`) and leaves `status` at `planned`, so
tomorrow is still waiting. A one-day plan uses `status` instead. The log is
trimmed to the newest 400 days so a daily plan cannot grow without bound.

### A plan can become real work

| Action | Result |
|---|---|
| Put on schedule | `planToBlock` writes a time block with `id: "hyb:<planId>"`, so Schedule, Forecast and the Focus Room all see it. Existing blocks are never rewritten, and the day is undoable. |
| Make it a mission | `planToTaskPayload` maps title, date, time, priority, length, notes, tags and steps onto a mission; a repeating plan also gets a real recurrence (`planRecurrence`). |
| Duplicate / postpone / drop | Same-day copies, `+1 day`, or a drop that hides the plan everywhere without deleting it. |

Model: `src/client/lib/hyb.js` (pure domain) and `src/client/core/hyb.js`
(mutations through `commit()` / `saveDay()`). Every mutation goes through the
same store path as the rest of the app, so undo, backups, reminders and the
service worker behave identically.

### HYB Studio

Sidebar → **HYB Studio** (`src/client/views/hyb.js`): the same plans as a
working surface rather than a drawer.

- **Scopes** — Today, This week, This month, Next 14, Someday, Finished,
  Everything.
- **Filters** — lane and energy, plus a search across titles, notes and tags.
- **Groups** — by day, with a per-day header that finishes the whole day in one
  action.
- **Cards** — steps you can tick in place, links to the mission/goal/project a
  plan belongs to, and the actions above.
- **Side rail** — today's load, the week strip, the lane balance (minutes per
  lane), what needs attention (overdue and undated) and the streak.

Coverage: `tests/unit/hyb.test.js` (23 cases) and the jsdom flows in
`tests/integration/hyb-calendar.test.js`.

---

## Calendar

**Where**: sidebar → *YOUR DAY* → **Calendar** (`src/client/views/calendar.js`),
the Schedule toolbar's new **Month** segment, the command palette, or the key
`C`.

One view, three modes, one day rail:

| Mode | What it shows |
|---|---|
| **Month** | A 5–6 week grid on your week start. Each cell carries the day's entries as coloured chips, quiet dots for markers, a load bar along the bottom and a `+` that opens the plan editor on that day. Neighbouring days are dimmed, never hidden. |
| **Week** | Seven columns with the same entries as lines, each column summarising count and minutes. |
| **Agenda** | A list of the days that actually have something on them, for the next month. |

The **day rail** on the right is the detail: every entry for the selected day
in reading order, a load bar against your working hours, and actions to open
the day in Schedule, add a mission, add a HYB plan, or finish a plan in place.

### Layers

Everything on the grid is a layer you can switch off — time blocks, missions,
HYB plans, routines, deadlines, journal days. Choices are stored in
`settings.calendar.layers` and survive reloads; turning the HYB layer off also
writes `settings.hyb.showOnCalendar = false`, so the two surfaces agree.

A HYB plan that has been put on the schedule exists twice in the data — as a
plan and as a time block. The calendar draws it **once**, in its lane colour,
at the time it was actually placed, with the duration the block has (so dragging
it on the Schedule is respected) and the note *on the schedule*. Minutes are
never counted twice.

### Reading the grid

`src/client/lib/calendar.js` is pure and holds no state of its own:

- `monthMatrix(anchor, { weekStart, todayKey })` — the cells, with `inMonth`,
  `isToday`, `isFuture`, `isWeekend`, plus `prev`/`next` anchors.
- `dayEntries(state, dayKey, { layers })` — one day in reading order: timed
  entries by clock, then untimed work by priority, then quiet markers.
- `daySummary` — count, visible count, minutes, open minutes, load percentage
  and status (a day with a clash reads as heavy whatever its total), lanes
  present, and flags for journal/HYB/deadlines/protected time.
- `monthOverview`, `monthStats` — per-cell summaries and the month facts for
  the side rail: hours committed, quiet days, heavy days, journal days, HYB
  days, deadlines, busiest day and average.
- `agendaDays`, `weekCells`, `shiftMonth` (clamped: Jan 31 → Feb 28).

Keyboard on the grid: arrows move the selection, `PageUp`/`PageDown` change
month, `Enter` opens the day in Schedule, `Space` or `+` adds a HYB plan to it.

Coverage: `tests/unit/calendar.test.js` (17 cases); the same integration file
drives the grid, the layers, all three modes, the day rail and the editors that
open from it.

---

## Schema v8

State moves **v7 → v8** with `migrateStateV7ToV8`. The migration is additive:
existing records, IDs, journal entries and preferences are untouched.

```js
hyb: { plans: [] }                       // new top-level shelf
settings.hyb = {
  defaultMinutes: 60,                    // 5–1440, clamped on read
  defaultKind: 'study',
  showOnCalendar: true,
  deckOnLoad: false,
}
settings.calendar = {
  mode: 'month',                         // month | week | agenda
  layers: { blocks, missions, hyb, routines, deadlines, journal }, // all true
}
```

`normalizeState` keeps the newest 2000 plans; `lib/backup.js` reports
`hybPlans` in the export summary and in the import description, so a backup
tells you what is inside it. Safety copies (`kcc_backup_pre_v2`, `_pre_v6`,
`_before_change`, `_unreadable`) behave exactly as before.

Settings → *Your day & HYB* exposes the defaults and the two toggles, with a
button that opens the deck so you can see what the setting does.
`deckOnLoad` is a genuine one-time nudge: on a brand-new workspace with no
plans and no missions, the deck opens once (never over the morning briefing or
an open dialog) and records itself in `state.meta.hybDeckNudged`, so it cannot
repeat and an existing workspace is never interrupted.

---

## The design pass

`public/static/style.css` gained a 4.4 section (~490 lines, appended — nothing
existing was rewritten). It is tokenised, so both themes and every accent keep
working.

- **Six lane colours** as `--hyb-study/work/body/personal/event/idea`, with a
  porcelain-light set, driven by one `--lane` variable that every HYB and
  calendar surface inherits.
- **The HYB button** — a real object: accent-tinted glass, a sheen that sweeps
  on hover, the wordmark letters lifting alternately, a count pill and a pulse
  dot. On touch screens a floating version sits above the dock.
- **The deck** — a glass panel with its own scrim, sliding in from the right
  and becoming a bottom sheet under 700px, with thumb-reachable controls and
  safe-area padding.
- **Cards, rows and chips** — lane stripes, hover lift, focus rings, a
  progress track for steps, and a round check button that snaps when it fills.
- **The grid** — cells that lift on hover, a today ring, a selection ring, a
  load bar tinted by status, chips that collapse to coloured dots under 640px
  so a phone month is still legible.
- **Refinements across the app** — visible focus rings everywhere, themed thin
  scrollbars, a lit primary button with a real press, an unmistakable active
  segment, a hairline accent on toasts (colour-coded by type), an eyebrow tick,
  a halo on empty-state icons, and nav rows that move a millimetre.
- **Reduced motion** — every new animation and transition is disabled under
  `prefers-reduced-motion`.
- **Touch** — 44px targets on coarse pointers, always-visible cell add buttons,
  side-by-side row actions.

---

## Small things in the same release

- **New keys** — `H` HYB deck, `C` calendar. The shortcut sheet documents them
  plus the grid keys; both are suppressed while typing or while a dialog is open.
- **Command palette** — *Open the HYB deck*, *New HYB plan*, *Calendar*, and
  every plan title is searchable.
- **Schedule** — a fifth segment, **Month**, hands over to the calendar on the
  same date.
- **Triggers everywhere** — the topbar, the drawer, the FAB, the calendar rail,
  HYB Studio, Settings and the palette all open the same deck.
- **Version** — `4.4` in the shell, the client and the footer; service worker
  cache `v4-4-0`.

---

## Verification (recorded)

```
npm run verify
  ✔ lint passed (72 source files, 24 CC API calls verified)
  ✔ tsc (worker + client) — no errors
  ✔ client built (v4.4)
  ✔ tests 332 pass / 0 fail   (24 unit + 6 integration files)

node scripts/smoke-render.mjs
  SMOKE OK — no failures
  (populated + empty workspace, all 16 views including Calendar and HYB Studio,
   HYB parse = 7 fields with one clean tag chip, calendar grid = 42 cells,
   the deck nudge, the studio scopes,
   week/agenda/month modes, layer toggle, studio cards + lane balance,
   console errors: none)
```

Migration safety was re-checked: legacy v1 and v7 payloads load, migrate
forward to v8, keep every record, and arrive with an empty `hyb.plans` and all
six calendar layers on.

No new network calls, no new dependencies, no remote assets.
