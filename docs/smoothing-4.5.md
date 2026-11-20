# Command 4.5 — the smoothing pass

A maintenance pass over the merged 4.4 workspace. No feature was added and no
stored data shape changed (schema stays **v8**); the work is defects, polish and
guardrails. `npm run verify` finishes **349/349**.

## Bugs fixed

| Where | Defect | Now |
|---|---|---|
| `lib/relationships.js` | Deleting a goal or project left `goalId`/`projectId` dangling on **HYB plans**. The card tolerated it, but the next edit of the plan silently rebuilt the link as `null`. | `unlinkDeleted()` clears plan links together with task/project/block links. Covered by a new unit test. |
| `views/tasks.js` | Deleting a mission left `missionId` dangling on HYB plans. | Cleared in the same commit that removes the mission. |
| `views/settings.js`, `views/calendar.js`, `ui/chrome.js` | `scrollIntoView()` was called directly. A browser or webview that does not implement it threw, aborting the whole click handler (the Settings rail and the calendar day rail). | New `scrollToNode()` helper in `core/dom.js`: optional, guarded, never throws. |
| `ui/chrome.js` | No keyboard activation fallback. Buttons that look native could not be applied with Enter/Space in environments that do not synthesise a click — the accent and theme pickers were dead to keyboard use. | One delegated activator: Enter/Space on a real `<button>` fires exactly one click, skips inputs/textareas, ignores modifiers and held keys. |
| `ui/hyb.js` | The HYB deck declares `aria-modal="true"` but never trapped Tab, so focus escaped to the page behind it. | Tab / Shift+Tab cycle inside the deck while it is open. |
| `main.js` | A rejected promise in an async handler was completely silent. | One `unhandledrejection` listener reports it calmly and leaves the workspace usable. |

## Rendering & interaction smoothness

- **Coalesced paints.** `refreshCurrentView()` used to render synchronously on every store commit. Bursts (keyboard reschedule, drags, bulk edits) forced repeated layout of the whole section. It now paints at most once per frame and always lands on the final state; `after(ms)` still defers a paint behind a dialog's exit animation.
- **Missing feedback drawn.** `focus-milestone-pulse` (the focus milestone flash) and `.toast.is-swiped` (swipe-to-dismiss) were toggled by JS but had no CSS rule, so those gestures produced nothing. Both are now drawn, and the milestone pulse is stilled under `prefers-reduced-motion`.
- **Schedule states.** `.calendar-event.is-active` (the block running *now*) and `.is-delayed` / `.is-skipped` were rendered with no visual state. They now carry the accent edge, warning edge and a quiet strike respectively.
- **Forecast advice.** `lib/forecast.js` returns `tone: 'neutral'` for calm/honest states, but only `--warn` and `--good` were styled. The neutral tone now has its own quiet surface.
- **Duplicate focus ring removed.** A bare `:focus-visible` rule applied `border-radius: .5rem` to *every* focused element (rounding square inputs and cards) and fought the real ring at a different offset. The single later ring rule is authoritative.

## Typography & contrast

- `durationHtml()` joins `formatDuration()` in `lib/dates.js` so metric strips read *“45m”, “1h”, “2h 5m”* — never *“0h 45m”* or *“1h 0m”*. Applied to Overview, Forecast, HYB Studio and Analytics.
- One separator for ratios (`0/3`, not `0 / 3`) across Overview, Analytics and Journal.
- **Muted text now clears WCAG AA on every surface in both themes.**
  Dark: `#837e78 → #8f8a84` (4.54:1 worst case, on `--surface-hover`).
  Light: `#7c756d → #6a6259` (4.86:1 worst case).
  Light accent `#b8511d → #a8461a` (5.38:1 on canvas) and the light HYB study lane follow it.
- `tests/unit/theme-contrast.test.js` reads the real tokens and fails if any of those pairings drop below 4.5:1.

## Accessibility

- Accent and theme pickers are now proper `role="radiogroup"` / `role="radio"` sets with `aria-checked` and a roving `tabindex` (one tab stop per group).
- Three mission-editor checkboxes gained `aria-label`s.
- The `.form-section` groups in the mission editor had **no rule at all** — they now render as one quiet bordered block instead of unframed form fragments.
- `openProtectedModal` / `openCategoryModal` are exposed on `window.CC` and declared in `global.d.ts` (the smoke harness already tried to use them).

## Housekeeping

- `APP_VERSION` **4.5** (shell + client), service-worker cache `v4-5-0` so returning users get the new assets.
- 6 new tests: contrast floors (4), duration formatting (1), HYB plan unlink (1), keyboard activation (1), HYB focus trap (1).

## Deliberately not changed

- The 5.0 branch open in parallel restructures the type scale, the evening ritual, search and reversible deletes; the fragmented 8–9.5px label sizes were left alone here to avoid a conflicting, risky rewrite.
- User-authored category colours (`#a99af1`, `#9aabbf`, …) are kept as-is: they are real data, not theme tokens, and changing them would restyle people's existing workspace.
