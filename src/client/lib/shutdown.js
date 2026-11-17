/* -------------------------------------------------------------------------
   CLOSE THE DAY — the evening half of the daily loop
   -------------------------------------------------------------------------
   The briefing opens the day. This closes it.

   The ritual does four things, and only when you confirm them:

     1. tells you the honest shape of the day (completed, focused, still open)
     2. moves the work you choose forward to tomorrow
     3. lets you choose tomorrow's three priorities before the day ends
     4. writes one honest line into the journal

   Nothing is blamed and nothing is deleted: unfinished work is rescheduled,
   never marked as failure. Every function is pure and deterministic so the
   tests can pin the whole ritual down.
   ------------------------------------------------------------------------- */

import { addDays, dateKey, isValidKey } from './dates.js'
import { dayStats } from './daystats.js'
import { normalizeEntry } from './journal.js'
import { scheduleFor } from './planner.js'
import { overdueTasks } from './score.js'
import { isRestBlock } from './calendar-export.js'

export const SHUTDOWN_SUGGESTION_LIMIT = 12

function uniqueById(items) {
  const seen = new Set()
  const out = []
  for (const item of items) {
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

function priorityRank(task) {
  return task?.priority === 'high' ? 0 : task?.priority === 'low' ? 2 : 1
}

/**
 * Everything the closing screen needs, computed from real records only.
 * @param {any} state
 * @param {{ today?: string, now?: Date }} [options]
 */
export function shutdownSummary(state, { today, now = new Date() } = {}) {
  const todayKey = isValidKey(today) ? today : dateKey(new Date(now))
  const tomorrow = addDays(todayKey, 1)
  const stats = dayStats(state, todayKey, { todayKey, now })

  const missions = (state.tasks || []).filter((task) => task.date === todayKey && !task.inbox && task.status !== 'cancelled')
  const openToday = missions.filter((task) => !task.done)
  const completed = missions.filter((task) => task.done)

  const overdue = overdueTasks(state, todayKey).map((task) => ({ task, reason: 'overdue' }))
  const open = openToday.map((task) => ({ task, reason: 'today' }))
  const seen = new Set()
  const unfinished = [...overdue, ...open]
    .filter((entry) => {
      if (seen.has(entry.task.id)) return false
      seen.add(entry.task.id)
      return true
    })
    .sort((a, b) => {
      if (a.reason !== b.reason) return a.reason === 'overdue' ? -1 : 1
      return priorityRank(a.task) - priorityRank(b.task) || (a.task.time || '99').localeCompare(b.task.time || '99')
    })
    .slice(0, SHUTDOWN_SUGGESTION_LIMIT)
    .map(({ task, reason }) => ({
      id: task.id,
      title: task.title,
      priority: task.priority,
      estimateMinutes: task.estimateMinutes,
      categoryId: task.cat || null,
      date: task.date,
      time: task.time || null,
      done: !!task.done,
      reason,
    }))

  const top3Ids = state.top3?.[todayKey] || []
  const top3Open = top3Ids.filter((id) => {
    const task = (state.tasks || []).find((item) => item.id === id)
    return task && !task.done && task.status !== 'cancelled'
  })

  const focusMinutes = Math.round(
    (state.focus?.sessions || [])
      .filter((session) => session.date === todayKey && session.mode !== 'break')
      .reduce((sum, session) => sum + (session.focusedSeconds || 0), 0) / 60,
  )

  const tomorrowMissions = (state.tasks || []).filter(
    (task) => task.date === tomorrow && !task.inbox && !task.done && task.status !== 'cancelled',
  )
  const tomorrowBlocks = scheduleFor(state, tomorrow).filter((block) => !isRestBlock(block))
  const tomorrowPriorities = (state.top3?.[tomorrow] || []).filter((id) =>
    (state.tasks || []).some((task) => task.id === id && !task.done),
  )

  const record = state.shutdowns?.[todayKey] || null
  const hasActivity = !!stats.hasAnyActivity
  const closed = !!record?.closed

  return {
    today: todayKey,
    tomorrowKey: tomorrow,
    closed,
    closedAt: record?.at || null,
    score: stats.score || 0,
    hasActivity,
    missions: { total: missions.length, done: completed.length, open: openToday.length },
    top3: { total: top3Ids.length, done: top3Ids.length - top3Open.length, open: top3Open.length },
    focusMinutes,
    unfinished,
    carrySuggestion: unfinished.map((item) => item.id),
    tomorrow: {
      missions: tomorrowMissions.length,
      blocks: tomorrowBlocks.length,
      firstBlock: tomorrowBlocks[0]?.time || null,
      priorities: tomorrowPriorities.length,
    },
    headline: closingHeadline({ closed, hasActivity, score: stats.score || 0, focusMinutes, done: completed.length, open: unfinished.length }),
    prompt: closingPrompt({ score: stats.score || 0, focusMinutes, open: unfinished.length }),
  }
}

/** A deterministic, honest headline. Same records → same sentence. */
export function closingHeadline({ closed, hasActivity, score, focusMinutes, done, open }) {
  if (closed) return 'Closed with care.'
  if (!hasActivity && !open) return 'A quiet day, honestly kept.'
  if (open === 0 && done > 0 && score >= 80) return 'A day that held its shape.'
  if (open === 0 && done > 0) return 'The day is complete.'
  if (focusMinutes >= 90) return 'Real focus happened today.'
  if (open > 0) return 'Some of it is still open. That is information, not failure.'
  if (done > 0) return 'Steady work. Real progress.'
  return 'A day is allowed to be ordinary.'
}

function closingPrompt({ score, focusMinutes, open }) {
  if (open > 0) return 'Choose what comes with you. The rest can wait without guilt.'
  if (focusMinutes === 0 && score < 50) return 'What would make tomorrow feel a little lighter?'
  return 'What is one thing you want to remember about today?'
}

/**
 * Apply the ritual. The UI only calls this after the user presses
 * “Close the day”, so nothing here is a surprise.
 * @param {any} state
 * @param {{ today?: string, carryIds?: string[], priorityIds?: string[], note?: string, win?: string, mood?: string|null, energy?: string|null, now?: number, tomorrow?: string|null }} [options]
 */
export function applyShutdown(state, {
  today,
  carryIds = [],
  priorityIds = null,
  note = '',
  win = '',
  mood = null,
  energy = null,
  now = Date.now(),
  tomorrow = null,
} = {}) {
  if (!state) return { ok: false, reason: 'No workspace.' }
  const todayKey = isValidKey(today) ? today : dateKey(new Date(now))
  const tomorrowKey = isValidKey(tomorrow) ? tomorrow : addDays(todayKey, 1)
  const tasks = state.tasks || []

  const carried = []
  const carrySet = new Set(carryIds.filter((id) => tasks.some((task) => task.id === id)))
  for (const taskId of carrySet) {
    const task = tasks.find((item) => item.id === taskId)
    if (!task || task.done) continue
    // Work that already lives on tomorrow's plan is left exactly as it is.
    if (task.date === tomorrowKey) continue
    const from = task.date || todayKey
    task.date = tomorrowKey
    task.inbox = false
    task.time = null
    task.status = 'rescheduled'
    task.history = [...(task.history || []), { at: now, action: 'carried_forward', from, to: tomorrowKey }].slice(-100)
    carried.push(task.id)
  }

  // A carried mission should not also remain on today's dated plan.
  if (carried.length && state.schedule?.days?.[todayKey]) {
    const set = new Set(carried)
    state.schedule.days[todayKey] = state.schedule.days[todayKey].filter((block) => !set.has(block?.taskId))
  }

  // A priority for tomorrow must actually exist tomorrow: carried work, or a
  // mission already dated tomorrow. Inbox captures never become priorities.
  const eligibleForTomorrow = new Set([
    ...carried,
    ...tasks.filter((task) => task.date === tomorrowKey && !task.done && !task.inbox && task.status !== 'cancelled').map((task) => task.id),
  ])
  // `null` means “leave tomorrow’s priorities alone”; an array is a complete
  // statement of intent, so an empty array deliberately clears them.
  let validPriorities = null
  if (Array.isArray(priorityIds)) {
    validPriorities = uniqueById(
      priorityIds
        .filter((id) => eligibleForTomorrow.has(id))
        .map((id) => tasks.find((task) => task.id === id)),
    )
      .slice(0, 3)
      .map((task) => task.id)
    state.top3 = state.top3 || {}
    if (validPriorities.length) state.top3[tomorrowKey] = validPriorities
    else delete state.top3[tomorrowKey]
  }

  if (!state.journal) state.journal = {}
  const existing = state.journal[todayKey] || {}
  const entry = normalizeEntry({
    ...existing,
    note: typeof note === 'string' && note.trim() ? note : existing.note,
    win: typeof win === 'string' && win.trim() ? win : existing.win,
    mood: mood || existing.mood || null,
    energy: energy || existing.energy || null,
    updatedAt: now,
  })
  if (entry) state.journal[todayKey] = entry

  if (!state.shutdowns) state.shutdowns = {}
  state.shutdowns[todayKey] = {
    closed: true,
    at: now,
    tomorrow: tomorrowKey,
    carried: [...carried],
    priorities: [...(validPriorities || [])],
    hasNote: !!(entry?.note || entry?.win),
  }

  return {
    ok: true,
    closed: true,
    today: todayKey,
    tomorrow: tomorrowKey,
    carried,
    priorities: validPriorities || [],
    journalWritten: !!entry,
    reason: '',
  }
}

/** Undo a closing — for the “I’m not done yet” moment. */
export function reopenDay(state, today) {
  if (!state?.shutdowns || !state.shutdowns[today]) return false
  delete state.shutdowns[today]
  return true
}

export function isDayClosed(state, today) {
  return !!state?.shutdowns?.[today]?.closed
}
