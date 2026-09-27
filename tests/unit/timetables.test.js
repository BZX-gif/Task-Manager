import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyState, makeContext, migrateState } from '../../src/client/lib/state.js'
import { DEFAULT_TIMETABLE } from '../../src/client/lib/defaults.js'
import {
  activeMissionId,
  activeTimetable,
  timetableFor,
  timetableSlot,
} from '../../src/client/lib/missions.js'
import { computeDueReminders } from '../../src/client/lib/reminders.js'
import { protectedConflicts } from '../../src/client/lib/protected.js'
import { dayPlanFor, dayStats, materializeDayPlan } from '../../src/client/lib/daystats.js'
import { applyRecovery, planRecovery } from '../../src/client/lib/recovery.js'
import { buildAiContext, nextFreeSlot } from '../../src/client/lib/ai-context.js'

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

/* ------------------------------------------------------- starter content */

test('the SSC starter timetable is genuinely SSC CGL-oriented', () => {
  const state = emptyState(ctx())
  const blocks = state.timetables.ssc_cgl_2027
  const titles = blocks.map((b) => b.title).join('\n')
  assert.match(titles, /Quantitative Aptitude/i)
  assert.match(titles, /Calculation practice/i)
  assert.match(titles, /Reasoning/i)
  assert.match(titles, /English/i)
  assert.match(titles, /Static GK/i)
  assert.match(titles, /PYQ/i)
  assert.match(titles, /MOCK|SECTIONAL/i)
  assert.match(titles, /REVISION/i)
  assert.match(titles, /Current affairs/i)
  assert.match(titles, /breakfast/i, 'normal meals stay in the day')
  assert.match(titles, /Lunch/i)
  assert.match(titles, /Dinner/i)
  assert.match(titles, /SLEEP/i, 'rest and recovery stay in the day')
  assert.doesNotMatch(titles, /CLASS 1|SSC batch|UPSC/, 'no generic or UPSC-era class blocks')
  const minutes = blocks.map((b) => Number(b.time.slice(0, 2)) * 60 + Number(b.time.slice(3)))
  for (let i = 1; i < minutes.length; i++) {
    assert.ok(minutes[i] > minutes[i - 1], 'start times stay strictly ordered')
  }
  for (const b of blocks) assert.ok(b.duration >= 5 && b.duration <= 600, 'durations stay realistic and editable')
})

test('the RAS starter timetable is genuinely RAS-oriented', () => {
  const state = emptyState(ctx())
  const blocks = state.timetables.ras_2028
  const titles = blocks.map((b) => b.title).join('\n')
  assert.match(titles, /RAJASTHAN GK/i)
  assert.match(titles, /RAJASTHAN GEOGRAPHY/i)
  assert.match(titles, /Rajasthan polity|Rajasthan current affairs/i)
  assert.match(titles, /Answer writing/i)
  assert.match(titles, /RPSC/i)
  assert.ok((titles.match(/Rajasthan/gi) || []).length >= 3, 'Rajasthan preparation runs through the day')
  assert.doesNotMatch(titles, /CLASS 1 \(2h\)|SSC batch|Current affairs consolidation/, 'not the old mixed schedule')
  assert.notDeepEqual(
    blocks.map((b) => b.title),
    DEFAULT_TIMETABLE.map((b) => b.title),
    'RAS content is its own schedule, not the UPSC day copied over',
  )
})

test('the UPSC timetable keeps the pre-v5 schedule content and timings', () => {
  const state = emptyState(ctx())
  const upsc = state.timetables.upsc_cse_2028
  assert.deepEqual(upsc.map((b) => b.title), DEFAULT_TIMETABLE.map((b) => b.title), 'UPSC content is the historical schedule verbatim')
  assert.deepEqual(upsc.map((b) => b.time), DEFAULT_TIMETABLE.map((b) => b.time), 'UPSC timings are preserved exactly')
  assert.deepEqual(upsc.map((b) => b.duration), DEFAULT_TIMETABLE.map((b) => b.duration))

  // a migrated v4 user keeps their own edits block-for-block under UPSC
  const { state: migrated } = migrateState(
    { version: 4, timetable: [{ id: 'legacy-7', time: '07:07', title: 'My edited UPSC block', duration: 45, cat: 'upsc' }] },
    ctx(),
  )
  assert.equal(migrated.timetables.upsc_cse_2028.length, 1, 'the legacy schedule replaces the starter, nothing merges')
  assert.deepEqual(migrated.timetables.upsc_cse_2028[0], { id: 'legacy-7', time: '07:07', title: 'My edited UPSC block', duration: 45, cat: 'upsc' })
})

/* --------------------------------------------------------- day-plan isolation */

