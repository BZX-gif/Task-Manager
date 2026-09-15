/* -------------------------------------------------------------------------
   WEEKLY REVIEW
   -------------------------------------------------------------------------
   Everything here is computed from the user's own records — no demo data.
   The recommendations are produced by explicit, inspectable rules:

     • overloaded day        → planned load > 1.3 × the week's daily average
     • weak subject          → category completion below 65% with real volume
     • focus shortfall       → focused minutes below 60% of the weekly target
     • consistency           → fewer than 5 active days
     • overdue pile-up       → 3+ overdue tasks
     • no buffer             → no gap ≥ 15 min anywhere in the timetable
     • best-day repeat       → strongest day is called out to repeat

   At most four recommendations are returned, ordered by expected impact.
   ------------------------------------------------------------------------- */

import { formatDuration, minutesOfDay, weekDates, weekdayName, weekdayOf } from './dates.js'
import { rangeDayStats } from './daystats.js'
import { categoryInsights, focusTimeOfDay, plannedLoadByDay, strongestAndWeakest } from './insights.js'
import { STREAK_RULE } from './streak.js'

/** The week (Mon–Sun by default) containing `dateKey`. */
export function weekRange(dateKey, weekStart = 1) {
  const days = weekDates(dateKey, weekStart)
  return { from: days[0], to: days[6], days }
}

/** Days with real activity, capped at "today" so the current week is not penalised. */
function activeDays(stats, todayKey) {
  return stats.filter((d) => d.hasAnyActivity && d.dateKey <= todayKey).length
}

/** Average daily score over the days that have already happened. */
function averageScore(stats, todayKey) {
  const scored = stats.filter((d) => d.dateKey <= todayKey)
  if (!scored.length) return 0
  return Math.round(scored.reduce((sum, d) => sum + d.score, 0) / scored.length)
}

function timetableHasBuffer(state, minGap = 15) {
  const sorted = [...(state.timetable || [])].sort((a, b) => minutesOfDay(a.time) - minutesOfDay(b.time))
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = minutesOfDay(sorted[i - 1].time) + (sorted[i - 1].duration || 60)
    const gap = minutesOfDay(sorted[i].time) - prevEnd
    if (gap >= minGap && gap <= 120) return true
  }
  return false
}

/**
 * @param {Object} state
 * @param {{dateKey:string, todayKey:string, now?:Date, weekStart?:number}} options
 */
