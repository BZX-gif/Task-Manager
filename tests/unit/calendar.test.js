/**
 * Unit tests for the calendar layer (`lib/calendar.js`).
 *
 * The calendar never owns data: it reads the same missions, time blocks, HYB
 * plans, routines, deadlines and journal entries the rest of the app already
 * writes. These tests pin down the rules that keep that honest:
 *
 *   • the month grid always covers the whole month, on the user's week start
 *   • one day is read in a fixed order: clock first, then priority, then markers
 *   • a HYB plan that has been put on the schedule is drawn once, not twice
 *   • layers switch sources off without touching the data
 *   • month and day numbers add up, and junk input falls back instead of crashing
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  CAL_LAYER_IDS,
  agendaDays,
  dayEntries,
  daySummary,
  defaultLayers,
  monthBounds,
  monthKeyOf,
  monthMatrix,
  monthOverview,
  monthStats,
  monthTitle,
  normalizeLayers,
  shiftMonth,
  weekCells,
} from '../../src/client/lib/calendar.js'
import { baseState } from '../helpers/fixtures.js'

const TODAY = '2026-09-15' // a Tuesday

/**
 * A workspace with something of every kind on the same day, plus a HYB plan
 * that has already been put on the schedule as a real time block.
 */
function calendarState(overrides = {}) {
  const state = baseState({
    tasks: [
      { id: 't1', title: 'Untimed mission', date: TODAY, time: null, priority: 'low', estimateMinutes: 30, done: false, status: 'ready', inbox: false },
      { id: 't2', title: 'Timed mission', date: TODAY, time: '11:00', priority: 'high', estimateMinutes: 60, done: false, status: 'ready', inbox: false },
      { id: 't3', title: 'Overdue mission', date: '2026-09-10', time: null, priority: 'high', estimateMinutes: 20, done: false, status: 'ready', inbox: false },
      { id: 't4', title: 'Inbox mission', date: TODAY, time: null, priority: 'high', estimateMinutes: 20, done: false, status: 'ready', inbox: true },
      { id: 't5', title: 'Deadline mission', date: null, deadline: '2026-09-20', priority: 'medium', estimateMinutes: 20, done: false, status: 'ready', inbox: false },
    ],
    goals: [{ id: 'g1', title: 'Goal with a target', deadline: '2026-09-20' }],
    projects: [{ id: 'p1', title: 'Project with a target', deadline: '2026-09-20' }],
    routines: [{ id: 'r1', title: 'Morning start', time: '06:00', days: [1, 2, 3, 4, 5], archived: false, activities: [{ id: 'a1', title: 'Water', duration: 5 }, { id: 'a2', title: 'Stretch', duration: 5 }] }],
    routineHistory: { [TODAY]: { r1: ['a1', 'a2'] } },
    journal: { [TODAY]: { note: 'A steady day.', mood: 'good' } },
    hyb: {
      plans: [
        { id: 'h1', title: 'Evening revision', date: TODAY, startTime: '17:00', minutes: 45, kind: 'study', priority: 'medium', energy: 'deep', repeat: 'none', status: 'planned', steps: [], tags: [], log: {} },
      ],
    },
    ...overrides,
  })
  state.settings.protectedTime = [{ id: 'night', label: 'Sleep', start: '23:00', end: '06:00', days: [] }]
  state.schedule.days = {
    [TODAY]: [
      { id: 'b1', title: 'Deep work', time: '09:00', duration: 90, cat: null, priority: 'medium' },
      { id: 'b2', title: 'Sleep block', time: '22:00', duration: 60, kind: 'rest' },
      { id: 'hyb:h1', title: 'Evening revision', time: '18:00', duration: 60, hybPlanId: 'h1' },
    ],
  }
  return state
}

const entriesOn = (state, dayKey = TODAY, options = {}) => dayEntries(state, dayKey, { todayKey: TODAY, ...options })
const titles = (entries) => entries.map((entry) => entry.title)

/* ------------------------------------------------------------------ layers */

