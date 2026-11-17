import test from 'node:test'
import assert from 'node:assert/strict'
import { baseState, makeCtx } from '../helpers/fixtures.js'
import {
  STARTER_PRESETS,
  applyDemo,
  applyStarter,
  buildDemoWorkspace,
  buildStarter,
  isFreshWorkspace,
} from '../../src/client/lib/starters.js'
import { normalizeState } from '../../src/client/lib/state.js'

const TODAY = '2026-09-17'
const NOW = new Date(2026, 8, 17, 11, 30, 0).getTime()

function ctx() {
  const c = makeCtx({ now: NOW })
  return c
}

test('every advertised preset builds a coherent starter', () => {
  assert.equal(STARTER_PRESETS.length, 4)
  for (const preset of STARTER_PRESETS) {
    const starter = buildStarter(preset.id, { today: TODAY, now: NOW, uid: ctx().uid })
    assert.ok(starter, preset.id)
    assert.equal(starter.goals.length, 2)
    assert.ok(starter.projects.length >= 2)
    assert.ok(starter.tasks.length >= 5)
    assert.ok(starter.routines.length >= 1)
    assert.equal(starter.counts.goals, starter.goals.length)
    // Links resolve inside the starter.
    const goalIds = new Set(starter.goals.map((g) => g.id))
    const projectIds = new Set(starter.projects.map((p) => p.id))
    for (const task of starter.tasks) {
      if (task.goalId) assert.ok(goalIds.has(task.goalId), `${preset.id}: dangling goal link`)
      if (task.projectId) assert.ok(projectIds.has(task.projectId), `${preset.id}: dangling project link`)
    }
    for (const block of starter.scheduleDays[TODAY]) {
      if (block.taskId) assert.ok(starter.tasks.some((t) => t.id === block.taskId))
    }
    assert.equal(starter.top3.length, 3)
    assert.equal(new Set(starter.tasks.map((t) => t.id)).size, starter.tasks.length, 'ids are unique')
  }
})

test('an unknown preset builds nothing rather than guessing', () => {
  assert.equal(buildStarter('nope', { today: TODAY, now: NOW, uid: ctx().uid }), null)
})

test('applying a starter writes ordinary, normalisable records', () => {
  const state = baseState({ goals: [], projects: [], tasks: [], routines: [], schedule: { days: {}, history: [] } })
  const starter = buildStarter('founder', { today: TODAY, now: NOW, uid: ctx().uid })
  const result = applyStarter(state, starter)
  assert.equal(result.applied, true)
  assert.equal(state.goals.length, 2)
  assert.equal(state.tasks.length, starter.tasks.length)
  assert.equal(state.schedule.days[TODAY].length, starter.scheduleDays[TODAY].length)
  assert.equal(state.onboarding.completed, true)
  assert.equal(state.onboarding.preset, 'founder')

  const normalized = normalizeState(state, ctx())
  assert.equal(normalized.goals.length, 2)
  assert.equal(normalized.tasks.length, starter.tasks.length)
  assert.ok(normalized.tasks.every((t) => t.title && t.id))
})

test('the demo workspace is rich, dated relative to today and internally linked', () => {
  const demo = buildDemoWorkspace({ today: TODAY, now: NOW, uid: ctx().uid })
  assert.ok(demo.goals.length >= 4)
  assert.ok(demo.projects.length >= 3)
  assert.ok(demo.tasks.length >= 15)
  assert.ok(demo.focusSessions.length >= 10)
  assert.ok(demo.tasks.some((t) => t.date === TODAY))
  assert.ok(demo.tasks.some((t) => t.done))
  assert.ok(demo.tasks.some((t) => t.inbox))
  assert.ok(Object.keys(demo.journal).length >= 3)
  const goalIds = new Set(demo.goals.map((g) => g.id))
  assert.ok(demo.projects.every((p) => goalIds.has(p.goalId)))
  assert.equal(new Set(demo.tasks.map((t) => t.id)).size, demo.tasks.length)
})

test('applying the demo keeps every number grounded in its records', () => {
  const state = baseState({ goals: [], projects: [], tasks: [], routines: [], schedule: { days: {}, history: [] }, focus: { active: null, sessions: [] } })
  const demo = buildDemoWorkspace({ today: TODAY, now: NOW, uid: ctx().uid })
  applyDemo(state, demo, { today: TODAY })
  assert.equal(state.focus.sessions.length, demo.focusSessions.length)
  assert.equal(state.top3[TODAY].length, 3)
  assert.equal(state.onboarding.preset, 'demo')
  assert.match(state.briefing.intentions[TODAY], /narrative/)
})

test('a fresh workspace is recognised, and any real record changes that', () => {
  const fresh = baseState({ tasks: [], goals: [], projects: [], routines: [], schedule: { days: {}, history: [] }, focus: { active: null, sessions: [] } })
  assert.equal(isFreshWorkspace(fresh), true)
  fresh.tasks.push({ id: 't', title: 'Something real', done: false })
  assert.equal(isFreshWorkspace(fresh), false)
})
