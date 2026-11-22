/* -------------------------------------------------------------------------
   PAPER · priorities — deterministic mission scoring.

   `scoreMission` answers "why does this matter now?" with an inspectable
   number and an explicit list of reasons. The weights live in one place,
   every reason is a sentence tied to a real record, and the same inputs
   always produce the same ranking.
   ------------------------------------------------------------------------- */

import { diffDays } from '../dates.js'
import { finding } from './core.js'

/** The whole scoring policy, in one inspectable table. */
export const WEIGHTS = {
  overdueBase: 40,
  overduePerDay: 2,
  overdueCap: 20,
  dueToday: 25,
  deadlineNear: 20,
  deadlineSoon: 10,
  priorityHigh: 15,
  priorityMedium: 8,
  priorityLow: 3,
  top3: 18,
  inProgress: 10,
  linkedGoal: 6,
  linkedProject: 4,
  perPostponement: -3,
  postponementCap: -12,
  inbox: -5,
}

const POSTPONE_ACTIONS = new Set(['postponed', 'rescheduled', 'skipped'])

/** How many times this mission has been pushed back (from its own history). */
export function postponementCount(task) {
  return (task.history || []).filter((h) => h && POSTPONE_ACTIONS.has(h.action)).length
}

/**
 * Score one mission for "needs attention now".
 * @param {any} task
 * @param {{ todayKey: string, top3Ids?: string[], goalAtRiskIds?: Set<string> }} ctx
 * @returns {{ score: number, reasons: any[] }}
 */
export function scoreMission(task, ctx) {
  const todayKey = ctx.todayKey
  let score = 0
  const reasons = []

  if (task.date && task.date < todayKey && !task.done) {
    const days = Math.min(diffDays(task.date, todayKey), 10)
    const overduePoints = WEIGHTS.overdueBase + Math.min(days * WEIGHTS.overduePerDay, WEIGHTS.overdueCap)
    score += overduePoints
    reasons.push(finding('calculation', `Overdue by ${days} day${days === 1 ? '' : 's'} — worth ${overduePoints} points of attention.`, 'priorities'))
  }
  if (task.date === todayKey) {
    score += WEIGHTS.dueToday
    reasons.push(finding('fact', 'Scheduled for today.', 'priorities'))
  }
  if (task.deadline) {
    const toDeadline = diffDays(todayKey, task.deadline)
    if (toDeadline < 0 && !task.done) {
      score += WEIGHTS.overdueBase
      reasons.push(finding('fact', `Deadline passed ${-toDeadline} day${toDeadline === -1 ? '' : 's'} ago.`, 'priorities'))
    } else if (toDeadline >= 0 && toDeadline <= 3) {
      score += WEIGHTS.deadlineNear
      reasons.push(finding('fact', `Deadline is ${toDeadline === 0 ? 'today' : `in ${toDeadline} day${toDeadline === 1 ? '' : 's'}`}.`, 'priorities'))
    } else if (toDeadline > 3 && toDeadline <= 7) {
      score += WEIGHTS.deadlineSoon
      reasons.push(finding('fact', `Deadline is within a week (${toDeadline} days).`, 'priorities'))
    }
  }
  const prio = task.priority === 'high' ? WEIGHTS.priorityHigh : task.priority === 'low' ? WEIGHTS.priorityLow : WEIGHTS.priorityMedium
  score += prio
  reasons.push(finding('fact', `${task.priority === 'high' ? 'High' : task.priority === 'low' ? 'Low' : 'Medium'} priority mission.`, 'priorities'))

  if ((ctx.top3Ids || []).includes(task.id)) {
    score += WEIGHTS.top3
    reasons.push(finding('fact', 'One of today’s Top 3 objectives.', 'priorities'))
  }
  if (task.status === 'in_progress') {
    score += WEIGHTS.inProgress
    reasons.push(finding('fact', 'Already in progress — finishing it now is cheaper than restarting.', 'priorities'))
  }
  if (task.goalId) {
    score += WEIGHTS.linkedGoal
    if (ctx.goalAtRiskIds && ctx.goalAtRiskIds.has(task.goalId)) {
      score += 6
      reasons.push(finding('fact', 'Serves a goal that is currently at risk.', 'priorities'))
    } else {
      reasons.push(finding('fact', 'Connected to one of your goals.', 'priorities'))
    }
  }
  if (task.projectId) score += WEIGHTS.linkedProject

  const pushes = postponementCount(task)
  if (pushes > 0) {
    const penalty = Math.max(WEIGHTS.postponementCap, pushes * WEIGHTS.perPostponement)
    score += penalty
    reasons.push(finding('calculation', `Postponed ${pushes} time${pushes === 1 ? '' : 's'} — attention decays on work that keeps moving.`, 'priorities'))
  }
  if (task.inbox && !task.date) {
    score += WEIGHTS.inbox
    reasons.push(finding('fact', 'Still an inbox capture with no date.', 'priorities'))
  }

  return { score, reasons }
}

/**
 * Rank open missions by attention score. Ties break on priority then title so
 * the order is stable across renders.
 */
export function rankMissions(tasks, ctx) {
  return tasks
    .filter((t) => !t.done && t.status !== 'cancelled')
    .map((task) => {
      const { score, reasons } = scoreMission(task, ctx)
      return { task, score, reasons }
    })
    .sort((a, b) => b.score - a.score || String(a.task.title).localeCompare(String(b.task.title)))
}

/**
 * Today's objectives: the Top 3 in the user's own order, then the highest
 * scored unclaimed missions until three slots are filled. Each objective
 * explains why it is here.
 */
export function topObjectives(state, ctx) {
  const top3Ids = ctx.top3Ids || []
  const ranked = rankMissions(ctx.openTasks, ctx)
  const byId = new Map(ranked.map((r) => [r.task.id, r]))
  const objectives = []
  for (const id of top3Ids) {
    const entry = byId.get(id)
    if (entry) objectives.push({ ...entry, source: 'top3' })
  }
  for (const entry of ranked) {
    if (objectives.length >= 3) break
    if (objectives.some((o) => o.task.id === entry.task.id)) continue
    if (entry.task.date === ctx.todayKey || entry.task.date < ctx.todayKey) {
      objectives.push({ ...entry, source: 'ranking' })
    }
  }
  return objectives
}
