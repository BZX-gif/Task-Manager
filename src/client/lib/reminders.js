/* -------------------------------------------------------------------------
   SMART REMINDERS (pure part)
   -------------------------------------------------------------------------
   Works out *which* reminders are due right now. Delivery (Notification API or
   in-app toast) happens in the UI layer. Rules:

     • timetable block starting within N minutes (default 10)
     • task with a start time within N minutes
     • overdue tasks — one summary per day (default 10:00)
     • Top 3 nudge in the evening if priorities are unfinished

   Anti-spam: every reminder has a stable key and is sent at most once, and the
   whole engine stays quiet during protected time when asked to.
   ------------------------------------------------------------------------- */

import { addDays, minutesOfDay, toHHMM } from './dates.js'
import { protectionAt } from './protected.js'

export const DEFAULT_BEFORE_MINUTES = 10
export const OVERDUE_HOUR = 10

/**
 * @param {Object} input
 * @param {any} input.state
 * @param {Date} [input.now]
 * @param {string} input.todayKey
 * @param {number} input.nowMinutes
 * @param {number} [input.maxPerRun]
 * @returns {Array<{key:string, kind:string, title:string, body:string, taskId?:string|null, blockId?:string|null}>}
 */
export function computeDueReminders({ state, todayKey, nowMinutes, now = new Date(), maxPerRun = 2 }) {
  const settings = state.settings?.reminders || {}
  if (!settings.enabled) return []

  const protectedBlocks = state.settings?.protectedTime || []
  if (settings.respectProtectedTime !== false && protectionAt(nowMinutes, protectedBlocks, todayKey)) {
    return []
  }

  const before = Number.isFinite(settings.beforeMinutes) ? settings.beforeMinutes : DEFAULT_BEFORE_MINUTES
  const log = state.completionLog?.[todayKey] || { ttDone: [] }
  const ttDone = Array.isArray(log.ttDone) ? log.ttDone : []
  const due = []

  // 1 — timetable blocks about to start
  if (settings.timetable !== false) {
    for (const block of state.timetable || []) {
      const start = minutesOfDay(block.time)
      const delta = start - nowMinutes
      if (delta > 0 && delta <= before && !ttDone.includes(block.id)) {
        due.push({
          key: `block:${block.id}:${todayKey}:${before}`,
          kind: 'timetable',
          title: `Starting in ${delta} min · ${block.time}`,
          body: block.title,
          blockId: block.id,
          taskId: null,
        })
      }
    }
  }

  // 2 — timed tasks about to start
  if (settings.taskDue !== false) {
    for (const task of state.tasks || []) {
      if (task.done || task.date !== todayKey || !task.time) continue
      const start = minutesOfDay(task.time)
      const delta = start - nowMinutes
      if (delta > 0 && delta <= before) {
        due.push({
          key: `task:${task.id}:${todayKey}:${before}`,
          kind: 'task',
          title: `Task in ${delta} min · ${task.time}`,
          body: task.title,
          taskId: task.id,
          blockId: null,
        })
      }
      if (delta <= 0 && nowMinutes - start <= 15 && !task.done) {
        due.push({
          key: `task-duenow:${task.id}:${todayKey}`,
          kind: 'task',
          title: 'Scheduled for now',
          body: task.title,
          taskId: task.id,
          blockId: null,
        })
      }
    }
  }

  // 3 — overdue summary, once per day
  if (settings.overdue !== false && nowMinutes >= OVERDUE_HOUR * 60) {
    const overdue = (state.tasks || []).filter((t) => !t.done && t.date && t.date < todayKey && !t.inbox)
    if (overdue.length) {
      due.push({
        key: `overdue:${todayKey}`,
        kind: 'overdue',
        title: `${overdue.length} overdue task${overdue.length > 1 ? 's' : ''}`,
        body: overdue
          .slice(0, 3)
          .map((t) => t.title)
          .join(' · '),
        taskId: overdue[0].id,
        blockId: null,
      })
    }
  }

  // 4 — evening Top 3 nudge
  if (settings.top3NudgeAt) {
    const nudge = minutesOfDay(settings.top3NudgeAt)
    const ids = state.top3?.[todayKey] || []
    const open = ids.filter((id) => {
      const task = state.tasks?.find((t) => t.id === id)
      return task && !task.done
    })
    if (ids.length && open.length && nowMinutes >= nudge) {
      due.push({
        key: `top3:${todayKey}`,
        kind: 'top3',
        title: `${open.length} of your Top 3 still open`,
        body: 'Finish the priorities you chose for today — nothing else matters as much.',
        taskId: open[0],
        blockId: null,
      })
    }
  }

  return due.slice(0, maxPerRun)
}

/** Keys older than `days` are pruned so the sent-log cannot grow forever. */
export function pruneSentLog(sent = {}, todayKey, days = 14) {
  const cutoff = addDays(todayKey, -days)
  const kept = {}
  for (const [key, value] of Object.entries(sent)) {
    const dateMatch = key.match(/(\d{4}-\d{2}-\d{2})/)
    if (!dateMatch || dateMatch[1] >= cutoff) kept[key] = value
  }
  return kept
}

export function reminderSummary(settings = {}) {
  if (!settings.enabled) return 'Reminders are off.'
  const parts = []
  if (settings.timetable !== false) parts.push(`timetable blocks ${settings.beforeMinutes ?? DEFAULT_BEFORE_MINUTES} min before`)
  if (settings.taskDue !== false) parts.push('timed tasks')
  if (settings.overdue !== false) parts.push('overdue summary at 10:00')
  if (settings.top3NudgeAt) parts.push(`Top 3 nudge at ${toHHMM(minutesOfDay(settings.top3NudgeAt))}`)
  return parts.length ? `You will get: ${parts.join(', ')}.` : 'No reminder types selected.'
}
