/* -------------------------------------------------------------------------
   PAPER · briefing — the executive summary of the user's situation.

   Composed entirely from the other PAPER modules. Every sentence traces to
   a fact, a calculation or a labelled inference; the recommended action
   always carries its reason.
   ------------------------------------------------------------------------- */

import { buildBriefing } from '../briefing.js'
import { finding, minutesLabel, relativeDays } from './core.js'
import { generateAlerts, generateRecommendations, objectivesBrief, situationSummary } from './recommendations.js'
import { goalHealthAll } from './reasoning.js'
import { remainingFreeToday } from './scheduling.js'
import { diffDays } from '../dates.js'

/**
 * The full executive briefing.
 * @returns {{ greeting: string, situation: string, nextMove: any, objectives: any[],
 *            deadlines: any[], overdue: any[], time: any, alerts: any[],
 *            recommendations: any[], goalHealth: any[], progress: any, findings: any[] }}
 */
export function executiveBriefing(state, ctx) {
  const base = buildBriefing(state, { todayKey: ctx.todayKey, now: ctx.now })

  const objectives = objectivesBrief(state, ctx)

  const deadlines = ctx.openTasks
    .filter((t) => t.deadline && diffDays(ctx.todayKey, t.deadline) >= -1)
    .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)))
    .slice(0, 5)
    .map((t) => ({
      id: t.id,
      title: t.title,
      deadline: t.deadline,
      relative: relativeDays(diffDays(ctx.todayKey, t.deadline)),
    }))

  const overdue = ctx.overdue
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(0, 5)
    .map((t) => ({ id: t.id, title: t.title, date: t.date, days: diffDays(t.date, ctx.todayKey) }))

  const free = remainingFreeToday(ctx)
  const time = {
    freeMinutes: free,
    committedMinutes: ctx.stats.totalPlannedMinutes,
    focusedMinutes: ctx.focusToday.focusedMinutes,
    findings: [
      finding('calculation', `${minutesLabel(free)} of working time remains; ${minutesLabel(ctx.focusToday.focusedMinutes)} of it has been deep work so far.`, 'briefing'),
    ],
  }

  const alerts = generateAlerts(state, ctx)
  const recommendations = generateRecommendations(state, ctx).slice(0, 4)
  const health = goalHealthAll(state, ctx).filter((h) => h.status !== 'complete').slice(0, 3)

  const progress = {
    score: ctx.stats.score,
    hasData: ctx.stats.hasData,
    top3Done: ctx.top3.done,
    top3Total: ctx.top3.total,
    findings: [
      ctx.stats.hasData
        ? finding('calculation', `Execution score ${ctx.stats.score}/100 · Top 3 ${ctx.top3.done}/${ctx.top3.total} done.`, 'briefing')
        : finding('missing', 'Not enough activity today for a meaningful score yet.', 'briefing'),
    ],
  }

  return {
    greeting: base.greeting,
    situation: situationSummary(ctx),
    nextMove: base.command
      ? { title: base.command.title, reason: base.command.reason, time: base.command.time || null }
      : null,
    objectives,
    deadlines,
    overdue,
    time,
    alerts,
    recommendations,
    goalHealth: health,
    progress,
    findings: [
      finding('fact', situationSummary(ctx), 'briefing'),
      ...time.findings,
      ...progress.findings,
    ],
    intention: base.intention || null,
  }
}

/** A short spoken-style paragraph — the calm voice of the briefing. */
export function briefingNarrative(briefing) {
  const parts = []
  parts.push(briefing.situation)
  if (briefing.nextMove) parts.push(`The next move is “${briefing.nextMove.title}” — ${briefing.nextMove.reason}`)
  if (briefing.alerts.length) parts.push(`${briefing.alerts.length} alert${briefing.alerts.length === 1 ? '' : 's'} need${briefing.alerts.length === 1 ? 's' : ''} attention.`)
  if (briefing.recommendations.length) parts.push(`Top recommendation: ${briefing.recommendations[0].title}.`)
  return parts.join(' ')
}
