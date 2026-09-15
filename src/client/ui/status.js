/* -------------------------------------------------------------------------
   DAY STATUS — the single place that explains *why* a day counts
   -------------------------------------------------------------------------
   A day is:
     success  → the streak rule is satisfied (Top 3 done, score ≥ 60, or 45+ focused min)
     progress → meaningful activity but the rule is not met (partial credit)
     rest     → no activity at all
     upcoming → in the future (never judged)
   Used by the streak dots, heatmap and review, so every surface agrees.
   ------------------------------------------------------------------------- */

import { STREAK_RULE, isSuccessfulDay } from '../lib/streak.js'
import { statsFor } from '../core/store.js'

export const STREAK_RULE_TEXT = [
  'all Top 3 priorities done',
  `daily score ${STREAK_RULE.minScore}+`,
  `${STREAK_RULE.minFocusMinutes}+ focused minutes`,
]

export const STATUS_STYLES = {
  success: { dot: 'rgba(52,211,153,0.95)', cell: 'rgba(52,211,153,0.8)', label: 'Counted', text: 'text-emerald-400' },
  progress: { dot: 'rgba(251,191,36,0.9)', cell: 'rgba(124,92,255,0.45)', label: 'Partial credit', text: 'text-amber-300' },
  rest: { dot: 'rgba(255,255,255,0.12)', cell: 'rgba(255,255,255,0.06)', label: 'No activity', text: 'text-slate-500' },
  upcoming: { dot: 'rgba(255,255,255,0.06)', cell: 'rgba(255,255,255,0.03)', label: 'Upcoming', text: 'text-slate-600' },
}

/**
 * @param {any} state
 * @param {string} dateKey
 * @param {string} [todayKey]
 */
export function dayStatus(state, dateKey, todayKey = null) {
  const today = todayKey || statsTodayKey()
  if (dateKey > today) {
    return { status: 'upcoming', reasons: [], ruleText: STREAK_RULE_TEXT, score: 0, focusedMinutes: 0, hasActivity: false }
  }
  const stats = statsFor(dateKey)
  const metrics = {
    score: stats.score,
    top3Total: stats.top3Total,
    top3Done: stats.top3Done,
    focusedMinutes: stats.focusedMinutes,
  }
  const success = isSuccessfulDay(metrics)
  const reasons = []
  if (metrics.top3Total > 0 && metrics.top3Done >= metrics.top3Total) reasons.push('Top 3 complete')
  if (metrics.score >= STREAK_RULE.minScore) reasons.push(`score ${metrics.score}`)
  if (metrics.focusedMinutes >= STREAK_RULE.minFocusMinutes) reasons.push(`${metrics.focusedMinutes} min focused`)

  return {
    status: success ? 'success' : stats.hasAnyActivity ? 'progress' : 'rest',
    reasons,
    ruleText: STREAK_RULE_TEXT,
    score: stats.score,
    focusedMinutes: stats.focusedMinutes,
    hasActivity: stats.hasAnyActivity,
  }
}

function statsTodayKey() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
