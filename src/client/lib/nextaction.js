/* -------------------------------------------------------------------------
   "DO THIS NOW" — deterministic next-action selection
   -------------------------------------------------------------------------
   Order of preference (first match wins):

     1. an unfinished Top 3 priority for today
     2. the timetable block that is running right now (if not yet ticked off)
     3. the most overdue open task
     4. the highest-priority open task for today
     5. the nearest scheduled thing (next timetable block / timed task)

   Nothing random, nothing AI-dependent: the card works offline. When the
   current pick is completed the card simply recomputes the next one.
   ------------------------------------------------------------------------- */

import { minutesOfDay, toHHMM } from './dates.js'
import { PRIORITY_ORDER } from './defaults.js'
import { protectionAt } from './protected.js'

export const NEXT_ACTION_KINDS = ['top3', 'current-block', 'overdue', 'priority', 'scheduled', 'clear']

const REASONS = {
  top3: 'Top 3 priority',
  'current-block': 'Scheduled right now',
  overdue: 'Overdue — clear it first',
  priority: 'Highest priority left',
  scheduled: 'Next on your schedule',
  clear: 'Nothing pending',
}

/**
 * @param {Object} input
 * @param {Array<any>} input.tasks
 * @param {Array<any>} input.timetable
 * @param {string[]} input.ttDone
 * @param {string[]} input.top3Ids
 * @param {string} input.todayKey
 * @param {number} [input.nowMinutes]
 * @param {Array<any>} [input.protectedBlocks]
 */
export function selectNextAction(input) {
  const {
    tasks = [],
    timetable = [],
    ttDone = [],
    top3Ids = [],
    todayKey,
    nowMinutes = 0,
    protectedBlocks = [],
  } = input

  const doneSet = new Set(ttDone)
  const openToday = tasks.filter((t) => t.date === todayKey && !t.done)
  const overdue = tasks.filter((t) => !t.done && t.date && t.date < todayKey && !t.inbox)

  /** @type {any} */
  let pick = null

  // 1 — Top 3
  for (const id of top3Ids) {
    const task = openToday.find((t) => t.id === id) || tasks.find((t) => t.id === id && !t.done)
    if (task) {
      pick = { kind: 'top3', task, title: task.title, categoryId: task.cat || null, minutes: task.estimateMinutes ?? null }
      break
    }
  }

  // 2 — the block running right now
  if (!pick) {
    const running = timetable.find((b) => {
      const start = minutesOfDay(b.time)
      const end = start + (b.duration || 60)
      return nowMinutes >= start && nowMinutes < end && !doneSet.has(b.id)
    })
    if (running) {
      pick = {
        kind: 'current-block',
        block: running,
        title: running.title,
        categoryId: running.cat || null,
        minutes: Math.max(5, (running.duration || 60) - (nowMinutes - minutesOfDay(running.time))),
      }
    }
  }

  // 3 — overdue
  if (!pick && overdue.length) {
    const task = [...overdue].sort((a, b) => {
      const ap = PRIORITY_ORDER[a.priority] ?? 1
      const bp = PRIORITY_ORDER[b.priority] ?? 1
      if (ap !== bp) return ap - bp
      return (a.date || '').localeCompare(b.date || '')
    })[0]
    pick = { kind: 'overdue', task, title: task.title, categoryId: task.cat || null, minutes: task.estimateMinutes ?? null }
  }

  // 4 — highest priority open task today
  if (!pick && openToday.length) {
    const task = [...openToday].sort((a, b) => {
      const ap = PRIORITY_ORDER[a.priority] ?? 1
      const bp = PRIORITY_ORDER[b.priority] ?? 1
      if (ap !== bp) return ap - bp
      return (a.time || '99:99').localeCompare(b.time || '99:99')
    })[0]
    pick = { kind: 'priority', task, title: task.title, categoryId: task.cat || null, minutes: task.estimateMinutes ?? null }
  }

  // 5 — nearest scheduled block that is still ahead
  if (!pick) {
    const upcomingBlock = timetable
      .filter((b) => minutesOfDay(b.time) > nowMinutes && !doneSet.has(b.id))
      .sort((a, b) => minutesOfDay(a.time) - minutesOfDay(b.time))[0]
    if (upcomingBlock) {
      pick = {
        kind: 'scheduled',
        block: upcomingBlock,
        title: upcomingBlock.title,
        categoryId: upcomingBlock.cat || null,
        minutes: upcomingBlock.duration || 60,
        startsAt: upcomingBlock.time,
      }
    }
  }

  if (!pick) {
    return {
      kind: 'clear',
      task: null,
      block: null,
      title: 'Everything planned is done',
      categoryId: null,
      minutes: null,
      reason: REASONS.clear,
      protectedLabel: null,
    }
  }

  const protection = protectionAt(nowMinutes, protectedBlocks, todayKey)
  return {
    ...pick,
    reason: REASONS[pick.kind],
    startsAt: pick.startsAt || (pick.block ? pick.block.time : pick.task?.time || null),
    protectedLabel: protection ? protection.label : null,
  }
}
