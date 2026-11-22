/* -------------------------------------------------------------------------
   PAPER · core — the shared vocabulary of the intelligence engine.

   PAPER is deterministic and local. Everything it says is one of exactly
   five kinds of statement, and every statement carries its kind:

     fact           something the workspace records (a mission is overdue)
     calculation    a number PAPER derived from records (72% of plan done)
     inference      a pattern read from records (delays cluster on Mondays)
     recommendation advice with a stated reason (allocate 90 minutes today)
     missing        information the workspace does not have

   PAPER never fabricates. When the data does not support a statement, the
   statement is not made — or it is explicitly marked `missing`.
   ------------------------------------------------------------------------- */

export const PAPER_NAME = 'PAPER'
export const PAPER_ROLE = 'Personal intelligence engine'

/** Statement kinds — the honesty contract of the whole engine. */
export const EVIDENCE_KINDS = ['fact', 'calculation', 'inference', 'recommendation', 'missing']

export const EVIDENCE_LABELS = {
  fact: 'Fact',
  calculation: 'Calculation',
  inference: 'Inference',
  recommendation: 'Recommendation',
  missing: 'Missing information',
}

/**
 * Build one statement with its evidence kind and source.
 * @param {'fact'|'calculation'|'inference'|'recommendation'|'missing'} kind
 * @param {string} text
 * @param {string} source module or record the statement came from
 */
export function finding(kind, text, source) {
  if (!EVIDENCE_KINDS.includes(kind)) kind = 'missing'
  return { kind, text: String(text), source: String(source || 'paper') }
}

/** Recommendation urgency. Lower rank = more urgent. */
export const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 }

export const PRIORITY_LABELS = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }

/**
 * A recommendation PAPER stands behind: title, reason, evidence, impact and a
 * concrete next step. `action` (optional) is a prepared action descriptor that
 * the workspace may execute only after the user confirms.
 */
export function recommendation({ id, module, title, detail, why = [], priority = 'medium', impact = '', nextStep = '', action = null }) {
  return {
    id: String(id),
    module: String(module),
    title: String(title),
    detail: String(detail),
    why: Array.isArray(why) ? why : [],
    priority: PRIORITY_RANK[priority] === undefined ? 'medium' : priority,
    impact: String(impact),
    nextStep: String(nextStep),
    action,
  }
}

/** An alert is a situation, not advice: something the user should know now. */
export function alert({ id, severity = 'notice', title, detail, why = [], link = null }) {
  const valid = ['urgent', 'warning', 'notice'].includes(severity) ? severity : 'notice'
  return { id: String(id), severity: valid, title: String(title), detail: String(detail), why: Array.isArray(why) ? why : [], link }
}

export function sortRecommendations(list) {
  return [...list].sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9))
}

/** Short, stable date label shared by every module ("in 3 days", "3 days ago"). */
export function relativeDays(days) {
  const n = Math.round(days)
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  if (n === -1) return 'yesterday'
  return n > 0 ? `in ${n} days` : `${-n} days ago`
}

/** Minutes → "1h 30m" / "45m". Deterministic and locale-free. */
export function minutesLabel(minutes) {
  const m = Math.max(0, Math.round(minutes || 0))
  const h = Math.floor(m / 60)
  const rest = m % 60
  if (h && rest) return `${h}h ${rest}m`
  if (h) return `${h}h`
  return `${rest}m`
}

/** Sort helper: nearest deadline first, undated last. */
export function byDeadline(a, b, todayKey) {
  const da = a.deadline || a.targetDate || null
  const db = b.deadline || b.targetDate || null
  if (!da && !db) return 0
  if (!da) return 1
  if (!db) return -1
  return da < db ? -1 : da > db ? 1 : 0
}

/** The identity line PAPER uses when it introduces what it is. */
export const PAPER_INTRO =
  'PAPER is the built-in intelligence of this workspace. It reasons only from ' +
  'your own records — missions, schedule, goals, focus and history — using ' +
  'deterministic rules you can inspect. It has no external model and never ' +
  'invents information.'
