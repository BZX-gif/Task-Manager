# Responsive repair — Calendar, Journal, Settings

Phase 2 of the COMMAND refinement: a focused repair of the overflow defects the
Phase 1 QA audit left open, verified in a real headless Chromium against the
built app. No view was rebuilt, no feature removed, no storage contract touched.
All changes are CSS in `public/static/style.css` (layer **25 · RESPONSIVE
REPAIR** + **25b · necessary corrections**).

## Root causes

| Reported issue | Actual cause |
|---|---|
| Calendar @390 (and 360/430) | The month rows render as `.cal-week`, but the seven-column grid rule still targeted a `.cal-grid` class the view no longer emits, so each week stacked as full-width cells (broken at *every* width). With rows stacked, every nowrap `.cal-chip-title` contributed its full text width to the layout's min-content (~471px), and the side rail (`min-width:auto`) pushed the same minimum into the `1fr` layout track in all three modes. |
| Calendar @1024 | Two clusters: page-heading actions (“Day schedule” / “Add HYB plan”) had no wrap below 1250px and left the viewport; the stats card action row (“Load forecast” / “HYB Studio”) overflowed the 250px side rail by ~8px. |
| Calendar week @390 | Seven `minmax(0,1fr)` columns squeezed to 60px; the entry rows (buttons) kept their max-content width and painted outside the columns. |
| Calendar agenda @390 | Same button rows sized to max-content inside the scroll body. |
| Journal @390 (and 360/430) | `.journal-day-strip` is a non-wrapping flex row of seven fixed-padding buttons (~441px min-content), which stretched the compose card past the viewport. The two-column win/next grid added a second minimum at ≤430px. |
| Settings @390 (and 360/430) | The backup-import label wraps a real `<input type="file">` that was never visually hidden; its intrinsic ~274px width made the label 439px wide inside a 312px column. |

Found while verifying the fixes (repaired in the same pass):

| Issue | Cause |
|---|---|
| Month cells showed a vertical orange bar | `.cal-cell-load` is a `<span>` with no `display`, so it stayed inline: its `height:3px` never applied and the inner `i { height:100% }` resolved against the *cell* (≈135px tall). Pre-existing, only visible once the grid renders again. |
| Dashboard “Coming up” overflowed ≤1023 with real data | The pre-existing row layout (`flex-direction:row`, `align-items:center`) neither wrapped nor stretched; each row sized to its longest nowrap title (up to 477px). Necessary correction — see below. |
| Goals/Projects filter row @430 | The search field was squeezed to ~40px and its input poked 5px past the viewport. |
| Month nav label @≤480 | “November 2026 / 6 of 30 days with a commitment” wrapped to three lines between the stepper arrows. |

## What changed

`public/static/style.css` only — layer `25 · RESPONSIVE REPAIR`:

- `.cal-month .cal-week` gets the seven-column grid the view always intended;
  chips gain `min-width:0` + ellipsising titles so they truncate inside cells.
- `.cal-side`, day/stat cards and rows gain `min-width:0`; action rows wrap —
  the rail can no longer dictate the track width.
- Week and agenda entry rows (`button.cal-line`) fill their column; at ≤767px
  the week grid becomes an internal horizontal scroll lane
  (`minmax(128px,1fr)` columns, scroll-snap) so seven honest day columns stay
  legible on a phone instead of 44px slivers.
- `.cal-cell-load{display:block}` restores the 3px load track.
- Page headings wrap their actions at ≤1250px; the decorative day-1 month tag
  (aria-hidden; the month name lives in the toolbar and stats header) hides
  where columns are too narrow for it.
- Journal day strip becomes a seven-column grid at ≤767px; the win/next pair
  stacks at ≤430px.
- The settings file input is visually hidden with the clip pattern at all
  widths — still focusable and in the accessibility tree, still triggered by
  the label and its keyboard handler.
- Month nav label gets its own line above the stepper at ≤480px.

Layer `25b · necessary corrections` (two surfaces outside the named views that
broke the no-overflow contract once real data landed in them):

- `.up-next-card .timeline-mini` rows wrap (2-up at ≤1023, stacked at ≤430) and
  stretch on the cross axis; titles ellipsise. The merged dashboard is
  otherwise untouched.
- `.filter-row .toolbar-search` takes its own line at ≤480px.

## Verification

Real headless Chromium (`@sparticuz/chromium` + `puppeteer-core`) against
`wrangler dev`, seeded workspace (7 missions incl. overdue + long titles,
schedule blocks, HYB plans, 3 journal entries, routines, protected time):

- **Overflow sweep: 128/128 combinations clean** — 16 views × 8 widths
  (360/390/430/768/1024/1280/1440/1920), `documentElement.scrollWidth ==
  innerWidth` everywhere, **0 console/page errors**.
- **Calendar/journal/settings probe: 27/27 clean**, including week and agenda
  modes at 390/1024.
- **Interaction regression: 21/21 pass at 390 and 1440** — mode switching, day
  selection → rail update, month stepping, layer toggle persistence, chip →
  editor modal, week lane internal scroll, journal save round-trip, settings
  toggle + section nav, import input intact.
- `npm run verify` → lint (73 files) + both typechecks + build + **365/365 tests**.
- `scripts/static-audit.mjs` → 0 problems · `smoke-render` → SMOKE OK ·
  `qa-sweep` → 0 errors / 0 warnings.

### Screenshots (`docs/screenshots/responsive/`)

Before/after pairs for every reported defect: `calendar-month-{360,390,430,768,1024,1440}-before/after.png`,
`calendar-week-390-*`, `calendar-agenda-{390,1024}-*`, `journal-{360,390,430}-*`,
`settings-{360,390,430}-*`, plus `dashboard-{390,768}-after.png`.

## Remaining issues

- None known. The only intentional inner scrolling is the week-mode lane on
  phones (thin scrollbar + scroll-snap as affordance) and the pre-existing
  mission filter segmented control; every view fits its viewport without
  page-level horizontal overflow at all eight tested widths.
