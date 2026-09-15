/* -------------------------------------------------------------------------
   TODAY'S TOP 3
   -------------------------------------------------------------------------
   Top 3 stores TASK IDS per day (`state.top3["YYYY-MM-DD"] = [id, id, id]`),
   never copies of task records, so editing a task keeps the priority in sync
   and deleting a task simply drops the stale id.
   ------------------------------------------------------------------------- */

import { PRIORITY_ORDER } from './defaults.js'

export const TOP3_LIMIT = 3

/** A task can be a priority for a day when it is dated that day or sits in the inbox. */
export function isEligible(task, dateKey) {
  if (!task || task.done === undefined) return false
  return task.date === dateKey || !task.date || task.inbox === true
}

/** Valid, de-duplicated ids for a day (stale ids are pruned silently). */
export function getTop3Ids(state, dateKey) {
  const raw = state?.top3?.[dateKey]
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const out = []
  for (const id of raw) {
    if (seen.has(id)) continue
    const task = state.tasks?.find((t) => t.id === id)
    if (!task) continue
    seen.add(id)
    out.push(id)
    if (out.length >= TOP3_LIMIT) break
  }
  return out
}

export function setTop3Ids(state, dateKey, ids) {
  if (!state.top3) state.top3 = {}
  const clean = []
  for (const id of ids || []) {
    if (!id || clean.includes(id)) continue
    if (!state.tasks.some((t) => t.id === id)) continue
    clean.push(id)
    if (clean.length >= TOP3_LIMIT) break
  }
  if (clean.length) state.top3[dateKey] = clean
  else delete state.top3[dateKey]
  return clean
}

/**
 * @returns {{ok:boolean, reason?:string, ids:string[]}}
 */
export function addToTop3(state, dateKey, taskId) {
  const task = state.tasks.find((t) => t.id === taskId)
  if (!task) return { ok: false, reason: 'Task not found.', ids: getTop3Ids(state, dateKey) }
  const ids = getTop3Ids(state, dateKey)
  if (ids.includes(taskId)) return { ok: false, reason: 'Already in your Top 3.', ids }
  if (ids.length >= TOP3_LIMIT) return { ok: false, reason: 'Top 3 is full — remove one first.', ids }
  // promoting an undated/inbox task pins it to the day
  if (!task.date || task.inbox) {
    task.date = dateKey
    task.inbox = false
  }
  ids.push(taskId)
  return { ok: true, ids: setTop3Ids(state, dateKey, ids) }
}

export function removeFromTop3(state, dateKey, taskId) {
  const ids = getTop3Ids(state, dateKey).filter((id) => id !== taskId)
  return { ok: true, ids: setTop3Ids(state, dateKey, ids) }
}

export function isTop3(state, dateKey, taskId) {
  return getTop3Ids(state, dateKey).includes(taskId)
}

/** @returns {{total:number, done:number, items:Array<{task:any,index:number}>}} */
export function top3Stats(state, dateKey) {
  const items = getTop3Ids(state, dateKey)
    .map((id, index) => ({ task: state.tasks.find((t) => t.id === id), index }))
    .filter((entry) => !!entry.task)
  return {
    total: items.length,
    done: items.filter((entry) => entry.task.done).length,
    items,
  }
}

/**
 * Ranked suggestions for filling the Top 3 (uses real signals, no randomness):
 * overdue first, then high priority, then the biggest estimated block.
 */
export function top3Candidates(state, dateKey, { limit = 6, overdueIds = [] } = {}) {
  const chosen = new Set(getTop3Ids(state, dateKey))
  const overdue = new Set(overdueIds)
  return (state.tasks || [])
    .filter((t) => !t.done && !chosen.has(t.id) && (isEligible(t, dateKey) || overdue.has(t.id)))
    .sort((a, b) => {
      const ao = overdue.has(a.id) ? 0 : 1
      const bo = overdue.has(b.id) ? 0 : 1
      if (ao !== bo) return ao - bo
      const ap = PRIORITY_ORDER[a.priority] ?? 1
      const bp = PRIORITY_ORDER[b.priority] ?? 1
      if (ap !== bp) return ap - bp
      const ae = a.estimateMinutes ?? 30
      const be = b.estimateMinutes ?? 30
      if (ae !== be) return be - ae
      return (a.createdAt || 0) - (b.createdAt || 0)
    })
    .slice(0, limit)
}

/** Remove ids of tasks that no longer exist (housekeeping after deletes). */
export function pruneTop3(state) {
  let removed = 0
  const today = Object.keys(state.top3 || {})
  for (const dateKey of today) {
    const ids = state.top3[dateKey]
    const filtered = ids.filter((id) => state.tasks.some((t) => t.id === id))
    removed += ids.length - filtered.length
    if (filtered.length) state.top3[dateKey] = filtered
    else delete state.top3[dateKey]
  }
  return removed
}
