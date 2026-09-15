/* -------------------------------------------------------------------------
   "RECOVER MY DAY" — deterministic schedule recovery
   -------------------------------------------------------------------------
   Looks at the blocks you have already missed today, works out how much
   genuinely free time is left (day end − protected windows − the blocks that
   are still ahead), then proposes a realistic compressed schedule.

   Nothing is applied automatically: the UI shows the proposal first and the
   user chooses "Apply Recovery Plan" or "Cancel". Applying only rewrites the
   times of the *missed* blocks (their titles, categories and ids survive) and
   stores a snapshot so it can be undone.
   ------------------------------------------------------------------------- */

import { formatDuration, minutesOfDay, toHHMM } from './dates.js'
import { appliesOn, normalizeBlock, unprotectedMinutes } from './protected.js'

export const MIN_BLOCK_MINUTES = 20
export const DEFAULT_BUFFER_MINUTES = 5

/**
 * Intervals a proposal must avoid: blocks still ahead today + protected windows.
 * @returns {Array<[number, number]>} sorted [start, end] minutes
 */
export function buildBlockers(upcoming = [], protectedBlocks = [], todayKey = null) {
  const intervals = upcoming.map((b) => /** @type {[number, number]} */ ([b.start, b.start + b.duration]))
  for (const raw of protectedBlocks) {
    const block = normalizeBlock(raw)
    if (todayKey && !appliesOn(block, todayKey)) continue
    if (block.wraps) {
      intervals.push([block.start, 1440], [0, block.end])
    } else {
      intervals.push([block.start, block.end])
    }
  }
  return intervals.sort((a, b) => a[0] - b[0])
}

/**
 * First start time at/after `cursor` where `duration` minutes fit without
 * touching a blocker and without passing the end of the day.
 * @returns {number|null} start minute or null when nothing fits
 */
export function findFreeSlot(cursor, duration, blockers = [], dayEndMinutes = 1440) {
  let start = Math.max(0, cursor)
  for (let guard = 0; guard < 64; guard++) {
    if (start + duration > dayEndMinutes) return null
    const clash = blockers.find(([s, e]) => start < e && start + duration > s)
    if (!clash) return start
    start = clash[1]
  }
  return null
}

/**
 * @param {Object} input
 * @param {Array<any>} input.timetable
 * @param {string[]} input.ttDone
 * @param {number} input.nowMinutes
 * @param {number} input.dayEndMinutes
 * @param {Array<any>} [input.protectedBlocks]
 * @param {string} [input.todayKey]
 * @param {number} [input.minBlockMinutes]
 * @param {number} [input.bufferMinutes]
 */
