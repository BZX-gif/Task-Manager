# COMMAND 5.0 — the villa

A redesign of the Task Manager into a luxury-hotel concierge surface: one
photograph, one editorial voice, and the numbers the workspace already holds.

---

## 1 · What changed

| Area | Before | Now |
| --- | --- | --- |
| Background | flat warm ink | three original photographs of one villa, crossfading with the clock |
| Greeting | 28px sans | Instrument Serif at 40–66px, split into address + italic name |
| Structure | uniform card grid | hero → command line → three uneven editorial columns |
| Surfaces | opaque cards | warm translucent glass, blurred over the photograph only |
| Type | one sans | Instrument Serif (display) + DM Sans (body), self-hosted |
| Accent | ember orange | champagne bronze `#C69A5E` |

Everything else — missions, goals, projects, schedule, focus room, HYB, PAPER,
journal, forecast, settings, import/export — is untouched and still reachable.

## 2 · The three photographs

Generated for this project, one room at three hours, and shipped as two widths:

| File | Size | Role |
| --- | --- | --- |
| `atmosphere-morning.webp` | 2560×1592 · 298 kB | 05:00–11:59 |
| `atmosphere-afternoon.webp` | 2560×1592 · 309 kB | 12:00–16:59 |
| `atmosphere-night.webp` | 2560×1592 · 242 kB | 17:00–04:59 |
| `*-sm.webp` | 1280×796 · 82–110 kB | first paint + offline |

`*-source.png` are the generation masters; they are gitignored.

The photograph is painted by three `.atmo-layer` divs. The small variant paints
first, then the full variant is decoded and swapped, so a fast connection never
shows a blurry frame and a slow one never shows nothing.

## 3 · The atmosphere engine

- `atmosphereForHour()` — pure, testable, `5–11 / 12–16 / else`.
- `resolveAtmosphere(mode, date)` — a manual choice always beats the clock.
- The shell pre-paint script sets `data-atmosphere` **and** preloads the right
  photograph before CSS paints, so there is no flash of the wrong room.
- The next environment in the cycle is warmed during idle time.
- Manual override lives in two places: the hero selector and
  `Settings → Appearance → Atmosphere`. Both write the same
  `settings.atmosphere` value, so they can never disagree.
- The photographs appear on the dashboard only. Every other view keeps the
  solid, legible workspace surface it had — text over moving imagery is not a
  good place to run a calendar.

## 4 · Glass, but honest

```css
--glass-1: rgba(22,18,13,.60);     /* deep enough to carry 5.5:1 text */
--glass-line: rgba(246,236,220,.16);
--glass-blur: 26px;                 /* inside the 20–30px brief */
```

Blur is only paid for where it buys readability (panels over photography).
`prefers-reduced-transparency` swaps in an opaque surface, and
`prefers-reduced-motion` collapses every crossfade to 1 ms.

## 5 · Typography

Instrument Serif for headings and the greeting name; DM Sans for everything
readable. Both are self-hosted (`public/static/fonts/`) — no remote font
requests, which the test suite enforces. The display face is preloaded; both
faces are precached by the service worker so the identity survives offline.

## 6 · How this was checked

There is no browser available in the build environment (`npx playwright install
chromium` cannot reach the download host), so quality control is split into
things that can be decided exactly and things that cannot:

**Decided exactly, on every run**

| Gate | What it proves |
| --- | --- |
| `npm run verify` | lint + typecheck + **431 tests** |
| `npm run qa:contrast` | samples the real photographs at 12 regions × 3 hours, composites the grade + glass, and asserts WCAG for four text roles — **worst 5.53:1, 0 failures of 144** |
| `npm run qa:fit` | walks the rendered DOM at **10 widths (1440→320)** and proves no grid, min-width or hard width can exceed its column — **0 guaranteed overflow** |
| `scripts/smoke-render.mjs` | boots the real bundle and drives the UI |
| `scripts/qa-sweep.mjs` | 0 errors, 0 warnings across all probes |
| `tests/integration/atmosphere.test.js` | the selector → DOM → layer → storage path, in both directions |
| `tests/unit/atmosphere.test.js` | boundaries, override precedence, greeting split, asset budget, precache completeness, cascade order, signature-font precedence |

**Not verified here: aesthetics in a real browser.** Final judgement of
composition, rhythm and "does it feel like a hotel" needs human eyes on a
device. The fit audit guarantees nothing overlaps or overflows; it cannot tell
you whether the room feels right.

## 7 · Two regressions found and fixed during QA

1. **Signature fonts were being silently overwritten.** `atmosphere.css` was
   moved last in the cascade (so its overrides are deliberate), which meant its
   `h1–h4 { font-family }` rule beat `system.css`'s `[data-signature-font]`
   modes. Re-stated at higher specificity so the user's choice always wins.
2. **`--font-mono` had been redefined to DM Sans.** The `instrument` signature
   mode resolves to that token, so choosing it would have produced a sans-serif
   "mono" heading. The token is now a genuine monospace stack.

Both now have unit tests.
