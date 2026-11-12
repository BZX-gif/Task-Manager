# Command Center — premium glassmorphism pass (2026-11-12)

A visual skin over the existing 3.0 design. No layout, structure, markup,
navigation, feature or functionality changes; one JS-visible value changed:
nothing. The diff touches only `public/static/style.css` (glass tokens + the
surface rules that consume them) and one neutraliser in `studio.css`
(`.glass-card .glass-card` now uses the subtle glass token instead of a solid
colour).

## Shared language (tokens)

Defined on `:root` and mirrored (light-appropriate values) on
`:root[data-theme=light]`:

| Token | Dark | Purpose |
| --- | --- | --- |
| `--glass-bg` | `rgba(255,255,255,.035)` | in-flow card surface (translucent charcoal) |
| `--glass-bg-subtle` | `rgba(255,255,255,.02)` | quiet nested surfaces, board columns |
| `--glass-bg-strong` | `rgba(28,29,36,.8)` | overlapping panels (modal, toast, dock, drawer) |
| `--glass-border` / `--glass-border-strong` | `.085` / `.14` alpha | hairline + floating-element borders |
| `--glass-highlight` | `inset 0 1px 0 rgba(255,255,255,.045)` | inner top light catch |
| `--glass-sheen` | faint vertical paint gradient | painted (not filtered) inner reflection |
| `--glass-shadow` | `0 8px 24px rgba(0,0,0,.22)` | layered depth |
| `--glass-blur` | `10px` | ceiling for any backdrop blur |

Utility classes `.glass-surface`, `.glass-surface-subtle`, `.glass-surface-strong`
express the same three depths for any future surface.

## Where it is applied

- In-flow cards (all `.card` / `.glass-card`: dashboard metrics, analytics and
  charts, review, settings sections, goals/projects/routines/mission cards):
  translucency + sheen + hairline border + inner highlight. **No backdrop
  filter** — they scroll, so this stays free.
- Panels & strips (`.metric-strip`, `.task-list-surface`, `.calendar-surface`,
  `.schedule-legend`, `.board-column`, `.sidebar-focus`, `.notice`): same, without sheen.
- Overlapping/fixed surfaces (`.modal-box`, `.toast`, `.mobile-dock`,
  `.mobile-nav`, `.event-actions`): strong glass; these are small or transient,
  and get at most `blur(8–10px)` (`6px` for the tiny event toolbar) inside
  `@supports ((backdrop-filter:blur(2px)) or (-webkit-backdrop-filter:blur(2px)))`.
  Without `backdrop-filter` they stay legible at 80–85% opacity.
- Full-screen surfaces keep the existing solid treatment (focus overlay stays
  `var(--bg)`); the desktop sidebar uses translucent charcoal **without**
  backdrop blur (its backdrop is static, so blur buys nothing and costs a
  full-height filtered layer).
- Ambient light: two static accent-tinted radial gradients in `body::before`
  (fixed, `pointer-events:none`, `z-index:-1`, no animation) so translucency
  has something to reveal. Tinted by `--accent-rgb`, adapts to every accent.

## Performance guards

- Backdrop blur limited to four small/transient surfaces; nothing large, nothing in the scroll path.
- No new animations, no shadow/filter/transition animation, no DOM layers.
- Ambient layer is a fixed painted layer, not an animated gradient.
- `@media (prefers-reduced-transparency: reduce)` restores the exact previous
  solid design (surfaces, sidebar, dock, modal, ambient hidden).
- `prefers-reduced-motion` behaviour unchanged; all existing transitions still use transform/opacity.
- Charts untouched (canvas, same colours/heights); no extra re-renders or JS.

## Validation (2026-11-12)

- `npm run verify`: lint + both typechecks + production build + **221/221 tests pass** (no test changes).
- A/B against `HEAD` (same seeded workspace, 1440×900 and 390×844, dark/light):
  bounding boxes of sidebar, topbar, footer, main, command/score/priority/
  up-next/chart/quick-action cards, metric strip and dock are **pixel-identical**;
  no horizontal overflow at 390px; console clean in both themes and on mobile.
- Contrast on the new surfaces (token maths): text ≥ 9:1, secondary ≥ 6.9:1,
  muted ≥ 4.4:1 in both themes.
- Note: the headless swiftshader screenshot run intermittently garbles one
  layer (`.sidebar-focus`) in both the old and new CSS; fresh loads are
  pixel-clean — it is a software-rendering artifact, not a styling defect.
