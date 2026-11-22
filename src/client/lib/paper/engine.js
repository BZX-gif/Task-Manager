/* -------------------------------------------------------------------------
   PAPER · engine — one entry point: askPaper(text, state, options).

   Flow: parse the intent → run the matching module over the workspace
   context → return a structured, honest answer:

     { type: 'answer'|'unsupported'|'action',
       intent, text, findings[], sections[], actions[] }

   `actions` are prepared descriptors. The workspace must confirm before
   executing any of them (see actions.js). The engine itself never mutates.
   ------------------------------------------------------------------------- */

import { diffDays } from '../dates.js'
import { buildWorkspaceContext, freeTimeToday } from './context.js'
import { parseIntent, detectAction, INTENTS, unsupportedReply } from './intent.js'
import { rankMissions, topObjectives } from './priorities.js'
import { dayLoad, freeWindows, proposeAllocation, remainingFreeToday, weekLoad } from './scheduling.js'
import { goalHealthAll, projectRisks } from './reasoning.js'
import { analyzePatterns, scoreTrend } from './history.js'
import { generateAlerts, generateRecommendations, objectivesBrief, situationSummary } from './recommendations.js'
import { recoveryBrief, recoverySummary } from './recovery.js'
import { executiveBriefing } from './briefing.js'
import { PAPER_INTRO, finding, minutesLabel, relativeDays } from './core.js'
import { prepareCreateMission, preparePlanTomorrow, prepareReschedule, prepareSetIntention } from './actions.js'

/**
 * Answer one request.
 * @param {string} text
 * @param {any} state
 * @param {{ now?: Date }} [options]
 */
export function askPaper(text, state, options = {}) {
  const now = options.now || new Date()
  const ctx = buildWorkspaceContext(state, { now })
  const parsed = parseIntent(text)

  // Imperative commands ("create a mission…") are prepared, never executed.
  const actionRequest = detectAction(text)
  if (actionRequest && parsed.confidence !== 'high') {
    return prepareActionReply(actionRequest, text, state, ctx)
  }

  if (parsed.intent === 'none') {
    const reply = unsupportedReply(text)
    return {
      type: 'unsupported',
      intent: 'none',
      text: reply.text,
      findings: [finding('missing', `No supported intent matched “${String(text).slice(0, 120)}”.`, 'intent')],
      sections: [{ title: 'What I can answer', items: INTENTS.map((entry) => entry.label) }],
      actions: [],
    }
  }

  const handler = HANDLERS[parsed.intent] || HANDLERS.help
  const result = handler(state, ctx, parsed)
  return { type: result.type || 'answer', intent: parsed.intent, confidence: parsed.confidence, text: result.text, findings: result.findings || [], sections: result.sections || [], actions: result.actions || [] }
}

/* --------------------------------------------------------------- handlers */

