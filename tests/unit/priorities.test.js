import test from 'node:test'
import assert from 'node:assert/strict'
import { addToTop3, getTop3Ids, isTop3, pruneTop3, removeFromTop3, setTop3Ids, top3Candidates, top3Stats, TOP3_LIMIT } from '../../src/client/lib/top3.js'
import { selectNextAction } from '../../src/client/lib/nextaction.js'
import { task } from '../helpers/fixtures.js'

const TODAY = '2026-09-15'

function makeState(tasks) {
  return { tasks, top3: {}, categories: [], timetable: [] }
}

test('Top 3 accepts at most three tasks and ignores duplicates', () => {
  const state = makeState([task('t1'), task('t2'), task('t3'), task('t4')])
  assert.equal(addToTop3(state, TODAY, 't1').ok, true)
  assert.equal(addToTop3(state, TODAY, 't1').ok, false, 'duplicate rejected')
  assert.equal(addToTop3(state, TODAY, 't2').ok, true)
  assert.equal(addToTop3(state, TODAY, 't3').ok, true)
  const fourth = addToTop3(state, TODAY, 't4')
  assert.equal(fourth.ok, false)
  assert.match(fourth.reason, /full/i)
  assert.equal(getTop3Ids(state, TODAY).length, TOP3_LIMIT)
})

test('Top 3 stores references, so edits and deletes stay in sync', () => {
  const state = makeState([task('t1'), task('t2')])
  addToTop3(state, TODAY, 't1')
  state.tasks[0].title = 'Renamed'
  assert.equal(state.tasks.find((t) => t.id === 't1').title, 'Renamed')
  assert.equal(state.tasks.length, 2, 'no duplicated task records')

  state.tasks = state.tasks.filter((t) => t.id !== 't1')
  assert.deepEqual(getTop3Ids(state, TODAY), [], 'stale ids are dropped')
  pruneTop3(state)
  assert.equal(state.top3[TODAY], undefined)
})

test('promoting an inbox task pins it to the day', () => {
  const inboxTask = task('i1', { date: null, inbox: true })
  const state = makeState([inboxTask])
  const result = addToTop3(state, TODAY, 'i1')
  assert.equal(result.ok, true)
  assert.equal(inboxTask.date, TODAY)
  assert.equal(inboxTask.inbox, false)
  assert.equal(isTop3(state, TODAY, 'i1'), true)
})

test('removing and resetting Top 3 works', () => {
  const state = makeState([task('t1'), task('t2')])
  setTop3Ids(state, TODAY, ['t1', 't2', 'missing-id'])
  assert.deepEqual(getTop3Ids(state, TODAY), ['t1', 't2'])
  removeFromTop3(state, TODAY, 't1')
  assert.deepEqual(getTop3Ids(state, TODAY), ['t2'])
  setTop3Ids(state, TODAY, [])
  assert.equal(state.top3[TODAY], undefined)
})

test('Top 3 stats count completion', () => {
  const state = makeState([task('t1', { done: true }), task('t2'), task('t3')])
  setTop3Ids(state, TODAY, ['t1', 't2', 't3'])
  const stats = top3Stats(state, TODAY)
  assert.equal(stats.total, 3)
  assert.equal(stats.done, 1)
  assert.equal(stats.items[0].index, 0)
})

test('Top 3 candidates are ranked by real urgency', () => {
  const state = makeState([
    task('a', { priority: 'low', estimateMinutes: 10 }),
    task('b', { priority: 'high', estimateMinutes: 30 }),
    task('c', { priority: 'medium', estimateMinutes: 60 }),
    task('old', { date: '2026-09-01', priority: 'medium' }), // overdue

    task('done', { done: true }),
  ])
  const ranked = top3Candidates(state, TODAY, { overdueIds: ['old'] })
  assert.equal(ranked[0].id, 'old', 'overdue first')
  assert.equal(ranked[1].id, 'b', 'then high priority')
  assert.ok(!ranked.some((t) => t.id === 'done'))
})

/* ---------------------------------------------------------------- *
 * Next action ("Do this now")                                       *
 * ---------------------------------------------------------------- */

