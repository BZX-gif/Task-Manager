/* -------------------------------------------------------------------------
   PAPER · recommendations — advice with receipts.

   Every recommendation answers three questions in plain language:
     why it matters  (facts/calculation from the workspace)
     what it changes (impact)
     what to do      (a concrete next step, optionally a prepared action)

   Alerts are situations rather than advice and never require a next step.
   Nothing here mutates the workspace.
   ------------------------------------------------------------------------- */

import { diffDays } from '../dates.js'
import { alert, finding, minutesLabel, recommendation, relativeDays, sortRecommendations } from './core.js'
import { rankMissions, topObjectives } from './priorities.js'
import { dayLoad, freeWindows, proposeAllocation, remainingFreeToday, weekLoad } from './scheduling.js'
import { goalHealthAll, projectRisks, dependencyIssues } from './reasoning.js'
import { analyzePatterns, repeatedPostponements } from './history.js'

/* ------------------------------------------------------------------ alerts */

export function generateAlerts(state, ctx) {
  const alerts = []

  // 1 — overdue missions
  if (ctx.overdue.length) {
    const worst = Math.max(...ctx.overdue.map((t) => diffDays(t.date, ctx.todayKey)))
    alerts.push(alert({
      id: 'alert-overdue',
      severity: ctx.overdue.length > 3 || worst > 7 ? 'urgent' : 'warning',
      title: `${ctx.overdue.length} mission${ctx.overdue.length === 1 ? ' is' : 's are'} overdue`,
      detail: `The oldest is ${relativeDays(-worst).replace(' ago', ' overdue')}.`,
      why: [finding('fact', ctx.overdue.map((t) => `“${t.title}” (${t.date})`).slice(0, 4).join('; '), 'recommendations')],
      link: { view: 'tasks' },
    }))
  }

  // 2 — deadlines close to the line
  const closeDeadlines = ctx.openTasks.filter((t) => t.deadline && diffDays(ctx.todayKey, t.deadline) >= 0 && diffDays(ctx.todayKey, t.deadline) <= 3)
  if (closeDeadlines.length) {
    alerts.push(alert({
      id: 'alert-deadlines',
      severity: 'warning',
      title: `${closeDeadlines.length} deadline${closeDeadlines.length === 1 ? '' : 's'} within three days`,
      detail: closeDeadlines.map((t) => `“${t.title}” ${relativeDays(diffDays(ctx.todayKey, t.deadline))}`).slice(0, 3).join(' · '),
      why: [finding('fact', 'Deadlines come from the missions themselves.', 'recommendations')],
      link: { view: 'tasks' },
    }))
  }

  // 3 — schedule conflicts
  if (ctx.conflicts.length) {
    alerts.push(alert({
      id: 'alert-conflicts',
      severity: 'warning',
      title: `${ctx.conflicts.length} scheduling conflict${ctx.conflicts.length === 1 ? '' : 's'} today`,
      detail: 'Two commitments overlap, or one crosses protected time.',
      why: ctx.conflicts.slice(0, 2).map((c) => finding('fact', c.label || 'Overlap detected in today’s schedule.', 'recommendations')),
      link: { view: 'schedule' },
    }))
  }

  // 4 — goals that are slipping
  const health = goalHealthAll(state, ctx)
  const slipping = health.filter((h) => ['at_risk', 'stalled', 'no_next_step', 'unrealistic'].includes(h.status))
  if (slipping.length) {
    const worst = slipping[0]
    const goal = ctx.goals.find((g) => g.id === worst.goalId)
    alerts.push(alert({
      id: 'alert-goals',
      severity: worst.status === 'at_risk' || worst.status === 'unrealistic' ? 'warning' : 'notice',
      title: `${slipping.length} goal${slipping.length === 1 ? '' : 's'} need attention`,
      detail: goal ? `“${goal.title}” is ${worst.status.replace('_', ' ')} at ${Math.round(worst.progressPct)}%.` : 'Open Goals for the full picture.',
      why: worst.why.slice(0, 2),
      link: { view: 'goals' },
    }))
  }

  // 5 — tomorrow overloaded
  const tomorrow = dayLoad(state, ctx.tomorrowKey, { settings: ctx.settings })
  if (tomorrow.status === 'overloaded') {
    alerts.push(alert({
      id: 'alert-workload',
      severity: 'warning',
      title: 'Tomorrow is overloaded',
      detail: `${minutesLabel(tomorrow.committedMinutes)} is already committed against ${minutesLabel(tomorrow.capacityMinutes)} of working time.`,
      why: tomorrow.findings,
      link: { view: 'schedule' },
    }))
  }

  // 6 — working day started with no objectives
  if (ctx.nowMinutes > ctx.workingStart + 60 && ctx.top3.total === 0 && ctx.todayTasks.length > 0) {
    alerts.push(alert({
      id: 'alert-no-top3',
      severity: 'notice',
      title: 'Today has no chosen objectives',
      detail: `${ctx.todayTasks.length} mission${ctx.todayTasks.length === 1 ? ' is' : 's are'} dated today, but no Top 3 is set.`,
      why: [finding('fact', 'Top 3 is how you mark what actually matters today.', 'recommendations')],
      link: { view: 'day' },
    }))
  }

  return alerts
}