const HANDLERS = {
  focus_today(state, ctx) {
    const objectives = objectivesBrief(state, ctx)
    const ranked = rankMissions(ctx.openTasks, { todayKey: ctx.todayKey, top3Ids: ctx.top3Ids })
    const actions = []
    const top = ranked[0]
    if (top) {
      const proposal = proposeAllocation(state, ctx, { minutes: Math.min(top.task.estimateMinutes || 30, 120) })
      if (proposal.dayKey === ctx.todayKey) {
        actions.push(prepareReschedule({
          taskId: top.task.id,
          dayKey: proposal.dayKey,
          startLabel: proposal.startLabel,
          minutes: Math.min(top.task.estimateMinutes || 30, 120),
          reason: 'PAPER allocation',
        }))
      }
    }
    return {
      text: objectives.length
        ? `Today’s objectives, in order: ${objectives.map((o) => `“${o.title}”`).join(', ')}. ${objectives[0].reason}`
        : 'No missions are dated for today and no priorities are chosen. The day is genuinely open.',
      findings: objectives.flatMap((o) => [finding('calculation', `“${o.title}” — attention score ${o.score}: ${o.reason}`, 'priorities')]),
      sections: [{ title: 'Today’s objectives', items: objectives.map((o) => `${o.title} · ${o.minutes} min · ${o.reason}`) }],
      actions,
    }
  },

  overdue_missions(_state, ctx) {
    const rows = ctx.overdue.map((t) => `“${t.title}” — ${relativeDays(-diffDays(t.date, ctx.todayKey)).replace(' ago', ' overdue')}`)
    return {
      text: ctx.overdue.length
        ? `${ctx.overdue.length} mission${ctx.overdue.length === 1 ? ' is' : 's are'} overdue: ${rows.slice(0, 4).join('; ')}.`
        : 'Nothing is overdue. Every dated mission is ahead of its date.',
      findings: ctx.overdue.map((t) => finding('fact', `“${t.title}” was dated ${t.date}.`, 'context')),
      sections: ctx.overdue.length ? [{ title: 'Overdue missions', items: rows }] : [],
      actions: [],
    }
  },

  goal_status(state, ctx) {
    const health = goalHealthAll(state, ctx)
    const slipping = health.filter((h) => ['at_risk', 'stalled', 'no_next_step', 'unrealistic'].includes(h.status))
    const worst = slipping[0]
    const goal = worst ? ctx.goals.find((g) => g.id === worst.goalId) : null
    return {
      text: !health.length
        ? 'No goals are defined yet, so there is nothing to measure against.'
        : worst && goal
          ? `“${goal.title}” is the goal furthest from health: ${worst.status.replace('_', ' ')} at ${Math.round(worst.progressPct)}%. ${worst.why[0]?.text || ''}`
          : `All ${health.length} active goal${health.length === 1 ? ' is' : 's are'} on track.`,
      findings: health.slice(0, 4).flatMap((h) => h.why.slice(0, 2)),
      sections: health.length ? [{ title: 'Goal health', items: health.map((h) => `${ctx.goals.find((g) => g.id === h.goalId)?.title || h.goalId} · ${h.status.replace('_', ' ')} · ${Math.round(h.progressPct)}%`) }] : [],
      actions: [],
    }
  },

  upcoming_deadlines(_state, ctx) {
    const rows = ctx.openTasks
      .filter((t) => t.deadline && diffDays(ctx.todayKey, t.deadline) >= 0)
      .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)))
      .slice(0, 6)
    return {
      text: rows.length
        ? `Next deadlines: ${rows.map((t) => `“${t.title}” ${relativeDays(diffDays(ctx.todayKey, t.deadline))}`).join('; ')}.`
        : 'No upcoming deadlines are recorded on open missions.',
      findings: rows.map((t) => finding('fact', `“${t.title}” is due ${t.deadline}.`, 'context')),
      sections: rows.length ? [{ title: 'Upcoming deadlines', items: rows.map((t) => `${t.title} · ${t.deadline}`) }] : [],
      actions: [],
    }
  },

  plan_tomorrow(state, ctx) {
    const load = dayLoad(state, ctx.tomorrowKey, { settings: ctx.settings })
    const leftovers = ctx.todayTasks.filter((t) => !t.done)
    const windows = freeWindows(state, ctx.tomorrowKey, { settings: ctx.settings })
    const actions = leftovers.length
      ? [preparePlanTomorrow({ taskIds: leftovers.slice(0, 5).map((t) => t.id), dayKey: ctx.tomorrowKey })]
      : []
    return {
      text: leftovers.length
        ? `Tomorrow currently holds ${minutesLabel(load.committedMinutes)} of work. ${leftovers.length} mission${leftovers.length === 1 ? '' : 's'} from today could move there${windows.length ? `, with ${minutesLabel(windows.reduce((s, iv) => s + (iv.end - iv.start), 0))} of free working time` : ''}.`
        : `Tomorrow holds ${minutesLabel(load.committedMinutes)} of work and nothing is left over from today.`,
      findings: [...load.findings, finding('calculation', `${leftovers.length} unfinished mission${leftovers.length === 1 ? '' : 's'} dated today.`, 'engine')],
      sections: [
        { title: 'Tomorrow’s load', items: [`${minutesLabel(load.committedMinutes)} committed · ${load.loadPct}% of working time`] },
        { title: 'Could move', items: leftovers.slice(0, 5).map((t) => `${t.title} · ${minutesLabel(t.estimateMinutes || 30)}`) },
      ],
      actions,
    }
  },

  time_this_week(state, ctx) {
    const days = weekLoad(state, ctx.todayKey, { days: 7, settings: ctx.settings })
    const freeTotal = days.reduce((sum, d) => sum + d.remainingMinutes, 0)
    const busy = days.filter((d) => d.status === 'overloaded' || d.status === 'full')
    return {
      text: `Across the next 7 days, ${minutesLabel(freeTotal)} of working time is uncommitted${busy.length ? ` — but ${busy.length} day${busy.length === 1 ? ' is' : 's are'} already full or overloaded` : ''}.`,
      findings: days.map((d) => finding('calculation', `${d.dayKey}: ${minutesLabel(d.committedMinutes)} committed (${d.loadPct}%).`, 'scheduling')),
      sections: [{ title: 'Next 7 days', items: days.map((d) => `${d.dayKey} · ${d.loadPct}% · ${d.status}`) }],
      actions: [],
    }
  },

  important_projects(state, ctx) {
    const risks = projectRisks(state, ctx)
    const ranked = [...ctx.projects]
      .filter((p) => p.status === 'active')
      .sort((a, b) => (b.missionCount || 0) - (a.missionCount || 0))
    return {
      text: ranked.length
        ? `Most active project: “${ranked[0].title}” with ${ranked[0].missionCount} open mission${ranked[0].missionCount === 1 ? '' : 's'} and ${Math.round(ranked[0].progressPct)}% progress.${risks.length ? ` ${risks.length} project${risks.length === 1 ? '' : 's'} look at risk.` : ''}`
        : 'No active projects are defined.',
      findings: [...ranked.slice(0, 3).map((p) => finding('fact', `“${p.title}”: ${Math.round(p.progressPct)}% done, ${p.missionCount} open missions.`, 'context')), ...risks.flatMap((r) => r.why)],
      sections: ranked.length ? [{ title: 'Projects', items: ranked.slice(0, 6).map((p) => `${p.title} · ${Math.round(p.progressPct)}% · ${p.missionCount} open`) }] : [],
      actions: [],
    }
  },

  progress_decline(state, ctx) {
    const trend = scoreTrend(state, ctx.todayKey)
    const patterns = analyzePatterns(state, ctx.todayKey)
    return {
      text: trend.trend === 'declining'
        ? `Your execution score dropped from ${Math.round(trend.previousAvg)} to ${Math.round(trend.recentAvg)} week over week. ${patterns.postponements.length ? `${patterns.postponements.length} mission${patterns.postponements.length === 1 ? '' : 's'} keep being postponed.` : ''}`
        : trend.trend === 'unknown'
          ? trend.why[0].text
          : `Your execution score is ${trend.trend} (${Math.round(trend.previousAvg || 0)} → ${Math.round(trend.recentAvg || 0)}).`,
      findings: [...trend.why, ...patterns.insights.slice(0, 3)],
      sections: [{ title: 'What the records show', items: [...trend.why, ...patterns.insights].map((f) => f.text) }],
      actions: [],
    }
  },

  today_briefing(state, ctx) {
    const brief = executiveBriefing(state, ctx)
    return {
      text: `${brief.situation}${brief.nextMove ? ` The next move is “${brief.nextMove.title}”.` : ''}${brief.alerts.length ? ` ${brief.alerts.length} alert${brief.alerts.length === 1 ? '' : 's'} need attention.` : ''}`,
      findings: brief.findings,
      sections: [
        { title: 'Objectives', items: brief.objectives.map((o) => `${o.title} · ${o.reason}`) },
        { title: 'Deadlines', items: brief.deadlines.map((d) => `${d.title} · ${d.relative}`) },
        { title: 'Time', items: [`${minutesLabel(brief.time.freeMinutes)} of working time still free`] },
      ],
      actions: [],
    }
  },

  workload(state, ctx) {
    const days = weekLoad(state, ctx.todayKey, { days: 7, settings: ctx.settings })
    const overloaded = days.filter((d) => d.status === 'overloaded')
    const busiest = [...days].sort((a, b) => b.loadPct - a.loadPct)[0]
    return {
      text: overloaded.length
        ? `${overloaded.length} day${overloaded.length === 1 ? ' is' : 's are'} overloaded in the next week — heaviest is ${busiest.dayKey} at ${busiest.loadPct}%.`
        : `No day in the next week exceeds working capacity. Heaviest is ${busiest.dayKey} at ${busiest.loadPct}%.`,
      findings: days.map((d) => finding('calculation', `${d.dayKey}: ${d.loadPct}% of working capacity.`, 'scheduling')),
      sections: [{ title: 'Daily load', items: days.map((d) => `${d.dayKey} · ${d.loadPct}% · ${d.status}`) }],
      actions: [],
    }
  },

  recommendations(state, ctx) {
    const recs = generateRecommendations(state, ctx).slice(0, 4)
    return {
      text: recs.length
        ? `Top recommendation: ${recs[0].title}. ${recs[0].detail}`
        : 'Nothing in the workspace currently calls for a change. That is a valid state.',
      findings: recs.flatMap((r) => r.why.slice(0, 2)),
      sections: recs.length ? [{ title: 'Recommendations', items: recs.map((r) => `${r.title} — ${r.nextStep}`) }] : [],
      actions: recs.map((r) => r.action).filter(Boolean),
    }
  },

  alerts(state, ctx) {
    const alerts = generateAlerts(state, ctx)
    return {
      text: alerts.length
        ? `${alerts.length} situation${alerts.length === 1 ? '' : 's'} need attention: ${alerts.map((a) => a.title).join('; ')}.`
        : 'No alerts. Nothing in the workspace is currently at a threshold.',
      findings: alerts.flatMap((a) => a.why.slice(0, 1)),
      sections: alerts.length ? [{ title: 'Alerts', items: alerts.map((a) => `${a.severity} · ${a.title} — ${a.detail}`) }] : [],
      actions: [],
    }
  },

  patterns(state, ctx) {
    const report = analyzePatterns(state, ctx.todayKey)
    return {
      text: report.insights.length
        ? `From the recorded data: ${report.insights.slice(0, 2).map((f) => f.text).join(' ')}`
        : `Not enough recorded history yet for pattern analysis. ${report.missing[0]?.text || ''}`,
      findings: [...report.insights.slice(0, 4), ...report.missing.slice(0, 2)],
      sections: [
        { title: 'Patterns', items: report.insights.map((f) => f.text) },
        { title: 'Not enough data yet', items: report.missing.map((f) => f.text) },
      ],
      actions: [],
    }
  },

  recovery(state, ctx) {
    const brief = recoveryBrief(state, ctx)
    return {
      text: recoverySummary(brief, ctx),
      findings: brief.why,
      sections: [
        { title: 'Urgent', items: brief.urgent.map((u) => `${u.task.title} · ${u.age} day${u.age === 1 ? '' : 's'} over`) },
        { title: 'Can wait', items: brief.canWait.map((u) => u.task.title) },
        { title: 'Reschedule candidates', items: brief.rescheduleCandidates.map((r) => r.task.title) },
      ],
      actions: [],
    }
  },

  help() {
    return {
      type: 'answer',
      text: PAPER_INTRO,
      findings: [finding('fact', 'PAPER answers a fixed catalog of workspace questions. It does not hold open-ended conversations.', 'core')],
      sections: [{ title: 'Ask PAPER', items: INTENTS.map((entry) => `${entry.label} — e.g. “${entry.examples[0]}”`) }],
      actions: [],
    }
  },
}

