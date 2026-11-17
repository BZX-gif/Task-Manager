/**
 * Unit tests for the HYB plan domain (`lib/hyb.js`) — the pure half, with no
 * DOM and no store. Everything here is what the deck, the studio, the calendar
 * and the Forecast all lean on, so the rules are pinned down exactly:
 *
 *   • a plan is shape-safe: junk in storage can never break the app
 *   • repeats are honest: a weekly plan never appears before its start date
 *   • finishing is per-day for a series and per-plan for a one-day plan
 *   • the natural-language quick add invents nothing it did not read
 *   • a plan converts to a mission or a time block without losing fields
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  HYB_ENERGY,
  HYB_KINDS,
  HYB_KIND_IDS,
  HYB_REPEATS,
  energyOf,
  hybCommitmentMinutes,
  hybContext,
  hybLoad,
  hybStreak,
  hybStats,
  isDoneOn,
  isSkippedOn,
  kindOf,
  makeHybPlan,
  nextHybPlan,
  normalizeClock,
  normalizeHybPlan,
  occursOn,
  occurrencesOn,
  overduePlans,
  parseHybInput,
  planEndsOn,
  planFromInput,
  planMetaLine,
  planRecurrence,
  planToBlock,
  planToTaskPayload,
  repeatOf,
  trimLog,
  undatedPlans,
  upcoming,
  weekStrip,
} from '../../src/client/lib/hyb.js'
import { addDays } from '../../src/client/lib/dates.js'

const TODAY = '2026-09-15' // a Tuesday
const NOW = Date.UTC(2026, 8, 15, 12)

const ctx = () => hybContext({ now: NOW, id: () => 'fixed-id' })

/** A plan as it would sit in storage, with only the fields a test cares about. */
function plan(overrides = {}) {
  return makeHybPlan(
    {
      id: 'p1',
      title: 'Revision',
      date: TODAY,
      startTime: '18:00',
      minutes: 60,
      kind: 'study',
      priority: 'medium',
      energy: 'steady',
      repeat: 'none',
      ...overrides,
    },
    ctx(),
  )
}

/* ------------------------------------------------------------- vocabulary */

test('the six HYB lanes, three repeats-with-meaning and three energies are stable', () => {
  assert.deepEqual(HYB_KIND_IDS, ['study', 'work', 'body', 'personal', 'event', 'idea'])
  assert.equal(HYB_KINDS.length, 6)
  for (const kind of HYB_KINDS) {
    assert.ok(kind.label && kind.icon && kind.hint, `${kind.id} is fully described`)
    assert.equal(kindOf(kind.id), kind)
  }
  assert.deepEqual(HYB_REPEATS.map((repeat) => repeat.id), ['none', 'daily', 'weekdays', 'weekly'])
  assert.deepEqual(HYB_ENERGY.map((energy) => energy.id), ['deep', 'steady', 'light'])
  // unknown ids fall back instead of throwing
  assert.equal(kindOf('nonsense').id, 'study')
  assert.equal(energyOf('nonsense').id, 'steady')
  assert.equal(repeatOf('nonsense').id, 'none')
})

test('normalizeClock reads a stored clock time and refuses anything else', () => {
  assert.equal(normalizeClock('18:00'), '18:00')
  assert.equal(normalizeClock('9:05'), '09:05')
  assert.equal(normalizeClock('0:00'), '00:00')
  assert.equal(normalizeClock('23:59'), '23:59')
  // spoken times are the parser's job, not this one — it guards stored values
  assert.equal(normalizeClock('6pm'), null)
  assert.equal(normalizeClock('9:5'), null)
  assert.equal(normalizeClock(540), null)
  assert.equal(normalizeClock('24:00'), null)
  assert.equal(normalizeClock('25:00'), null)
  assert.equal(normalizeClock('12:60'), null)
  assert.equal(normalizeClock('nonsense'), null)
  assert.equal(normalizeClock(null), null)
  assert.equal(normalizeClock(undefined), null)
  assert.equal(normalizeClock('  18:00  '), '18:00', 'surrounding space is trimmed')
})

/* ----------------------------------------------------------- shape safety */

