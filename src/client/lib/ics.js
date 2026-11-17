/* -------------------------------------------------------------------------
   CALENDAR IMPORT — read a real .ics file, locally
   -------------------------------------------------------------------------
   People already have a calendar. Typing every meeting into a task manager is
   why task managers get abandoned. This module turns an exported iCalendar
   file into dated, protected time blocks so the planner finally sees the real
   week — without OAuth, a server, or an account.

   Supported: line unfolding, escaped text, UTC / floating / local TZID dates,
   DTEND or DURATION, all-day detection, STATUS:CANCELLED, TRANSP:TRANSPARENT,
   EXDATE and daily/weekly/monthly recurrence bounded to the import window.

   Deliberately not supported (reported honestly, never guessed): VTODO files,
   free-busy exports, and recurring events whose RRULE needs a full RFC 5545
   expansion engine. The first occurrence is still imported.
   ------------------------------------------------------------------------- */

import { addDays, dateKey, diffDays, parseKey } from './dates.js'

const MAX_OCCURRENCES = 200
const MAX_WINDOW_DAYS = 120

/** Unfold RFC 5545 continuation lines (a line starting with space/tab). */
export function unfoldIcs(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '')
}

/** Split `NAME;PARAM="a:b":VALUE` into its parts without losing escaped colons. */
export function parseProperty(line) {
  const colon = findValueColon(line)
  if (colon < 0) return null
  const head = line.slice(0, colon)
  const value = line.slice(colon + 1)
  const [rawName, ...paramParts] = splitUnquoted(head, ';')
  const params = {}
  for (const part of paramParts) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, '')
  }
  return { name: rawName.toUpperCase(), params, value }
}

function findValueColon(line) {
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') quoted = !quoted
    else if (ch === ':' && !quoted) return i
  }
  return -1
}

function splitUnquoted(text, separator) {
  const out = []
  let quoted = false
  let current = ''
  for (const ch of text) {
    if (ch === '"') quoted = !quoted
    if (ch === separator && !quoted) {
      out.push(current)
      current = ''
    } else current += ch
  }
  out.push(current)
  return out
}

/** RFC 5545 TEXT unescaping. */
export function unescapeIcsText(value) {
  return String(value || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim()
}

/** Exact UTC offset (minutes) of an IANA zone at a given instant, via Intl. */
export function zoneOffsetMinutes(timeZone, ms) {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    const parts = Object.fromEntries(dtf.formatToParts(new Date(ms)).map((p) => [p.type, p.value]))
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour) % 24,
      Number(parts.minute),
      Number(parts.second),
    )
    return Math.round((asUtc - ms) / 60000)
  } catch {
    return null
  }
}

const pad = (n) => String(n).padStart(2, '0')

/**
 * Parse an iCalendar date or date-time.
 * @returns {{ key:string, time:string|null, ms:number, allDay:boolean, utc:boolean, floating:boolean }|null}
 */
export function parseIcsDate(value, params = {}) {
  const raw = String(value || '').trim()
  if (!raw) return null
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/)
  if (!match) return null
  const [, y, mo, d, h, mi, s, z] = match
  const year = Number(y)
  const month = Number(mo) - 1
  const day = Number(d)
  const allDay = match[4] == null
  const hour = Number(h || 0)
  const minute = Number(mi || 0)
  const second = Number(s || 0)
  if (month < 0 || month > 11 || day < 1 || day > 31) return null
  const isDateOnly = allDay || params.VALUE === 'DATE'
  if (isDateOnly) {
    const ms = Date.UTC(year, month, day, 12)
    return { key: `${y}-${mo}-${d}`, time: null, ms, allDay: true, utc: false, floating: true }
  }
  if (z === 'Z') {
    const ms = Date.UTC(year, month, day, hour, minute, second)
    const local = new Date(ms)
    return {
      key: `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`,
      time: `${pad(local.getHours())}:${pad(local.getMinutes())}`,
      ms,
      allDay: false,
      utc: true,
      floating: false,
    }
  }
  if (params.TZID) {
    // Interpret the wall-clock time in the named zone when Intl knows it.
    const naive = Date.UTC(year, month, day, hour, minute, second)
    const offset = zoneOffsetMinutes(params.TZID, naive)
    if (offset != null) {
      const ms = naive - offset * 60000
      const local = new Date(ms)
      return {
        key: `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`,
        time: `${pad(local.getHours())}:${pad(local.getMinutes())}`,
        ms,
        allDay: false,
        utc: false,
        floating: false,
      }
    }
  }
  // Floating time: the calendar's own local wall clock is the honest reading.
  const local = new Date(year, month, day, hour, minute, second, 0)
  return {
    key: `${year}-${pad(month + 1)}-${pad(day)}`,
    time: `${pad(hour)}:${pad(minute)}`,
    ms: local.getTime(),
    allDay: false,
    utc: false,
    floating: true,
  }
}

