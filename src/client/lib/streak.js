/* -------------------------------------------------------------------------
   STREAK — meaningful, not perfectionist
   -------------------------------------------------------------------------
   A day counts as a "success day" when ANY of these is true:

     • all of the day's Top 3 priorities are completed, OR
     • the daily score is ≥ 60, OR
     • at least 45 focused minutes were logged

   So a single missed minor task never kills the streak. Today stays "open"
   until it succeeds — an unfinished morning does not break the chain.
   The rule text is exported so the UI can show it verbatim.
   ------------------------------------------------------------------------- */

import { addDays } from './dates.js'

export const STREAK_RULE = {
  minScore: 60,
  minFocusMinutes: 45,
  /** all selected Top 3 tasks done (requires at least one) */
  requireAllTop3: true,
}

export const STREAK_RULE_TEXT = [
  `Top 3 finished, or`,
  `Daily score ≥ ${STREAK_RULE.minScore}, or`,
  `${STREAK_RULE.minFocusMinutes}+ focused minutes`,
]

/**
 * @param {{score:number, top3Total:number, top3Done:number, focusedMinutes:number}} day
 * @returns {boolean}
 */
export function isSuccessfulDay(day) {
  if (!day) return false
  const { score = 0, top3Total = 0, top3Done = 0, focusedMinutes = 0 } = day
  const top3Complete = STREAK_RULE.requireAllTop3 && top3Total > 0 && top3Done >= top3Total
  return top3Complete || score >= STREAK_RULE.minScore || focusedMinutes >= STREAK_RULE.minFocusMinutes
}

/**
 * @param {Object} input
 * @param {string} input.todayKey
 * @param {Record<string, {score:number, top3Total:number, top3Done:number, focusedMinutes:number}>} input.history
 * @param {number} [input.lookback]      how far back to scan (days)
 * @param {number} [input.recentDays]    how many days to return for the mini viz
 */
export function computeStreak({ todayKey, history = {}, lookback = 400, recentDays = 7 }) {
  let current = 0
  let cursor = todayKey
  let todayCounted = false

  for (let i = 0; i < lookback; i++) {
    const day = history[cursor]
    const success = isSuccessfulDay(day)
    if (i === 0) {
      // today does not break the streak while it is still in progress
      if (success) {
        current++
        todayCounted = true
      }
    } else if (success) {
      current++
    } else {
      break
    }
    cursor = addDays(cursor, -1)
  }

  // best streak across recorded history
  const keys = Object.keys(history).sort()
  let best = 0
  let run = 0
  let prevKey = null
  for (const key of keys) {
    if (!isSuccessfulDay(history[key])) {
      run = 0
      prevKey = key
      continue
    }
    run = prevKey && addDays(prevKey, 1) === key ? run + 1 : 1
    prevKey = key
    if (run > best) best = run
  }
  best = Math.max(best, current)

  const recent = []
  for (let i = recentDays - 1; i >= 0; i--) {
    const key = addDays(todayKey, -i)
    const day = history[key]
    recent.push({
      dateKey: key,
      success: isSuccessfulDay(day),
      isToday: key === todayKey,
      score: day ? Math.round(day.score || 0) : 0,
    })
  }

  return { current, best, todayCounted, recent }
}
