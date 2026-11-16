# Command 4.0 — Visual QA & Implementation Report

**Branch:** `arena/9172d9fe-task-manager` (base `f41da45` of `main`)
**Date:** 2026-11-15
**Companion document:** `docs/command-4-design-audit.md` (findings C1–L3, all cross-referenced below)

## 1 · What changed

### Identity — HYBRID × BURNT ORANGE
- **Ember orange `#F0783E` is the new default Command accent** (hover `#FF8750`,
  soft `rgba(240,120,62,.12)`, border `rgba(240,120,62,.28)`, dark ink
  `#221005` on orange primary buttons — 6.6:1 contrast). Wired consistently
  through: `src/shell.ts` (`data-accent="ember"` + inline boot script),
  `lib/defaults.js`, `lib/state.js` normalisation, the Settings picker
  (Ember listed first), `style.css` tokens, `tailwind.config.js`,
  `core/charts.js` fallbacks, `favicon.svg` and the regenerated PWA icons
  (`npm run icons`, zero-dependency generator recoloured).
- **All legacy accents preserved** — iris/blue/sage/amber/rose remain fully
  tokenised (dark *and* light variants, each now with a hover token) and are
  still selectable, so a stored preference is never silently reset. Iris is
  re-added to the allow-lists exactly as before.
- Warm graphite foundation: void `#080808`, deep `#101010`, surface `#151515`,
  elevated `#1C1C1C`, hover `#242424`; text warm ivory `#F5F1EB`, secondary
  `#AAA6A0`, muted refined from the spec's `#77736F` to **`#837e78`** because
  the spec value measured ≈4.0:1 on surface (below WCAG AA for the small
  metadata it paints); `#837e78` measures ≈4.6:1. Light theme went warm
  (`#f6f4f1` paper, `#1c1917` ink, ember darkened to `#b8511d` = 4.96:1 on
  white).
- No blue or purple remains in the *default* identity; success/warning/danger
  (`#8ac6ad` / `#d7b582` / `#e39b9b`) stay visually distinct from ember.
- Ember is used deliberately only for: primary actions, selected navigation
  (soft fill + hairline border + 3px edge bar), active focus ring/timeline
  dot/timer chip, progress fills, priority-high dots, today's chart bar,
  heatmap levels, and the hero's static atmosphere. Chart series stay neutral
  white — honest data, accent marks meaning.

### Material & surfaces
- Card/panel material re-cut **at the token source** (no new override layer):
  scrolling surfaces are now solid graphite (`#151515` / `#121212`) under a
  heavily restrained sheen; sidebar and topbar are solid `#0c0c0c`.
- Translucency + backdrop blur remain **only** on genuinely floating surfaces
  (mobile nav drawer, bottom dock, toasts, calendar event toolbar) — no
  backdrop-filter was added to any scrolling card or large surface.
- Card hover lift calmed from −2px to −1px; edge-light border on hover kept.
- Dead CSS removed: `.command-result*`, `.accent-picker`,
  `.accent-swatch.selected`, orphaned `.review-metrics/.review-reflection/
  .review-day-row` dialect (audit H3/L1). `'Sora'` font references (never
  loaded) replaced with the system display stack (audit H2). Legacy hardcoded
  semantic rgba literals re-pointed at current tokens.

### Shell
- Sticky, solid topbar (64px desktop / 58 tablet / 56 mobile) with hairline
  border; search trigger upgraded from bare text to a real bordered field with
  hover states; nav-active gains an ember edge bar; dock-active gets an
  ember-soft pill; empty-state icons now sit in 46px elevated tiles.
- Version bumped to **4.0** (`APP_VERSION` in shell + client) and the service
  worker cache key to `v4-0-0` so returning PWA users receive the new assets
  instead of cached 3.0 CSS (audit M5).

### Module completion (the 70 unstyled classes — audit C1–C7, H-items)
A single consolidated, commented **"COMMAND 4.0 — component completion pass"**
section in `style.css` now styles everything the client actually renders:
- **Command palette:** `.palette-result` rows with anatomy + accent-tinted
  `.is-active` keyboard state (C3).
- **Settings:** layout grid, sticky section rail (horizontal scroll chips
  ≤1023px), section headings, facts row, accessible switch control
  (`input:checked + .switch-track` with `:focus-visible` ring), theme options
  with painted swatches, accent options with visible `--swatch` colours and
  `is-selected` state, notification permission card, category/protected-time
  rows, data summary, safety copies, danger zone, details disclosure (C1, C2).
- **Assistant:** two-column layout, flex-column scrolling panel, bordered
  head, command pills, chat rows with avatars/roles, mirrored user bubbles in
  accent-soft, welcome state, composer bar, privacy note, offline tools list,
  next-action detail (C7).
- **Analytics:** spanning wide chart, tall charts, category breakdown,
  7-row column-flow heatmap with ember-alpha `level-1..3` ramp + legend +
  keyboard-focusable cells, goal-progress rows, insight list, accessible
  `chart-data` tables (C5).
