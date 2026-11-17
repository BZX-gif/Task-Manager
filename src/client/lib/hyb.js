/* -------------------------------------------------------------------------
   HYB — the hybrid plan layer
   -------------------------------------------------------------------------
   A HYB plan is lighter than a mission and heavier than a note: one thing you
   intend to do, on a day, for a length of time, in one of six life lanes
   (study · work · body · personal · event · idea), with an energy level, a
   checklist and an optional repeat.

   Everything in this module is pure. It never touches the store, the DOM or
   the clock beyond the `todayKey` / `now` you pass in, so the calendar, the
   HYB deck, the HYB studio and the tests all read exactly the same truth.

   Completion model
     • a one-day plan is finished when `status === 'done'`
     • a repeating plan is never "finished" as a whole: each day is recorded in
       `plan.log["YYYY-MM-DD"] = 'done' | 'skipped'`, so history stays honest
       and skipping a day never rewrites the series.
   ------------------------------------------------------------------------- */

import { addDays, dateKey, formatDuration, isValidKey, minutesOfDay, startOfWeek, toHHMM, weekdayOf } from './dates.js'
import { parseQuickCapture, recurrenceLabel } from './quickparse.js'
import { normalizeRecurrence } from './recurrence.js'

/** The six HYB lanes. `hue` is only a fallback — CSS owns the real colours. */
export const HYB_KINDS = [
  { id: 'study', label: 'Study', icon: 'missions', hint: 'Preparation, revision, practice' },
  { id: 'work', label: 'Work', icon: 'projects', hint: 'Job, freelance, building' },
  { id: 'body', label: 'Body', icon: 'leaf', hint: 'Training, food, sleep, recovery' },
  { id: 'personal', label: 'Personal', icon: 'sun', hint: 'Home, money, errands, people' },
  { id: 'event', label: 'Event', icon: 'calendar', hint: 'Fixed date, fixed time' },
  { id: 'idea', label: 'Idea', icon: 'sparkle', hint: 'Something you might do' },
]

export const HYB_KIND_IDS = HYB_KINDS.map((kind) => kind.id)

/** How a plan repeats. Deliberately small: daily, weekdays, same weekday. */
export const HYB_REPEATS = [
  { id: 'none', label: 'One day', hint: 'Happens once, on its date' },
  { id: 'daily', label: 'Every day', hint: 'Repeats on all seven days' },
  { id: 'weekdays', label: 'Weekdays', hint: 'Monday to Friday' },
  { id: 'weekly', label: 'Same weekday', hint: 'Once a week, on its weekday' },
]

/** The hybrid half of HYB: how demanding the plan is, not just how long. */
export const HYB_ENERGY = [
  { id: 'deep', label: 'Deep', hint: 'Hardest thinking — protect the hours' },
  { id: 'steady', label: 'Steady', hint: 'Normal, sustainable effort' },
  { id: 'light', label: 'Light', hint: 'Easy even on a tired day' },
]

export const HYB_STATUSES = ['planned', 'done', 'dropped']

const KIND_BY_ID = new Map(HYB_KINDS.map((kind) => [kind.id, kind]))
const REPEAT_IDS = HYB_REPEATS.map((repeat) => repeat.id)
const ENERGY_IDS = HYB_ENERGY.map((energy) => energy.id)
const PRIORITIES = ['high', 'medium', 'low']

const pad2 = (n) => String(n).padStart(2, '0')
const isObj = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
const asArray = (value) => (Array.isArray(value) ? value : [])

export function kindOf(id) {
  return KIND_BY_ID.get(id) || KIND_BY_ID.get('study')
}

export function energyOf(id) {
  return HYB_ENERGY.find((energy) => energy.id === id) || HYB_ENERGY[1]
}

export function repeatOf(id) {
  return HYB_REPEATS.find((repeat) => repeat.id === id) || HYB_REPEATS[0]
}

/** `HH:MM` or null (unlike missions, a HYB plan may be date-only). */
export function normalizeClock(value) {
  const str = String(value ?? '').trim()
  if (!/^\d{1,2}:\d{2}$/.test(str)) return null
  const [h, m] = str.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m) || h > 23 || m > 59) return null
  return `${pad2(h)}:${pad2(m)}`
}

