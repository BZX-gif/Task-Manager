/** Approval-first planning. Pure functions never mutate tasks or schedules. */
import { addDays, dateKey, minutesOfDay, toHHMM, weekdayOf } from './dates.js'
import { normalizeBlock, appliesOn } from './protected.js'
import { activeMissionId, timetableFor } from './missions.js'

export const clampTime = (n) => Math.max(0, Math.min(1440, Math.round(n)))
export const priorityOrder = { high: 0, medium: 1, low: 2 }
export const intervalOverlap = (a, b) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))

export function protectedIntervals(blocks = [], date) {
  return blocks.filter((b) => !date || appliesOn(b, date)).flatMap((raw) => {
    const b = normalizeBlock(raw)
    return (b.wraps ? [[b.start, 1440], [0, b.end]] : [[b.start, b.end]]).filter(([start,end]) => end > start).map(([start,end]) => ({ id: b.id, title: b.label, start, end, protected: true }))
  })
}

export function scheduleConflicts(items = [], protectedBlocks = [], date = null) {
  const blocks = items.filter((b) => b.status !== 'skipped' && b.status !== 'completed').map((b) => ({ ...b, start: minutesOfDay(b.time), end: minutesOfDay(b.time) + b.duration }))
  const fixed = protectedIntervals(protectedBlocks, date)
  const out = []
  for (let i = 0; i < blocks.length; i++) {
    const a = blocks[i]
    if (a.end > 1440) out.push({ a: a.id, b: null, minutes: a.end - 1440, label: 'Extends past midnight' })
    for (const b of [...blocks.slice(i + 1), ...fixed]) {
      const minutes = intervalOverlap(a, b)
      if (minutes > 0) out.push({ a: a.id, b: b.id, minutes, label: b.protected ? `Protected: ${b.title}` : `Overlaps ${b.title}` })
    }
  }
  return out
}

/** Merge occupied intervals, then subtract them from the available window. */
export function freeIntervals(start, end, blockers = []) {
  const sorted = blockers.map((b) => [Math.max(start, b.start), Math.min(end, b.end)]).filter(([a,b]) => b > a).sort((a,b) => Number(a[0])-Number(b[0]))
  const merged = []
  for (const interval of sorted) {
    const last = merged[merged.length - 1]
    if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1])
    else merged.push([...interval])
  }
  const result = []
  let cursor = start
  for (const [a,b] of merged) { if (a > cursor) result.push({ start: cursor, end: a }); cursor = Math.max(cursor,b) }
  if (cursor < end) result.push({ start: cursor, end })
  return result
}

