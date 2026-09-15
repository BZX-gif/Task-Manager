import test from 'node:test'
import assert from 'node:assert/strict'
import {
  STORAGE_KEY,
  PRE_MIGRATION_BACKUP_KEY,
  emptyState,
  loadState,
  makeContext,
  migrateState,
  migrateStateV1ToV2,
  normalizeSettings,
  normalizeState,
  normalizeTask,
  saveState,
  storageUsage,
} from '../../src/client/lib/state.js'
import { STATE_VERSION } from '../../src/client/lib/defaults.js'

/** minimal localStorage double */
function fakeStorage(seed = {}) {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    get length() {
      return map.size
    },
    _map: map,
  }
}

const legacyState = {
  categories: [{ id: 'upsc', name: 'UPSC Core', color: '#3b82f6' }],
  timetable: [{ time: '09:00', title: 'Geography', duration: 60, cat: 'upsc' }],
  tasks: [{ id: 't1', title: 'Revise Polity', date: '2026-09-15', priority: 'high', cat: 'upsc', notes: '', done: false, createdAt: 1 }],
  completionLog: { '2026-09-14': { ttDone: ['x'], taskDone: [] } },
  settings: { geminiApiKey: 'AQ.legacy-key-should-be-removed', theme: 'dark' },
  chatHistory: [{ role: 'user', text: 'hello' }],
}

test('v1 → v2 keeps every existing record', () => {
  const ctx = makeContext({ now: 1000, id: () => 'new-id' })
  const migrated = migrateStateV1ToV2(legacyState, ctx)
  assert.equal(migrated.version, 2)
  assert.equal(migrated.tasks.length, 1)
  assert.equal(migrated.tasks[0].title, 'Revise Polity')
  assert.equal(migrated.timetable.length, 1)
  assert.ok(migrated.timetable[0].id, 'timetable blocks gained ids')
  assert.deepEqual(migrated.completionLog['2026-09-14'].ttDone, ['x'])
  assert.ok(migrated.focus && Array.isArray(migrated.focus.sessions))
  assert.ok(migrated.top3 && typeof migrated.top3 === 'object')
})

test('the legacy browser API key is dropped during migration', () => {
  const result = migrateState(legacyState, makeContext())
  assert.equal(result.state.settings.geminiApiKey, undefined)
  assert.ok(result.applied.includes('migrateStateV1ToV2'))
})

test('migrateState normalises junk values instead of throwing', () => {
  const { state, warnings } = migrateState({
    version: 2,
    categories: 'nope',
    timetable: [{ title: 'No time', duration: 'abc' }],
    tasks: [null, { title: 42 }],
    completionLog: { 'not-a-date': {} },
    top3: { '2026-09-15': ['ghost'] },
  })
  assert.equal(state.categories.length, 4, 'falls back to the default categories')
  assert.equal(state.timetable[0].time, '09:00', 'invalid times fall back')
  assert.equal(state.timetable[0].duration, 60)
  assert.equal(state.tasks.length, 2)
  assert.equal(state.tasks[0].title, 'Untitled task')
  assert.deepEqual(state.top3, {}, 'ids of missing tasks are dropped')
  assert.deepEqual(warnings, [])
})

test('normalizeTask fills sensible defaults and validates dates', () => {
  const ctx = makeContext({ now: 777, id: () => 'i' })
  const t = normalizeTask({ title: '  Read  ', date: 'nope', priority: 'urgent', estimateMinutes: 9999 }, ctx)
  assert.equal(t.title, 'Read')
  assert.equal(t.date, null, 'invalid dates become "no date" (inbox)')
  assert.equal(t.priority, 'medium')
  assert.equal(t.estimateMinutes, 600)
  assert.equal(t.inbox, true, 'undated + uncategorised → inbox')
  assert.equal(t.createdAt, 777)
})

test('normalizeSettings keeps the Reminders and Focus sections intact', () => {
  const settings = normalizeSettings({ focus: { defaultMinutes: 50 }, reminders: { enabled: false }, protectedTime: [{ label: 'Sleep', start: '23:00', end: '06:00', days: [0, 1] }] })
  assert.equal(settings.focus.defaultMinutes, 50)
  assert.equal(settings.focus.targetMinutes, 180, 'missing keys keep their default')
  assert.equal(settings.reminders.enabled, false)
  assert.equal(settings.reminders.beforeMinutes, 10)
  assert.equal(settings.protectedTime.length, 1)
  assert.equal(settings.protectedTime[0].label, 'Sleep')
  assert.deepEqual(settings.protectedTime[0].days, [0, 1])
})

