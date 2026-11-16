# Command 4.2 · The briefing

## The idea

Opening a personal command center should answer one question in the first
second: **what needs me now?** Command 4.2 greets the user as “Sir” (editable),
then answers with one deterministic next move — not a dashboard of everything.

## Surfaces

| Surface | Location | Purpose |
|---|---|---|
| Startup briefing | `src/client/ui/briefing.js` | Full-screen, once-a-day greeting with the next move, the day at a glance, coming up, tomorrow and the intention. |
| Command strip | `src/shell.ts` + `ui/briefing.js` | Always visible under the top bar: “At your command, Sir.” + current mission + reason/time. Clicking it opens the briefing. |
| Sidebar / drawer / dock | `src/shell.ts` | A persistent “Today’s briefing” entry and a mobile dock item, both wired to the same overlay. |
| Overview hero | `src/client/views/dashboard.js` | The greeting, the intention chip and a *Full briefing* button. |
| Settings | `src/client/views/settings.js` | Salutation, frequency (daily / every load / off), spoken briefing, live preview. |

## Determinism

`buildBriefing(state, { now, todayKey, blocks, stats, streak })` is a pure
function. Its pick order is fixed:

1. the time block running right now (not ticked off, not a completed mission)
2. an unfinished Top 3 priority for today
3. the most overdue open mission
4. the highest-priority open mission for today
5. the next scheduled block that has not started
6. the newest inbox capture
7. a clear day — stated honestly

Protected windows are never suggested as work. Counts come only from recorded
tasks, focus sessions and completion logs. A missing score stays missing rather
than becoming a zero.

## Data

Schema v6 stays additive. The only new persisted fields are:

```js
settings.salutation       // "Sir"
settings.briefingMode     // "daily" | "every" | "off"
settings.briefingSpeak    // false
briefing.lastShownDay     // yyyy-mm-dd
briefing.intentions       // { "yyyy-mm-dd": "one sentence" } — trimmed to 120 days
```

Older payloads load unchanged: `normalizeSettings` supplies defaults and
`normalizeState` validates the new `briefing` object.

## Behaviour and safety

- Auto-opens after ~1.2 s, and never while a dialog, the focus session, another
  briefing or someone typing has focus.
- Opening records the day immediately; closing (Escape, backdrop, button or
  footer) restores focus to where the user was.
- Focus is trapped inside the dialog; heading and actions are labelled.
- Speech uses the browser’s local synthesis, is feature-detected and fails
  quietly to the on-screen text.
- Nothing is sent anywhere; the assistant receives the intention only as part
  of its existing, user-triggered context snapshot.

## Verification

- `tests/unit/briefing.test.js` — greeting, pick order, counts, intentions,
  tomorrow preview, once-a-day rules, spoken summary.
- `tests/integration/briefing.test.js` — real shell + bundle in jsdom: strip,
  overlay, intention persistence, completion, recovery, settings preview,
  keyboard shortcut and auto-open-once behaviour.
