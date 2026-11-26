/* -------------------------------------------------------------------------
   RITUALS — your own rules, kept daily
   -------------------------------------------------------------------------
   A ritual is one rule you set for yourself — "talk less", "brush daily", "no
   phone before 9" — and the only thing it asks of you is a tick. Everything
   here is pure: the store passes in its slice of state and the day key, and the
   same answers reach the page, the browser tests and a backup.

   The model
   • a ritual exists in state.rituals[] with an id, a title, a tone and either
     a weekday list or "every day"
   • a tick is recorded as state.ritualLog["YYYY-MM-DD"] = { [ritualId]: true },
     so history can never be rewritten by editing a ritual
   • archiving keeps the history and stops the ritual from appearing

   Streaks are honest
     current  — consecutive due days, counting back from today. Today stays
                open until it is ticked or the day ends: an unfinished morning
                is never a broken streak.
     best     — the longest consecutive run of due-and-done days on record.

   A rest day (not in the ritual's weekday list) is simply not asked for, and
   it neither extends nor breaks a run. There is no debt and no blame.
   ------------------------------------------------------------------------- */

import { addDays, dateKey, isValidKey, weekdayOf } from './dates.js'

export const RITUAL_TONES = [
  { id: 'speech', label: 'Speech', icon: 'leaf', hint: 'How much you say, and when you hold back' },
  { id: 'body', label: 'Body', icon: 'sun', hint: 'Sleep, movement, food, care' },
  { id: 'mind', label: 'Mind', icon: 'sparkle', hint: 'Reading, quiet, attention' },
  { id: 'work', label: 'Work', icon: 'missions', hint: 'Deep work, craft, money' },
  { id: 'people', label: 'People', icon: 'target', hint: 'Presence with the people you love' },
  { id: 'order', label: 'Order', icon: 'list', hint: 'A room, a desk, a plan' },
  { id: 'custom', label: 'Custom', icon: 'flag', hint: 'Something of your own' },
]

export const RITUAL_TONE_IDS = RITUAL_TONES.map((tone) => tone.id)
const TONE_BY_ID = new Map(RITUAL_TONES.map((tone) => [tone.id, tone]))

/** The seven-day list, Monday first, for the "which days" picker. */
export const RITUAL_WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
export const RITUAL_WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** Everyday rules people actually set, offered as one-tap starters. */
export const RITUAL_SUGGESTIONS = [
  { title: 'Talk less', tone: 'speech', days: 'every' },
  { title: 'Brush my teeth twice', tone: 'body', days: 'every' },
  { title: 'Make the bed', tone: 'order', days: 'every' },
  { title: '10 pages of reading', tone: 'mind', days: 'every' },
  { title: 'No phone for the first hour', tone: 'mind', days: 'every' },
  { title: 'Move for twenty minutes', tone: 'body', days: 'weekdays' },
  { title: 'One deep-work hour', tone: 'work', days: 'weekdays' },
  { title: 'Walk after dinner', tone: 'body', days: 'every' },
  { title: 'Two litres of water', tone: 'body', days: 'every' },
  { title: 'Plan tomorrow before bed', tone: 'order', days: 'every' },
  { title: 'Call someone I love', tone: 'people', days: 'every' },
  { title: 'Write three honest lines', tone: 'mind', days: 'every' },
]

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]
const isObj = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
const asArray = (value) => (Array.isArray(value) ? value : [])
const cleanText = (value, max = 80) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max)

export function toneOf(id) {
  return TONE_BY_ID.get(id) || TONE_BY_ID.get('custom')
}

export function ritualContext({ now = Date.now(), id = null } = {}) {
  return { now, uid: id || (() => Math.random().toString(36).slice(2, 10) + now.toString(36)) }
}

/** Weekday integers for a preset id (`every`, `weekdays`, `weekend`). */
export function daysForPreset(preset) {
  if (preset === 'weekdays') return [0, 1, 2, 3, 4]
  if (preset === 'weekend') return [5, 6]
  return [...ALL_DAYS]
}

