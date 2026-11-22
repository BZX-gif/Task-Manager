/**
 * PAPER — calculation & decision tests.
 *
 * These cover the deterministic core of the intelligence engine: the
 * workspace context, attention scoring, time intelligence, goal health,
 * pattern gating, alerts and the recommendation generator. Every assertion
 * here pins behaviour the product promises: honest evidence, reproducible
 * numbers, no fabricated insights, no mutation of user data.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { emptyState, makeContext } from '../../src/client/lib/state.js'
import { buildWorkspaceContext } from '../../src/client/lib/paper/context.js'
import { scoreMission, rankMissions, topObjectives, postponementCount } from '../../src/client/lib/paper/priorities.js'
import { dayLoad, weekLoad, freeWindows, proposeAllocation, remainingFreeToday, capacityMinutes } from '../../src/client/lib/paper/scheduling.js'
import { goalHealth, goalHealthAll, projectRisks, dependencyIssues } from '../../src/client/lib/paper/reasoning.js'
import { scoreTrend, focusWindows, consistency, repeatedPostponements, analyzePatterns } from '../../src/client/lib/paper/history.js'
import { generateAlerts, generateRecommendations, situationSummary } from '../../src/client/lib/paper/recommendations.js'
import { executiveBriefing, briefingNarrative } from '../../src/client/lib/paper/briefing.js'
import { recoveryBrief } from '../../src/client/lib/paper/recovery.js'

const TODAY = '2026-11-18'
const NOON = new Date(2026, 10, 18, 12, 0, 0)
const DAY_MS = 86400000
const NOON_TS = Date.parse('2026-11-18T12:00:00')

let n = 0
const fresh = () => emptyState(makeContext({ now: NOON_TS, id: () => `id${++n}` }))
const task = (id, over = {}) => ({
  id, title: `Mission ${id}`, date: TODAY, time: null, priority: 'medium', cat: null,
  notes: '', estimateMinutes: 30, done: false, status: 'ready', description: '', deadline: null,
  goalId: null, projectId: null, milestoneId: null, horizon: 'daily', subtasks: [], progress: null,
  history: [], protected: false, flexible: true, inbox: false, createdAt: NOON_TS - 3 * DAY_MS,
  completedAt: null, recurrence: null, seriesId: null, ...over,
})
const goal = (id, over = {}) => ({
  id, title: `Goal ${id}`, description: '', notes: '', deadline: null, targetDate: null,
  priority: 'medium', status: 'active', createdAt: NOON_TS - 2 * DAY_MS, progressMode: 'auto',
  manualProgress: 0, category: 'Personal', milestones: [], ...over,
})

test('buildWorkspaceContext reads the real store into plain facts', () => {
  const state = fresh()
  state.tasks.push(task('t1'), task('t2', { date: '2026-11-17', status: 'ready' }), task('t3', { done: true }))
  state.goals.push(goal('g1'))
  const ctx = buildWorkspaceContext(state, { now: NOON })
  assert.equal(ctx.todayKey, TODAY)
  assert.equal(ctx.nowMinutes, 720)
  assert.equal(ctx.openTasks.length, 2, 'completed work is not open')
  assert.equal(ctx.overdue.length, 1, 'yesterday’s unfinished mission is overdue')
  assert.equal(ctx.todayTasks.length, 1)
  assert.equal(ctx.goals[0].progressPct, 0)
  assert.ok(ctx.daysOfData && typeof ctx.daysOfData.scores === 'number', 'record depth is exposed for gating')
})

test('scoreMission explains its number with evidence and ranks overdue work first', () => {
  const ctx = { todayKey: TODAY, top3Ids: ['top'] }
  const late = scoreMission(task('late', { date: '2026-11-15' }), ctx)
  const freshTask = scoreMission(task('fresh', { date: TODAY }), ctx)
  assert.ok(late.score > freshTask.score, 'overdue outranks merely due today')
  assert.ok(late.reasons.some((r) => r.kind === 'calculation' && /Overdue by 3 days/.test(r.text)))
  assert.ok(freshTask.reasons.some((r) => r.kind === 'fact'))

  const top = scoreMission(task('top', { date: TODAY }), ctx)
  assert.ok(top.score > freshTask.score, 'Top 3 membership adds attention')
  assert.ok(top.reasons.some((r) => /Top 3/.test(r.text)))
})

test('postponement history decays a mission’s score', () => {
  const ctx = { todayKey: TODAY }
  const stable = scoreMission(task('s'), ctx)
  const pushedTask = task('p', {
    history: [{ at: 1, action: 'postponed', date: TODAY }, { at: 2, action: 'rescheduled', date: TODAY }, { at: 3, action: 'postponed', date: TODAY }],
  })
  const pushed = scoreMission(pushedTask, ctx)
  assert.equal(postponementCount(pushedTask), 3)
  assert.ok(pushed.score < stable.score - 5, 'repeated delays cost attention')
})

test('topObjectives fills the Top 3 in the user’s order, then by score', () => {
  const state = fresh()
  state.tasks.push(task('a', { priority: 'low' }), task('b', { date: '2026-11-10', priority: 'high' }), task('c', { priority: 'high' }))
  state.top3[TODAY] = ['a']
  const ctx = buildWorkspaceContext(state, { now: NOON })
  const objectives = topObjectives(state, ctx)
  assert.equal(objectives.length, 3)
  assert.equal(objectives[0].task.id, 'a', 'the chosen Top 3 comes first')
  assert.equal(objectives[0].source, 'top3')
  assert.ok(objectives.some((o) => o.task.id === 'b'), 'the most overdue fills the next slot')
})

test('day load is committed time against working capacity', () => {
  const state = fresh()
  state.schedule.days[TODAY] = [
    { id: 'b1', time: '09:00', title: 'Deep work', duration: 240, kind: 'mission', status: 'planned', flexible: true },
    { id: 'b2', time: '13:00', title: 'Sleep', duration: 60, kind: 'protected', status: 'planned', flexible: true },
  ]
  const load = dayLoad(state, TODAY, { settings: state.settings })
  assert.equal(load.capacityMinutes, 9 * 60, 'default working hours 09:00–18:00')
  assert.equal(load.committedMinutes, 240, 'rest blocks are never counted as commitments')
  assert.equal(load.status, 'balanced', '240 of 540 minutes is a balanced day')
  assert.ok(load.findings[0].text.includes('4h') && load.findings[0].text.includes('9h'), 'the numbers appear in the evidence')

  const week = weekLoad(state, TODAY, { days: 7, settings: state.settings })
  assert.equal(week.length, 7)
  assert.equal(week[1].committedMinutes, 0, 'no invented load on empty days')
})

test('free windows and allocations respect the real schedule and working hours', () => {
  const state = fresh()
  state.schedule.days[TODAY] = [{ id: 'b1', time: '13:00', title: 'Fixed', duration: 60, kind: 'mission', status: 'planned', flexible: true }]
  const ctx = buildWorkspaceContext(state, { now: NOON })
  const windows = freeWindows(state, TODAY, { fromMinutes: 720, settings: state.settings })
  assert.ok(windows.length >= 2)
  assert.equal(windows[0].start, 720, 'starts from now')
  const shortFit = proposeAllocation(state, ctx, { minutes: 60 })
  assert.equal(shortFit.dayKey, TODAY)
  assert.equal(shortFit.startLabel, '12:00', '60 minutes fit in the window before the 13:00 block')
  const longFit = proposeAllocation(state, ctx, { minutes: 90 })
  assert.equal(longFit.dayKey, TODAY)
  assert.equal(longFit.startLabel, '14:00', '90 minutes wait for a window that can actually hold them')
  assert.ok(longFit.findings[0].text.includes('1h 30m'), 'the proposal states its arithmetic')

  const big = proposeAllocation(state, ctx, { minutes: 480 })
  assert.equal(big.dayKey, '2026-11-19', 'an 8-hour block skips today and lands on the next day with room')
  const impossible = proposeAllocation(state, ctx, { minutes: 600 })
  assert.equal(impossible.dayKey, null, 'a 10-hour block exceeds every working day and is not pretended into one')
  assert.equal(impossible.findings[0].kind, 'missing', 'impossibility is reported as missing capacity')

  assert.equal(remainingFreeToday(ctx), 300, '60 min before the block + 240 min after it, from noon')
})

test('goal health is a transparent state machine with evidence', () => {
  const state = fresh()
  const atRisk = goal('g-risk', {
    targetDate: '2026-11-21', // three days out
    milestones: [{ id: 'm1', title: 'Ship', done: false, targetDate: '2026-11-21' }],
  })
  const stalled = goal('g-stall', { createdAt: NOON_TS - 20 * DAY_MS })
  const noNext = goal('g-idle')
  const closing = goal('g-closing', { milestones: [{ id: 'm2', title: 'Done bit', done: true, targetDate: null }] })
  const unrealistic = goal('g-utopia', {
    targetDate: '2026-11-20',
    milestones: [1, 2, 3, 4].map((i) => ({ id: `u${i}`, title: `Step ${i}`, done: false, targetDate: null })),
  })
  state.goals.push(atRisk, stalled, noNext, closing, unrealistic)
  state.tasks.push(task('w1', { goalId: 'g-risk' }), task('w2', { goalId: 'g-stall', date: null }))

  const ctx = buildWorkspaceContext(state, { now: NOON })
  const health = goalHealthAll(state, ctx)
  const byId = Object.fromEntries(health.map((h) => [h.goalId, h]))

  assert.equal(byId['g-risk'].status, 'at_risk', 'under half with three days left')
  assert.ok(byId['g-risk'].why.length >= 3, 'the verdict lists its reasons')
  assert.equal(byId['g-stall'].status, 'stalled', 'nothing completed in 14 days and older than a week')
  assert.equal(byId['g-idle'].status, 'no_next_step')
  assert.equal(byId['g-closing'].status, 'complete', 'all milestones done invites closing the goal, not more work')
  assert.equal(byId['g-utopia'].status, 'unrealistic', 'more open milestones than days remaining')
  assert.ok(byId['g-idle'].why.some((f) => f.kind === 'inference'))
})

test('goal health reports missing information instead of guessing', () => {
  const state = fresh()
  state.goals.push(goal('g-new'))
  const ctx = buildWorkspaceContext(state, { now: NOON })
  const health = goalHealth(state, ctx.goals[0], ctx)
  assert.ok(health.why.some((f) => f.kind === 'missing' && /No milestones/.test(f.text)))
  assert.ok(health.why.some((f) => f.kind === 'missing' && /No target date/.test(f.text)))
})

test('project and dependency risks come from records only', () => {
  const state = fresh()
  state.projects.push({ id: 'p1', title: 'Silent project', status: 'active', goalId: null, milestoneId: null, milestones: [], createdAt: 1, deadline: '2026-11-20', targetDate: null, priority: 'medium', description: '', notes: '', progressMode: 'auto', manualProgress: 0 })
  state.goals.push(goal('g-x'))
  state.tasks.push(task('t-x', { goalId: 'g-x' }))
  state.goals[0].status = 'cancelled'
  const ctx = buildWorkspaceContext(state, { now: NOON })
  const risks = projectRisks(state, ctx)
  assert.ok(risks.some((r) => r.projectId === 'p1' && r.reason === 'no_next_step'))
  const deps = dependencyIssues(state, ctx)
  assert.ok(deps.some((d) => d.taskId === 't-x' && /cancelled/.test(d.issue)))
})

test('patterns refuse to manufacture insights from thin data', () => {
  const state = fresh()
  const report = analyzePatterns(state, TODAY)
  assert.equal(report.insights.length, 0, 'no insights without data')
  assert.ok(report.missing.length >= 3, 'the gaps are stated explicitly')
  assert.equal(report.trend.trend, 'unknown')
  assert.equal(report.windows.enough, false)
  assert.equal(report.consistency.enough, false)
})

test('patterns emerge only once thresholds are met', () => {
  const state = fresh()
  for (let i = 0; i < 12; i += 1) {
    const key = `2026-11-${String(17 - i).padStart(2, '0')}`
    state.scoreHistory[key] = { score: i < 6 ? 40 : 80, focusedMinutes: 60, top3Done: 2, top3Total: 3, computedAt: 1 }
    state.completionLog[key] = { ttDone: ['x'], taskDone: [] }
  }
  for (let i = 0; i < 10; i += 1) {
    state.focus.sessions.push({ id: `s${i}`, mode: 'focus', startedAt: NOON_TS - i * DAY_MS + 5 * 3600000, focusedSeconds: 1500, plannedMinutes: 25, status: 'completed', date: TODAY })
  }
  const trend = scoreTrend(state, TODAY, { window: 6 })
  assert.equal(trend.trend, 'declining', 'the recent window averages well below the previous one')
  assert.ok(trend.why[0].kind === 'calculation')

  const windows = focusWindows(state)
  assert.equal(windows.enough, true)
  assert.ok(windows.bestWindow, 'a productive window is named')

  const consist = consistency(state, TODAY, { days: 12 })
  assert.equal(consist.enough, true)
  assert.ok(consist.activeDays >= 12)
})

test('repeated postponements surface as a pattern', () => {
  const state = fresh()
  state.tasks.push(task('drift', {
    history: [
      { at: 1, action: 'postponed', date: '2026-11-01' },
      { at: 2, action: 'postponed', date: '2026-11-05' },
      { at: 3, action: 'rescheduled', date: '2026-11-09' },
      { at: 4, action: 'postponed', date: '2026-11-12' },
    ],
  }))
  const movers = repeatedPostponements(state, { min: 3 })
  assert.equal(movers.length, 1)
  assert.equal(movers[0].pushes, 4)
})

test('alerts describe situations with real numbers', () => {
  const state = fresh()
  state.tasks.push(
    task('late1', { date: '2026-11-15' }),
    task('due', { deadline: '2026-11-20', goalId: null }),
  )
  const ctx = buildWorkspaceContext(state, { now: NOON })
  const alerts = generateAlerts(state, ctx)
  const overdue = alerts.find((a) => a.id === 'alert-overdue')
  assert.ok(overdue, 'overdue work raises an alert')
  assert.match(overdue.title, /1 mission is overdue/)
  const deadlines = alerts.find((a) => a.id === 'alert-deadlines')
  assert.ok(deadlines, 'a deadline within three days raises an alert')
  assert.match(deadlines.detail, /Mission due/)
})

test('the flagship recommendation: at-risk goal, no scheduled work, honest allocation', () => {
  const state = fresh()
  state.goals.push(goal('g-flag', {
    title: 'Launch the portfolio',
    targetDate: '2026-11-21', // due in three days
    milestones: [{ id: 'm1', title: 'First draft', done: false, targetDate: '2026-11-21' }],
  }))
  state.tasks.push(task('work', { goalId: 'g-flag', estimateMinutes: 90, title: 'Write the case study', date: null }))
  const ctx = buildWorkspaceContext(state, { now: NOON })
  const recs = generateRecommendations(state, ctx)
  const rec = recs.find((r) => r.id === 'rec-goal-g-flag')
  assert.ok(rec, 'a goal at risk with no scheduled work earns a recommendation')
  assert.match(rec.detail, /none is scheduled today/)
  assert.match(rec.detail, /target is in 3 days/i)
  assert.ok(rec.why.length >= 3, 'evidence includes goal reasons and the time proposal')
  assert.ok(rec.why.some((f) => /1h 30m fits today/.test(f.text)), 'the allocation is stated with its arithmetic')
  assert.ok(rec.action, 'a prepared action accompanies the advice')
  assert.equal(rec.action.kind, 'schedule_mission')
  assert.equal(rec.action.taskId, 'work')
  assert.equal(rec.action.dayKey, TODAY, 'allocation lands today when the time exists')
  assert.equal(rec.action.startLabel, '12:00')
  assert.ok(rec.impact && rec.nextStep, 'impact and next step are always present')
})

test('recommendations never mutate the workspace', () => {
  const state = fresh()
  state.tasks.push(task('late', { date: '2026-11-15' }))
  const before = JSON.stringify(state)
  const ctx = buildWorkspaceContext(state, { now: NOON })
  generateRecommendations(state, ctx)
  generateAlerts(state, ctx)
  executiveBriefing(state, ctx)
  assert.equal(JSON.stringify(state), before, 'read-only by contract')
})

test('overdue recovery advice groups urgent from deferrable work', () => {
  const state = fresh()
  state.tasks.push(
    task('urgent-late', { date: '2026-11-10', priority: 'high', title: 'Urgent one' }),
    task('soft-late', { date: '2026-11-17', priority: 'low', title: 'Soft one' }),
    task('mover', {
      title: 'Drifting one',
      history: [{ at: 1, action: 'postponed', date: '1' }, { at: 2, action: 'postponed', date: '2' }, { at: 3, action: 'postponed', date: '3' }],
    }),
  )
  const ctx = buildWorkspaceContext(state, { now: NOON })
  const brief = recoveryBrief(state, ctx)
  assert.ok(brief.urgent.some((u) => u.task.id === 'urgent-late'), 'aged, high-priority work is urgent')
  assert.ok(brief.canWait.some((u) => u.task.id === 'soft-late'), 'fresh low-priority work can wait')
  assert.ok(brief.abandonCandidates.some((c) => c.task.id === 'mover'), 'thrice-postponed work is flagged for a deliberate decision')
  assert.ok(brief.why.length >= 2)
})

test('the executive briefing composes situation, objectives and time honestly', () => {
  const state = fresh()
  state.tasks.push(task('t1', { title: 'Write the brief' }), task('t2', { title: 'Call the printer', date: '2026-11-15' }))
  state.top3[TODAY] = ['t1']
  const ctx = buildWorkspaceContext(state, { now: NOON })
  const briefing = executiveBriefing(state, ctx)
  assert.match(briefing.situation, /1 mission dated today/)
  assert.match(briefing.situation, /1 overdue/)
  assert.equal(briefing.objectives[0].title, 'Write the brief')
  assert.ok(briefing.time.findings[0].text.includes('deep work'), 'time evidence mentions focus')
  assert.ok(briefing.recommendations.length >= 1)
  assert.ok(briefing.findings.every((f) => ['fact', 'calculation', 'inference', 'recommendation', 'missing'].includes(f.kind)))
  const narrative = briefingNarrative(briefing)
  assert.match(narrative, /next move|situation|mission/i)
  assert.match(situationSummary(ctx), /free/)
})
