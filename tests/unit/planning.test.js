import test from 'node:test'
import assert from 'node:assert/strict'
import { appliesOn, blockLabel, describeBlock, overlapMinutes, protectedConflicts, protectionAt, unprotectedMinutes } from '../../src/client/lib/protected.js'
import { applyRecovery, planRecovery, undoRecovery } from '../../src/client/lib/recovery.js'

const TODAY = '2026-09-15' // Tuesday

test('protected windows wrap midnight', () => {
  const sleep = { id: 'sleep', label: 'Sleep', start: '23:00', end: '06:00' }
  assert.equal(protectionAt(23 * 60 + 30, [sleep])?.label, 'Sleep')
  assert.equal(protectionAt(2 * 60, [sleep])?.label, 'Sleep')
  assert.equal(protectionAt(5 * 60 + 59, [sleep])?.label, 'Sleep')
  assert.equal(protectionAt(6 * 60, [sleep]), null)
  assert.equal(protectionAt(12 * 60, [sleep]), null)
  assert.equal(blockLabel(sleep), '23:00 → 06:00')
})

test('protected windows can be limited to weekdays', () => {
  const weekendLies = { id: 'w', label: 'Free morning', start: '08:00', end: '10:00', days: [0, 6] }
  assert.equal(appliesOn(weekendLies, '2026-09-19'), true) // Saturday
  assert.equal(appliesOn(weekendLies, TODAY), false)
  assert.equal(protectionAt(9 * 60, [weekendLies], TODAY), null)
  assert.equal(protectionAt(9 * 60, [weekendLies], '2026-09-19')?.label, 'Free morning')
  assert.equal(describeBlock(weekendLies), 'Sun/Sat · 08:00 → 10:00')
})

test('overlap maths handles both shapes', () => {
  assert.equal(overlapMinutes(22 * 60, 23 * 60 + 30, { start: '23:00', end: '06:00' }), 30)
  assert.equal(overlapMinutes(12 * 60, 13 * 60, { start: '12:30', end: '12:45' }), 15)
  assert.equal(overlapMinutes(1 * 60, 2 * 60, { start: '12:00', end: '13:00' }), 0)
})

test('timetable conflicts with protected time are reported', () => {
  const timetable = [
    { id: 'b1', time: '23:00', title: 'Late block', duration: 60, cat: 'upsc' },
    { id: 'b2', time: '10:00', title: 'Fine', duration: 60, cat: 'upsc' },
  ]
  const conflicts = protectedConflicts(timetable, [{ id: 'sleep', label: 'Sleep', start: '23:00', end: '06:00' }])
  assert.equal(conflicts.length, 1)
  assert.equal(conflicts[0].id, 'b1')
  assert.equal(conflicts[0].overlapMinutes, 60)
  assert.equal(conflicts[0].protectedLabel, 'Sleep')
})

test('unprotected minutes subtract protected time', () => {
  const blocks = [{ id: 's', label: 'Sleep', start: '23:00', end: '06:00' }]
  // 22:00 → 24:00 = 120 min, 60 of which are protected
  assert.equal(unprotectedMinutes(22 * 60, 24 * 60, blocks, TODAY), 60)
  assert.equal(unprotectedMinutes(9 * 60, 12 * 60, blocks, TODAY), 180)
})

const baseRecovery = {
  timetable: [
    { id: 'b1', time: '09:00', title: 'Geography', duration: 60, cat: 'upsc' },
    { id: 'b2', time: '10:30', title: 'Polity', duration: 60, cat: 'upsc' },
    { id: 'b3', time: '14:00', title: 'Revision', duration: 60, cat: 'ssc' },
  ],
  ttDone: [],
  nowMinutes: 11 * 60 + 30,
  dayEndMinutes: 23 * 60 + 30,
  todayKey: TODAY,
}

test('recovery detects what was missed and what is still ahead', () => {
  const plan = planRecovery(baseRecovery)
  assert.deepEqual(plan.missed.map((m) => m.title), ['Geography', 'Polity'])
  assert.deepEqual(plan.upcoming.map((u) => u.title), ['Revision'])
  assert.equal(plan.missedMinutes, 120)
  // 22:00 remaining (11:30 → 23:30) minus the 60-minute Revision block
  assert.equal(plan.availableMinutes, 660)
  assert.equal(plan.proposals.length, 2)
  assert.equal(plan.proposals[0].to.time, '11:35')
  assert.equal(plan.proposals[1].to.time, '12:40')
  assert.equal(plan.canApply, true)
  assert.ok(plan.notes.some((n) => n.includes('untouched')))
})

test('recovery compresses blocks when time is short', () => {
  const plan = planRecovery({
    ...baseRecovery,
    nowMinutes: 22 * 60, // only 90 minutes left, Revision already missed too
  })
  assert.equal(plan.missed.length, 3)
  assert.ok(plan.proposals.length >= 1)
  const total = plan.proposals.reduce((sum, p) => sum + p.to.duration, 0)
  assert.ok(total <= plan.availableMinutes + 5, 'never proposes more time than exists')
  assert.ok(plan.proposals.some((p) => p.compressed))
})

test('recovery never schedules inside protected time', () => {
  const plan = planRecovery({
    ...baseRecovery,
    nowMinutes: 11 * 60 + 30,
    protectedBlocks: [{ id: 'lunch', label: 'Lunch', start: '11:30', end: '13:00' }],
  })
  for (const proposal of plan.proposals) {
    const [h, m] = proposal.to.time.split(':').map(Number)
    const start = h * 60 + m
    const ends = start + proposal.to.duration
    assert.ok(start >= 13 * 60 || ends <= 11 * 60 + 30, `proposal ${proposal.to.time} avoids lunch`)
  }
})

test('recovery is quiet when nothing is missed', () => {
  const plan = planRecovery({ ...baseRecovery, ttDone: ['b1', 'b2'] })
  assert.equal(plan.missed.length, 0)
  assert.equal(plan.canApply, false)
  assert.ok(plan.notes.some((n) => n.includes('Nothing has been missed')))
})

test('applying and undoing a recovery plan is reversible', () => {
  const timetable = baseRecovery.timetable.map((b) => ({ ...b }))
  const plan = planRecovery({ ...baseRecovery, timetable })
  const snapshot = applyRecovery(timetable, plan.proposals)
  assert.equal(timetable[0].time, '11:35')
  assert.equal(timetable[1].time, '12:40')
  assert.equal(timetable[2].time, '14:00', 'untouched blocks keep their time')
  undoRecovery(timetable, snapshot)
  assert.equal(timetable[0].time, '09:00')
  assert.equal(timetable[1].time, '10:30')
})
