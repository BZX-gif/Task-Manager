import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyState, makeContext, loadState, saveState, storageUsage } from '../../src/client/lib/state.js'
import { dayStats } from '../../src/client/lib/daystats.js'
import { computeStreak } from '../../src/client/lib/streak.js'
import {
  proposeDay, freeIntervals, scheduleConflicts, extendSchedule, scheduleFor,
  itemDone, blockState, recoveryProposal, protectedIntervals,
} from '../../src/client/lib/planner.js'
import { goalProgress, projectProgress, taskProgress, goalChain, unlinkDeleted } from '../../src/client/lib/relationships.js'
import { routineDue, routineDone, toggleActivity, routineStats } from '../../src/client/lib/routines.js'
import { buildOccurrence, materializeOccurrences } from '../../src/client/lib/recurrence.js'
import { computeDueReminders } from '../../src/client/lib/reminders.js'
import { buildAiContext, AI_SYSTEM_PROMPT } from '../../src/client/lib/ai-context.js'
import { weeklyReview } from '../../src/client/lib/review.js'
import { selectNextAction } from '../../src/client/lib/nextaction.js'

const TODAY = '2026-09-15'
const NOON = new Date(2026, 8, 15, 12, 0, 0)
let n = 0
const fresh = () => emptyState(makeContext({ now: 1, id: () => `id${++n}` }))
const task = (id, over = {}) => ({ id, title: id, date: TODAY, time: null, priority: 'medium', estimateMinutes: 30, done: false, status: 'ready', inbox: false, subtasks: [], ...over })

test('freeIntervals merges occupied time and subtracts it from the available window', () => {
  assert.deepEqual(freeIntervals(540, 720, [{ start: 500, end: 570 }, { start: 560, end: 600 }, { start: 650, end: 800 }]), [
    { start: 600, end: 650 },
  ])
})

test('proposeDay schedules by priority, inserts breaks, and defers overload instead of squeezing it', () => {
  const plan = proposeDay({
    tasks: [task('low', { priority: 'low', estimateMinutes: 30 }), task('high', { priority: 'high', estimateMinutes: 60 }), task('later', { estimateMinutes: 60 })],
    start: '09:00', end: '11:00', breakMinutes: 10, breakEvery: 60,
    protectedBlocks: [{ id: 'lunch', label: 'Lunch', start: '10:00', end: '10:30', days: [] }],
    date: TODAY,
  })
  assert.equal(plan.proposals[0].id, 'high')
  assert.equal(plan.proposals[0].time, '09:00')
  assert.equal(plan.proposals[1].time, '10:30', 'break and protected lunch are respected')
  assert.equal(plan.deferred.length, 1)
  assert.equal(plan.overloaded, true)
  assert.equal(plan.availableMinutes, 90)
})

test('scheduleConflicts reports overlaps, protected windows and midnight spill without mutating blocks', () => {
  const blocks = [{ id: 'a', time: '09:00', duration: 60 }, { id: 'b', time: '09:30', duration: 30 }, { id: 'c', time: '23:45', duration: 30 }]
  const before = JSON.stringify(blocks)
  const conflicts = scheduleConflicts(blocks, [{ id: 'sleep', label: 'Sleep', start: '23:00', end: '06:00', days: [] }], TODAY)
  assert.ok(conflicts.some((c) => c.a === 'a' && c.b === 'b'))
  assert.ok(conflicts.some((c) => c.label === 'Protected: Sleep'))
  assert.ok(conflicts.some((c) => c.label === 'Extends past midnight'))
  assert.equal(JSON.stringify(blocks), before)
})

test('extendSchedule moves only flexible overlapping blocks and keeps protected time fixed', () => {
  const items = [
    { id: 'a', time: '09:00', duration: 30, flexible: true },
    { id: 'b', time: '09:30', duration: 30, flexible: true },
    { id: 'fixed', time: '10:00', duration: 30, flexible: false },
  ]
  const result = extendSchedule(items, 'a', 30, TODAY, [{ id: 'p', label: 'Protected', start: '09:45', end: '10:00', days: [] }])
  assert.equal(result.items.find((b) => b.id === 'a').duration, 60)
  assert.equal(result.items.find((b) => b.id === 'b').time, '10:30', 'flexible block jumps over protected and fixed time')
  assert.equal(result.items.find((b) => b.id === 'fixed').time, '10:00')
  assert.equal(result.moved.length, 1)
})