test('emptyState is complete and versioned', () => {
  const state = emptyState(makeContext({ now: 5, id: () => 'z' }))
  assert.equal(state.version, STATE_VERSION)
  assert.ok(state.timetable.length > 0)
  assert.deepEqual(state.tasks, [])
  assert.deepEqual(state.focus, { active: null, sessions: [] })
  assert.equal(state.meta.createdAt, 5)
})

test('loadState migrates stored v1 data and writes a safety copy', () => {
  const storage = fakeStorage({ [STORAGE_KEY]: JSON.stringify(legacyState) })
  const result = loadState({ storage, now: 42, id: () => 'i' })
  assert.equal(result.migrated, true)
  assert.equal(result.fresh, false)
  assert.equal(result.state.tasks[0].title, 'Revise Polity')
  assert.ok(storage.getItem(PRE_MIGRATION_BACKUP_KEY), 'pre-migration backup stored')
  assert.match(storage.getItem(PRE_MIGRATION_BACKUP_KEY), /Revise Polity/)
})

test('loadState never wipes data it cannot parse', () => {
  const storage = fakeStorage({ [STORAGE_KEY]: '{ broken json' })
  const result = loadState({ storage, now: 1, id: () => 'i' })
  assert.equal(result.fresh, true)
  assert.equal(result.corrupted, true)
  assert.ok(result.warnings.length >= 1)
  assert.equal(storage.getItem(STORAGE_KEY), '{ broken json', 'the original payload is left alone')
})

test('save → load round-trips the full state', () => {
  const storage = fakeStorage()
  const state = emptyState(makeContext({ now: 10, id: () => 'i' }))
  state.tasks.push({ id: 't1', title: 'Hello', date: '2026-09-15', done: true })
  state.top3['2026-09-15'] = ['t1']
  state.focus.sessions.push({ id: 's1', mode: 'focus', focusedSeconds: 1200, date: '2026-09-15', plannedMinutes: 25, status: 'completed', startedAt: 1, endedAt: 2 })
  assert.equal(saveState(state, { storage, now: 99 }), true)

  const reloaded = loadState({ storage, now: 100, id: () => 'i' }).state
  assert.equal(reloaded.tasks.length, 1)
  assert.deepEqual(reloaded.top3['2026-09-15'], ['t1'])
  assert.equal(reloaded.focus.sessions[0].focusedSeconds, 1200)
  assert.equal(reloaded.meta.updatedAt, 99)
  assert.ok(storageUsage({ storage }).kb >= 0)
})

test('an active focus session survives a reload', () => {
  const storage = fakeStorage()
  const state = emptyState(makeContext({ now: 10, id: () => 'i' }))
  state.focus.active = {
    id: 's1',
    taskId: 't1',
    mode: 'focus',
    plannedMinutes: 50,
    accumulatedSeconds: 300,
    running: true,
    startedAt: 1000,
    lastTickAt: 1300,
    status: 'active',
  }
  saveState(state, { storage, now: 1000 })
  const reloaded = loadState({ storage, now: 2000, id: () => 'i' }).state
  assert.equal(reloaded.focus.active.plannedMinutes, 50)
  assert.equal(reloaded.focus.active.accumulatedSeconds, 300)
  assert.equal(reloaded.focus.active.running, true)
  assert.equal(reloaded.focus.active.lastTickAt, 1300)
})

test('corrupt nested fields are repaired, not crashed on', () => {
  const { state } = migrateState({
    version: 2,
    focus: { active: 'nope', sessions: ['bad', { focusedSeconds: -5, date: 'x' }] },
    reminders: { sent: { a: 'not-a-number' } },
    scoreHistory: { bad: {}, '2026-09-15': { score: 999 } },
  })
  assert.equal(state.focus.active, null)
  assert.equal(state.focus.sessions.length, 1)
  assert.equal(state.focus.sessions[0].focusedSeconds, 0)
  assert.deepEqual(state.reminders.sent, {})
  assert.equal(state.scoreHistory['2026-09-15'].score, 100, 'clamped')
  assert.equal(normalizeState(state, makeContext()).version, STATE_VERSION)
})
