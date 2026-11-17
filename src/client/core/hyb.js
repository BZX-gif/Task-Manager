/* -------------------------------------------------------------------------
   HYB ACTIONS — the only place that writes HYB plans
   -------------------------------------------------------------------------
   Thin, explicit mutations over `state.hyb.plans`. Every function goes through
   `commit()`, so plans are persisted, the score/achievement sync runs and every
   open view (calendar, deck, studio, schedule) re-renders from one truth.

   Nothing here invents a plan, a date or a completion: the caller decides.
   ------------------------------------------------------------------------- */

import { commit, currentDayKey, state } from './store.js'
import { toast } from './dom.js'
import { saveDay } from './actions.js'
import { addDays, dateKey, isValidKey } from '../lib/dates.js'
import { scheduleFor } from '../lib/planner.js'
import { uid } from '../lib/state.js'
import {
  hybContext,
  hybStats,
  makeHybPlan,
  nextHybPlan,
  occurrencesOn,
  planRecurrence,
  planToBlock,
  planToTaskPayload,
} from '../lib/hyb.js'

export function hybPlans() {
  if (!state.hyb) state.hyb = { plans: [] }
  if (!Array.isArray(state.hyb.plans)) state.hyb.plans = []
  return state.hyb.plans
}

export function getHybPlan(id) {
  return hybPlans().find((plan) => plan.id === id) || null
}

export function hybSummary(options = {}) {
  return hybStats(hybPlans(), {
    todayKey: options.todayKey || currentDayKey(),
    days: options.days ?? 7,
    weekStart: state.settings?.weekStart ?? 1,
  })
}

export function hybNext(options = {}) {
  const now = options.now || new Date()
  return nextHybPlan(hybPlans(), { todayKey: options.todayKey || currentDayKey(), now })
}

export function hybDay(dayKey = currentDayKey()) {
  return occurrencesOn(hybPlans(), dayKey)
}

/** Create a plan. `input` is whatever the deck/studio collected. */
export function addHybPlan(input = {}, { silentToast = false } = {}) {
  const ctx = hybContext({ now: Date.now(), id: uid })
  const plan = makeHybPlan(input, ctx)
  commit((s) => {
    if (!s.hyb) s.hyb = { plans: [] }
    if (!Array.isArray(s.hyb.plans)) s.hyb.plans = []
    s.hyb.plans.push(plan)
  })
  if (!silentToast) toast(`HYB plan added · ${plan.title}`, 'success')
  return plan
}

/** Patch an existing plan; unknown keys are ignored by normalisation on load. */
export function updateHybPlan(id, patch = {}, { message = 'HYB plan updated' } = {}) {
  const existing = getHybPlan(id)
  if (!existing) return null
  const updated = makeHybPlan({ ...existing, ...patch, id: existing.id, createdAt: existing.createdAt }, hybContext({ now: Date.now() }))
  commit((s) => {
    const index = s.hyb.plans.findIndex((plan) => plan.id === id)
    if (index >= 0) s.hyb.plans[index] = updated
  })
  if (message) toast(message, 'success')
  return updated
}

export function removeHybPlan(id, { message = 'HYB plan removed' } = {}) {
  const existing = getHybPlan(id)
  if (!existing) return false
  commit((s) => {
    s.hyb.plans = s.hyb.plans.filter((plan) => plan.id !== id)
  })
  if (message) toast(message, 'info')
  return true
}

/**
 * Finish (or reopen) a plan on one day.
 * One-day plans change `status`; repeating plans write that day into `log`, so
 * the series itself stays open and the history stays true.
 */
