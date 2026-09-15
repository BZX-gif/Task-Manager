/* -------------------------------------------------------------------------
   RECURRING TASKS
   -------------------------------------------------------------------------
   A recurring task keeps ONE template record. Every occurrence is a normal
   task record that points back to the series:

       { id, seriesId, occurrenceDate, recurrence: {...}, ... }

   Occurrences are de-duplicated by `seriesId + occurrenceDate`, so generating
   them on load, on completion or from several tabs can never create doubles.
   ------------------------------------------------------------------------- */

import { addDays, diffDays, isValidKey, weekdayOf } from './dates.js'

export const FREQUENCIES = ['daily', 'weekdays', 'weekly', 'monthly']

/** Fallback id generator so the helpers can always be called. */
function defaultId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export const FREQUENCY_LABELS = {
  daily: 'Every day',
  weekdays: 'Selected days',
  weekly: 'Weekly',
  monthly: 'Monthly',
}

/**
 * @typedef {Object} Recurrence
 * @property {'daily'|'weekdays'|'weekly'|'monthly'} freq
 * @property {number[]} [weekdays]    0=Sun … 6=Sat
 * @property {number} [dayOfMonth]    1–31 (monthly)
 * @property {string} [startDate]     YYYY-MM-DD (inclusive)
 * @property {string|null} [endDate]  YYYY-MM-DD (inclusive) or null
 */

