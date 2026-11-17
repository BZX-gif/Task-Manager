import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyState, makeContext } from '../../src/client/lib/state.js'
import {
  archiveMission, restoreMission, purgeTrash, emptyTrash, trashSummary,
  normalizeTrash, TRASH_TTL_DAYS,
} from '../../src/client/lib/trash.js'

const TODAY = '2026-09-15'
const NOW = new Date(2026, 8, 15, 18, 0, 0).getTime()
let seq = 0
const ctx = () => makeContext({ now: NOW, id: () => `id${++seq}` })

function stateWithMission(overrides = {}) {
  const state = emptyState(ctx())
  state.tasks.push({
    id: 't1', title: 'Draft the board memo', date: TODAY, time: '09:00', priority: 'high',
    estimateMinutes: 60, cat: 'work', done: false, status: 'ready', inbox: false, subtasks: [], ...overrides,
  })
  state.top3[TODAY] = ['t1']
  state.schedule.days[TODAY] = [
    { id: 'block-1', taskId: 't1', time: '09:00', title: 'Draft the board memo', duration: 60 },
    { id: 'block-2', time: '11:00', title: 'Standup', duration: 15 },
  ]
  state.completionLog[TODAY] = { ttDone: ['block-1'], taskDone: [] }
  return state
}

test('archiving removes the mission, its schedule block and its priority slot', () => {
  const state = stateWithMission()
  const result = archiveMission(state, 't1', { now: NOW })
  assert.equal(result.ok, true)
  assert.equal(state.tasks.length, 0)
  assert.equal(state.trash.length, 1)
  assert.equal(state.top3[TODAY], undefined)
  assert.deepEqual(state.schedule.days[TODAY].map((block) => block.id), ['block-2'])
  assert.deepEqual(state.completionLog[TODAY].ttDone, ['block-1'], 'recorded history is untouched')
  assert.equal(result.record.blocks.length, 1)
})

test('restoring puts everything back in place', () => {
  const state = stateWithMission()
  const archived = archiveMission(state, 't1', { now: NOW }).record
  const restored = restoreMission(state, archived.id)
  assert.equal(restored.ok, true)
  assert.equal(restored.task.title, 'Draft the board memo')
  assert.equal(state.tasks.length, 1)
  assert.deepEqual(state.top3[TODAY], ['t1'])
  assert.deepEqual(state.schedule.days[TODAY].map((block) => block.id), ['block-1', 'block-2'])
  assert.equal(state.trash.length, 0)
})

test('restoring a mission that already exists is refused without losing the trash record', () => {
  const state = stateWithMission()
  const archived = archiveMission(state, 't1', { now: NOW }).record
  state.tasks.push({ ...archived.task })
  const result = restoreMission(state, archived.id)
  assert.equal(result.ok, false)
  assert.equal(state.trash.length, 0, 'the stale record is cleared')
})

test('the active focus session loses a deleted mission but regains it on restore', () => {
  const state = stateWithMission()
  state.focus.active = { id: 'f1', taskId: 't1', taskTitle: 'Draft the board memo', mode: 'focus', running: true, accumulatedSeconds: 0, plannedMinutes: 25, startedAt: NOW, lastTickAt: NOW, date: TODAY }
  const archived = archiveMission(state, 't1', { now: NOW }).record
  assert.equal(state.focus.active.taskId, null)
  assert.equal(state.focus.active.taskTitle, null)
  restoreMission(state, archived.id)
  assert.equal(state.focus.active.taskId, 't1')
})

test('deleting a series root detaches siblings and restore re-attaches them', () => {
  const state = stateWithMission({ recurrence: { freq: 'daily' }, seriesId: 't1', occurrenceDate: TODAY })
  state.tasks.push({ id: 't2', title: 'Draft the board memo', date: '2026-09-16', seriesId: 't1', recurrence: { freq: 'daily' }, status: 'ready', done: false, inbox: false, subtasks: [] })
  const archived = archiveMission(state, 't1', { now: NOW }).record
  assert.equal(state.tasks.find((task) => task.id === 't2').seriesId, null)
  restoreMission(state, archived.id)
  assert.equal(state.tasks.find((task) => task.id === 't2').seriesId, 't1')
})

test('archive refuses unknown or skipped missions', () => {
  const state = stateWithMission()
  assert.equal(archiveMission(state, 'missing').ok, false)
  state.tasks[0].status = 'cancelled'
  assert.equal(archiveMission(state, 't1').ok, false)
})

test('purge respects the retention window and emptyTrash clears everything', () => {
  const state = stateWithMission()
  archiveMission(state, 't1', { now: NOW })
  assert.equal(purgeTrash(state, { now: NOW }), 0)
  assert.equal(purgeTrash(state, { now: NOW + (TRASH_TTL_DAYS + 1) * 86_400_000 }), 1)
  assert.equal(state.trash.length, 0)

  state.tasks.push({ id: 't1', title: 'Draft the board memo', status: 'ready', done: false, inbox: false, subtasks: [] })
  archiveMission(state, 't1', { now: NOW })
  assert.equal(emptyTrash(state), 1)
  assert.equal(state.trash.length, 0)
})

test('trashSummary is newest-first and flags records close to expiry', () => {
  const state = emptyState(ctx())
  state.trash = normalizeTrash([
    { id: 'old', taskId: 'a', task: { id: 'a', title: 'Old' }, deletedAt: NOW - 29 * 86_400_000 },
    { id: 'new', taskId: 'b', task: { id: 'b', title: 'New' }, deletedAt: NOW },
    { id: 'broken' },
  ], { now: NOW, uid: () => 'x' })
  const summary = trashSummary(state, { now: NOW })
  assert.equal(summary.count, 2)
  assert.equal(summary.records[0].id, 'new')
  assert.equal(summary.expiringSoon, 1)
})

test('archive keeps at most 100 records', () => {
  const state = emptyState(ctx())
  for (let i = 0; i < 120; i += 1) {
    state.tasks.push({ id: `t${i}`, title: `Mission ${i}`, status: 'ready', done: false, inbox: false, subtasks: [] })
    archiveMission(state, `t${i}`, { now: NOW + i })
  }
  assert.equal(state.trash.length, 100)
})
