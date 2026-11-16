import test from 'node:test'
import assert from 'node:assert/strict'
import { parseQuickCapture, priorityLabel, recurrenceLabel, weekdayFromName } from '../../src/client/lib/quickparse.js'

const NOW = new Date('2026-11-16T10:00:00') // Monday
const CATEGORIES = [
  { id: 'work', name: 'Work' },
  { id: 'learning', name: 'Learning' },
  { id: 'life-admin', name: 'Life admin' },
]

const parse = (input) => parseQuickCapture(input, { now: NOW, categories: CATEGORIES })

test('plain text stays plain', () => {
  const result = parse('Buy milk')
  assert.equal(result.title, 'Buy milk')
  assert.equal(result.date, null)
  assert.equal(result.time, null)
  assert.equal(result.priority, null)
  assert.equal(result.hasAnything, false)
})

test('keywords are stripped and resolved into fields', () => {
  const result = parse('Pay electricity bill tomorrow at 6pm for 15m !high #life')
  assert.equal(result.title, 'Pay electricity bill')
  assert.equal(result.date, '2026-11-17')
  assert.equal(result.time, '18:00')
  assert.equal(result.estimateMinutes, 15)
  assert.equal(result.priority, 'high')
  assert.equal(result.categoryId, 'life-admin')
  assert.equal(result.hasAnything, true)
})

test('relative days and weekdays', () => {
  assert.equal(parse('Call mom today').date, '2026-11-16')
  assert.equal(parse('Call mom tomorrow').date, '2026-11-17')
  assert.equal(parse('Call mom day after tomorrow').date, '2026-11-18')
  assert.equal(parse('Submit form next friday').date, '2026-11-20')
  assert.equal(parse('Standup this monday').date, '2026-11-16')
  assert.equal(parse('Gym friday').date, '2026-11-20')
})

test('explicit dates are understood', () => {
  assert.equal(parse('Review notes 20/11').date, '2026-11-20')
  assert.equal(parse('Review notes 2026-12-01').date, '2026-12-01')
  assert.equal(parse('Review notes Nov 20').date, '2026-11-20')
  assert.equal(parse('Review notes 20 Nov').date, '2026-11-20')
  // A bare day/month already behind us rolls to next year.
  assert.equal(parse('Taxes 05/04').date, '2027-04-05')
})

test('times accept multiple shapes', () => {
  assert.equal(parse('Sync at 9:30am').time, '09:30')
  assert.equal(parse('Sync 9:30 pm').time, '21:30')
  assert.equal(parse('Sync 21:30').time, '21:30')
  assert.equal(parse('Sync noon').time, '12:00')
  assert.equal(parse('Sync midnight').time, '00:00')
  assert.equal(parse('Sync at 12am').time, '00:00')
  assert.equal(parse('Sync at 12pm').time, '12:00')
})

test('tonight implies an evening start when no time is given', () => {
  const result = parse('Read a chapter tonight')
  assert.equal(result.date, '2026-11-16')
  assert.equal(result.time, '20:00')
  assert.equal(result.impliedTime, '20:00')

  const explicit = parse('Read a chapter tonight at 10pm')
  assert.equal(explicit.time, '22:00')
  assert.equal(explicit.impliedTime, null)
})

test('durations clamp to a sane range', () => {
  assert.equal(parse('Write report 45m').estimateMinutes, 45)
  assert.equal(parse('Write report for 1.5h').estimateMinutes, 90)
  assert.equal(parse('Write report 2 hours').estimateMinutes, 120)
  assert.equal(parse('Write report 3 minutes').estimateMinutes, null, 'too short to be real')
  assert.equal(parse('Write report 12 hours').estimateMinutes, null, 'too long to be real')
})

test('priority markers', () => {
  assert.equal(parse('Ship it !high').priority, 'high')
  assert.equal(parse('Ship it p1').priority, 'high')
  assert.equal(parse('Ship it !!').priority, 'high')
  assert.equal(parse('Tidy desk !low').priority, 'low')
  assert.equal(parse('Tidy desk !m').priority, 'medium')
  assert.equal(priorityLabel('high'), 'High priority')
})

test('categories resolve by id, name or prefix', () => {
  assert.equal(parse('Plan sprint #work').categoryId, 'work')
  assert.equal(parse('Plan sprint #Life-Admin').categoryId, 'life-admin')
  assert.equal(parse('Plan sprint #learn').categoryId, 'learning')
  assert.equal(parse('Plan sprint #unknown').categoryId, null)
  assert.equal(parse('Plan sprint #unknown').title, 'Plan sprint #unknown', 'unknown tags stay in the title')
})

test('repetition is parsed into a recurrence', () => {
  const daily = parse('Standup daily').recurrence
  assert.equal(daily.freq, 'daily')
  assert.equal(daily.startDate, '2026-11-16')

  const weekdays = parse('Deep work every weekday').recurrence
  assert.equal(weekdays.freq, 'weekdays')
  assert.deepEqual(weekdays.weekdays, [1, 2, 3, 4, 5])

  const weekly = parse('Team sync every monday').recurrence
  assert.equal(weekly.freq, 'weekly')
  assert.deepEqual(weekly.weekdays, [1])

  const multi = parse('Study every mon, wed and fri').recurrence
  assert.deepEqual(multi.weekdays, [1, 3, 5])

  const monthly = parse('Rent every 1st').recurrence
  assert.equal(monthly.freq, 'monthly')
  assert.equal(monthly.dayOfMonth, 1)

  assert.equal(parse('One-off task').recurrence, null)
})

test('recurrence labels read naturally', () => {
  assert.equal(recurrenceLabel({ freq: 'daily' }), 'Every day')
  assert.equal(recurrenceLabel({ freq: 'weekdays' }), 'Weekdays')
  assert.equal(recurrenceLabel({ freq: 'weekly', weekdays: [1, 3] }), 'Every monday, wednesday')
  assert.equal(recurrenceLabel({ freq: 'monthly', dayOfMonth: 1 }), 'Monthly · day 1')
  assert.equal(recurrenceLabel(null), '')
})

test('a fully loaded sentence leaves only the task behind', () => {
  const result = parse('Draft the essay every monday 6:30pm for 90m !high #learning')
  assert.equal(result.title, 'Draft the essay')
  assert.equal(result.time, '18:30')
  assert.equal(result.estimateMinutes, 90)
  assert.equal(result.priority, 'high')
  assert.equal(result.categoryId, 'learning')
  assert.equal(result.recurrence.freq, 'weekly')
  assert.deepEqual(result.matches.map((m) => m.kind).sort(), ['category', 'duration', 'priority', 'recurrence', 'time'])
})

test('weekday aliases resolve', () => {
  assert.equal(weekdayFromName('monday'), 1)
  assert.equal(weekdayFromName('mon'), 1)
  assert.equal(weekdayFromName('fri'), 5)
  assert.equal(weekdayFromName('notaday'), -1)
})

test('empty input is handled without throwing', () => {
  const result = parseQuickCapture('', { now: NOW })
  assert.equal(result.title, '')
  assert.equal(result.hasAnything, false)
})
