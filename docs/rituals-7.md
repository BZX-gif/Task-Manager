# RITUALS — your own rules, kept daily

> Talk less. Brush twice. No phone for the first hour. One tick a day is the
> whole practice.

Rituals is the tenth chapter of PAPER: a private list of the rules you set for
yourself, one tick per rule per day, and an honest streak that never punishes a
rest day or an unfinished morning. It opens in its own room — the **garden room**
at first light — and uses every other part of the product's language unchanged:
the scene hero, the glass sheet, the PAPER type ramp, the same navigation.

---

## 1 · The page

| Surface | What it does |
|---|---|
| Ledger | Today's ring (`kept / asked for`), one honest sentence, and four real figures: rules, combined run, best run, kept over 60 days. |
| Today's ticks | One row per rule that is asked for today: a tick, the rule's kind, its days, a note, its last seven days, its live streak, and buttons for history and edit. Rest-day rules are named quietly instead of being hidden. |
| The last six weeks | A day-per-cell record. Rest days are outlined, partial days are bronze, fully-kept days are solid. The foot line names the last perfectly kept day. |
| This week | Seven day cells with `kept / asked` and a fill bar. Today is open until the day ends. |
| Your rules | Every rule with its current and best run, ordered by the current one. The title opens that rule's history. |
| The honest rule | The counting contract, written on the page rather than buried in a doc: rest days are not asked for, today stays open, a missed day restarts the run at one and deletes nothing. |
| Editor | Title, optional note, seven kinds, every day / weekdays / weekends / choose days, a live preview of the tick row, and twelve one-tap starters including *Talk less* and *Brush my teeth twice*. |
| Rule history | A 35-day ledger per rule — kept, not ticked, or rest day — with current run, best run, rate, this week, and a tick for today. |

The Command Center carries one quiet line of the same data — today's ring, the
next un-ticked rule and a tick button — and renders nothing at all until the
first rule exists.

## 2 · The counting contract

A ritual is *due* on the weekdays you chose (every day by default; a five-day
list is weekdays, a two-day list is the weekend).

| Concept | Definition |
|---|---|
| Tick | `state.ritualLog["YYYY-MM-DD"][ritualId] = true`. One tick per rule per day, reversible. |
| Current run | Consecutive **due-and-kept** days, counting back from today. Today is skipped while it is still open, so an unfinished morning never breaks a run. |
| Best run | The longest consecutive run of due-and-kept days on record. |
| Rest day | Not in the rule's weekday list. It neither extends nor breaks a run, and it is not counted in the rate. |
| Birthday | A rule is only judged from the day it was written (`dayKey`). Earlier days are neither kept nor missed, so a new rule can never show a 3% rate on its first morning. |
| Missed day | The run restarts at one on the next kept day. Nothing is deleted, nothing is a debt. |
| Perfect day | Every rule asked for that day was ticked. |
| Combined run | Consecutive days on which at least one rule was kept. |

Streak text on the row is deliberately plain: `Today still open`, `Rest day`,
`Day one`, `N days kept`.

## 3 · Data

Schema **v9**, additive over v8. No mission, goal, project, HYB plan, schedule,
journal or routine record is touched.

```js
state.rituals = {
  rituals: [
    {
      id, title, note,
      tone: 'speech' | 'body' | 'mind' | 'work' | 'people' | 'order' | 'custom',
      days: [0..6],          // 0 = Sunday, matching weekdayOf()
      everyDay: boolean,     // convenience mirror of days.length === 7
      important, pinned,
      archived,              // archived rules keep their history and stop appearing
      createdAt, editedAt,
      dayKey                 // the day it was written — the start of its record
    }
  ],
  log: { "YYYY-MM-DD": { [ritualId]: true } }
}
```

Loading is defensive in the same way as the rest of the store: an unknown tone
becomes `custom`, an empty weekday list becomes every day, a tick for an unknown
rule or an invalid day is dropped, and a rule with no title is not invented.
Backups report `rituals` and `ritualTicks` in their counts.

## 4 · The room

| Piece | Value |
|---|---|
| Route | `/rituals` — served by the Worker, readable as a deep link, written by the router like every other chapter |
| Scene | `garden` (`public/assets/atmospheres/rituals/discipline-garden.webp` + `-sm.webp`) |
| First paint | the inline bootstrap sets `data-scene=garden` and preloads the small frame before CSS paints |
| Offline | the small frame is in the service-worker shell cache (`v6-1-0`) |
| Sheet | the styles live at the end of `public/static/worlds.css`, so it stays the final cascade layer |
| Facts | `Kept today`, `Best run`, `Rules` — read from the same store the page renders |

The photograph was generated from an architectural prompt (warm modernist garden
room, olive trees in terracotta, still pool, notebook on an oak table; no text,
people or interface), then shipped as a 2560 × 1429 WebP and a 1280 × 714
first-paint WebP. The PNG master is not committed.

## 5 · Access

- `R` opens Rituals (`P` is still PAPER, `O` Forecast, `J` Journal).
- ⌘K → *Open Rituals*, or *Write a new rule* to open the editor directly.
- The sidebar lists it under **KNOWLEDGE**, between Journal and Analytics.
- `?seed=rituals` seeds a five-rule demonstration workspace **once**, and only
  when it is asked for explicitly and no rituals exist yet. The default
  workspace is untouched.

## 6 · Verification

`tests/unit/rituals.test.js` (20 tests) holds the maths: normalisation,
presets, the log, due-ness, the streak (open today, missed days, rest days,
birthdays), the day ledger, perfect days, the combined run, the summary line,
and the v8 → v9 migration. `tests/integration/rituals.test.js` (9 tests) drives
the real bundle against the real shell: the deep link, the painted room, the
ticks persisting, the editor creating a rule, the suggestion chips, the detail
ledger, the dashboard strip, and an empty workspace that stays empty.

`npm run verify` — lint, both typechecks, clean build and 511 tests — is green.
