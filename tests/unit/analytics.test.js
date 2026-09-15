import test from 'node:test'
import assert from 'node:assert/strict'
import { baseState, makeCtx, task } from '../helpers/fixtures.js'
import { dayStats, dayPlanFor, materializeDayPlan, rangeDayStats, streakHistory } from '../../src/client/lib/daystats.js'
import { categoryInsights, focusTimeOfDay, plannedLoadByDay, strongestAndWeakest } from '../../src/client/lib/insights.js'
import { weeklyReview, weekRange } from '../../src/client/lib/review.js'

const TODAY = '2026-09-17' // Thursday
const NOW = new Date(2026, 8, 17, 11, 30, 0)

function analyticsState() {
  return baseState({
    timetable: [
      { id: 'b1', time: '09:00', title: 'Deep block', duration: 60, cat: 'upsc' },
      { id: 'b2', time: '11:00', title: 'Class', duration: 60, cat: 'upsc' },
      { id: 'b3', time: '15:00', title: 'News', duration: 60, cat: 'ssc' },
    ],
    completionLog: {
      '2026-09-14': { ttDone: ['b1', 'b2', 'b3'], taskDone: ['a'] },
      '2026-09-15': { ttDone: ['b1'], taskDone: [] },
      '2026-09-16': { ttDone: ['b1', 'b2'], taskDone: [] },
      '2026-09-17': { ttDone: [], taskDone: [] },
    },
    tasks: [
      task('a', { date: '2026-09-14', done: true, cat: 'upsc', estimateMinutes: 30 }),
      task('b', { date: '2026-09-15', done: false, cat: 'ssc', estimateMinutes: 30 }),
      task('c', { date: TODAY, done: true, cat: 'upsc', estimateMinutes: 60 }),
      task('d', { date: TODAY, done: false, cat: 'ssc', estimateMinutes: 30 }),
    ],
    focus: {
      active: null,
      sessions: [
        { id: 'f1', categoryId: 'upsc', mode: 'focus', plannedMinutes: 60, focusedSeconds: 3600, startedAt: Date.parse('2026-09-14T09:00:00Z'), endedAt: Date.parse('2026-09-14T10:00:00Z'), status: 'completed', date: '2026-09-14' },
        { id: 'f2', categoryId: 'ssc', mode: 'focus', plannedMinutes: 30, focusedSeconds: 1800, startedAt: Date.parse('2026-09-16T09:00:00Z'), endedAt: Date.parse('2026-09-16T09:30:00Z'), status: 'completed', date: '2026-09-16' },
        { id: 'f3', categoryId: 'upsc', mode: 'focus', plannedMinutes: 45, focusedSeconds: 2700, startedAt: Date.parse('2026-09-17T09:00:00Z'), endedAt: Date.parse('2026-09-17T09:45:00Z'), status: 'completed', date: TODAY },
      ],
    },
    top3: { '2026-09-14': ['a'] },
  })
}

test('dayStats aggregates one day consistently', () => {
  const state = analyticsState()
  const stats = dayStats(state, '2026-09-15', { todayKey: TODAY, now: NOW })
  assert.equal(stats.blocksTotal, 3)
  assert.equal(stats.blocksDone, 1)
  assert.equal(stats.blocksElapsed, 3, 'past days count every block as elapsed')
  assert.equal(stats.adherence, 1 / 3)
  assert.equal(stats.tasksPlanned, 1)
  assert.equal(stats.tasksDone, 0)
  assert.equal(stats.focusedMinutes, 0)
  assert.equal(stats.top3Total, 0)
  assert.ok(stats.score >= 0 && stats.score <= 100)
  assert.equal(stats.overdueCount, 1, 'task b is overdue as of Thursday')
})

test('future days are not counted as failures', () => {
  const state = analyticsState()
  const stats = dayStats(state, '2026-09-19', { todayKey: TODAY, now: NOW })
  assert.equal(stats.blocksElapsed, 0)
  assert.equal(stats.hasAnyActivity, false)
})

test('day plans snapshot the timetable so history stays correct', () => {
  const state = analyticsState()
  const ctx = makeCtx()
  materializeDayPlan(state, TODAY)
  assert.equal(state.dayPlans[TODAY].length, 3)
  state.timetable = [{ id: 'x', time: '08:00', title: 'New plan', duration: 30, cat: 'upsc' }]
  assert.equal(dayPlanFor(state, TODAY).length, 3, 'snapshot wins for the recorded day')
  assert.equal(dayPlanFor(state, '2026-09-28').length, 1, 'unknown days use the live timetable')
  assert.ok(ctx)
})

