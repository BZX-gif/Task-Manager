# Command 5.0 — the visual system

A full redesign of the workspace, plus the defects that redesign exposed.
Stored data is untouched (schema **v8**); `npm run verify` finishes **360/360**.

This pass was done with a real browser in the loop. Every claim below was
verified by rendering all 16 views at 1440 / 768 / 390 in both themes and
measuring the result — overflow, clipping, contrast, touch targets — rather
than by reading the CSS.

---

## 1 · What was actually wrong

The previous visual layer had grown by accretion: eight "glass" aliases pointing
at near-identical greys, four different primary-button treatments, headings at
fixed 27/32/38px, and **59 labels set at 9px with 9 more at 8px**. It looked
considered in isolation and inconsistent in aggregate.

Measured before the redesign:

| Symptom | Measurement |
|---|---|
| Mobile headline duplicated | greeting + date + clock rendered **twice** on one screen |
| Calendar month clipped | a 740px scroll box cut the grid mid-row |
| Grid tracks blown out | a `<select>` forced a **513px** column inside a **362px** container |
| Edition previews sliced | 112px window, **171px** of content |
| Contrast failures | edition meta **1.42:1**, calendar day **1.94:1** |
| Touch targets | 51 sub-32px controls on the calendar alone |

Three of those were not style problems at all — they were bugs with a visual
symptom, and each is now covered by a test.

---

## 2 · The system

`public/static/system.css` is a new sheet, loaded last, that *replaces* the old
scale rather than patching it. It is organised in sixteen numbered sections.

### Type
A real 1.25 modular scale, fluid between a phone and a desktop with `clamp()`,
so there are no jump-cuts at breakpoints:

```css
--fs-3xs: clamp(10px, 0.62vw + 9.4px, 11px);   /* labels — never 8px again */
--fs-sm:  clamp(13px, 0.24vw + 12.4px, 14px);  /* body */
--fs-3xl: clamp(27px, 1.80vw + 20.5px, 38px);  /* page titles */
--fs-4xl: clamp(32px, 2.60vw + 20.5px, 48px);  /* the greeting */
```

Three weights only (400 / 500 / 600). Negative tracking only on display sizes,
positive tracking only on microlabels. Tabular numerals on every number in the
product, so a clock or a score never jitters as it counts.

### Depth
Three named planes replaced eight aliases:

```css
--plane-1: #131313;  /* resting card on canvas */
--plane-2: #181818;  /* card on card, hover   */
--plane-3: #1f1f1f;  /* popovers, active rows */
```

Each carries a lit top edge and a shadowed bottom edge, which is what makes the
surface read as carved in both themes — a dark plane gets a white hairline on
top, a light plane gets a paper-white one plus a soft shadow beneath.

### Motion
Tokens, not per-rule values, so `prefers-reduced-motion` collapses everything at
once. Things *arrive* (decelerate), *leave* (accelerate), and never bounce.

### Structure
- Every grid track is `minmax(0, 1fr)`; every card child is `min-width: 0`.
  This is the general fix for the 513px-in-362px class of bug.
- Horizontal page scroll is impossible; scrollers (calendar layers, the settings
  rail, the mission filters) scroll inside themselves and say so with a fade.
- On a phone the command strip keeps the *task* and drops the salutation, and
  the date block becomes one line, because the same three facts were being
  printed twice in the first 120 pixels of the screen.

---

## 3 · Bugs the redesign exposed

| Bug | Why it mattered | Fix |
|---|---|---|
| **The clock tick destroyed markup** | `updateClockAndGreeting()` ran every second and did `date.textContent = …`, wiping whatever the view had rendered inside that element. Adding two spans for the long/short date made the short form unreachable — the first tick deleted it. | The tick now updates each span in place, and falls back to the bare element for older markup. `tests/unit/chrome-timers.test.js` guards the whole class: a timer may update text it owns, never a container a view renders into. |
| **Calendar showed a daily template as 210 appointments** | A recurring study timetable was tagged `kind: 'mission'`, so every day in the month looked identically booked. The grid carried no information and the header read "30 of 30 days". | Template blocks get their own `kind: 'template'` through planner → summary → cell. `daySummary` now separates `routine` from `commitments`; the month cell leads with commitments and summarises routine as one quiet line ("Routine · 17h"); the header reports days with a *commitment*. |
| **Calendar clipped its own month** | `max-height: 740px` cut the grid mid-row, which looked like a rendering fault. | The grid flows; its height is its content. |
| **Edition previews sliced their own name** | 112px fixed height against 171px of content, and the two pale editions set pale ink on pale paper. | Content-sized previews with an explicit layout (label top-left, monogram bottom-right) and per-surface ink. |
| **"30 of 30 days has something on them"** | Grammar, in the most-read caption on the screen. | Rewritten, and the number now means something (see above). |
| **The briefing covered the first visit** | A brand-new workspace got a modal 1.2s in, before the person had seen the product once. | The daily timing is unchanged for a workspace with a day to brief on; an empty workspace is not interrupted — that moment belongs to onboarding. |

---

## 4 · The first five minutes

The app had an `onboarding.seen` flag that **nothing read**. A new workspace
landed on four empty cards. Empty states are honest but they do not explain a
system.

`src/client/ui/onboarding.js` is a three-step flow:

1. **The promise** — one sentence, three capabilities, and the privacy fact that
   makes the product different ("no account, no server, no analytics").
2. **A working demo** — type a plan the way you'd say it. The preview runs the
   *real* `parseQuickCapture` and renders friendly chips ("Tomorrow · 6:00 pm ·
   1h 30m"), so the promise here is the promise in the product, not a mock.
3. **Three things worth knowing** — ⌘K, N, F, and where the rest live.

It is skippable from every step, closes on Escape or backdrop without trapping
anyone, traps Tab while open, and writes its own completion so it never returns.
It opens instead of the briefing on an empty workspace and never on a full one.

---

## 5 · Verification

```
npm run verify    # lint + typecheck + build + 360 tests   → 360/360
node scripts/smoke-render.mjs                             → SMOKE OK, 0 console errors
```

New coverage:

- `tests/unit/design-system.test.js` (7) — the sheet is linked and precached in
  the right order; no type step bottoms out under 10px; reduced motion is
  honoured through tokens; the three planes exist in both themes; no grid track
  can be widened past its container.
- `tests/unit/chrome-timers.test.js` (4) — the clock tick cannot clobber a view's
  markup, and no other chrome timer rewrites a container.

Rendered and measured after the change: zero horizontal page scroll at 390px,
zero clipping outside intentional scrollers, and the two contrast failures
(each well under 2:1) gone.

---

## 6 · Deliberately not changed

- **The "Sir" persona.** It reads oddly out of the box, but it is a *setting*
  (Settings → Briefing → "What should the briefing call you?") and it is
  covered by the integration suite. Removing it would remove a capability, so it
  is documented here rather than silently dropped. The default is still `'Sir'`
  in `lib/briefing.js` if a future pass wants to change it.
- **The seeded UPSC timetable and its uppercase subjects.** Real historical data
  that `defaults.js` explicitly promises never to replace or restyle. The
  calendar now presents it honestly as a routine instead of rewriting it.
- **Category colours.** User data, not theme tokens.