test('a plan from damaged storage is repaired, never thrown away', () => {
  const repaired = normalizeHybPlan(
    {
      id: 'keep',
      title: '   ',
      date: 'not-a-date',
      startTime: '99:99',
      minutes: 99999,
      kind: 'nonsense',
      priority: 'urgent',
      energy: 'nonsense',
      repeat: 'hourly',
      status: 'nonsense',
      tags: ['Mock', 'mock', '', null, 'gs paper', 'a', 'b', 'c', 'd', 'e', 'f'],
      steps: 'not-an-array',
      log: { '2026-09-15': 'done', 'nonsense': 'done', '2026-09-14': 'maybe' },
    },
    ctx(),
  )
  assert.equal(repaired.id, 'keep')
  assert.equal(repaired.title, 'Untitled plan', 'an empty title becomes a placeholder')
  assert.equal(repaired.date, null, 'an unreadable date becomes "someday"')
  assert.equal(repaired.startTime, null)
  assert.equal(repaired.minutes, 1440, 'minutes are clamped to a day')
  assert.equal(repaired.kind, 'study')
  assert.equal(repaired.priority, 'medium')
  assert.equal(repaired.energy, 'steady')
  assert.equal(repaired.repeat, 'none')
  assert.equal(repaired.status, 'planned')
  assert.equal(repaired.steps.length, 0)
  assert.deepEqual(repaired.log, { '2026-09-15': 'done' }, 'only real days with real values survive')
  assert.equal(repaired.tags.length <= 8, true, 'tags are capped')
  assert.equal(repaired.tags.includes('mock'), true, 'tags are slugged and de-duplicated')
  assert.equal(repaired.createdAt, NOW)
  assert.equal(normalizeHybPlan(null), null, 'non-objects are refused')
})

test('minutes, steps and notes stay inside their limits', () => {
  const bounded = normalizeHybPlan(
    {
      title: 'Bounded',
      date: TODAY,
      minutes: 1,
      notes: 'x'.repeat(9000),
      steps: Array.from({ length: 60 }, (_, i) => ({ title: `Step ${i}` })),
    },
    ctx(),
  )
  assert.equal(bounded.minutes, 5, 'five minutes is the floor')
  assert.equal(bounded.notes.length, 4000)
  assert.equal(bounded.steps.length, 30, 'a plan cannot carry more than thirty steps')
  assert.equal(bounded.progress, 0, 'progress is derived from the steps')

  const halfDone = normalizeHybPlan({ title: 'Half', steps: [{ title: 'a', done: true }, { title: 'b' }] }, ctx())
  assert.equal(halfDone.progress, 50)
  assert.equal(normalizeHybPlan({ title: 'No steps' }, ctx()).progress, null, 'no steps means no percentage')
})

test('a repeating plan cannot be "done" — only dropped or still open', () => {
  assert.equal(plan({ repeat: 'daily', status: 'done' }).status, 'planned')
  assert.equal(plan({ repeat: 'daily', status: 'dropped' }).status, 'dropped')
  assert.equal(plan({ repeat: 'none', status: 'done' }).status, 'done')
})

test('the per-day log is bounded so a daily plan cannot grow forever', () => {
  const log = {}
  for (let i = 0; i < 500; i++) log[addDays('2020-01-01', i)] = 'done'
  const trimmed = trimLog(log, 400)
  assert.equal(Object.keys(trimmed).length, 400)
  assert.equal(trimmed[addDays('2020-01-01', 499)], 'done', 'the newest days are the ones kept')
  assert.equal(trimmed[addDays('2020-01-01', 0)], undefined)
  assert.deepEqual(trimLog(null), {})
  const small = { [TODAY]: 'done' }
  assert.equal(trimLog(small), small, 'a small log is returned untouched')
})

/* ------------------------------------------------------------- occurrences */

