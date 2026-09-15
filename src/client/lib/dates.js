/* -------------------------------------------------------------------------
   PURE DATE HELPERS
   Dependency-free, timezone-stable date maths used by every analytics module
   so results are identical in the browser and in the Node test runner.
   All public helpers work with `YYYY-MM-DD` keys (local calendar days).
   ------------------------------------------------------------------------- */

/** @param {number} n */
export function pad2(n) {
  return String(n).padStart(2, '0')
}

/**
 * Local calendar-day key for a Date (or an already-formatted key).
 * @param {Date|string} [date]
 * @returns {string} `YYYY-MM-DD`
 */
export function dateKey(date = new Date()) {
  if (typeof date === 'string') return date.slice(0, 10)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/**
 * Parse a `YYYY-MM-DD` key into a local Date at midday (DST-safe).
 * @param {string} key
 */
export function parseKey(key) {
  const [y, m, d] = String(key).split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0)
}

/**
 * @param {string} key
 * @param {number} days
 */
export function addDays(key, days) {
  const d = parseKey(key)
  d.setDate(d.getDate() + days)
  return dateKey(d)
}

/** Whole days between two keys (b - a). */
export function diffDays(a, b) {
  return Math.round((parseKey(b).getTime() - parseKey(a).getTime()) / 86400000)
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayOf(key) {
  return parseKey(key).getDay()
}

/** True for a well-formed `YYYY-MM-DD` string that is a real calendar day. */
export function isValidKey(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false
  const d = parseKey(key)
  return !Number.isNaN(d.getTime()) && dateKey(d) === key
}

export function isWeekend(key) {
  const w = weekdayOf(key)
  return w === 0 || w === 6
}

/**
 * Start of the week containing `key`.
 * @param {string} key
 * @param {number} [weekStart] 0 = Sunday, 1 = Monday (default)
 */
export function startOfWeek(key, weekStart = 1) {
  const w = weekdayOf(key)
  const delta = (w - weekStart + 7) % 7
  return addDays(key, -delta)
}

/** @returns {string[]} the 7 day keys of the week containing `key` */
export function weekDates(key, weekStart = 1) {
  const start = startOfWeek(key, weekStart)
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

/** `2026-09` for month grouping. */
export function monthKey(key) {
  return key.slice(0, 7)
}

export function isBetweenKeys(key, from, to) {
  return key >= from && key <= to
}

/** "09:30" → 570. Numbers pass through (so helpers stay idempotent). */
export function minutesOfDay(hhmm) {
  if (typeof hhmm === 'number' && Number.isFinite(hhmm)) return Math.round(hhmm)
  const [h, m] = String(hhmm ?? '00:00').split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** 570 → "09:30" */
export function toHHMM(minutes) {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`
}

/** 200 → "3h 20m" */
export function formatDuration(minutes) {
  const total = Math.max(0, Math.round(minutes || 0))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h && m) return `${h}h ${m}m`
  if (h) return `${h}h`
  return `${m}m`
}

/** 125 seconds → "02:05" */
export function formatClock(seconds) {
  const total = Math.max(0, Math.round(seconds || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`
}

/** Human label for a day key: "Tue, Sep 15" */
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function formatKeyLabel(key, { weekday = true, year = false } = {}) {
  const d = parseKey(key)
  const parts = []
  if (weekday) parts.push(WEEKDAY_SHORT[d.getDay()])
  parts.push(`${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`)
  if (year) parts.push(String(d.getFullYear()))
  return parts.join(', ')
}

export function weekdayName(index) {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][index] ?? ''
}

export function weekdayShort(index) {
  return WEEKDAY_SHORT[index] ?? ''
}

/** Minutes elapsed since midnight for a Date. */
export function nowMinutes(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes()
}