test('scheduleFor keeps dated overrides, merges new timed missions, and freezes past snapshots', () => {
  const state = fresh()
  state.schedule.days[TODAY] = [{ id: 'b1', time: '09:00', title: 'Block', duration: 30, kind: 'mission', status: 'planned' }]
  state.tasks.push(task('t1', { time: '10:00' }))
  assert.equal(scheduleFor(state, TODAY).length, 2)
  state.dayPlans[state.missions.activeMissionId] = { '2026-09-14': [{ id: 'old', time: '08:00', title: 'Historical', duration: 60 }] }
  state.timetables[state.missions.activeMissionId] = [{ id: 'new', time: '09:00', title: 'Edited template', duration: 60 }]
  assert.equal(scheduleFor(state, '2026-09-14')[0].title, 'Historical')
  assert.equal(scheduleFor(state, '2026-09-16').some((b) => b.title === 'Edited template'), true)
  assert.equal(scheduleFor(state, TODAY).some((b) => b.id === 'b1'), true, 'dated override stays authoritative')
})

test('itemDone understands missions, legacy blocks and routine check-ins', () => {
  const state = fresh()
  state.tasks.push(task('t1', { done: true }))
  state.completionLog[TODAY] = { ttDone: ['b1'], taskDone: [] }
  state.routines.push({ id: 'r1', title: 'Morning', type: 'Custom', time: '08:00', days: [], activities: [{ id: 'a1', title: 'Water', duration: 5 }], archived: false })
  state.routineHistory[TODAY] = { r1: ['a1'] }
  assert.equal(itemDone(state, { taskId: 't1' }, TODAY), true)
  assert.equal(itemDone(state, { id: 'b1' }, TODAY), true)
  assert.equal(itemDone(state, { kind: 'routine', routineId: 'r1', activityId: 'a1' }, TODAY), true)
  assert.equal(blockState(state, { time: '09:00', duration: 30 }, TODAY, NOON, TODAY), 'missed')
})

test('recoveryProposal protects fixed/routine/active time and defers what cannot fit', () => {
  const state = fresh()
  state.settings.dayEnd = '13:00'
  state.schedule.days[TODAY] = [
    { id: 'missed', time: '09:00', title: 'Missed', duration: 60, kind: 'mission', status: 'planned', flexible: true },
    { id: 'active', time: '11:30', title: 'Active', duration: 60, kind: 'mission', status: 'planned', flexible: true },
    { id: 'routine', time: '12:00', title: 'Routine', duration: 30, kind: 'routine', status: 'planned', flexible: true },
    { id: 'protected', time: '12:30', title: 'Protected', duration: 30, kind: 'protected', status: 'planned', protected: true, flexible: false },
  ]
  const plan = recoveryProposal(state, TODAY, NOON)
  assert.deepEqual(plan.remaining.map((b) => b.id), ['missed'])
  assert.ok(plan.fixedBlocks.some((b) => b.id === 'active'))
  assert.ok(plan.fixedBlocks.some((b) => b.id === 'routine'))
  assert.ok(plan.fixedBlocks.some((b) => b.id === 'protected'))
})

test('goal/project progress follows real linked work without double counting', () => {
  const state = fresh()
  state.goals.push({ id: 'g', title: 'Goal', category: 'Personal', status: 'active', progressMode: 'auto', manualProgress: 0, milestones: [{ id: 'm', title: 'Milestone', done: false }], targetDate: null, description: '', notes: '' })
  state.projects.push({ id: 'p', title: 'Project', goalId: 'g', milestoneId: 'm', status: 'active', progressMode: 'auto', manualProgress: 0, milestones: [], deadline: null })
  state.tasks.push(task('t1', { goalId: 'g', projectId: 'p', milestoneId: 'm', subtasks: [{ id: 's1', done: true }, { id: 's2', done: false }] }), task('t2', { goalId: 'g', projectId: 'p', milestoneId: 'm', done: true }))
  assert.equal(taskProgress(state.tasks[0]), 50)
  assert.equal(projectProgress(state, state.projects[0]), 75)
  assert.equal(goalProgress(state, state.goals[0]), 75)
  assert.equal(goalChain(state, state.tasks[0]).milestone.id, 'm')
  state.schedule.days[TODAY] = [{ id: 'b', time: '09:00', duration: 30, goalId: 'g', projectId: 'p', milestoneId: 'm' }]
  unlinkDeleted(state, 'project', 'p')
  assert.equal(state.tasks[0].projectId, null)
  assert.equal(state.schedule.days[TODAY][0].projectId, null)
  unlinkDeleted(state, 'goal', 'g')
  assert.equal(state.tasks[0].goalId, null)
  assert.equal(state.schedule.days[TODAY][0].goalId, null)
})

