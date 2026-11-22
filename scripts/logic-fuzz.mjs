#!/usr/bin/env node
/**
 * Logic fuzz — hammers the lib layer with boundary inputs, asserting no
 * NaN/Infinity/throws and sane invariants. Catches silent math bugs.
 */
import assert from 'node:assert/strict'
import { parseQuickCapture } from '../src/client/lib/quickparse.js'
import { occursOn, normalizeRecurrence } from '../src/client/lib/recurrence.js'
import { computeStreak, isSuccessfulDay } from '../src/client/lib/streak.js'
import { computeDailyScore } from '../src/client/lib/score.js'
import { loadStatus, buildForecast, findConflicts, forecastAdvice } from '../src/client/lib/forecast.js'
import { formatDuration, dateKey, addDays, isValidKey, diffDays } from '../src/client/lib/dates.js'
import { migrateState, normalizeState, makeContext, emptyState, clampNumber, storageUsage } from '../src/client/lib/state.js'
import { dayStats, dayPlanFor, rangeDayStats } from '../src/client/lib/daystats.js'

let n = 0
const problems = []
const ok = (name, fn) => {
  try { fn() } catch (e) { problems.push(`${name}: ${e.message}`) }
}
const finite = (obj, label) => {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'number' && !Number.isFinite(v)) problems.push(`${label}.${k} = ${v}`)
    if (typeof v === 'string' && /NaN|Infinity|undefined/.test(v)) problems.push(`${label}.${k} text "${v}"`)
  }
}
const ctx = () => makeContext({ now: Date.UTC(2026, 10, 22, 9), id: () => `id${++n}` })

// ── quickparse ───────────────────────────────────────────────────────────
for (const input of ['', '   ', '<b>x</b> !! @@@ ### tomorrow tomorrow', 'टेस्ट 🎯 !!hi @23:59', 'x in 99999999 days', 'x in -5 days !low', '!high @25:00 task', 'repeat every 0 days', 'a'.repeat(2000)]) {
  ok(`quickparse:${JSON.stringify(input.slice(0, 16))}`, () => {
    const r = parseQuickCapture(input, { now: new Date('2026-11-22T09:00:00Z'), todayKey: '2026-11-22' })
    assert.equal(typeof r.title, 'string', 'title must be string')
    if (r.date !== null && r.date !== undefined) assert.match(String(r.date), /^\d{4}-\d{2}-\d{2}$/, `bad date ${r.date}`)
    finite(r, 'quickparse')
  })
}

// ── recurrence ───────────────────────────────────────────────────────────
ok('monthly 31st across year', () => {
  for (let m = 0; m < 24; m++) {
    const d = new Date(Date.UTC(2026, m, 28))
    const key = d.toISOString().slice(0, 10)
    const hit = occursOn({ freq: 'monthly', day: 31, interval: 1, endsOn: null, count: null }, key)
    assert.equal(typeof hit, 'boolean')
    if (hit) assert.ok(isValidKey(key), `invalid key produced: ${key}`)
  }
})
ok('weekly empty weekdays', () => {
  assert.equal(typeof occursOn({ freq: 'weekly', weekdays: [], interval: 1, endsOn: null, count: null }, '2026-11-22'), 'boolean')
})
ok('weekly 7 weekdays + out-of-range', () => {
  for (const wd of [[0, 1, 2, 3, 4, 5, 6], [9, -1], [null, 'x']]) {
    assert.equal(typeof occursOn({ freq: 'weekly', weekdays: wd, interval: 1, endsOn: null, count: null }, '2026-11-22'), 'boolean')
  }
})
ok('yearly feb 29 + interval extremes', () => {
  occursOn({ freq: 'yearly', month: 2, day: 29, interval: 1, endsOn: null, count: null }, '2028-02-29')
  occursOn({ freq: 'yearly', month: 2, day: 29, interval: 1, endsOn: null, count: null }, '2027-02-28')
  occursOn({ freq: 'daily', interval: 0, endsOn: null, count: null }, '2026-11-22')
  occursOn({ freq: 'daily', interval: -2, endsOn: null, count: null }, '2026-11-22')
  occursOn({ freq: 'monthly', day: 0, interval: 1 }, '2026-11-22')
  occursOn({ freq: 'monthly', day: 32, interval: 1 }, '2026-11-22')
})
ok('normalizeRecurrence hostile', () => {
  for (const junk of [null, 'x', 42, { freq: 'nope' }, { freq: 'weekly', weekdays: 'monday' }, { freq: 'monthly', day: 'x' }, { freq: 'daily', count: -3, endsOn: 'bad' }]) {
    const r = normalizeRecurrence(junk)
    if (r && r.freq) occursOn(r, '2026-11-22')
  }
})

