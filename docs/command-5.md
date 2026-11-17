# Command 5.0 · The everyday operating loop

> Prepared as if this were the only product the client used. No feature was added to fill a grid; every addition closes a real gap in the daily loop between **open the day → do the work → close the day → remember it**.

---

## 1. Executive summary

Command 4.x was already a complete local-first workspace: missions, goals, projects, routines, scheduling, focus, forecast, journal, review, assistant, backup and PWA. The audit found two things: the *inside* of the loop was strong, and the *edges* were not.

| Gap found in the audit | What 5.0 does |
|---|---|
| The day opened with a briefing but never closed. Unfinished work silently aged. | **Close the day** — a confirmed evening ritual that carries chosen work, sets tomorrow’s three and writes one honest line. |
| Search was a list of titles. Notes, subtitles, milestones and journal entries were invisible. | **Workspace search** — one ranked, grouped, highlighted index across every record. |
| The plan could not leave the product. | **Calendar export (.ics)** and a **printable day sheet**. |
| A delete was permanent and irreversible. | **Recently deleted** — 30-day, fully reversible archive that restores blocks and priority slots. |
| Small text ran to 9px, shadows carried the hierarchy, and labels competed with content. | **A refined material and type system** with a real scale, quieter depth and one accent. |

Everything remains browser-local. No account, no server, no network call was added.

---

## 2. Design direction

### 2.1 What was wrong

- **Legibility.** The interface used a 14px base but leaned on 9–11px for metadata, captions and labels. On a laptop at arm’s length, that reads as texture rather than information.
- **Depth noise.** Multiple glass layers, glows and shadows competed. The eye had to work to find the one thing that mattered.
- **Hierarchy by colour.** Accent, warning, success and category colour were used at similar weights, so colour stopped meaning “decision”.
- **Density without rhythm.** Card padding, gaps and headings varied between views.

### 2.2 The five rules of Command 5

1. **A real type scale.** `--text-2xs` 10.5 · `--text-xs` 11.5 · `--text-sm` 12.5 · base 14.5 · headings with optical tracking. No label below 10.5px.
2. **One spacing system.** 10 / 14 / 18 / 22 / 26px; radius 8 / 10 / 14 / 20 / 26. Every new component uses it, and the older cards adopt the outer two steps.
3. **Quiet depth.** Structure comes from hairline borders and one soft shadow. The gradient sheen is an edge highlight, not a decoration.
4. **One accent at a time.** The accent marks the chosen action, the selected row and the next move. Success, warning and danger stay semantically separate.
5. **Motion with intent.** 140/220/360 ms, `cubic-bezier(.22,.68,0,1)`. Every animation has a `prefers-reduced-motion` path; nothing moves on its own except ambient charts.

### 2.3 What changed, surface by surface

| Surface | Change |
|---|---|
| Tokens | New type steps, radius scale, muted/secondary contrast lifted, one card shadow pair, `--accent-ring` focus glow. |
| Cards | Unified radius, sheen-as-highlight, hover border lift, consistent header rhythm. |
| Command strip | Greeting is bolder, the next move is the only 14px text, and the evening ritual is a live status chip (`Close the day · 3 open` → `Day closed`). |
| Overview | A full-width **evening ritual card** with the honest state of the day and one action. |
| Palette | Grouped results, 30px icon tiles, highlighted match, keyboard selection marker, `↵` reveal. |
| Settings | A new **Evening ritual** section with a real “Close the day” action; calendar export and Recently deleted live inside *Your data*. |
| Mobile | Ritual rows stack cleanly, stat tiles become one-line rows, the day sheet uses the full width, and the strip drops the greeting before it drops an action. |
| Print | A dedicated ink-and-paper layout — 2px rule, uppercase section labels, tick boxes, ruled note lines — not a screenshot. |

### 2.4 Accessibility

- Focus is always visible (`2px` accent, `3px` offset) including on custom check rows.
- Every new control has an accessible name; the ritual list uses real checkboxes; mood/energy reuse the journal’s `aria-pressed` pattern.
- Colour is never the only signal: “Overdue”, “High priority” and “On tomorrow’s plan” are written, not merely tinted.
- The print sheet is black on white and does not rely on the dark theme.
- Reduced motion removes all transitions and scroll animation.

---

## 3. New capabilities

### 3.1 Close the day

The evening half of the daily loop, reachable from **`E`**, the sidebar, the command strip, the Overview card, the palette and a reminder.