test('day-plan snapshots are isolated per mission', () => {
  const state = emptyState(ctx())
  state.timetables.ssc_cgl_2027 = [{ id: 's1', time: '09:00', title: 'SSC day', duration: 60, cat: 'ssc' }]
  state.timetables.upsc_cse_2028 = [{ id: 'u1', time: '10:00', title: 'UPSC day', duration: 60, cat: 'upsc' }]
  materializeDayPlan(state, TODAY) // SSC is active → its snapshot
  state.missions.activeMissionId = 'upsc_cse_2028'
  materializeDayPlan(state, TODAY) // UPSC gets its own, same date

  assert.deepEqual(state.dayPlans.ssc_cgl_2027[TODAY].map((b) => b.id), ['s1'])
  assert.deepEqual(state.dayPlans.upsc_cse_2028[TODAY].map((b) => b.id), ['u1'])
  assert.deepEqual(dayPlanFor(state, TODAY).map((b) => b.id), ['u1'], 'UPSC never reuses the SSC snapshot')
  state.missions.activeMissionId = 'ssc_cgl_2027'
  assert.deepEqual(dayPlanFor(state, TODAY).map((b) => b.id), ['s1'], 'SSC never reuses the UPSC snapshot')
  assert.equal(state.dayPlans.ras_2028?.[TODAY], undefined, 'RAS stays untouched')

  // pre-v5 flat day plans are preserved under the UPSC mission, never deleted or shared
  const { state: migrated } = migrateState(
    {
      version: 4,
      timetable: [{ id: 'b1', time: '09:00', title: 'Legacy block', duration: 60 }],
      dayPlans: { '2026-09-20': [{ id: 'old-plan', time: '07:00', title: 'Old plan', duration: 30, cat: null }] },
    },
    ctx(),
  )
  assert.equal(migrated.dayPlans.upsc_cse_2028['2026-09-20'][0].id, 'old-plan', 'historical day plans survive the migration')
  assert.deepEqual(migrated.dayPlans.ssc_cgl_2027, {}, 'legacy day plans never leak into other missions')
  assert.deepEqual(migrated.dayPlans.ras_2028, {})
})

/* ------------------------------------------------------- completion isolation */

test('completing a block never completes an equivalent block in another mission', () => {
  // seeded starter blocks keep independent identity across all three missions
  const fresh = emptyState(ctx())
  const allIds = Object.values(fresh.timetables).flat().map((b) => b.id)
  assert.equal(new Set(allIds).size, allIds.length, 'no block id is shared between missions')

  const state = emptyState(ctx())
  state.timetables.ssc_cgl_2027 = [{ id: 'ssc-q', time: '09:00', title: 'Quant practice', duration: 60, cat: 'ssc' }]
  state.timetables.ras_2028 = [{ id: 'ras-q', time: '09:00', title: 'Quant practice', duration: 60, cat: 'ras' }]
  state.timetables.upsc_cse_2028 = [{ id: 'upsc-q', time: '09:00', title: 'Quant practice', duration: 60, cat: 'upsc' }]
  state.completionLog[TODAY] = { ttDone: ['ssc-q'], taskDone: [] } // the SSC block was ticked

  state.missions.activeMissionId = 'upsc_cse_2028'
  let stats = dayStats(state, TODAY, { todayKey: TODAY, now: NOON })
  assert.equal(stats.blocksDone, 0, 'the UPSC twin is still open')
  state.missions.activeMissionId = 'ras_2028'
  stats = dayStats(state, TODAY, { todayKey: TODAY, now: NOON })
  assert.equal(stats.blocksDone, 0, 'the RAS twin is still open')
  state.missions.activeMissionId = 'ssc_cgl_2027'
  stats = dayStats(state, TODAY, { todayKey: TODAY, now: NOON })
  assert.equal(stats.blocksDone, 1, 'only the SSC block counts as done')
})

/* --------------------------------------------------- score/adherence isolation */

test('score, adherence and elapsed counts never mix missions', () => {
  const state = emptyState(ctx())
  state.timetables.ssc_cgl_2027 = [
    { id: 's1', time: '09:00', title: 'SSC one', duration: 60, cat: 'ssc' },
    { id: 's2', time: '10:00', title: 'SSC two', duration: 60, cat: 'ssc' },
  ]
  state.timetables.upsc_cse_2028 = [
    { id: 'u1', time: '08:00', title: 'UPSC one', duration: 60, cat: 'upsc' },
    { id: 'u2', time: '11:00', title: 'UPSC two', duration: 60, cat: 'upsc' },
    { id: 'u3', time: '18:00', title: 'UPSC three', duration: 60, cat: 'upsc' },
  ]
  state.completionLog[TODAY] = { ttDone: ['s1'], taskDone: [] } // SSC work only

  state.missions.activeMissionId = 'ssc_cgl_2027'
  let stats = dayStats(state, TODAY, { todayKey: TODAY, now: NOON })
  assert.equal(stats.blocksTotal, 2)
  assert.equal(stats.blocksElapsed, 2)
  assert.equal(stats.blocksDone, 1)
  assert.equal(stats.adherence, 0.5)
  assert.equal(stats.scoreParts.find((p) => p.key === 'schedule').detail, '1/2')

  state.missions.activeMissionId = 'upsc_cse_2028'
  stats = dayStats(state, TODAY, { todayKey: TODAY, now: NOON })
  assert.equal(stats.blocksTotal, 3)
  assert.equal(stats.blocksElapsed, 2, 'u3 at 18:00 has not started yet')
  assert.equal(stats.blocksDone, 0, "SSC's completion never counts towards UPSC")
  assert.equal(stats.adherence, 0)
  assert.equal(stats.scoreParts.find((p) => p.key === 'schedule').detail, '0/2')
})

