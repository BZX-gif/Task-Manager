/* -------------------------------------------------------------------------
   FORECAST — what the next two weeks already look like
   -------------------------------------------------------------------------
   The planner can propose a day; this module answers a different question:
   "if nothing changes, how heavy is the road ahead?"

   It reads the same schedule the rest of the app reads (`scheduleFor`), so a
   forecast can never disagree with the timetable. Rest blocks are excluded
   from commitment load — sleep is not a meeting.

   Pure: no store, no DOM, no clock beyond the `now` you pass in.
   ------------------------------------------------------------------------- */

import { addDays, dateKey, formatDuration, minutesOfDay, weekdayShort } from './dates.js'
import { scheduleFor } from './planner.js'

/** Default length of a focused day, used when working hours are unusable. */
export const DEFAULT_CAPACITY_MINUTES = 480

/** Blocks that describe rest rather than commitment. */
export function isRestBlock(block) {
  return !block || block.kind === 'protected' || /^sleep\b/i.test(String(block.title || ''))
}

/** The commitment blocks of one day, ignoring rest and cancelled work. */
export function commitmentBlocks(state, dayKey) {
  return scheduleFor(state, dayKey).filter((block) => block && block.time && !isRestBlock(block) && block.status !== 'skipped')
}

/** Overlapping blocks on one day (the earliest / worst pairs first). */
export function findConflicts(blocks = []) {
  const sorted = [...blocks]
    .filter((block) => block && block.time)
    .sort((a, b) => minutesOfDay(a.time) - minutesOfDay(b.time))
  const conflicts = []
  let active = null
  for (const block of sorted) {
    const start = minutesOfDay(block.time)
    const end = start + Math.max(5, Number(block.duration) || 30)
    if (active && start < active.end) {
      conflicts.push({ a: active.block, b: block, minutes: Math.min(active.end, end) - start })
      if (end > active.end) active = { block, end }
    } else {
      active = { block, end }
    }
  }
  return conflicts
}

/** Minutes available in a normal working day. */
export function capacityMinutesOf(state) {
  const hours = state?.settings?.workingHours || {}
  const parse = (value, fallback) => {
    const [h, m] = String(value || '').split(':').map(Number)
    return Number.isFinite(h) ? h * 60 + (Number.isFinite(m) ? m : 0) : fallback
  }
  const start = parse(hours.start, 9 * 60)
  const end = parse(hours.end, 17 * 60)
  const span = end - start
  return span >= 120 && span <= 900 ? span : DEFAULT_CAPACITY_MINUTES
}

export function loadStatus(loadPct, conflictCount = 0) {
  if (conflictCount > 0) return 'conflict'
  if (loadPct >= 92) return 'over'
  if (loadPct >= 68) return 'full'
  if (loadPct >= 35) return 'balanced'
  return 'light'
}

export const LOAD_LABELS = {
  light: 'Light',
  balanced: 'Balanced',
  full: 'Full',
  over: 'Overloaded',
  conflict: 'Clashing',
}

/**
 * Build the two-week outlook.
 *
 * @param {any} state
 * @param {{todayKey?:string, days?:number}} [options]
 */
