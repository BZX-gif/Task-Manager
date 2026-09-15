import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildOccurrence,
  materializeOccurrences,
  nextOccurrence,
  nextOccurrenceAfterCompletion,
  normalizeRecurrence,
  occurrenceKey,
  occursOn,
  occurrencesBetween,
  recurrenceLabel,
  seriesKeyOf,
} from '../../src/client/lib/recurrence.js'

let counter = 0
const uid = () => `gen${++counter}`

test('normalizeRecurrence sanitises junk', () => {
  assert.equal(normalizeRecurrence(null), null)
  const rec = normalizeRecurrence({ freq: 'nope', weekdays: [3, 3, 9, 1], dayOfMonth: 99, startDate: 'x' })
  assert.equal(rec.freq, 'daily')
  assert.deepEqual(rec.weekdays, [1, 3])
  assert.equal(rec.dayOfMonth, null)
  assert.equal(rec.startDate, null)
})

test('daily recurrence hits every day', () => {
  const rec = { freq: 'daily', startDate: '2026-09-01' }
  assert.equal(occursOn(rec, '2026-09-15'), true)
  assert.equal(occursOn(rec, '2026-08-31'), false, 'before the start date')
  assert.equal(occursOn({ ...rec, endDate: '2026-09-10' }, '2026-09-15'), false, 'after the end date')
})

test('selected weekdays only fire on those days', () => {
  const rec = { freq: 'weekdays', weekdays: [1, 3, 5] } // Mon/Wed/Fri
  assert.equal(occursOn(rec, '2026-09-14'), true) // Monday
  assert.equal(occursOn(rec, '2026-09-15'), false) // Tuesday
  assert.equal(occursOn(rec, '2026-09-16'), true) // Wednesday
  assert.equal(occursOn(rec, '2026-09-18'), true) // Friday
  assert.equal(occursOn(rec, '2026-09-19'), false) // Saturday
})

test('weekly defaults to the weekday of the start date', () => {
  const rec = { freq: 'weekly', startDate: '2026-09-13' } // Sunday
  assert.equal(occursOn(rec, '2026-09-20'), true)
  assert.equal(occursOn(rec, '2026-09-21'), false)
  assert.equal(nextOccurrence(rec, '2026-09-14'), '2026-09-20')
})

test('monthly clamps to the end of short months', () => {
  const rec = { freq: 'monthly', dayOfMonth: 31 }
  assert.equal(occursOn(rec, '2026-01-31'), true)
  assert.equal(occursOn(rec, '2026-02-28'), true, 'clamped to the last day of February')
  assert.equal(occursOn(rec, '2026-02-27'), false)
  assert.equal(occursOn(rec, '2026-04-30'), true, 'clamped to the last day of April')
})

test('nextOccurrence walks forward deterministically', () => {
  const rec = { freq: 'weekdays', weekdays: [0] } // Sundays
  assert.equal(nextOccurrence(rec, '2026-09-15'), '2026-09-20')
  assert.equal(nextOccurrence(rec, '2026-09-20', { inclusive: true }), '2026-09-20')
  assert.equal(nextOccurrence({ freq: 'daily', endDate: '2026-09-16' }, '2026-09-16'), null)
})

test('occurrencesBetween counts a range', () => {
  assert.equal(occurrencesBetween({ freq: 'daily' }, '2026-09-01', '2026-09-10'), 10)
  // Mondays in September 2026: 7, 14, 21, 28
  assert.equal(occurrencesBetween({ freq: 'weekdays', weekdays: [1] }, '2026-09-01', '2026-09-30'), 4)
})

test('materializeOccurrences never duplicates a series/date pair', () => {
  const template = {
    id: 'series1',
    title: 'Current Affairs',
    date: '2026-09-15',
    cat: 'ssc',
    priority: 'high',
    estimateMinutes: 45,
    done: false,
    createdAt: 1,
    recurrence: { freq: 'daily' },
  }
  const first = materializeOccurrences({ tasks: [template], todayKey: '2026-09-15', horizonDays: 3, uid })
  assert.equal(first.created.length, 3, 'today already exists as the template occurrence')
  assert.deepEqual(first.created.map((t) => t.date), ['2026-09-16', '2026-09-17', '2026-09-18'])
  assert.equal(first.created[0].seriesId, 'series1')
  assert.equal(first.created[0].priority, 'high')
  assert.equal(first.created[0].done, false)

  const tasks = [template, ...first.created]
  const second = materializeOccurrences({ tasks, todayKey: '2026-09-15', horizonDays: 3, uid })
  assert.equal(second.created.length, 0, 'a second run creates nothing new')

  const wider = materializeOccurrences({ tasks, todayKey: '2026-09-15', horizonDays: 6, uid })
  assert.equal(wider.created.length, 3, 'only the newly covered days are added')
})

test('materializeOccurrences respects weekday rules and the horizon', () => {
  const template = {
    id: 'series2',
    title: 'Workout',
    date: '2026-09-14',
    cat: 'body',
    priority: 'medium',
    estimateMinutes: 45,
    createdAt: 1,
    recurrence: { freq: 'weekdays', weekdays: [1, 3, 5] },
  }
  const { created } = materializeOccurrences({ tasks: [template], todayKey: '2026-09-14', horizonDays: 7, uid })
  assert.deepEqual(created.map((t) => t.date), ['2026-09-16', '2026-09-18', '2026-09-21'])
})

test('completing an occurrence rolls the series forward exactly once', () => {
  const template = {
    id: 's3',
    title: 'Weekly Revision',
    date: '2026-09-13',
    priority: 'high',
    cat: 'upsc',
    estimateMinutes: 120,
    createdAt: 1,
    recurrence: { freq: 'weekly', weekdays: [0] },
  }
  const occurrence = { ...buildOccurrence(template, '2026-09-13', { uid }), id: 'occ1', done: true, completedAt: 5 }
  const tasks = [template, occurrence]
  const next = nextOccurrenceAfterCompletion(occurrence, tasks, { uid })
  assert.ok(next)
  assert.equal(next.date, '2026-09-20')
  assert.equal(next.seriesId, 's3')

  const withNext = [...tasks, next]
  assert.equal(nextOccurrenceAfterCompletion(occurrence, withNext, { uid }), null, 'no duplicates')
})

test('series keys identify occurrences', () => {
  assert.equal(seriesKeyOf({ id: 'a', date: '2026-09-15', recurrence: { freq: 'daily' } }), occurrenceKey('a', '2026-09-15'))
  assert.equal(seriesKeyOf({ id: 'b', seriesId: 'a', occurrenceDate: '2026-09-16', date: '2026-09-16' }), occurrenceKey('a', '2026-09-16'))
  assert.equal(seriesKeyOf({ id: 'c', date: '2026-09-15', recurrence: null }), null)
})

test('recurrence labels are human readable', () => {
  assert.equal(recurrenceLabel({ freq: 'daily' }), 'Every day')
  assert.equal(recurrenceLabel({ freq: 'weekdays', weekdays: [1, 3, 5] }), 'Mon / Wed / Fri')
  assert.equal(recurrenceLabel({ freq: 'weekly', weekdays: [0] }), 'Weekly on Sun')
  assert.equal(recurrenceLabel({ freq: 'monthly', dayOfMonth: 5 }), 'Monthly on day 5')
  assert.equal(recurrenceLabel(null), 'Does not repeat')
})
