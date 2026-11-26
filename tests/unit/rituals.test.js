/**
 * RITUALS — the private rule layer.
 *
 * These tests hold the three promises the page makes:
 *   1. a tick is the only record, and a rule's history can never be rewritten;
 *   2. a streak counts due-and-kept days only — rest days and an unfinished
 *      morning never break it, and days before the rule existed never count;
 *   3. loading a workspace never invents a rule, and migration is additive.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  RITUAL_TONES,
  RITUAL_SUGGESTIONS,
  activeRituals,
  daysForPreset,
  isTicked,
  makeRitual,
  normalizeRitual,
  normalizeRitualLog,
  ritualDay,
  ritualDue,
  ritualHistory,
  ritualOverview,
  ritualStreak,
  ritualSummaryLine,
  streakLabel,
  toggleTick,
  toneOf,
} from '../../src/client/lib/rituals.js'
import { migrateState, migrateStateV8ToV9, emptyState, normalizeState, makeContext } from '../../src/client/lib/state.js'
import { STATE_VERSION } from '../../src/client/lib/defaults.js'

const store = (rituals = [], log = {}) => ({ rituals, log })
const rule = (id, extra = {}) => ({ id, title: `Rule ${id}`, tone: 'custom', days: daysForPreset('every'), createdAt: 0, dayKey: null, archived: false, ...extra })

test('the tone list is a closed, labelled set and every suggestion maps to one', () => {
  assert.ok(RITUAL_TONES.length >= 5)
  const ids = RITUAL_TONES.map((tone) => tone.id)
  assert.equal(new Set(ids).size, ids.length, 'tones are unique')
  assert.equal(toneOf('nonsense').id, 'custom', 'an unknown tone falls back to custom')
  for (const suggestion of RITUAL_SUGGESTIONS) {
    assert.ok(ids.includes(suggestion.tone), `${suggestion.title} names a real tone`)
    assert.ok(suggestion.title.length > 3)
  }
  // the two rules the brief names are offered out of the box
  const titles = RITUAL_SUGGESTIONS.map((s) => s.title.toLowerCase())
  assert.ok(titles.includes('talk less'))
  assert.ok(titles.some((t) => t.includes('brush')))
})

test('a ritual is normalised, never invented', () => {
  const ctx = makeContext({ now: 1000, id: () => 'new-id' })
  assert.equal(normalizeRitual({ title: '' }, ctx), null, 'a rule with no title is dropped')
  assert.equal(normalizeRitual({ title: '   ' }, ctx), null, 'whitespace is not a rule')
  const made = makeRitual({ title: '  Talk   less  ', note: ' b ', tone: 'speech' }, ctx)
  assert.equal(made.title, 'Talk less', 'the title is trimmed and collapsed')
  assert.equal(made.tone, 'speech')
  assert.equal(made.id, 'new-id')
  assert.equal(made.days.length, 7)
  assert.equal(made.everyDay, true)
  assert.equal(made.dayKey, '1970-01-01', 'makeRitual stamps the day it was written')
})

test('weekday presets and custom days survive a round trip', () => {
  assert.deepEqual(daysForPreset('weekdays'), [0, 1, 2, 3, 4])
  assert.deepEqual(daysForPreset('weekend'), [5, 6])
  assert.deepEqual(daysForPreset('every'), [0, 1, 2, 3, 4, 5, 6])
  const custom = normalizeRitual({ title: 'Gym', days: [1, 3, 5, 1] })
  assert.deepEqual(custom.days, [1, 3, 5], 'days are de-duplicated and sorted')
  assert.equal(custom.everyDay, false)
  const fallback = normalizeRitual({ title: 'Gym', days: [] })
  assert.equal(fallback.days.length, 7, 'an empty day list means every day')
})

test('the log only keeps known rituals and real days', () => {
  const log = normalizeRitualLog(
    {
      '2026-05-01': { a: true, ghost: true },
      'not-a-day': { a: true },
      '2026-05-02': { a: 'yes' },
      '2026-05-03': {},
    },
    new Set(['a']),
  )
  assert.deepEqual(log, { '2026-05-01': { a: true } }, 'unknown ids, bad days and non-true ticks are dropped')
})

test('due-ness follows the weekday list, and archived rules are never due', () => {
  const weekdays = rule('w', { days: [0, 1, 2, 3, 4] })
  assert.equal(ritualDue(weekdays, '2026-05-04'), true, 'a Monday')
  assert.equal(ritualDue(weekdays, '2026-05-09'), false, 'a Saturday')
  assert.equal(ritualDue({ ...weekdays, archived: true }, '2026-05-04'), false)
  assert.equal(activeRituals(store([weekdays, { ...weekdays, id: 'z', archived: true }])).length, 1)
})

test('toggling a tick is reversible and leaves no empty days behind', () => {
  const draft = { rituals: { rituals: [], log: {} } }
  assert.equal(toggleTick(draft, 'a', '2026-05-04'), true)
  assert.equal(isTicked(draft.rituals, 'a', '2026-05-04'), true)
  assert.equal(toggleTick(draft, 'a', '2026-05-04'), false)
  assert.equal(draft.rituals.log['2026-05-04'], undefined, 'the empty day is removed')
})

test('a streak counts due-and-kept days, and today stays open', () => {
  const today = '2026-05-10'
  const log = {}
  for (const day of ['2026-05-06', '2026-05-07', '2026-05-08', '2026-05-09']) log[day] = { a: true }
  const streak = ritualStreak(store([rule('a')], log), rule('a'), today)
  assert.equal(streak.current, 4, 'yesterday and the days before it count while today is open')
  assert.equal(streak.todayDue, true)
  assert.equal(streak.todayDone, false)
  assert.equal(streakLabel(streak), 'Today still open')
})

test('a missed day ends the run, and the run restarts honestly', () => {
  const today = '2026-05-10'
  const log = { '2026-05-06': { a: true }, '2026-05-08': { a: true }, '2026-05-09': { a: true } }
  const streak = ritualStreak(store([rule('a')], log), rule('a'), today)
  assert.equal(streak.current, 2, 'the gap on the 7th restarts the run at one on the 8th')
})

test('a rest day neither extends nor breaks a streak', () => {
  const today = '2026-05-11' // Monday — not one of the rule's days
  const gym = rule('g', { days: [0, 2] }) // Sunday and Tuesday
  // Kept on Sunday 3rd, Tuesday 5th and Sunday 10th. Everything between them is
  // a rest day, so they are three consecutive *due* days.
  const log = { '2026-05-03': { g: true }, '2026-05-05': { g: true }, '2026-05-10': { g: true } }
  const streak = ritualStreak(store([gym], log), gym, today)
  assert.equal(streak.todayDue, false, 'Monday is a rest day for this rule')
  assert.equal(streak.current, 3, 'rest days neither extend nor break the run')
  assert.equal(streak.best, 3)
  assert.equal(streakLabel(streak), 'Rest day')
})

test('days before a rule was written are not judged', () => {
  const today = '2026-05-10'
  const born = rule('a', { dayKey: '2026-05-09' })
  const streak = ritualStreak(store([born], { '2026-05-09': { a: true } }), born, today)
  assert.equal(streak.current, 1, 'the 9th is kept; today is still open')
  assert.equal(streak.total, 2, 'only the ninth and tenth of May are due days')
  assert.equal(streak.rate, 50, 'a rule is never judged before it exists')
})

test('the day ledger reports what was asked and what was kept', () => {
  const today = '2026-05-10'
  const rituals = [rule('a'), rule('b'), { ...rule('c'), days: [6] }]
  const day = ritualDay(store(rituals, { [today]: { a: true } }), today, rituals)
  assert.equal(day.dueCount, 2, 'c is a Saturday-only rule')
  assert.equal(day.doneCount, 1)
  assert.equal(day.pct, 50)
  assert.equal(day.complete, false)
  assert.equal(ritualDay(store([], {}), today, []).empty, true)
})

test('the overview finds perfect days, the last perfect day and the combined run', () => {
  const today = '2026-05-10'
  const rituals = [rule('a'), rule('b')]
  const log = {
    '2026-05-07': { a: true, b: true }, // perfect
    '2026-05-08': { a: true },          // partial
    '2026-05-09': { a: true, b: true }, // perfect
    '2026-05-10': { a: true, b: true }, // perfect — today
  }
  const overview = ritualOverview(store(rituals, log), today, { days: 30 })
  assert.equal(overview.count, 2)
  assert.equal(overview.perfectToday, true)
  assert.equal(overview.lastPerfect, today)
  assert.equal(overview.doneToday, 2)
  assert.equal(overview.dueToday, 2)
  assert.equal(overview.currentRun, 4, 'the 8th still kept one rule, so the combined run is unbroken')
  assert.equal(overview.bestPerfect, 2, 'the 9th and 10th form the best perfect run')
  assert.equal(overview.rate, 12, '7 ticks out of 30 rule-days in the window')
  assert.equal(overview.totalTicks, 7)
  assert.match(ritualSummaryLine(overview, today), /Every rule you set today is kept/)
})

test('the summary line is honest for an empty and a rest day', () => {
  assert.match(ritualSummaryLine({ count: 0 }, '2026-05-10'), /first rule/)
  assert.match(ritualSummaryLine({ count: 2, dueToday: 0 }, '2026-05-10'), /rest day/i)
  assert.match(ritualSummaryLine({ count: 2, dueToday: 3, doneToday: 0 }, '2026-05-10'), /3 rules wait/)
})

test('history rows behind a rule’s birth day are marked, not counted', () => {
  const born = rule('a', { dayKey: '2026-05-08' })
  const rows = ritualHistory(store([born], {}), born, '2026-05-10', 5)
  assert.equal(rows.length, 5)
  assert.equal(rows[0].beforeBirth, true)
  assert.equal(rows[0].due, false)
  assert.equal(rows.at(-1).due, true, 'today is due')
})

/* ------------------------------------------------------------- the schema */