export function toggleHybPlanDay(id, dayKey = currentDayKey()) {
  const plan = getHybPlan(id)
  if (!plan) return false
  const day = isValidKey(dayKey) ? dayKey : currentDayKey()
  const repeating = plan.repeat !== 'none'
  const wasDone = repeating ? plan.log?.[day] === 'done' : plan.status === 'done'
  commit((s) => {
    const target = s.hyb.plans.find((entry) => entry.id === id)
    if (!target) return
    target.updatedAt = Date.now()
    if (repeating) {
      target.log = { ...(target.log || {}) }
      if (wasDone) delete target.log[day]
      else target.log[day] = 'done'
      if (target.status === 'dropped') target.status = 'planned'
    } else {
      target.status = wasDone ? 'planned' : 'done'
      target.completedAt = wasDone ? null : Date.now()
    }
    if (!wasDone && Array.isArray(target.steps) && target.steps.length) {
      const done = target.steps.filter((step) => step.done).length
      target.progress = Math.max(target.progress || 0, Math.round((done / target.steps.length) * 100))
    }
  })
  toast(wasDone ? `Reopened · ${plan.title}` : `Done · ${plan.title}`, wasDone ? 'info' : 'success')
  return !wasDone
}

/** Mark one day of a repeating plan as skipped — deliberately not a failure. */
export function skipHybPlanDay(id, dayKey = currentDayKey()) {
  const plan = getHybPlan(id)
  if (!plan) return false
  const day = isValidKey(dayKey) ? dayKey : currentDayKey()
  commit((s) => {
    const target = s.hyb.plans.find((entry) => entry.id === id)
    if (!target) return
    target.log = { ...(target.log || {}) }
    if (target.log[day] === 'skipped') delete target.log[day]
    else target.log[day] = 'skipped'
    target.updatedAt = Date.now()
  })
  toast(plan.repeat === 'none' ? 'Plan left alone — nothing was marked.' : 'Day skipped. The series continues.', 'info')
  return true
}

export function dropHybPlan(id) {
  const plan = getHybPlan(id)
  if (!plan) return false
  commit((s) => {
    const target = s.hyb.plans.find((entry) => entry.id === id)
    if (!target) return
    target.status = target.status === 'dropped' ? 'planned' : 'dropped'
    target.updatedAt = Date.now()
  })
  toast(plan.status === 'dropped' ? 'Plan brought back.' : 'Plan set aside. It can come back any time.', 'info')
  return true
}

export function setHybStepDone(planId, stepId, done = true) {
  const plan = getHybPlan(planId)
  if (!plan) return false
  commit((s) => {
    const target = s.hyb.plans.find((entry) => entry.id === planId)
    const step = target?.steps?.find((entry) => entry.id === stepId)
    if (!step) return
    step.done = !!done
    step.title = step.title
    target.progress = target.steps.length ? Math.round((target.steps.filter((entry) => entry.done).length / target.steps.length) * 100) : 0
    target.updatedAt = Date.now()
  })
  return true
}

export function moveHybPlanDate(id, date) {
  if (!isValidKey(date)) return false
  const plan = getHybPlan(id)
  if (!plan) return false
  commit((s) => {
    const target = s.hyb.plans.find((entry) => entry.id === id)
    if (!target) return
    target.date = date
    if (target.status === 'done' && target.repeat === 'none') {
      target.status = 'planned'
      target.completedAt = null
    }
    target.updatedAt = Date.now()
  })
  toast(`Moved to ${date}`, 'info')
  return true
}

/** One tap later: tomorrow for a one-day plan, the next occurrence for a series. */
export function postponeHybPlan(id, { days = 1 } = {}) {
  const plan = getHybPlan(id)
  if (!plan) return false
  const from = plan.date || currentDayKey()
  return moveHybPlanDate(id, addDays(from, Math.max(1, Number(days) || 1)))
}

export function duplicateHybPlan(id, { date = null } = {}) {
  const plan = getHybPlan(id)
  if (!plan) return null
  const copy = addHybPlan(
    {
      ...plan,
      id: null,
      title: plan.title,
      date: date || plan.date,
      status: 'planned',
      completedAt: null,
      log: {},
      steps: plan.steps.map((step) => ({ ...step, id: null, done: false })),
      missionId: null,
    },
    { silentToast: true },
  )
  toast('Plan duplicated', 'success')
  return copy
}