test('occurrences follow the repeat rule and never invent days', () => {
  const once = plan({ repeat: 'none', date: TODAY })
  assert.equal(occursOn(once, TODAY), true)
  assert.equal(occursOn(once, addDays(TODAY, 1)), false)
  assert.equal(occursOn(once, addDays(TODAY, -1)), false, 'a one-day plan does not backfill')

  const daily = plan({ repeat: 'daily', date: TODAY })
  assert.equal(occursOn(daily, addDays(TODAY, 40)), true)
  assert.equal(occursOn(daily, addDays(TODAY, -1)), false, 'no series exists before its start date')

  const weekdays = plan({ repeat: 'weekdays', date: TODAY })
  assert.equal(occursOn(weekdays, '2026-09-18'), true, 'Friday')
  assert.equal(occursOn(weekdays, '2026-09-19'), false, 'Saturday is free')
  assert.equal(occursOn(weekdays, '2026-09-20'), false, 'Sunday is free')

  const weekly = plan({ repeat: 'weekly', date: TODAY })
  assert.equal(occursOn(weekly, addDays(TODAY, 7)), true, 'same weekday next week')
  assert.equal(occursOn(weekly, addDays(TODAY, 1)), false)

  assert.equal(occursOn(plan({ status: 'dropped' }), TODAY), false, 'a dropped plan disappears')
  assert.equal(occursOn(plan({ date: null }), TODAY), false, 'a someday plan is on no day')
  assert.equal(occursOn(null, TODAY), false)
  assert.equal(occursOn(plan(), 'rubbish'), false)
})

test('finishing is per-day for a series and per-plan for a one-day plan', () => {
  const series = plan({ repeat: 'daily', log: { [TODAY]: 'done', [addDays(TODAY, 1)]: 'skipped' } })
  assert.equal(isDoneOn(series, TODAY), true)
  assert.equal(isDoneOn(series, addDays(TODAY, 1)), false, 'a skipped day is not a finished day')
  assert.equal(isSkippedOn(series, addDays(TODAY, 1)), true)
  assert.equal(isDoneOn(series, addDays(TODAY, 2)), false)

  const single = plan({ repeat: 'none', status: 'done' })
  assert.equal(isDoneOn(single, TODAY), true)
  assert.equal(isSkippedOn(single, TODAY), false, 'a one-day plan is never "skipped"')
  assert.equal(isDoneOn(plan({ status: 'dropped' }), TODAY), false)
})

test('a day lists its plans earliest first, and leaves undated plans off', () => {
  const plans = [
    plan({ id: 'late', title: 'Late', startTime: '21:00' }),
    plan({ id: 'early', title: 'Early', startTime: '06:00' }),
    plan({ id: 'untimed', title: 'Untimed', startTime: null }),
    plan({ id: 'someday', title: 'Someday', date: null }),
    plan({ id: 'other', title: 'Other day', date: addDays(TODAY, 1) }),
  ]
  const list = occurrencesOn(plans, TODAY)
  assert.deepEqual(list.map((item) => item.plan.id), ['early', 'late', 'untimed'], 'timed first, then the untimed')
  assert.equal(list[0].minutes, 60)
  assert.equal(list.every((item) => item.done === false), true)
  assert.equal(occurrencesOn(plans, 'rubbish').length, 0)
  assert.equal(occurrencesOn(null, TODAY).length, 0)
})

test('someday and overdue are separate shelves', () => {
  const plans = [
    plan({ id: 'someday', date: null }),
    plan({ id: 'old', date: addDays(TODAY, -3) }),
    plan({ id: 'old-done', date: addDays(TODAY, -3), status: 'done' }),
    plan({ id: 'old-daily', date: addDays(TODAY, -3), repeat: 'daily' }),
    plan({ id: 'future', date: addDays(TODAY, 3) }),
  ]
  assert.deepEqual(undatedPlans(plans).map((item) => item.id), ['someday'])
  assert.deepEqual(overduePlans(plans, TODAY).map((item) => item.id), ['old'], 'only a dated one-day plan can be overdue')
  assert.equal(undatedPlans(plans).length, 1)
})

/* ------------------------------------------------------------------- loads */

