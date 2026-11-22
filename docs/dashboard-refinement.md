# Dashboard refinement — hierarchy, the command card and recovery

A focused pass over the Overview surface. No route, schema or stored-data
contract changed; `npm run verify` is green at **365/365**.

## What changed

| Surface | Before | After |
|---|---|---|
| Greeting | eyebrow repeated the date that the date block already showed; intention was a bare button | eyebrow is a quiet “Command briefing” tick; the lead, intention commitment and date block are separated; the intention shows its saved state with a check |
| Next Move | large card, one meta row, much empty space | task title (not the generic block label), a “why” line that names the source and the connected goal/project, and a four-fact instrument strip — Scheduled · Length · Priority · Window/Remaining |
| Execution score | encouraging but generic copy | contextual, non-punitive copy including a zero-score state (“a starting line, not a verdict”); components with no data are dimmed rather than shown as failure |
| Recovery | one amber banner, one action | compact assistant card: count, “no catch-up required”, a primary **Review & recover** and an opt-in detail list. Each row offers Resume · Reschedule · Postpone · Abandon, all explicit |
| Top bar | search buried among the actions; HYB trigger competed with New Mission | search is a centred field (icon under 1250px), HYB is a quiet trigger, New Mission stays the primary action |
| Consistency | metric padding collapsed at 1250px; quick-action hover shifted text; card hover lifted 2px | tokenised padding, background hover, 1px lift |
| Command strip | long task titles and the reason line pushed past the viewport at 768–1023px | flex children can shrink; the task and reason truncate with ellipsis; the salute hides under 1023px |
| Overview bottom | the two-column grid overflowed by ~3px at 768px | stacks to one column at ≤1023px, matching the top and middle rows |

## Recovery rules

- The count comes from the real `overdueTasks` set — nothing is invented.
- The detail list is opt-in and shows at most five missions.
- **Resume** opens a focus session on the mission.
- **Reschedule** opens the existing reschedule dialog (date/time, tomorrow, skip).
- **Postpone** moves one mission to tomorrow and records it in history.
- **Abandon** asks for confirmation, then sets `status: cancelled`; the record and
  its history remain.
- No mission is completed, moved or abandoned without an explicit action.

`postponeMission` and `abandonMission` were added to the `window.CC` surface
(backed by the existing `core/actions.js` implementations) and are covered by
`tests/integration/dashboard-recovery.test.js`.

## Tokens and motion

All new values use the system tokens (`--fs-*`, `--r-lg`, `--card-pad`,
`--section-gap`, `--motion-*`, `--ease`). The recovery detail expands with a
`grid-template-rows` transition that collapses under the existing
`prefers-reduced-motion` guard. No new dependency was added.

## Verification

```
npm run verify                     # lint + typechecks + build + 365 tests
node scripts/smoke-render.mjs      # every view + dialogs, no console errors
node scripts/qa-sweep.mjs          # interaction probes, no errors/warnings
node scripts/static-audit.mjs      # tokens, braces, hooks — 0 problems
```

### Real-browser pass

A headless Chromium (`@sparticuz/chromium` + `puppeteer-core`, run against
`wrangler dev`) was used for a real render pass. Results:

- **27/27 checks, 0 console/page errors** across 360 / 390 / 430 / 768 / 1024 /
  1280 / 1440 / 1920px.
- No horizontal overflow at any width; every top-bar control stays inside the
  viewport.
- Seeded workspace (2 overdue missions, a Top 3, a saved intention, a linked
  goal): the recovery card counts `2 earlier missions are still open`, the
  command card shows the real mission title, and the intention renders.
- Recovery detail expands (`aria-expanded=true`, animated height), **Postpone**
  moves one mission to tomorrow with `status: rescheduled` and a history entry
  while the list re-renders, and **Abandon** confirms first, then sets
  `status: cancelled` (`done` stays `false`) and hides the card when empty.
- Mobile navigation opens with `aria-expanded` state at 390px.
- `prefers-reduced-motion: reduce` resolves `--motion-fast/normal/slow` to
  `1ms`.

Screenshots (seeded workspace, real build):

| Viewport | File |
|---|---|
| 1920 / 1440 / 1280 | `docs/screenshots/wide-1920.png`, `desktop-1440.png`, `laptop-1280.png` |
| 1024 / 768 | `docs/screenshots/tablet-1024.png`, `tablet-768.png` |
| 430 / 390 / 360 | `docs/screenshots/mobile-430.png`, `mobile-390.png`, `mobile-360.png` |
| Recovery expanded / abandon confirm / mobile nav | `docs/screenshots/recovery-expanded.png`, `abandon-confirm.png`, `mobile-nav-390.png` |

### Known issues (outside this pass)

A whole-app overflow sweep at 390 / 768 / 1024px found pre-existing horizontal
overflow in views this brief does not touch: **Calendar** at 390px and 1024px,
**Journal** at 390px, and **Settings** at 390px. They are unrelated to the
dashboard changes and were left alone to keep this pass focused.
