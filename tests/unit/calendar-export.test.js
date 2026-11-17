import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyState, makeContext } from '../../src/client/lib/state.js'
import {
  buildCalendar, buildIcs, buildDaySheet, calendarFilename, escapeIcsText,
  foldIcsLine, isRestBlock,
} from '../../src/client/lib/calendar-export.js'

const TODAY = '2026-09-15'
let id = 0
const ctx = () => makeContext({ now: new Date(2026, 8, 15, 9, 0, 0).getTime(), id: () => `id${++id}` })

function workspace() {
  const state = emptyState(ctx())
  state.schedule.days[TODAY] = [
    { id: 'b1', time: '09:00', duration: 90, title: 'Deep work: investor update', cat: 'work', priority: 'high' },
    { id: 'b2', time: '11:00', duration: 30, title: 'Coffee with Maya', cat: 'work' },
    { id: 'rest', time: '13:00', duration: 60, title: 'Lunch & walk', cat: 'wellbeing' },
    { id: 'sleep', time: '23:00', duration: 420, title: 'Sleep', cat: 'wellbeing' },
  ]
  state.schedule.days['2026-09-16'] = [
    { id: 'b3', time: '10:00', duration: 45, title: 'Architect call', cat: 'work' },
  ]
  state.tasks.push(
    { id: 't1', title: 'Write the appendix', date: TODAY, time: '15:00', estimateMinutes: 45, priority: 'medium', cat: 'work', done: false, status: 'ready', inbox: false, subtasks: [] },
    { id: 't2', title: 'Read the brief', date: TODAY, time: null, estimateMinutes: 25, priority: 'low', cat: 'work', done: false, status: 'ready', inbox: false, subtasks: [] },
  )
  return state
}

test('recovery blocks are excluded from a calendar export while real breaks stay', () => {
  assert.equal(isRestBlock({ title: 'Sleep', duration: 420 }), true)
  assert.equal(isRestBlock({ title: 'Rest and recharge' }), true)
  assert.equal(isRestBlock({ title: 'Recovery walk' }), false)
  assert.equal(isRestBlock({ title: 'Deep work', duration: 90 }), false)
  const state = workspace()
  const events = buildCalendar(state, { from: TODAY, days: 1 })
  assert.ok(!events.some((event) => event.title === 'Sleep'))
  assert.ok(events.some((event) => event.title === 'Lunch & walk'), 'a planned lunch is a real commitment')
  assert.ok(events.some((event) => event.title === 'Coffee with Maya'))
})

test('timed missions appear once, untimed missions become all-day events', () => {
  const events = buildCalendar(workspace(), { from: TODAY, days: 1 })
  const investor = events.filter((event) => event.title.includes('Deep work'))
  assert.equal(investor.length, 1)
  const allDay = events.find((event) => event.title === 'Read the brief')
  assert.ok(allDay)
  assert.equal(allDay.allDay, true)
  assert.equal(allDay.duration, 25)
})

test('the range is honoured and results are chronologically sorted', () => {
  const events = buildCalendar(workspace(), { from: TODAY, days: 2 })
  assert.ok(events.some((event) => event.title === 'Architect call'))
  const days = events.map((event) => event.day)
  assert.deepEqual([...days].sort(), days)
  const single = buildCalendar(workspace(), { from: TODAY, days: 1 })
  assert.ok(!single.some((event) => event.title === 'Architect call'))
})

test('ICS escaping, line folding and required properties are correct', () => {
  assert.equal(escapeIcsText('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne')
  const folded = foldIcsLine(`SUMMARY:${'x'.repeat(200)}`)
  for (const line of folded.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, 'every folded line fits 75 octets')
  assert.ok(folded.split('\r\n').slice(1).every((line) => line.startsWith(' ')))

  const state = workspace()
  state.schedule.days[TODAY].push({ id: 'b4', time: '16:00', duration: 30, title: 'Review; plan, next week', cat: 'work' })
  const ics = buildIcs(buildCalendar(state, { from: TODAY, days: 1 }), { now: new Date(2026, 8, 15, 9, 0, 0) })
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/)
  assert.match(ics, /END:VCALENDAR$/)
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, (ics.match(/END:VEVENT/g) || []).length)
  assert.match(ics, /SUMMARY:Review\\; plan\\, next week/)
  assert.match(ics, /DTSTART:20260915T090000Z/)
  assert.match(ics, /UID:20260915-b1@command\.local/)
  assert.match(ics, /X-WR-CALNAME:Command/)
})

test('all-day events use DATE values with an exclusive end date', () => {
  const ics = buildIcs(buildCalendar(workspace(), { from: TODAY, days: 1 }))
  assert.match(ics, /DTSTART;VALUE=DATE:20260915/)
  assert.match(ics, /DTEND;VALUE=DATE:20260916/)
})

test('the day sheet contains only what belongs on paper', () => {
  const sheet = buildDaySheet(workspace(), TODAY, { now: new Date(2026, 8, 15, 7, 0, 0) })
  assert.equal(sheet.date, TODAY)
  assert.ok(sheet.blocks.length >= 2)
  assert.ok(!sheet.blocks.some((block) => block.title === 'Sleep'))
  assert.ok(sheet.missions.some((mission) => mission.title === 'Read the brief'))
  assert.equal(sheet.priorities.length, 0)
  assert.ok(sheet.plannedMinutes > 0)
  assert.equal(sheet.count, sheet.blocks.length + sheet.missions.length)
})

test('calendar filenames are stable and human-readable', () => {
  assert.equal(calendarFilename(TODAY, 14), 'command-calendar-2026-09-15-14d.ics')
})
