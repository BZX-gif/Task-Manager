/* -------------------------------------------------------------------------
   TRASH — deleting a mission is reversible for 30 days
   -------------------------------------------------------------------------
   A premium workspace should never lose work to a mis-tap. Deleting a mission
   now archives it together with everything that pointed at it: the scheduled
   blocks it owned, its place in a day's Top 3, and any recurring-series links
   that had to be detached from its siblings.

   Restoring puts all of that back. Focus sessions and completion history are
   never modified — the time you actually spent stays true either way.

   All functions mutate the state object they are given (the store wraps them
   in `commit`) and return a small, testable result object.
   ------------------------------------------------------------------------- */

import { isValidKey } from './dates.js'

export const TRASH_TTL_DAYS = 30
export const TRASH_LIMIT = 100
export const TRASH_TTL_MS = TRASH_TTL_DAYS * 86_400_000

const clone = (value) => JSON.parse(JSON.stringify(value))

/** Validate an imported/saved trash bucket. */
export function normalizeTrash(raw, ctx = {}) {
  const uid = typeof ctx.uid === 'function' ? ctx.uid : () => Math.random().toString(36).slice(2, 10)
  const now = Number.isFinite(ctx.now) ? ctx.now : Date.now()
  if (!Array.isArray(raw)) return []
  return raw
    .filter((record) => record && typeof record === 'object' && record.task && typeof record.task === 'object' && record.task.title)
    .map((record) => ({
      id: String(record.id || uid()),
      taskId: String(record.taskId || record.task.id || ''),
      task: {
        ...record.task,
        id: String(record.task.id || record.taskId || uid()),
        title: String(record.task.title).slice(0, 200),
      },
      deletedAt: Number.isFinite(record.deletedAt) ? record.deletedAt : now,
      blocks: Array.isArray(record.blocks)
        ? record.blocks
            .filter((entry) => entry && isValidKey(entry.date) && entry.block && typeof entry.block === 'object')
            .map((entry) => ({ date: entry.date, index: Number.isFinite(entry.index) ? entry.index : 0, block: clone(entry.block) }))
        : [],
      top3: Array.isArray(record.top3)
        ? record.top3.filter((entry) => entry && isValidKey(entry.date)).map((entry) => ({ date: entry.date, index: Number.isFinite(entry.index) ? entry.index : 0 }))
        : [],
      detached: Array.isArray(record.detached) ? record.detached.filter((entry) => entry && entry.id).map((entry) => ({ ...entry, id: String(entry.id) })) : [],
      activeFocus: record.activeFocus && typeof record.activeFocus === 'object' ? { ...record.activeFocus } : null,
      expiringAt: Number.isFinite(record.expiringAt) ? record.expiringAt : (Number.isFinite(record.deletedAt) ? record.deletedAt : now) + TRASH_TTL_MS,
    }))
    .slice(-TRASH_LIMIT)
}

/** Move a mission into the trash. Returns `{ ok, record, reason }`. */
export function archiveMission(state, taskId, { now = Date.now(), id = null } = {}) {
  if (!state) return { ok: false, record: null, reason: 'No workspace.' }
  const task = (state.tasks || []).find((item) => item.id === taskId)
  if (!task) return { ok: false, record: null, reason: 'Mission not found.' }
  if (task.status === 'cancelled') return { ok: false, record: null, reason: 'This mission was already skipped.' }

  if (!Array.isArray(state.trash)) state.trash = []

  const blocks = []
  for (const [date, dayBlocks] of Object.entries(state.schedule?.days || {})) {
    if (!Array.isArray(dayBlocks)) continue
    dayBlocks.forEach((block, index) => {
      if (block?.taskId === taskId) blocks.push({ date, index, block: clone(block) })
    })
  }

  const top3 = []
  for (const [date, ids] of Object.entries(state.top3 || {})) {
    const index = Array.isArray(ids) ? ids.indexOf(taskId) : -1
    if (index >= 0) top3.push({ date, index })
  }

  const detached = []
  if (task.seriesId && task.seriesId === task.id) {
    for (const sibling of state.tasks || []) {
      if (sibling.id === task.id || sibling.seriesId !== task.id) continue
      detached.push({
        id: sibling.id,
        recurrence: sibling.recurrence ? clone(sibling.recurrence) : null,
        seriesId: sibling.seriesId || null,
        occurrenceDate: sibling.occurrenceDate || null,
      })
      sibling.recurrence = null
      sibling.seriesId = null
      sibling.occurrenceDate = null
    }
  }

  const activeFocus = state.focus?.active?.taskId === taskId
    ? { taskId: state.focus.active.taskId, taskTitle: state.focus.active.taskTitle || task.title }
    : null

  const record = {
    id: String(id || `trash_${taskId}_${now.toString(36)}`),
    taskId: task.id,
    task: clone(task),
    deletedAt: now,
    expiringAt: now + TRASH_TTL_MS,
    blocks,
    top3,
    detached,
    activeFocus,
  }

  state.tasks = (state.tasks || []).filter((item) => item.id !== taskId)
  for (const date of Object.keys(state.schedule?.days || {})) {
    state.schedule.days[date] = state.schedule.days[date].filter((block) => block?.taskId !== taskId)
  }
  for (const date of Object.keys(state.top3 || {})) {
    state.top3[date] = state.top3[date].filter((entry) => entry !== taskId)
    if (!state.top3[date].length) delete state.top3[date]
  }
  if (activeFocus && state.focus?.active) {
    state.focus.active.taskId = null
    state.focus.active.taskTitle = null
  }

  state.trash.push(record)
  if (state.trash.length > TRASH_LIMIT) state.trash = state.trash.slice(-TRASH_LIMIT)
  return { ok: true, record, reason: '' }
}

