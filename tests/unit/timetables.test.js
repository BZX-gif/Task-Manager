import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyState, makeContext, migrateState } from '../../src/client/lib/state.js'
import {
  activeMissionId,
  activeTimetable,
  timetableFor,
  timetableSlot,
} from '../../src/client/lib/missions.js'
import { computeDueReminders } from '../../src/client/lib/reminders.js'
import { protectedConflicts } from '../../src/client/lib/protected.js'
import { dayStats } from '../../src/client/lib/daystats.js'
import { planRecovery } from '../../src/client/lib/recovery.js'
import { buildAiContext } from '../../src/client/lib/ai-context.js'

const TODAY = '2026-09-27'
const NOON = new Date(2026, 8, 27, 12, 0, 0)

function ctx() {
  let n = 0
  return makeContext({ now: 1, id: () => `id-${n++}` })
}

test('v4 → v5 preserves the legacy timetable as the UPSC mission schedule', () => {
  const { state, applied } = migrateState(
    { version: 4, timetable: [{ id: 'legacy-1', time: '09:00', title: 'Legacy block', duration: 60, cat: 'upsc' }] },
    ctx(),
  )
  assert.equal(state.version, 5)
  assert.ok(applied.includes('migrateStateV4ToV5'))
  assert.equal(state.timetable, undefined, 'the flat v4 timetable is gone')
  assert.equal(state.timetables.upsc_cse_2028[0].id, 'legacy-1', 'legacy block ids survive the move')
  assert.equal(state.timetables.upsc_cse_2028[0].title, 'Legacy block')
  assert.ok(state.timetables.ssc_cgl_2027.length > 0, 'SSC gets its own seeded schedule')
  assert.ok(state.timetables.ras_2028.length > 0, 'RAS gets its own seeded schedule')
  assert.equal(state.timetables.ssc_cgl_2027.some((b) => b.id === 'legacy-1'), false, 'the legacy block lives in the UPSC timetable only')
  const seededIds = [...state.timetables.ssc_cgl_2027, ...state.timetables.ras_2028].map((b) => b.id)
  assert.equal(new Set(seededIds).size, seededIds.length, 'seeded blocks never share ids across missions')
})

test('missions keep independent timetables and edits follow the active one', () => {
  const state = emptyState(ctx())
  assert.notEqual(timetableFor(state, 'ssc_cgl_2027'), timetableFor(state, 'ras_2028'), 'each mission owns its own array')
  assert.notEqual(timetableFor(state, 'ras_2028'), timetableFor(state, 'upsc_cse_2028'))

  // mission-scoped editing: the view writes through timetableSlot()
  timetableSlot(state).push({ id: 's1', time: '10:00', title: 'SSC maths drill', duration: 30 })
  assert.equal(timetableFor(state, 'ssc_cgl_2027').some((b) => b.id === 's1'), true)
  assert.equal(timetableFor(state, 'ras_2028').some((b) => b.id === 's1'), false, 'edits never leak into another mission')

  state.missions.activeMissionId = 'ras_2028'
  assert.equal(activeMissionId(state), 'ras_2028')
  assert.equal(activeTimetable(state), timetableFor(state, 'ras_2028'), 'the active filter follows mission switching')
  assert.equal(activeTimetable(state).some((b) => b.id === 's1'), false, 'the RAS view never shows SSC blocks')

  timetableSlot(state).push({ id: 'r1', time: '11:00', title: 'RAS polity', duration: 30 })
  assert.equal(timetableFor(state, 'ras_2028').some((b) => b.id === 'r1'), true)
  assert.equal(timetableFor(state, 'ssc_cgl_2027').some((b) => b.id === 'r1'), false, 'each mission keeps its own schedule')
})

test('reminders and protected-time conflicts follow the active mission', () => {
  const state = emptyState(ctx())
  // both missions have a block about to start — only the active one may fire
  state.timetables.ssc_cgl_2027 = [{ id: 'soon-ssc', time: '10:05', title: 'SSC slot', duration: 30, cat: 'ssc' }]
  state.timetables.ras_2028 = [{ id: 'soon-ras', time: '10:08', title: 'RAS slot', duration: 30, cat: null }]
  state.timetables.upsc_cse_2028 = []
  const now = new Date(2026, 8, 27, 10, 0, 0)

  const due = computeDueReminders({ state, todayKey: TODAY, nowMinutes: 10 * 60, now, maxPerRun: 5 })
  assert.equal(due.some((d) => d.blockId === 'soon-ssc'), true, "the active mission's block is announced")
  assert.equal(due.some((d) => d.blockId === 'soon-ras'), false, 'other missions never fire reminders')

  // conflicts are computed from the active mission's timetable only
  state.timetables.ras_2028[0].time = '12:05' // outside the protected window below
  const sleep = [{ id: 'sleep', label: 'Sleep', start: '10:00', end: '11:00', days: [] }]
  assert.equal(protectedConflicts(activeTimetable(state), sleep, TODAY).length, 1, 'the active block clashes with protected time')

  state.missions.activeMissionId = 'ras_2028'
  assert.equal(protectedConflicts(activeTimetable(state), sleep, TODAY).length, 0, 'conflicts come from the new mission only')
  const dueAfter = computeDueReminders({ state, todayKey: TODAY, nowMinutes: 10 * 60, now, maxPerRun: 5 })
  assert.equal(dueAfter.some((d) => d.blockId === 'soon-ssc'), false, 'switching missions silences the old timetable')
})

test('dashboard stats, recovery and AI context read the active mission timetable', () => {
  const state = emptyState(ctx())
  state.timetables.ssc_cgl_2027 = [
    { id: 's1', time: '09:00', title: 'SSC maths', duration: 60, cat: 'ssc' },
    { id: 's2', time: '10:00', title: 'SSC reasoning', duration: 60, cat: 'ssc' },
  ]
  state.timetables.ras_2028 = [{ id: 'r1', time: '08:00', title: 'RAS polity', duration: 60, cat: null }]
  state.timetables.upsc_cse_2028 = []

  // dashboard schedule + adherence + score follow the active mission
  let stats = dayStats(state, TODAY, { todayKey: TODAY, now: NOON })
  assert.equal(stats.blocksTotal, 2, 'the dashboard counts SSC blocks')
  assert.equal(stats.plannedMinutes, 120)
  assert.equal(stats.blocksElapsed, 2)

  state.missions.activeMissionId = 'ras_2028'
  stats = dayStats(state, TODAY, { todayKey: TODAY, now: NOON })
  assert.equal(stats.blocksTotal, 1, 'switching mission switches the schedule the dashboard counts')
  assert.equal(stats.plannedMinutes, 60)

  // "Recover My Day" only reshuffles the active mission's timetable
  const plan = planRecovery({
    timetable: activeTimetable(state),
    ttDone: [],
    nowMinutes: 12 * 60,
    dayEndMinutes: 23 * 60 + 30,
  })
  assert.deepEqual(plan.missed.map((b) => b.id), ['r1'], 'recovery sees only the RAS timetable')
  assert.equal(plan.upcoming.length, 0)

  // the assistant's context only describes the active mission's schedule
  const text = buildAiContext(state, { todayKey: TODAY, now: NOON })
  assert.match(text, /RAS polity/)
  assert.doesNotMatch(text, /SSC maths/)
  assert.match(text, /ACTIVE MISSION: RAS 2028/)
})
