/* -------------------------------------------------------------------------
   CALENDAR — one honest grid over everything you already have
   -------------------------------------------------------------------------
   The app already stores commitments in five places: the dated schedule, the
   per-mission study plans, missions with a date, routines and HYB plans. This
   module reads all of them into one shape so the calendar can never disagree
   with the Schedule, the Forecast or the HYB deck.

   Pure: no store, no DOM, no clock beyond the keys you pass in.
   ------------------------------------------------------------------------- */

import { addDays, dateKey, isValidKey, minutesOfDay, parseKey, startOfWeek, weekdayOf, weekdayShort } from './dates.js'
import { itemDone, protectedIntervals, scheduleFor } from './planner.js'
import { capacityMinutesOf, isRestBlock, loadStatus } from './forecast.js'
import { occurrencesOn as hybOccurrences } from './hyb.js'
import { routineDone, routineDue } from './routines.js'

/** What the grid can show. Each layer is independently switchable. */
export const CAL_LAYERS = [
  { id: 'blocks', label: 'Time blocks', icon: 'calendar', hint: 'Schedule + study plans' },
  { id: 'missions', label: 'Missions', icon: 'missions', hint: 'Dated missions without a time' },
  { id: 'hyb', label: 'HYB plans', icon: 'bolt', hint: 'Hybrid plans from the HYB deck' },
  { id: 'routines', label: 'Routines', icon: 'routines', hint: 'Morning/evening check-ins' },
  { id: 'deadlines', label: 'Deadlines', icon: 'flag', hint: 'Goals, projects and mission deadlines' },
  { id: 'journal', label: 'Journal', icon: 'journal', hint: 'Days you wrote something down' },
]

export const CAL_LAYER_IDS = CAL_LAYERS.map((layer) => layer.id)

export function defaultLayers() {
  return Object.fromEntries(CAL_LAYER_IDS.map((id) => [id, true]))
}