- **Weekly Review:** week navigator, main/side layout, tabular day rows with
  today in accent-soft, reflection form footer, 7-up next-week planner (C6).
- **Missions:** task content stack, meta row, subtask progress, advanced
  filters grid, check stack, subtask editor rows, footer note, skipped state,
  danger-hover, priority dot colours high=ember/medium=tan/low=muted (C4).
- **Titles:** the private "Discipline Monster" unlock modal is now a quiet
  centred celebration (static accent glow — no animation loop).
- **Focus overlay extras:** vignette, phase separator; orbs remain disabled.
- Responsive contracts for every new component appended after the existing
  guarded media blocks (1250 / 1023 / 767).

## 2 · Verification results

| Check | Result |
|---|---|
| `npm run lint` | ✅ pass (no secrets, no CDN regressions, syntax clean) |
| `npm run typecheck` (server + client tsconfigs) | ✅ pass |
| `npm test` (unit + integration, production build first) | ✅ **221/221 pass** — identical to the pre-change baseline, re-confirmed before edits |
| Production build (`npm run build`) | ✅ `dist/index.js` 32.2 kB, client bundle 504.9 kB, tailwind 10.8 kB |
| Static focus-style guards (`tests/unit/focus-styles.test.js`) | ✅ `.focus-overlay` contract, reduced-motion block and 640px re-layout all still first-match their guarding regexes |
| Icon generation | ✅ all four PNGs regenerated in ember on `#101010` |

### Runtime smoke harness (`scripts/smoke-render.mjs`, new, not part of `verify`)
Boots the **real production bundle in jsdom against the real worker shell**,
in a populated *and* an empty workspace:
- All 12 routes render (Overview 16.7k chars populated / 12.1k empty … Settings
  25.8k) — **no empty views, no `undefined`/`NaN`/`[object Object]` leaks**
  into rendered text.
- Dialogs open: task modal, goal modal, score-info (formula + component bars),
  ⌘K palette (**10 styled `.palette-result` rows**), quick capture.
- Interactions: priority toggle click, theme toggle dark→light→dark,
  Focus Room render.
- **Accent switching:** clicked every swatch (rose, iris, blue, sage, amber,
  ember) — each applied to `<html data-accent>`, persisted to
  `kcc_state_v1`, and marked `is-selected`; theme choices (light/system/dark)
  applied and persisted identically.
- **Console errors: none** in any pass (jsdomError + console.error captured).

## 3 · Screens inspected

Overview · My Day · Schedule (day timeline / week grid / side panels) ·
Missions (all filters + advanced filters + task modal + subtask editor) ·
Goals (grid + detail + milestones) · Projects (list / board / timeline) ·
Routines · Focus Room (view + fullscreen overlay dialect) · Analytics (7/30/90
ranges, heatmap, data tables) · Weekly Review (current + previous week,
reflection form) · Planning Assistant (empty welcome + populated chat,
composer, offline tools) · Settings (all 8 sections, both option pickers,
switches, data tab, danger zone) · shell chrome (sidebar expanded/collapsed,
topbar, breadcrumbs, notifications, toasts, mobile drawer + dock) · dialogs
(task, goal, score, palette, capture, reschedule, protected time, category,
title unlock). Populated **and** empty states for every route.

## 4 · Viewports

Breakpoints were audited and adjusted as a cascade (320 → 1600):
`1600+` (wider overview grid), `1250` (compact topbar/overview, new settings
rail width), `1023` (tablet: single-column overview/settings/assistant/review,
horizontal settings chips, 58px topbar), `767` (mobile: drawer + dock shell,
2×2 metric strip, bottom-sheet modals, 44px touch floor, new component
stacks), `640` (focus overlay re-layout — test-guarded, untouched), `420` and
`380` (header compression, date block hidden, single-column forms). The new
responsive blocks were appended **after** the guarded media queries so the
statically-tested contracts still match first.

## 5 · Accessibility checks

- Focus-visible: single ember outline token across buttons/inputs/heat cells/
  switch (`input:focus-visible + .switch-track`); skip link intact.
- Keyboard: palette arrows now have a **visible** active row (was invisible —
  C3); mobile drawer focus trap preserved; `Esc` closes overlays; number-key
  view switching and `F`/`N` shortcuts untouched.
- Touch: ≤767px keeps the 44px floor (buttons, segmented, icon buttons,
  28px task-check with extended `::after` hit area); switch rows are
  full-width labels.
- Reduced motion: the global crush block plus the focus-specific stills
  (`.fz-orb`, `.fz-burst`, `.fz-count-tick`) are unchanged and still guarded
  by tests; new components animate only opacity/transform via existing
  keyframes and inherit the crush.
- Contrast: muted lifted to AA (H4); light-theme ember darkened to 4.96:1;
  dark ink on ember buttons 6.6:1; accent text on void ≈7.5:1.
