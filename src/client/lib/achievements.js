/* -------------------------------------------------------------------------
   ACHIEVEMENTS — private, local-only title system
   -------------------------------------------------------------------------
   • No backend, no social, no sharing — everything lives in localStorage
   • Perfect Day = 100% tasks AND 100% timetable blocks, with real work planned
   • Discipline Monster = 10 consecutive Perfect Days
   • Historical stability via dailyProgress snapshots (frozen once past)
   • Local date handling only (YYYY-MM-DD keys)
   • Extensible TITLE_DEFINITIONS for future titles
   ------------------------------------------------------------------------- */

import { addDays, dateKey, isValidKey } from './dates.js'
import { dayStats, dayPlanFor } from './daystats.js'

/** Title catalogue — add future titles here, implement only DISCIPLINE_MONSTER now */
export const TITLE_DEFINITIONS = {
  DISCIPLINE_MONSTER: {
    id: 'discipline-monster',
    key: 'disciplineMonster',
    name: 'DISCIPLINE MONSTER',
    subtitle: '10 DAY PERFECT RUN',
    icon: '⚡',
    lockedIcon: '🔒',
    requirement: 10,
    description: 'Complete 100% of planned tasks and timetable for 10 consecutive days',
    color: '#fbbf24',
    glow: 'rgba(251,191,36,0.28)',
    gradient: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
  },
  // Future placeholders — not implemented yet, only shape for extensibility:
  // FOCUS_BEAST: { id: 'focus-beast', key: 'focusBeast', name: 'FOCUS BEAST', ... },
  // CONSISTENCY_KING: { ... },
  // TASK_SLAYER: { ... },
  // DEEP_WORK_BEAST: { ... },
  // THIRTY_DAY_MACHINE: { ... },
}

export const TITLE_LIST = Object.values(TITLE_DEFINITIONS)

/** Ensure we have a clean list of title keys for migrations */
export const KNOWN_TITLE_KEYS = TITLE_LIST.map((t) => t.key)

/**
 * True perfect-day check with anti-exploit:
 * - Must have actual planned work (tasksPlanned >0 AND timetablePlanned >0)
 * - 100% completion on both axes
 */
export function isPerfectDay({ tasksPlanned, tasksCompleted, timetablePlanned, timetableCompleted }) {
  const tp = Number(tasksPlanned) || 0
  const tc = Number(tasksCompleted) || 0
  const bp = Number(timetablePlanned) || 0
  const bc = Number(timetableCompleted) || 0

  // Anti-exploit: empty day is NOT perfect
  if (tp <= 0) return false
  if (bp <= 0) return false

  return tc >= tp && bc >= bp
}

/**
 * Live computation from current state (no snapshot). Used for today and
 * for legacy days that have no frozen snapshot yet.
 */
export function computeLiveDayProgress(state, dateKeyValue, todayKey, now = new Date()) {
  const stats = dayStats(state, dateKeyValue, { todayKey, now })
  const tasksPlanned = stats.tasksPlanned
  const tasksCompleted = stats.tasksDone
  const timetablePlanned = stats.blocksTotal
  const timetableCompleted = stats.blocksDone

  const perfect = isPerfectDay({
    tasksPlanned,
    tasksCompleted,
    timetablePlanned,
    timetableCompleted,
  })

  return {
    tasksPlanned,
    tasksCompleted,
    timetablePlanned,
    timetableCompleted,
    perfect,
    hasData: stats.hasAnyActivity || tasksPlanned > 0 || timetablePlanned > 0,
  }
}

/**
 * Get the frozen snapshot if available (past days), otherwise live.
 * Returns the same shape as computeLiveDayProgress plus recordedAt.
 */
