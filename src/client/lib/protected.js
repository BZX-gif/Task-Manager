/* -------------------------------------------------------------------------
   PROTECTED TIME (sleep / meals / no-work windows)
   -------------------------------------------------------------------------
   Purely a scheduling feature: the recommendation engine and the recovery
   planner avoid these windows, and the timetable warns about obvious
   conflicts. Windows may wrap midnight (e.g. 23:00 → 06:00) and may be
   limited to certain weekdays.
   ------------------------------------------------------------------------- */

import { minutesOfDay, toHHMM, weekdayOf } from './dates.js'

export const DEFAULT_SLEEP_WINDOW = { label: 'Sleep', start: '23:00', end: '06:00', days: [] }

/**
 * @typedef {Object} ProtectedBlock
 * @property {string} id
 * @property {string} label
 * @property {string} start  "23:00"
 * @property {string} end    "06:00"
 * @property {number[]} [days] 0=Sun…6=Sat, empty = every day
 */

/** Safely read a `HH:MM` string or an already-normalised minute count. */
function toMinutes(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) return ((Math.round(value) % 1440) + 1440) % 1440
  return minutesOfDay(value || fallback)
}

/**
 * @param {any} block
 * @returns {{id:string,label:string,start:number,end:number,wraps:boolean,days:number[]}}
 * Idempotent: normalising a normalised block returns the same values.
 */
export function normalizeBlock(block) {
  const start = toMinutes(block?.start, '23:00')
  const end = toMinutes(block?.end, '06:00')
  return {
    id: String(block?.id ?? `${start}-${end}`),
    label: String(block?.label || 'Protected time'),
    start,
    end,
    wraps: end <= start,
    days: Array.isArray(block?.days) ? block.days.filter((d) => Number.isInteger(d)) : [],
  }
}

/** Does this block apply on the given weekday? */
export function appliesOn(block, key) {
  const b = normalizeBlock(block)
  return b.days.length === 0 || b.days.includes(weekdayOf(key))
}

/**
 * Is `minutes` (minutes past midnight) inside any protected window?
 * @returns {ReturnType<typeof normalizeBlock>|null}
 */
export function protectionAt(minutes, blocks = [], key = null) {
  for (const block of blocks) {
    const b = normalizeBlock(block)
    if (key && !appliesOn(b, key)) continue
    if (b.wraps) {
      if (minutes >= b.start || minutes < b.end) return b
    } else if (minutes >= b.start && minutes < b.end) {
      return b
    }
  }
  return null
}

/** Label like "23:00 → 06:00" */
export function blockLabel(block) {
  const b = normalizeBlock(block)
  return `${toHHMM(b.start)} → ${toHHMM(b.end)}`
}

/**
 * Timetable blocks that overlap a protected window (used for the warning).
 * @returns {Array<{id:string,title:string,time:string,duration:number,protectedLabel:string,overlapMinutes:number}>}
 */
export function protectedConflicts(timetable = [], blocks = [], key = null) {
  const out = []
  for (const item of timetable) {
    const start = minutesOfDay(item.time)
    const duration = item.duration || 60
    const end = start + duration
    for (const block of blocks) {
      const b = normalizeBlock(block)
      if (key && !appliesOn(b, key)) continue
      const overlap = overlapMinutes(start, end, b)
      if (overlap > 0) {
        out.push({
          id: item.id,
          title: item.title,
          time: item.time,
          duration,
          protectedLabel: b.label,
          overlapMinutes: Math.round(overlap),
        })
        break
      }
    }
  }
  return out
}

/** Overlap between a block interval and a protected window (handles wrapping). */
export function overlapMinutes(start, end, block) {
  const b = normalizeBlock(block)
  const segs = b.wraps
    ? [
        [b.start, 1440],
        [0, b.end],
      ]
    : [[b.start, b.end]]
  let total = 0
  for (const [s, e] of segs) {
    total += Math.max(0, Math.min(end, e) - Math.max(start, s))
  }
  return total
}

/**
 * Minutes inside [fromMinutes, toMinutes] that are NOT protected.
 * Used by the recovery planner to find genuinely available time.
 */
export function unprotectedMinutes(fromMinutes, toMinutes, blocks = [], key = null) {
  const total = Math.max(0, toMinutes - fromMinutes)
  if (!blocks.length) return total
  let protectedCount = 0
  for (const block of blocks) {
    const b = normalizeBlock(block)
    if (key && !appliesOn(b, key)) continue
    protectedCount += overlapMinutes(fromMinutes, toMinutes, b)
  }
  return Math.max(0, total - protectedCount)
}

/** Rough summary for Settings ("Every day 23:00 → 06:00"). */
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export function describeBlock(block) {
  const b = normalizeBlock(block)
  const days = b.days.length ? b.days.map((d) => DAY_NAMES[d]).join('/') : 'Every day'
  return `${days} · ${toHHMM(b.start)} → ${toHHMM(b.end)}`
}
