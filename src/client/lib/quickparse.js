/* -------------------------------------------------------------------------
   QUICK PARSE — natural language in, structured mission out
   -------------------------------------------------------------------------
   Quick capture is the fastest path into the app, so it should understand the
   way people actually type:

     "Pay electricity bill tomorrow at 6pm for 15m !high #life"
     "Deep work every weekday 9:00 90m #work"
     "Call the bank next friday 11am"
     "Review notes 20/11 3:30pm"

   The parser is pure and deterministic: every field it returns is something
   the user can see (as a chip) before saving, and it never invents a date,
   time or category that was not typed.

   Recognised
     dates       today · tonight · tomorrow · next week · weekdays ·
                 20/11 · 2026-11-20 · Nov 20 · "next monday"
     times       9:30pm · 21:30 · at 6pm · noon · midnight
     length      15m · 45 min · 1.5h · 2 hours · for 90 minutes
     priority    !! · !high · !h · !1 · p1 · !low · !l · !3
     category    #work · #learning · #life-admin (matched to your categories)
     repetition  daily · every day · weekdays · weekly · every monday ·
                 monthly · every 1st
   ------------------------------------------------------------------------- */

import { addDays, dateKey, isValidKey, weekdayOf } from './dates.js'

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const DAY_ALIASES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const PRIORITY_VALUES = ['high', 'medium', 'low']

export const QUICK_PARSE_HELP = 'Try “Send the report tomorrow 10am for 45m !high #work” or “Deep work every weekday 9:00 90m”.'

const isWordChar = (value) => /[a-z0-9]/i.test(value || '')

/** Remove one match from the working string, leaving a space behind. */
function cut(text, match) {
  return `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`
}

