import test from 'node:test'
import assert from 'node:assert/strict'
import { BACKUP_KIND, buildExport, describeImport, exportFilename, validateImport } from '../../src/client/lib/backup.js'
import { baseState, task } from '../helpers/fixtures.js'

function sampleState() {
  return baseState({
    tasks: [task('t1', { done: true }), task('t2', { recurrence: { freq: 'daily' } })],
    top3: { '2026-09-15': ['t1'] },
    completionLog: { '2026-09-15': { ttDone: [], taskDone: ['t1'] } },
    focus: { active: null, sessions: [{ id: 's1', mode: 'focus', focusedSeconds: 1200, date: '2026-09-15', plannedMinutes: 25, status: 'completed', startedAt: 1, endedAt: 2 }] },
  })
}

test('export → import round-trips the whole state', () => {
  const state = sampleState()
  const payload = buildExport(state, { now: Date.parse('2026-09-15T10:00:00Z') })
  assert.equal(payload.kind, BACKUP_KIND)
  assert.equal(payload.counts.tasks, 2)
  assert.ok(payload.exportedAt.startsWith('2026-09-15'))

  const result = validateImport(payload)
  assert.equal(result.ok, true)
  assert.deepEqual(result.errors, [])
  assert.equal(result.state.tasks.length, 2)
  assert.equal(result.state.tasks[0].done, true)
  assert.deepEqual(result.state.top3['2026-09-15'], ['t1'])
  assert.equal(result.state.focus.sessions.length, 1)
  assert.equal(result.summary.tasks, 2)
  assert.equal(result.summary.openTasks, 1)
  assert.equal(result.summary.recurring, 1)
  assert.match(describeImport(result.summary), /2 tasks/)
})

test('exports never contain a browser API key', () => {
  const state = sampleState()
  state.settings.geminiApiKey = 'AQ.secret'
  const payload = buildExport(state)
  assert.equal(payload.data.settings.geminiApiKey, undefined)
  assert.ok(!JSON.stringify(payload).includes('AQ.secret'))
})

test('legacy raw state files still import', () => {
  const legacy = {
    categories: [{ id: 'upsc', name: 'UPSC Core', color: '#3b82f6' }],
    timetable: [{ id: 'b1', time: '09:00', title: 'Geography', duration: 60, cat: 'upsc' }],
    tasks: [{ id: 't1', title: 'Old task', date: '2026-09-15', done: false }],
    completionLog: {},
    settings: {},
    chatHistory: [],
  }
  const result = validateImport(legacy)
  assert.equal(result.ok, true)
  assert.equal(result.state.tasks[0].title, 'Old task')
  assert.ok(result.warnings.some((w) => /Legacy/i.test(w)))
})

test('broken payloads are rejected without touching anything', () => {
  assert.equal(validateImport(null).ok, false)
  assert.equal(validateImport([1, 2, 3]).ok, false)
  assert.equal(validateImport({ hello: 'world' }).ok, false)
  assert.match(validateImport({ hello: 'world' }).errors[0], /no Command Center data/i)
  assert.equal(validateImport({ kind: BACKUP_KIND, version: 2 }).ok, false)
  assert.match(validateImport({ kind: BACKUP_KIND, version: 2 }).errors[0], /data/i)
})

test('a newer backup version imports with a warning', () => {
  const payload = buildExport(sampleState())
  payload.version = 99
  const result = validateImport(payload)
  assert.equal(result.ok, true)
  assert.ok(result.warnings.some((w) => /newer version/i.test(w)))
})

test('imported garbage tasks are normalised', () => {
  const payload = buildExport(sampleState())
  payload.data.tasks = [{ id: 'x', title: 'Fine', date: '2026-09-15' }, { id: 'y', date: 'bad', priority: 'nope' }]
  const result = validateImport(payload)
  assert.equal(result.ok, true)
  assert.equal(result.state.tasks.length, 2)
  assert.equal(result.state.tasks[1].date, null)
  assert.equal(result.state.tasks[1].priority, 'medium')
})

test('export filenames are filesystem friendly', () => {
  const name = exportFilename(Date.parse('2026-09-15T10:04:00Z'))
  assert.match(name, /^command-center-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/)
})