/**
 * Promote a HYB plan to a real mission (with recurrence when the plan repeats),
 * and remember the link both ways so nothing is created twice.
 */
export function hybPlanToMission(id, { date = null, keepPlan = true } = {}) {
  const plan = getHybPlan(id)
  if (!plan) return null
  const when = isValidDate(date) ? date : plan.date || currentDayKey()
  const missionId = uid()
  const payload = { ...planToTaskPayload(plan, { date: when, id: missionId }), recurrence: planRecurrence(plan) }
  if (payload.recurrence) payload.seriesId = missionId
  commit((s) => {
    s.tasks.push(payload)
    const target = s.hyb.plans.find((entry) => entry.id === id)
    if (target) {
      target.missionId = missionId
      target.updatedAt = Date.now()
      if (!keepPlan) target.status = 'dropped'
    }
  })
  toast(`Mission created · ${plan.title}`, 'success')
  return missionId
}

function isValidDate(value) {
  return typeof value === 'string' && isValidKey(value)
}

/**
 * Put a plan on the day's real schedule as a time block, so the Schedule,
 * Forecast and Focus Room all see it. Existing blocks are never rewritten.
 */
export function scheduleHybPlan(id, { date = null, time = null, duration = null } = {}) {
  const plan = getHybPlan(id)
  if (!plan) return false
  const when = isValidDate(date) ? date : plan.date || currentDayKey()
  const blocks = scheduleFor(state, when)
  const block = { ...planToBlock(plan, when, { startTime: time }), duration: duration || plan.minutes }
  if (blocks.some((entry) => entry.id === block.id)) {
    toast('This plan is already on that day.', 'info')
    return false
  }
  const next = [...blocks, block].sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')))
  saveDay(when, next, `HYB plan scheduled · ${plan.title}`)
  return true
}

/** Remove a plan's time block from a day without touching the plan itself. */
export function unscheduleHybPlan(id, date = currentDayKey()) {
  const plan = getHybPlan(id)
  if (!plan || !isValidKey(date)) return false
  const blocks = scheduleFor(state, date).filter((block) => block.id !== `hyb:${id}` && block.hybPlanId !== id)
  saveDay(date, blocks, 'Plan taken off the schedule', { undoable: false })
  return !!plan
}

/** Bulk finish for a whole day ("clear today's HYB plans"). */
export function completeHybDay(dayKey = currentDayKey()) {
  const day = isValidKey(dayKey) ? dayKey : currentDayKey()
  const open = occurrencesOn(hybPlans(), day).filter((occurrence) => !occurrence.done && !occurrence.skipped)
  if (!open.length) {
    toast('Nothing left open on that day.', 'info')
    return 0
  }
  commit((s) => {
    for (const occurrence of open) {
      const target = s.hyb.plans.find((entry) => entry.id === occurrence.plan.id)
      if (!target) continue
      target.updatedAt = Date.now()
      if (target.repeat === 'none') {
        target.status = 'done'
        target.completedAt = Date.now()
      } else {
        target.log = { ...(target.log || {}), [day]: 'done' }
      }
    }
  })
  toast(`${open.length} HYB plan${open.length === 1 ? '' : 's'} finished`, 'success')
  return open.length
}

/** A blank plan shaped for the editor form (never written to the store). */
export function blankHybPlan({ date = null, kind = 'study', startTime = null, minutes = null } = {}) {
  return makeHybPlan(
    {
      id: uid(),
      title: '',
      date: isValidKey(date) ? date : null,
      startTime,
      minutes: minutes || state.settings?.hyb?.defaultMinutes || 60,
      kind,
    },
    hybContext({ now: Date.now() }),
  )
}

export { dateKey }
