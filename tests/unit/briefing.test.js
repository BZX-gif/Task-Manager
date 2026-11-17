#!/usr/bin/env node
/**
 * The "Sir" briefing is deterministic presentation logic, so it is tested
 * without a DOM: greeting, next-move selection, honest counts, intentions,
 * once-a-day scheduling and the spoken summary.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  briefingMode,
  briefingSpeech,
  buildBriefing,
  dayPart,
  greetingLine,
  intentionFor,
  leadLine,
  markBriefingShown,
  salutationOf,
  shouldShowBriefing,
  withRelations,
  writeIntention,
} from '../../src/client/lib/briefing.js'

const DAY = '2026-11-16'

function task(overrides = {}) {
  return {
    id: 't1',
    title: 'A meaningful mission',
    date: DAY,
    time: null,
    priority: 'medium',
    cat: 'work',
    estimateMinutes: 30,
    done: false,
    status: 'ready',
    inbox: false,
    createdAt: 1,
    goalId: null,
    projectId: null,
    ...overrides,
  }
}

function stateWith(overrides = {}) {
  return {
    tasks: [],
    top3: {},
    completionLog: {},
    focus: { sessions: [] },
    goals: [],
    projects: [],
    settings: { salutation: 'Sir', userName: '', focus: { targetMinutes: 180 } },
    briefing: { lastShownDay: null, intentions: {} },
    ...overrides,
  }
}

const at = (hour, minute = 0) => new Date(2026, 10, 16, hour, minute, 0)

/* ------------------------------------------------------------- greeting */

test('the briefing greets by salutation and time of day', () => {
  const state = stateWith()
  assert.equal(dayPart(at(3)), 'early')
  assert.equal(dayPart(at(7)), 'morning')
  assert.equal(dayPart(at(14)), 'afternoon')
  assert.equal(dayPart(at(19, 30)), 'evening')
  assert.equal(dayPart(at(23)), 'night')

  assert.equal(greetingLine(state, at(7)), 'Good morning, Sir.')
  assert.equal(greetingLine(state, at(19, 30)), 'Good evening, Sir.')
  assert.equal(greetingLine(state, at(3)), 'A quiet moment, Sir.')
  assert.ok(leadLine(at(9)).length > 10)
})

test('a chosen name wins and an unset salutation stays neutral', () => {
  const named = stateWith({ settings: { salutation: '', userName: '  Asha  ', focus: { targetMinutes: 180 } } })
  assert.equal(salutationOf(named), '', 'no salutation is invented for you')
  assert.equal(greetingLine(named, at(9)), 'Good morning, Asha.')
  assert.equal(salutationOf(stateWith({ settings: { salutation: '   Boss   ' } })), 'Boss')
  assert.equal(greetingLine(stateWith({ settings: { salutation: '' } }), at(9)), 'Good morning.', 'an anonymous workspace is greeted without an invented address')
})

/* ------------------------------------------------------- next move order */

test('a running time block is the current mission', () => {
  const state = stateWith({
    tasks: [task({ id: 't1', title: 'Review notes' })],
    top3: { [DAY]: ['t1'] },
  })
  const blocks = [{ id: 'b1', time: '09:00', duration: 60, title: 'Deep study', cat: 'learning', priority: 'high' }]
  const briefing = buildBriefing(state, { now: at(9, 30), todayKey: DAY, blocks })
  assert.equal(briefing.focus.kind, 'block')
  assert.equal(briefing.focus.title, 'Deep study')
  assert.equal(briefing.focus.minutes, 60)
  assert.equal(briefing.focus.time, '09:00')
  assert.equal(briefing.focus.reason, 'Scheduled right now')
})

test('a completed block is skipped and a top-three priority takes over', () => {
  const state = stateWith({
    tasks: [task({ id: 't1', title: 'Finish the brief', priority: 'medium' }), task({ id: 't2', title: 'Other work', priority: 'high' })],
    top3: { [DAY]: ['t1'] },
    completionLog: { [DAY]: { ttDone: ['b1'], taskDone: [] } },
  })
  const blocks = [{ id: 'b1', time: '09:00', duration: 60, title: 'Deep study' }]
  const briefing = buildBriefing(state, { now: at(9, 30), todayKey: DAY, blocks })
  assert.equal(briefing.focus.kind, 'top3')
  assert.equal(briefing.focus.title, 'Finish the brief')
  assert.equal(briefing.focus.taskId, 't1')
})