function normalizeDays(value) {
  if (value === 'every') return [...ALL_DAYS]
  if (value === 'weekdays') return daysForPreset('weekdays')
  if (value === 'weekend') return daysForPreset('weekend')
  if (!Array.isArray(value)) return [...ALL_DAYS]
  const days = [...new Set(value.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
  return days.length ? days : [...ALL_DAYS]
}

/**
 * Normalise one stored ritual. Never invents a title: an entry with no text is
 * dropped by the caller instead of becoming an untitled rule.
 */
export function normalizeRitual(raw, ctx = ritualContext()) {
  if (!isObj(raw)) return null
  const title = cleanText(raw.title, 80)
  if (!title) return null
  const days = normalizeDays(raw.days)
  return {
    id: String(raw.id || ctx.uid()),
    title,
    note: cleanText(raw.note, 160),
    tone: TONE_BY_ID.has(raw.tone) ? raw.tone : 'custom',
    days,
    everyDay: days.length === 7,
    important: raw.important === true,
    pinned: raw.pinned === true,
    archived: raw.archived === true,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : ctx.now,
    dayKey: isValidKey(raw.dayKey) ? raw.dayKey : null,
    editedAt: Number.isFinite(raw.editedAt) ? raw.editedAt : null,
  }
}

/** A brand-new ritual from the editor's form values. */
export function makeRitual(input = {}, ctx = ritualContext()) {
  const ritual = normalizeRitual(
    {
      ...input,
      id: ctx.uid(),
      createdAt: ctx.now,
      dayKey: dateKey(new Date(ctx.now)),
      archived: false,
    },
    ctx,
  )
  if (!ritual) return null
  ritual.everyDay = ritual.days.length === 7
  return ritual
}

/** Normalise the whole ritual log: only known days and known ritual ids. */
export function normalizeRitualLog(rawLog, ritualIds) {
  const known = ritualIds instanceof Set ? ritualIds : new Set(asArray(ritualIds).map(String))
  const log = {}
  for (const [day, entries] of Object.entries(isObj(rawLog) ? rawLog : {})) {
    if (!isValidKey(day) || !isObj(entries)) continue
    const ticks = {}
    for (const [id, value] of Object.entries(entries)) {
      if (!known.has(String(id))) continue
      if (value === true || value === 1 || value === 'true') ticks[String(id)] = true
    }
    if (Object.keys(ticks).length) log[day] = ticks
  }
  return log
}

/** Is this ritual asked for on this day? */
export function ritualDue(ritual, dayKey) {
  if (!ritual || ritual.archived) return false
  return ritual.days.includes(weekdayOf(dayKey))
}

export function isTicked(ritualsState, ritualId, dayKey) {
  return !!ritualsState?.log?.[dayKey]?.[ritualId]
}

/** Toggle one tick for one ritual on one day (mutates the draft state). */
export function toggleTick(draft, ritualId, dayKey) {
  if (!draft.rituals || typeof draft.rituals !== 'object') draft.rituals = { rituals: [], log: {} }
  if (!isObj(draft.rituals.log)) draft.rituals.log = {}
  const day = isObj(draft.rituals.log[dayKey]) ? draft.rituals.log[dayKey] : {}
  const next = { ...day }
  if (next[ritualId]) delete next[ritualId]
  else next[ritualId] = true
  if (Object.keys(next).length) draft.rituals.log[dayKey] = next
  else delete draft.rituals.log[dayKey]
  return !!next[ritualId]
}

/** Every active ritual, pinned first, then the order they were created. */
export function activeRituals(ritualsState) {
  return asArray(ritualsState?.rituals)
    .filter((ritual) => ritual && !ritual.archived)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (a.createdAt || 0) - (b.createdAt || 0))
}

/**
 * The streak for one ritual.
 *
 * @returns {{current:number, best:number, todayDue:boolean, todayDone:boolean,
 *            dueToday:number, doneToday:number, total:number, rate:number,
 *            recent:Array<{dateKey:string, due:boolean, done:boolean, isToday:boolean}>,
 *            weekDone:number, weekDue:number}}
 */
export function ritualStreak(ritualsState, ritual, todayKey, { days = 60, recentDays = 14 } = {}) {
  const log = ritualsState?.log || {}
  const dueOn = (day) => ritualDue(ritual, day)
  const doneOn = (day) => !!(log[day] && log[day][ritual.id])
  // A rule is only judged from the day it was written. Days before it existed
  // are neither kept nor missed, so they never inflate or deflate the rate.
  const bornKey = ritual.dayKey || (Number.isFinite(ritual.createdAt) ? dateKey(new Date(ritual.createdAt)) : null)
  const windowStart = bornKey && bornKey > addDays(todayKey, -(days - 1)) ? bornKey : addDays(todayKey, -(days - 1))

  // current run — today stays open until it is ticked
  let current = 0
  let cursor = todayKey
  const todayDone = doneOn(todayKey)
  const todayDue = dueOn(todayKey)
  if (todayDue && !todayDone) cursor = addDays(todayKey, -1)
  for (let i = 0; i < days; i++) {
    const day = cursor
    if (!dueOn(day)) {
      cursor = addDays(cursor, -1)
      continue
    }
    if (!doneOn(day)) break
    current++
    cursor = addDays(cursor, -1)
  }

  // best run across the recorded window
  let best = 0
  let run = 0
  let total = 0
  let weekDone = 0
  let weekDue = 0
  const window = []
  for (let day = windowStart; day <= todayKey; day = addDays(day, 1)) {
    const due = dueOn(day)
    const done = doneOn(day)
    if (due) {
      weekDue++
      if (done) weekDone++
      total++
      run = done ? run + 1 : 0
      if (run > best) best = run
    } else {
      run = 0
    }
    window.push({ dateKey: day, due, done })
  }
  best = Math.max(best, current)

  const recent = window.slice(-recentDays).map((row) => ({ ...row, isToday: row.dateKey === todayKey }))
  const dueTotal = window.filter((row) => row.due).length
  const doneTotal = window.filter((row) => row.due && row.done).length
  return {
    current,
    best,
    todayDue,
    todayDone,
    total: dueTotal,
    doneToday: todayDue && todayDone ? 1 : 0,
    dueToday: todayDue ? 1 : 0,
    weekDone: window.slice(-7).filter((row) => row.due && row.done).length,
    weekDue: window.slice(-7).filter((row) => row.due).length,
    rate: dueTotal ? Math.round((doneTotal / dueTotal) * 100) : 0,
    recent,
  }
}

/** Whole-day state, used by the grid, the ring and the summary line. */
export function ritualDay(ritualsState, dayKey, rituals = activeRituals(ritualsState)) {
  const due = rituals.filter((ritual) => ritualDue(ritual, dayKey))
  const done = due.filter((ritual) => isTicked(ritualsState, ritual.id, dayKey))
  return {
    dateKey: dayKey,
    due,
    done,
    dueCount: due.length,
    doneCount: done.length,
    complete: due.length > 0 && done.length === due.length,
    empty: due.length === 0,
    pct: due.length ? Math.round((done.length / due.length) * 100) : 0,
  }
}

/**
 * The day-by-day ledger for one ritual (newest day last), used by its detail
 * sheet: a row per day with whether it was asked for and whether it was kept.
 */
export function ritualHistory(ritualsState, ritual, todayKey, days = 35) {
  const log = ritualsState?.log || {}
  const rows = []
  for (let i = days - 1; i >= 0; i--) {
    const day = addDays(todayKey, -i)
    const beforeBirth = ritual.dayKey && day < ritual.dayKey
    rows.push({ dateKey: day, due: !beforeBirth && ritualDue(ritual, day), done: !!(log[day] && log[day][ritual.id]), beforeBirth: !!beforeBirth })
  }
  return rows
}

/**
 * The headline: how many rules were kept on each of the last N days, and how
 * long the *combined* perfect run is. A perfect day means every rule that was
 * asked for that day was ticked.
 */
export function ritualOverview(ritualsState, todayKey, { days = 400, recentDays = 21 } = {}) {
  const rituals = activeRituals(ritualsState)
  const log = ritualsState?.log || {}
  const kept = []
  const perDay = []
  let perfectRun = 0
  let bestPerfect = 0
  let perfectToday = false
  let doneTotal = 0
  let dueTotal = 0

  const window = []
  for (let i = days - 1; i >= 0; i--) {
    const day = addDays(todayKey, -i)
    let due = 0
    let done = 0
    for (const ritual of rituals) {
      if (ritual.dayKey && day < ritual.dayKey) continue
      if (!ritualDue(ritual, day)) continue
      due++
      if (log[day] && log[day][ritual.id]) done++
    }
    dueTotal += due
    doneTotal += done
    const perfect = due > 0 && done === due
    const any = done > 0
    if (due > 0) {
      perfectRun = perfect ? perfectRun + 1 : 0
      if (perfectRun > bestPerfect) bestPerfect = perfectRun
    }
    if (any) kept.push(day)
    window.push({ dateKey: day, due, done, perfect, empty: due === 0 })
    if (i < recentDays) perDay.push(window[window.length - 1])
  }
  if (window.length) perfectToday = window[window.length - 1].perfect

  // The last day on which every due rule was kept, for the headline.
  let lastPerfect = null
  for (let i = window.length - 1; i >= 0; i--) {
    if (window[i].perfect) {
      lastPerfect = window[i].dateKey
      break
    }
  }

  // combined "kept at least one" run, ending today (today stays open)
  let currentAnyRun = 0
  let bestAnyRun = 0
  let anyRun = 0
  for (const row of window) {
    if (row.empty) {
      anyRun = 0
      continue
    }
    anyRun = row.done > 0 ? anyRun + 1 : 0
    if (anyRun > bestAnyRun) bestAnyRun = anyRun
  }
  for (let i = 0; i < 30; i++) {
    const row = window[window.length - 1 - i]
    if (!row) break
    if (row.empty) continue
    if (row.done === 0) {
      // today can still be completed, so an empty *today* does not end the run
      if (i === 0) continue
      break
    }
    currentAnyRun++
  }

  return {
    rituals,
    count: rituals.length,
    keptDays: kept.length,
    dueToday: ritualDay(ritualsState, todayKey, rituals).dueCount,
    doneToday: ritualDay(ritualsState, todayKey, rituals).doneCount,
    perfectToday,
    lastPerfect,
    currentRun: currentAnyRun,
    bestRun: Math.max(bestAnyRun, currentAnyRun),
    bestPerfect,
    rate: dueTotal ? Math.round((doneTotal / dueTotal) * 100) : 0,
    perDay,
    totalTicks: doneTotal,
    totalDue: dueTotal,
  }
}

/** One warm, honest sentence for the top of the page. */
export function ritualSummaryLine(overview, todayKey) {
  if (!overview.count) return 'Name the first rule you want to keep. One is enough.'
  if (!overview.dueToday) return 'No rules are set for today. A rest day is allowed.'
  if (overview.doneToday >= overview.dueToday) return 'Every rule you set today is kept. That is the whole game.'
  if (overview.doneToday === 0) return `${overview.dueToday} rule${overview.dueToday === 1 ? '' : 's'} wait for a tick today. Start with the smallest.`
  const left = overview.dueToday - overview.doneToday
  return `${overview.doneToday} of ${overview.dueToday} kept today. ${left} to go — no rush.`
}

/** The label shown under a ritual's streak count. */
export function streakLabel(streak) {
  if (streak.todayDue && !streak.todayDone) return streak.current ? 'Today still open' : 'Start today'
  if (!streak.todayDue) return 'Rest day'
  if (streak.current === 1) return 'Day one'
  return `${streak.current} days kept`
}

export { ALL_DAYS }
