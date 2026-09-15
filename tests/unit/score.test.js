import test from 'node:test'
import assert from 'node:assert/strict'
import { computeDailyScore, SCORE_WEIGHTS, OVERDUE_PENALTY_MAX, describeScoreFormula } from '../../src/client/lib/score.js'
import { computeStreak, isSuccessfulDay, STREAK_RULE } from '../../src/client/lib/streak.js'

const baseInput = {
  dateKey: '2026-09-15',
  todayKey: '2026-09-15',
  nowMinutes: 690, // 11:30
  dayEndMinutes: 1410, // 23:30
}

test('daily score follows the documented weights', () => {
  const result = computeDailyScore({
    ...baseInput,
    plannedTasks: [
      { id: 't1', done: true },
      { id: 't2', done: false },
      { id: 't3', done: false },
      { id: 't4', done: false },
    ],
    top3Ids: ['t1', 't2', 't3'],
    focusedMinutes: 90,
    focusTargetMinutes: 180,
    blocks: [
      { id: 'b1', start: 540, duration: 60, done: true },
      { id: 'b2', start: 600, duration: 60, done: false },
      { id: 'b3', start: 660, duration: 60, done: false },
      { id: 'b4', start: 720, duration: 60, done: false },
    ],
    overdueTaskCount: 0,
  })

  // tasks .25*30 + top3 .333*25 + focus .5*20 + schedule .333*20 = 32.5 over weight 95
  assert.equal(result.base, 34)
  assert.equal(result.score, 34)
  assert.equal(result.penalty, 0)
  assert.equal(result.pace, 49) // 690/1410
  assert.equal(result.onTrack, false, 'strongly behind pace at 11:30')
  const tasks = result.parts.find((p) => p.key === 'tasks')
  assert.equal(tasks.detail, '1/4')
  const schedule = result.parts.find((p) => p.key === 'schedule')
  assert.equal(schedule.detail, '1/3') // only elapsed blocks count
  const top3 = result.parts.find((p) => p.key === 'top3')
  assert.equal(top3.detail, '1/3')
})

test('missing components are dropped and the rest re-normalised', () => {
  const result = computeDailyScore({
    ...baseInput,
    plannedTasks: [],
    top3Ids: [],
    focusedMinutes: 0,
    focusTargetMinutes: 180,
    blocks: [],
    overdueTaskCount: 0,
  })
  assert.equal(result.hasData, false, 'nothing logged today yet — no fake score')
  assert.equal(result.score, 0)

  const onlyFocus = computeDailyScore({
    ...baseInput,
    plannedTasks: [],
    top3Ids: [],
    focusedMinutes: 180,
    focusTargetMinutes: 180,
    blocks: [],
  })
  // focus is the only available component → full marks
  assert.equal(onlyFocus.score, 100)
})

test('one missed task does not devastate the score', () => {
  const result = computeDailyScore({
    ...baseInput,
    plannedTasks: [
      { id: 't1', done: true },
      { id: 't2', done: true },
      { id: 't3', done: true },
      { id: 't4', done: true },
      { id: 't5', done: true },
      { id: 't6', done: true },
      { id: 't7', done: true },
      { id: 't8', done: true },
      { id: 't9', done: true },
      { id: 't10', done: false },
    ],
    top3Ids: ['t1', 't2', 't3'],
    focusedMinutes: 180,
    focusTargetMinutes: 180,
    blocks: [{ id: 'b1', start: 540, duration: 60, done: true }],
  })
  assert.ok(result.score >= 85, `expected >= 85, got ${result.score}`)
})

test('overdue tasks cost a capped, gentle penalty', () => {
  const result = computeDailyScore({
    ...baseInput,
    plannedTasks: [{ id: 't1', done: true }],
    top3Ids: ['t1'],
    focusedMinutes: 180,
    focusTargetMinutes: 180,
    blocks: [{ id: 'b1', start: 540, duration: 60, done: true }],
    overdueTaskCount: 10,
  })
  assert.equal(result.penalty, OVERDUE_PENALTY_MAX)
  assert.equal(result.score, 85)
  assert.equal(result.base, 100)
})

test('past days are scored with the whole day elapsed', () => {
  const result = computeDailyScore({
    ...baseInput,
    dateKey: '2026-09-14',
    blocks: [
      { id: 'b1', start: 540, duration: 60, done: true },
      { id: 'b2', start: 1200, duration: 60, done: false },
    ],
    plannedTasks: [],
    top3Ids: [],
    focusedMinutes: 0,
  })
  const schedule = result.parts.find((p) => p.key === 'schedule')
  assert.equal(schedule.detail, '1/2')
  assert.equal(result.pace, 100)
})

test('the formula is documented and exportable', () => {
  assert.equal(SCORE_WEIGHTS.tasks + SCORE_WEIGHTS.top3 + SCORE_WEIGHTS.focus + SCORE_WEIGHTS.schedule, 95)
  const lines = describeScoreFormula()
  assert.ok(lines.some((l) => l.includes('Tasks')))
  assert.ok(lines.length >= 5)
})

test('streak counts meaningful days only', () => {
  assert.equal(isSuccessfulDay({ score: 59, top3Total: 3, top3Done: 3, focusedMinutes: 0 }), true, 'top 3 complete')
  assert.equal(isSuccessfulDay({ score: 61, top3Total: 0, top3Done: 0, focusedMinutes: 0 }), true, 'score threshold')
  assert.equal(isSuccessfulDay({ score: 30, top3Total: 3, top3Done: 1, focusedMinutes: 50 }), true, 'focus threshold')
  assert.equal(isSuccessfulDay({ score: 30, top3Total: 3, top3Done: 1, focusedMinutes: 20 }), false)
  assert.equal(isSuccessfulDay(null), false)
  assert.equal(STREAK_RULE.minScore, 60)
})

test('streak does not break while today is still in progress', () => {
  const history = {
    '2026-09-12': { score: 80, top3Total: 3, top3Done: 3, focusedMinutes: 0 },
    '2026-09-13': { score: 70, top3Total: 0, top3Done: 0, focusedMinutes: 0 },
    '2026-09-14': { score: 65, top3Total: 0, top3Done: 0, focusedMinutes: 0 },
    '2026-09-15': { score: 10, top3Total: 3, top3Done: 0, focusedMinutes: 0 }, // today, unfinished
  }
  const streak = computeStreak({ todayKey: '2026-09-15', history })
  assert.equal(streak.current, 3)
  assert.equal(streak.todayCounted, false)
  assert.equal(streak.recent.length, 7)
  assert.equal(streak.recent.at(-1).isToday, true)
})

test('streak counts today once it succeeds and breaks on a real miss', () => {
  const history = {
    '2026-09-10': { score: 90, top3Total: 3, top3Done: 3, focusedMinutes: 0 },
    '2026-09-11': { score: 10, top3Total: 0, top3Done: 0, focusedMinutes: 0 }, // missed day
    '2026-09-12': { score: 90, top3Total: 3, top3Done: 3, focusedMinutes: 0 },
    '2026-09-13': { score: 90, top3Total: 3, top3Done: 3, focusedMinutes: 0 },
    '2026-09-14': { score: 90, top3Total: 3, top3Done: 3, focusedMinutes: 0 },
    '2026-09-15': { score: 90, top3Total: 3, top3Done: 3, focusedMinutes: 0 },
  }
  const streak = computeStreak({ todayKey: '2026-09-15', history })
  assert.equal(streak.current, 4)
  assert.equal(streak.todayCounted, true)
  assert.equal(streak.best, 4)
})
