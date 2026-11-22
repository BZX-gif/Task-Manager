/* -------------------------------------------------------------------------
   PAPER · context — the single workspace snapshot every module reasons over.

   `buildWorkspaceContext(state, { now })` reads the real store once and
   returns plain facts. Nothing here interprets; interpretation lives in the
   reasoning modules. Every derived number is reproducible from this snapshot.
   ------------------------------------------------------------------------- */

import { addDays, dateKey, diffDays, minutesOfDay } from '../dates.js'
import { scheduleFor, scheduleConflicts, itemDone, freeIntervals } from '../planner.js'
import { overdueTasks } from '../score.js'
import { sessionTotals } from '../focus.js'
import { top3Stats } from '../top3.js'
import { goalProgress, projectProgress } from '../relationships.js'
import { buildForecast } from '../forecast.js'
import { dayStats } from '../daystats.js'

/**
 * @param {any} state
 * @param {{ now?: Date }} [options]
 */
export function buildWorkspaceContext(state, { now = new Date() } = {}) {
  const todayKey = dateKey(now)
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const tasks = Array.isArray(state?.tasks) ? state.tasks : []
  const goals = Array.isArray(state?.goals) ? state.goals : []
  const projects = Array.isArray(state?.projects) ? state.projects : []
  const settings = state?.settings || {}

  const openTasks = tasks.filter((t) => !t.done && t.status !== 'cancelled' && t.status !== 'completed')
  const overdue = overdueTasks(state, todayKey)
  const todayTasks = openTasks.filter((t) => t.date === todayKey)
  const datedAhead = openTasks
    .filter((t) => (t.date && t.date > todayKey) || (t.deadline && t.deadline >= todayKey))
    .sort((a, b) => String(a.date || a.deadline).localeCompare(String(b.date || b.deadline)))
  const inbox = openTasks.filter((t) => t.inbox && !t.date)

  const blocks = scheduleFor(state, todayKey)
  const upcomingBlocks = blocks.filter((b) => !itemDone(state, b, todayKey))
  const conflicts = scheduleConflicts(blocks, settings.protectedTime || [], todayKey)

  const workingStart = minutesOfDay(settings.workingHours?.start || '09:00')
  const workingEnd = minutesOfDay(settings.workingHours?.end || '18:00')
  const dayEnd = minutesOfDay(settings.dayEnd || '23:30')

  const top3 = top3Stats(state, todayKey)
  const top3Ids = top3.items.map((entry) => entry.task.id)
  const stats = dayStats(state, todayKey, { todayKey, now })
  const focus = sessionTotals(state?.focus?.sessions || [], todayKey)

  const goalFacts = goals.map((goal) => ({
    ...goal,
    progressPct: goalProgress(state, goal),
    projectCount: projects.filter((p) => p.goalId === goal.id).length,
    missionCount: tasks.filter((t) => t.goalId === goal.id && !t.done && t.status !== 'cancelled').length,
    doneMissionCount: tasks.filter((t) => t.goalId === goal.id && (t.done || t.status === 'completed')).length,
    milestonesDone: (goal.milestones || []).filter((m) => m.done).length,
    milestonesTotal: (goal.milestones || []).length,
  }))

  const projectFacts = projects.map((project) => ({
    ...project,
    progressPct: projectProgress(state, project),
    missionCount: tasks.filter((t) => t.projectId === project.id && !t.done && t.status !== 'cancelled').length,
  }))

  const daysOfData = {
    scores: Object.keys(state?.scoreHistory || {}).length,
    completions: Object.keys(state?.completionLog || {}).length,
    focusSessions: (state?.focus?.sessions || []).length,
    journal: Object.keys(state?.journal || {}).length,
  }

  const journalToday = state?.journal?.[todayKey] || null

  return {
    now,
    todayKey,
    nowMinutes,
    settings,
    /** missions */
    tasks,
    openTasks,
    overdue,
    todayTasks,
    datedAhead,
    inbox,
    /** time */
    blocks,
    upcomingBlocks,
    conflicts,
    workingStart,
    workingEnd,
    dayEnd,
    focusToday: focus,
    capacityMinutes: Math.max(0, workingEnd - workingStart),
    /** direction */
    goals: goalFacts,
    projects: projectFacts,
    /** daily execution */
    top3,
    top3Ids,
    stats,
    /** record depth — modules must gate insights on this */
    daysOfData,
    journalToday,
    tomorrowKey: addDays(todayKey, 1),
    weekEndKey: addDays(todayKey, 6),
    /** lazy: built only when a module needs the forward view */
    forecastOf(days = 7) {
      return buildForecast(state, { todayKey, days })
    },
  }
}

/** Free working intervals left today (after now) or on a given day. */
export function freeTimeToday(ctx, { minMinutes = 20 } = {}) {
  const end = Math.max(ctx.nowMinutes, ctx.workingEnd)
  const blockers = ctx.blocks.map((b) => ({
    start: minutesOfDay(b.time),
    end: minutesOfDay(b.time) + (b.duration || 60),
  }))
  return freeIntervals(Math.min(ctx.nowMinutes, end), end, blockers).filter((iv) => iv.end - iv.start >= minMinutes)
}

/** Free working intervals on a future day. */
export function freeTimeOn(state, dayKey, { minMinutes = 20 } = {}) {
  const settings = state?.settings || {}
  const start = minutesOfDay(settings.workingHours?.start || '09:00')
  const end = minutesOfDay(settings.workingHours?.end || '18:00')
  const blocks = scheduleFor(state, dayKey)
  const blockers = blocks.map((b) => ({ start: minutesOfDay(b.time), end: minutesOfDay(b.time) + (b.duration || 60) }))
  return freeIntervals(start, end, blockers).filter((iv) => iv.end - iv.start >= minMinutes)
}

/** Days between two date keys, as a plain number. */
export function daysBetween(a, b) {
  return diffDays(a, b)
}
