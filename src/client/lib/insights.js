/* -------------------------------------------------------------------------
   CATEGORY / SUBJECT ANALYTICS
   -------------------------------------------------------------------------
   Per category (the app is category-agnostic — whatever the user created):

     plannedMinutes   planned timetable/task time in the range
     focusedMinutes   focus-mode minutes linked to that category
     completionRate   completed items / planned items (blocks + tasks)
     score            0–100 blend of completion and focus follow-through

   "Strongest / weakest area" are chosen from real numbers. Areas with too
   little data are ignored so a single task cannot crown a winner.
   ------------------------------------------------------------------------- */

import { formatDuration, minutesOfDay } from './dates.js'
import { dayPlanFor } from './daystats.js'

export const MIN_ITEMS_FOR_VERDICT = 2

/**
 * @param {Object} state
 * @param {{from:string,to:string,todayKey:string}} range
 */
export function categoryInsights(state, { from, to, todayKey }) {
  const categories = state.categories || []
  const buckets = new Map()
  for (const cat of categories) {
    buckets.set(cat.id, {
      categoryId: cat.id,
      name: cat.name,
      color: cat.color,
      plannedMinutes: 0,
      completedMinutes: 0,
      focusedMinutes: 0,
      blocksPlanned: 0,
      blocksDone: 0,
      tasksPlanned: 0,
      tasksDone: 0,
      itemsPlanned: 0,
      itemsDone: 0,
      focusSessions: 0,
    })
  }
  const fallback = {
    categoryId: '__none__',
    name: 'Uncategorised',
    color: '#64748b',
    plannedMinutes: 0,
    completedMinutes: 0,
    focusedMinutes: 0,
    blocksPlanned: 0,
    blocksDone: 0,
    tasksPlanned: 0,
    tasksDone: 0,
    itemsPlanned: 0,
    itemsDone: 0,
    focusSessions: 0,
  }
  const bucketFor = (catId) => {
    if (catId && buckets.has(catId)) return buckets.get(catId)
    return fallback
  }

  let cursor = from
  let guard = 0
  while (cursor <= to && guard++ < 800) {
    const log = state.completionLog?.[cursor] || { ttDone: [] }
    const doneSet = new Set(Array.isArray(log.ttDone) ? log.ttDone : [])
    for (const block of dayPlanFor(state, cursor)) {
      const bucket = bucketFor(block.cat)
      const duration = block.duration || 60
      bucket.plannedMinutes += duration
      bucket.blocksPlanned += 1
      bucket.itemsPlanned += 1
      if (doneSet.has(block.id)) {
        bucket.completedMinutes += duration
        bucket.blocksDone += 1
        bucket.itemsDone += 1
      }
      // future days were never completed — do not count them as failures
      if (cursor > todayKey) {
        bucket.blocksPlanned -= 1
        bucket.itemsPlanned -= 1
        bucket.plannedMinutes -= duration
      }
    }
    for (const task of (state.tasks || []).filter((t) => t.date === cursor)) {
      const bucket = bucketFor(task.cat)
      const estimate = task.estimateMinutes ?? 30
      bucket.plannedMinutes += estimate
      bucket.tasksPlanned += 1
      bucket.itemsPlanned += 1
      if (task.done) {
        bucket.completedMinutes += estimate
        bucket.tasksDone += 1
        bucket.itemsDone += 1
      }
    }
    cursor = addOneDay(cursor)
  }

  for (const session of state.focus?.sessions || []) {
    if (session.mode === 'break' || !session.date || session.date < from || session.date > to) continue
    const catId = session.categoryId || (state.tasks || []).find((t) => t.id === session.taskId)?.cat
    const bucket = bucketFor(catId)
    bucket.focusedMinutes += Math.round((session.focusedSeconds || 0) / 60)
    bucket.focusSessions += 1
  }

  const rows = [...buckets.values(), ...(fallback.itemsPlanned || fallback.focusedMinutes ? [fallback] : [])].map((b) => {
    const completionRate = b.itemsPlanned ? b.itemsDone / b.itemsPlanned : 0
    const focusFollowThrough = b.plannedMinutes ? Math.min(1, b.focusedMinutes / b.plannedMinutes) : 0
    return {
      ...b,
      completionRate,
      completionPct: Math.round(completionRate * 100),
      score: Math.round((completionRate * 0.7 + focusFollowThrough * 0.3) * 100),
    }
  })

  return rows
}