/** Put a trashed mission back, including its blocks and priority slots. */
export function restoreMission(state, recordId) {
  if (!state || !Array.isArray(state.trash)) return { ok: false, task: null, reason: 'Nothing to restore.' }
  const index = state.trash.findIndex((record) => record.id === recordId)
  if (index < 0) return { ok: false, task: null, reason: 'That mission is no longer in the trash.' }
  const record = state.trash[index]
  if ((state.tasks || []).some((task) => task.id === record.taskId)) {
    state.trash.splice(index, 1)
    return { ok: false, task: null, reason: 'A mission with this id already exists.' }
  }

  const task = clone(record.task)
  state.tasks.push(task)

  for (const entry of record.blocks || []) {
    const day = state.schedule?.days?.[entry.date]
    if (!Array.isArray(day)) continue
    if (day.some((block) => block.id === entry.block.id)) continue
    const at = Math.max(0, Math.min(day.length, entry.index))
    day.splice(at, 0, clone(entry.block))
  }

  for (const entry of record.top3 || []) {
    const ids = state.top3?.[entry.date] || (state.top3[entry.date] = [])
    if (ids.includes(record.taskId) || ids.length >= 3) continue
    ids.splice(Math.max(0, Math.min(ids.length, entry.index)), 0, record.taskId)
  }

  for (const detached of record.detached || []) {
    const sibling = state.tasks.find((item) => item.id === detached.id)
    if (!sibling) continue
    sibling.recurrence = detached.recurrence
    sibling.seriesId = detached.seriesId
    sibling.occurrenceDate = detached.occurrenceDate
  }

  if (record.activeFocus && state.focus?.active && !state.focus.active.taskId) {
    state.focus.active.taskId = record.activeFocus.taskId
    state.focus.active.taskTitle = record.activeFocus.taskTitle || task.title
  }

  state.trash.splice(index, 1)
  return { ok: true, task, reason: '' }
}

/** Remove records older than the retention window. Returns how many went. */
export function purgeTrash(state, { now = Date.now(), ttlDays = TRASH_TTL_DAYS } = {}) {
  if (!state || !Array.isArray(state.trash)) return 0
  const cutoff = now - ttlDays * 86_400_000
  const before = state.trash.length
  state.trash = state.trash.filter((record) => (Number.isFinite(record.deletedAt) ? record.deletedAt : now) > cutoff)
  return before - state.trash.length
}

export function emptyTrash(state) {
  if (!state) return 0
  const count = (state.trash || []).length
  state.trash = []
  return count
}

export function trashSummary(state, { now = Date.now() } = {}) {
  const records = Array.isArray(state?.trash) ? state.trash : []
  const expiring = records.filter((record) => (record.deletedAt || now) + TRASH_TTL_MS - now <= 3 * 86_400_000)
  return {
    count: records.length,
    expiringSoon: expiring.length,
    oldest: records.reduce((oldest, record) => (!oldest || record.deletedAt < oldest ? record.deletedAt : oldest), null),
    records: [...records].sort((a, b) => b.deletedAt - a.deletedAt),
  }
}

/** Human explanation of the retention window, shared by Settings and toasts. */
export function retentionLabel() {
  return `${TRASH_TTL_DAYS} days`
}
