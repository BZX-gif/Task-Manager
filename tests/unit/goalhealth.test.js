import test from 'node:test'
import assert from 'node:assert/strict'
import { baseState, task } from '../helpers/fixtures.js'
import { goalEvidence, goalHealth, goalHealthReport, projectHealth, GOAL_HEALTH_META } from '../../src/client/lib/goalhealth.js'

const TODAY = '2026-09-17'
const NOW = new Date(2026, 8, 17, 11, 30, 0)
const DAY = 86400000
const ago = (days) => NOW.getTime() - days * DAY

function goal(id, extra = {}) {
  return {
    id,
    title: `Goal ${id}`,
    description: '',
    category: 'work',
    horizon: 'long_term',
    targetDate: null,
    progressMode: 'derived',
    status: 'active',
    createdAt: ago(60),
    milestones: [],
    ...extra,
  }
}

function stateWith(overrides) {
  return baseState({ goals: [], projects: [], tasks: [], focus: { active: null, sessions: [] }, ...overrides })
}

test('a goal with no connected work is quiet, not failing', () => {
  const state = stateWith({ goals: [goal('g1')] })
  const health = goalHealth(state.goals[0], state, TODAY, { now: NOW })
  assert.equal(health.status, 'quiet')
  assert.equal(health.tone, 'neutral')
  assert.match(health.reason, /No missions/)
  assert.equal(health.progress, 0)
})

test('recent completions plus focus make a goal on track', () => {
  const state = stateWith({
    goals: [goal('g1')],
    tasks: [
      task('t1', { goalId: 'g1', date: '2026-09-15', done: true, status: 'completed', completedAt: ago(2) }),
      task('t2', { goalId: 'g1', date: '2026-09-16', done: true, status: 'completed', completedAt: ago(1) }),
      task('t3', { goalId: 'g1', date: '2026-09-18', done: false }),
    ],
    focus: {
      active: null,
      sessions: [
        { id: 'f1', goalId: 'g1', mode: 'focus', plannedMinutes: 50, focusedSeconds: 3000, startedAt: ago(2), endedAt: ago(2) + 3000000, status: 'completed', date: '2026-09-15' },
      ],
    },
  })
  const health = goalHealth(state.goals[0], state, TODAY, { now: NOW })
  assert.equal(health.status, 'on_track')
  assert.ok(health.momentum >= 40, `momentum was ${health.momentum}`)
  assert.equal(health.daysSinceTouch, 1)
})

test('nothing moving for three weeks reads as drifting, honestly dated', () => {
  const state = stateWith({
    goals: [goal('g1')],
    tasks: [
      task('t1', { goalId: 'g1', date: '2026-08-01', done: true, status: 'completed', completedAt: ago(26) }),
      task('t2', { goalId: 'g1', date: '2026-09-25', done: false }),
    ],
  })
  const health = goalHealth(state.goals[0], state, TODAY, { now: NOW })
  assert.equal(health.status, 'drifting')
  assert.match(health.reason, /26 days/)
})

test('an approaching target with low progress is caught before it is too late', () => {
  const state = stateWith({
    goals: [goal('g1', { targetDate: '2026-09-25' })],
    tasks: [
      task('t1', { goalId: 'g1', date: '2026-09-16', done: true, status: 'completed', completedAt: ago(1) }),
      task('t2', { goalId: 'g1', date: '2026-09-18', done: false }),
      task('t3', { goalId: 'g1', date: '2026-09-19', done: false }),
      task('t4', { goalId: 'g1', date: '2026-09-20', done: false }),
    ],
  })
  const health = goalHealth(state.goals[0], state, TODAY, { now: NOW })
  assert.equal(health.status, 'drifting')
  assert.equal(health.daysToTarget, 8)
  assert.match(health.reason, /Target date is 8 days away/)
})

test('a completed goal is achieved regardless of other signals', () => {
  const state = stateWith({ goals: [goal('g1', { status: 'completed' })] })
  const health = goalHealth(state.goals[0], state, TODAY, { now: NOW })
  assert.equal(health.status, 'achieved')
  assert.equal(health.progress, 100)
  assert.equal(GOAL_HEALTH_META.achieved.tone, 'positive')
})

test('evidence includes project work and focus history', () => {
  const state = stateWith({
    goals: [goal('g1')],
    projects: [{ id: 'p1', title: 'P', goalId: 'g1', status: 'active', milestones: [] }],
    tasks: [task('t1', { projectId: 'p1', done: true, status: 'completed', completedAt: ago(3) })],
  })
  const evidence = goalEvidence(state, 'g1', TODAY, { now: NOW })
  assert.equal(evidence.tasks.length, 1)
  assert.equal(evidence.projects.length, 1)
  assert.equal(evidence.completedLast21, 1)
  assert.equal(evidence.daysSinceTouch, 3)
})

test('the report orders the goals that need attention first', () => {
  const state = stateWith({
    goals: [goal('drift', { targetDate: '2026-08-01' }), goal('quiet'), goal('fresh')],
    tasks: [
      task('t1', { goalId: 'drift', date: '2026-08-02', done: true, status: 'completed', completedAt: ago(40) }),
      task('t4', { goalId: 'drift', date: '2026-09-30', done: false }),
      task('t2', { goalId: 'fresh', date: '2026-09-16', done: true, status: 'completed', completedAt: ago(1) }),
      task('t3', { goalId: 'fresh', date: '2026-09-17', done: true, status: 'completed', completedAt: ago(0.5) }),
    ],
  })
  const report = goalHealthReport(state, TODAY, { now: NOW })
  assert.equal(report.summary.total, 3)
  assert.equal(report.summary.needingAttention, 2)
  assert.equal(report.attention[0].goal.id, 'drift')
  assert.ok(report.summary.averageProgress >= 0)
})

test('project health understands due dates and empty projects', () => {
  const state = stateWith({})
  assert.equal(projectHealth({ id: 'p1', status: 'completed' }, state, TODAY).status, 'achieved')
  assert.equal(projectHealth({ id: 'p2', status: 'active' }, state, TODAY).status, 'quiet')
  const overdue = projectHealth({ id: 'p3', status: 'active', dueDate: '2026-09-10', progressMode: 'manual', manualProgress: 20 }, state, TODAY)
  assert.equal(overdue.status, 'drifting')
  assert.equal(overdue.daysLeft, -7)
})