/** A realistic proposal. Excess work is explicitly returned, never squeezed away. */
export function proposeDay({ tasks = [], start = '09:00', end = '18:00', nowMinutes = null, breakMinutes = 10, breakEvery = 90, protectedBlocks = [], fixedBlocks = [], date = null }) {
  const from = Math.max(minutesOfDay(start), nowMinutes == null ? 0 : Math.ceil(nowMinutes / 5) * 5)
  const until = Math.max(from, minutesOfDay(end))
  const blockers = [...protectedIntervals(protectedBlocks, date), ...fixedBlocks.map((b) => ({ start: minutesOfDay(b.time), end: minutesOfDay(b.time) + b.duration }))]
  const slots = freeIntervals(from, until, blockers)
  const available = slots.map((slot) => ({ ...slot }))
  const sorted = [...tasks].filter((t) => !t.done && t.status !== 'cancelled').sort((a,b) => (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1) || (a.deadline || a.date || '9999').localeCompare(b.deadline || b.date || '9999') || (a.createdAt || 0) - (b.createdAt || 0))
  const proposals = [], deferred = []
  let plannedMinutes = 0, workSinceBreak = 0, lastWorkEnd = from
  for (const task of sorted) {
    const duration = Math.max(5, Math.min(600, Number(task.estimateMinutes) || 30))
    let placed = false
    for (const slot of available) {
      if (slot.end <= slot.start) continue
      // A gap between commitments can already be the breather.
      if (breakMinutes > 0 && slot.start - lastWorkEnd >= breakMinutes) workSinceBreak = 0
      const needsBreak = breakMinutes > 0 && workSinceBreak >= breakEvery
      const breakBefore = needsBreak && slot.start + breakMinutes + duration <= slot.end ? breakMinutes : 0
      if (needsBreak && !breakBefore) continue
      const at = slot.start + breakBefore
      if (at + duration > slot.end) continue
      proposals.push({ ...task, id: task.id || null, title: task.title, time: toHHMM(at), duration, date, priority: task.priority || 'medium', estimatedMinutes: duration, include: true })
      slot.start = at + duration
      lastWorkEnd = slot.start
      plannedMinutes += duration
      workSinceBreak = needsBreak ? duration : workSinceBreak + duration
      placed = true
      break
    }
    if (!placed) deferred.push({ ...task, reason: workSinceBreak >= breakEvery && breakMinutes > 0 ? 'A break needs this space' : 'Not enough available time' })
  }
  return { proposals, deferred, plannedMinutes, availableMinutes: slots.reduce((sum,s) => sum+s.end-s.start,0), slots, from: toHHMM(from), to: toHHMM(until), overloaded: deferred.length > 0 }
}

/** Dated occurrences are the union of explicit overrides, missions and study plans. */
export function scheduleFor(state, date) {
  const override = state.schedule?.days?.[date]
  if (Array.isArray(override)) {
    const represented = new Set(override.map((b) => b.taskId).filter(Boolean))
    const timed = (state.tasks || []).filter((t) => t.date === date && t.time && !t.inbox && !represented.has(t.id) && t.status !== 'cancelled').map((t) => ({ id: `task:${t.id}`, sourceId: t.id, taskId: t.id, title: t.title, time: t.time, duration: t.estimateMinutes || 30, cat: t.cat, priority: t.priority, goalId: t.goalId, projectId: t.projectId, milestoneId: t.milestoneId, kind: 'mission', status: t.done ? 'completed' : 'planned', protected: !!t.protected, flexible: t.flexible !== false && !t.protected }))
    return [...override.map((b) => ({ ...b })), ...timed].sort((a,b) => minutesOfDay(a.time)-minutesOfDay(b.time))
  }
  const missionId = activeMissionId(state)
  const done = state.completionLog?.[date]?.ttDone || []
  // Study-plan templates are reusable on today/future dates. Past dates use
  // their frozen snapshot when one exists, so later template edits never
  // rewrite history. Fresh workspaces simply have empty templates.
  const snapshot = state.dayPlans?.[missionId]?.[date]
  const templates = Array.isArray(snapshot) && date < dateKey() ? snapshot : timetableFor(state, missionId)
  const blocks = templates.filter((b) => !b.days?.length || b.days.includes(weekdayOf(date))).map((b) => ({ ...b, sourceId: b.id, kind: b.protected ? 'protected' : 'mission', status: done.includes(b.id) ? 'completed' : 'planned', protected: b.protected === true, flexible: b.flexible !== false && !b.protected }))
  const tasks = (state.tasks || []).filter((t) => t.date === date && t.time && !t.inbox && t.status !== 'cancelled').map((t) => ({ id: `task:${t.id}`, sourceId: t.id, taskId: t.id, title: t.title, time: t.time, duration: t.estimateMinutes || 30, cat: t.cat, priority: t.priority, goalId: t.goalId, projectId: t.projectId, milestoneId: t.milestoneId, kind: 'mission', status: t.done ? 'completed' : 'planned', protected: !!t.protected, flexible: t.flexible !== false && !t.protected }))
  return [...blocks, ...tasks].sort((a,b) => minutesOfDay(a.time)-minutesOfDay(b.time))
}