function clamp(value, min, max, fallback) {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(max, Math.max(min, Math.round(num)))
}

function slug(value) {
  return String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
}

/** A context compatible with `lib/state.js#makeContext`, without importing it. */
export function hybContext({ now = Date.now(), id = null } = {}) {
  let n = 0
  const uid =
    id ||
    (() => `hyb${Date.now().toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 6)}`)
  return { now: Number.isFinite(now) ? now : Date.now(), uid }
}

/**
 * Shape-safe normalisation for one plan. Unknown kinds fall back to `study`,
 * invalid dates become "someday" (null) rather than being thrown away.
 */
export function normalizeHybPlan(raw, ctx = hybContext()) {
  if (!isObj(raw)) return null
  const date = isValidKey(raw.date) ? raw.date : null
  const repeat = REPEAT_IDS.includes(raw.repeat) ? raw.repeat : 'none'
  const steps = asArray(raw.steps)
    .filter(isObj)
    .slice(0, 30)
    .map((step) => ({
      id: String(step.id || ctx.uid()),
      title: String(step.title || 'Step').trim().slice(0, 160) || 'Step',
      done: step.done === true,
    }))
  const log = {}
  if (isObj(raw.log)) {
    for (const [key, value] of Object.entries(raw.log)) {
      if (!isValidKey(key)) continue
      if (value === 'done' || value === 'skipped') log[key] = value
    }
  }
  const status = HYB_STATUSES.includes(raw.status) ? raw.status : 'planned'
  const tags = [...new Set(asArray(raw.tags).map(slug).filter(Boolean))].slice(0, 8)
  const minutes = clamp(raw.minutes, 5, 1440, 60)
  const doneSteps = steps.filter((step) => step.done).length
  return {
    id: String(raw.id || ctx.uid()),
    title: String(raw.title || '').trim().slice(0, 160) || 'Untitled plan',
    notes: typeof raw.notes === 'string' ? raw.notes.slice(0, 4000) : '',
    date,
    startTime: normalizeClock(raw.startTime),
    minutes,
    kind: HYB_KIND_IDS.includes(raw.kind) ? raw.kind : 'study',
    priority: PRIORITIES.includes(raw.priority) ? raw.priority : 'medium',
    energy: ENERGY_IDS.includes(raw.energy) ? raw.energy : 'steady',
    status: repeat === 'none' ? status : status === 'dropped' ? 'dropped' : 'planned',
    progress: raw.progress == null ? (steps.length ? Math.round((doneSteps / steps.length) * 100) : null) : clamp(raw.progress, 0, 100, 0),
    steps,
    tags,
    repeat,
    log: trimLog(log),
    missionId: raw.missionId ? String(raw.missionId) : null,
    goalId: raw.goalId ? String(raw.goalId) : null,
    projectId: raw.projectId ? String(raw.projectId) : null,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : ctx.now,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : ctx.now,
    completedAt: Number.isFinite(raw.completedAt) ? raw.completedAt : null,
  }
}

/** Keep the per-day log bounded (repeating plans would otherwise grow forever). */
export function trimLog(log, keep = 400) {
  const keys = Object.keys(log || {}).sort()
  if (keys.length <= keep) return log || {}
  const next = {}
  for (const key of keys.slice(-keep)) next[key] = log[key]
  return next
}

/** Build a plan from loose user input (the deck's quick add, the studio form). */
export function makeHybPlan(input = {}, ctx = hybContext()) {
  return normalizeHybPlan(
    {
      ...input,
      id: input.id || ctx.uid(),
      createdAt: Number.isFinite(input.createdAt) ? input.createdAt : ctx.now,
      updatedAt: ctx.now,
    },
    ctx,
  )
}

/* ------------------------------------------------------------- occurrences */