/** `DURATION:PT1H30M` / `P1D` → minutes. */
export function parseIcsDuration(value) {
  const match = String(value || '')
    .trim()
    .match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/)
  if (!match) return null
  const [, sign, weeks, days, hours, minutes, seconds] = match
  const total =
    (Number(weeks) || 0) * 7 * 1440 +
    (Number(days) || 0) * 1440 +
    (Number(hours) || 0) * 60 +
    (Number(minutes) || 0) +
    Math.round((Number(seconds) || 0) / 60)
  return total * (sign === '-' ? -1 : 1)
}

/** Parse RRULE into a small, bounded expansion plan. */
export function parseRrule(value) {
  const parts = {}
  for (const chunk of String(value || '').split(';')) {
    const [k, v] = chunk.split('=')
    if (k && v) parts[k.toUpperCase()] = v
  }
  const freq = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(parts.FREQ) ? parts.FREQ : null
  if (!freq) return null
  const byDay = parts.BYDAY
    ? parts.BYDAY.split(',')
        .map((code) => ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].indexOf(code.slice(-2).toUpperCase()))
        .filter((d) => d >= 0)
    : []
  return {
    freq,
    interval: Math.max(1, Number(parts.INTERVAL) || 1),
    count: parts.COUNT ? Math.max(1, Number(parts.COUNT)) : null,
    until: parts.UNTIL ? parseIcsDate(parts.UNTIL) : null,
    byDay,
  }
}

/**
 * Expand a start date through an RRULE inside [from, to].
 * Returns `YYYY-MM-DD` keys. Bounded and deterministic.
 */
export function expandOccurrences(startKey, rule, from, to) {
  const keys = []
  if (!rule) return [startKey]
  if (rule.freq === 'WEEKLY' && rule.byDay.length) {
    // Weekday rules repeat on several days per week: walk the calendar days in
    // the window, keep the requested weekdays and respect INTERVAL weeks.
    const lastDay = Math.min(diffDays(startKey, to), MAX_WINDOW_DAYS)
    for (let offset = 0; offset <= lastDay; offset++) {
      const key = addDays(startKey, offset)
      if (key < from || key > to) continue
      if (!rule.byDay.includes(parseKey(key).getDay())) continue
      const week = Math.floor(offset / 7)
      if (week % rule.interval !== 0) continue
      if (rule.count && keys.length >= rule.count) break
      if (rule.until && key > dateKey(new Date(rule.until.ms))) break
      keys.push(key)
    }
    return keys
  }
  const hardStop = Math.min(diffDays(from, to) + 1, MAX_WINDOW_DAYS)
  let cursor = startKey
  for (let i = 0; i < MAX_OCCURRENCES; i++) {
    const offset = diffDays(from, cursor)
    if (offset > hardStop) break
    if (rule.count && i >= rule.count) break
    if (rule.until && cursor > dateKey(new Date(rule.until.ms))) break
    if (offset >= 0) keys.push(cursor)
    if (rule.freq === 'DAILY') cursor = addDays(cursor, rule.interval)
    else if (rule.freq === 'WEEKLY') cursor = addDays(cursor, 7 * rule.interval)
    else if (rule.freq === 'MONTHLY') {
      const d = parseKey(cursor)
      const target = new Date(d.getFullYear(), d.getMonth() + rule.interval, d.getDate(), 12)
      cursor = dateKey(target)
    } else {
      const d = parseKey(cursor)
      cursor = dateKey(new Date(d.getFullYear() + rule.interval, d.getMonth(), d.getDate(), 12))
    }
  }
  return keys
}

/**
 * Parse an .ics document into importable events inside [from, to].
 * @param {string} text
 * @param {{ from?: string, to?: string }} [range]
 * @returns {{ events:any[], stats:{total:number, imported:number, allDay:number, cancelled:number, free:number, recurring:number, outside:number, unsupported:number}, calendarName:string, error?:string }}
 */
export function parseIcs(text, { from, to } = {}) {
  const unfolded = unfoldIcs(text)
  if (!/BEGIN:VCALENDAR/i.test(unfolded)) {
    return { events: [], stats: emptyStats(), calendarName: '', error: 'This does not look like an iCalendar file.' }
  }
  const fromKey = from || dateKey(new Date())
  const toKey = to || addDays(fromKey, 29)
  const stats = emptyStats()
  const events = []
  let calendarName = ''
  let current = null
  let depth = 0
  const skipUids = new Set()

  for (const line of unfolded.split('\n')) {
    const prop = parseProperty(line)
    if (!prop) continue
    const { name, params, value } = prop
    if (name === 'BEGIN' && value.toUpperCase() === 'VEVENT') {
      current = { lines: [], depth: 0 }
      depth = 1
      continue
    }
    if (name === 'END' && value.toUpperCase() === 'VEVENT' && current) {
      const event = buildEvent(current.lines, { fromKey, toKey, stats, skipUids })
      if (event) events.push(event)
      current = null
      depth = 0
      continue
    }
    if (current) {
      current.lines.push({ name, params, value })
      continue
    }
    if (name === 'X-WR-CALNAME' || name === 'NAME') calendarName = unescapeIcsText(value)
    if (name === 'BEGIN' && value.toUpperCase() === 'VTODO') stats.unsupported++
  }
  stats.imported = events.length
  events.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
  return { events, stats, calendarName }
}

