/* -------------------------------------------------------------------------
   PAPER · reasoning — goal & project intelligence.

   Goal health is a transparent state machine over real records: progress,
   linked missions, milestone completion and deadlines. Every verdict lists
   the facts it is based on; when the workspace is too young to judge, the
   verdict says exactly that instead of guessing.
   ------------------------------------------------------------------------- */

import { diffDays } from '../dates.js'
import { finding, relativeDays } from './core.js'

export const GOAL_STATES = ['complete', 'on_track', 'at_risk', 'stalled', 'no_next_step', 'unrealistic', 'paused']

const DAY_MS_LABEL = (n) => relativeDays(n)

/**
 * Classify one goal.
 * @param {any} state
 * @param {any} goal goal fact from the workspace context
 * @param {{ todayKey: string, tasks?: any[] }} ctx
 */
export function goalHealth(state, goal, ctx) {
  const todayKey = ctx.todayKey
  const tasks = ctx.tasks || state?.tasks || []
  const linked = tasks.filter((t) => t.goalId === goal.id && t.status !== 'cancelled')
  const open = linked.filter((t) => !t.done)
  const done = linked.filter((t) => t.done || t.status === 'completed')
  const progressPct = goal.progressPct ?? 0
  const milestones = goal.milestones || []
  const milestonesDone = milestones.filter((m) => m.done).length
  const openMilestones = milestones.filter((m) => !m.done)
  const target = goal.deadline || goal.targetDate || null
  const daysToTarget = target ? diffDays(todayKey, target) : null

  const why = []
  why.push(finding('calculation', `Progress ${Math.round(progressPct)}% from ${done.length} completed and ${open.length} open linked missions.`, 'reasoning'))
  if (milestones.length) {
    why.push(finding('fact', `Milestones: ${milestonesDone}/${milestones.length} done.`, 'reasoning'))
  } else {
    why.push(finding('missing', 'No milestones defined — progress is measured from linked missions only.', 'reasoning'))
  }
  if (daysToTarget === null) {
    why.push(finding('missing', 'No target date set.', 'reasoning'))
  } else if (daysToTarget < 0) {
    why.push(finding('fact', `Target date passed ${DAY_MS_LABEL(daysToTarget)}.`, 'reasoning'))
  } else {
    why.push(finding('fact', `Target date is ${DAY_MS_LABEL(daysToTarget)}.`, 'reasoning'))
  }

  if (goal.status === 'paused') {
    return { goalId: goal.id, status: 'paused', progressPct, openMissions: open.length, daysToTarget, why, nextStep: 'Resume the goal or close it deliberately.' }
  }
  if (goal.status === 'completed' || (progressPct >= 100 && open.length === 0)) {
    return { goalId: goal.id, status: 'complete', progressPct, openMissions: 0, daysToTarget, why, nextStep: 'Close it out and keep the record.' }
  }
  if (open.length === 0 && openMilestones.length === 0) {
    why.push(finding('inference', 'This goal has no open missions and no open milestones — there is no executable next step.', 'reasoning'))
    return { goalId: goal.id, status: 'no_next_step', progressPct, openMissions: 0, daysToTarget, why, nextStep: 'Define the next milestone or add a mission that moves it.' }
  }
  if (daysToTarget !== null && daysToTarget >= 0 && openMilestones.length > Math.max(1, daysToTarget)) {
    why.push(finding('calculation', `${openMilestones.length} open milestones against ${daysToTarget} day${daysToTarget === 1 ? '' : 's'} remaining — more steps than days.`, 'reasoning'))
    return { goalId: goal.id, status: 'unrealistic', progressPct, openMissions: open.length, daysToTarget, why, nextStep: 'Cut the milestone list or move the target date — with your confirmation.' }
  }
  if (daysToTarget !== null && daysToTarget < 0 && progressPct < 100) {
    return { goalId: goal.id, status: 'at_risk', progressPct, openMissions: open.length, daysToTarget, why, nextStep: 'Set a new target date or rescope the goal.' }
  }

  // Stagnation: nothing completed for this goal in 14 days while work remains.
  const recentCompletions = done.filter((t) => t.completedAt && todayKey >= new Date(t.completedAt - 14 * 864e5).toISOString().slice(0, 10)).length
  const createdAgo = goal.createdAt ? Math.floor((Date.parse(`${todayKey}T12:00:00`) - goal.createdAt) / 864e5) : 0
  if (recentCompletions === 0 && createdAgo > 7 && open.length > 0) {
    why.push(finding('inference', 'No linked mission has been completed in the last 14 days.', 'reasoning'))
    return { goalId: goal.id, status: 'stalled', progressPct, openMissions: open.length, daysToTarget, why, nextStep: 'Schedule one small mission from this goal this week.' }
  }

  if (daysToTarget !== null && daysToTarget <= 14 && progressPct < 50) {
    why.push(finding('calculation', `Under half done with ${daysToTarget} day${daysToTarget === 1 ? '' : 's'} left.`, 'reasoning'))
    return { goalId: goal.id, status: 'at_risk', progressPct, openMissions: open.length, daysToTarget, why, nextStep: 'Protect time for the linked missions this week.' }
  }

  return { goalId: goal.id, status: 'on_track', progressPct, openMissions: open.length, daysToTarget, why, nextStep: '' }
}

