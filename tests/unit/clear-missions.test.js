/**
 * Unit tests for the surgical mission clear (lib/clear-missions.js).
 *
 * The promise under test is narrow and absolute: after `applyMissionClear`
 * the missions list is empty, and every other slice of the workspace is
 * byte-for-byte what it was before. The tests below compare whole subtrees
 * by JSON, not by spot-checking a few fields, so an accidental extra delete
 * fails loudly.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MISSION_CLEAR_BACKUP_KEY,
  applyMissionClear,
  describeMissionClear,
  hasMissionsToClear,
  missionClearPlan,
} from '../../src/client/lib/clear-missions.js'
import { baseState, task } from '../helpers/fixtures.js'

const DAY = '2026-09-15'
const YESTERDAY = '2026-09-14'

/** A workspace with missions *and* a full life around them. */
function populatedState() {
  const missions = [
    task('m1', { title: 'Finish the mock test', date: DAY, priority: 'high' }),
    task('m2', { title: 'Read chapter 4', date: DAY, done: true, status: 'completed', completedAt: 42 }),
    task('m3', { title: 'Someday: learn typing', date: null, inbox: true }),
    task('m4', {
      title: 'Revise polity',
      date: YESTERDAY,
      status: 'cancelled',
      subtasks: [
        { id: 's1', title: 'Notes', done: true },
        { id: 's2', title: 'Questions', done: false },
      ],
    }),
  ]

  return baseState({
    tasks: missions,
    goals: [{ id: 'g1', title: 'Clear the exam', why: 'For me', targetDate: null, milestones: [] }],
    projects: [{ id: 'p1', title: 'Answer-writing', goalId: 'g1', milestones: [], status: 'active' }],
    routines: [{ id: 'r1', title: 'Morning walk', time: '06:30', duration: 30, days: [1, 2, 3, 4, 5] }],
    routineHistory: { [DAY]: { r1: [] } },
    journal: { [DAY]: { note: 'Steady day.', win: 'Two missions done', nextStep: 'Revise polity', updatedAt: 10 } },
    hyb: { plans: [{ id: 'h1', title: 'GS sprint', kind: 'oneoff', date: DAY, minutes: 50 }] },
    focus: {
      active: null,
      sessions: [{ id: 'f1', taskId: 'm1', mode: 'focus', plannedMinutes: 25, focusedSeconds: 1500, startedAt: 1, endedAt: 2, taskTitle: 'Finish the mock test' }],
    },
    categories: [{ id: 'c1', name: 'Study', color: '#b4a3f5' }],
    timetables: {
      ssc_cgl_2027: [{ id: 'tt1', time: '08:00', title: 'Quant', duration: 60 }],
      ras_2028: [],
      upsc_cse_2028: [],
    },
    // a day-plan snapshot: the timetable that applied that day (per exam mission)
    dayPlans: { ssc_cgl_2027: { [DAY]: [{ id: 'tt1', time: '08:00', title: 'Quant', duration: 60, cat: null }] } },
    top3: { [DAY]: ['m1', 'm2'], [YESTERDAY]: ['m4'] },
    completionLog: {
      [DAY]: { ttDone: ['tt1'], taskDone: ['m1', 'm2'] },
      [YESTERDAY]: { ttDone: [], taskDone: ['m4'] },
    },
    scoreHistory: { [DAY]: { score: 7, createdAt: 11 } },
    reviews: { [DAY]: { intention: 'Keep it simple.', reflection: 'Good week.', updatedAt: 12 } },
    chatHistory: [{ role: 'user', text: 'Plan my day', ts: 13 }],
    schedule: {
      days: {
        [DAY]: [
          { id: 'b1', taskId: 'm1', title: 'Finish the mock test', time: '09:00', duration: 60, kind: 'mission' },
          { id: 'b2', taskId: null, title: 'Deep work', time: '11:00', duration: 90, kind: 'break' },
          { id: 'hyb:h1', taskId: null, hybPlanId: 'h1', title: 'GS sprint', time: '14:00', duration: 50, kind: 'mission' },
          { id: 'b3', taskId: null, routineId: 'r1', title: 'Morning walk', time: '06:30', duration: 30, kind: 'routine' },
        ],
        [YESTERDAY]: [{ id: 'b4', taskId: 'm4', title: 'Revise polity', time: '18:00', duration: 45, kind: 'mission' }],
      },
      history: [{ id: 'h-1', at: 5, date: YESTERDAY, label: 'Rescheduled', before: [] }],
    },
    reminders: {
      sent: {
        'task:m1': 100,
        'task-duenow:m2': 101,
        [`top3:${DAY}`]: 102,
        'routine:r1': 103,
        'overdue:2026-09-14': 104,
        'planning:2026-09-15': 105,
        'weekly-review:2026-W37': 106,
        [`block:${DAY}:b2`]: 107,
      },
    },
    settings: {
      protectedTime: [{ id: 'pt1', label: 'Sleep', start: '23:00', end: '06:00', days: [] }],
      theme: 'dark',
    },
    briefing: { lastShownDay: DAY, intentions: { [DAY]: 'One thing at a time.' } },
    dailyProgress: { [DAY]: { planned: 4, done: 2 } },
    titles: { disciplineMonster: { unlocked: true, bestStreak: 9, currentStreak: 3 } },
  })
}

