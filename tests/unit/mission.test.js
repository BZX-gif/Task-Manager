import test from 'node:test'
import assert from 'node:assert/strict'
import { BREAK_PHASE, MISSION_MILESTONES, finalMinuteStage, milestoneCrossed, missionPhase, momentumChain } from '../../src/client/lib/mission.js'

test('mission phases follow the documented 25/50/90 boundaries', () => {
  assert.equal(missionPhase(0).key, 'warmup')
  assert.equal(missionPhase(0.249).key, 'warmup')
  assert.equal(missionPhase(0.25).key, 'momentum')
  assert.equal(missionPhase(0.499).key, 'momentum')
  assert.equal(missionPhase(0.5).key, 'deep')
  assert.equal(missionPhase(0.749).key, 'deep')
  assert.equal(missionPhase(0.75).key, 'deep', '75–90% stays in deep work (calm, stable)')
  assert.equal(missionPhase(0.899).key, 'deep')
  assert.equal(missionPhase(0.9).key, 'push')
  assert.equal(missionPhase(0.999).key, 'push')
  assert.equal(missionPhase(1).key, 'push', 'completion styling is separate from the phase')
})

test('phase labels match the spec and never make scientific claims', () => {
  assert.equal(missionPhase(0).label, 'WARMING UP')
  assert.equal(missionPhase(0.3).label, 'BUILDING MOMENTUM')
  assert.equal(missionPhase(0.6).label, 'DEEP WORK')
  assert.equal(missionPhase(0.95).label, 'FINAL PUSH')
  for (const milestone of MISSION_MILESTONES) {
    assert.doesNotMatch(milestone.text, /attention|cognitive|productivity score|brain/i)
  }
})

test('out-of-range or malformed ratios are clamped safely', () => {
  assert.equal(missionPhase(-2).key, 'warmup')
  assert.equal(missionPhase(7).key, 'push')
  assert.equal(missionPhase(Number.NaN).key, 'warmup')
  assert.equal(missionPhase(0.5, 'break').key, 'recharge')
  assert.equal(BREAK_PHASE.label, 'RECHARGING')
})

test('milestones fire exactly once at 25/50/75/90, never backwards', () => {
  assert.equal(milestoneCrossed(0.24, 0.26)?.at, 25)
  assert.equal(milestoneCrossed(0.24, 0.499)?.at, 25, 'a jump inside the band still reports the crossed edge')
  assert.equal(milestoneCrossed(0.26, 0.51)?.at, 50)
  assert.equal(milestoneCrossed(0.51, 0.76)?.at, 75)
  assert.equal(milestoneCrossed(0.76, 0.9)?.at, 90)
  assert.equal(milestoneCrossed(0, 0.95)?.at, 90, 'a large jump announces only the highest milestone')
  assert.equal(milestoneCrossed(0.26, 0.33), null, 'no crossing, no message')
  assert.equal(milestoneCrossed(0.6, 0.4), null, 'pausing/rewinding never re-fires')
  assert.equal(milestoneCrossed(0.5, 0.5), null)
  assert.match(milestoneCrossed(0.24, 0.26)?.text || '', /Warm-up complete/)
})

test('the final minute degrades gracefully: 60s → 10s → 3s', () => {
  assert.equal(finalMinuteStage(61), null)
  assert.deepEqual(finalMinuteStage(60), { key: 'final', hint: 'FINISH STRONG' })
  assert.deepEqual(finalMinuteStage(59.2), { key: 'final', hint: 'FINISH STRONG' })
  assert.deepEqual(finalMinuteStage(10), { key: 'almost', hint: 'Almost there.' })
  assert.deepEqual(finalMinuteStage(4), { key: 'almost', hint: 'Almost there.' })
  assert.equal(finalMinuteStage(3).key, 'count')
  assert.equal(finalMinuteStage(1).key, 'count')
  assert.equal(finalMinuteStage(0), null, 'zero is the goal-reached state, not a countdown stage')
  assert.equal(finalMinuteStage(Number.NaN), null)
})

test('the momentum chain is built from real sessions only, capped and ordered', () => {
  const sessions = [
    { id: 'a', date: '2026-09-16', mode: 'focus', status: 'completed' },
    { id: 'b', date: '2026-09-16', mode: 'focus', status: 'stopped' },
    { id: 'c', date: '2026-09-16', mode: 'break', status: 'completed' },
    { id: 'd', date: '2026-09-15', mode: 'focus', status: 'completed' },
  ]
  assert.deepEqual(momentumChain(sessions, '2026-09-16').nodes, [{ kind: 'done' }, { kind: 'partial' }])
  const withCurrent = momentumChain(sessions, '2026-09-16', { includeCurrent: true })
  assert.deepEqual(withCurrent.nodes.map((n) => n.kind), ['done', 'partial', 'current'])
  assert.equal(withCurrent.overflow, 0)
  assert.deepEqual(momentumChain([], '2026-09-16'), { nodes: [], overflow: 0 }, 'no history → no fabricated nodes')

  const many = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, date: '2026-09-16', mode: 'focus', status: 'completed' }))
  const capped = momentumChain(many, '2026-09-16', { includeCurrent: true, max: 6 })
  assert.equal(capped.nodes.length, 5)
  assert.equal(capped.overflow, 4, 'older nodes collapse into a counter instead of clutter')
})
