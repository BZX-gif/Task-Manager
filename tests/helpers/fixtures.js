/** Shared builders for the unit tests — mirrors the shape produced by lib/state.js */
import { emptyState, makeContext, normalizeState } from '../../src/client/lib/state.js'

export function makeCtx({ now = Date.UTC(2026, 8, 15, 12) } = {}) {
  let n = 0
  return makeContext({ now, id: () => `id${++n}` })
}

export function baseState(overrides = {}) {
  const ctx = makeCtx()
  const state = emptyState(ctx)
  state.timetable = []
  return normalizeState({ ...state, ...overrides }, ctx)
}

/** Build 4 one-hour blocks from 09:00 */
export function blocks() {
  return [
    { id: 'b1', time: '09:00', title: 'Block 1', duration: 60, cat: 'upsc' },
    { id: 'b2', time: '10:00', title: 'Block 2', duration: 60, cat: 'upsc' },
    { id: 'b3', time: '11:00', title: 'Block 3', duration: 60, cat: 'ssc' },
    { id: 'b4', time: '12:00', title: 'Block 4', duration: 60, cat: 'ssc' },
  ]
}

export function task(id, overrides = {}) {
  return {
    id,
    title: `Task ${id}`,
    date: '2026-09-15',
    priority: 'medium',
    cat: null,
    notes: '',
    estimateMinutes: 30,
    done: false,
    inbox: false,
    createdAt: 1,
    completedAt: null,
    recurrence: null,
    seriesId: null,
    occurrenceDate: null,
    ...overrides,
  }
}

export function focusSession(id, date, minutes, overrides = {}) {
  return {
    id,
    taskId: null,
    categoryId: null,
    mode: 'focus',
    plannedMinutes: 25,
    focusedSeconds: minutes * 60,
    startedAt: Date.parse(`${date}T09:00:00Z`),
    endedAt: Date.parse(`${date}T10:00:00Z`),
    status: 'completed',
    date,
    ...overrides,
  }
}

export const TODAY = '2026-09-15'
/** a fixed "now" that matches TODAY (local noon) */
export const NOW = new Date(2026, 8, 15, 11, 30, 0)