test('routines track check-ins and consistency without punishing missed days', () => {
  const state = fresh()
  const routine = { id: 'r', title: 'Morning', type: 'Custom', time: '08:00', days: [1, 2, 3, 4, 5], activities: [{ id: 'a', title: 'Water', duration: 5 }, { id: 'b', title: 'Stretch', duration: 10 }], archived: false }
  state.routines.push(routine)
  assert.equal(routineDue(routine, '2026-09-19'), false, 'Saturday is not scheduled')
  toggleActivity(state, 'r', 'a', TODAY)
  assert.equal(routineDone(state, routine, TODAY), false)
  toggleActivity(state, 'r', 'b', TODAY)
  assert.equal(routineDone(state, routine, TODAY), true)
  const stats = routineStats(state, routine, TODAY, 7)
  assert.equal(stats.completed, 1)
  assert.ok(stats.consistency > 0 && stats.consistency <= 100)
  assert.equal(stats.history.length, 7)
})

test('recurrence instances inherit planning fields and reset completion state', () => {
  const template = task('series', { time: '09:00', deadline: '2026-12-01', goalId: 'g', projectId: 'p', milestoneId: 'm', horizon: 'weekly', description: 'Why', protected: true, flexible: false, subtasks: [{ id: 's', title: 'Step', done: true }], recurrence: { freq: 'daily' }, done: true, status: 'completed' })
  const occurrence = buildOccurrence(template, '2026-09-16', { uid: () => 'occ', now: 5 })
  assert.equal(occurrence.id, 'occ')
  assert.equal(occurrence.time, '09:00')
  assert.equal(occurrence.goalId, 'g')
  assert.equal(occurrence.projectId, 'p')
  assert.equal(occurrence.milestoneId, 'm')
  assert.equal(occurrence.protected, true)
  assert.equal(occurrence.flexible, false)
  assert.equal(occurrence.done, false)
  assert.equal(occurrence.status, 'ready')
  assert.equal(occurrence.subtasks[0].done, false)
  const paused = { ...template, id: 'paused', seriesId: 'paused', status: 'paused' }
  assert.equal(materializeOccurrences({ tasks: [paused], todayKey: TODAY, horizonDays: 3, uid: () => 'x' }).created.length, 0)
})

test('planning, weekly and routine reminders use bounded windows and stable keys', () => {
  const state = fresh()
  state.settings.reminders = { ...state.settings.reminders, enabled: true, planningAt: '08:30', reviewAt: '18:00', reviewDay: 2, routines: true, top3NudgeAt: '', timetable: false, taskDue: false, overdue: false }
  state.routines.push({ id: 'r', title: 'Morning', type: 'Custom', time: '08:30', days: [], activities: [{ id: 'a', title: 'Water', duration: 5 }], archived: false })
  const due = computeDueReminders({ state, todayKey: TODAY, nowMinutes: 8 * 60 + 35, now: new Date(2026, 8, 15, 8, 35), maxPerRun: 5 })
  assert.ok(due.some((r) => r.kind === 'planning' && r.key === `planning:${TODAY}`))
  assert.ok(due.some((r) => r.kind === 'routine' && r.key === `routine:r:${TODAY}`))
  const review = computeDueReminders({ state, todayKey: TODAY, nowMinutes: 18 * 60 + 10, now: new Date(2026, 8, 15, 18, 10), maxPerRun: 5 })
  assert.ok(review.some((r) => r.kind === 'review'))
  const late = computeDueReminders({ state, todayKey: TODAY, nowMinutes: 20 * 60, now: new Date(2026, 8, 15, 20, 0), maxPerRun: 5 })
  assert.equal(late.some((r) => r.kind === 'planning'), false, 'late reopening does not pile up nudges')
})