test('the next fourteen days are counted, and finished work stops counting', () => {
  const plans = [
    plan({ id: 'daily', repeat: 'daily', minutes: 30 }),
    plan({ id: 'once', date: addDays(TODAY, 2), minutes: 90, startTime: '10:00' }),
  ]
  const window = upcoming(plans, TODAY, 14)
  assert.equal(window.length, 14)
  assert.equal(window[0].date, TODAY)
  assert.equal(window[0].planned, 1, 'the daily plan is on today')
  assert.equal(window[0].minutes, 30)
  assert.equal(window[2].planned, 2, 'today + 2 has the daily plan and the one-off')
  assert.equal(window[2].minutes, 120)
  assert.equal(upcoming(plans, TODAY, 999).length, 60, 'the window is capped')
  assert.equal(upcoming(plans, TODAY).length, 7, 'a week is the default window')
  assert.equal(upcoming(plans, TODAY, -3).length, 1, 'a negative span is floored at one day')

  const finished = [{ ...plans[0], log: { [TODAY]: 'done' } }, plans[1]]
  assert.equal(upcoming(finished, TODAY, 1)[0].minutes, 0, 'a finished day asks for no more time')
  assert.equal(upcoming(finished, TODAY, 1)[0].done, 1)
  assert.equal(hybCommitmentMinutes(plans, TODAY, 14), 30 * 14 + 90)
})

test('one day of HYB load reports count, minutes and completion', () => {
  const plans = [
    plan({ id: 'a', minutes: 60 }),
    plan({ id: 'b', minutes: 30, log: {}, status: 'done' }),
    plan({ id: 'c', repeat: 'daily', minutes: 20, log: { [TODAY]: 'skipped' } }),
  ]
  const load = hybLoad(plans, TODAY)
  assert.equal(load.count, 3)
  assert.equal(load.doneCount, 1)
  assert.equal(load.skipped, 1)
  assert.equal(load.open, 1, 'only plan "a" is still asking for time')
  assert.equal(load.minutes, 110)
  assert.equal(load.doneMinutes, 30)
  assert.equal(load.completion, 33)
  assert.equal(hybLoad([], TODAY).completion, 0, 'an empty day is not a failure')
})

test('the week strip starts where the user wants its week to start', () => {
  const plans = [plan({ id: 'a', date: TODAY, minutes: 45 })]
  const monday = weekStrip(plans, TODAY, 1)
  assert.equal(monday.length, 7)
  assert.equal(monday[0].date, '2026-09-14', 'Monday first')
  assert.equal(monday.find((day) => day.isToday).date, TODAY)
  assert.equal(monday[1].count, 1)
  assert.equal(monday[1].minutes, 45)
  assert.equal(weekStrip(plans, TODAY, 0)[0].date, '2026-09-13', 'Sunday first')
  assert.equal(monday.every((day) => typeof day.isFuture === 'boolean'), true)
})

test('a streak counts consecutive days and remembers the best run', () => {
  const plans = [
    plan({ id: 'a', repeat: 'daily', date: addDays(TODAY, -9), log: { [addDays(TODAY, -1)]: 'done', [TODAY]: 'done' } }),
    plan({ id: 'b', date: addDays(TODAY, -6), status: 'done' }),
    plan({ id: 'c', date: addDays(TODAY, -5), status: 'done' }),
    plan({ id: 'd', date: addDays(TODAY, -4), status: 'done' }),
    plan({ id: 'e', date: addDays(TODAY, -2), log: { [addDays(TODAY, -2)]: 'skipped' } }),
  ]
  const streak = hybStreak(plans, TODAY)
  assert.equal(streak.current, 2, 'yesterday and today')
  assert.equal(streak.best, 3, 'the three-day run earlier in the month')
  assert.equal(streak.days, 5)

  // nothing done today, but yesterday was — the streak is still alive
  assert.equal(hybStreak([plan({ repeat: 'daily', log: { [addDays(TODAY, -1)]: 'done' } })], TODAY).current, 1)
  assert.deepEqual(hybStreak([], TODAY), { current: 0, best: 0, days: 0 })
})

