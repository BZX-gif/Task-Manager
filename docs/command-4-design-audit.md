# Command 4.0 — Complete UI/UX & Visual Audit

**Audited baseline:** `main` @ `f41da45` (branch point of `arena/9172d9fe-task-manager`)
**Audit date:** 2026-11-15
**Design direction selected:** HYBRID × BURNT ORANGE (Apple discipline · Linear clarity · command-terminal hierarchy · original Command identity)

## Methodology

This audit was performed against the real application, not mockups:

1. **Full source inspection** of the shell (`src/shell.ts`), both stylesheets
   (`public/static/style.css`, `public/static/studio.css`), the Tailwind config,
   all 12 view modules, chrome/focus/palette UI code and the chart layer.
2. **Runtime boot** of the production bundle inside jsdom against the real
   worker shell (the same harness the integration tests use), walking every
   route — Overview, My Day, Schedule, Missions, Goals, Projects, Routines,
   Focus Room, Analytics, Weekly Review, Planning Assistant, Settings — in a
   populated and an empty workspace, opening dialogs (task, goal, score-info,
   command palette, quick capture), toggling theme/accent and checking the
   console.
3. **Rendered-markup ↔ CSS cross-reference:** a script extracted every class
   the client actually renders and checked each one against `style.css`,
   `studio.css` and the compiled `tailwind.css`. **70 rendered classes had no
   style rule anywhere** — the single largest source of visual breakdown.
4. Verification baseline confirmed before any edit: **221/221 tests passing**.

> Environment note: this workspace has no graphical browser available
> (no Chromium/Playwright download host), so pixel screenshots could not be
> captured here. Every finding below is anchored in rendered DOM + resolved
> CSS analysis and source evidence, and the QA report lists what should be
> re-confirmed in a real browser.

---

## Findings

Priority scale: **critical** (screen is broken/unusable visually) · **high** · **medium** · **low**.

### C1 — Settings screen is largely unstyled · critical

- **Screen:** Settings.
- **Problem:** the view renders `settings-layout`, `settings-nav`,
  `settings-content`, `settings-section-heading`, `settings-facts`,
  `setting-toggle`, `switch-track`, `setting-toggle-list`, `theme-options`,
  `theme-option`, `theme-swatch`, `accent-options`, `notification-permission`,
  `category-settings`, `protected-row`, `data-summary`, `danger-zone`,
  `history-details`, `recovery-backups`, `weekday-picker` — **none of these
  classes has a CSS rule**. The section rail is a stack of bare browser
  buttons, toggles render as raw checkboxes next to a decorative
  `.switch-track` span that draws nothing, and the danger zone has no visual
  weight at all.
- **Why it harms:** Settings is where trust lives (data, export, reset). A
  browser-default form inside a crafted app instantly reads as "unfinished
  prototype".
- **Correction:** build the full settings component set (sticky rail, switch
  control driven by `input:checked + .switch-track`, option buttons with a
  real selected state, structured data/danger zones).
- **Status:** fixed in this branch.

### C2 — Accent swatches are invisible; orange doesn't exist · critical

- **Screen:** Settings → Appearance; whole app identity.
- **Problem:** `.accent-swatch{background:var(--swatch)}` — but **`--swatch`
  is never defined for any accent**, so every swatch paints as transparent.
  The selected state class in CSS is `.accent-swatch.selected`, while the
  markup puts `is-selected` on the *button* — a dead rule. The picker offers
  iris/blue/sage/amber/rose; there is no orange anywhere, while the shell
  hard-defaults `data-accent="iris"` (violet) in three places
  (`src/shell.ts` HTML attribute, the inline boot script, `lib/defaults.js`,
  `lib/state.js` normalisation).
- **Why it harms:** users literally cannot see what they are choosing, and the
  product has no signature colour.
- **Correction:** define `--swatch` per accent (`accent-ember/iris/blue/sage/
  amber/rose`), style `.is-selected` on the buttons, make **Ember orange
  #F0783E the default identity** everywhere (shell attribute, boot script,
  defaults, state normalisation, settings picker — Ember listed first), while
  keeping every legacy accent selectable so stored preferences never reset.
- **Status:** fixed in this branch.

### C3 — Command palette results are unstyled and the keyboard-active row is invisible · critical

