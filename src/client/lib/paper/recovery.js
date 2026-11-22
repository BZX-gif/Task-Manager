/* -------------------------------------------------------------------------
   PAPER · recovery — restore control when the day has slipped.

   Recovery intelligence answers five questions without guilt:
     what is urgent · what can wait · what should be rescheduled ·
     what needs a new plan · what might be abandoned (with confirmation).

   It builds on the deterministic recovery planner in lib/recovery.js and
   never mutates anything.
   ------------------------------------------------------------------------- */

import { recoveryProposal } from '../planner.js'
import { diffDays } from '../dates.js'
import { finding, minutesLabel, relativeDays } from './core.js'
import { rankMissions } from './priorities.js'

/**
 * The recovery brief for a day that has gone off plan.
 * @param {any} state
 * @param {any} ctx workspace context
 */
export function recoveryBrief(state, ctx) {
  const todayKey = ctx.todayKey

  const urgent = []
  const canWait = []
  for (const task of ctx.overdue) {
    const age = diffDays(task.date, todayKey)
    const entry = { task, age }
    if (age >= 3 || task.priority === 'high' || task.deadline) urgent.push(entry)
    else canWait.push(entry)
  }
  for (const task of ctx.todayTasks) {
    if (task.deadline && diffDays(todayKey, task.deadline) <= 1) urgent.push({ task, age: 0 })
  }

  const ranked = rankMissions(ctx.openTasks, { todayKey, top3Ids: ctx.top3Ids })
  const rescheduleCandidates = ranked
    .filter((r) => r.task.date && r.task.date <= todayKey && !r.task.deadline && r.task.priority !== 'high')
    .slice(0, 3)

  const abandonCandidates = ranked
    .filter((r) => (r.task.history || []).filter((h) => h && h.action === 'postponed').length >= 3)
    .slice(0, 2)

  let proposal = null
  try {
    proposal = recoveryProposal(state, todayKey, ctx.now)
  } catch {
    proposal = null
  }

  const why = []
  if (urgent.length) {
    why.push(finding('fact', `${urgent.length} item${urgent.length === 1 ? '' : 's'} are genuinely urgent (deadline, age or priority): ${urgent.slice(0, 3).map((u) => `“${u.task.title}”`).join('; ')}.`, 'recovery'))
  }
  if (canWait.length) {
    why.push(finding('calculation', `${canWait.length} overdue item${canWait.length === 1 ? '' : 's'} can safely wait a day: ${canWait.slice(0, 3).map((u) => `“${u.task.title}”`).join('; ')}.`, 'recovery'))
  }
  if (rescheduleCandidates.length) {
    why.push(finding('recommendation', `${rescheduleCandidates.length} mission${rescheduleCandidates.length === 1 ? '' : 's'} without a deadline can be rescheduled rather than rushed.`, 'recovery'))
  }
  if (!urgent.length && !canWait.length) {
    why.push(finding('fact', 'Nothing overdue is recorded — the day can be reshaped from what is left.', 'recovery'))
  }

  return {
    todayKey,
    urgent,
    canWait,
    rescheduleCandidates,
    abandonCandidates,
    proposal,
    remainingFreeMinutes: Math.max(0, ctx.workingEnd - Math.max(ctx.nowMinutes, ctx.workingStart)),
    why,
  }
}

/** One calm paragraph summarising the recovery situation. */
export function recoverySummary(brief, ctx) {
  const bits = []
  bits.push(brief.urgent.length ? `${brief.urgent.length} urgent` : 'nothing urgent')
  bits.push(brief.canWait.length ? `${brief.canWait.length} can wait` : 'nothing overdue')
  const free = minutesLabel(Math.max(0, ctx.workingEnd - ctx.nowMinutes))
  bits.push(`${free} of the working day left`)
  return `Recovery view: ${bits.join(' · ')}. The goal is to restore control, not to clear everything.`
}

/** Relative-age label for a recovery row. */
export function ageLabel(task, todayKey) {
  if (!task.date) return 'No date'
  return relativeDays(-diffDays(task.date, todayKey))
}