test('every layer starts on, and a damaged layer map is repaired', () => {
  assert.deepEqual(CAL_LAYER_IDS, ['blocks', 'missions', 'hyb', 'routines', 'deadlines', 'journal'])
  assert.deepEqual(defaultLayers(), { blocks: true, missions: true, hyb: true, routines: true, deadlines: true, journal: true })
  assert.deepEqual(normalizeLayers({ hyb: false }), { ...defaultLayers(), hyb: false })
  assert.deepEqual(normalizeLayers({ nonsense: true, blocks: 'yes', missions: 0 }), defaultLayers(), 'only real booleans are believed')
  assert.deepEqual(normalizeLayers(null), defaultLayers())
  assert.deepEqual(normalizeLayers('rubbish'), defaultLayers())
  // normalising twice changes nothing
  assert.deepEqual(normalizeLayers(normalizeLayers({ journal: false })), { ...defaultLayers(), journal: false })
})

/* ------------------------------------------------------------ month maths */

test('month titles, keys and bounds are read from any day in the month', () => {
  assert.equal(monthTitle('2026-09-15'), 'September 2026')
  assert.equal(monthTitle('2026-12-01'), 'December 2026')
  assert.equal(monthKeyOf('2026-09-15'), '2026-09')
  assert.equal(monthKeyOf('rubbish').length, 7, 'an unreadable key still gives a month')
  assert.deepEqual(monthBounds('2026-02-10'), { first: '2026-02-01', last: '2026-02-28' })
  assert.deepEqual(monthBounds('2024-02-10'), { first: '2024-02-01', last: '2024-02-29' }, 'a leap year is a leap year')
  assert.deepEqual(monthBounds('2026-12-25'), { first: '2026-12-01', last: '2026-12-31' })
})

test('moving by months clamps to a day that exists', () => {
  assert.equal(shiftMonth('2026-01-31', 1), '2026-02-28', 'January 31 has no February 31')
  assert.equal(shiftMonth('2026-03-31', -1), '2026-02-28')
  assert.equal(shiftMonth('2026-09-15', 1), '2026-10-15')
  assert.equal(shiftMonth('2026-09-15', -1), '2026-08-15')
  assert.equal(shiftMonth('2026-01-15', -1), '2025-12-15', 'the year rolls over backwards')
  assert.equal(shiftMonth('2026-12-15', 1), '2027-01-15', 'and forwards')
  assert.equal(shiftMonth('2026-09-15', 12), '2027-09-15')
  assert.equal(shiftMonth('2026-09-15', 0), '2026-09-15')
})