test('a fresh workspace starts with an empty ritual layer', () => {
  const state = emptyState(makeContext({ now: 5 }))
  assert.equal(state.version, STATE_VERSION)
  assert.deepEqual(state.rituals, { rituals: [], log: {} }, 'nothing is invented for a new user')
})

test('v8 → v9 is additive and keeps every existing record', () => {
  const before = {
    version: 8,
    tasks: [{ id: 't1', title: 'Revise Polity', date: '2026-09-15', done: false }],
    goals: [{ id: 'g1', title: 'A goal' }],
    hyb: { plans: [] },
    journal: {},
  }
  const after = migrateStateV8ToV9(before, makeContext({ now: 7 }))
  assert.equal(after.version, 9)
  assert.deepEqual(after.tasks, before.tasks)
  assert.deepEqual(after.goals, before.goals)
  assert.deepEqual(after.rituals, { rituals: [], log: {} })
})

test('loading v8 data with unknown future fields keeps them out of the new layer', () => {
  const { state, applied } = migrateState(
    { version: 8, rituals: { rituals: [{ title: 'Talk less', tone: 'speech' }], log: { '2026-05-01': { nope: true } } } },
    makeContext({ now: 9, id: () => 'r1' }),
  )
  assert.ok(applied.includes('migrateStateV8ToV9'))
  assert.equal(state.rituals.rituals.length, 1)
  assert.equal(state.rituals.rituals[0].title, 'Talk less')
  assert.equal(state.rituals.rituals[0].id, 'r1')
  assert.deepEqual(state.rituals.log, {}, 'a tick for an unknown rule is dropped')
})

