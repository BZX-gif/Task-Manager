# PAPER — application audit & redesign plan

The inventory the redesign is built from. Everything below was read out of the
running application (`scripts/qa/surface-audit.mjs` boots the real bundle and
records each route's markup), not assumed.

---

## 1 · The application as it exists

Local-first. No database, no authentication, no server state. One persisted
record in `localStorage` under `kcc_state_v1` (schema v8) read through
`lib/state.js` → `core/store.js`. A Hono Worker serves the shell; the client is
vanilla JS rendering strings into `<section>` elements.

### Routes — all 16

| Route | Module | Nodes | What it is | Bespoke classes |
| --- | --- | --- | --- | --- |
| `dashboard` | views/dashboard.js | 417 | Command Center (redesigned) | 72 `atmo-*` |
| `day` | views/dashboard.js | 234 | My Day — execution | 8 |
| `calendar` | views/calendar.js | 673 | Month/week/day grid + agenda | 56 `cal-*` |
| `schedule` | views/schedule.js | 147 | Day timeline | 16 |
| `hyb` | views/hyb.js | 225 | HYB lightweight plan studio | 34 `hyb-*` |
| `tasks` | views/tasks.js | 166 | Missions list | 12 |
| `goals` | views/goals.js | **46** | Goals grid → modal detail | **0** |
| `projects` | views/projects.js | **57** | Projects grid/board → modal detail | **0** |
| `routines` | views/routines.js | 81 | Recurring blocks | 3 |
| `focus` | views/focus-room.js + ui/focus.js | 85 (+1033 UI) | Focus room / timer | 10 |
| `progress` | views/progress.js | 268 | Analytics, heatmap | 10 |
| `review` | views/review.js | 253 | Weekly review journal | 12 |
| `journal` | views/journal.js | 126 | Daily reflection | 24 |
| `forecast` | views/forecast.js | 321 | Two-week load forecast | 23 |
| `paper` | views/paper.js | 186 | PAPER briefing/assistant | 31 |
| `settings` | views/settings.js | 549 | All preferences | 51 |

Overlays that are not routes: briefing letter (`ui/briefing.js`, 481 lines),
quick capture (269), onboarding (347), HYB deck/modal (in `ui/hyb.js`), task &
goal & project modals, command palette, toasts, confirm dialogs.

### Shared vocabulary already in place

`page-heading` + `eyebrow` + `heading-actions`, `card`, `card-header`, `meta`,
`chip`, `segmented`, `input-field`, `btn-primary`/`btn-ghost`/`btn-danger`,
`icon-btn`, `text-button`, `empty-state`, `progress-track`/`progress-fill`,
`entity-grid`/`entity-card`, `domain-tabs`, `modal-box`, `form-stack`/`form-grid`.

That shared vocabulary is why a global redesign is tractable: most views speak
the same class language. The work is to restyle that language once, prop it with
PAPER tokens, and then give the genuinely important pages (calendar, my day,
missions, goals) their own dedicated expressions.

### Findings that shape the work

1. **Goals and projects are the thinnest pages in the product** (46 / 57 nodes).
   They render a grid of cards and push all detail into a modal. The brief asks
   for a *vision journal* and a *workbook* — these are the two pages that most
   need to be built, not merely restyled.
2. **The calendar is the heaviest page** (673 nodes, 56 bespoke classes) and is
   the brief's "signature experience". It already has working month navigation
   and an agenda; the work is a complete visual re-authoring in paper idiom.
3. **Only 6 of 16 views render any empty state at all.** Cards with borders,
   icon tiles and centred padding read as "dashboard"; a journal renders an
   absent entry as a *quiet italic line on ruled paper*, not a boxed panel.
4. **`emptyState()` in `views/shared.js` still emits Tailwind slate classes**
   (`text-slate-300`, `text-slate-500`) — cool greys in a warm system.
5. **The light theme is cool** (`#F4F0E9` / slate-ish borders). The brief calls
   for parchment and cream, so light must be re-pointed warm.
6. **The old theme accent picker offers iris/blue/sage/rose.** Those are the
   "generic blue SaaS / purple" the brief forbids. The accent family should be
   warm metals only.

## 2 · The design system to build

One stylesheet — `public/static/paper.css` — loaded after the existing sheets,
defining PAPER as a set of tokens plus a small component library. Views keep
their existing class names where they are good, and gain `paper-*` primitives
where they need the new expression. Nothing is duplicated per route.

### Tokens

```
surfaces   --paper, --paper-raised, --paper-sunken, --paper-inset
ink        --ink, --ink-soft, --ink-muted, --ink-faint
rules      --rule, --rule-strong, --rule-hair (fine separators)
metals     --bronze, --gold, --champagne, --accent (restrained orange)
type       --font-display (Instrument Serif), --font-body (DM Sans), --font-note
scale      --t-display … --t-meta, editorial line-heights
space      --gutter, --margin (page margins), --rhythm
radii      --r-paper (small, paper doesn't have big rounded corners)
```

### Components (adapted to this architecture as string helpers in `ui/paper.js`)

`paperHeader` (JournalPageHeader) · `sectionTitle` (EditorialSectionHeading) ·
`paperCard` · `paperPanel` · `journalEntry` · `timeline` (PaperTimeline) ·
`calendarSurface` (PaperCalendar) · `missionCard` · `goalCard` ·
`dailyAgenda` · `priorityMarker` · `divider` (PaperDivider) ·
`progress` (ProgressIndicator) · `glassPanel` · atmosphere controller (exists).

Handwriting (`--font-note`) is used **only** for intention and reflection
fields — never for structure, navigation or data.

## 3 · Atmosphere policy per route (brief §12)

Not every page gets a photograph. The rule: **photography is for pages about
being present; paper is for pages about the work.**

| Route | Treatment |
| --- | --- |
| dashboard | full photographic immersion (unchanged) |
| day | photograph at low opacity behind a paper column |
| focus | immersive, quietest photograph |
| paper / briefing | letter on parchment, no photograph |
| calendar | parchment surface, no photograph |
| missions / goals / projects | warm paper background, no photograph |
| progress / forecast / review | paper with a faint photographic wash |
| journal | paper, ruled |
| settings | paper |

## 4 · Build order

Chosen so each step leaves the app working and testable.

1. **Foundation** — `paper.css` tokens + light theme re-pointed warm; remove
   cool accents from the theme picker; fix `emptyState()` cool greys.
2. **Shell** — sidebar as journal index, header, active-chapter indicator.
3. **Component library** — `ui/paper.js` primitives used by every later step.
4. **Goals → vision journal** (build the detail surface in-page, not a modal).
5. **Projects → workbook** (same).
6. **Missions → chapter cards**.
7. **My Day → daily journal** (agenda, priorities, reflection).
8. **Calendar → signature planner** (month/week/day/agenda).
9. **Focus → private study room.**
10. **Briefing → daily letter.**
11. **Remaining interior pages** (progress, forecast, review, journal, paper,
    routines, hyb, schedule, settings).
12. **Motion** — one motion language, reduced-motion respected.
13. **QC** — tests, contrast audit, fit audit, screenshots.

## 5 · What must not break

Every existing data hook. The redesign changes markup and styles; it must not
remove a `data-*` handler, a store write, or a route. The test suite (433
tests) plus the fit and contrast audits are the guard. Where a page is rebuilt
(goals, projects, calendar), the existing hooks are re-verified explicitly.

---

## 8 · Where the redesign stands

Written as work lands, so the document stays the honest record rather than the
original plan. Every claim below is backed by a test in
`tests/integration/paper.test.js` or by a QA script that fails loudly.

### The system

| Piece | State |
| --- | --- |
| Tokens (paper, ink, bronze, gold, champagne, rule, radii, margins) | done — `public/static/paper.css`, loaded last |
| Typefaces | Instrument Serif for display, DM Sans for body, a note face for personal lines, all self-hosted |
| Component library (`ui/paper.js`) | header, section title, card, divider, progress, priority marker, entry, agenda row, absent, figure, figure row, chapter card, note field |
| One header for every route | `pageHeading()` in `ui/common.js` now emits the PAPER header, so all sixteen inherit it from one function |
| Sidebar as journal index | five chapter groups, bronze chapter mark, collapsed and mobile states |
| Motion | one vocabulary (rise, settle, rule, veil), all ≤1.5s, all disabled under reduced motion |

### The chapters

| Chapter | State | The signature |
| --- | --- | --- |
| Command Center | kept from the previous pass | villa photography, atmosphere engine |
| My Day | done | dated chapter opening, today's intention as the lede, priorities on a bronze rule, marginal figures, and an **evening page** whose four prompts write into the journal |
| Missions | done | ledger, plus a **mission workspace**: objective, steps, connected work, the record |
| Goals | done | chapter grid → reading page with milestones that toggle in place |
| Projects | done | workbook header and marginal figures over the three views (list, board, timeline) |
| Calendar | done | a printed month: serif month title, planner date numbers, bronze-underlined today, appointment labels rather than coloured blocks |
| Focus | done | the timer is the largest object; everything else withdraws; full screen empties the room |
| Briefing | done | a letter: salutation, lede, intention, figures between hairlines, a signature at the foot |
| Progress · Review · Forecast · Journal · Routines · Schedule · HYB · Settings | done | ruled lists, small-caps labels, serif figures, no coloured tiles |
| Notes / journal | keeps its existing editor, restyled as a notebook page | |

### What was removed rather than restyled

The brief forbids pages that look like unrelated SaaS. Twenty-nine Tailwind
palette utilities were replaced with paper roles, and two genuinely off-palette
colours (a mint green and an amber) were corrected to gold and bronze. A test
now scans the sources so they cannot return.

### What is verified, and how

- **458 tests**, 25 of them on PAPER behaviour: the three calendar modes and its
  navigation, the plan write path, the briefing's letter structure, the focus
  session lifecycle, the reflection round-trip into the journal, the mission
  workspace, and that no chapter still opens with the old heading.
- **Contrast** 0 failures over 144 sampled region × atmosphere pairs, worst 5.53:1.
- **Fit** 16 routes × 10 widths, 4,330 boxes, no guaranteed horizontal overflow.
- The tests were checked for teeth: breaking the calendar mode switch, adding a
  bouncing animation, or reintroducing a slate utility each makes the suite fail.

### Known limits, stated plainly

- There is no browser in this environment, so visual QC is jsdom plus parsed
  CSS computation. Colours, type and layout are asserted from the cascade; they
  have not been photographed.
- Week and Agenda modes are restyled but the month is the designed signature;
  the brief's "Week / Day / Agenda" maps to the existing week, schedule and
  agenda views rather than to four new ones.