test('the month grid covers the whole month on the week the user starts on', () => {
  const matrix = monthMatrix('2026-09-15', { weekStart: 1, todayKey: TODAY })
  assert.equal(matrix.title, 'September 2026')
  assert.equal(matrix.monthKey, '2026-09')
  assert.equal(matrix.weeks.length, 5)
  assert.equal(matrix.days.length, 35)
  assert.equal(matrix.first, '2026-09-01')
  assert.equal(matrix.last, '2026-09-30')
  assert.equal(matrix.gridStart, '2026-08-31', 'the Monday before the first of the month')
  assert.equal(matrix.gridEnd, '2026-10-04')
  assert.equal(matrix.prev, '2026-08-15')
  assert.equal(matrix.next, '2026-10-15')
  assert.deepEqual(matrix.weekdayLabels, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
  assert.equal(matrix.weeks.every((week) => week.length === 7), true, 'every row is a full week')
  assert.equal(matrix.weeks.flat().filter((cell) => cell.inMonth).length, 30, 'all thirty days are inside the month')

  const cell = matrix.weeks.flat().find((day) => day.key === TODAY)
  assert.equal(cell.isToday, true)
  assert.equal(cell.isFuture, false)
  assert.equal(cell.isWeekend, false)
  assert.equal(cell.day, 15)
  assert.equal(cell.weekday, 2)
  assert.equal(cell.weekdayLabel, 'Tue')

  const saturday = matrix.weeks.flat().find((day) => day.key === '2026-09-19')
  assert.equal(saturday.isWeekend, true)
  assert.equal(matrix.weeks.flat().find((day) => day.key === '2026-09-30').isFuture, true)
  assert.equal(matrix.weeks.flat().find((day) => day.key === '2026-08-31').inMonth, false, 'the neighbour is dimmed, not hidden')

  // a month that needs six weeks gets six
  const august = monthMatrix('2026-08-10', { weekStart: 1, todayKey: TODAY })
  assert.equal(august.weeks.length, 6)
  assert.equal(august.days.length, 42)
  assert.equal(august.weeks.flat().filter((day) => day.inMonth).length, 31)

  // a Sunday week start moves the grid, not the month
  const sunday = monthMatrix('2026-09-15', { weekStart: 0, todayKey: TODAY })
  assert.equal(sunday.gridStart, '2026-08-30')
  assert.deepEqual(sunday.weekdayLabels, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
  assert.equal(sunday.weeks.flat().filter((day) => day.inMonth).length, 30)

  // February, and a grid that crosses a year boundary
  assert.equal(monthMatrix('2026-02-10', { weekStart: 1, todayKey: TODAY }).weeks.flat().filter((day) => day.inMonth).length, 28)
  assert.equal(monthMatrix('2026-12-10', { weekStart: 1, todayKey: TODAY }).gridEnd, '2027-01-03')

  // junk falls back to today rather than throwing
  assert.equal(monthMatrix('rubbish', { weekStart: 1 }).monthKey.length, 7)
  assert.equal(monthMatrix(null, { weekStart: 1 }).days.length >= 28, true)
})

test('the week strip is seven days around the anchor', () => {
  const week = weekCells(TODAY, { weekStart: 1, todayKey: TODAY })
  assert.equal(week.length, 7)
  assert.equal(week[0].key, '2026-09-14')
  assert.equal(week[1].key, TODAY)
  assert.equal(week[1].isToday, true)
  assert.equal(week[5].isWeekend, true)
  assert.equal(week.every((cell) => cell.inMonth === true), true, 'week mode never dims a day')
  assert.deepEqual(weekCells(TODAY, { weekStart: 0, todayKey: TODAY })[0].key, '2026-09-13')
  assert.equal(weekCells('rubbish', { weekStart: 1 }).length, 7)
})

/* ------------------------------------------------------------- one day */

test('a day is read in one order: the clock, then priority, then quiet markers', () => {
  const entries = entriesOn(calendarState())
  assert.deepEqual(titles(entries), [
    'Deep work', // 09:00 block
    'Timed mission', // 11:00, carried by the schedule
    'Evening revision', // 18:00 HYB plan, placed on the schedule
    'Untimed mission', // no clock, so it waits its turn
    'Morning start', // routine marker
    'Sleep block', // rest marker
    'Journal written', // journal marker
    'Sleep', // protected window marker
  ])
  assert.equal(entries.every((entry, index) => index === 0 || entries[index - 1].dotOnly <= entry.dotOnly), true, 'markers never jump the queue')

  const untimed = entries.slice(3, 4)
  assert.equal(untimed[0].source, 'mission')
  assert.equal(entries.find((entry) => entry.title === 'Inbox mission'), undefined, 'the inbox is not a day')
})

test('every source is described honestly, with its lane and its state', () => {
  const entries = entriesOn(calendarState())
  const bySource = (source) => entries.filter((entry) => entry.source === source)

  // a timed mission is carried by the schedule, so it arrives as a block too
  assert.deepEqual(bySource('block').map((entry) => entry.id), ['block:b1', 'block:task:t2', 'block:b2'])
  assert.equal(bySource('block')[1].refId, 't2', 'the row still points at the mission behind it')
  const deep = entries.find((entry) => entry.id === 'block:b1')
  assert.equal(deep.minutes, 90)
  assert.equal(deep.time, '09:00')
  assert.equal(deep.tone, 'normal')
  assert.equal(deep.meta, '90m')

  const rest = entries.find((entry) => entry.title === 'Sleep block')
  assert.equal(rest.dotOnly, true, 'rest is a marker, not a commitment')
  assert.equal(rest.minutes, 0)
  assert.equal(rest.tone, 'rest')

  const protectedEntry = bySource('protected')[0]
  assert.equal(protectedEntry.title, 'Sleep')
  assert.equal(protectedEntry.dotOnly, true)
  assert.equal(protectedEntry.tone, 'protected')

  const mission = bySource('mission')[0]
  assert.equal(mission.id, 'mission:t1')
  assert.equal(mission.refId, 't1', 'the row can open the real record')
  assert.equal(mission.minutes, 30)
  assert.equal(mission.meta, '30m')

  const hyb = bySource('hyb')[0]
  assert.equal(hyb.id, 'hyb:h1')
  assert.equal(hyb.refId, 'h1')
  assert.equal(hyb.kind, 'study', 'the lane drives the colour')
  assert.equal(hyb.energy, 'deep')
  assert.equal(hyb.tone, 'study')

  const routine = bySource('routine')[0]
  assert.equal(routine.done, true, 'both activities were checked off')
  assert.equal(routine.dotOnly, true)
  assert.equal(routine.meta, '2 activities')

  const journal = bySource('journal')[0]
  assert.equal(journal.done, true, 'a written day is a finished thing')
  assert.equal(journal.meta, 'good')
})

test('a HYB plan that is on the schedule is drawn once, at the placed time', () => {
  const entries = entriesOn(calendarState())
  const revisions = entries.filter((entry) => entry.title === 'Evening revision')
  assert.equal(revisions.length, 1, 'the block and the plan are the same thing')
  const [row] = revisions
  assert.equal(row.source, 'hyb', 'the HYB layer owns it, so it keeps its lane colour')
  assert.equal(row.time, '18:00', 'the time it was actually placed, not the plan default')
  assert.equal(row.minutes, 60, 'the placed duration wins — dragging the block is respected')
  assert.equal(row.scheduled, true)
  assert.equal(row.meta, '60m · on the schedule')

  // turning the HYB layer off leaves the block on the timeline
  const withoutHyb = entriesOn(calendarState(), TODAY, { layers: { ...defaultLayers(), hyb: false } })
  const asBlock = withoutHyb.filter((entry) => entry.title === 'Evening revision')
  assert.equal(asBlock.length, 1)
  assert.equal(asBlock[0].source, 'block')
  assert.equal(asBlock[0].time, '18:00')

  // an unscheduled plan keeps its own time and is not marked as placed
  const unscheduled = calendarState({ hyb: { plans: [{ id: 'h2', title: 'Read one chapter', date: TODAY, startTime: '20:00', minutes: 30, kind: 'personal', priority: 'low', energy: 'light', repeat: 'none', status: 'planned', steps: [], tags: [], log: {} }] } })
  unscheduled.schedule.days[TODAY] = unscheduled.schedule.days[TODAY].filter((block) => block.id !== 'hyb:h1')
  const read = entriesOn(unscheduled).find((entry) => entry.title === 'Read one chapter')
  assert.equal(read.time, '20:00')
  assert.equal(read.minutes, 30)
  assert.equal(read.scheduled, false)
  assert.equal(read.meta, '30m')
})

test('deadlines arrive from missions, goals and projects', () => {
  const entries = entriesOn(calendarState(), '2026-09-20')
  const deadlines = entries.filter((entry) => entry.source === 'deadline')
  assert.deepEqual(deadlines.map((entry) => entry.title), ['Deadline · Deadline mission', 'Goal · Goal with a target', 'Project · Project with a target'])
  assert.equal(deadlines.every((entry) => entry.dotOnly), true, 'a deadline is a marker, not work to time')
  assert.equal(deadlines.every((entry) => entry.minutes === 0), true)
  assert.equal(deadlines[0].refId, 't5')
  assert.equal(deadlines[1].refId, 'g1')
  assert.equal(deadlines[2].refId, 'p1')
  assert.equal(entriesOn(calendarState(), '2026-09-19').filter((entry) => entry.source === 'deadline').length, 0, 'only on the day itself')
})

test('a repeating HYB plan shows on the days it belongs to', () => {
  const state = calendarState({
    hyb: {
      plans: [
        { id: 'daily', title: 'Twenty minutes', date: '2026-09-10', minutes: 20, kind: 'study', priority: 'medium', energy: 'steady', repeat: 'daily', status: 'planned', steps: [], tags: [], log: { [TODAY]: 'done' } },
        { id: 'weekly', title: 'Long run', date: '2026-09-15', minutes: 60, kind: 'body', priority: 'medium', energy: 'steady', repeat: 'weekly', status: 'planned', steps: [], tags: [], log: {} },
        { id: 'dropped', title: 'Dropped idea', date: TODAY, minutes: 30, kind: 'idea', priority: 'low', energy: 'light', repeat: 'none', status: 'dropped', steps: [], tags: [], log: {} },
      ],
    },
  })
  const today = entriesOn(state).filter((entry) => entry.source === 'hyb')
  assert.deepEqual(today.map((entry) => entry.title).sort(), ['Long run', 'Twenty minutes'])
  assert.equal(today.find((entry) => entry.title === 'Twenty minutes').done, true, 'the log for that day is read')
  assert.equal(entriesOn(state, '2026-09-16').filter((entry) => entry.title === 'Long run').length, 0, 'a weekly plan is not on Wednesday')
  assert.equal(entriesOn(state, '2026-09-22').filter((entry) => entry.title === 'Long run').length, 1, 'but it is on the next Tuesday')
  assert.equal(entriesOn(state, '2026-09-09').filter((entry) => entry.title === 'Twenty minutes').length, 0, 'nothing before the start date')
})

test('layers turn sources off without touching the data', () => {
  const state = calendarState()
  const all = entriesOn(state)
  const none = entriesOn(state, TODAY, { layers: { blocks: false, missions: false, hyb: false, routines: false, deadlines: false, journal: false } })
  assert.equal(all.length, 8)
  assert.equal(none.length, 0)

  for (const id of CAL_LAYER_IDS) {
    // judge each layer on a day where it has something to hide
    const day = id === 'deadlines' ? '2026-09-20' : TODAY
    const layers = { ...defaultLayers(), [id]: false }
    const baseline = entriesOn(state, day)
    const filtered = entriesOn(state, day, { layers })
    const gone = id === 'blocks' ? ['block', 'protected'] : [id]
    assert.equal(filtered.some((entry) => gone.includes(entry.source)), false, `${id} is really gone`)
    if (id === 'hyb') assert.equal(filtered.length, baseline.length, 'a scheduled HYB plan stays on the timeline as a time block')
    else assert.equal(filtered.length < baseline.length, true, `turning ${id} off removes something`)
  }
  assert.deepEqual(titles(entriesOn(state, TODAY, { layers: { blocks: false, missions: false, hyb: true, routines: false, deadlines: false, journal: false } })), ['Evening revision'])
  assert.equal(entriesOn(state, TODAY, { layers: normalizeLayers({ journal: false }) }).some((entry) => entry.source === 'journal'), false)
})

test('an overdue day is marked, and a future day is not', () => {
  const state = calendarState()
  const overdue = entriesOn(state, '2026-09-10').find((entry) => entry.title === 'Overdue mission')
  assert.equal(overdue.tone, 'overdue')
  assert.equal(daySummary(state, '2026-09-10', { todayKey: TODAY }).isFuture, false)
  assert.equal(daySummary(state, '2026-09-20', { todayKey: TODAY }).isFuture, true)
  assert.equal(daySummary(state, TODAY, { todayKey: TODAY }).isToday, true)
  assert.equal(entriesOn(state, '2026-09-20').some((entry) => entry.tone === 'overdue'), false, 'the future is never overdue')
})

test('a bad day key falls back to today instead of returning nothing', () => {
  const state = calendarState()
  assert.equal(entriesOn(state, 'rubbish').length, entriesOn(state, TODAY).length)
  assert.equal(entriesOn(state, null).length, entriesOn(state, TODAY).length)
  assert.equal(daySummary(state, 'rubbish', { todayKey: TODAY }).date, TODAY)
})

/* ------------------------------------------------------------- summaries */

test('a day adds up its minutes, its load and its flags', () => {
  const summary = daySummary(calendarState(), TODAY, { todayKey: TODAY })
  assert.equal(summary.date, TODAY)
  assert.equal(summary.count, 8, 'everything that is on the day')
  assert.equal(summary.visibleCount, 4, 'but only the work you can time')
  assert.equal(summary.minutes, 240, '90 + 60 + 60 + 30')
  assert.equal(summary.openMinutes, 240)
  assert.equal(summary.doneCount, 0)
  assert.equal(summary.openCount, 4)
  assert.equal(summary.loadPct, 44, '240 of the 540-minute working day')
  assert.equal(summary.load, 'balanced')
  assert.deepEqual(summary.lanes, ['study'])
  assert.equal(summary.hasJournal, true)
  assert.equal(summary.hasHyb, true)
  assert.equal(summary.hasDeadline, false)
  assert.equal(summary.hasProtected, true)
  assert.equal(summary.conflicts, 0)

  // finished work stops asking for time, but still happened
  const done = calendarState()
  done.hyb.plans[0].status = 'done'
  const afterFinishing = daySummary(done, TODAY, { todayKey: TODAY })
  assert.equal(afterFinishing.doneCount, 1)
  assert.equal(afterFinishing.openMinutes, 180)
  assert.equal(afterFinishing.minutes, 240, 'the day still shows what it held')

  // an empty day is quiet, not broken
  const empty = daySummary(baseState(), '2026-11-11', { todayKey: TODAY })
  assert.equal(empty.count, 0)
  assert.equal(empty.minutes, 0)
  assert.equal(empty.loadPct, 0)
  assert.deepEqual(empty.lanes, [])
  assert.equal(empty.hasHyb, false)

  // a custom capacity changes the percentage, not the minutes
  assert.equal(daySummary(calendarState(), TODAY, { todayKey: TODAY, capacity: 240 }).loadPct, 100)
})

test('two things at the same time are counted as a clash', () => {
  const state = calendarState()
  state.schedule.days[TODAY] = [
    { id: 'b1', title: 'Deep work', time: '09:00', duration: 90 },
    { id: 'b2', title: 'Interview', time: '09:30', duration: 60 },
  ]
  const summary = daySummary(state, TODAY, { todayKey: TODAY })
  assert.equal(summary.conflicts, 1)
  assert.equal(['full', 'over', 'conflict'].includes(summary.load), true, 'a clashing day reads as heavy')

  // back-to-back is not a clash
  state.schedule.days[TODAY] = [
    { id: 'b1', title: 'Deep work', time: '09:00', duration: 60 },
    { id: 'b2', title: 'Interview', time: '10:00', duration: 60 },
  ]
  assert.equal(daySummary(state, TODAY, { todayKey: TODAY }).conflicts, 0)

  // an untimed day cannot clash
  state.schedule.days = {}
  assert.equal(daySummary(calendarState(), '2026-09-20', { todayKey: TODAY }).conflicts, 0)
})

/* ---------------------------------------------------------------- months */

test('a month is summarised cell by cell, and only the days inside it count', () => {
  const state = calendarState()
  const matrix = monthMatrix(TODAY, { weekStart: 1, todayKey: TODAY })
  const overview = monthOverview(state, matrix, { todayKey: TODAY })
  assert.equal(overview instanceof Map, true)
  assert.equal(overview.size, 35, 'one summary per grid cell, neighbours included')
  assert.equal(overview.get(TODAY).minutes, 240)
  // the neighbour cells are real days, they just hold none of this month's work
  assert.equal(overview.get('2026-08-31').visibleCount, 0)
  assert.equal(overview.get('2026-08-31').minutes, 0)
  assert.equal(overview.get('2026-08-31').hasHyb, false)
  assert.equal(overview.get('2026-09-20').hasDeadline, true)

  const stats = monthStats(state, matrix, overview)
  assert.equal(stats.monthKey, '2026-09')
  assert.equal(stats.title, 'September 2026')
  assert.equal(stats.days, 30, 'the two neighbour cells are not part of the month')
  assert.equal(stats.minutes, 260, 'today plus the overdue day')
  assert.equal(stats.hours, 4.3)
  assert.equal(stats.committedDays, 2)
  assert.equal(stats.quietDays, 28)
  assert.equal(stats.journalDays, 1)
  assert.equal(stats.hybDays, 1)
  assert.equal(stats.deadlineCount, 3, 'a mission, a goal and a project all land on the 20th')
  assert.equal(stats.busiestDate, TODAY)
  assert.equal(stats.busiestMinutes, 240)
  assert.equal(stats.averageMinutes, 130, 'averaged over the days that have something on them')

  // an empty month is still a month
  const empty = monthStats(baseState(), matrix, monthOverview(baseState(), matrix, { todayKey: TODAY }))
  assert.equal(empty.minutes, 0)
  assert.equal(empty.committedDays, 0)
  assert.equal(empty.quietDays, 30)
  assert.equal(empty.averageMinutes, 0, 'no dividing by zero')
  assert.equal(empty.busiestDate, null)
  assert.equal(empty.busiestMinutes, 0)
})

test('agenda mode lists a run of days, capped at a readable span', () => {
  const state = calendarState()
  const rows = agendaDays(state, '2026-09-18', 3, { todayKey: TODAY })
  assert.deepEqual(rows.map((row) => row.date), ['2026-09-18', '2026-09-19', '2026-09-20'])
  assert.equal(rows[2].hasDeadline, true, 'each row carries the full day summary')
  assert.equal(rows[0].visibleCount, 0, 'a quiet day still gets a row')
  assert.equal(rows[0].minutes, 0)
  assert.equal(rows.every((row) => typeof row.minutes === 'number'), true)

  assert.equal(agendaDays(state, TODAY, 999, { todayKey: TODAY }).length, 120, 'the span is capped')
  assert.equal(agendaDays(state, TODAY, -5, { todayKey: TODAY }).length, 1, 'and floored')
  assert.equal(agendaDays(state, TODAY, undefined, { todayKey: TODAY }).length, 30, 'a month is the default')
})