function cleanTitle(text) {
  return String(text)
    .replace(/\s+/g, ' ')
    .replace(/\s*([,;·])\s*/g, '$1 ')
    .replace(/^[\s,;:·\-–—]+|[\s,;:·\-–—]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function slug(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function validPriority(word) {
  const w = String(word).toLowerCase()
  if (w === '!!' || w === '!high' || w === '!h' || w === '!1' || w === 'p1' || w === 'urgent') return 'high'
  if (w === '!medium' || w === '!m' || w === '!2' || w === 'p2') return 'medium'
  if (w === '!low' || w === '!l' || w === '!3' || w === 'p3') return 'low'
  return null
}

function parseClock(hourText, minuteText, meridiem) {
  let hour = Number(hourText)
  const minute = minuteText == null ? 0 : Number(minuteText)
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute > 59) return null
  const mer = String(meridiem || '').toLowerCase().replace(/\./g, '')
  if (mer) {
    if (hour > 12 || hour < 1) return null
    if (mer === 'pm' && hour !== 12) hour += 12
    if (mer === 'am' && hour === 12) hour = 0
  }
  if (hour > 23) return null
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function isoKey(year, month, day) {
  const y = Number(year)
  const m = Number(month)
  const d = Number(day)
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const candidate = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return isValidKey(candidate) ? candidate : null
}

/** Next upcoming occurrence of a weekday (today counts as today). */
function nextWeekday(todayKey, weekday, { forceNext = false } = {}) {
  const delta = (weekday - weekdayOf(todayKey) + 7) % 7
  const ahead = forceNext ? (delta === 0 ? 7 : delta) : delta
  return addDays(todayKey, ahead)
}

function weekdayFromName(word) {
  const value = String(word || '').toLowerCase()
  const full = WEEKDAYS.findIndex((day) => day === value || (value.length > 2 && day.startsWith(value)))
  if (full >= 0) return full
  const alias = DAY_ALIASES.indexOf(value)
  return alias >= 0 ? alias : -1
}

function monthFromName(word) {
  const value = String(word || '').toLowerCase().slice(0, 3)
  return MONTHS.indexOf(value)
}

/**
 * Parse one quick-capture sentence.
 *
 * @param {string} input
 * @param {Object} [options]
 * @param {Date} [options.now]
 * @param {string} [options.todayKey]  override for deterministic tests
 * @param {Array<{id:string,name:string}>} [options.categories]
 * @returns {{
 *   input:string, title:string, date:string|null, time:string|null,
 *   estimateMinutes:number|null, priority:'high'|'medium'|'low'|null,
 *   categoryId:string|null, recurrence:any|null,
 *   matches:Array<{kind:string,value:string}>,
 *   hasAnything:boolean, impliedTime:string|null
 * }}
 */
export function parseQuickCapture(input, { now = new Date(), todayKey = null, categories = [] } = {}) {
  const raw = String(input ?? '')
  const today = todayKey || dateKey(now)
  let rest = raw
  /** @type {Array<{kind:string,value:string}>} */
  const matches = []
  let date = null
  let time = null
  let impliedTime = null
  let estimateMinutes = null
  /** @type {'high'|'medium'|'low'|null} */
  let priority = null
  let categoryId = null
  /** @type {any} */
  let recurrence = null

  const record = (kind, value) => matches.push({ kind, value: String(value) })

  /* ---------------------------------------------------------- priority */
  const priorityMatch = rest.match(/(^|\s)(!!|!high|!medium|!low|![hml123]|p[123])(?=\s|$)/i)
  if (priorityMatch) {
    const value = validPriority(priorityMatch[2])
    if (value) {
      priority = value
      record('priority', value)
      rest = cut(rest, priorityMatch)
    }
  }

  /* -------------------------------------------------------- repetition */
  const weekdayList = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun'
  const recurrencePatterns = [
    { re: /\b(every\s+day|daily)\b/i, build: () => ({ freq: 'daily' }) },
    { re: /\b(every\s+week\s*day|weekdays)\b/i, build: () => ({ freq: 'weekdays', weekdays: [1, 2, 3, 4, 5] }) },
    {
      re: new RegExp(`\\b(every\\s+(${weekdayList})((\\s*(,|and|\\/)\\s*)(${weekdayList}))*)\\b`, 'i'),
      build: (text) => {
        const days = [...String(text).toLowerCase().matchAll(new RegExp(weekdayList, 'g'))]
          .map((entry) => weekdayFromName(entry[0]))
          .filter((day) => day >= 0)
        return { freq: 'weekly', weekdays: [...new Set(days)] }
      },
    },
    { re: /\b(every\s+week|weekly)\b/i, build: () => ({ freq: 'weekly', weekdays: [] }) },
    {
      re: /\bevery\s+(\d{1,2})(?:st|nd|rd|th)\b/i,
      build: (text) => ({ freq: 'monthly', dayOfMonth: Number(String(text).match(/\d{1,2}/)?.[0]) }),
    },
    { re: /\b(every\s+month|monthly)\b/i, build: () => ({ freq: 'monthly' }) },
  ]
  for (const pattern of recurrencePatterns) {
    const match = rest.match(pattern.re)
    if (!match) continue
    recurrence = { ...pattern.build(match[0]) }
    record('recurrence', recurrence.freq)
    rest = cut(rest, match)
    break
  }

  /* ----------------------------------------------------------- duration */
  const durationMatch = rest.match(/\b(?:for\s+)?(\d+(?:\.\d+)?)\s*(minutes?|mins?|m|hours?|hrs?|h)\b/i)
  if (durationMatch) {
    const amount = Number(durationMatch[1])
    const unit = durationMatch[2].toLowerCase()
    const minutes = /^h/.test(unit) ? amount * 60 : amount
    if (Number.isFinite(minutes) && minutes >= 5 && minutes <= 600) {
      estimateMinutes = Math.round(minutes)
      record('duration', String(estimateMinutes))
      rest = cut(rest, durationMatch)
    }
  }

  /* --------------------------------------------------------------- time */
  const timePatterns = [
    { re: /\b(?:at\s+)?(noon)\b/i, read: () => '12:00' },
    { re: /\b(?:at\s+)?(midnight)\b/i, read: () => '00:00' },
    { re: /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))\s*(am|pm|a\.m\.|p\.m\.)\b/i, read: (m) => parseClock(m[1], m[2], m[3]) },
    { re: /\b(?:at\s+)?(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)\b/i, read: (m) => parseClock(m[1], 0, m[2]) },
    { re: /\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/, read: (m) => parseClock(m[1], m[2], '') },
  ]
  for (const pattern of timePatterns) {
    const match = rest.match(pattern.re)
    if (!match) continue
    const parsed = pattern.read(match)
    if (!parsed) continue
    time = parsed
    record('time', parsed)
    rest = cut(rest, match)
    break
  }

  /* --------------------------------------------------------------- date */
  const datePatterns = [
    { name: 'day-after-tomorrow', re: /\b(day\s+after\s+tomorrow)\b/i, value: () => addDays(today, 2) },
    { name: 'tomorrow', re: /\b(tomorrow|tmrw|tmr)\b/i, value: () => addDays(today, 1) },
    { name: 'today', re: /\b(today)\b/i, value: () => today },
    { name: 'tonight', re: /\b(tonight)\b/i, value: () => today, time: '20:00' },
    { name: 'next-week', re: /\b(next\s+week)\b/i, value: () => addDays(today, 7) },
    {
      name: 'next-weekday',
      re: new RegExp(`\\b(next\\s+(${weekdayList}))\\b`, 'i'),
      value: (text) => nextWeekday(today, weekdayFromName(String(text).replace(/next\s+/i, '')), { forceNext: true }),
    },
    {
      name: 'weekday',
      re: new RegExp(`\\b(this\\s+)?(${weekdayList})\\b`, 'i'),
      value: (text) => {
        const cleaned = String(text).replace(/this\s+/i, '').trim()
        const target = weekdayFromName(cleaned)
        return target < 0 ? null : nextWeekday(today, target)
      },
    },
    { name: 'iso-date', re: /\b(\d{4})-(\d{2})-(\d{2})\b/, value: (text) => text },
    {
      name: 'slash-date',
      re: /\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/,
      value: (text, match) => {
        const day = Number(match[1])
        const month = Number(match[2])
        let year = match[3] ? Number(match[3]) : Number(today.slice(0, 4))
        if (year < 100) year += 2000
        let key = isoKey(year, month, day)
        // A bare day/month in the past means the next time it comes around.
        if (key && !match[3] && key < today) key = isoKey(year + 1, month, day)
        return key
      },
    },
    {
      name: 'month-day',
      re: /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i,
      value: (text, match) => {
        const month = monthFromName(match[1]) + 1
        const day = Number(match[2])
        let key = isoKey(Number(today.slice(0, 4)), month, day)
        if (key && key < today) key = isoKey(Number(today.slice(0, 4)) + 1, month, day)
        return key
      },
    },
    {
      name: 'day-month',
      re: /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\b/i,
      value: (text, match) => {
        const day = Number(match[1])
        const month = monthFromName(match[2]) + 1
        let key = isoKey(Number(today.slice(0, 4)), month, day)
        if (key && key < today) key = isoKey(Number(today.slice(0, 4)) + 1, month, day)
        return key
      },
    },
  ]
  for (const pattern of datePatterns) {
    const match = rest.match(pattern.re)
    if (!match) continue
    const value = pattern.value(match[0], match)
    if (!value || !isValidKey(value)) continue
    date = value
    record('date', date)
    if (pattern.time && !time) {
      time = pattern.time
      impliedTime = pattern.time
      record('time', time)
    }
    rest = cut(rest, match)
    break
  }

  /* ----------------------------------------------------------- category */
  const categoryMap = new Map()
  for (const category of Array.isArray(categories) ? categories : []) {
    if (!category || !category.id) continue
    categoryMap.set(slug(category.id), category.id)
    categoryMap.set(slug(category.name), category.id)
  }
  const tagMatches = [...rest.matchAll(/(^|\s)#([a-z0-9][a-z0-9_-]*)/gi)]
  for (const tag of tagMatches) {
    const wanted = slug(tag[2])
    let resolved = categoryMap.get(wanted) || null
    if (!resolved) {
      for (const [key, id] of categoryMap) {
        if (key && (key.startsWith(wanted) || wanted.startsWith(key))) {
          resolved = id
          break
        }
      }
    }
    if (resolved) {
      categoryId = resolved
      record('category', resolved)
      rest = cut(rest, tag)
      break
    }
  }

  /* ------------------------------------------------------------- finish */
  if (recurrence) {
    recurrence = {
      ...recurrence,
      startDate: recurrence.startDate || date || today,
      endDate: recurrence.endDate || null,
    }
  }

  const title = cleanTitle(rest)
  return {
    input: raw,
    title,
    date,
    time,
    estimateMinutes,
    priority,
    categoryId,
    recurrence,
    matches,
    hasAnything: matches.length > 0,
    impliedTime,
  }
}

/** Readable label for a parsed repetition, used by chips and the mission modal. */
export function recurrenceLabel(recurrence, { weekdayName = null } = {}) {
  if (!recurrence) return ''
  if (recurrence.freq === 'daily') return 'Every day'
  if (recurrence.freq === 'weekdays') return 'Weekdays'
  if (recurrence.freq === 'monthly') return recurrence.dayOfMonth ? `Monthly · day ${recurrence.dayOfMonth}` : 'Monthly'
  if (recurrence.freq === 'weekly') {
    const days = Array.isArray(recurrence.weekdays) ? recurrence.weekdays : []
    if (!days.length) return 'Weekly'
    return `Every ${days.map((day) => weekdayName?.(day) || WEEKDAYS[day] || '').filter(Boolean).join(', ')}`
  }
  return ''
}

/** Short label for a parsed priority. */
export function priorityLabel(priority) {
  return PRIORITY_VALUES.includes(priority) ? `${priority[0].toUpperCase()}${priority.slice(1)} priority` : ''
}

export { weekdayFromName }