export function planRecovery(input) {
  const {
    timetable = [],
    ttDone = [],
    nowMinutes,
    dayEndMinutes = 23 * 60 + 30,
    protectedBlocks = [],
    todayKey = null,
    minBlockMinutes = MIN_BLOCK_MINUTES,
    bufferMinutes = DEFAULT_BUFFER_MINUTES,
  } = input

  const doneSet = new Set(ttDone)
  const sorted = [...timetable].sort((a, b) => minutesOfDay(a.time) - minutesOfDay(b.time))

  const missed = []
  const upcoming = []
  let running = null
  for (const item of sorted) {
    const start = minutesOfDay(item.time)
    const duration = item.duration || 60
    const end = start + duration
    const done = doneSet.has(item.id)
    if (start <= nowMinutes && nowMinutes < end && !done) {
      running = item
      continue
    }
    if (end <= nowMinutes) {
      if (!done) missed.push({ ...item, start, duration })
    } else if (start > nowMinutes) {
      if (!done) upcoming.push({ ...item, start, duration })
    }
  }

  const upcomingMinutes = upcoming.reduce((sum, b) => sum + b.duration, 0)
  // free = remaining wall-clock time − protected windows − blocks still to come
  const wallClock = Math.max(0, dayEndMinutes - nowMinutes)
  const unprotected = unprotectedMinutes(nowMinutes, dayEndMinutes, protectedBlocks, todayKey)
  const freeMinutes = Math.max(0, unprotected - upcomingMinutes)

  const missedMinutes = missed.reduce((sum, b) => sum + b.duration, 0)
  const proposals = []
  const skipped = []
  const notes = []

  // Occupied intervals (upcoming blocks + protected windows) that a proposal
  // must never overlap. Wrapping windows are split into two intervals.
  const blockers = buildBlockers(upcoming, protectedBlocks, todayKey)

  if (missed.length && freeMinutes > 0) {
    const available = freeMinutes
    let cursor = nowMinutes + bufferMinutes
    // Never shrink below minBlockMinutes unless the block itself was shorter.
    for (const block of missed) {
      const proportional = Math.round((available / Math.max(1, missedMinutes)) * block.duration)
      const target = Math.max(Math.min(minBlockMinutes, block.duration), Math.min(block.duration, proportional))
      const duration = Math.max(5, target)
      const slot = findFreeSlot(cursor, duration, blockers, dayEndMinutes)
      if (slot === null || dayEndMinutes - slot < Math.min(minBlockMinutes, block.duration)) {
        skipped.push({ id: block.id, title: block.title, reason: 'No realistic time left today' })
        continue
      }
      proposals.push({
        id: block.id,
        title: block.title,
        cat: block.cat,
        from: { time: toHHMM(block.start), duration: block.duration },
        to: { time: toHHMM(slot), duration },
        compressed: duration < block.duration,
      })
      cursor = slot + duration + bufferMinutes
    }
  } else if (missed.length) {
    for (const block of missed) {
      skipped.push({ id: block.id, title: block.title, reason: 'No free time left today' })
    }
  }

  const proposedMinutes = proposals.reduce((sum, p) => sum + p.to.duration, 0)
  const savedMinutes = proposals.reduce((sum, p) => sum + p.to.duration, 0)
  const compressedCount = proposals.filter((p) => p.compressed).length

  if (proposals.length) {
    notes.push(`${proposals.length} missed block${proposals.length > 1 ? 's' : ''} rescheduled into ${formatDuration(proposedMinutes)} of free time.`)
  }
  if (compressedCount) notes.push(`${compressedCount} block${compressedCount > 1 ? 's were' : ' was'} compressed to stay realistic.`)
  if (upcomingMinutes) notes.push(`${formatDuration(upcomingMinutes)} of upcoming schedule is left untouched.`)
  if (protectedBlocks.length) notes.push('Protected windows are skipped on purpose.')
  if (skipped.length) notes.push(`${skipped.length} block${skipped.length > 1 ? 's' : ''} could not be rescheduled today — consider moving them to tomorrow.`)
  if (!missed.length) notes.push('Nothing has been missed so far today. 🎯')

  return {
    missed: missed.map((b) => ({ id: b.id, title: b.title, time: toHHMM(b.start), duration: b.duration, cat: b.cat })),
    running: running ? { id: running.id, title: running.title, time: running.time } : null,
    upcoming: upcoming.map((b) => ({ id: b.id, title: b.title, time: toHHMM(b.start), duration: b.duration })),
    missedMinutes,
    /** minutes genuinely available (protected + upcoming removed) */
    availableMinutes: freeMinutes,
    wallClockMinutes: wallClock,
    protectedMinutes: Math.max(0, wallClock - unprotected),
    proposals,
    skipped,
    notes,
    proposedMinutes,
    /** minutes of missed work that we could not fit */
    overflowMinutes: Math.max(0, missedMinutes - savedMinutes),
    canApply: proposals.length > 0,
  }
}

/**
 * Apply a recovery plan to the timetable (mutates the passed array items).
 * Returns a snapshot so the change can be undone.
 */
export function applyRecovery(timetable, proposals) {
  const snapshot = []
  for (const proposal of proposals) {
    const item = timetable.find((b) => b.id === proposal.id)
    if (!item) continue
    snapshot.push({ id: item.id, time: item.time, duration: item.duration })
    item.time = proposal.to.time
    item.duration = proposal.to.duration
  }
  return snapshot
}

export function undoRecovery(timetable, snapshot = []) {
  for (const entry of snapshot) {
    const item = timetable.find((b) => b.id === entry.id)
    if (!item) continue
    item.time = entry.time
    item.duration = entry.duration
  }
  return snapshot.length
}