/** @param {any} rec @returns {Recurrence|null} */
export function normalizeRecurrence(rec) {
  if (!rec || typeof rec !== 'object') return null
  const freq = FREQUENCIES.includes(rec.freq) ? rec.freq : 'daily'
  const weekdays = Array.isArray(rec.weekdays)
    ? [...new Set(rec.weekdays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : []
  const dayOfMonth = Number.isInteger(rec.dayOfMonth) && rec.dayOfMonth >= 1 && rec.dayOfMonth <= 31 ? rec.dayOfMonth : null
  const startDate = isValidKey(rec.startDate) ? rec.startDate : null
  const endDate = isValidKey(rec.endDate) ? rec.endDate : null
  return { freq, weekdays, dayOfMonth, startDate, endDate }
}

/** Does the series have an occurrence on this calendar day? */
export function occursOn(rec, key) {
  const r = normalizeRecurrence(rec)
  if (!r) return false
  if (r.startDate && key < r.startDate) return false
  if (r.endDate && key > r.endDate) return false

  const dow = weekdayOf(key)
  switch (r.freq) {
    case 'daily':
      return true
    case 'weekdays': {
      const days = r.weekdays.length ? r.weekdays : [1, 2, 3, 4, 5]
      return days.includes(dow)
    }
    case 'weekly': {
      const days = r.weekdays.length ? r.weekdays : r.startDate ? [weekdayOf(r.startDate)] : [dow]
      return days.includes(dow)
    }
    case 'monthly': {
      const day = r.dayOfMonth || (r.startDate ? Number(r.startDate.slice(8, 10)) : 1)
      const monthEnd = lastDayOfMonth(key)
      return Number(key.slice(8, 10)) === Math.min(day, monthEnd)
    }
    default:
      return false
  }
}

function lastDayOfMonth(key) {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

/** Next occurrence on or after `fromKey` (defaults to strictly after). */
export function nextOccurrence(rec, fromKey, { inclusive = false, maxDays = 800 } = {}) {
  const r = normalizeRecurrence(rec)
  if (!r) return null
  let cursor = inclusive ? fromKey : addDays(fromKey, 1)
  if (r.startDate && cursor < r.startDate) cursor = r.startDate
  for (let i = 0; i < maxDays; i++) {
    if (r.endDate && cursor > r.endDate) return null
    if (occursOn(r, cursor)) return cursor
    cursor = addDays(cursor, 1)
  }
  return null
}

export function occurrenceKey(seriesId, key) {
  return `${seriesId}|${key}`
}

/** The identity of a task as an occurrence (template tasks count as their own first occurrence). */
export function seriesKeyOf(task) {
  if (!task) return null
  const seriesId = task.seriesId || (task.recurrence ? task.id : null)
  const date = task.occurrenceDate || task.date
  if (!seriesId || !date) return null
  return occurrenceKey(seriesId, date)
}

/**
 * Create the task record for one occurrence of a series.
 * The title/category/priority/estimate are copied; completion state is fresh.
 * @param {any} template
 * @param {string} key
 * @param {{ uid?: () => string, now?: number }} [options]
 */
export function buildOccurrence(template, key, options = {}) {
  const uid = options.uid || defaultId
  const now = options.now ?? Date.now()
  const seriesId = template.seriesId || template.id
  return {
    id: uid(),
    title: template.title,
    date: key,
    occurrenceDate: key,
    seriesId,
    recurrence: normalizeRecurrence(template.recurrence),
    priority: template.priority || 'medium',
    cat: template.cat || null,
    notes: template.notes || '',
    estimateMinutes: template.estimateMinutes ?? 30,
    inbox: false,
    done: false,
    createdAt: now,
    completedAt: null,
  }
}

/**
 * Generate every missing occurrence between today and today+horizon.
 * Safe to call as often as you like — existing series/date pairs are skipped.
 *
 * @param {Object} input
 * @param {Array<any>} input.tasks
 * @param {string} input.todayKey
 * @param {number} [input.horizonDays]
 * @param {() => string} input.uid
 * @param {number} [input.now]
 * @param {number} [input.limit]  hard cap on created records per run
 * @returns {{ created: any[], truncated: boolean }}
 */
export function materializeOccurrences({ tasks, todayKey, horizonDays = 7, uid, now = Date.now(), limit = 60 }) {
  const existing = new Set()
  for (const t of tasks) {
    const key = seriesKeyOf(t)
    if (key) existing.add(key)
  }

  const templates = tasks.filter((t) => t.recurrence && !t.endedSeries)
  const created = []
  for (const template of templates) {
    const seriesId = template.seriesId || template.id
    // never back-fill the past: occurrences start today and roll forward
    let cursor = todayKey
    const end = addDays(todayKey, horizonDays)
    while (cursor <= end) {
      if (occursOn(template.recurrence, cursor) && !existing.has(occurrenceKey(seriesId, cursor))) {
        const occurrence = buildOccurrence(template, cursor, { uid, now })
        created.push(occurrence)
        existing.add(occurrenceKey(seriesId, cursor))
        if (created.length >= limit) return { created, truncated: true }
      }
      cursor = addDays(cursor, 1)
    }
    // make sure the template itself is part of its own series (for de-duping)
    if (!template.seriesId) template.seriesId = seriesId
    if (!template.occurrenceDate) template.occurrenceDate = template.date || null
  }
  return { created, truncated: false }
}

/**
 * When an occurrence is completed we roll the series forward: the next
 * occurrence after that date is created if it does not exist yet.
 * @param {any} task
 * @param {any[]} tasks
 * @param {{ uid?: () => string, now?: number }} [options]
 */
export function nextOccurrenceAfterCompletion(task, tasks, options = {}) {
  const uid = options.uid || defaultId
  const now = options.now ?? Date.now()
  const rec = normalizeRecurrence(task?.recurrence) || normalizeRecurrence(tasks.find((t) => t.id === task?.seriesId)?.recurrence)
  if (!rec || !task) return null
  const seriesId = task.seriesId || task.id
  const from = task.occurrenceDate || task.date
  if (!from) return null
  const nextKey = nextOccurrence(rec, from, { inclusive: false })
  if (!nextKey) return null
  const exists = tasks.some((t) => seriesKeyOf(t) === occurrenceKey(seriesId, nextKey))
  if (exists) return null
  const template = tasks.find((t) => t.id === seriesId) || task
  return buildOccurrence({ ...template, recurrence: rec }, nextKey, { uid, now })
}

/** "Every day · from Sep 15" style label for the UI. */
export function recurrenceLabel(rec, { weekdaysShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] } = {}) {
  const r = normalizeRecurrence(rec)
  if (!r) return 'Does not repeat'
  const days = r.weekdays.map((d) => weekdaysShort[d]).join(' / ')
  let base
  switch (r.freq) {
    case 'daily':
      base = 'Every day'
      break
    case 'weekdays':
      base = r.weekdays.length ? days : 'Mon – Fri'
      break
    case 'weekly':
      base = r.weekdays.length ? `Weekly on ${days}` : 'Weekly'
      break
    case 'monthly':
      base = `Monthly on day ${r.dayOfMonth || (r.startDate ? Number(r.startDate.slice(8, 10)) : 1)}`
      break
    default:
      base = 'Repeats'
  }
  if (r.endDate) base += ` until ${r.endDate}`
  return base
}

/** Number of occurrences between two days (used by tests/diagnostics). */
export function occurrencesBetween(rec, fromKey, toKey) {
  if (toKey < fromKey) return 0
  const span = Math.min(diffDays(fromKey, toKey), 4000)
  let count = 0
  for (let i = 0; i <= span; i++) {
    if (occursOn(rec, addDays(fromKey, i))) count++
  }
  return count
}