/** Does this plan appear on `dayKey`? Dropped plans never do. */
export function occursOn(plan, dayKey) {
  if (!plan || plan.status === 'dropped' || !isValidKey(dayKey)) return false
  if (!plan.date) return false
  if (dayKey < plan.date) return false
  switch (plan.repeat) {
    case 'daily':
      return true
    case 'weekdays': {
      const day = weekdayOf(dayKey)
      return day >= 1 && day <= 5
    }
    case 'weekly':
      return weekdayOf(dayKey) === weekdayOf(plan.date)
    default:
      return dayKey === plan.date
  }
}

/** Is this plan finished on that specific day? */
export function isDoneOn(plan, dayKey) {
  if (!plan || plan.status === 'dropped') return false
  if (plan.repeat === 'none') return plan.status === 'done'
  return plan.log?.[dayKey] === 'done'
}

export function isSkippedOn(plan, dayKey) {
  if (!plan || plan.repeat === 'none') return false
  return plan.log?.[dayKey] === 'skipped'
}

/**
 * Every plan occurrence on one day, earliest first, undated plans excluded.
 * @returns {Array<{plan:any,date:string,done:boolean,skipped:boolean,minutes:number}>}
 */
export function occurrencesOn(plans, dayKey) {
  return asArray(plans)
    .filter((plan) => occursOn(plan, dayKey))
    .map((plan) => ({
      plan,
      date: dayKey,
      done: isDoneOn(plan, dayKey),
      skipped: isSkippedOn(plan, dayKey),
      minutes: plan.minutes || 0,
    }))
    .sort(
      (a, b) =>
        (a.plan.startTime ? minutesOfDay(a.plan.startTime) : 1440) - (b.plan.startTime ? minutesOfDay(b.plan.startTime) : 1440) ||
        a.plan.title.localeCompare(b.plan.title),
    )
}

export function plansForDay(plans, dayKey) {
  return occurrencesOn(plans, dayKey)
}

/** Plans with no date — the honest "someday" shelf. */
export function undatedPlans(plans) {
  return asArray(plans)
    .filter((plan) => !plan.date && plan.status !== 'dropped')
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

/** One-day plans whose date has passed and are still open. No blame, just a list. */
export function overduePlans(plans, todayKey) {
  return asArray(plans)
    .filter((plan) => plan.repeat === 'none' && plan.date && plan.date < todayKey && plan.status === 'planned')
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** `[{date, occurrences, planned, done, minutes}]` for the next `days` days. */
export function upcoming(plans, todayKey, days = 7) {
  const span = Math.max(1, Math.min(60, Number(days) || 7))
  return Array.from({ length: span }, (_, index) => {
    const date = addDays(todayKey, index)
    const list = occurrencesOn(plans, date)
    return {
      date,
      occurrences: list,
      planned: list.length,
      done: list.filter((item) => item.done).length,
      minutes: list.reduce((sum, item) => sum + (item.done || item.skipped ? 0 : item.minutes), 0),
    }
  })
}

/** Planned and finished minutes for one day. */
export function hybLoad(plans, dayKey) {
  const list = occurrencesOn(plans, dayKey)
  const done = list.filter((item) => item.done)
  return {
    count: list.length,
    open: list.filter((item) => !item.done && !item.skipped).length,
    doneCount: done.length,
    skipped: list.filter((item) => item.skipped).length,
    minutes: list.reduce((sum, item) => sum + item.minutes, 0),
    doneMinutes: done.reduce((sum, item) => sum + item.minutes, 0),
    completion: list.length ? Math.round((done.length / list.length) * 100) : 0,
    occurrences: list,
  }
}

/** 7 columns starting at the user's week start, for the deck/studio strip. */
export function weekStrip(plans, todayKey, weekStart = 1) {
  const first = startOfWeek(todayKey, weekStart)
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(first, index)
    const load = hybLoad(plans, date)
    return { date, isToday: date === todayKey, isFuture: date > todayKey, ...load }
  })
}

