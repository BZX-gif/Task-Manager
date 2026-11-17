import test from 'node:test'
import assert from 'node:assert/strict'
import {
  expandOccurrences,
  eventsToBlocks,
  parseIcs,
  parseIcsDate,
  parseIcsDuration,
  parseProperty,
  parseRrule,
  unfoldIcs,
  unescapeIcsText,
  zoneOffsetMinutes,
} from '../../src/client/lib/ics.js'

const FROM = '2026-09-14'
const TO = '2026-09-27'

function calendar(...events) {
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\nX-WR-CALNAME:Work\r\n${events.join('\r\n')}\r\nEND:VCALENDAR\r\n`
}

const basicEvent = [
  'BEGIN:VEVENT',
  'UID:evt-1@example.com',
  'DTSTAMP:20260901T080000Z',
  'DTSTART:20260915T033000Z',
  'DTEND:20260915T043000Z',
  'SUMMARY:Board meeting',
  'LOCATION:Room 4\\, second floor',
  'DESCRIPTION:Numbers first\\nThen the plan',
  'END:VEVENT',
].join('\r\n')

test('folded lines are unfolded before parsing', () => {
  const text = 'SUMMARY:This is a very long title that WAS\r\n  folded by the calendar app'
  assert.match(unfoldIcs(text), /WAS folded by the calendar app/)
})

test('property parsing keeps quoted parameters and escapes', () => {
  const prop = parseProperty('DTSTART;TZID="Asia/Kolkata";VALUE=DATE-TIME:20260915T090000')
  assert.equal(prop.name, 'DTSTART')
  assert.equal(prop.params.TZID, 'Asia/Kolkata')
  assert.equal(prop.value, '20260915T090000')
  assert.equal(unescapeIcsText('Room 4\\, second floor'), 'Room 4, second floor')
  assert.equal(unescapeIcsText('Line one\\nLine two'), 'Line one\nLine two')
})

test('UTC, floating and date-only values are parsed predictably', () => {
  const utc = parseIcsDate('20260915T033000Z')
  const local = new Date(Date.UTC(2026, 8, 15, 3, 30))
  assert.equal(utc.time, `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`)
  assert.equal(utc.utc, true)
  const floating = parseIcsDate('20260915T093000')
  assert.equal(floating.time, '09:30')
  assert.equal(floating.floating, true)
  const allDay = parseIcsDate('20260915')
  assert.equal(allDay.allDay, true)
  assert.equal(allDay.time, null)
  assert.equal(parseIcsDate('not-a-date'), null)
})

test('time-zone offsets and durations are exact', () => {
  assert.equal(zoneOffsetMinutes('UTC', Date.UTC(2026, 8, 15, 9)), 0)
  assert.equal(zoneOffsetMinutes('Asia/Kolkata', Date.UTC(2026, 8, 15, 9)), 330)
  assert.equal(parseIcsDuration('PT1H30M'), 90)
  assert.equal(parseIcsDuration('P1DT15M'), 1455)
  assert.equal(parseIcsDuration('PT45S'), 1)
  assert.equal(parseIcsDuration('nonsense'), null)
})

test('a basic event becomes one importable block with its real title and duration', () => {
  const result = parseIcs(calendar(basicEvent), { from: FROM, to: TO })
  assert.equal(result.calendarName, 'Work')
  assert.equal(result.events.length, 1)
  const [event] = result.events
  assert.equal(event.title, 'Board meeting')
  assert.equal(event.duration, 60)
  assert.equal(event.date, '2026-09-15')
  assert.equal(event.location, 'Room 4, second floor')
  assert.equal(result.stats.total, 1)
})

test('all-day, cancelled and free events are skipped with honest counts', () => {
  const text = calendar(
    basicEvent,
    'BEGIN:VEVENT\r\nUID:all-day\r\nDTSTART;VALUE=DATE:20260916\r\nSUMMARY:Holiday\r\nEND:VEVENT',
    'BEGIN:VEVENT\r\nUID:cancelled\r\nDTSTART:20260916T100000Z\r\nSUMMARY:Cancelled meeting\r\nSTATUS:CANCELLED\r\nEND:VEVENT',
    'BEGIN:VEVENT\r\nUID:free\r\nDTSTART:20260916T110000Z\r\nSUMMARY:Optional catch-up\r\nTRANSP:TRANSPARENT\r\nEND:VEVENT',
  )
  const result = parseIcs(text, { from: FROM, to: TO })
  assert.equal(result.events.length, 1)
  assert.equal(result.stats.allDay, 1)
  assert.equal(result.stats.cancelled, 1)
  assert.equal(result.stats.free, 1)
})

test('duration is used when DTEND is missing', () => {
  const text = calendar('BEGIN:VEVENT\r\nUID:dur\r\nDTSTART:20260916T100000Z\r\nDURATION:PT1H15M\r\nSUMMARY:Workshop\r\nEND:VEVENT')
  const [event] = parseIcs(text, { from: FROM, to: TO }).events
  assert.equal(event.duration, 75)
})

test('weekly recurrence expands inside the window and honours EXDATE', () => {
  const text = calendar(
    [
      'BEGIN:VEVENT',
      'UID:standup@example.com',
      'DTSTART:20260914T040000Z',
      'DTEND:20260914T041500Z',
      'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR',
      'EXDATE:20260916T040000Z',
      'SUMMARY:Standup',
      'END:VEVENT',
    ].join('\r\n'),
  )
  const result = parseIcs(text, { from: FROM, to: TO })
  assert.equal(result.stats.recurring, 1)
  const event = result.events[0]
  assert.ok(event.dates.length >= 3)
  assert.ok(!event.dates.includes('2026-09-16'), 'EXDATE was not respected')
  assert.ok(event.dates.every((d) => ['2026-09-14', '2026-09-18', '2026-09-21', '2026-09-23', '2026-09-25'].includes(d)))
})

test('recurrence expansion is bounded', () => {
  const rule = parseRrule('FREQ=DAILY;COUNT=5')
  assert.deepEqual(expandOccurrences('2026-09-14', rule, FROM, TO), ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'])
  const forever = parseRrule('FREQ=DAILY')
  assert.ok(expandOccurrences('2026-09-14', forever, FROM, TO).length <= 15)
  assert.deepEqual(expandOccurrences('2026-10-30', parseRrule('FREQ=WEEKLY'), FROM, TO), [])
})

test('events outside the window are reported, not silently dropped', () => {
  const text = calendar('BEGIN:VEVENT\r\nUID:far\r\nDTSTART:20261224T100000Z\r\nSUMMARY:Trip\r\nEND:VEVENT')
  const result = parseIcs(text, { from: FROM, to: TO })
  assert.equal(result.events.length, 0)
  assert.equal(result.stats.outside, 1)
})

test('duplicate UIDs are only imported once', () => {
  const result = parseIcs(calendar(basicEvent, basicEvent), { from: FROM, to: TO })
  assert.equal(result.events.length, 1)
  assert.equal(result.stats.duplicates, 1)
})

test('a non-calendar file fails honestly', () => {
  const result = parseIcs('hello world', { from: FROM, to: TO })
  assert.equal(result.events.length, 0)
  assert.match(result.error, /iCalendar/)
})

test('imported events become protected, immovable time blocks and re-imports do not duplicate', () => {
  const parsed = parseIcs(calendar(basicEvent), { from: FROM, to: TO })
  const first = eventsToBlocks(parsed.events, {}, { today: FROM })
  assert.equal(first.added, 1)
  const block = first.days['2026-09-15'][0]
  assert.equal(block.protected, true)
  assert.equal(block.flexible, false)
  assert.equal(block.kind, 'event')
  const localStart = new Date(Date.UTC(2026, 8, 15, 3, 30))
  assert.equal(block.time, `${String(localStart.getHours()).padStart(2, '0')}:${String(localStart.getMinutes()).padStart(2, '0')}`)
  assert.equal(block.duration, 60)

  const second = eventsToBlocks(parsed.events, first.days, { today: FROM })
  assert.equal(second.added, 0)
  assert.equal(second.duplicates, 1)
  assert.equal(second.days['2026-09-15'].length, 1)
})

test('existing days are preserved and sorted, never mutated', () => {
  const existing = { '2026-09-15': [{ id: 'keep', time: '16:00', duration: 30, title: 'Existing' }] }
  const parsed = parseIcs(calendar(basicEvent), { from: FROM, to: TO })
  const result = eventsToBlocks(parsed.events, existing, { today: FROM })
  assert.equal(result.days['2026-09-15'].length, 2)
  const localStart = new Date(Date.UTC(2026, 8, 15, 3, 30))
  const expectedTime = `${String(localStart.getHours()).padStart(2, '0')}:${String(localStart.getMinutes()).padStart(2, '0')}`
  assert.deepEqual(result.days['2026-09-15'].map((b) => b.time), [expectedTime, '16:00'])
  assert.equal(existing['2026-09-15'].length, 1)
})
