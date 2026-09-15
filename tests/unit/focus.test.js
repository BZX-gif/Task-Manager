import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createSession,
  elapsedSeconds,
  finalizeSession,
  focusedMinutesByDay,
  isSessionComplete,
  minutesByTask,
  pauseSession,
  plannedSeconds,
  progressRatio,
  reconcileStaleSession,
  remainingSeconds,
  resumeSession,
  sessionTotals,
  tickSession,
} from '../../src/client/lib/focus.js'

const T0 = Date.parse('2026-09-15T09:00:00Z')

test('a new session starts running with zero elapsed time', () => {
  const session = createSession({ id: 's1', taskId: 't1', plannedMinutes: 25, now: T0 })
  assert.equal(session.running, true)
  assert.equal(session.accumulatedSeconds, 0)
  assert.equal(session.plannedMinutes, 25)
  assert.equal(remainingSeconds(session, T0), 1500)
  assert.equal(progressRatio(session, T0), 0)
  assert.equal(plannedSeconds(session), 1500)
})

test('elapsed time accumulates and pauses correctly', () => {
  let session = createSession({ id: 's1', plannedMinutes: 25, now: T0 })
  session = tickSession(session, T0 + 65_000)
  assert.equal(Math.round(elapsedSeconds(session, T0 + 65_000)), 65)

  session = pauseSession(session, T0 + 100_000)
  assert.equal(session.running, false)
  assert.equal(Math.round(elapsedSeconds(session, T0 + 100_000)), 100)
  // time keeps flowing in reality but not on the clock
  assert.equal(Math.round(elapsedSeconds(session, T0 + 500_000)), 100)

  session = resumeSession(session, T0 + 600_000)
  session = tickSession(session, T0 + 630_000)
  assert.equal(Math.round(elapsedSeconds(session, T0 + 630_000)), 130)
})

test('remaining time and progress never go negative or beyond 100%', () => {
  let session = createSession({ id: 's1', plannedMinutes: 10, now: T0 })
  session = tickSession(session, T0 + 20 * 60_000)
  assert.equal(remainingSeconds(session, T0 + 20 * 60_000), 0)
  assert.equal(progressRatio(session, T0 + 20 * 60_000), 1)
  assert.equal(isSessionComplete(session, T0 + 20 * 60_000), true)
})

test('finalising a session produces an immutable history record', () => {
  let session = createSession({ id: 's1', taskId: 't9', plannedMinutes: 50, now: T0 })
  session = tickSession(session, T0 + 600_000) // 10 minutes
  const record = finalizeSession(session, T0 + 600_000, 'stopped')
  assert.equal(record.focusedSeconds, 600)
  assert.equal(record.status, 'stopped')
  assert.equal(record.taskId, 't9')
  assert.equal(record.plannedMinutes, 50)
  assert.match(record.date, /^\d{4}-\d{2}-\d{2}$/, 'the session is filed under a calendar day')
})

test('completed sessions are labelled completed', () => {
  let session = createSession({ id: 's1', plannedMinutes: 25, now: T0 })
  session = tickSession(session, T0 + 25 * 60_000)
  assert.equal(isSessionComplete(session, T0 + 25 * 60_000), true)
  const record = finalizeSession(session, T0 + 25 * 60_000, 'completed')
  assert.equal(record.status, 'completed')
  assert.equal(record.focusedSeconds, 1500)
})

test('session totals separate focus from breaks', () => {
  const sessions = [
    { id: 'a', mode: 'focus', date: '2026-09-15', focusedSeconds: 1500, status: 'completed' },
    { id: 'b', mode: 'focus', date: '2026-09-15', focusedSeconds: 900, status: 'stopped' },
    { id: 'c', mode: 'break', date: '2026-09-15', focusedSeconds: 300, status: 'completed' },
    { id: 'd', mode: 'focus', date: '2026-09-14', focusedSeconds: 3600, status: 'completed' },
  ]
  const totals = sessionTotals(sessions, '2026-09-15')
  assert.equal(totals.focusedMinutes, 40)
  assert.equal(totals.sessions, 2)
  assert.equal(totals.completedSessions, 1)
  assert.equal(totals.breakMinutes, 5)
  assert.equal(sessionTotals(sessions).focusedMinutes, 100)
})

test('minutes can be attributed to a task', () => {
  const sessions = [
    { id: 'a', taskId: 't1', mode: 'focus', date: '2026-09-15', focusedSeconds: 1500 },
    { id: 'b', taskId: 't1', mode: 'focus', date: '2026-09-15', focusedSeconds: 1500 },
    { id: 'c', taskId: 't2', mode: 'focus', date: '2026-09-15', focusedSeconds: 600 },
  ]
  assert.equal(minutesByTask(sessions, 't1'), 50)
  assert.equal(minutesByTask(sessions, 't2'), 10)
  assert.equal(minutesByTask(sessions, 'nope'), 0)
})

test('focused minutes per day is ordered oldest → newest', () => {
  const sessions = [
    { id: 'a', mode: 'focus', date: '2026-09-15', focusedSeconds: 3600 },
    { id: 'b', mode: 'focus', date: '2026-09-13', focusedSeconds: 1800 },
  ]
  const rows = focusedMinutesByDay(sessions, '2026-09-15', 4)
  assert.equal(rows.length, 4)
  assert.deepEqual(rows.map((r) => r.dateKey), ['2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15'])
  assert.deepEqual(rows.map((r) => r.minutes), [0, 30, 0, 60])
})

test('a stale running session (browser closed) is closed honestly', () => {
  const session = { ...createSession({ id: 's1', plannedMinutes: 25, now: T0 }), accumulatedSeconds: 900 }
  const fresh = reconcileStaleSession(session, T0 + 60 * 60_000)
  assert.equal(fresh.stale, false)

  const stale = reconcileStaleSession(session, T0 + 20 * 60 * 60_000)
  assert.equal(stale.stale, true)
  assert.equal(stale.session.running, false)
  assert.equal(stale.session.accumulatedSeconds, 900, 'keeps the time the user actually focused')
  assert.equal(reconcileStaleSession(null, T0).session, null)
})