export function addOneDay(key) {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y, m - 1, d + 1, 12)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * Strongest & weakest area plus a concrete, data-driven recommendation.
 * @returns {{strongest:any|null, weakest:any|null, recommendation:string|null}}
 */
export function strongestAndWeakest(rows = []) {
  const eligible = rows
    .filter((r) => r.itemsPlanned >= MIN_ITEMS_FOR_VERDICT)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))

  if (!eligible.length) return { strongest: null, weakest: null, recommendation: null }

  const strongest = eligible[0]
  const weakest = eligible[eligible.length - 1]
  if (eligible.length === 1) {
    return {
      strongest,
      weakest: null,
      recommendation: `${strongest.name} is your only tracked area so far (${strongest.completionPct}% completion). Keep logging work here to build a comparison.`,
    }
  }
  if (strongest.score === weakest.score) {
    return { strongest, weakest: null, recommendation: 'All areas are performing evenly — keep the balance and raise the bar where you want the biggest win.' }
  }

  const gap = strongest.score - weakest.score
  const sessionsNeeded = Math.min(4, Math.max(2, Math.round((weakest.plannedMinutes / 60) * 0.25)))
  const recommendation =
    gap < 8
      ? `${weakest.name} trails ${strongest.name} only slightly (${weakest.completionPct}% vs ${strongest.completionPct}%). One extra focused session this week closes the gap.`
      : `Schedule ${sessionsNeeded} focused session${sessionsNeeded > 1 ? 's' : ''} for ${weakest.name} this week — it is at ${weakest.completionPct}% while ${strongest.name} is at ${strongest.completionPct}%.`

  return { strongest, weakest, recommendation }
}

/**
 * Time-of-day productivity split from focus sessions (used by the review).
 * @param {any[]} [sessions]
 * @param {{ from?: string, to?: string }} [range]
 */
export function focusTimeOfDay(sessions = [], { from, to } = {}) {
  const bands = { morning: 0, afternoon: 0, evening: 0, night: 0 }
  for (const session of sessions) {
    if (session.mode === 'break') continue
    if (from && session.date < from) continue
    if (to && session.date > to) continue
    const hour = new Date(session.startedAt).getHours()
    const minutes = (session.focusedSeconds || 0) / 60
    if (hour < 12) bands.morning += minutes
    else if (hour < 17) bands.afternoon += minutes
    else if (hour < 21) bands.evening += minutes
    else bands.night += minutes
  }
  const entries = Object.entries(bands)
    .map(([band, minutes]) => ({ band, minutes: Math.round(minutes) }))
    .sort((a, b) => b.minutes - a.minutes)
  return { bands, best: entries[0]?.minutes ? entries[0].band : null, entries }
}

/** Busiest / lightest planned day inside a set of day stats. */
export function plannedLoadByDay(dayStatsList = []) {
  const rows = dayStatsList.map((d) => ({ dateKey: d.dateKey, plannedMinutes: d.totalPlannedMinutes, doneMinutes: d.completedMinutes + d.taskDoneMinutes }))
  const sorted = [...rows].sort((a, b) => b.plannedMinutes - a.plannedMinutes)
  return { rows, busiest: sorted[0] || null, lightest: sorted[sorted.length - 1] || null, average: rows.length ? Math.round(rows.reduce((s, r) => s + r.plannedMinutes, 0) / rows.length) : 0 }
}

/** Small helper used by the UI for "1h 30m planned" style text. */
export function minuteLabel(minutes) {
  return formatDuration(minutes || 0)
}
