import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyState } from '../../src/client/lib/state.js'
import { buildForecast, capacityMinutesOf, commitmentBlocks, findConflicts, forecastAdvice, loadStatus, busyShare } from '../../src/client/lib/forecast.js'
import { addDays } from '../../src/client/lib/dates.js'

const TODAY = '2026-11-16'

function block(overrides = {}) {
  return {
    id: overrides.id || `b${Math.random().toString(36).slice(2, 7)}`,
    time: '09:00',
    duration: 60,
    title: 'Deep work',
    cat: 'work',
    kind: 'mission',
    status: 'planned',
    ...overrides,
  }
}

function stateWith(days = {}) {
  const state = emptyState()
  state.categories = [
    { id: 'work', name: 'Work', color: '#111111' },
    { id: 'study', name: 'Study', color: '#222222' },
  ]
  for (const [key, blocks] of Object.entries(days)) state.schedule.days[key] = blocks
  return state
}

test('an empty workspace forecasts an honest empty window', () => {
  const forecast = buildForecast(stateWith(), { todayKey: TODAY })
  assert.equal(forecast.empty, true)
  assert.equal(forecast.days.length, 14)
  assert.equal(forecast.days[0].key, TODAY)
  assert.equal(forecast.days[0].isToday, true)
  assert.equal(forecast.totalPlanned, 0)
  assert.equal(forecast.capacityMinutes, 540, 'default 09:00–18:00 working day')
  assert.match(forecastAdvice(forecast).title, /Nothing is committed/)
})

test('commitments add up per day and are classified by load', () => {
  const forecast = buildForecast(
    stateWith({
      [TODAY]: [block({ time: '09:00', duration: 120 }), block({ time: '11:00', duration: 60 })],
      '2026-11-17': [block({ time: '09:00', duration: 60 })],
    }),
    { todayKey: TODAY },
  )
  assert.equal(forecast.days[0].plannedMinutes, 180)
  assert.equal(forecast.days[0].blockCount, 2)
  assert.equal(forecast.days[0].status, 'light')
  assert.equal(forecast.days[1].plannedMinutes, 60)
  assert.equal(forecast.totalPlanned, 240)
  assert.equal(forecast.peak.key, TODAY)
  assert.ok(forecast.averagePlanned > 0)
})

test('sleep and protected windows are not commitments', () => {
  const state = stateWith({
    [TODAY]: [
      block({ time: '09:00', title: 'Study', duration: 60 }),
      block({ time: '23:00', title: 'SLEEP — non-negotiable', duration: 360, cat: 'body' }),
      block({ time: '18:00', title: 'Family time', duration: 60, kind: 'protected' }),
    ],
  })
  const blocks = commitmentBlocks(state, TODAY)
  assert.equal(blocks.length, 1)
  assert.equal(buildForecast(state, { todayKey: TODAY }).days[0].plannedMinutes, 60)
})

test('overlapping blocks are reported as clashes', () => {
  const state = stateWith({
    [TODAY]: [block({ time: '09:00', duration: 90 }), block({ time: '10:00', duration: 60 }), block({ time: '12:00', duration: 30 })],
  })
  const conflicts = findConflicts(commitmentBlocks(state, TODAY))
  assert.equal(conflicts.length, 1)
  assert.equal(conflicts[0].minutes, 30)
  const forecast = buildForecast(state, { todayKey: TODAY })
  assert.equal(forecast.days[0].status, 'conflict')
  assert.equal(forecast.totalConflicts, 1)
  assert.match(forecastAdvice(forecast).title, /clash/)
})

test('overdue open missions are carried forward', () => {
  const state = stateWith()
  state.tasks = [
    { id: 't1', title: 'Old essay', date: '2026-11-10', done: false, status: 'ready', estimateMinutes: 45, priority: 'high', inbox: false },
    { id: 't2', title: 'Done already', date: '2026-11-09', done: true, status: 'completed', estimateMinutes: 30, priority: 'low', inbox: false },
    { id: 't3', title: 'Future mission', date: '2026-11-20', done: false, status: 'ready', estimateMinutes: 30, priority: 'medium', inbox: false },
  ]
  const forecast = buildForecast(state, { todayKey: TODAY })
  assert.equal(forecast.carriedCount, 1)
  assert.equal(forecast.carried[0].id, 't1')
  assert.equal(forecast.overdueMinutes, 45)
  assert.match(forecastAdvice(forecast).title, /carried over/)
})

test('category balance adds up over the horizon', () => {
  const forecast = buildForecast(
    stateWith({
      [TODAY]: [block({ time: '09:00', duration: 120, cat: 'work' })],
      '2026-11-18': [block({ time: '09:00', duration: 60, cat: 'study' })],
    }),
    { todayKey: TODAY },
  )
  assert.equal(forecast.balance.length, 2)
  assert.equal(forecast.balance[0].categoryId, 'work')
  assert.equal(forecast.balance[0].minutes, 120)
  assert.equal(forecast.balance[0].share, 67)
  assert.equal(forecast.balance[1].name, 'Study')
})

test('a healthy window reads as encouragement', () => {
  const forecast = buildForecast(stateWith({ [TODAY]: [block({ duration: 60 })] }), { todayKey: TODAY })
  const advice = forecastAdvice(forecast)
  assert.equal(advice.tone, 'good')
  assert.match(advice.title, /room in them/)
})

test('capacity falls back when working hours are unusable', () => {
  const state = stateWith()
  state.settings.workingHours = { start: '18:00', end: '09:00' }
  assert.equal(capacityMinutesOf(state), 480)
  state.settings.workingHours = { start: '06:00', end: '22:00' }
  assert.equal(capacityMinutesOf(state), 480, 'a 16-hour "working day" is not a useful capacity — use the default')
})