export function buildForecast(state, { todayKey = dateKey(), days = 14 } = {}) {
  const safeDays = Math.max(1, Math.min(60, Number(days) || 14))
  const capacity = capacityMinutesOf(state)
  const balance = new Map()
  let totalPlanned = 0
  let totalBlocks = 0
  let totalConflicts = 0
  let totalTasks = 0
  let totalUnscheduled = 0

  const rows = []
  for (let i = 0; i < safeDays; i += 1) {
    const key = addDays(todayKey, i)
    const blocks = commitmentBlocks(state, key)
    const conflicts = findConflicts(blocks)
    const plannedMinutes = blocks.reduce((sum, block) => sum + Math.max(5, Number(block.duration) || 30), 0)
    const tasks = (state.tasks || []).filter((task) => task.date === key && !task.inbox && task.status !== 'cancelled')
    const openTasks = tasks.filter((task) => !task.done)
    const unscheduled = openTasks.filter((task) => !task.time)
    const unscheduledMinutes = unscheduled.reduce((sum, task) => sum + (Number(task.estimateMinutes) || 30), 0)
    const loadPct = capacity ? Math.round((plannedMinutes / capacity) * 100) : 0

    for (const block of blocks) {
      const id = block.cat || 'uncategorised'
      balance.set(id, (balance.get(id) || 0) + Math.max(5, Number(block.duration) || 30))
    }

    totalPlanned += plannedMinutes
    totalBlocks += blocks.length
    totalConflicts += conflicts.length
    totalTasks += tasks.length
    totalUnscheduled += unscheduled.length

    rows.push({
      key,
      weekday: weekdayShort(new Date(`${key}T12:00:00`).getDay()),
      dayOfMonth: Number(key.slice(8)),
      isToday: i === 0,
      isWeekend: [0, 6].includes(new Date(`${key}T12:00:00`).getDay()),
      plannedMinutes,
      freeMinutes: Math.max(0, capacity - plannedMinutes),
      blockCount: blocks.length,
      taskCount: tasks.length,
      openTaskCount: openTasks.length,
      unscheduledCount: unscheduled.length,
      unscheduledMinutes,
      conflictCount: conflicts.length,
      loadPct,
      status: loadStatus(loadPct, conflicts.length),
      blocks,
      conflicts,
    })
  }

  const categories = new Map((state.categories || []).map((cat) => [cat.id, cat]))
  const balanceRows = [...balance.entries()]
    .map(([categoryId, minutes]) => ({
      categoryId,
      name: categories.get(categoryId)?.name || 'Other',
      color: categories.get(categoryId)?.color || 'var(--muted)',
      minutes,
      share: totalPlanned ? Math.round((minutes / totalPlanned) * 100) : 0,
    }))
    .sort((a, b) => b.minutes - a.minutes)

  const upcoming = rows.slice(0, 7)
  const peak = rows.reduce((best, row) => (!best || row.plannedMinutes > best.plannedMinutes ? row : best), null)
  const heaviestUpcoming = upcoming.filter((row) => row.status === 'over' || row.status === 'conflict')
  const lightest = upcoming.reduce((best, row) => (!best || row.plannedMinutes < best.plannedMinutes ? row : best), null)
  const carried = (state.tasks || []).filter((task) => task.date && task.date < todayKey && !task.done && task.status !== 'cancelled' && task.status !== 'paused')

  return {
    days: rows,
    window: { from: todayKey, to: addDays(todayKey, safeDays - 1) },
    capacityMinutes: capacity,
    capacityLabel: formatDuration(capacity),
    totalPlanned,
    totalBlocks,
    totalConflicts,
    totalTasks,
    totalUnscheduled,
    averagePlanned: Math.round(totalPlanned / safeDays),
    averageLoadPct: Math.round((totalPlanned / (capacity * safeDays)) * 100),
    balance: balanceRows,
    peak,
    heavyDays: heaviestUpcoming,
    lightest,
    carried,
    carriedCount: carried.length,
    overdueMinutes: carried.reduce((sum, task) => sum + (Number(task.estimateMinutes) || 30), 0),
    empty: totalBlocks === 0 && totalTasks === 0,
  }
}

/** One actionable sentence for the top of the view. */
export function forecastAdvice(forecast) {
  if (!forecast || forecast.empty) {
    return { tone: 'neutral', title: 'Nothing is committed yet.', body: 'Add a few missions or a timetable block and this page will show how the next fortnight actually looks.' }
  }
  if (forecast.totalConflicts > 0) {
    return {
      tone: 'warn',
      title: `${forecast.totalConflicts} ${forecast.totalConflicts === 1 ? 'clash' : 'clashes'} in the next two weeks.`,
      body: 'Two blocks overlap. Untangling one of them is cheaper today than it is on the day.',
    }
  }
  if (forecast.heavyDays.length) {
    const first = forecast.heavyDays[0]
    return {
      tone: 'warn',
      title: `${first.weekday} is ${LOAD_LABELS[first.status].toLowerCase()} — ${formatDuration(first.plannedMinutes)} committed.`,
      body: `That is ${first.loadPct}% of a normal day. Move one block to ${forecast.lightest?.weekday || 'a lighter day'} while the decision is still cheap.`,
    }
  }
  if (forecast.carriedCount > 0) {
    return {
      tone: 'neutral',
      title: `${forecast.carriedCount} ${forecast.carriedCount === 1 ? 'mission is' : 'missions are'} carried over.`,
      body: `${formatDuration(forecast.overdueMinutes)} of unresolved work is following you into this week. Decide: do it, shrink it, or let it go.`,
    }
  }
  return {
    tone: 'good',
    title: 'The next two weeks have room in them.',
    body: `About ${formatDuration(forecast.averagePlanned)} committed per day against a ${forecast.capacityLabel} focused day. Keep it that way.`,
  }
}

/** Share of the horizon that is visualised as "busy" days. */
export function busyShare(forecast) {
  if (!forecast?.days?.length) return 0
  const busy = forecast.days.filter((row) => ['over', 'conflict'].includes(row.status)).length
  return Math.round((busy / forecast.days.length) * 100)
}
