/* -------------------------------------------------------------------------
   FOCUS MISSION — presentation-model maths for the Focus Mode overlay
   -------------------------------------------------------------------------
   This module is PURE presentation logic. It decides which phase a session
   is in, which milestone was just crossed and which final-minute stage to
   show — all derived from the real timer numbers in lib/focus.js.

   It deliberately says nothing about attention, cognitive ability or
   productivity quality: "focus energy" is only a visual rendering of the
   elapsed share of the session the user themselves planned.
   ------------------------------------------------------------------------- */

/**
 * Session phases (focus mode). The 50–90% window intentionally shares one
 * phase: deep work should look calm and stay visually stable.
 */
export const MISSION_PHASES = [
  { key: 'warmup', label: 'WARMING UP', min: 0 },
  { key: 'momentum', label: 'BUILDING MOMENTUM', min: 0.25 },
  { key: 'deep', label: 'DEEP WORK', min: 0.5 },
  { key: 'push', label: 'FINAL PUSH', min: 0.9 },
]

/** Break sessions keep a single, calm phase. */
export const BREAK_PHASE = { key: 'recharge', label: 'RECHARGING' }

/**
 * Milestones (share of planned time) with their transient copy.
 * Percentages are integers so threshold maths stays exact.
 */
export const MISSION_MILESTONES = [
  { at: 25, text: 'Warm-up complete — you’re in motion.' },
  { at: 50, text: 'You’re in the zone.' },
  { at: 75, text: 'Deep work achieved.' },
  { at: 90, text: 'Final stretch.' },
]

/**
 * The phase for a progress ratio (0…1) and session mode.
 * @param {number} ratio
 * @param {string} [mode] 'focus' | 'break'
 * @returns {{key:string, label:string}}
 */
export function missionPhase(ratio, mode = 'focus') {
  if (mode === 'break') return BREAK_PHASE
  const r = Math.max(0, Math.min(1, Number(ratio) || 0))
  let phase = MISSION_PHASES[0]
  for (const candidate of MISSION_PHASES) {
    if (r >= candidate.min - Number.EPSILON) phase = candidate
  }
  return phase
}

/**
 * Which milestone (if any) was crossed between two consecutive progress
 * ratios. Returns the highest milestone crossed so a fast jump is announced
 * once instead of spamming several messages.
 * @param {number} prev ratio before
 * @param {number} next ratio after
 * @returns {{at:number, text:string}|null}
 */
export function milestoneCrossed(prev, next) {
  const from = Math.max(0, (Number(prev) || 0) * 100)
  const to = Math.max(0, (Number(next) || 0) * 100)
  if (!(to > from)) return null
  let crossed = null
  for (const milestone of MISSION_MILESTONES) {
    if (from < milestone.at && to >= milestone.at) crossed = milestone
  }
  return crossed
}

/**
 * Deterministic final-minute staging. Driven by the real remaining seconds
 * from the timer maths — never by animation frames.
 * @param {number} remaining seconds left
 * @returns {{key:'final'|'almost'|'count', hint:string}|null}
 */
export function finalMinuteStage(remaining) {
  const seconds = Math.max(0, Math.ceil(Number(remaining) || 0))
  if (seconds <= 0 || seconds > 60) return null
  if (seconds <= 3) return { key: 'count', hint: '' }
  if (seconds <= 10) return { key: 'almost', hint: 'Almost there.' }
  return { key: 'final', hint: 'FINISH STRONG' }
}

/**
 * Lightweight "Today's momentum" chain derived ONLY from real session
 * history for the given day. Breaks are excluded; the live session is
 * appended as the hollow node when `includeCurrent` is set.
 *
 * @param {Array<{date:string, mode?:string, status?:string}>} sessions
 * @param {string} day date key (yyyy-mm-dd)
 * @param {{includeCurrent?:boolean, max?:number}} [options]
 * @returns {{nodes:Array<{kind:'done'|'partial'|'current'}>, overflow:number}}
 */
export function momentumChain(sessions = [], day, { includeCurrent = false, max = 6 } = {}) {
  const todays = (sessions || []).filter((s) => s && s.date === day && s.mode !== 'break')
  /** @type {Array<{kind:'done'|'partial'|'current'}>} */
  const nodes = todays.map((s) => ({ kind: /** @type {'done'|'partial'} */ (s.status === 'completed' ? 'done' : 'partial') }))
  if (includeCurrent) nodes.push({ kind: 'current' })
  const cap = Math.max(1, max)
  if (nodes.length <= cap) return { nodes, overflow: 0 }
  return { nodes: nodes.slice(-(cap - 1)), overflow: nodes.length - (cap - 1) }
}