export function getDayProgress(state, dateKeyValue, todayKey, now = new Date()) {
  const stored = state.dailyProgress?.[dateKeyValue]
  if (stored) {
    // Past days: use frozen record as truth (historical stability)
    // For today, we still want live if stored is provisional? We update today live anyway.
    // If stored exists and date is past, trust it.
    if (dateKeyValue < todayKey) {
      const perfect = isPerfectDay({
        tasksPlanned: stored.tasksPlanned,
        tasksCompleted: stored.tasksCompleted,
        timetablePlanned: stored.timetablePlanned,
        timetableCompleted: stored.timetableCompleted,
      })
      // If stored perfect flag differs from recomputed due to old buggy data, recompute but keep tasksPlanned from stored
      // to prevent deletion exploit: use stored perfect if stored was explicitly marked perfect false? Actually we keep stored perfect as frozen.
      // For safety, if stored perfect is true but recomputed would be false due to added tasks later, keep true (frozen).
      // If stored perfect false, keep false (prevent deletion exploit).
      return {
        tasksPlanned: stored.tasksPlanned,
        tasksCompleted: stored.tasksCompleted,
        timetablePlanned: stored.timetablePlanned,
        timetableCompleted: stored.timetableCompleted,
        perfect: stored.perfect, // frozen truth
        hasData: true,
        recordedAt: stored.recordedAt,
        frozen: true,
      }
    }
  }

  // Today or missing history: live
  const live = computeLiveDayProgress(state, dateKeyValue, todayKey, now)
  return { ...live, frozen: false, recordedAt: now.getTime() }
}

/**
 * Sync dailyProgress snapshots.
 * - Full sync: iterate 400 days back, create missing past entries (freeze on first sight)
 * - Light sync (default): only update today
 */
export function syncDailyProgress(state, todayKey, now = new Date(), { full = false } = {}) {
  if (!state.dailyProgress) state.dailyProgress = {}

  const ensureEntry = (key, isToday) => {
    const live = computeLiveDayProgress(state, key, todayKey, now)
    const existing = state.dailyProgress[key]

    if (isToday) {
      // Today: always update provisional
      state.dailyProgress[key] = {
        tasksPlanned: live.tasksPlanned,
        tasksCompleted: live.tasksCompleted,
        timetablePlanned: live.timetablePlanned,
        timetableCompleted: live.timetableCompleted,
        perfect: live.perfect,
        recordedAt: now.getTime(),
      }
      return
    }

    // Past: freeze on first observation, never overwrite to prevent manipulation
    if (!existing) {
      state.dailyProgress[key] = {
        tasksPlanned: live.tasksPlanned,
        tasksCompleted: live.tasksCompleted,
        timetablePlanned: live.timetablePlanned,
        timetableCompleted: live.timetableCompleted,
        perfect: live.perfect,
        recordedAt: now.getTime(),
      }
    }
    // If existing, keep as is (frozen)
  }

  if (full) {
    // Trim and full backfill
    const keep = 400
    // Create entries for last 400 days (including today)
    let cursor = todayKey
    for (let i = 0; i < keep; i++) {
      const isToday = cursor === todayKey
      ensureEntry(cursor, isToday)
      cursor = addDays(cursor, -1)
    }
    // Trim old keys
    const keys = Object.keys(state.dailyProgress).sort()
    if (keys.length > keep) {
      const toDelete = keys.slice(0, keys.length - keep)
      for (const k of toDelete) delete state.dailyProgress[k]
    }
  } else {
    // Light: only today
    ensureEntry(todayKey, true)
  }

  return state.dailyProgress
}

/**
 * Compute perfect-day streaks.
 * - current: consecutive perfect days ending today (or yesterday if today not yet perfect, today stays open)
 * - best: max consecutive run ever
 * - recent: last 10 days for UI
 */
