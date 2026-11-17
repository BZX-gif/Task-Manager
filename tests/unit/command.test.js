import test from 'node:test'
import assert from 'node:assert/strict'
import {
  capacityMinutes,
  commandIndex,
  commandLine,
  headline,
  healthSignals,
  indexVerdict,
  loadPlan,
  nextActions,
  trendOf,
  weekdayRhythm,
  workspaceDigest,
} from '../../src/client/lib/command.js'
import { buildBriefing, briefingSpeech } from '../../src/client/lib/briefing.js'
import { baseState, task } from '../helpers/fixtures.js'

const DAY = '2026-09-15'

/** A state with a bank account so the stewardship pillar is measurable. */
function withMoney(state, overrides = {}) {
  return {
    ...state,
    ledger: {
      accounts: [{ id: 'a1', name: 'Bank', kind: 'bank', openingBalance: 100000, institution: '', archived: false, createdAt: 1 }],
      transactions: [
        { id: 't1', kind: 'income', date: `${DAY.slice(0, 7)}-01`, amount: 100000, accountId: 'a1', toAccountId: null, categoryId: null, note: 'Salary', tags: [], cleared: true, createdAt: 1 },
        { id: 't2', kind: 'expense', date: `${DAY.slice(0, 7)}-03`, amount: 40000, accountId: 'a1', toAccountId: null, categoryId: 'life', note: 'Rent', tags: [], cleared: true, createdAt: 2 },
      ],
      budgets: [{ categoryId: 'life', limit: 50000, rollover: false }],
      recurring: [],
      notes: [],
      ...overrides,
    },
  }
}

function quietState(overrides = {}) {
  return baseState({ tasks: [], schedule: { days: {}, history: [] }, ...overrides })
}

test('capacity comes from the configured working hours, never from a guess', () => {
  assert.equal(capacityMinutes({ workingHours: { start: '09:00', end: '18:00' } }), 540)
  assert.equal(capacityMinutes({ workingHours: { start: '06:30', end: '10:00' } }), 210)
  assert.equal(capacityMinutes({}), 540, 'defaults are safe')
  assert.equal(capacityMinutes({ workingHours: { start: '18:00', end: '09:00' } }), 60, 'an inverted window never becomes negative')
})

test('the load plan shows committed, unplaced and free time for each day', () => {
  const state = quietState({
    tasks: [task('t1', { date: DAY, estimateMinutes: 120, time: '09:00' })],
    schedule: { days: { [DAY]: [{ id: 'b1', taskId: 't1', title: 'Deep work', time: '09:00', duration: 120, days: [], protected: false, flexible: true, priority: 'medium', kind: 'mission', status: 'planned' }] }, history: [] },
  })
  const plan = loadPlan(state, { todayKey: DAY, now: new Date(`${DAY}T08:00:00`), days: 3 })
  assert.equal(plan.rows.length, 3)
  assert.equal(plan.rows[0].committedMinutes, 120)
  assert.equal(plan.rows[0].status, 'light')
  assert.equal(plan.rows[1].status, 'empty')
  assert.equal(plan.capacity, 540)
  assert.equal(plan.emptyDays, 2)
  assert.equal(plan.freeMinutes, 540 * 3 - 120)
})

test('an over-committed week is flagged instead of being quietly squeezed', () => {
  const blocks = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00'].map((time, index) => ({
    id: `b${index}`,
    title: `Block ${index}`,
    time,
    duration: 90,
    days: [],
    protected: false,
    flexible: true,
    priority: 'medium',
    kind: 'mission',
    status: 'planned',
  }))
  const state = quietState({ schedule: { days: { [DAY]: blocks }, history: [] } })
  // seven overlapping 90-minute blocks in a nine-hour day
  const plan = loadPlan(state, { todayKey: DAY, now: new Date(`${DAY}T07:00:00`), days: 1 })
  assert.equal(plan.rows[0].status, 'conflict')
  assert.equal(plan.rows[0].conflicts > 0, true)
  assert.equal(plan.overcommitted, 1)
})