// ── dates ────────────────────────────────────────────────────────────────
ok('formatDuration bounds', () => {
  for (const v of [0, 1, 59, 60, 90, 1440, 1e9, -30, NaN]) {
    const s = formatDuration(v)
    assert.equal(typeof s, 'string')
    if (/NaN|Infinity|undefined/.test(s)) problems.push(`formatDuration(${v}) = "${s}"`)
  }
})
ok('addDays month/year wrap', () => {
  for (const [k, d] of [['2026-11-30', 1], ['2026-12-31', 1], ['2026-01-01', -1], ['2026-02-28', 1], ['2028-02-28', 1], ['2026-11-22', 0], ['2026-11-22', 10000], ['2026-11-22', -10000]]) {
    const out = addDays(k, d)
    assert.ok(isValidKey(out), `addDays(${k},${d}) = ${out}`)
  }
})
ok('diffDays sign + validity', () => {
  assert.equal(diffDays('2026-11-22', '2026-11-22'), 0)
  assert.equal(typeof diffDays('2026-11-22', '2026-11-25'), 'number')
})

// ── loadStatus / forecast ────────────────────────────────────────────────
ok('loadStatus boundaries', () => {
  assert.equal(loadStatus(0, 0), 'light')
  assert.equal(loadStatus(34, 0), 'light')
  assert.equal(loadStatus(35, 0), 'balanced')
  assert.equal(loadStatus(91, 0), 'full')
  assert.equal(loadStatus(92, 0), 'over')
  assert.equal(loadStatus(1e9, 0), 'over')
  assert.equal(loadStatus(0, 1), 'conflict')
  assert.equal(loadStatus(-5, 0), 'light')
  assert.equal(loadStatus(NaN, 0), 'light')
})

// ── state migration + normalize fuzz ─────────────────────────────────────
ok('migrate garbage', () => {
  for (const junk of [null, undefined, 42, 'x', [], { tasks: 'nope' }, { tasks: [null, 1, {}] }, { version: 999999 }, { timetable: 7 }, { top3: 'x' }, { settings: 5 }]) {
    const out = migrateState(junk, ctx())
    assert.ok(out && out.state, `migrate produced nothing for ${JSON.stringify(junk)?.slice(0, 30)}`)
    assert.ok(Array.isArray(out.state.tasks), 'tasks must be an array')
    finite(out.state.settings?.reminders || {}, 'migrate.settings')
  }
})
ok('normalize hostile shapes', () => {
  const base = emptyState(ctx())
  const hostile = {
    ...base,
    tasks: [
      { id: 't1', title: 42, date: 'not-a-date', priority: 'banana', estimateMinutes: 'lots', done: 'yes', subtasks: 'x', notes: 7, recurrence: 3 },
      { id: 't2', date: '2026-13-45', priority: null, estimateMinutes: -500, done: 1, seriesId: 9 },
    ],
    focusSessions: [{ id: 'f', focusedSeconds: NaN, plannedMinutes: -3, startedAt: 'x' }, { focusedSeconds: Infinity }],
    top3: { '2026-11-22': [null, 't1', 7, 't1'] },
    timetables: { bad: 'x', ok: [{ id: 'b', time: '25:99', duration: 'lots' }, null] },
    scoreHistory: 'x',
  }
  const s = normalizeState(hostile, ctx())
  assert.ok(Array.isArray(s.tasks))
  for (const t of s.tasks) {
    assert.equal(typeof t.title, 'string', `title not string: ${typeof t.title}`)
    assert.ok(t.estimateMinutes === undefined || Number.isFinite(Number(t.estimateMinutes)), 'NaN estimate leaked')
  }
  for (const f of s.focus.sessions) {
    assert.ok(Number.isFinite(f.focusedSeconds), 'NaN focusedSeconds leaked')
    assert.ok(Number.isFinite(f.plannedMinutes), 'NaN plannedMinutes leaked')
  }
})
ok('clampNumber extremes', () => {
  assert.equal(clampNumber(NaN, 0, 10, 5), 5)
  assert.equal(clampNumber(Infinity, 0, 10, 5), 5)
  assert.equal(clampNumber('junk', 0, 10, 0), 0)
  assert.equal(clampNumber(5, 0, 10, 0), 5)
  assert.equal(clampNumber('7.6', 0, 10, 0), 8)
})