export function itemDone(state, item, date) {
  if (item.status === 'completed') return true
  if (item.taskId) return !!state.tasks.find((t) => t.id === item.taskId)?.done
  if (item.kind === 'routine' && item.routineId && item.activityId) return !!state.routineHistory?.[date]?.[item.routineId]?.includes(item.activityId)
  return !!state.completionLog?.[date]?.ttDone?.includes(item.sourceId || item.id)
}

export function blockState(state, item, date, now = new Date(), today = dateKey(now)) {
  if (item.status === 'skipped') return 'skipped'
  if (itemDone(state,item,date)) return 'completed'
  if (item.status === 'delayed') return 'delayed'
  const start = minutesOfDay(item.time), end = start + item.duration
  const minute = now.getHours()*60 + now.getMinutes()
  if (date < today || (date === today && end <= minute)) return 'missed'
  if (date === today && start <= minute && minute < end) return 'active'
  return 'upcoming'
}

/** Extend one block and shift only flexible future blocks; fixed/protected stay put. */
export function extendSchedule(items, id, extraMinutes, date, protectedBlocks = []) {
  const target = items.find((b) => b.id === id)
  if (!target || extraMinutes <= 0) return { items, moved: [], conflicts: [] }
  const next = items.map((b) => ({ ...b }))
  const edited = next.find((b) => b.id === id)
  edited.duration += extraMinutes
  let edge = minutesOfDay(edited.time) + edited.duration
  const moved = []
  const fixed = [...next.filter((b) => b.id !== id && (!b.flexible || b.protected)).map((b) => ({ start: minutesOfDay(b.time), end: minutesOfDay(b.time)+b.duration })), ...protectedIntervals(protectedBlocks,date)]
  for (const b of next.filter((b) => b.id !== id && b.flexible && !b.protected && minutesOfDay(b.time) >= minutesOfDay(target.time)).sort((a,b) => minutesOfDay(a.time)-minutesOfDay(b.time))) {
    const old = minutesOfDay(b.time)
    if (old >= edge) break
    let start = edge
    for (let i=0; i<64; i++) {
      const clash = fixed.find((f) => start < f.end && start+b.duration > f.start)
      if (!clash) break
      start = clash.end
    }
    b.time = toHHMM(start); edge = start+b.duration
    moved.push({ id: b.id, from: toHHMM(old), to: b.time })
  }
  return { items: next, moved, conflicts: scheduleConflicts(next,protectedBlocks,date) }
}

export function recoveryProposal(state, date, now = new Date()) {
  const all = scheduleFor(state,date)
  const remaining = all.filter((b) => !itemDone(state,b,date) && b.status !== 'skipped' && b.kind !== 'protected' && b.kind !== 'routine' && !b.protected && blockState(state,b,date,now,date) !== 'active')
  const fixedBlocks = all.filter((b) => b.protected || !b.flexible || b.kind === 'protected' || b.kind === 'routine' || itemDone(state,b,date) || blockState(state,b,date,now,date) === 'active')
  const unscheduled = (state.tasks || []).filter((t) => !t.done && !t.inbox && t.status !== 'cancelled' && ((t.date === date && !t.time) || (t.date && t.date < date))).map((t) => ({ ...t, duration: t.estimateMinutes || 30 }))
  const plan = proposeDay({ tasks: [...remaining.map((b) => ({ ...b, estimateMinutes: b.duration })), ...unscheduled], start: toHHMM(Math.ceil((now.getHours()*60+now.getMinutes())/5)*5), end: state.settings.dayEnd, breakMinutes: state.settings.focus.breakMinutes, breakEvery: 90, fixedBlocks, protectedBlocks: state.settings.protectedTime, date })
  return { ...plan, remaining, fixedBlocks, missed: all.filter((b) => blockState(state,b,date,now,date) === 'missed'), original: all }
}

export function postponeDate(date, today) { return addDays(date && date < today ? today : date || today, 1) }
