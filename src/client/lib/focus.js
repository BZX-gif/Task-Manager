/* -------------------------------------------------------------------------
   FOCUS MODE — timer maths & session bookkeeping
   -------------------------------------------------------------------------
   A focus session is stored as a small record that survives a page refresh:

     { id, taskId, mode: 'focus'|'break', plannedMinutes, startedAt,
       accumulatedSeconds, running, lastTickAt, status, completedAt }

   All maths lives here and takes an explicit `now` (ms) so it is fully
   deterministic and unit-testable. Elapsed time is accumulated while running
   (tick) instead of being derived from wall-clock only, so pausing, refreshing
   and clock changes never lose or invent focused time.
   ------------------------------------------------------------------------- */

import { addDays, dateKey } from './dates.js'

export const DEFAULT_FOCUS_MINUTES = 25
export const DEFAULT_BREAK_MINUTES = 5

/**
 * @param {Object} options
 * @param {string} options.id
 * @param {string|null} [options.taskId]
 * @param {number} [options.plannedMinutes]
 * @param {'focus'|'break'} [options.mode]
 * @param {number} options.now        epoch ms
 */
export function createSession({ id, taskId = null, plannedMinutes = DEFAULT_FOCUS_MINUTES, mode = 'focus', now }) {
  return {
    id,
    taskId,
    mode,
    plannedMinutes: Math.max(1, Math.round(plannedMinutes)),
    startedAt: now,
    accumulatedSeconds: 0,
    running: true,
    lastTickAt: now,
    completedAt: null,
    status: 'active',
    date: dateKey(new Date(now)),
  }
}

/** Add the seconds elapsed since the last tick (only while running). */
export function tickSession(session, now) {
  if (!session || !session.running) return session
  const last = session.lastTickAt || session.startedAt || now
  const delta = Math.max(0, (now - last) / 1000)
  if (delta <= 0) return { ...session, lastTickAt: now }
  return {
    ...session,
    accumulatedSeconds: (session.accumulatedSeconds || 0) + delta,
    lastTickAt: now,
  }
}

/** Seconds the session would have accumulated by `now` (pure, no mutation). */
export function elapsedSeconds(session, now) {
  if (!session) return 0
  const base = session.accumulatedSeconds || 0
  if (!session.running) return base
  const last = session.lastTickAt || session.startedAt || now
  return base + Math.max(0, (now - last) / 1000)
}

export function plannedSeconds(session) {
  return Math.max(1, (session?.plannedMinutes || DEFAULT_FOCUS_MINUTES) * 60)
}

/** Seconds left (0 when the planned time is reached). */
export function remainingSeconds(session, now) {
  return Math.max(0, plannedSeconds(session) - elapsedSeconds(session, now))
}

/** 0…1 progress of the planned duration. */
export function progressRatio(session, now) {
  const ratio = elapsedSeconds(session, now) / plannedSeconds(session)
  return Math.max(0, Math.min(1, ratio))
}

export function pauseSession(session, now) {
  const ticked = tickSession(session, now)
  return { ...ticked, running: false, lastTickAt: now }
}

export function resumeSession(session, now) {
  return { ...session, running: true, lastTickAt: now }
}

/**
 * Turn an active session into an immutable history record.
 * @param {object} session
 * @param {number} now
 * @param {'completed'|'stopped'} status
 */
export function finalizeSession(session, now, status = 'stopped') {
  const ticked = tickSession(session, now)
  return {
    id: ticked.id,
    taskId: ticked.taskId || null,
    mode: ticked.mode || 'focus',
    plannedMinutes: ticked.plannedMinutes,
    focusedSeconds: Math.round(ticked.accumulatedSeconds || 0),
    startedAt: ticked.startedAt,
    endedAt: now,
    status,
    date: ticked.date || dateKey(new Date(ticked.startedAt)),
  }
}

/** Full or partial completion: did the user reach the planned duration? */
export function isSessionComplete(session, now) {
  return elapsedSeconds(session, now) >= plannedSeconds(session)
}

/**
 * Totals for a day (or the whole history when `dateKey` is omitted).
 * @returns {{focusedSeconds:number, focusedMinutes:number, sessions:number, completedSessions:number, breakMinutes:number}}
 */
export function sessionTotals(sessions = [], day) {
  const list = sessions.filter((s) => (day ? s.date === day : true) && s.mode !== 'break')
  const breaks = sessions.filter((s) => (day ? s.date === day : true) && s.mode === 'break')
  const focusedSeconds = list.reduce((sum, s) => sum + (s.focusedSeconds || 0), 0)
  return {
    focusedSeconds,
    focusedMinutes: Math.round(focusedSeconds / 60),
    sessions: list.length,
    completedSessions: list.filter((s) => s.status === 'completed').length,
    breakMinutes: Math.round(breaks.reduce((sum, s) => sum + (s.focusedSeconds || 0), 0) / 60),
  }
}

/** Focused minutes accumulated for a specific task. */
export function minutesByTask(sessions = [], taskId) {
  return Math.round(
    sessions
      .filter((s) => s.taskId === taskId && s.mode !== 'break')
      .reduce((sum, s) => sum + (s.focusedSeconds || 0), 0) / 60,
  )
}

/** Focused minutes per day for the last `days` days (for charts). */
export function focusedMinutesByDay(sessions = [], todayKey, days = 7) {
  const out = []
  for (let i = days - 1; i >= 0; i--) {
    const key = addDays(todayKey, -i)
    out.push({ dateKey: key, minutes: sessionTotals(sessions, key).focusedMinutes })
  }
  return out
}

/**
 * A session older than 12 hours that still claims to be running is stale (the
 * browser was closed mid-session). We keep the time the user genuinely focused
 * but stop the clock so the numbers stay honest.
 */
export function reconcileStaleSession(session, now, maxIdleHours = 12) {
  if (!session || !session.running) return { session, stale: false }
  const idleHours = (now - (session.lastTickAt || session.startedAt || now)) / 3600000
  if (idleHours < maxIdleHours) return { session, stale: false }
  const capped = {
    ...session,
    running: false,
    // keep what was genuinely focused, but never more than the planned block
    accumulatedSeconds: Math.min(session.accumulatedSeconds || 0, plannedSeconds(session)),
  }
  return { session: capped, stale: true }
}