test('assistant context is grounded in the real schedule and never claims write access', () => {
  const state = fresh()
  state.schedule.days[TODAY] = [{ id: 'b', time: '09:00', title: 'Deep work', duration: 60, kind: 'mission', status: 'planned' }]
  state.goals.push({ id: 'g', title: 'Ship the thing', category: 'Career', status: 'active', progressMode: 'manual', manualProgress: 40, milestones: [], targetDate: null })
  const text = buildAiContext(state, { todayKey: TODAY, now: NOON, maxChars: 4000 })
  assert.match(text, /Deep work/)
  assert.match(text, /Ship the thing/)
  assert.match(AI_SYSTEM_PROMPT, /cannot modify the schedule/)
  assert.match(AI_SYSTEM_PROMPT, /review and approve/)
})

test('weekly review judges elapsed time, keeps buffers per day, and ignores skipped missions', () => {
  const state = fresh()
  state.tasks.push(task('done', { date: '2026-09-14', done: true }), task('skipped', { date: '2026-09-14', status: 'cancelled' }), task('future', { date: '2026-09-20' }))
  state.schedule.days['2026-09-14'] = [{ id: 'a', time: '09:00', duration: 60 }, { id: 'b', time: '10:30', duration: 60 }]
  const review = weeklyReview(state, { dateKey: TODAY, todayKey: TODAY, now: NOON, weekStart: 1 })
  assert.equal(review.isCurrentWeek, true)
  assert.equal(review.missedTasks.some((t) => t.id === 'skipped'), false)
  assert.equal(review.missedTasks.some((t) => t.id === 'future'), false)
  assert.ok(review.recommendations.length <= 4)
  assert.ok(review.completionPct <= 100)
})

test('next action skips inbox, skipped and protected work', () => {
  const pick = selectNextAction({
    tasks: [task('inbox', { inbox: true, date: null }), task('skipped', { status: 'cancelled' }), task('real')],
    timetable: [{ id: 'protected', time: '11:00', duration: 120, protected: true }],
    ttDone: [], top3Ids: [], todayKey: TODAY, nowMinutes: 12 * 60,
  })
  assert.equal(pick.task.id, 'real')
})

test('dayStats exposes the real score metadata used by the help modal and AI context', () => {
  const state = fresh()
  state.tasks.push(task('open', { date: '2026-09-14' }), task('skipped', { date: '2026-09-14', status: 'cancelled' }))
  state.focus.sessions.push({ id: 'f', mode: 'focus', date: TODAY, focusedSeconds: 1800, status: 'completed' })
  const stats = dayStats(state, TODAY, { todayKey: TODAY, now: NOON })
  assert.equal(stats.hasData, true)
  assert.equal(stats.penalty, 4, 'skipped work is not an overdue debt')
  assert.equal(stats.overdueCount, 1)
  assert.equal(stats.focusTargetMinutes, state.settings.focus.targetMinutes)
  assert.match(buildAiContext(state, { todayKey: TODAY, now: NOON }), /Daily score: \d+\/100/)
})

test('a quiet day never erases meaningful-day momentum', () => {
  const history = {
    '2026-09-10': { score: 90, top3Total: 0, top3Done: 0, focusedMinutes: 0 },
    '2026-09-11': { score: 0, top3Total: 0, top3Done: 0, focusedMinutes: 0 },
    '2026-09-12': { score: 90, top3Total: 0, top3Done: 0, focusedMinutes: 0 },
  }
  const result = computeStreak({ todayKey: TODAY, history })
  assert.equal(result.current, 2)
  assert.equal(result.best, 1)
})

test('storage denial and quota failures are reported instead of crashing', () => {
  const denied = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
  const loaded = loadState({ storage: denied, now: 1 })
  assert.equal(loaded.state.version, 6)
  assert.equal(saveState(loaded.state, { storage: denied }), false)
  assert.deepEqual(storageUsage({ storage: denied }), { bytes: 0, kb: 0 })
})
