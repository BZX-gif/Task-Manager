# Command Center — liquid glass material revision (2026-11-13)

A visual-quality pass over the existing 3.0 design. No layout, structure,
markup, navigation, feature or functionality changes: card positions,
dimensions, typography hierarchy, charts, tasks, scheduling and responsive
behaviour are untouched. The diff is CSS-first (`public/static/style.css`,
one rule in `studio.css`) plus token-driven chart tooltip/hover colours and
the PWA `theme-color`.

## Layer model

| Layer | Surface | Material |
| --- | --- | --- |
| 1 · Atmosphere | `body::before` / `body::after` | Deep-black canvas (`#08090b`) with five static painted radials (neutral key/fill lights, one restrained accent whisper, a graphite pool) plus a fixed vignette. No animation, no neon. |
| 2 · Workspace | `.main-content`, sections | Inherits the canvas; translucency has atmosphere to reveal. |
| 3 · Navigation | `.sidebar`, `.topbar`, `.mobile-nav`, `.mobile-dock` | `glass-navigation` / `glass-floating` tokens: translucent charcoal, hairline border, inset edge light, separation shadow. Sidebar/topbar are **painted** glass; the mobile drawer and dock keep `backdrop-filter` (real content passes behind them). |
| 4 · Cards | `.card`, `.glass-card`, `.metric-strip`, list/calendar surfaces | `glass-primary`: painted translucency + diagonal sheen + top/bottom edge light + layered depth shadow — **never filtered** (they sit in the scroll path). Hero `.command-card` keeps its accent wash with an added specular highlight. |
| 5 · Floats | `.modal-overlay/.modal-box`, `.toast`, `.event-actions` | `glass-floating`: denser glass, deeper float shadow; transient `blur(6–8px)` only on the overlay/toast. |
| 6 · Controls | buttons, `.segmented`, chips, inputs, rows, nav items | `glass-interactive`: quiet glass fills, inset edge, lit hover states, refined active nav (accent gradient + hairline). |

## Design tokens

Five named variants — `--glass-primary-*`, `--glass-secondary-*`,
`--glass-floating-*`, `--glass-navigation-*`, `--glass-interactive-*` — plus
shared `--glass-edge`, `--glass-edge-bottom`, `--glass-sheen`,
`--glass-sheen-soft`, `--glass-shadow-depth`, `--glass-shadow-float`,
`--glass-blur` (12px) and `--chart-tooltip-bg/-border`. Mirrored with
light-appropriate values on `:root[data-theme=light]`. The earlier names
(`--glass-bg`, `--glass-border`, `--glass-highlight`, …) remain as aliases of
the same material, so nothing downstream breaks.

Utility classes `.glass-primary/.glass-secondary/.glass-floating/
.glass-navigation/.glass-interactive` express the same five depths for any
future surface; every existing element rule consumes the same tokens, so the
whole UI is cut from one material.

## Micro-interactions

- Cards gain a painted reflection layer (`::after`) that brightens on hover
  (opacity only), a 2px elevation (transform only) and border illumination —
  disabled for form-heavy panels (`settings-section`) and while focus is
  inside (`:focus-within`), and gated behind `@media (hover:hover)`.
- Progress fills sit in a glass channel with a lit accent gradient; existing
  width/ring transitions preserved.
- Chart tooltips use the glass tooltip tokens (rounded, hairline border);
  bar/point hover states brighten through `softStrong`/`pointHover*`.

## Performance contract

Revised after real-world feedback (scroll felt laggy): **no filtered element
sits in any scroll path.**

- **Zero `backdrop-filter` on scrolling surfaces.** Cards, metric strips,
  list/calendar panels, the sidebar and the topbar are pure painted glass
  (translucency + sheen + edge light + depth). Scrolling and card hover only
  move compositor layers — a filter is never re-run by scroll or hover.
- **Blur exists only on floating surfaces with real content behind them**,
  where it is both visible and cheap: the mobile drawer and dock (fixed),
  toasts (fixed, transient), the modal overlay (fixed, transient), and the
  tiny event toolbar — all 6–12px, the original reviewed values.
- The atmosphere is fixed painted gradients with `pointer-events:none`;
  painted once, composited thereafter. No new JS for visual effects; charts
  unchanged in structure.
- `@supports not (backdrop-filter)` raises the density of the floating
  surfaces (`--glass-fallback-float`) so unsupported browsers stay legible.
- `prefers-reduced-transparency: reduce` restores the full solid design
  (atmosphere hidden, all surfaces opaque, every filter removed, sheen off).
- `prefers-reduced-motion` behaviour unchanged (global duration crush).

Card density was raised slightly (`.05 → .06` dark, `.62 → .66` light) to
compensate for the removed frosting, so panels keep their material presence.

## Validation (2026-11-13)

- `npm run verify`: lint + both typechecks + production build + **221/221
  tests pass** (no test changes).
- `esbuild` CSS parse of `style.css`/`studio.css`: clean; `git diff --check`:
  clean.
- Token audit: every `var(--…)` referenced resolves to a definition
  (`--swatch` is set inline by the accent picker).
- Backdrop audit: `grep backdrop-filter` shows only `.mobile-nav`,
  `.mobile-dock`, `.toast`, `.event-actions` (inside `@supports`) and
  `.modal-overlay` — all fixed or transient.