test('a block linked to a completed mission is not resurrected', () => {
  const state = stateWith({
    tasks: [task({ id: 't1', title: 'Done thing', done: true, status: 'completed' }), task({ id: 't2', title: 'Open thing', priority: 'high' })],
    top3: { [DAY]: ['t1'] },
  })
  const blocks = [{ id: 'b1', time: '09:00', duration: 60, title: 'Done thing', taskId: 't1' }]
  const briefing = buildBriefing(state, { now: at(9, 30), todayKey: DAY, blocks })
  assert.equal(briefing.focus.kind, 'task')
  assert.equal(briefing.focus.taskId, 't2')
})

test('overdue work is surfaced before the rest of today', () => {
  const state = stateWith({
    tasks: [
      task({ id: 'late', title: 'Missed from Friday', date: '2026-11-13', priority: 'medium' }),
      task({ id: 'today', title: 'Fresh today', priority: 'high' }),
    ],
  })
  const briefing = buildBriefing(state, { now: at(10), todayKey: DAY })
  assert.equal(briefing.focus.kind, 'overdue')
  assert.equal(briefing.focus.title, 'Missed from Friday')
  assert.equal(briefing.counts.overdue, 1)
})

test('the next scheduled block, then the inbox, then a clear day', () => {
  const blocks = [{ id: 'b2', time: '15:00', duration: 45, title: 'Afternoon review' }]
  const scheduled = buildBriefing(stateWith(), { now: at(10), todayKey: DAY, blocks })
  assert.equal(scheduled.focus.kind, 'scheduled')
  assert.equal(scheduled.focus.title, 'Afternoon review')
  assert.equal(scheduled.nextUp.length, 1)

  const inboxState = stateWith({ tasks: [task({ id: 'i1', title: 'A captured thought', inbox: true, date: null })] })
  const inbox = buildBriefing(inboxState, { now: at(10), todayKey: DAY })
  assert.equal(inbox.focus.kind, 'inbox')
  assert.equal(inbox.focus.title, 'A captured thought')
  assert.equal(inbox.counts.inbox, 1)

  const clear = buildBriefing(stateWith(), { now: at(10), todayKey: DAY })
  assert.equal(clear.focus.kind, 'clear')
  assert.equal(clear.focus.title, 'The day is yours.')
  assert.equal(clear.hasAnything, false)
})

test('protected windows are never suggested as work', () => {
  const blocks = [
    { id: 'p1', time: '13:00', duration: 60, title: 'Lunch with family', protected: true },
    { id: 'b2', time: '15:00', duration: 30, title: 'Real work' },
  ]
  const briefing = buildBriefing(stateWith(), { now: at(12, 30), todayKey: DAY, blocks })
  assert.equal(briefing.focus.kind, 'scheduled')
  assert.equal(briefing.focus.title, 'Real work')
})

/* --------------------------------------------------------------- counts */

test('counts come only from real records', () => {
  const state = stateWith({
    tasks: [
      task({ id: 'done', title: 'Done one', done: true, status: 'completed' }),
      task({ id: 'open', title: 'Open one', priority: 'high' }),
      task({ id: 'inbox', title: 'Inbox one', inbox: true, date: null }),
      task({ id: 'cancelled', title: 'Cancelled one', status: 'cancelled' }),
      task({ id: 'tomorrow', title: 'Tomorrow', date: '2026-11-17' }),
    ],
    top3: { [DAY]: ['done', 'open'] },
    focus: {
      sessions: [
        { id: 'f1', date: DAY, mode: 'focus', focusedSeconds: 1500, status: 'completed' },
        { id: 'f2', date: DAY, mode: 'focus', focusedSeconds: 900, status: 'stopped' },
        { id: 'f3', date: DAY, mode: 'break', focusedSeconds: 300, status: 'completed' },
      ],
    },
    briefing: { lastShownDay: null, intentions: { [DAY]: 'One calm, complete hour.' } },
  })
  const briefing = buildBriefing(state, { now: at(11), todayKey: DAY, stats: { score: 72, focusedMinutes: 40, hasAnyActivity: true }, streak: { current: 4, best: 9 } })
  assert.equal(briefing.counts.planned, 2, 'inbox, cancelled and future tasks are not planned today')
  assert.equal(briefing.counts.done, 1)
  assert.equal(briefing.counts.open, 1)
  assert.equal(briefing.counts.inbox, 1)
  assert.equal(briefing.counts.top3Total, 2)
  assert.equal(briefing.counts.top3Done, 1)
  assert.equal(briefing.counts.focusMinutes, 40)
  assert.equal(briefing.counts.score, 72)
  assert.equal(briefing.counts.streak, 4)
  assert.equal(briefing.intention, 'One calm, complete hour.')
})

test('focus minutes are derived from sessions when no stats are supplied', () => {
  const state = stateWith({ focus: { sessions: [{ id: 'f1', date: DAY, mode: 'focus', focusedSeconds: 1500 }] } })
  const briefing = buildBriefing(state, { now: at(11), todayKey: DAY })
  assert.equal(briefing.counts.focusMinutes, 25)
  assert.equal(briefing.counts.score, null, 'no fabricated score')
})