// ── score / streak / daystats / forecast on hostile states ───────────────
ok('computeDailyScore edges', () => {
  for (const input of [
    { dateKey: '2026-11-22', todayKey: '2026-11-22' },
    { dateKey: '2026-11-22', todayKey: '2026-11-22', nowMinutes: 0, focusedMinutes: 0, focusTargetMinutes: 0 },
    { dateKey: '2026-11-22', todayKey: '2026-11-22', focusTargetMinutes: -5, plannedTasks: [{ id: 'a', done: true }], blocks: [{ id: 'b', done: false, start: 999999, duration: -3 }] },
    { dateKey: '2026-11-22', todayKey: '2026-11-21', overdueTaskCount: 1e9, focusedMinutes: 1e9 },
  ]) {
    const s = computeDailyScore(input)
    finite(s, 'score')
    assert.ok(typeof s.score === 'number' && Number.isFinite(s.score), `score=${s.score}`)
  }
})
ok('computeStreak hostile history', () => {
  for (const history of [{}, { '2026-11-22': 'yes' }, { '2026-11-22': 1 }, { 'bad-date': 1 }, Array.from({ length: 5000 }, (_, i) => i).reduce((a, _, i) => (a[`2026-01-01` + i] = 1, a), {})]) {
    const s = computeStreak({ todayKey: '2026-11-22', history, lookback: 400 })
    finite(s, 'streak')
    assert.equal(typeof isSuccessfulDay(history['2026-11-22']), 'boolean')
  }
})
ok('dayStats / dayPlanFor / range hostile', () => {
  const c = ctx()
  const base = emptyState(c)
  const state = normalizeState({ ...base, tasks: [{ id: 't', title: 'x', date: '2026-11-22', done: false, estimateMinutes: 30 }] }, c)
  for (const key of ['2026-11-22', '2026-02-30', 'garbage', '2026-13-01']) {
    const d = dayStats(state, key)
    finite(d, `dayStats(${key})`)
  }
  finite(dayPlanFor(state, '2026-11-22'), 'dayPlan')
  const range = rangeDayStats(state, '2026-11-01', '2026-11-30')
  assert.ok(Array.isArray(range) || typeof range === 'object')
})
ok('buildForecast + advice hostile', () => {
  const c = ctx()
  const base = emptyState(c)
  for (const days of [0, 1, 14, 30, -5, 1000]) {
    const f = buildForecast(base, { todayKey: '2026-11-22', days })
    assert.ok(f && Array.isArray(f.days), `forecast.days for days=${days}`)
    for (const d of f.days) finite(d, 'forecast.day')
    const advice = forecastAdvice(f)
    finite(advice, 'advice')
    const adviceText = typeof advice === 'string' ? advice : JSON.stringify(advice)
    if (/NaN|Infinity/.test(adviceText)) problems.push(`advice text "${adviceText.slice(0, 60)}"`)
  }
  const conflicts = findConflicts([{ id: 'a', time: '10:00', duration: 60 }, { id: 'b', time: '10:30', duration: -10 }, { id: 'c', time: '99:99', duration: 60 }, null])
  assert.ok(Array.isArray(conflicts))
})

// ── storageUsage fuzz ────────────────────────────────────────────────────
ok('storageUsage hostile', () => {
  for (const s of [emptyState(ctx()), null, undefined, { tasks: 'x' }, {}]) {
    const u = storageUsage(s)
    assert.equal(typeof u, 'object')
    finite(u, 'storageUsage')
  }
})

console.log('\n════ LOGIC FUZZ REPORT ════')
if (problems.length) {
  console.log(`problems: ${problems.length}`)
  for (const p of [...new Set(problems)]) console.log('  ✗ ' + p)
  process.exit(1)
}
console.log('✔ all logic probes sane (no NaN, no throws, invariants hold)')