/** Consecutive days (ending today or yesterday) with at least one HYB plan done. */
export function hybStreak(plans, todayKey, lookback = 120) {
  const doneDays = new Set()
  for (const plan of asArray(plans)) {
    if (plan.repeat === 'none') {
      if (plan.status === 'done' && plan.date) doneDays.add(plan.date)
      continue
    }
    for (const [key, value] of Object.entries(plan.log || {})) if (value === 'done') doneDays.add(key)
  }
  let streak = 0
  let cursor = doneDays.has(todayKey) ? todayKey : addDays(todayKey, -1)
  for (let i = 0; i < lookback; i++) {
    if (!doneDays.has(cursor)) break
    streak++
    cursor = addDays(cursor, -1)
  }
  let best = 0
  let run = 0
  const sorted = [...doneDays].filter((key) => key <= todayKey).sort()
  for (let i = 0; i < sorted.length; i++) {
    run = i && sorted[i - 1] === addDays(sorted[i], -1) ? run + 1 : 1
    best = Math.max(best, run)
  }
  return { current: streak, best: Math.max(best, streak), days: doneDays.size }
}

/** Everything the badge, the deck header and the studio stats need. */
export function hybStats(plans, { todayKey = dateKey(), days = 7, weekStart = 1 } = {}) {
  const all = asArray(plans).filter(isObj)
  const today = hybLoad(all, todayKey)
  const strip = weekStrip(all, todayKey, weekStart)
  const window = upcoming(all, todayKey, Math.max(1, days))
  const plannedInWindow = window.reduce((sum, day) => sum + day.planned, 0)
  const doneInWindow = window.reduce((sum, day) => sum + day.done, 0)
  const byKind = HYB_KINDS.map((kind) => {
    const owned = all.filter((plan) => plan.kind === kind.id && plan.status !== 'dropped')
    return {
      ...kind,
      count: owned.length,
      minutes: owned.reduce((sum, plan) => sum + (plan.minutes || 0), 0),
    }
  }).filter((row) => row.count)
  const streak = hybStreak(all, todayKey)
  return {
    total: all.length,
    open: all.filter((plan) => plan.status === 'planned').length,
    dropped: all.filter((plan) => plan.status === 'dropped').length,
    undated: undatedPlans(all).length,
    overdue: overduePlans(all, todayKey).length,
    today,
    week: strip,
    window,
    windowPlanned: plannedInWindow,
    windowDone: doneInWindow,
    completion: plannedInWindow ? Math.round((doneInWindow / plannedInWindow) * 100) : 0,
    minutesPlanned: window.reduce((sum, day) => sum + day.minutes, 0),
    byKind,
    streak,
    kindBalance: byKind.length ? byKind : [],
  }
}

/** The plan the HYB button should be thinking about right now. */
export function nextHybPlan(plans, { todayKey = dateKey(), nowMinutes = null, now = null } = {}) {
  const minuteOfDay = nowMinutes == null ? (now ? now.getHours() * 60 + now.getMinutes() : null) : nowMinutes
  const today = occurrencesOn(plans, todayKey).filter((item) => !item.done && !item.skipped)
  const running = minuteOfDay == null ? null : today.find((item) => {
    if (!item.plan.startTime) return false
    const start = minutesOfDay(item.plan.startTime)
    return start <= minuteOfDay && minuteOfDay < start + item.minutes
  })
  if (running) return { ...running, reason: 'Happening now' }
  const later = minuteOfDay == null ? null : today.find((item) => item.plan.startTime && minutesOfDay(item.plan.startTime) > minuteOfDay)
  if (later) return { ...later, reason: 'Later today' }
  const overdue = overduePlans(plans, todayKey)[0]
  if (overdue) return { plan: overdue, date: overdue.date, done: false, skipped: false, minutes: overdue.minutes, reason: 'Still open from earlier' }
  if (today.length) return { ...today[0], reason: 'Today, no time set' }
  for (const day of upcoming(plans, todayKey, 14)) {
    if (!day.date || day.date <= todayKey) continue
    const next = day.occurrences.find((item) => !item.done)
    if (next) return { ...next, reason: `Next on ${day.date}` }
  }
  const someday = undatedPlans(plans)[0]
  if (someday) return { plan: someday, date: null, done: false, skipped: false, minutes: someday.minutes, reason: 'No date yet' }
  return null
}

