/* -------------------------------------------------------------------------
   DAY STATS — one place that aggregates a day's real numbers.
   Dashboard, Daily Score, streak, weekly review and category analytics all
   read from here, so every surface shows the same truth.

   Day plans: `state.dayPlans["YYYY-MM-DD"]` keeps a snapshot of the timetable
   as it looked on that day (id, time, title, duration, category). Historical
   planned-time analytics therefore stay correct even after the timetable is
   edited. Legacy days (before this version) are derived from the completion
   log + current timetable ids.
   ------------------------------------------------------------------------- */

import { dateKey, minutesOfDay, nowMinutes as nowMinutesOf } from './dates.js'
import { buildScoreInput, computeDailyScore, focusedMinutesOn, overdueTasks } from './score.js'
import { sessionTotals } from './focus.js'
import { top3Stats } from './top3.js'

/** Snapshot the current timetable for `dateKey` (idempotent). */
export function materializeDayPlan(state, dateKey) {
  if (!state.dayPlans) state.dayPlans = {}
  const snapshot = (state.timetable || []).map((b) => ({
    id: b.id,
    time: b.time,
    title: b.title,
    duration: b.duration || 60,
    cat: b.cat || null,
  }))
  const changed = JSON.stringify(state.dayPlans[dateKey] || null) !== JSON.stringify(snapshot)
  if (changed) state.dayPlans[dateKey] = snapshot
  return changed
}

/**
 * The timetable that applied on a given day.
 * Falls back to the current timetable (+ completion log) for legacy days.
 */
export function dayPlanFor(state, dateKey) {
  const snap = state.dayPlans?.[dateKey]
  if (Array.isArray(snap) && snap.length) return snap
  return (state.timetable || []).map((b) => ({ id: b.id, time: b.time, title: b.title, duration: b.duration || 60, cat: b.cat || null }))
}

/**
 * Everything we know about one day.
 * @returns {Object} day statistics used by score/streak/review/analytics
 */
export function dayStats(state, dateKeyValue, options = {}) {
  const dateKey = dateKeyValue
  const todayKey = options.todayKey || dateKey
  const now = options.now || new Date()
  const tasksForDay = (state.tasks || []).filter((t) => t.date === dateKey)
  const log = state.completionLog?.[dateKey] || { ttDone: [], taskDone: [] }
  const plan = dayPlanFor(state, dateKey)
  const ttDone = Array.isArray(log.ttDone) ? log.ttDone : []
  const doneSet = new Set(ttDone)

  const scoreInput = buildScoreInput(state, dateKey, todayKey, now)
  const score = computeDailyScore(scoreInput)
  const top3 = top3Stats(state, dateKey)
  const focus = sessionTotals(state.focus?.sessions || [], dateKey)

  const blocksTotal = plan.length
  const blocksDone = plan.filter((b) => doneSet.has(b.id)).length
  const nowMin = nowMinutesOf(now)
  const isToday = dateKey === todayKey
  const isPast = dateKey < todayKey
  // only blocks that have already started count towards adherence
  const cutoff = isPast ? 24 * 60 : isToday ? nowMin : -1
  const blocksElapsed = plan.filter((b) => minutesOfDay(b.time) <= cutoff).length

  const plannedMinutes = plan.reduce((sum, b) => sum + (b.duration || 60), 0)
  const completedMinutes = plan.filter((b) => doneSet.has(b.id)).reduce((sum, b) => sum + (b.duration || 60), 0)
  const taskPlannedMinutes = tasksForDay.reduce((sum, t) => sum + (t.estimateMinutes ?? 30), 0)
  const taskDoneMinutes = tasksForDay.filter((t) => t.done).reduce((sum, t) => sum + (t.estimateMinutes ?? 30), 0)

  const tasksDone = tasksForDay.filter((t) => t.done).length

  return {
    dateKey,
    score: score.score,
    scoreParts: score.parts,
    pace: score.pace,
    onTrack: score.onTrack,
    top3Total: top3.total,
    top3Done: top3.done,
    top3Items: top3.items,
    focusedMinutes: focus.focusedMinutes,
    focusSessions: focus.sessions,
    completedSessions: focus.completedSessions,
    breakMinutes: focus.breakMinutes,
    tasksPlanned: tasksForDay.length,
    tasksDone,
    plannedMinutes,
    completedMinutes,
    taskPlannedMinutes,
    taskDoneMinutes,
    totalPlannedMinutes: plannedMinutes + taskPlannedMinutes,
    blocksTotal,
    blocksDone,
    blocksElapsed,
    adherence: blocksElapsed ? Math.min(blocksDone, blocksElapsed) / blocksElapsed : 0,
    overdueCount: overdueTasks(state, todayKey).length,
    hasAnyActivity: Boolean(tasksForDay.length || blocksDone || focus.focusedSeconds || top3.total),
  }
}

/**
 * Day stats for a range of days (inclusive).
 * @param {any} state
 * @param {string} fromKey
 * @param {string} toKey
 * @param {{ todayKey?: string, now?: Date }} [options]
 */
export function rangeDayStats(state, fromKey, toKey, { todayKey = fromKey, now = new Date() } = {}) {
  const out = []
  let cursor = fromKey
  let guard = 0
  while (cursor <= toKey && guard < 800) {
    out.push(dayStats(state, cursor, { todayKey, now }))
    cursor = nextKey(cursor)
    guard++
  }
  return out
}

function nextKey(key) {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y, m - 1, d + 1, 12)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * Map used by the streak engine (date → metrics).
 * @param {any} state
 * @param {{ todayKey?: string, now?: Date, days?: number }} [options]
 * @returns {Record<string, { score: number, top3Total: number, top3Done: number, focusedMinutes: number }>}
 */
export function streakHistory(state, options = {}) {
  const todayKey = options.todayKey || dateKey()
  const now = options.now || new Date()
  const days = options.days || 400
  /** @type {Record<string, { score: number, top3Total: number, top3Done: number, focusedMinutes: number }>} */
  const out = {}
  let cursor = todayKey
  for (let i = 0; i < days; i++) {
    const stats = dayStats(state, cursor, { todayKey, now })
    if (stats.hasAnyActivity || i < 60) {
      out[cursor] = {
        score: stats.score,
        top3Total: stats.top3Total,
        top3Done: stats.top3Done,
        focusedMinutes: stats.focusedMinutes,
      }
    }
    cursor = prevKey(cursor)
  }
  return out
}

function prevKey(key) {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y, m - 1, d - 1, 12)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export { focusedMinutesOn }
