import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyState, makeContext } from '../../src/client/lib/state.js'
import {
  shutdownSummary, applyShutdown, reopenDay, isDayClosed, closingHeadline,
} from '../../src/client/lib/shutdown.js'

const TODAY = '2026-09-15'
const TOMORROW = '2026-09-16'
const NOW = new Date(2026, 8, 15, 21, 30, 0).getTime()
let seq = 0
const ctx = () => makeContext({ now: NOW, id: () => `id${++seq}` })

function workspace() {
  const state = emptyState(ctx())
  const task = (id, over = {}) => ({
    id, title: id, date: TODAY, time: null, priority: 'medium', estimateMinutes: 30,
    done: false, status: 'ready', inbox: false, subtasks: [], cat: null, ...over,
  })
  state.tasks.push(
    task('done-1', { title: 'Finish the deck', done: true, status: 'completed', time: '09:00' }),
    task('open-1', { title: 'Write the appendix', priority: 'high', time: '14:00' }),
    task('open-2', { title: 'Reply to legal' }),
    task('overdue-1', { title: 'Send the invoice', date: '2026-09-13', priority: 'high' }),
    task('tomorrow-1', { title: 'Architect call', date: TOMORROW, time: '10:00' }),
    task('inbox-1', { title: 'Idea for later', date: null, inbox: true }),
  )
  state.top3[TODAY] = ['done-1', 'open-1', 'open-2']
  state.top3[TOMORROW] = ['tomorrow-1']
  state.focus.sessions.push(
    { id: 'f1', mode: 'focus', date: TODAY, focusedSeconds: 50 * 60, plannedMinutes: 50, status: 'completed', startedAt: NOW, endedAt: NOW },
    { id: 'f2', mode: 'break', date: TODAY, focusedSeconds: 5 * 60, plannedMinutes: 5, status: 'completed', startedAt: NOW, endedAt: NOW },
  )
  state.schedule.days[TODAY] = [
    { id: 'b1', taskId: 'open-1', time: '14:00', title: 'Write the appendix', duration: 30 },
    { id: 'b2', time: '11:00', title: 'Standup', duration: 15 },
  ]
  state.schedule.days[TOMORROW] = [
    { id: 'b3', taskId: 'tomorrow-1', time: '10:00', title: 'Architect call', duration: 30 },
    { id: 'b4', time: '23:00', title: 'Sleep', duration: 420 },
  ]
  return state
}

test('the summary counts today, overdue work and the cost of the day honestly', () => {
  const summary = shutdownSummary(workspace(), { today: TODAY, now: new Date(NOW) })
  assert.equal(summary.today, TODAY)
  assert.equal(summary.tomorrowKey, TOMORROW)
  assert.equal(summary.missions.total, 3)
  assert.equal(summary.missions.done, 1)
  assert.equal(summary.missions.open, 2)
  assert.equal(summary.focusMinutes, 50, 'break sessions do not count as focus')
  assert.equal(summary.top3.total, 3)
  assert.equal(summary.top3.done, 1)
  const ids = summary.unfinished.map((item) => item.id)
  assert.ok(ids.includes('open-1'))
  assert.ok(ids.includes('overdue-1'))
  assert.ok(!ids.includes('inbox-1'), 'inbox captures are not today’s commitments')
  assert.equal(summary.unfinished[0].reason, 'overdue', 'overdue work comes first')
  assert.equal(summary.tomorrow.missions, 1)
  assert.equal(summary.tomorrow.blocks, 1, 'rest blocks do not count as commitments')
  assert.equal(summary.tomorrow.priorities, 1)
  assert.equal(summary.closed, false)
})