- Semantics preserved: `aria-pressed` on pickers/toggles, `role="listbox"/
  "option"` in the palette, `role="log"` chat, `aria-label`s on icon buttons —
  none of the markup contracts were changed, only styled.

## 6 · Data & engineering guarantees

- Storage key `kcc_state_v1`, schema version 6, IDs and relationships
  untouched — migration tests (v1→v6, corrupt-payload rescue) still pass.
- No fabricated data: every number in the new components renders from real
  state; empty states stay honest ("Your real progress will appear here").
- Local-first architecture, planning semantics, scoring and AI egress rules
  unchanged; no new dependencies; no secrets.
- Business logic diffs are limited to: default accent value, accent
  allow-lists (additive), priority colour constants, chart fallback colours,
  theme-color meta value, version constants.

## 7 · Known remaining limitations

1. **No pixel screenshots in this environment.** The sandbox has no graphical
   browser (no Chromium/Playwright download host), so verification is
   DOM + resolved-CSS + jsdom-runtime based. Recommend a 10-minute visual pass
   in a real browser at 375/768/1440 before merge — the live dev-server
   preview served by this branch is the fastest way.
2. **Tablet touch targets (768–1023px)** keep pointer-density sizing
   (35–40px) as an accepted trade-off (audit M6); the 44px floor applies
   ≤767px where it matters most.
3. `studio.css` remains a thin override layer for the focus-mission dialect
   with `!important`s; it was deliberately **not** flattened because
   `tests/unit/focus-styles.test.js` statically guards the split contract.
   Its values are token-driven, so the new identity flows through it.
4. The brand mark keeps its −5° rotation (recognisable 3.0 silhouette, now
   ember); straightening is a one-line follow-up if desired (audit L2).
5. `docs/glassmorphism.md` / `docs/liquid-glass-revision.md` describe the
   previous visual phase and are kept as historical records, superseded by
   this pass.

---

## 8 · Addendum — Command 4.1 design layers (branch `arena/4fcfb201-task-manager`)

A second, additive design pass on top of the merged 4.0 transformation
(PR #18). No 4.0 behaviour was changed; everything below is new layers.

**What was added**

1. **Toast tones** — `.toast-symbol` (previously unstyled, like the 70 classes
   in the audit) is now a 20px tone disc: ember for info, and distinct
   success/warning/danger tints, keeping semantic states separate from the
   signature accent.
2. **Overview entrance choreography** — the dashboard's direct children enter
   with a 40ms-capped stagger (`viewEnter`, ≤240ms total). The router marks a
   section `.view-enter` **only on real view switches** and clears it after
   1.2s, so the minute-refresh re-render never replays motion (no continuous
   movement; fully crushed by the reduced-motion contract).
3. **Day-progress hairline** — a 3px ember bar under the Overview clock
   showing the share of your *configured available hours* used so far.
   Computed from `settings.workingHours` and the real clock in
   `updateClockAndGreeting` (clamped 0–100, degenerate windows guarded,
   `role="img"` + live aria-label). No fabricated data — before your working
   day starts it honestly reads 0%.
4. **Micro-interactions (2px rule)** — trailing chevrons/arrows on
   `.text-button`, quick actions, offline tools and palette rows slide 2px on
   hover; the brand mark settles from −5° to 0° on hover. Transform/opacity
   only, `--motion-fast`, reduced-motion safe.
5. **Today is a place** — the Schedule week grid tints today's column in
   accent-soft with an ember hairline under the day head.
6. **Sidebar separation** — the bottom zone (assistant/settings/focus card)
   now sits under a hairline divider (folded into the original rule, not an
   override layer).
7. **Touch-comfort floor for coarse pointers** — a `@media (pointer:coarse)`
   block raises minimum target sizes (icon buttons 42px, nav 44px, dock 48px,
   segmented/pills/presets 40px…) on tablets and touch laptops at *any*
   viewport width, closing audit item M6 without loosening desktop density.
8. **Versioning** — APP_VERSION 4.1 (shell + footer), service-worker cache
   `v4-1-0` so PWA users pick the new layers up.

**Files touched:** `public/static/style.css`, `src/client/ui/router.js`,
`src/client/ui/chrome.js`, `src/client/views/dashboard.js`, `src/shell.ts`,
`src/client/main.js`, `public/sw.js`.

**Verification (re-run on this branch)**

| Check | Result |
|---|---|
| `npm run verify` (lint · typecheck · tests) | ✅ **221/221 pass** |
| Production build | ✅ |
| `scripts/smoke-render.mjs` (12 routes, dialogs, populated + empty) | ✅ no failures, **zero console errors** |
| Day-progress harness | ✅ renders, correct clamped width, live aria-label |
| Stagger lifecycle harness | ✅ `.view-enter` applied on switch, removed after 1.2s — minute-refresh does not replay motion |