const timetable = [
  { id: 'b1', time: '09:00', title: 'Geography', duration: 60, cat: 'upsc' },
  { id: 'b2', time: '10:30', title: 'Polity', duration: 90, cat: 'upsc' },
  { id: 'b3', time: '14:00', title: 'Revision', duration: 60, cat: 'ssc' },
]

test('an unfinished Top 3 task wins', () => {
  const tasks = [task('top', { title: 'Top priority' }), task('other', { priority: 'high' })]
  const pick = selectNextAction({
    tasks,
    timetable,
    ttDone: [],
    top3Ids: ['top'],
    todayKey: TODAY,
    nowMinutes: 570,
  })
  assert.equal(pick.kind, 'top3')
  assert.equal(pick.title, 'Top priority')
  assert.equal(pick.reason, 'Top 3 priority')
})

test('the running timetable block is next', () => {
  const pick = selectNextAction({ tasks: [], timetable, ttDone: [], top3Ids: [], todayKey: TODAY, nowMinutes: 570 })
  assert.equal(pick.kind, 'current-block')
  assert.equal(pick.title, 'Geography')
  assert.equal(pick.minutes, 30, 'remaining minutes of the block')
})

test('overdue tasks are surfaced before ordinary priorities', () => {
  const tasks = [task('late', { date: '2026-09-10', title: 'Pay fees', priority: 'low' }), task('today', { priority: 'high' })]
  const pick = selectNextAction({ tasks, timetable: [], ttDone: [], top3Ids: [], todayKey: TODAY, nowMinutes: 700 })
  assert.equal(pick.kind, 'overdue')
  assert.equal(pick.title, 'Pay fees')
})

test('otherwise the highest priority task today is used', () => {
  const tasks = [task('low', { priority: 'low' }), task('high', { priority: 'high', title: 'Hard thing' })]
  const pick = selectNextAction({ tasks, timetable: [], ttDone: [], top3Ids: [], todayKey: TODAY, nowMinutes: 700 })
  assert.equal(pick.kind, 'priority')
  assert.equal(pick.title, 'Hard thing')
})

test('falls back to the nearest scheduled block', () => {
  const pick = selectNextAction({ tasks: [], timetable, ttDone: [], top3Ids: [], todayKey: TODAY, nowMinutes: 600 })
  assert.equal(pick.kind, 'scheduled')
  assert.equal(pick.startsAt, '10:30')
})

test('a timed task carries its start time into the recommendation', () => {
  const tasks = [task('timed', { time: '11:00', title: 'Mock test', cat: 'upsc', estimateMinutes: 120 })]
  const pick = selectNextAction({ tasks, timetable: [], ttDone: [], top3Ids: [], todayKey: TODAY, nowMinutes: 600 })
  assert.equal(pick.kind, 'priority')
  assert.equal(pick.title, 'Mock test')
  assert.equal(pick.startsAt, '11:00')
  assert.equal(pick.minutes, 120)
})

test('completing the pick surfaces the next recommendation', () => {
  const tasks = [task('top', { title: 'First' }), task('second', { priority: 'high', title: 'Second' })]
  const first = selectNextAction({ tasks, timetable: [], ttDone: [], top3Ids: ['top'], todayKey: TODAY, nowMinutes: 700 })
  assert.equal(first.title, 'First')
  tasks[0].done = true
  const second = selectNextAction({ tasks, timetable: [], ttDone: [], top3Ids: ['top'], todayKey: TODAY, nowMinutes: 700 })
  assert.equal(second.title, 'Second')
})

test('nothing left → a clear state instead of an empty card', () => {
  const pick = selectNextAction({ tasks: [], timetable: [], ttDone: [], top3Ids: [], todayKey: TODAY, nowMinutes: 700 })
  assert.equal(pick.kind, 'clear')
  assert.match(pick.title, /done/i)
})

test('protected time is reported, not silently ignored', () => {
  const tasks = [task('t1', { title: 'Late work' })]
  const pick = selectNextAction({
    tasks,
    timetable: [],
    ttDone: [],
    top3Ids: [],
    todayKey: TODAY,
    nowMinutes: 23 * 60 + 30,
    protectedBlocks: [{ id: 'sleep', label: 'Sleep', start: '23:00', end: '06:00' }],
  })
  assert.equal(pick.protectedLabel, 'Sleep')
})
