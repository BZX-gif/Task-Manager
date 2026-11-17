/* -------------------------------------------------------------------------
   GOAL HEALTH — is this goal actually moving?
   -------------------------------------------------------------------------
   A goal is a promise about the future. Once it is created, the only honest
   question is whether real work still points at it. This module answers that
   from recorded evidence only:

     • completed missions linked to the goal (directly or through a project)
     • focus sessions attributed to the goal
     • milestone and project progress
     • how long it has been since anything happened
     • how much of the runway to the target date is already gone

   It never invents activity and never punishes a rest week. A goal with no
   linked work is `quiet` — an honest prompt, not a failure.
   ------------------------------------------------------------------------- */

import { diffDays } from './dates.js'
import { goalProgress, projectProgress } from './relationships.js'

export const GOAL_HEALTH_META = {
  achieved: { label: 'Achieved', tone: 'positive', rank: 0 },
  on_track: { label: 'On track', tone: 'positive', rank: 1 },
  watch: { label: 'Keep an eye on it', tone: 'warning', rank: 2 },
  drifting: { label: 'Drifting', tone: 'danger', rank: 3 },
  quiet: { label: 'No work yet', tone: 'neutral', rank: 4 },
}

const DAY = 86400000

/** Everything recorded against one goal, in one place. */
export function goalEvidence(state, goalId, todayKey, { now = new Date() } = {}) {
  const projects = state.projects.filter((p) => p.goalId === goalId && p.status !== 'cancelled')
  const projectIds = new Set(projects.map((p) => p.id))
  const tasks = state.tasks.filter(
    (t) => t.status !== 'cancelled' && (t.goalId === goalId || (t.projectId && projectIds.has(t.projectId))),
  )
  const done = tasks.filter((t) => t.done || t.status === 'completed')
  const open = tasks.filter((t) => !t.done && t.status !== 'completed')
  const sessions = (state.focus?.sessions || []).filter((s) => s.goalId === goalId)
  const focusedMinutes = Math.round(sessions.reduce((sum, s) => sum + (Number(s.focusedSeconds) || 0) / 60, 0))
  const touchedAt = [
    ...done.map((t) => Number(t.completedAt) || 0),
    ...sessions.map((s) => Number(s.endedAt || s.startedAt) || 0),
  ].filter((n) => n > 0)
  const lastTouch = touchedAt.length ? Math.max(...touchedAt) : null
  // Deterministic when the caller passes an explicit clock (tests, replays).
  const sinceTouch = lastTouch ? Math.max(0, diffDays(keyOf(lastTouch), todayKey)) : null
  const nowMs = now.getTime()
  return {
    projects,
    tasks,
    done,
    open,
    sessions,
    focusedMinutes,
    lastTouch,
    daysSinceTouch: sinceTouch,
    completedLast21: done.filter((t) => Number(t.completedAt) > nowMs - 21 * DAY).length,
    recentFocusMinutes: Math.round(
      sessions
        .filter((s) => Number(s.endedAt || s.startedAt) > nowMs - 21 * DAY)
        .reduce((sum, s) => sum + (Number(s.focusedSeconds) || 0) / 60, 0),
    ),
  }
}