/** Every slice that must survive, as one comparable structure. */
function everythingElse(state) {
  const { tasks, top3, completionLog, reminders, schedule, ...rest } = state
  return {
    rest,
    scheduleHistory: schedule.history,
    // plain time blocks, HYB blocks and routine blocks only
    scheduleDays: Object.fromEntries(
      Object.entries(schedule.days).map(([key, blocks]) => [key, blocks.filter((b) => !b.taskId)]),
    ),
    // study-plan ticks and the days they were recorded on
    completionLog: Object.fromEntries(
      Object.entries(completionLog).map(([key, log]) => [key, { ttDone: log.ttDone }]),
    ),
    reminderKeys: Object.keys(reminders.sent)
      .filter((key) => !key.startsWith('task:') && !key.startsWith('task-duenow:') && !key.startsWith('top3:'))
      .sort(),
  }
}

test('applyMissionClear empties the missions list', () => {
  const state = populatedState()
  assert.equal(state.tasks.length, 4)
  applyMissionClear(state)
  assert.deepEqual(state.tasks, [])
})

test('applyMissionClear reports what it removed, measured before the change', () => {
  const state = populatedState()
  const plan = applyMissionClear(state)
  assert.equal(plan.missions, 4)
  assert.equal(plan.open, 2, 'm1 is ready and m3 sits in the inbox')
  assert.equal(plan.done, 1)
  assert.equal(plan.inbox, 1)
  assert.equal(plan.subtasks, 2)
  assert.equal(plan.missionBlocks, 2, 'the blocks m1 and m4 placed')
  assert.equal(plan.top3Picks, 3)
  assert.equal(plan.completionMarks, 3)
})

test('everything that is not a mission survives byte for byte', () => {
  const state = populatedState()
  const before = JSON.stringify(everythingElse(state))
  applyMissionClear(state)
  const after = JSON.stringify(everythingElse(state))
  assert.equal(after, before)
})

test('the kept slices are still the real data, not just unchanged shapes', () => {
  const state = populatedState()
  applyMissionClear(state)
  assert.equal(state.goals.length, 1)
  assert.equal(state.projects.length, 1)
  assert.equal(state.routines.length, 1)
  assert.deepEqual(state.routineHistory[DAY], { r1: [] })
  assert.equal(state.journal[DAY].note, 'Steady day.')
  assert.equal(state.hyb.plans.length, 1)
  assert.equal(state.focus.sessions.length, 1, 'focus history is a record of time spent, not a mission')
  assert.equal(state.focus.sessions[0].taskTitle, 'Finish the mock test')
  assert.ok(state.categories.some((c) => c.id === 'c1'), 'the category the missions used is still there')
  assert.equal(state.categories.length, 6, 'my category plus the five defaults')
  assert.equal(state.timetables.ssc_cgl_2027.length, 1, 'study plans are the exam roadmap, not missions')
  assert.deepEqual(state.dayPlans.ssc_cgl_2027[DAY], [{ id: 'tt1', time: '08:00', title: 'Quant', duration: 60, cat: null }])
  assert.equal(state.scoreHistory[DAY].score, 7)
  assert.equal(state.reviews[DAY].reflection, 'Good week.')
  assert.equal(state.chatHistory.length, 1)
  assert.equal(state.settings.protectedTime.length, 1)
  assert.equal(state.briefing.intentions[DAY], 'One thing at a time.')
  assert.equal(state.titles.disciplineMonster.bestStreak, 9)
  assert.equal(state.missions.definitions ? Object.keys(state.missions.definitions).length : 3, 3, 'the exam roadmap is untouched')
})

test('the schedule keeps time blocks, HYB blocks and routine blocks', () => {
  const state = populatedState()
  applyMissionClear(state)
  const today = state.schedule.days[DAY].map((b) => b.id)
  assert.deepEqual(today, ['b2', 'hyb:h1', 'b3'])
  assert.deepEqual(state.schedule.days[YESTERDAY], [], 'yesterday held only a mission block')
  assert.equal(state.schedule.history.length, 1)
})