/* --------------------------------------------------------- recommendations */

export function generateRecommendations(state, ctx) {
  const recs = []
  const health = goalHealthAll(state, ctx)
  const ranked = rankMissions(ctx.openTasks, { todayKey: ctx.todayKey, top3Ids: ctx.top3Ids })

  // 1 — a deadline-driven milestone whose goal has no scheduled work (the
  //     flagship example: explain why it matters, allocate real time)
  for (const goalState of health) {
    if (!['at_risk', 'stalled'].includes(goalState.status)) continue
    const goal = ctx.goals.find((g) => g.id === goalState.goalId)
    if (!goal) continue
    const linked = ctx.openTasks.filter((t) => t.goalId === goal.id)
    const scheduledToday = linked.filter((t) => t.date === ctx.todayKey).length
    if (scheduledToday > 0) continue
    const biggest = [...linked].sort((a, b) => (b.estimateMinutes || 30) - (a.estimateMinutes || 30))[0]
    const minutes = biggest?.estimateMinutes || 60
    const proposal = proposeAllocation(state, ctx, { minutes: Math.min(minutes, 120) })
    const deadlineBit = goalState.daysToTarget !== null && goalState.daysToTarget !== undefined
      ? ` Its target is ${relativeDays(goalState.daysToTarget)}.`
      : ''
    recs.push(recommendation({
      id: `rec-goal-${goal.id}`,
      module: 'goals',
      title: `Put time behind “${goal.title}”`,
      detail: `${linked.length} open mission${linked.length === 1 ? '' : 's'} serve this goal, but none is scheduled today.${deadlineBit}`,
      why: [...goalState.why.slice(0, 2), ...proposal.findings],
      priority: goalState.status === 'at_risk' ? 'high' : 'medium',
      impact: `Moves a ${Math.round(goalState.progressPct)}% goal forward and removes it from the at-risk list.`,
      nextStep: proposal.dayKey
        ? `Allocate ${minutesLabel(minutes)} on ${proposal.dayKey} at ${proposal.startLabel}.`
        : 'Break the goal into a smaller milestone and schedule that.',
      action: biggest && proposal.dayKey ? {
        kind: 'schedule_mission',
        taskId: biggest.id,
        dayKey: proposal.dayKey,
        startLabel: proposal.startLabel,
        minutes: Math.min(minutes, 120),
        label: `Schedule “${biggest.title}”`,
      } : null,
    }))
  }

  // 2 — reschedule the most overdue work
  if (ctx.overdue.length) {
    const worst = [...ctx.overdue].sort((a, b) => String(a.date).localeCompare(String(b.date)))[0]
    const proposal = proposeAllocation(state, ctx, { minutes: Math.min(worst.estimateMinutes || 30, 120) })
    recs.push(recommendation({
      id: 'rec-overdue-reschedule',
      module: 'missions',
      title: `Recover “${worst.title}”`,
      detail: `It has been overdue since ${worst.date}. Leaving it open costs attention every day.`,
      why: [finding('fact', `Overdue ${relativeDays(-diffDays(worst.date, ctx.todayKey))}.`, 'recommendations'), ...proposal.findings],
      priority: 'high',
      impact: 'Clears the oldest debt and stops the daily overdue penalty.',
      nextStep: proposal.dayKey ? `Move it to ${proposal.dayKey} at ${proposal.startLabel}.` : 'Give it a new date you can keep.',
      action: proposal.dayKey ? {
        kind: 'reschedule_mission',
        taskId: worst.id,
        dayKey: proposal.dayKey,
        startLabel: proposal.startLabel,
        label: `Reschedule “${worst.title}”`,
      } : null,
    }))
  }

  // 3 — plan tomorrow before it arrives
  const tomorrowLoad = dayLoad(state, ctx.tomorrowKey, { settings: ctx.settings })
  const unfinishedToday = ctx.todayTasks.filter((t) => !t.done).length
  if (unfinishedToday >= 2 && tomorrowLoad.committedMinutes < 60) {
    recs.push(recommendation({
      id: 'rec-plan-tomorrow',
      module: 'time',
      title: 'Shape tomorrow tonight',
      detail: `${unfinishedToday} mission${unfinishedToday === 1 ? '' : 's'} remain today and tomorrow has only ${minutesLabel(tomorrowLoad.committedMinutes)} committed.`,
      why: [finding('calculation', 'Days planned the evening before are the ones that survive contact with the morning.', 'recommendations')],
      priority: 'medium',
      impact: 'Turns leftover work into a deliberate plan instead of tomorrow’s surprise.',
      nextStep: 'Move one unfinished mission into tomorrow’s plan.',
      action: { kind: 'plan_tomorrow', label: 'Plan tomorrow from today’s leftovers' },
    }))
  }

  // 4 — focus time below target halfway through the working day
  const dayProgress = (ctx.nowMinutes - ctx.workingStart) / Math.max(1, ctx.workingEnd - ctx.workingStart)
  const focusTarget = ctx.settings?.focus?.targetMinutes || 180
  if (ctx.todayKey && dayProgress > 0.4 && dayProgress < 0.95 && ctx.focusToday.focusedMinutes < focusTarget / 3) {
    const proposal = proposeAllocation(state, ctx, { minutes: Math.min(50, Math.max(25, ctx.settings?.focus?.defaultMinutes || 25)) })
    recs.push(recommendation({
      id: 'rec-focus-block',
      module: 'time',
      title: 'Protect one focus block today',
      detail: `${minutesLabel(ctx.focusToday.focusedMinutes)} of deep work recorded against a target of ${minutesLabel(focusTarget)}.`,
      why: [finding('calculation', 'A single protected block recovers more than three interrupted ones.', 'recommendations'), ...proposal.findings.slice(0, 1)],
      priority: 'medium',
      impact: 'Restores the day’s most valuable hour.',
      nextStep: proposal.dayKey === ctx.todayKey ? `Start a ${minutesLabel(proposal.minutes)} focus block at ${proposal.startLabel}.` : 'Open Focus and start one session.',
      action: { kind: 'start_focus', minutes: Math.min(50, Math.max(25, ctx.settings?.focus?.defaultMinutes || 25)), label: 'Open a focus block' },
    }))
  }

  // 5 — goals with no executable next step
  for (const goalState of health.filter((h) => h.status === 'no_next_step').slice(0, 2)) {
    const goal = ctx.goals.find((g) => g.id === goalState.goalId)
    if (!goal) continue
    recs.push(recommendation({
      id: `rec-goal-nextstep-${goal.id}`,
      module: 'goals',
      title: `Give “${goal.title}” a next step`,
      detail: 'The goal is defined but nothing executable is attached to it.',
      why: goalState.why.slice(0, 2),
      priority: 'medium',
      impact: 'Goals without next steps are where ambitions go to stall.',
      nextStep: 'Add one mission small enough to finish this week.',
      action: { kind: 'create_mission', goalId: goal.id, title: '', label: `Add a mission for “${goal.title}”` },
    }))
  }

  // 6 — missions that keep moving
  const movers = repeatedPostponements(state, { min: 3 })
  if (movers.length) {
    const mover = movers[0]
    recs.push(recommendation({
      id: 'rec-irrelevant-mission',
      module: 'missions',
      title: `Decide deliberately about “${mover.title}”`,
      detail: `It has been postponed ${mover.pushes} times. Repeated delays usually mean the mission is stale, oversized or misdated.`,
      why: mover.why,
      priority: 'low',
      impact: 'Frees attention for work that is actually moving.',
      nextStep: 'Rescope it, redate it, or cancel it with your confirmation.',
      action: { kind: 'review_mission', taskId: mover.taskId, label: 'Review this mission' },
    }))
  }

  // 7 — tomorrow overloaded: move something
  if (tomorrowLoad.status === 'overloaded') {
    recs.push(recommendation({
      id: 'rec-lighten-tomorrow',
      module: 'time',
      title: 'Lighten tomorrow',
      detail: `${minutesLabel(tomorrowLoad.committedMinutes)} committed against ${minutesLabel(tomorrowLoad.capacityMinutes)} of working time (${tomorrowLoad.loadPct}%).`,
      why: tomorrowLoad.findings,
      priority: 'high',
      impact: 'An overloaded plan is where recovery days start.',
      nextStep: 'Move one flexible block to the next day with room.',
      action: { kind: 'open_view', view: 'schedule', label: 'Open tomorrow’s schedule' },
    }))
  }

  return sortRecommendations(recs)
}