test('load status thresholds are stable', () => {
  assert.equal(loadStatus(10), 'light')
  assert.equal(loadStatus(50), 'balanced')
  assert.equal(loadStatus(80), 'full')
  assert.equal(loadStatus(99), 'over')
  assert.equal(loadStatus(10, 1), 'conflict')
})

test('busy share reports overloaded and clashing days', () => {
  const forecast = buildForecast(stateWith({ [TODAY]: [block({ duration: 520 })] }), { todayKey: TODAY })
  assert.equal(busyShare(forecast), 7)
})

/* ------------------------------------------------------- HYB plans (4.4) */

function hybPlan(overrides = {}) {
  return {
    id: overrides.id || 'h1',
    title: 'Evening revision',
    date: TODAY,
    startTime: '18:00',
    minutes: 60,
    kind: 'study',
    priority: 'medium',
    energy: 'steady',
    repeat: 'none',
    status: 'planned',
    steps: [],
    tags: [],
    log: {},
    ...overrides,
  }
}

test('open HYB plans are reported per day and across the window', () => {
  const state = stateWith()
  state.hyb.plans = [hybPlan({ id: 'h1', minutes: 60 }), hybPlan({ id: 'h2', date: addDays(TODAY, 2), minutes: 90, kind: 'body' })]
  const forecast = buildForecast(state, { todayKey: TODAY, days: 7 })

  assert.equal(forecast.days[0].hybCount, 1)
  assert.equal(forecast.days[0].hybMinutes, 60)
  assert.equal(forecast.days[2].hybMinutes, 90)
  assert.equal(forecast.days[1].hybCount, 0)
  assert.equal(forecast.totalHybCount, 2)
  assert.equal(forecast.totalHybMinutes, 150)
  assert.equal(forecast.totalPlanned, 0, 'a plan that is not on the schedule is not committed time')
})

test('a HYB plan already on the schedule is never counted twice', () => {
  const state = stateWith({ [TODAY]: [{ ...block({ id: 'hyb:h1', duration: 60 }), hybPlanId: 'h1' }] })
  state.hyb.plans = [hybPlan({ id: 'h1', minutes: 60 })]
  const forecast = buildForecast(state, { todayKey: TODAY })
  assert.equal(forecast.days[0].hybCount, 0, 'the block already carries it')
  assert.equal(forecast.days[0].hybMinutes, 0)
  assert.equal(forecast.days[0].plannedMinutes, 60, 'and its minutes are counted once, as a block')
  assert.equal(forecast.totalHybCount, 0)
})

test('finished, skipped and dropped HYB days ask for no time', () => {
  const state = stateWith()
  state.hyb.plans = [
    hybPlan({ id: 'done', status: 'done' }),
    hybPlan({ id: 'daily', repeat: 'daily', date: addDays(TODAY, -4), log: { [TODAY]: 'skipped' } }),
    hybPlan({ id: 'dropped', status: 'dropped' }),
    hybPlan({ id: 'open', minutes: 25 }),
  ]
  const forecast = buildForecast(state, { todayKey: TODAY })
  assert.equal(forecast.days[0].hybCount, 1)
  assert.equal(forecast.days[0].hybMinutes, 25)
})

test('a repeating HYB plan reaches every day it belongs to', () => {
  const state = stateWith()
  state.hyb.plans = [hybPlan({ id: 'daily', repeat: 'daily', date: addDays(TODAY, -1), minutes: 20 })]
  const forecast = buildForecast(state, { todayKey: TODAY, days: 7 })
  assert.equal(forecast.days.every((row) => row.hybMinutes === 20), true)
  assert.equal(forecast.totalHybMinutes, 140)
})

test('HYB plans alone are enough to make the forecast meaningful', () => {
  const state = stateWith()
  state.hyb.plans = [hybPlan({ minutes: 45 })]
  const forecast = buildForecast(state, { todayKey: TODAY })
  assert.equal(forecast.empty, false, 'a workspace with only HYB plans is not empty')
  const advice = forecastAdvice(forecast)
  assert.equal(advice.tone, 'neutral')
  assert.match(advice.title, /45m of HYB plans have no place/)
  assert.match(advice.body, /HYB deck/)
})

test('clashes, heavy days and carried missions still outrank the HYB nudge', () => {
  const clash = stateWith({ [TODAY]: [block({ id: 'a', time: '09:00', duration: 90 }), block({ id: 'b', time: '09:30', duration: 60 })] })
  clash.hyb.plans = [hybPlan()]
  assert.equal(forecastAdvice(buildForecast(clash, { todayKey: TODAY })).tone, 'warn')

  const carried = stateWith()
  carried.hyb.plans = [hybPlan()]
  carried.tasks = [{ id: 't1', title: 'Old work', date: addDays(TODAY, -3), done: false, status: 'ready', inbox: false, estimateMinutes: 30 }]
  const carriedAdvice = forecastAdvice(buildForecast(carried, { todayKey: TODAY }))
  assert.match(carriedAdvice.title, /carried over/)

  const placed = stateWith({ [TODAY]: [{ ...block({ id: 'hyb:h1', duration: 60 }), hybPlanId: 'h1' }] })
  placed.hyb.plans = [hybPlan({ id: 'h1' })]
  assert.equal(forecastAdvice(buildForecast(placed, { todayKey: TODAY })).tone, 'good', 'once plans are placed, nothing is nagging')
})