test('the stats the badge and the studio read are consistent with each other', () => {
  const plans = [
    plan({ id: 'a', minutes: 60, kind: 'study' }),
    plan({ id: 'b', minutes: 30, kind: 'study', date: addDays(TODAY, 1) }),
    plan({ id: 'c', minutes: 45, kind: 'body', date: null }),
    plan({ id: 'd', minutes: 20, kind: 'work', date: addDays(TODAY, -2) }),
    plan({ id: 'e', minutes: 20, kind: 'idea', status: 'dropped', date: TODAY }),
  ]
  const stats = hybStats(plans, { todayKey: TODAY, days: 7 })
  assert.equal(stats.total, 5)
  assert.equal(stats.open, 4)
  assert.equal(stats.dropped, 1)
  assert.equal(stats.undated, 1)
  assert.equal(stats.overdue, 1)
  assert.equal(stats.today.count, 1, 'only plan "a" is on today')
  assert.equal(stats.today.minutes, 60)
  assert.equal(stats.windowPlanned, 2, 'the undated, overdue and dropped plans are not in the window')
  assert.equal(stats.minutesPlanned, 90)
  assert.equal(stats.completion, 0)
  assert.deepEqual(stats.byKind.map((row) => row.id), ['study', 'work', 'body'], 'lanes with nothing in them are left out')
  assert.equal(stats.byKind[0].count, 2)
  assert.equal(stats.byKind[0].minutes, 90)
  assert.equal(stats.week.length, 7)
  assert.equal(stats.window.length, 7)
  assert.deepEqual(hybStats([], { todayKey: TODAY }).byKind, [])
})

test('the HYB button knows what it should be thinking about right now', () => {
  const running = [plan({ id: 'now', startTime: '11:30', minutes: 60 })]
  assert.equal(nextHybPlan(running, { todayKey: TODAY, nowMinutes: 12 * 60 }).reason, 'Happening now')

  const later = [plan({ id: 'later', startTime: '18:00', minutes: 60 })]
  assert.equal(nextHybPlan(later, { todayKey: TODAY, nowMinutes: 12 * 60 }).plan.id, 'later')
  assert.equal(nextHybPlan(later, { todayKey: TODAY, nowMinutes: 12 * 60 }).reason, 'Later today')

  const overdue = [plan({ id: 'old', date: addDays(TODAY, -2) })]
  assert.equal(nextHybPlan(overdue, { todayKey: TODAY }).plan.id, 'old')
  assert.match(nextHybPlan(overdue, { todayKey: TODAY }).reason, /Still open/)

  const untimed = [plan({ id: 'untimed', startTime: null })]
  assert.match(nextHybPlan(untimed, { todayKey: TODAY }).reason, /no time set/i)

  const future = [plan({ id: 'future', date: addDays(TODAY, 3) })]
  assert.match(nextHybPlan(future, { todayKey: TODAY }).reason, /^Next on/)

  const someday = [plan({ id: 'someday', date: null })]
  assert.equal(nextHybPlan(someday, { todayKey: TODAY }).reason, 'No date yet')

  const finished = [plan({ id: 'done', status: 'done' })]
  assert.equal(nextHybPlan(finished, { todayKey: TODAY }), null, 'a finished day has no next plan')
  assert.equal(nextHybPlan([], { todayKey: TODAY }), null)

  // the same answer can be reached from a real clock instead of minutes
  const fromClock = nextHybPlan(running, { todayKey: TODAY, now: new Date('2026-09-15T12:00:00') })
  assert.equal(fromClock.reason, 'Happening now')
})

/* ------------------------------------------------------------- conversions */

