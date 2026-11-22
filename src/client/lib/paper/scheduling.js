/* -------------------------------------------------------------------------
   PAPER · scheduling — time intelligence over the real schedule.

   Answers: how much time is actually available, how loaded the days are,
   where the conflicts are, and what a realistic allocation looks like.
   PAPER never assumes unlimited energy: capacity is working hours minus
   protected time minus what is already committed.
   ------------------------------------------------------------------------- */

import { addDays, dateKey, minutesOfDay } from '../dates.js'
import { scheduleFor, scheduleConflicts, itemDone, freeIntervals } from '../planner.js'
import { isRestBlock } from '../forecast.js'
import { finding, minutesLabel } from './core.js'

/** Working-day capacity in minutes: working hours, nothing else. */
export function capacityMinutes(settings) {
  const start = minutesOfDay(settings?.workingHours?.start || '09:00')
  const end = minutesOfDay(settings?.workingHours?.end || '18:00')
  return Math.max(0, end - start)
}

/** Committed minutes for one day (real blocks and dated missions, no rest). */
export function committedMinutes(state, dayKey) {
  return scheduleFor(state, dayKey)
    .filter((b) => !isRestBlock(b) && !b.protected)
    .reduce((sum, b) => sum + (b.duration || 60), 0)
}

/**
 * The load picture for one day.
 * @returns {{ dayKey, capacityMinutes, committedMinutes, loadPct, remainingMinutes, status, findings: any[] }}
 */
export function dayLoad(state, dayKey, { settings = state?.settings || {} } = {}) {
  const capacity = capacityMinutes(settings)
  const committed = committedMinutes(state, dayKey)
  const loadPct = capacity > 0 ? Math.round((committed / capacity) * 100) : 0
  const status = loadPct > 100 ? 'overloaded' : loadPct >= 80 ? 'full' : loadPct >= 40 ? 'balanced' : 'light'
  const findings = [
    finding('calculation', `${minutesLabel(committed)} committed against ${minutesLabel(capacity)} of working time (${loadPct}%).`, 'scheduling'),
  ]
  return { dayKey, capacityMinutes: capacity, committedMinutes: committed, loadPct, remainingMinutes: Math.max(0, capacity - committed), status, findings }
}

/** Load for the next `days` days starting today. */
export function weekLoad(state, todayKey, { days = 7, settings = state?.settings || {} } = {}) {
  const out = []
  for (let i = 0; i < days; i += 1) {
    out.push(dayLoad(state, addDays(todayKey, i), { settings }))
  }
  return out
}

/** Scheduling conflicts for a day (block overlaps and protected-time clashes). */
export function dayConflicts(state, dayKey, { settings = state?.settings || {} } = {}) {
  const blocks = scheduleFor(state, dayKey)
  return scheduleConflicts(blocks, settings.protectedTime || [], dayKey)
}

/**
 * Free windows inside working hours.
 * `fromMinutes` limits today's search to "from now on".
 */
export function freeWindows(state, dayKey, { fromMinutes = null, minMinutes = 20, settings = state?.settings || {} } = {}) {
  const start = Math.max(minutesOfDay(settings?.workingHours?.start || '09:00'), fromMinutes ?? 0)
  const end = minutesOfDay(settings?.workingHours?.end || '18:00')
  if (end <= start) return []
  const blocks = scheduleFor(state, dayKey)
  const blockers = blocks.map((b) => ({ start: minutesOfDay(b.time), end: minutesOfDay(b.time) + (b.duration || 60) }))
  return freeIntervals(start, end, blockers).filter((iv) => iv.end - iv.start >= minMinutes)
}

function minutesToLabel(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * A realistic place to put `minutes` of work — today if the day still has the
 * room, otherwise the earliest day that does. Returns a proposal, never a
 * booking: nothing is scheduled until the user confirms.
 */
export function proposeAllocation(state, ctx, { minutes = 30, preferToday = true } = {}) {
  const todayWindows = preferToday
    ? freeWindows(state, ctx.todayKey, { fromMinutes: ctx.nowMinutes, minMinutes: Math.min(minutes, 20), settings: ctx.settings })
    : []
  const todayFit = todayWindows.find((iv) => iv.end - iv.start >= minutes)
  if (todayFit) {
    return {
      dayKey: ctx.todayKey,
      startLabel: minutesToLabel(todayFit.start),
      minutes,
      findings: [
        finding('calculation', `${minutesLabel(minutes)} fits today in the free window ${minutesToLabel(todayFit.start)}–${minutesToLabel(todayFit.end)}.`, 'scheduling'),
      ],
    }
  }
  for (let i = 1; i <= 14; i += 1) {
    const dayKey = addDays(ctx.todayKey, i)
    const windows = freeWindows(state, dayKey, { minMinutes: Math.min(minutes, 20), settings: ctx.settings })
    const fit = windows.find((iv) => iv.end - iv.start >= minutes)
    if (fit) {
      return {
        dayKey,
        startLabel: minutesToLabel(fit.start),
        minutes,
        findings: [
          finding('calculation', `Today has ${minutesLabel(todayWindows.reduce((s, iv) => s + (iv.end - iv.start), 0))} of usable free time — ${minutesLabel(minutes)} fits on ${dayKey} at ${minutesToLabel(fit.start)}.`, 'scheduling'),
        ],
      }
    }
  }
  return {
    dayKey: null,
    startLabel: null,
    minutes,
    findings: [finding('missing', 'No free window of that length exists in the next two weeks at current working hours.', 'scheduling')],
  }
}

/** Remaining free minutes today inside working hours (from now), from the snapshot. */
export function remainingFreeToday(ctx) {
  const blockers = ctx.blocks.map((b) => ({ start: minutesOfDay(b.time), end: minutesOfDay(b.time) + (b.duration || 60) }))
  const start = Math.min(Math.max(ctx.workingStart, ctx.nowMinutes), ctx.workingEnd)
  return freeIntervals(start, ctx.workingEnd, blockers).reduce((sum, iv) => sum + (iv.end - iv.start), 0)
}
