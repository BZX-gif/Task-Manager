/* -------------------------------------------------------------------------
   CALENDAR EXPORT — your commitments, outside this app
   -------------------------------------------------------------------------
   Two local, dependency-free exports:

     • buildCalendar / buildIcs → an RFC 5545 (.ics) file that Google Calendar,
       Apple Calendar and Outlook all accept. Every event has a stable UID so
       re-importing an updated file updates rather than duplicates.

     • buildDaySheet          → the model behind the printable day sheet
       (a calm piece of paper for the desk, not a screenshot of the app).

   Nothing leaves the device: the file is generated in the browser and saved
   through the same download path as JSON backups.
   ------------------------------------------------------------------------- */

import { allTimetableBlocks } from './missions.js'
import { scheduleFor } from './planner.js'
import { addDays, isValidKey, minutesOfDay } from './dates.js'

const REST_TITLE = /^(sleep|rest\b|wind[- ]?down|break\b|nap\b)/i

/** Blocks that represent recovery rather than a commitment. */
export function isRestBlock(block) {
  if (!block) return true
  if (block.protected) return true
  if (block.kind === 'protected') return true
  if ((block.duration || 0) >= 480) return true
  return REST_TITLE.test(String(block.title || '').trim())
}

function minutesLabel(block) {
  return block.time || ''
}

/**
 * Build a predictable list of calendar events for a date range.
 * Missions without a start time become all-day events so nothing is lost.
 * @param {any} state
 * @param {{ from?: string, days?: number, includeRest?: boolean }} [options]
 */
export function buildCalendar(state, { from, days = 14, includeRest = false } = {}) {
  if (!state || !isValidKey(from)) return []
  const events = []
  const seen = new Set()
  const range = Math.max(1, Math.min(366, Number(days) || 1))

  for (let offset = 0; offset < range; offset += 1) {
    const day = addDays(from, offset)
    for (const block of scheduleFor(state, day)) {
      if (!block || !isValidKey(day)) continue
      if (!includeRest && isRestBlock(block)) continue
      if (!block.time) continue
      const startMinutes = minutesOfDay(block.time)
      const duration = Math.max(5, Number(block.duration) || 30)
      const category = state.categories?.find((cat) => cat.id === block.cat)
      const key = `${day}:${block.id}`
      if (seen.has(key)) continue
      seen.add(key)
      events.push({
        uid: icsUid(day, block.id || block.title),
        day,
        startMinutes,
        endMinutes: startMinutes + duration,
        duration,
        title: String(block.title || 'Untitled').slice(0, 200),
        description: [category?.name, block.priority ? `${block.priority} priority` : '', block.taskId ? 'Mission' : 'Time block'].filter(Boolean).join(' · '),
        category: category?.name || '',
        allDay: false,
        status: block.status === 'completed' ? 'completed' : 'planned',
      })
    }

    // Untimed missions still deserve a place in the calendar.
    for (const task of state.tasks || []) {
      if (task.date !== day || task.time || task.inbox || task.done) continue
      if (task.status === 'cancelled') continue
      const key = `all-day:${task.id}:${day}`
      if (seen.has(key)) continue
      seen.add(key)
      const category = state.categories?.find((cat) => cat.id === task.cat)
      events.push({
        uid: icsUid(day, task.id),
        day,
        startMinutes: 0,
        endMinutes: 0,
        duration: Number(task.estimateMinutes) || 30,
        title: String(task.title || 'Untitled').slice(0, 200),
        description: [category?.name, task.priority ? `${task.priority} priority` : '', 'All-day mission'].filter(Boolean).join(' · '),
        category: category?.name || '',
        allDay: true,
        status: 'planned',
      })
    }
  }

  return events.sort((a, b) => a.day.localeCompare(b.day) || a.startMinutes - b.startMinutes || a.title.localeCompare(b.title))
}

export function icsUid(day, sourceId) {
  const safe = String(sourceId || 'block').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60) || 'block'
  return `${day.replace(/-/g, '')}-${safe}@command.local`
}

/** RFC 5545 TEXT escaping. */
export function escapeIcsText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null
function byteLength(value) {
  if (encoder) return encoder.encode(value).length
  let bytes = 0
  for (const char of String(value)) {
    const code = char.codePointAt(0) || 0
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
  }
  return bytes
}

/** Fold content lines at 75 octets, as the specification requires. */
export function foldIcsLine(line) {
  const parts = []
  let current = ''
  for (const char of String(line)) {
    if (byteLength(current + char) > 75) {
      parts.push(current)
      current = ` ${char}`
    } else {
      current += char
    }
  }
  parts.push(current)
  return parts.join('\r\n')
}

function stamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function eventStart(event) {
  const [year, month, day] = event.day.split('-').map(Number)
  const date = new Date(year, month - 1, day, 0, 0, 0, 0)
  date.setMinutes(event.startMinutes)
  return date
}

function eventEnd(event) {
  const [year, month, day] = event.day.split('-').map(Number)
  const date = new Date(year, month - 1, day, 0, 0, 0, 0)
  date.setMinutes(event.endMinutes)
  return date
}

/** Next calendar day for an all-day DTEND. */
function nextDayKey(day) {
  return addDays(day, 1)
}

/**
 * Serialise events to an RFC 5545 calendar.
 * @returns {string} CRLF-joined .ics content
 */
export function buildIcs(events, { now = new Date(), calendarName = 'Command · Personal Command Center', productId = '-//Command//Personal Command Center//EN' } = {}) {
  const generated = stamp(now)
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${escapeIcsText(productId)}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
  ]

  for (const event of events || []) {
    if (!event || !isValidKey(event.day)) continue
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${escapeIcsText(event.uid)}`)
    lines.push(`DTSTAMP:${generated}`)
    if (event.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${event.day.replace(/-/g, '')}`)
      lines.push(`DTEND;VALUE=DATE:${nextDayKey(event.day).replace(/-/g, '')}`)
    } else {
      lines.push(`DTSTART:${stamp(eventStart(event))}`)
      lines.push(`DTEND:${stamp(eventEnd(event))}`)
    }
    lines.push(`SUMMARY:${escapeIcsText(event.title)}`)
    if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`)
    if (event.category) lines.push(`CATEGORIES:${escapeIcsText(event.category)}`)
    lines.push('LOCATION:Command workspace')
    lines.push('TRANSP:OPAQUE')
    lines.push('SEQUENCE:0')
    lines.push('STATUS:CONFIRMED')
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return lines.map(foldIcsLine).join('\r\n')
}

export function calendarFilename(from, days = 14) {
  return `command-calendar-${from}-${days}d.ics`
}

/**
 * The printable day sheet model. Deliberately only what belongs on paper:
 * the shape of the day, the three priorities, and the open work.
 */
export function buildDaySheet(state, date, { now = new Date() } = {}) {
  const blocks = scheduleFor(state, date)
    .filter((block) => !isRestBlock(block))
    .map((block) => ({
      id: block.id,
      time: minutesLabel(block),
      duration: block.duration,
      title: block.title,
      category: state.categories?.find((cat) => cat.id === block.cat)?.name || '',
      priority: block.priority || 'medium',
      protected: !!block.protected,
      completed: block.status === 'completed',
    }))
    .sort((a, b) => minutesOfDay(a.time) - minutesOfDay(b.time))

  const missions = (state.tasks || [])
    .filter((task) => task.date === date && !task.time && !task.inbox && task.status !== 'cancelled')
    .map((task) => ({
      id: task.id,
      title: task.title,
      done: !!task.done,
      estimateMinutes: task.estimateMinutes,
      priority: task.priority,
      category: state.categories?.find((cat) => cat.id === task.cat)?.name || '',
    }))
    .sort((a, b) => Number(a.done) - Number(b.done) || a.title.localeCompare(b.title))

  const top3Ids = state.top3?.[date] || []
  const priorities = top3Ids
    .map((id) => {
      const task = state.tasks?.find((item) => item.id === id)
      if (!task) return null
      return { id: task.id, title: task.title, done: !!task.done, estimateMinutes: task.estimateMinutes }
    })
    .filter(Boolean)

  const plannedMinutes = [...blocks, ...missions].reduce((sum, item) => sum + (Number(item.duration ?? item.estimateMinutes) || 0), 0)
  const doneMinutes = blocks.filter((block) => block.completed).reduce((sum, block) => sum + (block.duration || 0), 0)

  return {
    date,
    generatedAt: now.getTime(),
    blocks,
    missions,
    priorities,
    plannedMinutes,
    doneMinutes,
    focusMinutes: (state.focus?.sessions || [])
      .filter((session) => session.date === date && session.mode !== 'break')
      .reduce((sum, session) => sum + Math.round((session.focusedSeconds || 0) / 60), 0),
    note: state.journal?.[date]?.note || '',
    count: blocks.length + missions.length,
  }
}

/** Read-only sanity counts for the Settings screen. */
export function calendarCoverage(state, from, days = 14) {
  const events = buildCalendar(state, { from, days })
  return {
    events: events.length,
    allDay: events.filter((event) => event.allDay).length,
    timed: events.filter((event) => !event.allDay).length,
    blocks: allTimetableBlocks(state).length,
  }
}