test('goal and project titles are attached for the UI only', () => {
  const state = stateWith({
    tasks: [task({ id: 't1', goalId: 'g1', projectId: 'p1' })],
    goals: [{ id: 'g1', title: 'Run a marathon' }],
    projects: [{ id: 'p1', title: 'Training plan' }],
  })
  const briefing = withRelations(buildBriefing(state, { now: at(10), todayKey: DAY }), state)
  assert.equal(briefing.focus.goalTitle, 'Run a marathon')
  assert.equal(briefing.focus.projectTitle, 'Training plan')
})

/* ------------------------------------------------------------ intentions */

test('intentions are trimmed, stored per day and removable', () => {
  const state = stateWith()
  const saved = writeIntention(state, DAY, '  Write   the opening paragraph.  ')
  assert.equal(saved, 'Write the opening paragraph.')
  assert.equal(intentionFor(state, DAY), 'Write the opening paragraph.')
  assert.equal(intentionFor(state, '2026-11-15'), '', 'other days start empty')

  writeIntention(state, DAY, '   ')
  assert.equal(intentionFor(state, DAY), '', 'an empty intention is removed')
})

test('intention storage stays bounded', () => {
  const state = stateWith()
  for (let i = 1; i <= 130; i++) {
    const day = `2026-${String(Math.ceil(i / 28)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`
    writeIntention(state, day, `Intention ${i}`)
  }
  assert.ok(Object.keys(state.briefing.intentions).length <= 120)
  const newest = writeIntention(state, DAY, 'Today only')
  assert.equal(newest, 'Today only')
  assert.equal(state.briefing.intentions[DAY], 'Today only')
})

/* -------------------------------------------------------------- schedule */

test('the briefing opens once a day unless the user asks otherwise', () => {
  const daily = stateWith({ settings: { briefingMode: 'daily' } })
  assert.equal(briefingMode(daily), 'daily')
  assert.equal(shouldShowBriefing(daily, DAY), true)
  markBriefingShown(daily, DAY)
  assert.equal(shouldShowBriefing(daily, DAY), false)
  assert.equal(shouldShowBriefing(daily, '2026-11-17'), true)

  const every = stateWith({ settings: { briefingMode: 'every' }, briefing: { lastShownDay: DAY, intentions: {} } })
  assert.equal(shouldShowBriefing(every, DAY), true)

  const off = stateWith({ settings: { briefingMode: 'off' } })
  assert.equal(shouldShowBriefing(off, DAY), false)

  const legacy = stateWith({ settings: {} })
  assert.equal(briefingMode(legacy), 'daily', 'older payloads default to once a day')
})

test('tomorrow is previewed from real future missions only', () => {
  const state = stateWith({
    tasks: [
      task({ id: 'today', title: 'Today work' }),
      task({ id: 'tmr', title: 'Tomorrow first', date: '2026-11-17', priority: 'high', time: '08:00' }),
    ],
  })
  const briefing = buildBriefing(state, { now: at(20), todayKey: DAY })
  assert.equal(briefing.tomorrowKey, '2026-11-17')
  assert.equal(briefing.tomorrow.title, 'Tomorrow first')
  assert.equal(briefing.tomorrow.time, '08:00')
  assert.match(briefingSpeech(briefing), /Tomorrow begins with Tomorrow first\./)

  const none = buildBriefing(stateWith({ tasks: [task()] }), { now: at(20), todayKey: DAY })
  assert.equal(none.tomorrow, null, 'no invention when tomorrow is empty')
})

/* ---------------------------------------------------------------- speech */

test('the spoken briefing is plain, complete and never says undefined', () => {
  const state = stateWith({
    tasks: [task({ id: 't1', title: 'Finish the brief', priority: 'high' })],
    top3: { [DAY]: ['t1'] },
    briefing: { lastShownDay: null, intentions: { [DAY]: 'One calm hour.' } },
  })
  const briefing = buildBriefing(state, { now: at(19), todayKey: DAY, stats: { score: 60, focusedMinutes: 45, hasAnyActivity: true } })
  const speech = briefingSpeech(briefing)
  assert.match(speech, /Good evening, Sir\./)
  assert.match(speech, /Finish the brief/)
  assert.match(speech, /45 minutes focused/)
  assert.match(speech, /One calm hour/)
  assert.doesNotMatch(speech, /undefined|NaN|null/)

  const clear = briefingSpeech(buildBriefing(stateWith(), { now: at(10), todayKey: DAY }))
  assert.match(clear, /Nothing is pending/)
  assert.doesNotMatch(clear, /undefined/)
})
