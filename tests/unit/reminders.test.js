import test from 'node:test'
import assert from 'node:assert/strict'
import { computeDueReminders, pruneSentLog, reminderSummary } from '../../src/client/lib/reminders.js'
import { baseState, task } from '../helpers/fixtures.js'

const TODAY = '2026-09-15'

function stateWith(overrides = {}) {
  return baseState({
    timetable: [
      { id: 'b1', time: '10:00', title: 'Geography class', duration: 60, cat: 'upsc' },
      { id: 'b2', time: '14:00', title: 'Revision', duration: 60, cat: 'ssc' },
    ],
    tasks: [],
    ...overrides,
  })
}

test('a timetable block starting soon triggers a reminder', () => {
  const due = computeDueReminders({ state: stateWith(), todayKey: TODAY, nowMinutes: 9 * 60 + 55 })
  assert.equal(due.length, 1)
  assert.equal(due[0].kind, 'timetable')
  assert.match(due[0].title, /Starting in 5 min/)
  assert.equal(due[0].body, 'Geography class')
  assert.equal(due[0].key, `block:b1:${TODAY}:10`)
})

test('completed blocks and distant blocks stay quiet', () => {
  const done = stateWith({ completionLog: { [TODAY]: { ttDone: ['b1'], taskDone: [] } } })
  assert.equal(computeDueReminders({ state: done, todayKey: TODAY, nowMinutes: 9 * 60 + 55 }).length, 0)
  assert.equal(computeDueReminders({ state: stateWith(), todayKey: TODAY, nowMinutes: 8 * 60 }).length, 0)
})

test('timed tasks remind before and at their start time', () => {
  const state = stateWith({ tasks: [task('t1', { title: 'Mock test', time: '11:00' })] })
  const before = computeDueReminders({ state, todayKey: TODAY, nowMinutes: 10 * 60 + 55 })
  assert.ok(before.some((r) => r.kind === 'task' && /Task in 5 min/.test(r.title)))

  const now = computeDueReminders({ state, todayKey: TODAY, nowMinutes: 11 * 60 + 5 })
  assert.ok(now.some((r) => r.key === `task-duenow:t1:${TODAY}`))
})

test('overdue tasks produce one summary per day', () => {
  const state = stateWith({
    tasks: [
      task('a', { date: '2026-09-10', title: 'Late thing' }),
      task('b', { date: '2026-09-11', title: 'Also late' }),
      task('c', { date: '2026-09-12', title: 'Done late', done: true }),
    ],
  })
  const early = computeDueReminders({ state, todayKey: TODAY, nowMinutes: 8 * 60 })
  assert.equal(early.length, 0, 'quiet before 10:00')

  const due = computeDueReminders({ state, todayKey: TODAY, nowMinutes: 12 * 60 })
  const overdue = due.find((r) => r.kind === 'overdue')
  assert.ok(overdue)
  assert.match(overdue.title, /2 overdue tasks/)
  assert.match(overdue.body, /Late thing/)
})

test('the evening Top 3 nudge only fires when priorities are open', () => {
  const state = stateWith({
    tasks: [task('t1', { title: 'Priority one' }), task('t2', { title: 'Priority two', done: true })],
    top3: { [TODAY]: ['t1', 't2'] },
  })
  const due = computeDueReminders({ state, todayKey: TODAY, nowMinutes: 21 * 60 })
  const nudge = due.find((r) => r.kind === 'top3')
  assert.ok(nudge)
  assert.match(nudge.title, /1 of your Top 3/)

  const allDone = stateWith({
    tasks: [task('t1', { done: true })],
    top3: { [TODAY]: ['t1'] },
  })
  assert.equal(computeDueReminders({ state: allDone, todayKey: TODAY, nowMinutes: 21 * 60 }).length, 0)
})

test('reminders stay silent during protected time when configured', () => {
  const state = stateWith({
    settings: { protectedTime: [{ id: 'sleep', label: 'Sleep', start: '23:00', end: '06:00', days: [] }] },
    timetable: [{ id: 'bx', time: '02:00', title: 'Late block', duration: 60, cat: 'upsc' }],
  })
  assert.equal(computeDueReminders({ state, todayKey: TODAY, nowMinutes: 1 * 60 + 55 }).length, 0)
  assert.ok(state.settings.protectedTime.length)
})

test('reminders can be switched off entirely', () => {
  const state = stateWith({ settings: { reminders: { enabled: false } } })
  assert.equal(computeDueReminders({ state, todayKey: TODAY, nowMinutes: 9 * 60 + 55 }).length, 0)
})

test('never returns more than maxPerRun items', () => {
  const state = stateWith({
    timetable: [
      { id: 'a', time: '10:00', title: 'A', duration: 30, cat: 'upsc' },
      { id: 'b', time: '10:02', title: 'B', duration: 30, cat: 'upsc' },
      { id: 'c', time: '10:05', title: 'C', duration: 30, cat: 'upsc' },
    ],
  })
  assert.equal(computeDueReminders({ state, todayKey: TODAY, nowMinutes: 9 * 60 + 55 }).length, 2)
  assert.equal(computeDueReminders({ state, todayKey: TODAY, nowMinutes: 9 * 60 + 55, maxPerRun: 3 }).length, 3)
})

test('the sent log is pruned after two weeks', () => {
  const sent = {
    [`block:b1:${TODAY}:10`]: 1,
    'block:old:2026-08-01:10': 1,
    'weird-key': 2,
  }
  const pruned = pruneSentLog(sent, TODAY, 14)
  assert.ok(pruned[`block:b1:${TODAY}:10`])
  assert.equal(pruned['block:old:2026-08-01:10'], undefined)
  assert.equal(pruned['weird-key'], 2, 'non-dated keys are kept')
})

test('the settings summary explains what will arrive', () => {
  assert.match(reminderSummary({ enabled: true, beforeMinutes: 10, timetable: true, taskDue: true, overdue: true, top3NudgeAt: '20:30' }), /timetable blocks 10 min before/)
  assert.equal(reminderSummary({ enabled: false }), 'Reminders are off.')
})