/* --------------------------------------------------------- recovery isolation */

test('Recover My Day only reshuffles the active mission day plan', () => {
  const state = emptyState(ctx())
  state.timetables.ssc_cgl_2027 = [{ id: 's1', time: '09:00', title: 'SSC morning block', duration: 60, cat: 'ssc' }]
  state.timetables.upsc_cse_2028 = [{ id: 'u1', time: '08:00', title: 'UPSC morning block', duration: 60, cat: 'upsc' }]
  state.completionLog[TODAY] = { ttDone: ['u1'], taskDone: [] } // UPSC work was ticked

  let plan = planRecovery({
    timetable: dayPlanFor(state, TODAY),
    ttDone: state.completionLog[TODAY].ttDone,
    nowMinutes: 12 * 60,
    dayEndMinutes: 23 * 60 + 30,
  })
  assert.deepEqual(plan.missed.map((b) => b.id), ['s1'], "UPSC's completion never masks SSC's missed block")
  assert.equal(plan.missed.some((b) => b.id === 'u1'), false, "another mission's block never enters the plan")

  state.missions.activeMissionId = 'upsc_cse_2028'
  plan = planRecovery({
    timetable: dayPlanFor(state, TODAY),
    ttDone: state.completionLog[TODAY].ttDone,
    nowMinutes: 12 * 60,
    dayEndMinutes: 23 * 60 + 30,
  })
  assert.deepEqual(plan.missed.map((b) => b.id), [], 'the completed UPSC block is not re-planned')
  assert.equal(plan.missed.some((b) => b.id === 's1'), false, "SSC's block never enters the UPSC plan")

  // applying a plan only touches the active mission's slot
  state.timetables.ras_2028 = [{ id: 'r1', time: '07:00', title: 'RAS block', duration: 60, cat: 'ras' }]
  const rasBefore = JSON.stringify(state.timetables.ras_2028)
  state.missions.activeMissionId = 'ssc_cgl_2027'
  plan = planRecovery({
    timetable: dayPlanFor(state, TODAY),
    ttDone: [],
    nowMinutes: 12 * 60,
    dayEndMinutes: 23 * 60 + 30,
  })
  applyRecovery(timetableSlot(state), plan.proposals)
  assert.notEqual(state.timetables.ssc_cgl_2027[0].time, '09:00', 'the active mission is rescheduled')
  assert.equal(JSON.stringify(state.timetables.ras_2028), rasBefore, "applying never touches another mission's schedule")
})

/* -------------------------------------------------------------- AI isolation */

test('AI context and free-slot search only see the active mission', () => {
  const state = emptyState(ctx())
  state.timetables.ssc_cgl_2027 = [
    { id: 's1', time: '09:00', title: 'SSC Quant sprint', duration: 60, cat: 'ssc' },
    { id: 's2', time: '11:00', title: 'SSC Mock slot', duration: 60, cat: 'ssc' },
  ]
  state.timetables.upsc_cse_2028 = [
    { id: 'u1', time: '10:15', title: 'UPSC Ethics class', duration: 30, cat: 'upsc' },
    { id: 'u2', time: '07:00', title: 'UPSC answer writing', duration: 60, cat: 'upsc' },
  ]
  // each mission already has its own snapshot for today
  state.dayPlans = {
    ssc_cgl_2027: {
      [TODAY]: [
        { id: 's1', time: '09:00', title: 'SSC Quant sprint', duration: 60, cat: 'ssc' },
        { id: 's2', time: '11:00', title: 'SSC Mock slot', duration: 60, cat: 'ssc' },
      ],
    },
    upsc_cse_2028: { [TODAY]: [{ id: 'u1', time: '10:15', title: 'UPSC Ethics class', duration: 30, cat: 'upsc' }] },
    ras_2028: {},
  }

  const text = buildAiContext(state, { todayKey: TODAY, now: new Date(2026, 8, 27, 9, 30, 0) })
  assert.match(text, /SSC Quant sprint/)
  assert.match(text, /SSC Mock slot/)
  assert.doesNotMatch(text, /UPSC Ethics class|UPSC answer writing/, "another mission's schedule never reaches the assistant")

  // the 10:00–11:00 gap stays free: the foreign 10:15 block must not block our slots
  const slot = nextFreeSlot(state, TODAY, new Date(2026, 8, 27, 10, 0, 0), 30)
  assert.equal(slot, 10 * 60 + 5, "another mission's block must not eat our free time")

  state.missions.activeMissionId = 'upsc_cse_2028'
  const upscText = buildAiContext(state, { todayKey: TODAY, now: new Date(2026, 8, 27, 9, 30, 0) })
  assert.match(upscText, /UPSC Ethics class/)
  assert.doesNotMatch(upscText, /SSC Quant sprint|SSC Mock slot/)
})