function emptyStats() {
  return { total: 0, imported: 0, allDay: 0, cancelled: 0, free: 0, recurring: 0, outside: 0, unsupported: 0, duplicates: 0 }
}

function buildEvent(lines, { fromKey, toKey, stats, skipUids }) {
  stats.total++
  const byName = new Map()
  for (const line of lines) {
    if (!byName.has(line.name)) byName.set(line.name, [])
    byName.get(line.name).push(line)
  }
  const first = (name) => byName.get(name)?.[0]
  const status = first('STATUS')?.value?.toUpperCase()
  const transparency = first('TRANSP')?.value?.toUpperCase()
  if (status === 'CANCELLED') {
    stats.cancelled++
    return null
  }
  if (transparency === 'TRANSPARENT') {
    stats.free++
    return null
  }
  const startProp = first('DTSTART')
  if (!startProp) return null
  const start = parseIcsDate(startProp.value, startProp.params)
  if (!start) {
    stats.unsupported++
    return null
  }
  if (start.allDay) {
    stats.allDay++
    return null
  }
  const endProp = first('DTEND')
  const end = endProp ? parseIcsDate(endProp.value, endProp.params) : null
  let duration = end ? Math.round((end.ms - start.ms) / 60000) : null
  if (!duration) duration = parseIcsDuration(first('DURATION')?.value)
  duration = Math.max(5, Math.min(600, duration || 30))

  const uid = unescapeIcsText(first('UID')?.value || '') || `${start.ms}-${unescapeIcsText(first('SUMMARY')?.value || 'event')}`
  const summary = unescapeIcsText(first('SUMMARY')?.value || '') || 'Untitled event'
  const location = unescapeIcsText(first('LOCATION')?.value || '')
  const description = unescapeIcsText(first('DESCRIPTION')?.value || '')
  const exdates = new Set(
    (byName.get('EXDATE') || []).flatMap((prop) =>
      String(prop.value)
        .split(',')
        .map((v) => parseIcsDate(v, prop.params)?.key)
        .filter(Boolean),
    ),
  )
  const cancelledDates = new Set(
    (byName.get('RECURRENCE-ID') || [])
      .map((prop) => parseIcsDate(prop.value, prop.params)?.key)
      .filter(Boolean),
  )
  const rule = parseRrule(first('RRULE')?.value)
  if (rule) stats.recurring++
  const keys = expandOccurrences(start.key, rule, fromKey, toKey)
    .filter((key) => key >= fromKey && key <= toKey)
    .filter((key) => !exdates.has(key) && !cancelledDates.has(key))

  if (!keys.length) {
    // The event exists, it simply is not inside the import window.
    stats.outside++
    return null
  }
  if (skipUids.has(uid)) {
    stats.duplicates++
    return null
  }
  skipUids.add(uid)

  return {
    uid,
    title: summary,
    location,
    description,
    date: keys[0],
    time: start.time,
    duration,
    dates: keys,
    repeating: !!rule,
  }
}

/**
 * Turn parsed events into dated time blocks for `state.schedule.days`.
 * Pure: returns a new days map and a summary, never mutates the input.
 */
export function eventsToBlocks(events, existingDays = {}, { today = dateKey(new Date()) } = {}) {
  const days = {}
  for (const [key, value] of Object.entries(existingDays || {})) {
    if (Array.isArray(value)) days[key] = value.map((block) => ({ ...block }))
  }
  const weekdays = new Set()
  let added = 0
  let duplicates = 0
  const seen = new Set()
  for (const blocks of Object.values(days)) {
    for (const block of blocks) if (block?.icsUid) seen.add(block.icsUid)
  }
  for (const event of events) {
    if (seen.has(event.uid)) {
      duplicates++
      continue
    }
    for (const date of event.dates) {
      if (!days[date]) days[date] = []
      days[date].push({
        id: `ics:${event.uid.slice(0, 40)}:${date}`,
        title: event.title,
        time: event.time,
        duration: event.duration,
        cat: null,
        protected: true,
        flexible: false,
        kind: 'event',
        source: 'ics',
        icsUid: event.uid,
        location: event.location || '',
        status: 'planned',
      })
      if (date >= today) weekdays.add(date)
      added++
    }
    seen.add(event.uid)
  }
  for (const key of Object.keys(days)) days[key].sort((a, b) => String(a.time).localeCompare(String(b.time)))
  return { days, added, duplicates, daysAffected: weekdays.size }
}
