# Command 5.0 · The Executive Layer

**Shipped:** schema **v8** · app & PWA **5.0** · default view **Command Center**

4.3 made the workspace honest about time. 5.0 answers the two questions a
serious operator asks before the day starts, and it answers them from records
already on the device:

1. **"What is the single most consequential thing for me right now?"** → the
   **Command Center** home, which commits to exactly one answer.
2. **"Am I actually running my life, or just my task list?"** → the
   **Command Index** and the **Money** ledger, which measure the parts of a
   life a task list cannot see.

There is no model call, no telemetry, no bank connection and no invented data
anywhere in 5.0. Every number below is computed from what the person typed.

---

## 1. The Command Center

`src/client/views/command.js` renders shell-markup only; every judgement lives
in `src/client/lib/command.js` (pure, unit-tested in
`tests/unit/command.test.js`).

### The focus card — one decision, not a dashboard

`headline(state, {todayKey, now})` returns a single `{key, title, body, tone,
label, view, cta}` object, evaluated in order of consequence:

| Priority | Situation | What it says |
|---|---|---|
| 1 | Two planned blocks overlap | names the collision, offers the schedule |
| 2 | A block is running now | names it and the minutes left |
| 3 | Work is overdue | counts it, offers the overdue filter |
| 4 | Nothing is placed for today | offers the fastest way to place something |
| 5 | The day is planned and unfinished | offers the next block |
| 6 | Everything for today is done | says so, and stops |

The card never invents a task. On an empty workspace it lands on the honest
"nothing is late" state and offers the first real step.

### The Command Index — a life score with the receipts attached

Four pillars, each 0–100, each computed only from real records:

| Pillar | Weight | Source | What it means |
|---|---|---|---|
| **Execution** | 0.35 | today's completion log, top-3 follow-through | did the day's decisions get kept? |
| **Depth** | 0.25 | focus seconds vs planned minutes, deep-work blocks | was the work that matters actually sat with? |
| **Consistency** | 0.20 | 14-day completion rhythm, streaks | is this repeatable, or a spike? |
| **Stewardship** | 0.20 | savings rate, budget discipline, cleared entries | is the future being funded? |

Rules that keep the number honest:

- **Missing pillars are excluded, not zeroed.** A person with no ledger is not
  punished for it; the weights of the measured pillars are re-normalised to 1.
- **No measurable data → `index: null`.** The UI then says *"Not enough yet"*
  and explains exactly what would make it measurable. It never shows a `0`.
- `indexVerdict()` is written to be true at both ends: it congratulates 90+ and
  reassures 20- without moralising.
- Tapping the ring opens `openIndexInfo()`, which shows each pillar's weight,
  its current value and the sentence describing how it was earned.

### The seven signals — every one is a door

`healthSignals()` returns seven compact tiles (priorities, deep work, load,
overdue, streak, money, review). Each carries a real `display` value, a
`good`/`warn` state, and a `view` it navigates to. Tapping a signal is the
fastest route to the surface that can change it — there are no dead tiles.

### The week board — capacity, not hope

`loadPlan(state, {days})` compares committed block-minutes against
`capacityMinutes(state)` (derived from the working-hours setting, never a
constant) for each day. It reports:

- `status`: `empty` / `light` / `balanced` / `full` / `conflict`
- `overcommitted` days and `freeMinutes` left in the horizon
- `conflicts` — overlapping blocks found by interval sweep

The horizon switch (7 / 14 days) is a real control, not a label.

### Rhythm and next actions

`weekdayRhythm()` measures which weekday actually gets things finished
(completion log + focus sessions, last 8 weeks) and names the strongest and the
hardest day. `nextActions()` proposes at most four concrete moves, de-duplicated
by key, each pointing at a surface. `trendOf()` compares the two halves of a
series and refuses to call a two-point difference a trend.

---

## 2. Money — a ledger that respects the person

`src/client/lib/ledger.js` is a pure engine (18 unit tests in
`tests/unit/ledger.test.js`); `src/client/views/money.js` is the screen.

### Privacy stance

The ledger lives in the same `localStorage` document as everything else — one
origin, one device, nothing uploaded. The screen says so in plain words:
*"stored in this browser only · no bank connection · nothing uploaded"*.

### The model

```
ledger: {
  accounts:     [{ id, name, kind, institution, openingBalance, archived }]
  transactions: [{ id, kind, date, amount, accountId, toAccountId, categoryId, note, tags, cleared }]
  budgets:      [{ categoryId, limit, rollover }]
  recurring:    [{ id, name, amount, cadence, dayOfMonth, categoryId, accountId, active }]
  notes:        [{ id, direction, person, amount, date, dueDate, settled }]
}
```