test('the headline is deterministic and ordered by consequence', () => {
  const conflictState = quietState({
    schedule: {
      days: {
        [DAY]: [
          { id: 'b1', title: 'A', time: '09:00', duration: 60, days: [], protected: false, flexible: true, priority: 'medium', kind: 'mission', status: 'planned' },
          { id: 'b2', title: 'B', time: '09:30', duration: 60, days: [], protected: false, flexible: true, priority: 'medium', kind: 'mission', status: 'planned' },
        ],
      },
      history: [],
    },
  })
  const now = new Date(`${DAY}T08:00:00`)
  const first = headline(conflictState, { todayKey: DAY, now })
  assert.equal(first.key, 'conflict')
  assert.equal(first.view, 'schedule')
  assert.deepEqual(first, headline(conflictState, { todayKey: DAY, now }), 'the same records always give the same answer')

  const overdueState = quietState({ tasks: [task('t1', { date: '2026-09-10', priority: 'high' })] })
  assert.equal(headline(overdueState, { todayKey: DAY, now }).key, 'overdue')

  const runningState = quietState({
    schedule: { days: { [DAY]: [{ id: 'b1', title: 'Deep study', time: '08:00', duration: 120, days: [], protected: false, flexible: true, priority: 'high', kind: 'mission', status: 'planned' }] }, history: [] },
  })
  const running = headline(runningState, { todayKey: DAY, now: new Date(`${DAY}T08:30:00`) })
  assert.equal(running.key, 'running')
  assert.equal(running.title, 'Deep study')

  const emptyState = quietState()
  const empty = headline(emptyState, { todayKey: DAY, now: new Date(`${DAY}T10:00:00`) })
  assert.equal(empty.key, 'open')
  assert.equal(empty.tone, 'good')
})

test('the headline never invents work on a workspace with nothing in it', () => {
  const head = headline(quietState(), { todayKey: DAY, now: new Date(`${DAY}T09:00:00`) })
  assert.ok(['open', 'steadys', 'reflect'].includes(head.key))
  assert.equal(/overdue|cannot physically fit/.test(head.title), false)
})

test('health signals carry their real values, targets and destination', () => {
  const state = withMoney(
    quietState({
      tasks: [task('t1', { date: DAY, done: true }), task('t2', { date: DAY })],
      top3: { [DAY]: ['t1'] },
      completionLog: { [DAY]: { ttDone: [], taskDone: ['t1'] } },
    }),
  )
  const signals = healthSignals(state, { todayKey: DAY, now: new Date(`${DAY}T12:00:00`) })
  assert.equal(signals.length, 7)
  const priorities = signals.find((signal) => signal.key === 'priorities')
  assert.equal(priorities.display, '1/1')
  assert.equal(priorities.good, true)
  assert.equal(priorities.view, 'day')
  const money = signals.find((signal) => signal.key === 'money')
  assert.equal(money.display, '60%', '60000 kept of 100000 earned')
  assert.equal(signals.every((signal) => typeof signal.view === 'string'), true, 'every signal is actionable')
})

test('the command index excludes pillars with no data and redistributes honestly', () => {
  const empty = commandIndex(quietState(), { todayKey: DAY, now: new Date(`${DAY}T12:00:00`) })
  assert.equal(empty.index, null)
  assert.equal(empty.pillars.filter((pillar) => pillar.available).length, 0)

  const focusOnly = quietState({
    focus: {
      active: null,
      sessions: [{ id: 's1', taskId: null, categoryId: null, mode: 'focus', goalId: null, plannedMinutes: 60, focusedSeconds: 7200, startedAt: 1, endedAt: 2, status: 'completed', date: DAY, taskTitle: null }],
    },
  })
  const index = commandIndex(focusOnly, { todayKey: DAY, now: new Date(`${DAY}T12:00:00`) })
  assert.ok(index.index != null, 'one measured pillar still yields an index')
  assert.equal(index.pillars.find((pillar) => pillar.key === 'focus').available, true)
  assert.equal(index.pillars.find((pillar) => pillar.key === 'stewardship').available, false)
})

