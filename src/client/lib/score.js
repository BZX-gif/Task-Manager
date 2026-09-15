/* -------------------------------------------------------------------------
   DAILY SCORE (0–100) — deterministic, documented, not arbitrary
   -------------------------------------------------------------------------
   Four weighted signals, plus a small overdue penalty:

     Tasks      30  completed / planned for the day
     Top 3      25  completed / selected priorities (defaults to 3)
     Focus      20  focused minutes / focus target (default 180 min)
     Schedule   20  timetable blocks completed / blocks already elapsed

   Rules that keep it fair rather than brutal:
     • A component with no data is *excluded* and its weight is redistributed
       across the remaining components (renormalised), so an empty morning or
       an unplanned day never wipes the score out.
     • Timetable adherence only looks at blocks that have already started, so
       you are not punished for the evening blocks at 9 AM.
     • Overdue open tasks cost a small, capped penalty (4 points each, max 15).
     • `pace` is the score you would have if you were exactly on schedule for
       the elapsed part of the day (100 at end of day) — used for the
       "on track / behind" hint, never subtracted from the score.

   Weights are exported so the UI can show the exact formula to the user.
   ------------------------------------------------------------------------- */

import { minutesOfDay, nowMinutes as nowMinutesOf } from './dates.js'

export const SCORE_WEIGHTS = {
  tasks: 30,
  top3: 25,
  focus: 20,
  schedule: 20,
}

export const OVERDUE_PENALTY_PER_TASK = 4
export const OVERDUE_PENALTY_MAX = 15
export const ON_TRACK_TOLERANCE = 10

/**
 * @typedef {Object} ScoreInput
 * @property {string} dateKey                     day being scored
 * @property {string} todayKey                    the real "today" (for elapsed-time logic)
 * @property {number} [nowMinutes]                minutes past midnight
 * @property {Array<{id:string,done:boolean}>} [plannedTasks]
 * @property {string[]} [top3Ids]
 * @property {number} [focusedMinutes]
 * @property {number} [focusTargetMinutes]
 * @property {Array<{id:string,done:boolean,start:number,duration:number}>} [blocks]
 * @property {number} [overdueTaskCount]
 * @property {number} [dayEndMinutes]
 */

/** @param {ScoreInput} input */
export function computeDailyScore(input) {
  const {
    dateKey,
    todayKey,
    nowMinutes = 0,
    plannedTasks = [],
    top3Ids = [],
    focusedMinutes = 0,
    focusTargetMinutes = 180,
    blocks = [],
    overdueTaskCount = 0,
    dayEndMinutes = 23 * 60 + 59,
  } = input

  const isToday = dateKey === todayKey
  const isPast = dateKey < todayKey
  const effectiveNow = isPast ? 24 * 60 : isToday ? nowMinutes : 0

  /** @type {Array<{key:string,label:string,weight:number,available:boolean,ratio:number,detail:string}>} */
  const parts = []

  // --- Tasks -----------------------------------------------------------
  const planned = plannedTasks.length
  const tasksDone = plannedTasks.filter((t) => t.done).length
  parts.push({
    key: 'tasks',
    label: 'Tasks',
    weight: SCORE_WEIGHTS.tasks,
    available: planned > 0,
    ratio: planned ? tasksDone / planned : 0,
    detail: `${tasksDone}/${planned}`,
  })

  // --- Top 3 -----------------------------------------------------------
  const top3Total = top3Ids.length
  const top3Done = top3Ids.filter((id) => plannedTasks.some((t) => t.id === id && t.done)).length
  parts.push({
    key: 'top3',
    label: 'Top 3',
    weight: SCORE_WEIGHTS.top3,
    available: top3Total > 0,
    ratio: top3Total ? top3Done / top3Total : 0,
    detail: `${top3Done}/${top3Total || 0}`,
  })

  // --- Focus -----------------------------------------------------------
  const target = focusTargetMinutes > 0 ? focusTargetMinutes : 180
  parts.push({
    key: 'focus',
    label: 'Focus',
    weight: SCORE_WEIGHTS.focus,
    available: true,
    ratio: Math.min(1, Math.max(0, focusedMinutes) / target),
    detail: `${Math.round(focusedMinutes)}m`,
  })

  // --- Timetable adherence ---------------------------------------------
  const elapsedBlocks = blocks.filter((b) => (isPast ? true : b.start <= effectiveNow))
  const elapsedDone = elapsedBlocks.filter((b) => b.done).length
  parts.push({
    key: 'schedule',
    label: 'Schedule',
    weight: SCORE_WEIGHTS.schedule,
    available: elapsedBlocks.length > 0,
    ratio: elapsedBlocks.length ? elapsedDone / elapsedBlocks.length : 0,
    detail: `${elapsedDone}/${elapsedBlocks.length}`,
  })

  const available = parts.filter((p) => p.available)
  const availableWeight = available.reduce((sum, p) => sum + p.weight, 0)
  const earnedWeight = available.reduce((sum, p) => sum + p.weight * p.ratio, 0)
  const base = availableWeight > 0 ? (earnedWeight / availableWeight) * 100 : 0

  const penalty = Math.min(OVERDUE_PENALTY_MAX, Math.max(0, overdueTaskCount) * OVERDUE_PENALTY_PER_TASK)
  const score = Math.max(0, Math.min(100, Math.round(base - penalty)))

  const totalDay = Math.max(1, dayEndMinutes)
  const pace = isPast ? 100 : isToday ? Math.round(Math.min(1, effectiveNow / totalDay) * 100) : 0

  return {
    dateKey,
    score,
    base: Math.round(base),
    penalty,
    hasData: availableWeight > 0 && (planned > 0 || top3Total > 0 || elapsedBlocks.length > 0 || focusedMinutes > 0),
    pace,
    onTrack: score >= pace - ON_TRACK_TOLERANCE,
    /** the four components with their contribution, ready for the UI */
    parts: parts.map((p) => ({
      ...p,
      /** 0–100 contribution of this component after re-normalisation */
      contribution: availableWeight > 0 && p.available ? Math.round((p.weight / availableWeight) * p.ratio * 100) : 0,
      maxContribution: availableWeight > 0 && p.available ? Math.round((p.weight / availableWeight) * 100) : 0,
    })),
    overdueTaskCount,
    focusedMinutes: Math.round(focusedMinutes),
    focusTargetMinutes: target,
  }
}