Account kinds: `bank` · `cash` · `credit` · `investment` · `wallet` · `loan`.
`credit` and `loan` are **liabilities**: their balances subtract from net worth.

### Invariants (enforced in the engine, proven in tests)

- **Balances are always derived**, never stored — no drift is possible.
- A **transfer** moves money between accounts and is *excluded* from income,
  expense and savings-rate maths. Moving your own money is not spending.
- **Archived accounts** leave the totals but keep their history.
- **Unknown account or category ids become `null`** rather than inventing a
  record; a transaction is never silently attached to the wrong budget.
- **Recurring rules never auto-post.** They forecast the next charge date; the
  person decides what actually happened.
- Amounts are rounded to paise on the way in (`roundMoney`), and `parseMoney`
  accepts what people actually paste (`1,250.50`, `₹2 000`, `-400`) while
  treating garbage as `0` instead of `NaN`.
- `nextChargeDate()` never returns a past date and never rolls past day 28.

### The five editors

`openAccountModal` · `openTransactionModal` · `openBudgetModal` ·
`openRecurringModal` · `openNoteModal`. All are keyboard-closable, all validate
inline, none can create an orphan record.

### What the screen shows

Net worth (with liabilities subtracted), liquid vs invested, this month's
income / expense / savings rate, per-account balances, budget bars that turn
into an `is-over` state with a real overspend figure, upcoming recurring
charges, IOU net position, an advice line derived from the data, and a
filterable entry list (month, in/out). Every figure uses the chosen currency
and `−` for negatives.

Money also reaches the rest of the app: the Overview pulse card, the Forecast
money strip (next 14 days of planned charges), the briefing week stat, the
AI-context capacity line, and the settings Money section (8 currencies).
Money is **off** the AI context by design: only aggregate totals, never names
or notes.

---

## 3. Data safety

- `STATE_VERSION = 8`; the migration chain is additive. `v7 → v8` adds an empty
  `ledger` and `settings.money`; **nothing existing is touched**.
- Backup copies are written before earlier upgrades (`kcc_backup_pre_v6`, …)
  and kept.
- The v8 normaliser reads `raw.ledger` defensively: a corrupt or partial ledger
  degrades to an empty ledger rather than failing the boot.
- `tests/integration/command-center-5.test.js` boots a real v7 payload, asserts
  every task, journal entry and setting survived, then asserts the ledger is
  present and empty — and repeats the check after a persistence round-trip.

---

## 4. Design system additions

New tokens and blocks live under the `COMMAND 5.0` marker in
`public/static/style.css`:

- Layers: `--glass-sheen-soft`, `--glass-secondary-bg`, `--glass-interactive-bg`
- Semantic: `--success`, `--warning`, `--danger` used for state, never for brand
- Geometry: 22px cards, 14px controls, 1px hairlines, 8pt rhythm
- Motion: one 220ms curve for state, 420ms for the index ring, all stilled under
  `prefers-reduced-motion`
- Breakpoints: 1380 / 1180 / 900 / 720 / 420 — every new grid collapses
- Print: the sidebar, topbar and dock are hidden and the focus card survives

`tests/unit/design-5.test.js` locks these contracts: no raw hex surfaces, all
five breakpoints present, reduced-motion block covers every new interactive
element, every new control is a `<button>` with a focus ring, the router, the
sidebar and the dock agree on every view, every shell icon resolves, and the
privacy copy exists in the source.

---

## 5. Verification

| Gate | Result |
|---|---|
| `npm run lint` | ✔ 78 source files, every `CC.*` call verified |
| `npx tsc -p tsconfig.client.json` | ✔ clean (`checkJs` on the whole client) |
| `npm run build` | ✔ worker + PWA |
| `npm run build:client` | ✔ v5.0, 636 kB |
| `npm test` | **329 / 329 pass** |
| Runtime audit (jsdom) | 16/16 views render with a populated workspace, **0 errors**, **0 unstyled classes** |
| Accessibility audit (jsdom) | 0 unlabelled buttons, 0 unlabelled fields, 0 duplicate ids, 0 multiple-`h1` views |
| Theme | dark ⇄ light ⇄ dark with no residue |

Honest limitations: no real browser was available in this environment, so
visual QA was done through rendered DOM, computed class coverage and CSS
contract assertions rather than screenshots. Numbers are only as good as the
data typed into them — the index says "Not enough yet" rather than flattering
the user.

---

## 6. What 5.0 refuses to do

- **No streak shaming.** Breaking a streak never reddens the whole app.
- **No invented records.** Quick capture, recurring charges and the index all
  create nothing the person did not ask for.
- **No fake precision.** `index: null` is a valid, designed state.
- **No cloud.** One origin, one device, one export file.
