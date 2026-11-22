/* -------------------------------------------------------------------------
   PAPER · history — pattern intelligence over recorded data.

   Every pattern is gated on data sufficiency: with too few recorded days the
   honest answer is "not enough data yet", never a manufactured insight.
   ------------------------------------------------------------------------- */

import { addDays, dateKey } from '../dates.js'
import { finding } from './core.js'

export const MIN_DAYS_FOR_TREND = 5
export const MIN_SESSIONS_FOR_WINDOW = 8
export const MIN_DAYS_FOR_CONSISTENCY = 7

/** Recorded daily scores in [from, to] (inclusive), sorted by day. */
export function scoreSeries(state, from, to) {
  const out = []
  const history = state?.scoreHistory || {}
  for (const key of Object.keys(history).sort()) {
    if (key >= from && key <= to) out.push({ dayKey: key, ...history[key] })
  }
  return out
}

/** Average of a numeric field, or null when there is no data. */
function average(rows, field) {
  if (!rows.length) return null
  return rows.reduce((sum, r) => sum + (Number(r[field]) || 0), 0) / rows.length
}

/**
 * Trend of the daily execution score: last `window` days vs the `window`
 * before. Insufficient data in either window → null trend with a `missing`
 * finding explaining why.
 */
export function scoreTrend(state, todayKey, { window = 7 } = {}) {
  const recent = scoreSeries(state, addDays(todayKey, -(window - 1)), todayKey)
  const previous = scoreSeries(state, addDays(todayKey, -(2 * window - 1)), addDays(todayKey, -window))
  const recentAvg = average(recent, 'score')
  const previousAvg = average(previous, 'score')
  if (recent.length < MIN_DAYS_FOR_TREND || previous.length < MIN_DAYS_FOR_TREND) {
    return {
      trend: 'unknown',
      recentAvg,
      previousAvg,
      why: [finding('missing', `Only ${recent.length} recorded day(s) in the last week and ${previous.length} in the week before — a trend needs at least ${MIN_DAYS_FOR_TREND} in each.`, 'history')],
    }
  }
  const delta = recentAvg - previousAvg
  const trend = delta <= -8 ? 'declining' : delta >= 8 ? 'improving' : 'steady'
  const why = [
    finding('calculation', `Average execution score moved from ${Math.round(previousAvg)} to ${Math.round(recentAvg)} (${delta > 0 ? '+' : ''}${Math.round(delta)}) across ${recent.length}/${previous.length} recorded days.`, 'history'),
  ]
  return { trend, recentAvg, previousAvg, delta, why }
}

/**
 * When does focused work actually happen? Buckets start hours into 3-hour
 * windows. Needs MIN_SESSIONS_FOR_WINDOW sessions to claim anything.
 */
export function focusWindows(state) {
  const sessions = (state?.focus?.sessions || []).filter((s) => s && s.mode !== 'break' && s.startedAt)
  if (sessions.length < MIN_SESSIONS_FOR_WINDOW) {
    return {
      enough: false,
      buckets: [],
      why: [finding('missing', `Only ${sessions.length} focus session(s) recorded — at least ${MIN_SESSIONS_FOR_WINDOW} are needed to read a reliable pattern.`, 'history')],
    }
  }
  const buckets = new Array(8).fill(0)
  for (const session of sessions) {
    const hour = new Date(session.startedAt).getHours()
    buckets[Math.floor(hour / 3)] += 1
  }
  const best = buckets.indexOf(Math.max(...buckets))
  const label = `${String(best * 3).padStart(2, '0')}:00–${String(best * 3 + 3).padStart(2, '0')}:00`
  return {
    enough: true,
    buckets,
    bestWindow: label,
    bestCount: buckets[best],
    why: [finding('inference', `Most focus sessions (${buckets[best]} of ${sessions.length}) start between ${label}.`, 'history')],
  }
}

/**
 * Execution consistency: how many of the last `days` days show any recorded
 * activity (completions or focus).
 */
export function consistency(state, todayKey, { days = 14 } = {}) {
  const log = state?.completionLog || {}
  const focusByDay = new Set((state?.focus?.sessions || []).map((s) => s.date).filter(Boolean))
  let activeDays = 0
  const recordedDays = new Set(Object.keys(log))
  for (let i = 0; i < days; i += 1) {
    const key = addDays(todayKey, -i)
    const entry = log[key]
    const hasLog = entry && ((entry.ttDone || []).length || (entry.taskDone || []).length)
    if (hasLog || focusByDay.has(key)) activeDays += 1
  }
  const totalRecorded = recordedDays.size + focusByDay.size
  if (totalRecorded < MIN_DAYS_FOR_CONSISTENCY) {
    return {
      enough: false,
      activeDays,
      why: [finding('missing', `History covers ${totalRecorded} recorded day(s) — consistency needs at least ${MIN_DAYS_FOR_CONSISTENCY}.`, 'history')],
    }
  }
  return {
    enough: true,
    activeDays,
    days,
    why: [finding('calculation', `Work was recorded on ${activeDays} of the last ${days} days.`, 'history')],
  }
}

/** Missions that keep moving: repeated postponements across the workspace. */
export function repeatedPostponements(state, { min = 3 } = {}) {
  const out = []
  for (const task of state?.tasks || []) {
    if (task.done || task.status === 'cancelled') continue
    const pushes = (task.history || []).filter((h) => h && ['postponed', 'rescheduled', 'skipped'].includes(h.action)).length
    if (pushes >= min) {
      out.push({
        taskId: task.id,
        title: task.title,
        pushes,
        why: [finding('calculation', `“${task.title}” has been pushed back ${pushes} times.`, 'history')],
      })
    }
  }
  return out.sort((a, b) => b.pushes - a.pushes)
}

/** Abandoned goals — recorded as cancelled. A count, not a judgement. */
export function abandonedGoals(state) {
  return (state?.goals || []).filter((g) => g.status === 'cancelled').length
}

/**
 * The full pattern report. `insights` may be empty — that is a valid, honest
 * result for a young workspace.
 */
export function analyzePatterns(state, todayKey) {
  const trend = scoreTrend(state, todayKey)
  const windows = focusWindows(state)
  const consist = consistency(state, todayKey)
  const postponements = repeatedPostponements(state)
  const abandoned = abandonedGoals(state)

  const insights = []
  if (trend.trend !== 'unknown') insights.push(...trend.why)
  if (windows.enough) insights.push(...windows.why)
  if (consist.enough) insights.push(...consist.why)
  for (const row of postponements.slice(0, 3)) insights.push(...row.why)
  if (abandoned > 0) insights.push(finding('fact', `${abandoned} goal${abandoned === 1 ? '' : 's'} on record are cancelled.`, 'history'))

  const missing = []
  if (trend.trend === 'unknown') missing.push(...trend.why)
  if (!windows.enough) missing.push(...windows.why)
  if (!consist.enough) missing.push(...consist.why)

  return { trend, windows, consistency: consist, postponements, abandonedGoals: abandoned, insights, missing }
}