/**
 * Human readable formula — shown in the Daily Score card help text so the
 * number is never a black box.
 */
export function describeScoreFormula() {
  return [
    `Tasks ${SCORE_WEIGHTS.tasks}% · completed vs planned for today`,
    `Top 3 ${SCORE_WEIGHTS.top3}% · priorities finished`,
    `Focus ${SCORE_WEIGHTS.focus}% · focused minutes vs daily target`,
    `Schedule ${SCORE_WEIGHTS.schedule}% · timetable blocks already elapsed`,
    `Overdue −${OVERDUE_PENALTY_PER_TASK} each (max −${OVERDUE_PENALTY_MAX})`,
    'Components with no data are dropped and the rest are re-weighted.',
  ]
}

/** Build the ScoreInput from app state (keeps views thin & pure logic testable). */
export function buildScoreInput(state, dateKey, todayKey, now = new Date()) {
  const tasksForDay = state.tasks.filter((t) => t.date === dateKey)
  const top3Ids = (state.top3?.[dateKey] || []).filter((id) => tasksForDay.some((t) => t.id === id))
  const log = state.completionLog?.[dateKey] || { ttDone: [] }
  const focusedMinutes = focusedMinutesOn(state.focus?.sessions || [], dateKey)
  return {
    dateKey,
    todayKey,
    nowMinutes: nowMinutesOf(now),
    plannedTasks: tasksForDay.map((t) => ({ id: t.id, done: !!t.done })),
    top3Ids,
    focusedMinutes,
    focusTargetMinutes: state.settings?.focus?.targetMinutes ?? 180,
    blocks: (state.timetable || []).map((b) => ({
      id: b.id,
      done: log.ttDone.includes(b.id),
      start: minutesOfDay(b.time),
      duration: b.duration || 60,
    })),
    overdueTaskCount: overdueTasks(state, todayKey).length,
    dayEndMinutes: minutesOfDay(state.settings?.dayEnd || '23:30'),
  }
}

/** Tasks whose date has passed and are still open. */
export function overdueTasks(state, todayKey) {
  return (state.tasks || []).filter((t) => !t.done && t.date && t.date < todayKey && !t.inbox)
}

/** Focus minutes recorded on a given day (break sessions excluded). */
export function focusedMinutesOn(sessions, dateKey) {
  return sessions
    .filter((s) => s.mode !== 'break' && s.date === dateKey)
    .reduce((sum, s) => sum + (s.focusedSeconds || 0) / 60, 0)
}
