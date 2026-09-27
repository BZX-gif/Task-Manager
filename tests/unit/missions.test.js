import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyState, migrateState, normalizeTask, normalizeTimetableItem } from '../../src/client/lib/state.js'
import { activeMission, normalizeMissions } from '../../src/client/lib/missions.js'
import { buildAiContext } from '../../src/client/lib/ai-context.js'

test('fresh state starts on SSC and retains complete roadmap', () => {
  const state = emptyState({ now: 1, uid: () => 'id' })
  assert.equal(activeMission(state.missions).exam, 'SSC CGL')
  assert.deepEqual(Object.keys(state.missions.definitions), ['ssc_cgl_2027', 'ras_2028', 'upsc_cse_2028'])
})

test('v3 migration preserves records and adds default mission context', () => {
  const old = { version: 3, tasks: [{ id: 'old-task', title: 'Historical' }], timetable: [{ id: 'old-block', title: 'Old block' }], categories: [] }
  const { state, applied } = migrateState(old, { now: 123, uid: () => 'new' })
  assert.equal(state.version, 5)
  assert.ok(applied.includes('migrateStateV3ToV4'))
  assert.ok(applied.includes('migrateStateV4ToV5'))
  assert.equal(state.tasks[0].id, 'old-task')
  assert.equal(state.timetables.upsc_cse_2028[0].id, 'old-block', 'the legacy timetable is preserved as the UPSC schedule')
  assert.equal(activeMission(state.missions).id, 'ssc_cgl_2027')
})

test('mission switching and mission-scoped task/block IDs normalize safely', () => {
  const missions = normalizeMissions({ activeMissionId: 'ras_2028' })
  assert.equal(activeMission(missions).exam, 'RAS')
  assert.equal(missions.definitions.ssc_cgl_2027.status, 'future')
  assert.equal(normalizeTask({ title: 'task', missionId: 'ras_2028' }, { now: 0, uid: () => 'x' }).missionId, 'ras_2028')
  assert.equal(normalizeTimetableItem({ title: 'block', missionId: 'ras_2028' }, { uid: () => 'x' }).missionId, 'ras_2028')
})

test('assistant context identifies active mission and keeps other mission tasks out', () => {
  const state = emptyState()
  state.missions.activeMissionId = 'ssc_cgl_2027'
  state.tasks = [
    { id: 'a', title: 'SSC arithmetic', date: '2026-09-27', priority: 'high', missionId: 'ssc_cgl_2027' },
    { id: 'b', title: 'RAS polity', date: '2026-09-27', priority: 'high', missionId: 'ras_2028' },
  ]
  const text = buildAiContext(state, { todayKey: '2026-09-27', now: new Date('2026-09-27T10:00:00') })
  assert.match(text, /ACTIVE MISSION: SSC CGL 2027 → CBI Sub-Inspector → AIR 1/)
  assert.match(text, /SSC arithmetic/)
  assert.doesNotMatch(text, /RAS polity/)
})