/* ------------------------------------------------------------ conversions */

/** A plan becomes a real mission — the fields map one-to-one, nothing is lost. */
export function planToTaskPayload(plan, { date = null, id = null, now = Date.now() } = {}) {
  const when = date || plan.date || dateKey()
  return {
    id,
    title: plan.title,
    date: when,
    time: plan.startTime || null,
    priority: plan.priority,
    cat: null,
    notes: [plan.notes, plan.tags.length ? `HYB tags: ${plan.tags.map((tag) => `#${tag}`).join(' ')}` : '']
      .filter(Boolean)
      .join('\n'),
    description: '',
    estimateMinutes: plan.minutes,
    done: false,
    status: 'ready',
    inbox: false,
    horizon: plan.repeat === 'none' ? 'daily' : 'long_term',
    goalId: plan.goalId,
    projectId: plan.projectId,
    subtasks: plan.steps.map((step) => ({ id: step.id, title: step.title, done: step.done })),
    history: [],
    createdAt: now,
    completedAt: null,
    recurrence: null,
    seriesId: null,
    occurrenceDate: null,
  }
}

/**
 * Recurrence for the mission version of a repeating plan, so a daily HYB plan
 * becomes a daily mission series instead of a one-off.
 */
export function planRecurrence(plan) {
  if (!plan.date || plan.repeat === 'none') return null
  if (plan.repeat === 'daily') return normalizeRecurrence({ freq: 'daily', startDate: plan.date })
  if (plan.repeat === 'weekdays') return normalizeRecurrence({ freq: 'weekdays', weekdays: [1, 2, 3, 4, 5], startDate: plan.date })
  return normalizeRecurrence({ freq: 'weekly', weekdays: [weekdayOf(plan.date)], startDate: plan.date })
}

/** A plan becomes a time block on a dated schedule (see `core/actions#saveDay`). */
export function planToBlock(plan, date, { startTime = null } = {}) {
  const time = normalizeClock(startTime) || plan.startTime || '09:00'
  return {
    id: `hyb:${plan.id}`,
    sourceId: plan.id,
    hybPlanId: plan.id,
    taskId: null,
    title: plan.title,
    time,
    duration: plan.minutes,
    cat: null,
    priority: plan.priority,
    kind: 'mission',
    status: 'planned',
    protected: false,
    flexible: true,
    goalId: plan.goalId,
    projectId: plan.projectId,
    milestoneId: null,
    routineId: null,
    activityId: null,
    days: [],
    date: date || plan.date || dateKey(),
  }
}

/** "Tue, Nov 17 · 6:00 pm · 1h 30m · Deep" — one honest line for a plan. */
export function planMetaLine(plan, dayKey = null, { timeLabel = null } = {}) {
  const parts = []
  if (plan.startTime) parts.push(timeLabel ? timeLabel(plan.startTime, true) : plan.startTime)
  parts.push(formatDuration(plan.minutes))
  parts.push(`${kindOf(plan.kind).label} · ${energyOf(plan.energy).label}`)
  if (plan.repeat !== 'none') parts.push(repeatOf(plan.repeat).label)
  else if (dayKey && plan.date && plan.date !== dayKey) parts.push(plan.date)
  return parts.join(' · ')
}

/** When a repeating plan ends (never, for the built-in repeats). */
export function planEndsOn(plan) {
  return plan.repeat === 'none' ? plan.date : null
}

/* ------------------------------------------------------- natural language */

/**
 * HYB quick add: `@study` picks the lane, `~deep` the energy, and everything
 * else is read by the same parser quick capture uses ("tomorrow 6pm for 90m
 * !high every weekday"). Nothing is invented: undetected fields stay null and
 * the deck shows exactly what was understood before saving.
 */
export function parseHybInput(input, { now = new Date(), todayKey = null, categories = [] } = {}) {
  const today = todayKey || dateKey(now)
  let rest = String(input ?? '')
  const matches = []

  const kindMatch = rest.match(/(^|\s)@([a-z]+)/i)
  let kind = null
  if (kindMatch) {
    const wanted = slug(kindMatch[2])
    const found = HYB_KINDS.find((entry) => entry.id === wanted || entry.label.toLowerCase() === wanted || entry.id.startsWith(wanted))
    if (found) {
      kind = found.id
      matches.push({ kind: 'lane', value: found.label })
      rest = `${rest.slice(0, kindMatch.index)} ${rest.slice(kindMatch.index + kindMatch[0].length)}`
    }
  }

  const energyMatch = rest.match(/(^|\s)~([a-z]+)/i)
  let energy = null
  if (energyMatch) {
    const wanted = slug(energyMatch[2])
    const found = HYB_ENERGY.find((entry) => entry.id === wanted || entry.label.toLowerCase() === wanted || entry.id.startsWith(wanted))
    if (found) {
      energy = found.id
      matches.push({ kind: 'energy', value: found.label })
      rest = `${rest.slice(0, energyMatch.index)} ${rest.slice(energyMatch.index + energyMatch[0].length)}`
    }
  }

  // tags are read from the raw line, then taken out of it so they never end up
  // sitting inside the title ("Revision #mock" → title "Revision", tag "mock")
  const tags = [...new Set([...String(input ?? '').matchAll(/#([a-z0-9][a-z0-9_-]*)/gi)].map((match) => slug(match[1])).filter(Boolean))].slice(0, 8)
  if (tags.length) rest = rest.replace(/(^|\s)#[a-z0-9][a-z0-9_-]*/gi, '$1').replace(/\s{2,}/g, ' ').trim()

  const parsed = parseQuickCapture(rest, { now, todayKey: today, categories })
  let repeat = 'none'
  if (parsed.recurrence) {
    if (parsed.recurrence.freq === 'daily') repeat = 'daily'
    else if (parsed.recurrence.freq === 'weekdays') repeat = 'weekdays'
    else if (parsed.recurrence.freq === 'weekly') repeat = 'weekly'
  }
  return {
    input: String(input ?? ''),
    title: parsed.title,
    date: parsed.date,
    startTime: parsed.time,
    minutes: parsed.estimateMinutes,
    priority: parsed.priority,
    kind,
    energy,
    repeat,
    tags,
    recurrence: parsed.recurrence,
    matches: [...matches, ...parsed.matches.filter((match) => match.kind !== 'category')],
    hasAnything: matches.length > 0 || parsed.hasAnything,
    recurrenceText: recurrenceLabel(parsed.recurrence),
  }
}

/**
 * A ready-to-save plan from one line of text (used by the deck's quick add).
 * @param {string} input
 * @param {{now?:number, todayKey?:string|null, id?:string|null, defaults?:HybDefaults}} [options]
 * @typedef {{date?:string|null, startTime?:string|null, minutes?:number, kind?:string, priority?:string, energy?:string, repeat?:string, tags?:string[]}} HybDefaults
 */
export function planFromInput(input, { now = Date.now(), todayKey = null, id = null, defaults = {} } = {}) {
  const ctx = hybContext({ now, id })
  const parsed = parseHybInput(input, { now: new Date(now), todayKey })
  const plan = makeHybPlan(
    {
      id: id || ctx.uid(),
      title: parsed.title || 'Untitled plan',
      date: parsed.date ?? defaults.date ?? null,
      startTime: parsed.startTime ?? defaults.startTime ?? null,
      minutes: parsed.minutes ?? defaults.minutes ?? 60,
      kind: parsed.kind ?? defaults.kind ?? 'study',
      priority: parsed.priority ?? defaults.priority ?? 'medium',
      energy: parsed.energy ?? defaults.energy ?? 'steady',
      // parseHybInput always answers 'none', so the deck's default only applies
      // when the sentence said nothing about repeating
      repeat: parsed.repeat && parsed.repeat !== 'none' ? parsed.repeat : defaults.repeat ?? 'none',
      tags: parsed.tags.length ? parsed.tags : defaults.tags || [],
    },
    ctx,
  )
  return { plan, parsed }
}

export { toHHMM, formatDuration }
