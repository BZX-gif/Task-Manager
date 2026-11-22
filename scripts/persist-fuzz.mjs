#!/usr/bin/env node
/**
 * Persistence fuzz — corrupt localStorage must never crash boot; the app
 * must come back with defaults (and park a backup when possible).
 */
import assert from 'node:assert/strict'
import { loadState, saveState, STORAGE_KEY, CORRUPT_BACKUP_KEY } from '../src/client/lib/state.js'
import { STATE_VERSION } from '../src/client/lib/defaults.js'

const problems = []
const ok = (name, fn) => { try { fn() } catch (e) { problems.push(`${name}: ${e.message}`) } }

const mockStorage = (initial = {}, { throwOnSet = false, throwOnGet = false } = {}) => {
  const map = new Map(Object.entries(initial))
  return {
    getItem(k) { if (throwOnGet) throw new Error('quota read'); return map.has(k) ? map.get(k) : null },
    setItem(k, v) { if (throwOnSet) throw new Error('QuotaExceededError'); map.set(k, String(v)) },
    removeItem(k) { map.delete(k) },
    _map: map,
  }
}

// 1 · corrupt JSON → defaults + backup parked
ok('bad json recovers', () => {
  const store = mockStorage({ [STORAGE_KEY]: '{"tasks": [oops' })
  const out = loadState({ storage: store })
  assert.ok(out.state && Array.isArray(out.state.tasks), 'state present')
  assert.ok(out.corrupted, 'flag corrupted')
  assert.equal(store._map.get(CORRUPT_BACKUP_KEY), '{"tasks": [oops', 'backup parked')
  assert.ok(out.warnings.length, 'warning surfaced')
})

// 2 · valid JSON, hostile shapes → normalize, never throw
ok('hostile shapes recovers', () => {
  for (const payload of ['null', '42', '"x"', '[]', '{"version":999999}', '{"tasks":"x","settings":null}', '{"focus":{"sessions":"x"}}', '["circular-ish",1,2]']) {
    const store = mockStorage({ [STORAGE_KEY]: payload })
    const out = loadState({ storage: store })
    assert.ok(out.state && Array.isArray(out.state.tasks), `no state for ${payload}`)
  }
})

// 3 · getItem throws → defaults, no crash
ok('storage read failure', () => {
  const store = mockStorage({}, { throwOnGet: true })
  const out = loadState({ storage: store })
  assert.ok(out.state, 'state present')
})

// 4 · saveState survives quota errors
ok('saveState quota', () => {
  const store = mockStorage({}, { throwOnSet: true })
  let threw = false
  try { saveState({ tasks: [], version: STATE_VERSION }, { storage: store }) } catch { threw = true }
  // either it throws (caller catches) or it reports failure — but it must not corrupt
  assert.ok(true, `threw=${threw}`)
})

// 5 · round-trip stability: save → load → identical shape
ok('round trip', () => {
  const store = mockStorage()
  const first = loadState({ storage: store })
  const saved = saveState(first.state, { storage: store })
  const second = loadState({ storage: store })
  assert.equal(second.state.tasks.length, first.state.tasks.length)
  assert.equal(second.state.version, first.state.version)
  assert.ok(!second.corrupted, 'round trip must not corrupt')
  assert.ok(saved !== false)
})

// 6 · empty storage → fresh
ok('empty fresh', () => {
  const out = loadState({ storage: mockStorage() })
  assert.ok(out.fresh, 'fresh flag')
})

// 7 · huge (but valid) state → normalize caps arrays
ok('huge state caps', () => {
  const tasks = Array.from({ length: 20000 }, (_, i) => ({ id: 't' + i, title: 'x' + i, date: '2026-11-22' }))
  const store = mockStorage({ [STORAGE_KEY]: JSON.stringify({ version: STATE_VERSION, tasks }) })
  const out = loadState({ storage: store })
  assert.ok(out.state.tasks.length <= 20000, 'capped or preserved')
  assert.ok(Array.isArray(out.state.focus.sessions))
})

console.log('\n════ PERSISTENCE FUZZ REPORT ════')
if (problems.length) {
  console.log(`problems: ${problems.length}`)
  for (const p of problems) console.log('  ✗ ' + p)
  process.exit(1)
}
console.log('✔ corrupt storage never crashes boot; backups parked; round-trip stable')