/** Classify every active goal, worst first. */
export function goalHealthAll(state, ctx) {
  const goals = ctx.goals || []
  const order = { unrealistic: 0, at_risk: 1, stalled: 2, no_next_step: 3, paused: 4, on_track: 5, complete: 6 }
  return goals
    .filter((g) => g.status !== 'cancelled')
    .map((goal) => goalHealth(state, goal, ctx))
    .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9))
}

/**
 * Projects that are slipping: open projects with no open mission, or a
 * deadline within reach and under half done.
 */
export function projectRisks(state, ctx) {
  const out = []
  const tasks = ctx.tasks || []
  for (const project of ctx.projects || []) {
    if (project.status !== 'active') continue
    const open = tasks.filter((t) => t.projectId === project.id && !t.done && t.status !== 'cancelled')
    const target = project.deadline || project.targetDate || null
    const daysToTarget = target ? diffDays(ctx.todayKey, target) : null
    if (open.length === 0 && (project.progressPct ?? 0) < 100) {
      out.push({
        projectId: project.id,
        reason: 'no_next_step',
        why: [finding('inference', `“${project.title}” has no open missions but is only ${Math.round(project.progressPct ?? 0)}% done.`, 'reasoning')],
      })
    } else if (daysToTarget !== null && daysToTarget <= 7 && (project.progressPct ?? 0) < 50) {
      out.push({
        projectId: project.id,
        reason: 'deadline_close',
        why: [finding('calculation', `“${project.title}” is ${Math.round(project.progressPct ?? 0)}% done with ${daysToTarget === 0 ? 'its deadline today' : `${daysToTarget} day${daysToTarget === 1 ? '' : 's'} left`}.`, 'reasoning')],
      })
    }
  }
  return out
}

/**
 * Dependency sanity: missions pointing at projects or goals that are paused,
 * cancelled or completed — the mission is likely orphaned.
 */
export function dependencyIssues(state, ctx) {
  const out = []
  const tasks = ctx.tasks || []
  const projects = new Map((ctx.projects || []).map((p) => [p.id, p]))
  const goals = new Map((ctx.goals || []).map((g) => [g.id, g]))
  for (const task of tasks) {
    if (task.done || task.status === 'cancelled') continue
    const project = task.projectId ? projects.get(task.projectId) : null
    const goal = task.goalId ? goals.get(task.goalId) : null
    if (project && (project.status === 'cancelled' || project.status === 'paused')) {
      out.push({ taskId: task.id, issue: `linked project is ${project.status}`, why: [finding('fact', `“${task.title}” belongs to project “${project.title}”, which is ${project.status}.`, 'reasoning')] })
    }
    if (goal && goal.status === 'cancelled') {
      out.push({ taskId: task.id, issue: 'linked goal is cancelled', why: [finding('fact', `“${task.title}” serves goal “${goal.title}”, which is cancelled.`, 'reasoning')] })
    }
  }
  return out
}