| Step | Behaviour |
|---|---|
| Honest summary | Completed / total missions, focused minutes, still-open count, deterministic headline. |
| Carry forward | Only unfinished work dated today or earlier is offered. Carried work moves to tomorrow, keeps its identity and history, loses its stale start time (so the planner can re-place it) and is marked `rescheduled` — never failed. |
| Tomorrow’s three | Only work that will actually exist tomorrow can be chosen: carried missions or missions already dated tomorrow. Inbox captures are never silently scheduled. Choosing a priority also carries it. |
| One honest line | Writes note, win, mood and energy into the **same** journal entry as the Journal view. Existing text is preserved. |
| Confirmation | Nothing is written until **Close the day** is pressed; the toast offers **Reopen**, and the closed screen offers it too. |

Edge cases covered by tests: no candidates, nothing to carry, existing journal text, series roots, inbox items, a second closing, reopening, and carried work already scheduled tomorrow.

### 3.2 Workspace search

`⌘/Ctrl + K` now searches **missions** (title, description, private notes, subtasks), **goals** and **projects** (title, description, notes, milestones), **routines** (activities) and **journal** entries (note, win, next step).

- Token-AND matching: every word must match.
- Ranking: word-start title hit → title substring → all tokens in title → ordered subsequence (`plnday` → “Plan my day”) → secondary fields; then a capped recency boost.
- Results are grouped by kind, count-labelled and capped, with the match highlighted and an excerpt around body matches.
- With no query: suggested actions plus *Continue where you left off*.
- With no results: `Enter` captures the query as a mission, so a dead end becomes an action.

### 3.3 Calendar export and the printed day

- **`.ics`** — RFC 5545 with CRLF, escaped TEXT, 75-octet folding, stable UIDs, `DTSTAMP`, exclusive all-day end dates and UTC timestamps. Sleep, protected windows and blocks ≥8h are treated as recovery and omitted; a planned lunch stays.
- Range follows the Schedule view: one day, one week, or fourteen days from Settings.
- **Day sheet** — priorities, timed commitments, untimed missions, focus minutes and ruled notes. It can be printed or saved as a standalone HTML file with embedded styles.

### 3.4 Recently deleted

- Deleting a mission archives the mission, its dated schedule blocks (with positions), its Top-3 slots, and any recurring-series links detached from siblings.
- Restoring puts all of it back exactly once, and refuses cleanly if an id already exists.
- The active focus session loses a deleted attribution and regains it on restore.
- Records expire after 30 days, are capped at 100, and are purged quietly on load. Completion history and focus sessions are never rewritten.

---

## 4. Data model (schema v8)

Additive only. `localStorage["kcc_state_v1"]` and every existing id are unchanged.

```text
trash:      [ { id, taskId, task, deletedAt, expiringAt, blocks[], top3[], detached[], activeFocus } ]
shutdowns:  { "YYYY-MM-DD": { closed, at, tomorrow, carried[], priorities[], hasNote } }
settings.shutdown: { enabled, at, promptForNote }
```

Migration `v7 → v8` adds empty collections and a disabled-by-default-unsafe nothing: every prior mission, schedule, journal row, focus session and preference is preserved. Import validation runs the same migration path.

---

## 5. Verification

| Check | Result |
|---|---|
| `npm run lint` | Pass — 73 source files, 23 `window.CC` calls verified |
| Worker + client typecheck | Pass |
| Production build | Pass — client 605 kB, Worker 34 kB |
| Unit + integration tests | **319 / 319** (4 new integration scenarios, 33 new unit assertions) |
| View smoke (jsdom, all 14 views) | Pass — no console or jsdom errors |
| Existing behaviour suite | Pass — no test skipped or weakened |

The new tests drive the **real bundle**: the ritual is opened, priorities ticked, note typed, closed and reopened; a mission is deleted and restored through the UI; the palette is queried and the result opened with `Enter`; a day sheet is rendered and an `.ics` is produced.

Intentional expectation changes: version strings `4.3 → 5.0` and schema `7 → 8`.

---

## 6. Remaining limits (stated, not hidden)

- Data stays device-local. Cross-device sync remains a future backend decision, not a hidden dependency.
- Reminders, including the closing nudge, run while the workspace is open; they are not a push service.
- The `.ics` export is one-way. Importing a remote calendar is deliberately out of scope for this local model.
- The printed sheet is designed for A4/Letter; very long days may run to a second page (sections avoid breaking mid-block).
- No headless-browser screenshot suite is available in this environment; visual verification is by design-token review, jsdom structure checks and the recorded CSS print rules.