export function computeDisciplineStreak(state, todayKey, now = new Date()) {
  const history = {} // dateKey -> perfect bool
  const details = {} // dateKey -> progress detail

  // Build history map from dailyProgress + live today
  // We need up to 400 days
  let cursor = todayKey
  for (let i = 0; i < 400; i++) {
    const prog = getDayProgress(state, cursor, todayKey, now)
    history[cursor] = !!prog.perfect
    details[cursor] = prog
    cursor = addDays(cursor, -1)
  }

  // Current streak: today open logic
  let current = 0
  cursor = todayKey
  let todayPerfect = history[todayKey] || false
  let startedCounting = false

  // If today is perfect, count from today
  // If today not perfect, count from yesterday (today stays open, doesn't break)
  for (let i = 0; i < 400; i++) {
    const key = addDays(todayKey, -i)
    const perfect = history[key] || false

    if (i === 0) {
      if (perfect) {
        current++
        startedCounting = true
      } else {
        // Today not perfect yet — don't break, continue to yesterday
        startedCounting = false
        continue
      }
    } else {
      if (!startedCounting) {
        // We skipped today, now we are at yesterday
        if (perfect) {
          current++
          startedCounting = true
        } else {
          break // yesterday not perfect, streak 0
        }
      } else {
        if (perfect) current++
        else break
      }
    }
  }

  // Best streak: scan chronologically
  const sortedKeys = Object.keys(history).sort() // ascending
  let best = 0
  let run = 0
  let prevKey = null
  for (const key of sortedKeys) {
    if (!history[key]) {
      run = 0
      prevKey = null
      continue
    }
    if (prevKey && addDays(prevKey, 1) === key) {
      run += 1
    } else {
      run = 1
    }
    prevKey = key
    if (run > best) best = run
  }
  best = Math.max(best, current)

  // Recent 10 days for UI
  const recent = []
  for (let i = 9; i >= 0; i--) {
    const key = addDays(todayKey, -i)
    const prog = details[key] || getDayProgress(state, key, todayKey, now)
    recent.push({
      dateKey: key,
      perfect: !!history[key],
      isToday: key === todayKey,
      tasksPlanned: prog.tasksPlanned,
      tasksCompleted: prog.tasksCompleted,
      timetablePlanned: prog.timetablePlanned,
      timetableCompleted: prog.timetableCompleted,
    })
  }

  const totalPerfect = Object.values(history).filter(Boolean).length
  const lastPerfectDate = (() => {
    let c = todayKey
    for (let i = 0; i < 400; i++) {
      if (history[c]) return c
      c = addDays(c, -1)
    }
    return null
  })()

  return {
    current,
    best,
    history,
    details,
    recent,
    totalPerfect,
    lastPerfectDate,
    todayPerfect,
  }
}

/**
 * Evaluate all titles (currently only DISCIPLINE_MONSTER)
 */
export function evaluateTitles(state, todayKey, now = new Date()) {
  const streakInfo = computeDisciplineStreak(state, todayKey, now)
  const def = TITLE_DEFINITIONS.DISCIPLINE_MONSTER

  const best = streakInfo.best
  const current = streakInfo.current
  const unlocked = best >= def.requirement

  // Determine progress for UI (capped at requirement)
  const progress = Math.min(current, def.requirement)
  const remaining = Math.max(0, def.requirement - current)

  // For display: if unlocked, show unlocked state
  const titleState = state.titles?.[def.key] || {}

  return {
    disciplineMonster: {
      definition: def,
      current,
      best,
      progress,
      remaining,
      total: def.requirement,
      unlocked,
      unlockedAt: titleState.unlockedAt || (unlocked ? todayKey : null),
      unlockedAtTs: titleState.unlockedAtTs || (unlocked ? now.getTime() : null),
      seen: !!titleState.seen,
      todayPerfect: streakInfo.todayPerfect,
      recent: streakInfo.recent,
      streakInfo,
    },
  }
}

/**
 * Check if a title just got unlocked (transition from locked to unlocked)
 * Returns { newlyUnlocked: boolean, titleKey }
 */
export function checkNewUnlock(prevTitles, nextTitles) {
  const def = TITLE_DEFINITIONS.DISCIPLINE_MONSTER
  const prev = prevTitles?.[def.key]?.unlocked || false
  const next = nextTitles?.disciplineMonster?.unlocked || false
  if (!prev && next) {
    return { newlyUnlocked: true, key: def.key, definition: def }
  }
  return { newlyUnlocked: false }
}

/** Helper for UI: format date key to human readable */
export function formatUnlockDate(dateKeyValue) {
  if (!dateKeyValue) return ''
  try {
    const d = new Date(`${dateKeyValue}T12:00:00`)
    return d.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' })
  } catch {
    return dateKeyValue
  }
}