/* ------------------------------------------------------------- brief views */

/** The one-line situation summary used by the Command Center and briefing. */
export function situationSummary(ctx) {
  const parts = []
  parts.push(`${ctx.todayTasks.length} mission${ctx.todayTasks.length === 1 ? '' : 's'} dated today`)
  if (ctx.overdue.length) parts.push(`${ctx.overdue.length} overdue`)
  parts.push(`${minutesLabel(remainingFreeToday(ctx))} of working time still free`)
  return `${parts.join(' · ')}.`
}

/** Today's objectives with their reasons — the executive Top 3. */
export function objectivesBrief(state, ctx) {
  return topObjectives(state, ctx).map((entry) => ({
    id: entry.task.id,
    title: entry.task.title,
    source: entry.source,
    minutes: entry.task.estimateMinutes || 30,
    reason: entry.reasons[0] ? entry.reasons[0].text : 'Ranked by attention score.',
    score: entry.score,
  }))
}

/** Where the week is heading, in one glance. */
export function weekBrief(state, ctx) {
  return weekLoad(state, ctx.todayKey, { days: 7, settings: ctx.settings })
}

/** Full pattern report — used by Analytics and the PAPER workspace. */
export function patternBrief(state, ctx) {
  return analyzePatterns(state, ctx.todayKey)
}

/** Forward-looking free windows for the "plan tomorrow" questions. */
export function freeWindowsBrief(state, ctx, dayKey) {
  return freeWindows(state, dayKey || ctx.tomorrowKey, {
    fromMinutes: dayKey === ctx.todayKey || !dayKey ? ctx.nowMinutes : null,
    settings: ctx.settings,
  })
}
