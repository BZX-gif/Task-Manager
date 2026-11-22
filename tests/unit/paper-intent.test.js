/**
 * PAPER — intent parsing, prepared actions and local memory.
 *
 * The parser must understand reasonable phrasing variations, admit when it
 * does not understand, and never pretend to be open-ended. Actions must be
 * prepared (never silently executed) and every execution must produce a
 * clear summary.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { parseIntent, detectAction, unsupportedReply, examplePrompts, INTENTS } from '../../src/client/lib/paper/intent.js'
import {
  prepareCreateMission, prepareReschedule, preparePlanTomorrow, prepareSetIntention,
  executeAction, describeAction, CONFIRMATION_REQUIRED,
} from '../../src/client/lib/paper/actions.js'
import { normalizePaper, recordInteraction, clearHistory, interactionCount, emptyPaper, MAX_HISTORY } from '../../src/client/lib/paper/memory.js'
import { askPaper } from '../../src/client/lib/paper/engine.js'
import { emptyState, makeContext } from '../../src/client/lib/state.js'

const TODAY = '2026-11-18'
const NOON = new Date(2026, 10, 18, 12, 0, 0)
const NOON_TS = Date.parse('2026-11-18T12:00:00')

let n = 0
const fresh = () => emptyState(makeContext({ now: NOON_TS, id: () => `id${++n}` }))
const task = (id, over = {}) => ({
  id, title: `Mission ${id}`, date: TODAY, time: null, priority: 'medium', cat: null,
  notes: '', estimateMinutes: 30, done: false, status: 'ready', description: '', deadline: null,
  goalId: null, projectId: null, milestoneId: null, horizon: 'daily', subtasks: [], progress: null,
  history: [], protected: false, flexible: true, inbox: false, createdAt: NOON_TS - 3 * 86400000,
  completedAt: null, recurrence: null, seriesId: null, ...over,
})

test('the intent catalog is complete and every entry is addressable', () => {
  assert.ok(INTENTS.length >= 12, 'the documented request surface is covered')
  for (const entry of INTENTS) {
    const parsed = parseIntent(entry.examples[0])
    assert.equal(parsed.intent, entry.id, `example "${entry.examples[0]}" resolves to ${entry.id}`)
  }
})

test('phrasing variations map to the same intents', () => {
  const cases = [
    ['What should I focus on today?', 'focus_today'],
    ['what do I do now?', 'focus_today'],
    ['where do I start this morning', 'focus_today'],
    ['show me my overdue missions', 'overdue_missions'],
    ['what is late?', 'overdue_missions'],
    ['which goal is falling behind?', 'goal_status'],
    ['how are my goals doing', 'goal_status'],
    ['find my upcoming deadlines', 'upcoming_deadlines'],
    ['plan tomorrow', 'plan_tomorrow'],
    ['how much time do I have this week?', 'time_this_week'],
    ['show me my most important projects', 'important_projects'],
    ['why is my progress declining?', 'progress_decline'],
    ['brief me on today', 'today_briefing'],
    ['am I overloaded?', 'workload'],
    ['what do you recommend?', 'recommendations'],
    ['what needs my attention?', 'alerts'],
    ['when am I most productive?', 'patterns'],
    ['I fell behind, help me recover', 'recovery'],
    ['what can you do?', 'help'],
  ]
  for (const [text, intent] of cases) {
    const parsed = parseIntent(text)
    assert.equal(parsed.intent, intent, `"${text}" → ${intent} (got ${parsed.intent})`)
  }
})

test('the parser admits when it does not understand', () => {
  const parsed = parseIntent('what is the capital of australia')
  assert.equal(parsed.intent, 'none')
  assert.equal(parsed.confidence, 'none')
  const reply = unsupportedReply('what is the capital of australia')
  assert.match(reply.text, /could not match/)
  assert.match(reply.text, /fixed set of workspace questions/, 'it never claims open-ended conversation')
})

test('time words are parsed into slots', () => {
  const parsed = parseIntent('plan tomorrow and check this week')
  assert.equal(parsed.slots.day, 'tomorrow')
  assert.equal(parsed.slots.range, 'week')
})

test('example prompts cover the catalog surface', () => {
  assert.ok(examplePrompts().length >= 8)
})

test('action phrases are detected separately from questions', () => {
  assert.equal(detectAction('create a mission to review the budget').kind, 'create_mission')
  assert.equal(detectAction('reschedule my mission to friday').kind, 'reschedule_mission')
  assert.equal(detectAction('plan my day').kind, 'plan_day')
  assert.equal(detectAction('today I will finish the outline').kind, 'set_intention')
  assert.equal(detectAction('what should I focus on'), null)
})

test('prepared actions describe exactly what would change', () => {
  const create = prepareCreateMission({ title: 'Review the budget', date: TODAY, minutes: 45, priority: 'high' })
  assert.match(create.preview, /Review the budget/)
  assert.match(create.preview, /2026-11-18/)
  assert.ok(CONFIRMATION_REQUIRED.has(create.kind), 'creating work always needs confirmation')
  assert.equal(describeAction(create), create.preview)

  const move = prepareReschedule({ taskId: 'x', dayKey: '2026-11-19', startLabel: '09:30', minutes: 60 })
  assert.match(move.preview, /2026-11-19 at 09:30/)
  assert.ok(CONFIRMATION_REQUIRED.has(move.kind))
})

test('executeAction creates a mission and reports the result', () => {
  const state = fresh()
  const descriptor = prepareCreateMission({ title: 'Review the budget', date: TODAY, minutes: 45 })
  const result = executeAction(state, descriptor, { uid: () => 'fixed-id', now: NOON_TS })
  assert.equal(result.ok, true)
  assert.match(result.summary, /created/)
  assert.equal(state.tasks.length, 1)
  assert.equal(state.tasks[0].id, 'fixed-id')
  assert.equal(state.tasks[0].title, 'Review the budget')
  assert.equal(state.tasks[0].estimateMinutes, 45)
  assert.equal(state.tasks[0].inbox, false, 'dated missions are not inbox captures')
})

test('executeAction refuses empty titles and unknown kinds', () => {
  const state = fresh()
  const bad = executeAction(state, prepareCreateMission({ title: '  ' }), {})
  assert.equal(bad.ok, false)
  assert.equal(state.tasks.length, 0, 'failed actions change nothing')
  const unknown = executeAction(state, { kind: 'drop_database', params: {} }, {})
  assert.equal(unknown.ok, false)
  assert.equal(state.tasks.length, 0)
})

test('rescheduling preserves history and clears the inbox flag', () => {
  const state = fresh()
  state.tasks.push(task('t1', { inbox: true, date: null }))
  const result = executeAction(state, prepareReschedule({ taskId: 't1', dayKey: '2026-11-19', startLabel: '10:00', minutes: 60 }), { now: NOON_TS })
  assert.equal(result.ok, true)
  assert.equal(state.tasks[0].date, '2026-11-19')
  assert.equal(state.tasks[0].time, '10:00')
  assert.equal(state.tasks[0].inbox, false)
  assert.equal(state.tasks[0].history.at(-1).action, 'rescheduled', 'the move is recorded, never silent')
})

test('plan tomorrow moves only unfinished work', () => {
  const state = fresh()
  state.tasks.push(task('t1'), task('t2', { done: true }), task('t3', { status: 'cancelled' }))
  const result = executeAction(state, preparePlanTomorrow({ taskIds: ['t1', 't2', 't3'], dayKey: '2026-11-19' }), { now: NOON_TS })
  assert.equal(result.ok, true)
  assert.match(result.summary, /1 mission planned/)
  assert.equal(state.tasks.find((t) => t.id === 't1').date, '2026-11-19')
  assert.equal(state.tasks.find((t) => t.id === 't2').date, TODAY, 'completed work is never moved')
})

test('intentions are saved through the prepared action', () => {
  const state = fresh()
  const result = executeAction(state, prepareSetIntention({ text: 'Finish the outline', dayKey: TODAY }), { now: NOON_TS })
  assert.equal(result.ok, true)
  assert.equal(state.briefing.intentions[TODAY], 'Finish the outline')
})

test('PAPER memory is additive, bounded and clearable', () => {
  assert.deepEqual(normalizePaper(undefined), emptyPaper(), 'older payloads get a clean default')
  assert.deepEqual(normalizePaper({ history: 'nope' }).history, [], 'garbage is dropped')

  const state = fresh()
  for (let i = 0; i < MAX_HISTORY + 10; i += 1) {
    recordInteraction(state, { role: 'user', text: `question ${i}`, ts: NOON_TS + i })
  }
  assert.equal(state.paper.history.length, MAX_HISTORY, 'history is bounded')
  assert.equal(state.paper.history.at(-1).text, `question ${MAX_HISTORY + 9}`, 'the newest entries survive')

  const dayStart = Date.parse('2026-11-18T00:30:00')
  recordInteraction(state, { role: 'user', text: 'early question', ts: dayStart })
  assert.ok(interactionCount(state, TODAY) > 0)

  clearHistory(state)
  assert.equal(state.paper.history.length, 0)
})

test('askPaper answers grounded questions from real workspace data', () => {
  const state = fresh()
  state.tasks.push(task('late', { title: 'File the report', date: '2026-11-15' }), task('due', { title: 'Pay the fee', deadline: '2026-11-20' }))
  const answer = askPaper('show me my overdue missions', state, { now: NOON })
  assert.equal(answer.type, 'answer')
  assert.equal(answer.intent, 'overdue_missions')
  assert.match(answer.text, /1 mission is overdue/)
  assert.match(answer.text, /File the report/)
  assert.ok(answer.findings.length >= 1)
})

test('askPaper returns an honest unsupported reply with the supported catalog', () => {
  const state = fresh()
  const answer = askPaper('sing me a song about the sea', state, { now: NOON })
  assert.equal(answer.type, 'unsupported')
  assert.match(answer.text, /could not match/)
  assert.ok(answer.sections[0].items.length >= 12, 'the supported commands are offered')
})

test('askPaper prepares — never executes — action requests', () => {
  const state = fresh()
  const before = state.tasks.length
  const answer = askPaper('create a mission to review the budget', state, { now: NOON })
  assert.equal(answer.type, 'action')
  assert.equal(answer.actions.length, 1)
  assert.equal(answer.actions[0].kind, 'create_mission')
  assert.equal(state.tasks.length, before, 'nothing was created without confirmation')
})

test('askPaper stays read-only across every handler', () => {
  const state = fresh()
  state.tasks.push(task('t1'), task('late', { date: '2026-11-15' }))
  state.goals.push({ id: 'g1', title: 'Goal', status: 'active', createdAt: NOON_TS - 2 * 86400000, milestones: [], priority: 'medium', description: '', notes: '', deadline: null, targetDate: null, progressMode: 'auto', manualProgress: 0 })
  const before = JSON.stringify(state)
  for (const entry of INTENTS) {
    askPaper(entry.examples[0], state, { now: NOON })
  }
  assert.equal(JSON.stringify(state), before, 'the engine never mutates state')
})