/** Validate a stored layer map (settings are user-editable JSON). */
export function normalizeLayers(raw) {
  const layers = defaultLayers()
  if (raw && typeof raw === 'object') {
    for (const id of CAL_LAYER_IDS) if (typeof raw[id] === 'boolean') layers[id] = raw[id]
  }
  return layers
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function monthTitle(key) {
  const date = parseKey(isValidKey(key) ? key : dateKey())
  return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

export function monthKeyOf(key) {
  return String(isValidKey(key) ? key : dateKey()).slice(0, 7)
}

/** Move by whole months, clamping to the last valid day (Jan 31 → Feb 28). */
export function shiftMonth(key, delta = 1) {
  const date = parseKey(isValidKey(key) ? key : dateKey())
  const day = date.getDate()
  date.setDate(1)
  date.setMonth(date.getMonth() + Number(delta || 0))
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  date.setDate(Math.min(day, lastDay))
  return dateKey(date)
}

/** First and last day keys of the month containing `key`. */
export function monthBounds(key) {
  const date = parseKey(isValidKey(key) ? key : dateKey())
  const first = dateKey(new Date(date.getFullYear(), date.getMonth(), 1, 12))
  const last = dateKey(new Date(date.getFullYear(), date.getMonth() + 1, 0, 12))
  return { first, last }
}

/**
 * The 5–6 weeks of cells that cover the month, starting on the user's week
 * start. Every cell knows whether it belongs to the month, so the grid can dim
 * the neighbours instead of hiding real days.
 */
export function monthMatrix(anchorKey, { weekStart = 1, todayKey = dateKey() } = {}) {
  const anchor = isValidKey(anchorKey) ? anchorKey : dateKey()
  const { first, last } = monthBounds(anchor)
  const gridStart = startOfWeek(first, weekStart)
  const cellsNeeded = Math.ceil((Math.round((parseKey(last).getTime() - parseKey(gridStart).getTime()) / 86400000) + 1) / 7) * 7
  const weeks = []
  for (let week = 0; week * 7 < cellsNeeded; week++) {
    const row = []
    for (let day = 0; day < 7; day++) {
      const key = addDays(gridStart, week * 7 + day)
      row.push({
        key,
        day: Number(key.slice(8, 10)),
        weekday: weekdayOf(key),
        weekdayLabel: weekdayShort(weekdayOf(key)),
        inMonth: monthKeyOf(key) === monthKeyOf(anchor),
        isToday: key === todayKey,
        isFuture: key > todayKey,
        isWeekend: [0, 6].includes(weekdayOf(key)),
      })
    }
    weeks.push(row)
  }
  return {
    anchorKey: anchor,
    monthKey: monthKeyOf(anchor),
    title: monthTitle(anchor),
    weekStart,
    weeks,
    days: weeks.flat().map((cell) => cell.key),
    first,
    last,
    gridStart,
    gridEnd: addDays(gridStart, cellsNeeded - 1),
    prev: shiftMonth(anchor, -1),
    next: shiftMonth(anchor, 1),
    weekdayLabels: Array.from({ length: 7 }, (_, i) => weekdayShort((weekStart + i) % 7)),
  }
}

/* ------------------------------------------------------------------ entries */

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 }

/**
 * Everything that happens on one day, in the order it should be read:
 * timed entries by clock, then untimed work by priority, then quiet markers.
 *
 * @returns {Array<{id:string,source:string,title:string,time:string|null,minutes:number,
 *   cat:string|null,priority:string,kind:string,done:boolean,dotOnly:boolean,tone:string,
 *   refId:string|null,meta:string}>}
 */
export function dayEntries(state, dayKey, { layers = null, todayKey = dateKey(), now = new Date() } = {}) {
  const on = layers || defaultLayers()
  const key = isValidKey(dayKey) ? dayKey : todayKey
  /** @type {any[]} */
  const entries = []
  const push = (entry) => entries.push({ minutes: 0, cat: null, priority: 'medium', done: false, dotOnly: false, tone: 'normal', refId: null, meta: '', time: null, ...entry })

  /**
   * A HYB plan that has been put on the schedule exists twice in the data: as a
   * plan and as a real time block. Draw it once — the HYB layer owns it, at the
   * time it was actually placed — so minutes are never counted twice.
   */
  const scheduledHyb = new Map()

  if (on.blocks) {
    for (const block of scheduleFor(state, key)) {
      const rest = isRestBlock(block)
      const hybId = block.hybPlanId || (typeof block.id === 'string' && block.id.startsWith('hyb:') ? block.id.slice(4) : null)
      if (on.hyb && hybId && !rest) {
        scheduledHyb.set(hybId, block)
        continue
      }
      push({
        id: `block:${block.id}`,
        source: 'block',
        title: block.title,
        time: block.time || null,
        minutes: rest ? 0 : Math.max(0, Number(block.duration) || 0),
        cat: block.cat || null,
        priority: block.priority || 'medium',
        kind: block.protected || block.kind === 'protected' ? 'protected' : rest ? 'rest' : block.kind === 'template' ? 'template' : 'block',
        done: itemDone(state, block, key),
        tone: block.protected || block.kind === 'protected' ? 'protected' : rest ? 'rest' : 'normal',
        refId: block.taskId || block.sourceId || block.id,
        dotOnly: rest,
        meta: rest ? 'Rest' : block.duration ? `${block.duration}m` : '',
      })
    }
    for (const window of protectedIntervals(state.settings?.protectedTime, key)) {
      const id = `protected:${window.id}`
      if (entries.some((entry) => entry.id === id)) continue
      push({
        id,
        source: 'protected',
        title: window.title,
        time: null,
        minutes: 0,
        kind: 'protected',
        tone: 'protected',
        dotOnly: true,
        refId: window.id,
        meta: 'Protected',
      })
    }
  }

  if (on.missions) {
    for (const task of state.tasks || []) {
      if (task.inbox || task.status === 'cancelled' || task.date !== key || task.time) continue
      push({
        id: `mission:${task.id}`,
        source: 'mission',
        title: task.title,
        time: null,
        minutes: task.estimateMinutes || 0,
        cat: task.cat || null,
        priority: task.priority || 'medium',
        kind: 'mission',
        done: !!task.done,
        tone: !task.done && key < todayKey ? 'overdue' : 'normal',
        refId: task.id,
        meta: task.estimateMinutes ? `${task.estimateMinutes}m` : 'No time set',
      })
    }
  }

  if (on.hyb) {
    for (const occurrence of hybOccurrences(state.hyb?.plans || [], key)) {
      const placed = scheduledHyb.get(occurrence.plan.id) || null
      const minutes = placed && placed.duration ? Number(placed.duration) : occurrence.minutes
      push({
        id: `hyb:${occurrence.plan.id}`,
        source: 'hyb',
        title: occurrence.plan.title,
        time: placed?.time || occurrence.plan.startTime || null,
        minutes,
        priority: occurrence.plan.priority,
        kind: occurrence.plan.kind,
        energy: occurrence.plan.energy,
        done: occurrence.done || (placed ? itemDone(state, placed, key) : false),
        scheduled: !!placed,
        tone: occurrence.skipped ? 'skipped' : occurrence.plan.kind,
        refId: occurrence.plan.id,
        meta: occurrence.skipped ? 'Skipped' : `${minutes}m${placed ? ' · on the schedule' : ''}`,
      })
    }
  }

  if (on.routines) {
    for (const routine of state.routines || []) {
      if (!routineDue(routine, key)) continue
      push({
        id: `routine:${routine.id}`,
        source: 'routine',
        title: routine.title,
        time: routine.time || null,
        minutes: 0,
        kind: 'routine',
        done: routineDone(state, routine, key),
        tone: 'routine',
        refId: routine.id,
        dotOnly: true,
        meta: `${routine.activities?.length || 0} activities`,
      })
    }
  }

  if (on.deadlines) {
    for (const task of state.tasks || []) {
      if (task.deadline !== key || task.status === 'cancelled') continue
      push({ id: `deadline:task:${task.id}`, source: 'deadline', title: `Deadline · ${task.title}`, time: null, minutes: 0, kind: 'deadline', priority: task.priority, done: !!task.done, tone: 'deadline', refId: task.id, dotOnly: true, meta: 'Mission deadline' })
    }
    for (const goal of state.goals || []) {
      const when = goal.deadline || goal.targetDate
      if (when !== key || goal.status === 'cancelled') continue
      push({ id: `deadline:goal:${goal.id}`, source: 'deadline', title: `Goal · ${goal.title}`, time: null, minutes: 0, kind: 'deadline', priority: goal.priority, done: goal.status === 'completed', tone: 'deadline', refId: goal.id, dotOnly: true, meta: 'Goal target' })
    }
    for (const project of state.projects || []) {
      const when = project.deadline || project.targetDate
      if (when !== key || project.status === 'cancelled') continue
      push({ id: `deadline:project:${project.id}`, source: 'deadline', title: `Project · ${project.title}`, time: null, minutes: 0, kind: 'deadline', priority: project.priority, done: project.status === 'completed', tone: 'deadline', refId: project.id, dotOnly: true, meta: 'Project target' })
    }
  }

  if (on.journal) {
    const entry = state.journal?.[key]
    if (entry && (entry.note || entry.win || entry.nextStep || entry.mood)) {
      push({ id: `journal:${key}`, source: 'journal', title: 'Journal written', time: null, minutes: 0, kind: 'journal', done: true, tone: 'journal', dotOnly: true, meta: entry.mood ? String(entry.mood) : '' })
    }
  }

  return entries.sort((a, b) => {
    if (a.dotOnly !== b.dotOnly) return a.dotOnly ? 1 : -1
    if (!!a.time !== !!b.time) return a.time ? -1 : 1
    if (a.time && b.time) return minutesOfDay(a.time) - minutesOfDay(b.time)
    const rank = (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1)
    if (rank) return rank
    return a.title.localeCompare(b.title)
  })
}

/** One day, summarised: what is on it, how heavy it is, whether it was written. */
export function daySummary(state, dayKey, { layers = null, todayKey = dateKey(), now = new Date(), capacity = null } = {}) {
  const key = isValidKey(dayKey) ? dayKey : todayKey
  const entries = dayEntries(state, key, { layers, todayKey, now })
  const counted = entries.filter((entry) => !entry.dotOnly && entry.kind !== 'rest' && entry.kind !== 'protected')
  const minutes = counted.reduce((sum, entry) => sum + (entry.done ? 0 : entry.minutes), 0)
  const totalMinutes = counted.reduce((sum, entry) => sum + entry.minutes, 0)
  const done = counted.filter((entry) => entry.done).length
  const limit = capacity || capacityMinutesOf(state)
  const loadPct = limit ? Math.round((totalMinutes / limit) * 100) : 0
  const conflicts = entries.filter((entry) => entry.time).length ? timedOverlaps(entries) : 0
  const lanes = [...new Set(entries.filter((entry) => entry.source === 'hyb').map((entry) => entry.kind))]
  /* A study template repeats every day. Drawn at full weight it turns a month
   * grid into 30 identical days, which tells the reader nothing. So the
   * summary separates what the day *is committed to* from the routine that
   * merely fills it — the calendar shows the first, and offers the second.
   */
  const routine = counted.filter((entry) => entry.kind === 'template' || entry.kind === 'rest')
  const commitments = counted.filter((entry) => entry.kind !== 'template' && entry.kind !== 'rest')
  return {
    date: key,
    entries,
    routine,
    commitments,
    routineMinutes: routine.reduce((sum, entry) => sum + (entry.done ? 0 : entry.minutes), 0),
    hasRoutine: routine.length > 0,
    hasCommitments: commitments.length > 0,
    count: entries.length,
    visibleCount: counted.length,
    minutes: totalMinutes,
    openMinutes: minutes,
    doneCount: done,
    openCount: counted.length - done,
    loadPct,
    // a clashing day is heavy whatever its total — the same rule the Forecast uses
    load: loadStatus(loadPct, conflicts),
    isToday: key === todayKey,
    isFuture: key > todayKey,
    hasJournal: entries.some((entry) => entry.source === 'journal'),
    hasHyb: entries.some((entry) => entry.source === 'hyb'),
    hasDeadline: entries.some((entry) => entry.source === 'deadline'),
    hasProtected: entries.some((entry) => entry.tone === 'protected'),
    conflicts,
    lanes,
  }
}

function timedOverlaps(entries) {
  const timed = entries.filter((entry) => entry.time && entry.minutes > 0).sort((a, b) => minutesOfDay(a.time) - minutesOfDay(b.time))
  let clashes = 0
  let edge = -1
  for (const entry of timed) {
    const start = minutesOfDay(entry.time)
    if (edge > start) clashes++
    edge = Math.max(edge, start + entry.minutes)
  }
  return clashes
}

/** Summaries for every cell of a month matrix, keyed by date. */
export function monthOverview(state, matrix, options = {}) {
  const overview = new Map()
  for (const key of matrix.days) overview.set(key, daySummary(state, key, options))
  return overview
}

/** A run of days as agenda rows (used by Agenda mode and the day rail). */
export function agendaDays(state, fromKey, days = 30, options = {}) {
  const span = Math.max(1, Math.min(120, Number(days) || 30))
  const rows = []
  for (let i = 0; i < span; i++) {
    const key = addDays(fromKey, i)
    rows.push({ date: key, ...daySummary(state, key, { ...options, todayKey: options.todayKey || dateKey() }) })
  }
  return rows
}

/** Month-level facts for the calendar's side rail. */
export function monthStats(state, matrix, overview) {
  const inMonth = matrix.weeks.flat().filter((cell) => cell.inMonth)
  const summaries = inMonth.map((cell) => overview.get(cell.key)).filter(Boolean)
  const minutes = summaries.reduce((sum, day) => sum + day.minutes, 0)
  // "committed" means the person put something there — a template that runs
  // every day is background, not a commitment, and must not inflate the count
  // "days with something on them" counts everything visible, including a
  // recurring template — that is what the month grid actually draws.
  const committedDays = summaries.filter((day) => day.visibleCount).length
  // "pledged" is the honest headline: days where the person committed to
  // something beyond the routine. A month of template days pledges nothing.
  const pledgedDays = summaries.filter((day) => (day.commitments?.length || 0) > 0).length
  const heavyDays = summaries.filter((day) => ['full', 'over', 'conflict'].includes(day.load)).length
  const journalDays = summaries.filter((day) => day.hasJournal).length
  const hybDays = summaries.filter((day) => day.hasHyb).length
  // a day with nothing on it is not "the busiest" — an empty month has none
  const busiest = summaries.reduce((best, day) => (day.minutes > 0 && (!best || day.minutes > best.minutes) ? day : best), null)
  const deadlineCount = summaries.reduce((sum, day) => sum + day.entries.filter((entry) => entry.source === 'deadline').length, 0)
  return {
    monthKey: matrix.monthKey,
    title: matrix.title,
    days: inMonth.length,
    minutes,
    hours: Math.round((minutes / 60) * 10) / 10,
    committedDays,
    pledgedDays,
    quietDays: inMonth.length - committedDays,
    heavyDays,
    journalDays,
    hybDays,
    deadlineCount,
    busiestDate: busiest?.date || null,
    busiestMinutes: busiest?.minutes || 0,
    averageMinutes: committedDays ? Math.round(minutes / committedDays) : 0,
  }
}

/** The seven days around a date, for the week mode header strip. */
export function weekCells(anchorKey, { weekStart = 1, todayKey = dateKey() } = {}) {
  const start = startOfWeek(isValidKey(anchorKey) ? anchorKey : dateKey(), weekStart)
  return Array.from({ length: 7 }, (_, i) => {
    const key = addDays(start, i)
    return { key, day: Number(key.slice(8, 10)), weekday: weekdayOf(key), weekdayLabel: weekdayShort(weekdayOf(key)), isToday: key === todayKey, inMonth: true, isWeekend: [0, 6].includes(weekdayOf(key)), isFuture: key > todayKey }
  })
}

export { minutesOfDay, weekdayOf }