test('rangeDayStats walks a range without gaps', () => {
  const state = analyticsState()
  const rows = rangeDayStats(state, '2026-09-14', '2026-09-17', { todayKey: TODAY, now: NOW })
  assert.deepEqual(rows.map((r) => r.dateKey), ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17'])
})

test('streak history marks meaningful days', () => {
  const state = analyticsState()
  const history = streakHistory(state, { todayKey: TODAY, now: NOW, days: 5 })
  assert.ok(history['2026-09-14'].focusedMinutes >= 60)
  assert.equal(history['2026-09-15'].top3Total, 0)
})

test('category insights blend blocks, tasks and focus', () => {
  const state = analyticsState()
  const rows = categoryInsights(state, { from: '2026-09-14', to: '2026-09-20', todayKey: TODAY })
  const upsc = rows.find((r) => r.categoryId === 'upsc')
  const ssc = rows.find((r) => r.categoryId === 'ssc')
  // blocks: 2 x 60 min x 4 elapsed days = 480, plus tasks (30 + 60) = 570
  assert.equal(upsc.plannedMinutes, 570)
  assert.equal(ssc.plannedMinutes, 300)
  assert.equal(upsc.focusedMinutes, 105)
  assert.ok(upsc.completionPct > ssc.completionPct)
  assert.equal(ssc.focusedMinutes, 30)
  assert.ok(rows.every((r) => r.score >= 0 && r.score <= 100))
})

test('strongest and weakest areas come with an actionable recommendation', () => {
  const rows = [
    { name: 'Polity', completionPct: 86, score: 86, itemsPlanned: 10, plannedMinutes: 600 },
    { name: 'Economy', completionPct: 58, score: 58, itemsPlanned: 10, plannedMinutes: 600 },
  ]
  const { strongest, weakest, recommendation } = strongestAndWeakest(rows)
  assert.equal(strongest.name, 'Polity')
  assert.equal(weakest.name, 'Economy')
  assert.match(recommendation, /Economy/)
  const single = strongestAndWeakest([rows[0]])
  assert.equal(single.weakest, null)
  assert.equal(strongestAndWeakest([]).strongest, null)
})

test('focus time-of-day finds the strongest band', () => {
  const sessions = [
    { mode: 'focus', startedAt: Date.parse('2026-09-14T06:00:00'), focusedSeconds: 3600, date: '2026-09-14' },
    { mode: 'focus', startedAt: Date.parse('2026-09-14T20:00:00'), focusedSeconds: 1800, date: '2026-09-14' },
  ]
  const result = focusTimeOfDay(sessions, { from: '2026-09-14', to: '2026-09-14' })
  assert.equal(result.bands.morning, 60)
  assert.equal(result.bands.evening, 30)
  assert.equal(result.best, 'morning')
})

test('planned load ranks busiest and lightest days', () => {
  const load = plannedLoadByDay([
    { dateKey: '2026-09-14', totalPlannedMinutes: 480, completedMinutes: 300, taskDoneMinutes: 0 },
    { dateKey: '2026-09-15', totalPlannedMinutes: 120, completedMinutes: 60, taskDoneMinutes: 0 },
  ])
  assert.equal(load.busiest.dateKey, '2026-09-14')
  assert.equal(load.lightest.dateKey, '2026-09-15')
  assert.equal(load.average, 300)
})

test('weekly review reports real numbers and actionable advice', () => {
  const state = analyticsState()
  const review = weeklyReview(state, { dateKey: TODAY, todayKey: TODAY, now: NOW })

  assert.deepEqual(weekRange(TODAY), { from: '2026-09-14', to: '2026-09-20', days: review.days })
  assert.equal(review.plannedMinutes, 1410, 'the whole week is planned')
  assert.equal(review.elapsedPlannedMinutes, 870, 'only elapsed days count for completion')
  assert.equal(review.completedMinutes, 450)
  assert.equal(review.completionPct, 52)
  assert.equal(review.focusedMinutes, 135)
  assert.equal(review.tasksPlanned, 4)
  assert.equal(review.tasksDone, 2)
  assert.equal(review.tasksDone && review.taskCompletionPct, 50)
  assert.equal(review.activeDays, 4)
  assert.equal(review.bestDay.dateKey, '2026-09-14')
  assert.equal(review.weakestDay.dateKey, '2026-09-15', 'today is not judged while it is running')
  assert.equal(review.strongestCategory.name, 'UPSC Core')
  assert.equal(review.weakestCategory.name, 'SSC · News · CA')
  assert.equal(review.overdueCount, 1)
  assert.ok(review.dayRows.length === 7)
  const categoryPlanned = review.categories.reduce((sum, c) => sum + c.plannedMinutes, 0)
  assert.equal(categoryPlanned, review.elapsedPlannedMinutes, 'category analytics and the review agree')
  assert.ok(review.recommendations.length > 0 && review.recommendations.length <= 4)
  assert.ok(review.recommendations.every((r) => typeof r.text === 'string' && r.text.length > 10))
  assert.ok(review.recommendations.some((r) => /SSC|focused|buffer|active day|overdue/i.test(r.text)))
})

test('weekly review handles an empty app without crashing', () => {
  const state = baseState()
  const review = weeklyReview(state, { dateKey: TODAY, todayKey: TODAY, now: NOW })
  assert.equal(review.plannedMinutes, 0)
  assert.equal(review.completionPct, 0)
  assert.equal(review.averageScore, 0)
  assert.ok(review.recommendations.length >= 1)
})