/* ------------------------------------------------------- action requests */

function prepareActionReply(actionRequest, text, state, ctx) {
  const kind = actionRequest.kind
  let descriptor = null
  if (kind === 'create_mission') {
    const title = extractQuoted(text) || text.replace(/.*mission|.*task/i, '').trim().replace(/^(to|for|about)\s+/i, '').slice(0, 120)
    descriptor = prepareCreateMission({ title: title || 'New mission', date: null, minutes: 30 })
  } else if (kind === 'reschedule_mission') {
    const candidate = ctx.openTasks[0]
    if (candidate) descriptor = prepareReschedule({ taskId: candidate.id, dayKey: ctx.tomorrowKey, reason: 'Requested from PAPER' })
  } else if (kind === 'plan_day') {
    const leftovers = ctx.todayTasks.filter((t) => !t.done)
    descriptor = leftovers.length ? preparePlanTomorrow({ taskIds: leftovers.map((t) => t.id), dayKey: ctx.tomorrowKey }) : null
  } else if (kind === 'set_intention') {
    const text2 = extractQuoted(text) || text.split(/\bwill\b/i)[1]?.trim()
    if (text2) descriptor = prepareSetIntention({ text: text2, dayKey: ctx.todayKey })
  }

  if (!descriptor) {
    return {
      type: 'unsupported',
      intent: kind,
      text: 'I understood the kind of change you want, but not its details. Name the mission or the text and I will prepare it for your confirmation.',
      findings: [finding('missing', 'Action parameters could not be extracted.', 'actions')],
      sections: [],
      actions: [],
    }
  }
  return {
    type: 'action',
    intent: kind,
    text: `Prepared: ${descriptor.preview} Nothing changes until you confirm.`,
    findings: [finding('recommendation', descriptor.preview, 'actions')],
    sections: [{ title: 'Prepared action', items: [descriptor.preview] }],
    actions: [descriptor],
  }
}

function extractQuoted(text) {
  const match = /["“']([^"”']{2,120})["”']/.exec(String(text))
  return match ? match[1].trim() : null
}

/** Free-time helper re-exported for the UI layer. */
export function freeTimeNow(ctx) {
  return freeTimeToday(ctx)
}