function keyOf(ms) {
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Health for one goal.
 * @returns {{
 *   goalId:string, progress:number, status:keyof typeof GOAL_HEALTH_META,
 *   label:string, tone:string, reason:string, momentum:number,
 *   daysSinceTouch:number|null, nextTask:any|null,
 *   milestonesDone:number, milestoneCount:number, daysToTarget:number|null
 * }}
 */
export function goalHealth(goal, state, todayKey, { now = new Date() } = {}) {
  const evidence = goalEvidence(state, goal.id, todayKey, { now })
  const progress = goalProgress(state, goal)
  const milestoneCount = goal.milestones?.length || 0
  const milestonesDone = (goal.milestones || []).filter((m) => m.done).length
  const daysToTarget = goal.targetDate ? diffDays(todayKey, goal.targetDate) : null
  const daysSinceTouch = evidence.daysSinceTouch

  // momentum 0–100: real work in the last three weeks, scaled to a healthy
  // rhythm of roughly two linked completions plus two focus hours.
  const momentum = Math.max(
    0,
    Math.min(100, Math.round(evidence.completedLast21 * 18 + Math.min(60, evidence.recentFocusMinutes / 2) + (milestonesDone ? 8 : 0))),
  )

  const base = {
    goalId: goal.id,
    progress,
    momentum,
    daysSinceTouch,
    daysToTarget,
    nextTask: evidence.open.slice().sort(byUrgency)[0] || null,
    milestonesDone,
    milestoneCount,
    evidence,
  }
  const finish = (status, reason) => ({ ...base, status, label: GOAL_HEALTH_META[status].label, tone: GOAL_HEALTH_META[status].tone, reason })

  const openMilestones = (goal.milestones || []).filter((m) => !m.done).length
  const allWorkClosed = !evidence.open.length && !openMilestones
  if (goal.status === 'completed' || (progress >= 100 && allWorkClosed)) return finish('achieved', 'Every linked mission and milestone is closed.')
  if (!evidence.tasks.length && !milestoneCount) return finish('quiet', 'No missions are connected to this goal yet.')
  if (daysSinceTouch != null && daysSinceTouch > 21) return finish('drifting', `Nothing has moved in ${daysSinceTouch} days.`)
  if (daysSinceTouch == null) return finish('quiet', 'Work is planned, but none of it has happened yet.')

  // Pace: where should this be by now, given the runway?
  if (daysToTarget != null) {
    if (daysToTarget < 0) return finish('drifting', `${Math.abs(daysToTarget)} days past the target date.`)
    if (daysToTarget <= 14 && progress < 80) return finish('drifting', `Target date is ${daysToTarget} day${daysToTarget === 1 ? '' : 's'} away at ${progress}%.`)
    if (daysToTarget <= 30 && progress < 60) return finish('watch', `${daysToTarget} days left and ${progress}% complete.`)
  }
  if (momentum === 0) return finish('quiet', 'Connected work exists, but nothing is in motion right now.')
  if (momentum < 30) return finish('watch', momentum < 15 ? 'Low momentum this month.' : 'A little more consistency would help.')
  if (daysSinceTouch != null && daysSinceTouch <= 3) return finish('on_track', 'Work happened in the last three days.')
  return finish('on_track', `Last activity ${daysSinceTouch} day${daysSinceTouch === 1 ? '' : 's'} ago.`)
}

function byUrgency(a, b) {
  const rank = { high: 0, medium: 1, low: 2 }
  return (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1) || String(a.deadline || a.date || '9999').localeCompare(String(b.deadline || b.date || '9999'))
}

/** All goals, ordered by attention needed. Includes a small summary for headers. */
export function goalHealthReport(state, todayKey, { now = new Date() } = {}) {
  const active = state.goals.filter((g) => g.status !== 'cancelled')
  const items = active.map((goal) => ({ ...goalHealth(goal, state, todayKey, { now }), goal }))
  const ATTENTION_ORDER = { drifting: 0, watch: 1, quiet: 2 }
  const attention = items
    .filter((item) => item.status in ATTENTION_ORDER)
    .sort((a, b) => ATTENTION_ORDER[a.status] - ATTENTION_ORDER[b.status] || a.progress - b.progress)
  const summary = {
    total: items.length,
    onTrack: items.filter((i) => i.status === 'on_track').length,
    watch: items.filter((i) => i.status === 'watch').length,
    drifting: items.filter((i) => i.status === 'drifting').length,
    quiet: items.filter((i) => i.status === 'quiet').length,
    achieved: items.filter((i) => i.status === 'achieved').length,
    averageProgress: items.length ? Math.round(items.reduce((sum, i) => sum + i.progress, 0) / items.length) : 0,
    needingAttention: attention.length,
  }
  return { items, attention, summary }
}

/** Healthy projects in the same vocabulary, for the Projects board. */
export function projectHealth(project, state, todayKey) {
  const tasks = state.tasks.filter((t) => t.projectId === project.id && t.status !== 'cancelled')
  const open = tasks.filter((t) => !t.done)
  const progress = projectProgress(state, project)
  const daysLeft = project.dueDate ? diffDays(todayKey, project.dueDate) : null
  if (project.status === 'completed' || progress >= 100) return { status: 'achieved', label: 'Complete', tone: 'positive', progress, daysLeft }
  if (daysLeft != null && daysLeft < 0) return { status: 'drifting', label: 'Overdue', tone: 'danger', progress, daysLeft }
  if (daysLeft != null && daysLeft <= 7 && progress < 70) return { status: 'watch', label: 'Due soon', tone: 'warning', progress, daysLeft }
  if (!open.length && !tasks.length) return { status: 'quiet', label: 'No work yet', tone: 'neutral', progress, daysLeft }
  return { status: 'on_track', label: 'On track', tone: 'positive', progress, daysLeft }
}