test('a plan becomes a mission without losing anything', () => {
  const source = plan({
    id: 'src',
    title: 'Write three answers',
    notes: 'Timed, no phone.',
    tags: ['mock', 'gs-paper'],
    steps: [{ id: 's1', title: 'Read the questions', done: true }, { id: 's2', title: 'Write' }],
    goalId: 'g1',
    projectId: 'pr1',
    minutes: 90,
    priority: 'high',
    startTime: '09:00',
  })
  const payload = planToTaskPayload(source, { id: 'task-1', now: NOW })
  assert.equal(payload.id, 'task-1')
  assert.equal(payload.title, 'Write three answers')
  assert.equal(payload.date, TODAY)
  assert.equal(payload.time, '09:00')
  assert.equal(payload.priority, 'high')
  assert.equal(payload.estimateMinutes, 90)
  assert.equal(payload.status, 'ready')
  assert.equal(payload.inbox, false)
  assert.equal(payload.done, false)
  assert.equal(payload.horizon, 'daily')
  assert.equal(payload.goalId, 'g1')
  assert.equal(payload.projectId, 'pr1')
  assert.equal(payload.subtasks.length, 2, 'steps become subtasks')
  assert.equal(payload.subtasks[0].done, true)
  assert.match(payload.notes, /Timed, no phone\./)
  assert.match(payload.notes, /HYB tags: #mock #gs-paper/, 'tags travel with the mission')
  assert.equal(payload.createdAt, NOW)

  // a dated override wins, and a repeating plan is long-horizon work
  assert.equal(planToTaskPayload(source, { date: addDays(TODAY, 2) }).date, addDays(TODAY, 2))
  assert.equal(planToTaskPayload(plan({ repeat: 'daily' })).horizon, 'long_term')
  assert.equal(planToTaskPayload(plan({ date: null, tags: [] })).notes, '', 'no notes means no invented notes')
  assert.equal(planToTaskPayload(plan({ date: null })).date.length, 10, 'an undated plan lands on today')
})

test('a repeating plan becomes a real recurrence on the mission', () => {
  assert.equal(planRecurrence(plan({ repeat: 'none' })), null)
  assert.equal(planRecurrence(plan({ date: null, repeat: 'daily' })), null, 'a series needs a start date')
  assert.equal(planRecurrence(plan({ repeat: 'daily' })).freq, 'daily')
  assert.deepEqual(planRecurrence(plan({ repeat: 'weekdays' })).weekdays, [1, 2, 3, 4, 5])
  assert.deepEqual(planRecurrence(plan({ repeat: 'weekly' })).weekdays, [2], 'Tuesdays, because the plan starts on a Tuesday')
  assert.equal(planRecurrence(plan({ repeat: 'weekly' })).startDate, TODAY)
})

test('a plan becomes a time block the Schedule already understands', () => {
  const block = planToBlock(plan({ id: 'src', minutes: 75, startTime: '17:30' }), TODAY)
  assert.equal(block.id, 'hyb:src')
  assert.equal(block.hybPlanId, 'src', 'the block remembers which plan it came from')
  assert.equal(block.sourceId, 'src')
  assert.equal(block.taskId, null, 'a plan is not a mission until you say so')
  assert.equal(block.title, 'Revision')
  assert.equal(block.time, '17:30')
  assert.equal(block.duration, 75)
  assert.equal(block.date, TODAY)
  assert.equal(block.protected, false)
  assert.equal(block.flexible, true, 'HYB time can be moved by the recovery planner')
  assert.equal(block.kind, 'mission')

  assert.equal(planToBlock(plan({ startTime: null }), TODAY).time, '09:00', 'an untimed plan is placed at nine')
  assert.equal(planToBlock(plan({ startTime: '18:00' }), TODAY, { startTime: '20:00' }).time, '20:00', 'an explicit time wins')
  assert.equal(planToBlock(plan({ date: null }), null).date.length, 10)
})

test('a plan can be described in one honest line', () => {
  assert.equal(planMetaLine(plan({ startTime: '18:00', minutes: 90, kind: 'study', energy: 'deep' })), '18:00 · 1h 30m · Study · Deep')
  assert.match(planMetaLine(plan({ repeat: 'daily' })), /Every day/)
  const elsewhere = addDays(TODAY, 2)
  assert.ok(planMetaLine(plan({ startTime: null, date: elsewhere }), TODAY).includes(elsewhere), 'a plan on another day says which day')
  assert.equal(planEndsOn(plan({ repeat: 'none', date: TODAY })), TODAY)
  assert.equal(planEndsOn(plan({ repeat: 'daily' })), null, 'the built-in repeats have no end date')
})

/* ------------------------------------------------------- natural language */

test('the quick add reads a whole sentence and invents nothing else', () => {
  const parsed = parseHybInput('Revision of polity tomorrow 6pm 90m @study ~deep !high every weekday #mock #gs-paper', {
    now: new Date(NOW),
    todayKey: TODAY,
  })
  assert.equal(parsed.title, 'Revision of polity', 'the title carries none of the markup')
  assert.equal(parsed.date, addDays(TODAY, 1))
  assert.equal(parsed.startTime, '18:00')
  assert.equal(parsed.minutes, 90)
  assert.equal(parsed.priority, 'high')
  assert.equal(parsed.kind, 'study')
  assert.equal(parsed.energy, 'deep')
  assert.equal(parsed.repeat, 'weekdays')
  assert.deepEqual(parsed.tags, ['mock', 'gs-paper'])
  assert.equal(parsed.hasAnything, true)
  const kinds = parsed.matches.map((match) => match.kind)
  assert.ok(kinds.includes('lane') && kinds.includes('energy'), 'the deck can show what it understood')
  assert.ok(!kinds.includes('category'), 'HYB has no categories')

  const bare = parseHybInput('Call the bank', { now: new Date(NOW), todayKey: TODAY })
  assert.equal(bare.title, 'Call the bank')
  assert.equal(bare.date, null)
  assert.equal(bare.startTime, null)
  assert.equal(bare.minutes, null)
  assert.equal(bare.priority, null)
  assert.equal(bare.kind, null)
  assert.equal(bare.energy, null)
  assert.equal(bare.repeat, 'none')
  assert.deepEqual(bare.tags, [])
  assert.equal(bare.hasAnything, false, 'a plain sentence claims to have read nothing')

  assert.equal(parseHybInput('', { todayKey: TODAY }).title, '')
  assert.equal(parseHybInput(null, { todayKey: TODAY }).hasAnything, false)
})

test('lanes and energies can be written several ways', () => {
  const now = new Date(NOW)
  assert.equal(parseHybInput('Run @body', { now, todayKey: TODAY }).kind, 'body')
  assert.equal(parseHybInput('Run @Body', { now, todayKey: TODAY }).kind, 'body')
  assert.equal(parseHybInput('Run @bod', { now, todayKey: TODAY }).kind, 'body', 'a prefix is enough')
  assert.equal(parseHybInput('Run @nonsense', { now, todayKey: TODAY }).kind, null, 'an unknown lane is not guessed')
  assert.equal(parseHybInput('Read ~light', { now, todayKey: TODAY }).energy, 'light')
  assert.equal(parseHybInput('Read ~deep', { now, todayKey: TODAY }).energy, 'deep')
  assert.equal(parseHybInput('Party @event tomorrow 8pm', { now, todayKey: TODAY }).kind, 'event')
  assert.equal(parseHybInput('Sit with the idea @idea', { now, todayKey: TODAY }).title, 'Sit with the idea')
  assert.equal(parseHybInput('Every day stretch @body', { now, todayKey: TODAY }).repeat, 'daily')
})

test('a typed line becomes a saveable plan, with defaults filling the gaps', () => {
  const { plan: made, parsed } = planFromInput('Gym and a walk @body 45m', { now: NOW, todayKey: TODAY, id: 'fixed-id' })
  assert.equal(made.id, 'fixed-id')
  assert.equal(made.title, 'Gym and a walk')
  assert.equal(made.kind, 'body')
  assert.equal(made.minutes, 45)
  assert.equal(made.date, null, 'nothing was said about a day, so nothing is assumed')
  assert.equal(made.priority, 'medium')
  assert.equal(made.createdAt, NOW)
  assert.equal(parsed.kind, 'body')

  const withDefaults = planFromInput('Read', {
    now: NOW,
    todayKey: TODAY,
    defaults: { date: addDays(TODAY, 1), minutes: 25, kind: 'personal', energy: 'light', priority: 'high', repeat: 'daily', tags: ['reading'] },
  }).plan
  assert.equal(withDefaults.date, addDays(TODAY, 1), 'the deck date is used when the sentence is silent')
  assert.equal(withDefaults.minutes, 25)
  assert.equal(withDefaults.kind, 'personal')
  assert.equal(withDefaults.energy, 'light')
  assert.equal(withDefaults.priority, 'high')
  assert.equal(withDefaults.repeat, 'daily')
  assert.deepEqual(withDefaults.tags, ['reading'])

  // what was typed always beats the default
  assert.equal(planFromInput('Read @idea 10m', { now: NOW, defaults: { kind: 'study', minutes: 90 } }).plan.kind, 'idea')
  assert.equal(planFromInput('Read @idea 10m', { now: NOW, defaults: { kind: 'study', minutes: 90 } }).plan.minutes, 10)
  assert.equal(planFromInput('', { now: NOW }).plan.title, 'Untitled plan')
  assert.equal(planFromInput('Read', { now: NOW }).plan.id.length > 3, true, 'an id is generated when none is given')
})