export function weeklyReview(state, { dateKey, todayKey, now = new Date(), weekStart = 1 }) {
  const { from, to, days } = weekRange(dateKey, weekStart)
  const stats = rangeDayStats(state, from, to, { todayKey, now })
  const isCurrentWeek = todayKey >= from && todayKey <= to
  const focusTarget = (state.settings?.focus?.targetMinutes ?? 180) * 7

  // whole-week plan vs the part of the week that has already happened —
  // completion is judged against elapsed days only (future days are not failures)
  const elapsedDays = stats.filter((d) => d.dateKey <= todayKey)
  const plannedMinutes = stats.reduce((sum, d) => sum + d.totalPlannedMinutes, 0)
  const elapsedPlannedMinutes = elapsedDays.reduce((sum, d) => sum + d.totalPlannedMinutes, 0)
  const completedMinutes = stats.reduce((sum, d) => sum + d.completedMinutes + d.taskDoneMinutes, 0)
  const focusedMinutes = stats.reduce((sum, d) => sum + d.focusedMinutes, 0)
  const focusSessions = stats.reduce((sum, d) => sum + d.focusSessions, 0)
  const tasksPlanned = stats.reduce((sum, d) => sum + d.tasksPlanned, 0)
  const tasksDone = stats.reduce((sum, d) => sum + d.tasksDone, 0)
  const blocksDone = stats.reduce((sum, d) => sum + d.blocksDone, 0)

  // "Best / needs attention" ignore today while it is still running
  const withData = stats.filter((d) => d.hasAnyActivity && d.dateKey <= todayKey)
  const settled = withData.filter((d) => d.dateKey !== todayKey)
  const ranked = [...(settled.length ? settled : withData)].sort((a, b) => b.score - a.score)
  const best = ranked[0] || null
  const weakest = ranked.length > 1 ? ranked[ranked.length - 1] : null

  const categories = categoryInsights(state, { from, to, todayKey })
  const { strongest, weakest: weakestCategory, recommendation: categoryRecommendation } = strongestAndWeakest(categories)
  const load = plannedLoadByDay(stats)
  const focusBands = focusTimeOfDay(state.focus?.sessions || [], { from, to })

  const daysUpToToday = stats.filter((d) => d.dateKey <= todayKey).length

  const overdue = (state.tasks || []).filter((t) => !t.done && t.date && t.date < todayKey && !t.inbox)
  const missedTasks = (state.tasks || []).filter((t) => t.date >= from && t.date <= to && !t.done && t.date <= todayKey)

  // ---- recommendations (deterministic rules, max 4) --------------------
  /** @type {Array<{priority:number, text:string, action?:string}>} */
  const recommendations = []
  const average = load.average

  if (load.busiest && average > 0 && load.busiest.plannedMinutes > average * 1.3) {
    recommendations.push({
      priority: 90 + (load.busiest.plannedMinutes - average) / 60,
      text: `Reduce overloaded ${weekdayName(weekdayOf(load.busiest.dateKey))} — ${formatDuration(load.busiest.plannedMinutes)} planned vs a ${formatDuration(average)} daily average.`,
      action: 'recovery',
    })
  }
  if (weakestCategory && weakestCategory.completionPct < 65 && weakestCategory.itemsPlanned >= 3) {
    recommendations.push({
      priority: 85 + (65 - weakestCategory.completionPct) / 10,
      text: categoryRecommendation || `Add 2 focused sessions for ${weakestCategory.name}.`,
      action: 'focus',
    })
  }
  if (focusedMinutes < focusTarget * 0.6) {
    const missing = Math.max(0, Math.round((focusTarget * 0.6 - focusedMinutes) / 60))
    recommendations.push({
      priority: 70 + missing / 4,
      text: `Focused time is ${formatDuration(focusedMinutes)} against a ${formatDuration(focusTarget)} weekly target — protect about ${missing}h of deep work next week.`,
      action: 'focus',
    })
  }
  const active = activeDays(stats, todayKey)
  if (active < 5) {
    recommendations.push({
      priority: 60 + (5 - active) * 2,
      text: `Only ${active} active day${active === 1 ? '' : 's'} this week. Aim for 5 — streak days also count with ${STREAK_RULE.minFocusMinutes}+ focus minutes or a ${STREAK_RULE.minScore}+ score.`,
      action: 'plan',
    })
  }
  if (overdue.length >= 3) {
    recommendations.push({
      priority: 75 + overdue.length,
      text: `${overdue.length} tasks are overdue. Clear the top three or reschedule them today.`,
      action: 'tasks',
    })
  }
  if (!timetableHasBuffer(state)) {
    recommendations.push({ priority: 50, text: 'No buffer in the timetable. Protect a 15-minute daily buffer to absorb overruns.', action: 'timetable' })
  }
  if (best && best.score >= 80) {
    recommendations.push({
      priority: 40,
      text: `${weekdayName(weekdayOf(best.dateKey))} was your strongest day (${best.score}/100, ${formatDuration(best.focusedMinutes)} focused) — repeat that structure.`,
      action: 'plan',
    })
  }
  if (!recommendations.length) {
    recommendations.push({ priority: 10, text: 'Nothing critical — keep the current structure and log focus sessions to sharpen the data.', action: null })
  }

  recommendations.sort((a, b) => b.priority - a.priority)

  return {
    from,
    to,
    days,
    isCurrentWeek,
    plannedMinutes,
    completedMinutes,
    focusedMinutes,
    focusSessions,
    focusTarget,
    focusTargetPct: focusTarget ? Math.round((focusedMinutes / focusTarget) * 100) : 0,
    completionRate: elapsedPlannedMinutes ? completedMinutes / elapsedPlannedMinutes : 0,
    completionPct: elapsedPlannedMinutes ? Math.round((completedMinutes / elapsedPlannedMinutes) * 100) : 0,
    elapsedPlannedMinutes,
    taskCompletionPct: tasksPlanned ? Math.round((tasksDone / tasksPlanned) * 100) : 0,
    taskCompletionRate: tasksPlanned ? tasksDone / tasksPlanned : 0,
    tasksPlanned,
    tasksDone,
    blocksDone,
    activeDays: active,
    averageScore: averageScore(stats, todayKey),
    bestDay: best,
    weakestDay: weakest,
    missedTasks: missedTasks.slice(0, 8).map((t) => ({ id: t.id, title: t.title, date: t.date })),
    overdueCount: overdue.length,
    consistency: daysUpToToday ? Math.round((active / daysUpToToday) * 100) : 0,
    categories,
    strongestCategory: strongest,
    weakestCategory,
    load,
    focusBands,
    dayRows: stats.map((d) => ({
      dateKey: d.dateKey,
      score: d.score,
      focusedMinutes: d.focusedMinutes,
      completionPct: d.totalPlannedMinutes ? Math.round(((d.completedMinutes + d.taskDoneMinutes) / d.totalPlannedMinutes) * 100) : 0,
      tasksDone: d.tasksDone,
      tasksPlanned: d.tasksPlanned,
      active: d.hasAnyActivity,
    })),
    recommendations: recommendations.slice(0, 4).map(({ text, action }) => ({ text, action })),
  }
}

/** Label for the week: "Sep 15 – Sep 21" */
export function weekLabel(from, to) {
  const short = (key) => {
    const [, m, d] = key.split('-').map(Number)
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return `${months[m - 1]} ${d}`
  }
  return `${short(from)} – ${short(to)}`
}