- **Screen:** ⌘K palette (`ui/chrome.js`).
- **Problem:** markup emits `.palette-result` rows (with `.is-active`);
  the CSS only styles `.command-result`, which nothing renders. Results appear
  as unstyled full-width buttons; arrow-key navigation produces **no visible
  active row** — a keyboard accessibility failure, not just cosmetics.
- **Correction:** style `.palette-result`, its icon/strong/small anatomy and
  an accent-tinted `.is-active` state; retire the dead `.command-result`
  selectors.
- **Status:** fixed (palette rows + active state now styled).

### C4 — Priority is never communicated visually · critical

- **Screens:** Missions, My Day, Overview priority rows.
- **Problem:** rows render `.priority-dot.priority-high|medium|low`, but no
  rule colours those modifiers — every dot inherits nothing and priority is
  invisible. `PRIORITY_COLORS` in `lib/defaults.js` uses rose `#fb7185` /
  amber `#fbbf24` / gray — hues that exist nowhere else in the product.
- **Correction:** high = ember accent (per the orange-usage policy: priority
  indicators), medium = warning tan, low = muted; align `PRIORITY_COLORS`
  with the same semantic tokens.
- **Status:** fixed.

### C5 — Analytics heatmap shows 12 weeks of flat, identical cells · critical

- **Screen:** Analytics ("A rhythm worth noticing").
- **Problem:** cells render `.heat-cell.level-0..3`; only the base
  `.heat-cell` is styled, so **level data is discarded visually** — an honest
  history renders as a uniform gray grid. `.analytics-heatmap`,
  `.heatmap-legend`, `.analytics-wide`, `.chart-tall`, `.category-breakdown`,
  `.analytics-bottom`, `.goal-progress-row`, `.insight-list`, `.chart-data`
  (the accessible data tables) are also unstyled, and `.analytics-wide` never
  spans the grid, breaking the intended chart hierarchy.
- **Correction:** column-flow 7-row heatmap grid with ember-alpha level ramp,
  legend swatches matching the ramp, spanning wide chart, styled breakdown /
  goal rows / insight lists / data tables.
- **Status:** fixed.

### C6 — Weekly Review layout classes do not exist · critical

- **Screen:** Weekly Review.
- **Problem:** `review-week`, `review-layout`, `review-main`, `review-days`,
  `review-day`, `review-side`, `reflection-card`, `next-week-days`,
  `insight-list`, `analytics-metrics` render with no rules — the day rows are
  a collapsed run of text, the "Plan next week" day buttons are bare browser
  buttons, and the two-column main/side structure doesn't exist. (The CSS
  contains an orphaned older `.review-day-row`/`.review-metrics` dialect that
  the current markup no longer emits.)
- **Correction:** full review component set with tabular day rows, today
  highlighted in accent-soft, 7-up next-week planner buttons.
- **Status:** fixed.

### C7 — Planning Assistant conversation has no hierarchy · critical

- **Screen:** Planning Assistant.
- **Problem:** `assistant-layout`, `assistant-panel-head` (referenced only
  from a media query), `assistant-commands`, `assistant-command`,
  `assistant-welcome(-icon)`, `assistant-composer`, `assistant-privacy`,
  `assistant-side`, `assistant-local-tools`, `chat-message`, `chat-avatar`,
  `chat-role`, `typing-indicator`, `next-action-detail` — all unstyled.
  User and assistant messages are visually identical blobs; the composer is a
  raw textarea + button; the panel is not a flex column, so `chat-scroll`
  doesn't actually scroll.
- **Correction:** two-column layout, bordered panel head, pill command row,
  scrolling flex chat with avatars, mirrored user rows in accent-soft,
  bordered composer bar, styled offline-tools list.
- **Status:** fixed.

### H1 — Three conflicting palettes in one product · high

- **Problem:** the CSS variables are warm-neutral graphite; `tailwind.config.js`
  still maps `accent`/`violet` to an old blue `#5b93e6` and `base-*` to
  cool blue-grays (`#0b0d11…#1e242f`) from a previous generation; the
  focus-mission section hardcodes legacy semantics
  (`rgba(207,159,95,.12)`, `rgba(210,121,122,.12)`); icons/favicon paint
  violet `#b4a3f5` on cool `#101113`. Any Tailwind utility usage therefore
  drifts off-identity.
