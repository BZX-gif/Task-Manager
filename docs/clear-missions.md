# Clearing missions without clearing a life

**Version 4.4.1 · `src/client/lib/clear-missions.js`**

> "The current web has missions — delete all the mission data, only mission
> data, so I can add new missions. Do not delete any other data."

That is a reasonable request and it is *not* the same as **Reset workspace**,
which was the only destructive button in the app until now. Reset empties
everything: goals, projects, routines and their history, the journal, HYB
plans, focus sessions, study plans, categories, protected time, score history,
reviews and every preference. Someone who wants a fresh missions list should
never have to accept that.

So the clear is surgical, and the line it draws is written down here, in one
pure module, where a test can hold it.

## The one trap: two things are called "mission"

| Field | What it really is | Cleared? |
|---|---|---|
| `state.tasks` | The missions list — what the UI calls "Your missions.", "New mission", "N open missions" | **Yes** |
| `state.missions` | The exam roadmap (`SSC CGL 2027`, `RAS 2028`, `UPSC CSE 2028`) that study plans and timetables are keyed by | **Never** |
| `state.timetables[missionId]`, `state.dayPlans[missionId][date]` | Study-plan templates and the day-plan snapshots taken from them | **Never** |

Deleting the roadmap would destroy every study plan attached to it. The clear
touches `state.tasks` and the marks that point at those missions; the roadmap
is left exactly as it was.

## Removed · the mission layer only

| Slice | What happens |
|---|---|
| `state.tasks` | Emptied — open, done, inbox, cancelled and every subtask inside them |
| `state.top3` | Reset to `{}`; a Top 3 is a list of mission ids, so with no missions it is noise |
| `state.schedule.days[*]` | Blocks with a `taskId` are removed — the ones a mission placed on the schedule |
| `state.completionLog[*].taskDone` | Emptied, so analytics never report completions for missions that no longer exist |
| `state.reminders.sent` | Keys starting `task:`, `task-duenow:` or `top3:` are pruned, so a fresh mission can be reminded about again |

## Kept · everything else, byte for byte

Goals · projects · routines and routine history · journal entries · HYB plans ·
focus sessions **and a running timer** · categories · study plans, timetables
and day-plan snapshots · plain time blocks, HYB blocks (`hyb:<planId>`) and
routine blocks on the schedule · protected time · score history · weekly
reviews · assistant history · briefing intentions · schedule change history ·
achievements and streaks · the exam roadmap · every preference.

The unit test
[`tests/unit/clear-missions.test.js`](../tests/unit/clear-missions.test.js)
fingerprints those subtrees as JSON before and after the clear and requires an
exact match, so an accidental extra delete fails loudly rather than quietly.

## Where it lives

| Surface | How |
|---|---|
| Settings → danger zone | **Clear all missions**, a warm amber zone above the red **Reset workspace**. Its copy is live: it names the real counts and lists what stays |
| Command palette (`Ctrl/⌘ + Shift + K`) | "Clear all missions — empty the missions list only" |
| Console / scripts | `CC.confirmClearMissions()` (asks first) or `CC.clearAllMissions({ backup, silent })` |

Every route goes through `confirmClearMissions()` in `core/actions.js`, so the
question is always the same and always shows real numbers:

```
Clear every mission?
Your missions list will be emptied so you can start fresh. Nothing else is touched.

Removed: 3 missions (2 open · 1 done · 1 in the inbox) · 2 subtasks ·
1 scheduled block placed by a mission · 2 Top 3 picks · 3 completion marks.
Kept: 1 goal · 1 project · 1 routine · 1 journal day · 1 HYB plan ·
1 focus session · 3 time blocks · 1 study-plan block · every preference.

              [ Cancel ]  [ Clear 3 missions ]
```

## Safety

1. **A safety copy is written first** — the full export payload, under its own
   key `kcc_backup_before_mission_clear`, beside (never overwriting)
   `kcc_backup_before_reset`, `kcc_backup_pre_import` and
   `kcc_backup_before_change`.
2. **If that copy cannot be written, the clear stops** and says so. Nothing is
   mutated when there is no way back.
3. **The success toast carries Undo for 10 seconds**, restoring the exact
   pre-clear snapshot with `replaceState()` — missions, blocks, Top 3 and
   completion marks all return.
4. **Cancelling writes nothing**, not even the safety copy.
5. After a successful clear the app switches to **Missions**, so the next thing
   you can do is add a mission.

## Behaviour

| Situation | Result |
|---|---|
| Missions present, confirm | Cleared, safety copy written, toast with Undo, view switches to Missions |
| Missions present, cancel | Nothing changes; no safety copy |
| No missions at all | Friendly "already fresh" notice; no dialog, no writes (`reason: 'empty'`) |
| Storage refuses the safety copy | Clear refused, error toast, state untouched (`reason: 'backup'`) |
| Cleared twice | Second call reports `empty` and changes nothing |
| Undo pressed | Everything returns, in memory and in `localStorage` |
| Brand new workspace (no stored data) | Boots normally; the zone reads "already empty" |

## Verification

`npm run verify` → lint (73 source files, 25 CC API calls), both typechecks,
clean build, **365 tests passing** (340 before this change):

- `tests/unit/clear-missions.test.js` — 16 tests: the removal set, the kept
  set compared as JSON, plan counts, singular/plural copy, malformed slices,
  idempotence, backup-key isolation.
- `tests/integration/clear-missions.test.js` — 9 tests in a real jsdom boot of
  the built bundle: the Settings zone and its live copy, the palette entry,
  confirm → cleared + every other byte kept + persisted to `localStorage`,
  the safety copy still holding the old missions, Undo restoring all of it,
  cancel writing nothing, adding a brand new mission afterwards, the empty and
  double-clear paths, and a workspace with no stored data.

`node scripts/smoke-render.mjs` → SMOKE OK (all 16 views, populated and empty).