test('a saved rituals layer round-trips through normalisation', () => {
  const raw = {
    version: STATE_VERSION,
    rituals: {
      rituals: [{ id: 'a', title: 'Brush twice', tone: 'body', days: [0, 1, 2, 3, 4, 5, 6], createdAt: 1 }],
      log: { '2026-05-01': { a: true } },
    },
  }
  const state = normalizeState(raw, makeContext({ now: 3, id: () => 'x' }))
  assert.equal(state.rituals.rituals.length, 1)
  assert.deepEqual(state.rituals.log, { '2026-05-01': { a: true } })
})

/* --------------------------------------------------------- the page itself */

test('the page is documented, routed and offline-ready', async () => {
  const root = process.cwd()
  const shell = await readFile(path.join(root, 'src', 'shell.ts'), 'utf8')
  const sw = await readFile(path.join(root, 'public', 'sw.js'), 'utf8')
  const css = await readFile(path.join(root, 'public', 'static', 'worlds.css'), 'utf8')
  assert.match(shell, /'rituals'/, 'the route is in the shell')
  assert.match(shell, /rituals:'garden'/, 'the first paint already knows its room')
  assert.match(shell, /discipline-garden-sm\.webp/, 'the room is preloaded')
  assert.match(sw, /discipline-garden-sm\.webp/, 'the room is available offline')
  assert.match(css, /data-scene=garden/, 'the room has its own first frame')
  assert.match(css, /\.ritual-tick/, 'the tick is part of the design system')
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)/, 'and motion can be switched off')
})