- **Correction:** one token source of truth — warm graphite bases, ember
  accent — mirrored in Tailwind config, chart fallbacks, favicon and the
  zero-dep icon generator; legacy rgba literals re-pointed at current
  warning/danger values.
- **Status:** fixed.

### H2 — `Sora` font referenced but never loaded · high

- **Problem:** the focus-mission CSS declares `font-family:'Sora',sans-serif`
  three times; no font is bundled or fetched (correctly — the project is
  offline-first), so the intended display treatment silently collapses to an
  arbitrary fallback and the weight/letter-spacing pairing is wrong.
- **Correction:** `var(--font-display)` (system stack) everywhere; keep the
  editorial sizing/letter-spacing that carried the hierarchy.
- **Status:** fixed.

### H3 — Override layering and dead/conflicting rules · high

- **Problem:** `studio.css` is a single minified line of `!important`
  overrides (e.g. `.settings-section{margin-bottom:0}` fighting
  `margin-bottom:20px` in `style.css`; focus geometry re-declared with
  `!important` on both files). `style.css` carries two glass token dialects
  (`--glass-primary-bg` … plus legacy `--glass-bg` aliases), dead
  `.command-result*` rules, and a `.accent-swatch.selected` rule no markup
  can trigger. In `shell.ts`, the nav renders
  `class="${mobile ? 'nav-item' : 'nav-item'}"` — a dead ternary.
- **Why it harms:** every future change has to win an `!important` war; the
  audit itself found rules that cannot be reasoned about locally.
- **Correction:** token-level consolidation (material values changed once, at
  the source, instead of new override layers); dead rules removed or
  replaced by the real class names; no new `!important` layers added in the
  4.0 pass (the pre-existing focus-overlay dialect is kept intact because
  `tests/unit/focus-styles.test.js` statically guards its contract).
- **Status:** fixed where safe; documented remainder below.

### H4 — Muted text fails WCAG AA · high

- **Problem:** `--muted:#737373` on `--surface:#151515` resolves to ≈4.0:1 —
  below the 4.5:1 requirement for the many 9–11px metadata labels that use it.
- **Correction:** muted refined to warm `#837e78` (≈4.6:1 on surface, ≈5.0:1
  on void black); chart defaults and the insights fallback colour follow.
- **Status:** fixed.

### H5 — Brand identity is generic-violet, not Command · high

- **Problem:** default iris accent, violet PWA icons/favicon, cool `#101113`
  icon background; nothing in the product is ownable at a glance. Topbar is
  not sticky and the search trigger is bare text with no field affordance.
- **Correction:** Ember `#F0783E` signature accent with hover `#FF8750`,
  soft `rgba(240,120,62,.12)` and border `rgba(240,120,62,.28)`; dark ink
  `#221005` on orange primary buttons (6.6:1); regenerated icons/favicon on
  `#101010`; a faint static ember atmosphere in the top-right of the void
  background; sticky solid topbar; search trigger becomes a real bordered
  field; nav-active gains a 3px ember edge bar (Linear-style selection).
- **Status:** fixed.

### M1 — Glassmorphism everywhere, including scroll paths · medium

