import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addDays,
  dateKey,
  diffDays,
  formatClock,
  formatDuration,
  isValidKey,
  minutesOfDay,
  monthKey,
  parseKey,
  startOfWeek,
  toHHMM,
  weekDates,
  weekdayOf,
} from '../../src/client/lib/dates.js'

test('dateKey formats local dates as YYYY-MM-DD', () => {
  assert.equal(dateKey(new Date(2026, 0, 5)), '2026-01-05')
  assert.equal(dateKey('2026-03-09T10:00:00Z'), '2026-03-09')
})

test('isValidKey rejects malformed and impossible dates', () => {
  assert.equal(isValidKey('2026-02-28'), true)
  assert.equal(isValidKey('2026-13-01'), false)
  assert.equal(isValidKey('2026-2-1'), false)
  assert.equal(isValidKey('not-a-date'), false)
  assert.equal(isValidKey(null), false)
})

test('addDays / diffDays are calendar-safe', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(addDays('2026-03-01', -1), '2026-02-28')
  assert.equal(diffDays('2026-09-01', '2026-09-15'), 14)
  assert.equal(diffDays('2026-09-15', '2026-09-01'), -14)
})

test('parseKey returns midday for DST safety', () => {
  const d = parseKey('2026-09-15')
  assert.equal(d.getHours(), 12)
  assert.equal(d.getFullYear(), 2026)
})

test('week helpers honour the week start', () => {
  // 2026-09-15 is a Tuesday
  assert.equal(weekdayOf('2026-09-15'), 2)
  assert.equal(startOfWeek('2026-09-15', 1), '2026-09-14')
  assert.equal(startOfWeek('2026-09-15', 0), '2026-09-13')
  const days = weekDates('2026-09-15', 1)
  assert.equal(days.length, 7)
  assert.equal(days[0], '2026-09-14')
  assert.equal(days[6], '2026-09-20')
})

test('time helpers convert both ways', () => {
  assert.equal(minutesOfDay('09:30'), 570)
  assert.equal(toHHMM(570), '09:30')
  assert.equal(toHHMM(1440 + 90), '01:30')
  assert.equal(formatDuration(200), '3h 20m')
  assert.equal(formatDuration(120), '2h')
  assert.equal(formatDuration(45), '45m')
  assert.equal(formatDuration(0), '0m')
  assert.equal(formatClock(65), '01:05')
  assert.equal(formatClock(3725), '1:02:05')
})

test('monthKey groups by month', () => {
  assert.equal(monthKey('2026-09-15'), '2026-09')
})
