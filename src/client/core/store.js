/* -------------------------------------------------------------------------
   STORE — the single source of truth for the client
   -------------------------------------------------------------------------
   • loads + migrates localStorage (never resets user data)
   • materialises recurring-task occurrences and today's plan snapshot
   • keeps a lightweight score history so long-term charts survive edits
   • debounced writes, change notifications, tiny derived-stat cache
   ------------------------------------------------------------------------- */

import { CORRUPT_BACKUP_KEY, loadState, makeContext, saveState, uid } from '../lib/state.js'
import { dayStats, materializeDayPlan, streakHistory } from '../lib/daystats.js'
import { computeStreak } from '../lib/streak.js'
import { materializeOccurrences, nextOccurrenceAfterCompletion } from '../lib/recurrence.js'
import { pruneTop3 } from '../lib/top3.js'
import { pruneSentLog } from '../lib/reminders.js'
import { addDays, dateKey, nowMinutes as nowMinutesOf } from '../lib/dates.js'
import { emit } from './bus.js'
import { toast } from './dom.js'

/** live binding — importers always see the current state */
export let state = null

const listeners = new Set()
let saveTimer = null
let statsCache = new Map()
let status = { migrated: false, warnings: [], fresh: true, corrupted: false }

/** The browser storage used by the app (localStorage, or a stub in tests). */
function getStorage() {
  return typeof localStorage === 'undefined' ? null : localStorage
}

export function getStatus() {
  return status
}

/* ------------------------------------------------------------------ init */

export function initStore({ now = new Date() } = {}) {
  const today = dateKey(now)
  const loaded = loadState({ now: now.getTime() })
  state = loaded.state
  if (loaded.corrupted) {
    // never overwrite unreadable data in place: keep it under a rescue key so
    // the user can still copy it out (the toast below tells them about it)
    try {
      getStorage()?.setItem(CORRUPT_BACKUP_KEY, String(loaded.raw ?? ''))
    } catch {
      /* storage full or unavailable — the warning toast still fires */
    }
  }
  status = { migrated: loaded.migrated, warnings: loaded.warnings, fresh: loaded.fresh, corrupted: !!loaded.corrupted }

  materializeDayPlan(state, today)
  const { created } = materializeOccurrences({ tasks: state.tasks, todayKey: today, horizonDays: 7, uid })
  if (created.length) state.tasks.push(...created)
  pruneTop3(state)
  state.reminders.sent = pruneSentLog(state.reminders.sent, today, 14)
  state.dayPlans = trimMap(state.dayPlans, 400)
  syncScoreHistory(today, now)

  saveState(state)
  invalidate()
  return state
}

function trimMap(map, keepKeys) {
  const keys = Object.keys(map || {}).sort()
  if (keys.length <= keepKeys) return map || {}
  const keep = keys.slice(-keepKeys)
  const next = {}
  for (const key of keep) next[key] = map[key]
  return next
}

/* ------------------------------------------------------------- persistence */

export function save({ immediate = false } = {}) {
  if (saveTimer) clearTimeout(saveTimer)
  if (immediate) {
    saveTimer = null
    saveState(state)
    return
  }
  saveTimer = setTimeout(() => {
    saveTimer = null
    saveState(state)
  }, 350)
}

export function flush() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
    saveState(state)
  }
}

/** Mutate state, persist, invalidate caches and notify views. */
export function commit(mutator, { immediate = false, silent = false } = {}) {
  if (typeof mutator === 'function') mutator(state)
  materializeDayPlan(state, currentDayKey())
  save({ immediate })
  invalidate()
  if (!silent) notify()
}

export function replaceState(next) {
  state = next
  invalidate()
  save({ immediate: true })
  notify()
}

export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function notify() {
  for (const listener of listeners) {
    try {
      listener(state)
    } catch (error) {
      console.error('[store] listener failed', error)
    }
  }
  // chrome widgets (streak, focus chip, timers) listen on the bus so they can
  // stay decoupled from whichever view triggered the change
  emit('store:change', state)
}

/* ---------------------------------------------------------------- helpers */

export function now() {
  return new Date()
}

export function currentDayKey(date = new Date()) {
  return dateKey(date)
}

export function minutesNow(date = new Date()) {
  return nowMinutesOf(date)
}

export function invalidate() {
  statsCache = new Map()
}

/** Cached day stats (invalidated on every commit). */
export function statsFor(dateKeyValue, { now: nowDate = new Date() } = {}) {
  const key = `${dateKeyValue}:${Math.floor(nowDate.getTime() / 60000)}`
  if (statsCache.has(key)) return statsCache.get(key)
  const stats = dayStats(state, dateKeyValue, { todayKey: currentDayKey(nowDate), now: nowDate })
  statsCache.set(key, stats)
  return stats
}

export function todayStats(nowDate = new Date()) {
  return statsFor(currentDayKey(nowDate), { now: nowDate })
}

export function streak(nowDate = new Date()) {
  const today = currentDayKey(nowDate)
  return computeStreak({ todayKey: today, history: streakHistory(state, { todayKey: today, now: nowDate, days: 400 }) })
}

/** Keep a per-day record of the score so history stays stable over time. */
export function syncScoreHistory(today = currentDayKey(), nowDate = new Date()) {
  if (!state.scoreHistory) state.scoreHistory = {}
  const cutoff = addDays(today, -400)
  const keys = new Set(Object.keys(state.dayPlans || {}).filter((k) => k < today && k >= cutoff))
  for (const key of Object.keys(state.completionLog || {})) if (key < today && key >= cutoff) keys.add(key)
  for (const task of state.tasks) if (task.date && task.date < today && task.date >= cutoff) keys.add(task.date)

  for (const key of keys) {
    const stats = dayStats(state, key, { todayKey: today, now: nowDate })
    state.scoreHistory[key] = {
      score: stats.score,
      focusedMinutes: stats.focusedMinutes,
      top3Done: stats.top3Done,
      top3Total: stats.top3Total,
      computedAt: nowDate.getTime(),
    }
  }
  for (const key of Object.keys(state.scoreHistory)) if (key < cutoff) delete state.scoreHistory[key]
  return state.scoreHistory
}

/**
 * Make sure every repeating task has its upcoming occurrences (up to a week
 * ahead). Idempotent: existing series/date pairs are never duplicated.
 */
export function ensureRecurringOccurrences(todayKey = currentDayKey()) {
  const { created } = materializeOccurrences({ tasks: state.tasks, todayKey, horizonDays: 7, uid })
  if (created.length) {
    state.tasks.push(...created)
    return created
  }
  return []
}

/** Roll a recurring series forward after an occurrence is completed. */
export function rollSeriesForward(task) {
  const next = nextOccurrenceAfterCompletion(task, state.tasks, { uid })
  if (next) state.tasks.push(next)
  return next
}

/** App-level facts other modules need. */
export function appContext(nowDate = new Date()) {
  return {
    todayKey: currentDayKey(nowDate),
    nowDate,
    nowMinutes: minutesNow(nowDate),
    stats: todayStats(nowDate),
  }
}

/** Announce migration/warnings once, after the first paint. */
export function announceStatus() {
  if (status.migrated) {
    toast('Your saved data was upgraded to the new schema — nothing was lost.', 'success', { timeout: 6000 })
  }
  for (const warning of status.warnings) toast(warning, 'error', { timeout: 8000 })
  status = { ...status, warnings: [] }
}

export function contextForTests(overrides = {}) {
  return makeContext(overrides)
}