test('the completion log keeps its days and its study-plan ticks', () => {
  const state = populatedState()
  applyMissionClear(state)
  assert.deepEqual(Object.keys(state.completionLog), [DAY, YESTERDAY])
  assert.deepEqual(state.completionLog[DAY], { ttDone: ['tt1'], taskDone: [] })
  assert.deepEqual(state.completionLog[YESTERDAY], { ttDone: [], taskDone: [] })
})

test('only mission-shaped reminder keys are pruned', () => {
  const state = populatedState()
  applyMissionClear(state)
  const keys = Object.keys(state.reminders.sent).sort()
  assert.deepEqual(keys, ['block:2026-09-15:b2', 'overdue:2026-09-14', 'planning:2026-09-15', 'routine:r1', 'weekly-review:2026-W37'])
})

test('Top 3 picks go with the missions they pointed at', () => {
  const state = populatedState()
  applyMissionClear(state)
  assert.deepEqual(state.top3, {})
})

test('missionClearPlan counts what would stay before anything is touched', () => {
  const state = populatedState()
  const plan = missionClearPlan(state)
  assert.equal(plan.kept.goals, 1)
  assert.equal(plan.kept.projects, 1)
  assert.equal(plan.kept.routines, 1)
  assert.equal(plan.kept.routineDays, 1)
  assert.equal(plan.kept.journalDays, 1)
  assert.equal(plan.kept.hybPlans, 1)
  assert.equal(plan.kept.focusSessions, 1)
  assert.equal(plan.kept.studyPlanBlocks, 1)
  assert.equal(plan.kept.categories, 6)
  assert.equal(plan.kept.protectedWindows, 1)
  assert.equal(plan.kept.recordedDays, 2)
  assert.equal(plan.kept.scoreDays, 1)
  assert.equal(plan.kept.reviews, 1)
  assert.equal(plan.kept.timeBlocks, 3, 'the plain block, the HYB block and the routine block')
  // planning must not mutate
  assert.equal(state.tasks.length, 4)
})

test('hasMissionsToClear is false on a fresh workspace', () => {
  assert.equal(hasMissionsToClear(baseState()), false)
  assert.equal(hasMissionsToClear(populatedState()), true)
})

test('a second clear is a no-op and still keeps everything', () => {
  const state = populatedState()
  applyMissionClear(state)
  const snapshot = JSON.stringify(state)
  const plan = applyMissionClear(state)
  assert.equal(plan.missions, 0)
  assert.equal(hasMissionsToClear(state), false)
  assert.equal(JSON.stringify(state), snapshot)
})

test('describeMissionClear says what goes and what stays', () => {
  const text = describeMissionClear(missionClearPlan(populatedState()))
  assert.match(text, /^Removed: /)
  assert.match(text, /4 missions \(2 open · 1 done · 1 in the inbox\)/)
  assert.match(text, /2 subtasks/)
  assert.match(text, /2 scheduled blocks placed by a mission/)
  assert.match(text, /3 Top 3 picks/)
  assert.match(text, /3 completion marks/)
  assert.match(text, /\nKept: /)
  assert.match(text, /1 goal/)
  assert.match(text, /1 HYB plan/)
  assert.match(text, /3 time blocks/)
  assert.match(text, /1 study-plan block/)
  assert.match(text, /every preference/)
})

test('singular counts read as singular', () => {
  const state = baseState({ tasks: [task('only', { date: DAY })] })
  const text = describeMissionClear(missionClearPlan(state))
  assert.match(text, /^Removed: 1 mission \(1 open · 0 done · 0 in the inbox\)\./)
  assert.match(text, /0 goals · 0 projects · 0 routines/)
})

test('a state with nothing but missions still clears cleanly', () => {
  const state = baseState({ tasks: [task('solo', { date: DAY })] })
  const plan = applyMissionClear(state)
  assert.equal(plan.missions, 1)
  assert.deepEqual(state.tasks, [])
  assert.deepEqual(state.top3, {})
})

test('malformed or missing slices never throw', () => {
  const broken = { tasks: null, top3: null, schedule: null, completionLog: [], reminders: { sent: null } }
  const plan = applyMissionClear(/** @type {any} */ (broken))
  assert.deepEqual(broken.tasks, [])
  assert.deepEqual(broken.top3, {})
  assert.equal(plan.missions, 0)
  assert.equal(plan.kept.timeBlocks, 0)
  assert.equal(hasMissionsToClear(/** @type {any} */ ({})), false)
})

test('the safety-copy key is its own, so it never overwrites another backup', () => {
  assert.equal(MISSION_CLEAR_BACKUP_KEY, 'kcc_backup_before_mission_clear')
  assert.notEqual(MISSION_CLEAR_BACKUP_KEY, 'kcc_backup_before_reset')
  assert.notEqual(MISSION_CLEAR_BACKUP_KEY, 'kcc_backup_pre_import')
  assert.notEqual(MISSION_CLEAR_BACKUP_KEY, 'kcc_backup_before_change')
})