test('index verdicts stay honest at both ends of the scale', () => {
  assert.match(indexVerdict(null), /once there is something real/i)
  assert.match(indexVerdict(95), /unusually strong/i)
  assert.match(indexVerdict(10), /one honest day/i)
  assert.equal(indexVerdict(70), 'Working, and it shows. Keep the boring parts.')
})

test('next actions are capped, unique and each points somewhere useful', () => {
  const state = withMoney(
    quietState({
      tasks: [task('t1', { date: '2026-09-01' }), task('t2', { date: DAY }), task('t3', { inbox: true, date: null })],
      ledger: undefined,
    }),
  )
  const actions = nextActions(withMoney(state), { todayKey: DAY, now: new Date(`${DAY}T12:00:00`) })
  assert.ok(actions.length <= 4)
  assert.equal(new Set(actions.map((action) => action.key)).size, actions.length, 'no duplicates')
  assert.equal(actions.every((action) => typeof action.view === 'string' && action.label), true)
})

test('the weekday rhythm reports real strongest and hardest days', () => {
  const state = quietState({
    tasks: [
      task('a', { date: '2026-09-07', done: true }), // Monday
      task('b', { date: '2026-09-08', done: false }), // Tuesday
    ],
    completionLog: { '2026-09-07': { ttDone: [], taskDone: ['a'] } },
  })
  const rhythm = weekdayRhythm(state, { todayKey: DAY, now: new Date(`${DAY}T12:00:00`) })
  assert.equal(rhythm.days.length, 7)
  assert.ok(rhythm.measured >= 2)
  assert.equal(rhythm.best.weekday, 1, 'Monday scored higher than Tuesday')
  assert.equal(rhythm.days[1].label, 'Mon')
})

test('trend compares the two halves of a series without pretending certainty', () => {
  assert.equal(trendOf([10, 10]), null, 'too short to mean anything')
  const up = trendOf([10, 10, 10, 40, 40, 40])
  assert.equal(up.direction, 'up')
  assert.equal(up.delta, 30)
  const flat = trendOf([20, 22, 18, 20, 21, 19])
  assert.equal(flat.direction, 'flat')
  const down = trendOf([50, 50, 50, 20, 20, 20])
  assert.equal(down.direction, 'down')
})

test('the workspace digest is compact, accurate and free of private detail', () => {
  const state = withMoney(quietState({ tasks: [task('t1', { date: DAY }), task('t2', { date: '2026-09-01' })] }))
  const digest = workspaceDigest(state, { todayKey: DAY, now: new Date(`${DAY}T12:00:00`) })
  assert.equal(digest.todayKey, DAY)
  assert.equal(digest.openTasks, 2)
  assert.equal(digest.overdue, 1)
  assert.equal(digest.money.income, 100000)
  assert.equal(digest.money.expense, 40000)
  const text = JSON.stringify(digest)
  assert.equal(/account|HDFC|Ravi|note/i.test(text), false, 'no account names or private notes leak into the digest')
})

test('the command line summarises the day in one honest sentence', () => {
  const state = quietState({ tasks: [task('t1', { date: DAY })] })
  assert.match(commandLine(state, { todayKey: DAY, now: new Date(`${DAY}T09:00:00`) }), /1 open today/)
  assert.match(commandLine(quietState(), { todayKey: DAY, now: new Date(`${DAY}T09:00:00`) }), /Nothing is late/)
})

test('the briefing gains the week load without changing its existing shape', () => {
  const state = quietState({ tasks: [task('t1', { date: DAY })] })
  const briefing = buildBriefing(state, { now: new Date(`${DAY}T09:00:00`), todayKey: DAY })
  assert.ok(briefing.load, 'the week load is attached')
  assert.equal(typeof briefing.load.share, 'number')
  assert.equal(typeof briefing.load.overcommitted, 'number')
  assert.match(briefingSpeech({ ...briefing, load: { share: 140, overcommitted: 2, freeMinutes: 0 } }), /over capacity/)
  // back-compat: a briefing built without a load still speaks cleanly
  assert.equal(/undefined/.test(briefingSpeech({ ...briefing, load: null })), false)
})