test('closing carries chosen work forward without marking it as failure', () => {
  const state = workspace()
  const result = applyShutdown(state, {
    today: TODAY,
    carryIds: ['open-1', 'overdue-1', 'missing'],
    priorityIds: ['open-1', 'tomorrow-1', 'inbox-1', 'open-2', 'extra'],
    note: 'The deck shipped. The appendix can wait.',
    win: 'A calm, honest standup.',
    mood: 'steady',
    energy: 'medium',
    now: NOW,
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.carried.sort(), ['open-1', 'overdue-1'])
  assert.deepEqual(result.priorities, ['open-1', 'tomorrow-1'], 'only work that exists tomorrow can be a tomorrow priority')

  const open1 = state.tasks.find((task) => task.id === 'open-1')
  assert.equal(open1.date, TOMORROW)
  assert.equal(open1.time, null, 'carried work is re-placed rather than silently assumed')
  assert.equal(open1.status, 'rescheduled')
  assert.equal(open1.history.at(-1).action, 'carried_forward')
  assert.equal(open1.history.at(-1).from, TODAY)

  assert.equal(state.tasks.find((task) => task.id === 'inbox-1').date, null, 'inbox captures are never silently scheduled')
  assert.equal(state.schedule.days[TODAY].some((block) => block.taskId === 'open-1'), false)
  assert.deepEqual(state.top3[TOMORROW], ['open-1', 'tomorrow-1'])

  const entry = state.journal[TODAY]
  assert.equal(entry.note, 'The deck shipped. The appendix can wait.')
  assert.equal(entry.win, 'A calm, honest standup.')
  assert.equal(entry.mood, 'steady')
  assert.equal(entry.energy, 'medium')

  assert.equal(isDayClosed(state, TODAY), true)
  assert.equal(state.shutdowns[TODAY].carried.length, 2)
  assert.equal(shutdownSummary(state, { today: TODAY, now: new Date(NOW) }).closed, true)
})

test('an existing journal entry is preserved when only the mood is changed', () => {
  const state = workspace()
  state.journal[TODAY] = { note: 'An earlier thought.', win: '', nextStep: 'Keep going', mood: null, energy: null, updatedAt: NOW - 1000 }
  applyShutdown(state, { today: TODAY, note: '', mood: 'good', now: NOW })
  const entry = state.journal[TODAY]
  assert.equal(entry.note, 'An earlier thought.')
  assert.equal(entry.nextStep, 'Keep going')
  assert.equal(entry.mood, 'good')
})

test('closing with nothing to carry still records the ritual', () => {
  const state = workspace()
  const result = applyShutdown(state, { today: TODAY, carryIds: [], now: NOW })
  assert.equal(result.ok, true)
  assert.equal(result.carried.length, 0)
  assert.equal(state.shutdowns[TODAY].closed, true)
  assert.deepEqual(state.top3[TOMORROW], ['tomorrow-1'], 'omitting priorities leaves tomorrow untouched')
  assert.equal(state.journal[TODAY], undefined, 'no empty journal rows are created')
})

test('an explicit empty priority list clears tomorrow’s priorities', () => {
  const state = workspace()
  applyShutdown(state, { today: TODAY, priorityIds: [], now: NOW })
  assert.equal(state.top3[TOMORROW], undefined)
})

test('a closed day can be reopened without losing the evening note', () => {
  const state = workspace()
  applyShutdown(state, { today: TODAY, note: 'Done for today.', now: NOW })
  assert.equal(reopenDay(state, TODAY), true)
  assert.equal(isDayClosed(state, TODAY), false)
  assert.equal(state.journal[TODAY].note, 'Done for today.')
  assert.equal(reopenDay(state, TODAY), false)
})

test('headlines are deterministic and kind', () => {
  assert.equal(closingHeadline({ closed: true }), 'Closed with care.')
  assert.equal(closingHeadline({ closed: false, hasActivity: false, open: 0 }), 'A quiet day, honestly kept.')
  assert.match(closingHeadline({ closed: false, hasActivity: true, score: 90, done: 3, open: 0, focusMinutes: 120 }), /held its shape/)
  assert.match(closingHeadline({ closed: false, hasActivity: true, score: 40, done: 1, open: 2, focusMinutes: 10 }), /information, not failure/)
})