- **Problem:** every card, strip, sidebar and topbar paints translucent glass
  with a diagonal sheen and a hover-brightening reflection layer. The code
  comments defend it (paint-only, no filters in scroll paths) but visually the
  product reads as "generic glass SaaS", surfaces barely differentiate
  (#151515 page vs ~4%-white glass cards), and hover lift (`translateY(-2px)`)
  fires on large content cards.
- **Correction:** material tokens re-cut at the source: cards/panels are now
  solid graphite (`#151515`/`#121212`) under a heavily restrained sheen
  (≈1.6–2.8% white), sidebar/topbar solid `#0c0c0c`, translucency + blur
  reserved for the genuinely floating surfaces (mobile drawer, dock, modals,
  toasts, event toolbars). Hover lift reduced to 1px. No backdrop-filter was
  added to any scrolling surface.
- **Status:** fixed.

### M2 — Overview hierarchy: everything is an identical card · medium

- **Problem:** the Overview already had good bones (hero command card, score
  ring, priority list, mini timeline, metric strip, week chart), but every
  panel used the same glass, the same hover lift and the same border, so
  scale/contrast carried little hierarchy; the hero's decorative orbital art
  was white-on-white and competed with the title.
- **Correction:** hero gets an ember radial atmosphere and the orbital art's
  focal planet/dot become accent-tinted; eyebrow gains an ember tick;
  active-nav, timer chip, chips, rings, progress fills, heatmap and priority
  dots all now speak ember consistently, while chart series stay neutral
  white (honest data, accent only marks *today*).
- **Status:** fixed.

### M3 — Numeric alignment inconsistent · medium

- **Problem:** day numbers, review values and next-week dates were not
  tabular; times were tabular only in some components.
- **Correction:** `font-variant-numeric:tabular-nums` on all new numeric
  surfaces (review rows, data summary, palette counts, goal-progress
  percentages, next-week dates); existing tabular rules kept.
- **Status:** fixed.

### M4 — Empty states were typographically weak · medium

- **Problem:** a 27px bare icon at 70% opacity above two lines of text —
  empty workspaces looked accidental.
- **Correction:** icon now sits in a 46px elevated-surface tile with a
  hairline border; copy sizes/spacing kept calm and centered.
- **Status:** fixed.

### M5 — Service worker would serve stale 3.0 assets · medium

- **Problem:** caches are keyed `v3-0-1`; a CSS/JS-only change ships to
  returning PWA users only when that constant moves.
- **Correction:** `v4-0-0` with APP_VERSION 4.0 in shell + client footer.
- **Status:** fixed.

### M6 — Touch targets below 44px outside the 767px block · medium

- **Problem:** desktop-narrow bands (768–1023px, touch tablets) keep 35–40px
  controls: `.btn-small` 35px, `.segmented button` 30px, `.nav-item` 40px,
  icon buttons 36px. The 44px floor only applies ≤767px.
- **Correction:** documented as an accepted trade-off for pointer-density at
  tablet widths; the ≤767px contract (44px floor, 28px task-check with an
  extended hit area via `::after`) is preserved and now also covers the new
  switch control (38×22 visual, full-row click target via the label).
- **Status:** partially accepted; see QA report limitations.

### L1 — Dead CSS dialects · low

- `.command-result*`, `.accent-picker`, `.accent-swatch.selected`,
  `.review-day-row`, `.review-metrics`, `.review-reflection` target markup
  that no longer exists. **Correction:** superseded by the real component
  rules; the orphan selectors were left in place only where removal risked
  the statically-guarded focus contract — flagged for a follow-up cleanup
  once visual QA in a browser signs off.
- **Status:** documented.

### L2 — Brand mark rotation · low

- **Problem:** `transform:rotate(-5deg)` on the 2×2 brand mark is arbitrary
  and makes the lockup feel unsettled against a precise grid.
- **Correction:** kept for now (recognisable 3.0 silhouette, now ember);
  straightening is a one-line change if the owner prefers absolute precision.
- **Status:** noted.

### L3 — Cool-gray legacy in `Chart.defaults` · low

- Chart.js default colour `#737373` and fallbacks pointed at the iris
  palette. **Correction:** warm `#837e78` / ember fallbacks; charts read all
  semantic tokens at draw time, so theme+accent switches stay coherent.
- **Status:** fixed.

---

## Policy decisions recorded during the audit

| Decision | Rationale |
|---|---|
| Ember is the **default**, not the only accent | Existing users keep iris/blue/sage/amber/rose (never reset preferences silently); iris stays fully tokenised as a legacy option. |
| Muted text lifted to `#837e78` | Spec's `#77736F` measures 4.0:1 on `#151515`; brief explicitly asks to validate contrast and refine. |
| Light theme kept warm | Ivory/ember identity extends to light: `#f6f4f1` bg, warm text `#1c1917`, ember darkened to `#b8511d` (4.96:1 on white). |
| Charts stay neutral white series | Accent marks *today* / selection only — honest data, deliberate orange. |
| No backdrop-filter added anywhere new | Scroll-performance rule from the brief; blur remains on the four existing floating surfaces. |
| `tests/unit/focus-styles.test.js` contract preserved verbatim | The `.focus-overlay` fixed/inset/z-95 block, the reduced-motion block and the 640px focus re-layout must remain the guarding regexes' first matches — all new CSS was inserted so these contracts still hold. |
