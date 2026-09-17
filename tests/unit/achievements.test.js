import test from 'node:test'
import assert from 'node:assert/strict'
import { addDays, dateKey } from '../../src/client/lib/dates.js'
import {
  TITLE_DEFINITIONS,
  isPerfectDay,
  computeLiveDayProgress,
  syncDailyProgress,
  getDayProgress,
  computeDisciplineStreak,
  evaluateTitles,
} from '../../src/client/lib/achievements.js'
import { emptyState, makeContext } from '../../src/client/lib/state.js'

function makeState(overrides = {}) {
  const ctx = makeContext({ now: Date.now(), id: (() => { let i = 0; return () => `id-${i++}` })() })
  const state = emptyState(ctx)
  Object.assign(state, overrides)
  if (!state.dailyProgress) state.dailyProgress = {}
  if (!state.titles) state.titles = { disciplineMonster: { unlocked: false, unlockedAt: null, unlockedAtTs: null, seen: false, bestStreak: 0, currentStreak: 0 } }
  return state
}

function addTask(state, date, done = true) {
  state.tasks.push({
    id: `t-${date}-${Math.random()}`,
    title: `Task ${date}`,
    date,
    done,
    priority: 'medium',
    cat: null,
    estimateMinutes: 30,
    notes: '',
    inbox: false,
    createdAt: Date.now(),
    completedAt: done ? Date.now() : null,
    recurrence: null,
    seriesId: null,
    occurrenceDate: null,
  })
}

function setTimetableDone(state, dateKeyValue, allDone = true) {
  if (!state.completionLog[dateKeyValue]) state.completionLog[dateKeyValue] = { ttDone: [], taskDone: [] }
  if (allDone) {
    state.completionLog[dateKeyValue].ttDone = state.timetable.map((b) => b.id)
  } else {
    state.completionLog[dateKeyValue].ttDone = state.timetable.slice(0, Math.floor(state.timetable.length / 2)).map((b) => b.id)
  }
}

test('1 Perfect Day = streak 1', () => {
  const today = '2026-09-15'
  const state = makeState()
  addTask(state, today, true)
  setTimetableDone(state, today, true)
  const now = new Date(`${today}T12:00:00`)
  syncDailyProgress(state, today, now, { full: true })
  const streak = computeDisciplineStreak(state, today, now)
  assert.equal(streak.current, 1)
  assert.equal(streak.best, 1)
  assert.equal(streak.todayPerfect, true)
})

test('5 Perfect Days = streak 5', () => {
  const today = '2026-09-15'
  const state = makeState()
  for (let i = 0; i < 5; i++) {
    const key = addDays(today, -i)
    addTask(state, key, true)
    setTimetableDone(state, key, true)
  }
  const now = new Date(`${today}T12:00:00`)
  syncDailyProgress(state, today, now, { full: true })
  const streak = computeDisciplineStreak(state, today, now)
  assert.equal(streak.current, 5)
  assert.equal(streak.best, 5)
})

test('9 Perfect Days = locked', () => {
  const today = '2026-09-15'
  const state = makeState()
  for (let i = 0; i < 9; i++) {
    const key = addDays(today, -i)
    addTask(state, key, true)
    setTimetableDone(state, key, true)
  }
  const now = new Date(`${today}T12:00:00`)
  syncDailyProgress(state, today, now, { full: true })
  const titles = evaluateTitles(state, today, now)
  assert.equal(titles.disciplineMonster.unlocked, false)
  assert.equal(titles.disciplineMonster.progress, 9)
  assert.equal(titles.disciplineMonster.remaining, 1)
})

test('10 Perfect Days = unlocked', () => {
  const today = '2026-09-15'
  const state = makeState()
  for (let i = 0; i < 10; i++) {
    const key = addDays(today, -i)
    addTask(state, key, true)
    setTimetableDone(state, key, true)
  }
  const now = new Date(`${today}T12:00:00`)
  syncDailyProgress(state, today, now, { full: true })
  const titles = evaluateTitles(state, today, now)
  assert.equal(titles.disciplineMonster.unlocked, true)
  assert.equal(titles.disciplineMonster.best, 10)
  assert.equal(titles.disciplineMonster.current, 10)
})

test('11 Perfect Days = still one title', () => {
  const today = '2026-09-15'
  const state = makeState()
  for (let i = 0; i < 11; i++) {
    const key = addDays(today, -i)
    addTask(state, key, true)
    setTimetableDone(state, key, true)
  }
  const now = new Date(`${today}T12:00:00`)
  syncDailyProgress(state, today, now, { full: true })
  const titles = evaluateTitles(state, today, now)
  assert.equal(titles.disciplineMonster.unlocked, true)
  assert.equal(titles.disciplineMonster.best, 11)
  // Only one title definition for now
  assert.equal(Object.keys(TITLE_DEFINITIONS).length, 1)
})

test('Incomplete task breaks Perfect Day', () => {
  const today = '2026-09-15'
  const state = makeState()
  addTask(state, today, true)
  addTask(state, today, false) // incomplete
  setTimetableDone(state, today, true)
  const now = new Date(`${today}T12:00:00`)
  const prog = computeLiveDayProgress(state, today, today, now)
  assert.equal(prog.perfect, false)
  assert.equal(isPerfectDay(prog), false)
})

test('Incomplete timetable breaks Perfect Day', () => {
  const today = '2026-09-15'
  const state = makeState()
  addTask(state, today, true)
  setTimetableDone(state, today, false)
  const now = new Date(`${today}T12:00:00`)
  const prog = computeLiveDayProgress(state, today, today, now)
  assert.equal(prog.perfect, false)
})

test('Zero tasks does not count as perfect', () => {
  const today = '2026-09-15'
  const state = makeState()
  // no tasks
  setTimetableDone(state, today, true)
  const now = new Date(`${today}T12:00:00`)
  const prog = computeLiveDayProgress(state, today, today, now)
  assert.equal(prog.tasksPlanned, 0)
  assert.equal(prog.perfect, false)
})

test('Zero timetable commitments does not count', () => {
  const today = '2026-09-15'
  const state = makeState()
  state.timetable = [] // no blocks
  addTask(state, today, true)
  const now = new Date(`${today}T12:00:00`)
  const prog = computeLiveDayProgress(state, today, today, now)
  assert.equal(prog.timetablePlanned, 0)
  assert.equal(prog.perfect, false)
})

test('Non-consecutive days don\'t count', () => {
  const today = '2026-09-15'
  const state = makeState()
  // Perfect on 15, 14, 12 (skip 13) => streak should be 2, not 3
  addTask(state, '2026-09-15', true)
  setTimetableDone(state, '2026-09-15', true)
  addTask(state, '2026-09-14', true)
  setTimetableDone(state, '2026-09-14', true)
  // 2026-09-13 missing -> not perfect
  addTask(state, '2026-09-12', true)
  setTimetableDone(state, '2026-09-12', true)

  const now = new Date(`${today}T12:00:00`)
  syncDailyProgress(state, today, now, { full: true })
  // Manually mark 13 as not perfect (no tasks)
  const streak = computeDisciplineStreak(state, today, now)
  assert.equal(streak.current, 2, `expected current 2, got ${streak.current}`)
  assert.equal(streak.best, 2)
})

test('Correct local date handling', () => {
  // dateKey uses local calendar, not UTC
  const d = new Date(2026, 8, 15, 23, 30) // Sep 15 local 23:30
  const key = dateKey(d)
  assert.equal(key, '2026-09-15')
  const next = addDays(key, 1)
  assert.equal(next, '2026-09-16')
})

test('Refresh does not duplicate unlock (seen flag)', () => {
  const today = '2026-09-15'
  const state = makeState()
  for (let i = 0; i < 10; i++) {
    const k = addDays(today, -i)
    addTask(state, k, true)
    setTimetableDone(state, k, true)
  }
  const now = new Date(`${today}T12:00:00`)
  syncDailyProgress(state, today, now, { full: true })
  // Simulate first unlock
  state.titles.disciplineMonster.unlocked = true
  state.titles.disciplineMonster.unlockedAt = today
  state.titles.disciplineMonster.seen = false

  // Second evaluation should still be unlocked, but seen remains false until UI marks it
  const titles = evaluateTitles(state, today, now)
  assert.equal(titles.disciplineMonster.unlocked, true)

  // After marking seen, refresh should not trigger new unlock
  state.titles.disciplineMonster.seen = true
  const titles2 = evaluateTitles(state, today, now)
  assert.equal(titles2.disciplineMonster.seen, true)
  assert.equal(titles2.disciplineMonster.unlocked, true)
})

test('Historical stability — frozen snapshot prevents deletion exploit', () => {
  const today = '2026-09-17'
  const yesterday = '2026-09-16'
  const state = makeState()
  // Yesterday: 2 tasks, 1 incomplete -> not perfect
  addTask(state, yesterday, true)
  addTask(state, yesterday, false)
  setTimetableDone(state, yesterday, true)
  const now1 = new Date(`${yesterday}T12:00:00`)
  syncDailyProgress(state, yesterday, now1, { full: true })
  let prog = getDayProgress(state, yesterday, yesterday, now1)
  assert.equal(prog.perfect, false)

  // Today: user deletes incomplete task from yesterday (simulate by removing from tasks array)
  state.tasks = state.tasks.filter((t) => !(t.date === yesterday && !t.done))
  const now2 = new Date(`${today}T12:00:00`)
  // Light sync should NOT overwrite yesterday's frozen snapshot
  syncDailyProgress(state, today, now2, { full: false })
  prog = getDayProgress(state, yesterday, today, now2)
  // Should still be not perfect (frozen)
  assert.equal(prog.perfect, false, 'deleting incomplete task should not make past day perfect')
})

test('Existing Focus Mission still works (mission math)', async () => {
  const { missionPhase, finalMinuteStage, milestoneCrossed } = await import('../../src/client/lib/mission.js')
  assert.equal(missionPhase(0.1).key, 'warmup')
  assert.equal(missionPhase(0.6).key, 'deep')
  assert.equal(finalMinuteStage(5).key, 'almost')
  assert.ok(milestoneCrossed(0.2, 0.3))
})

test('Existing tasks still work (normalizeTask)', async () => {
  const { normalizeTask } = await import('../../src/client/lib/state.js')
  const ctx = makeContext({ now: 1, id: () => 'x' })
  const t = normalizeTask({ title: 'Test', date: '2026-09-15', priority: 'high' }, ctx)
  assert.equal(t.title, 'Test')
  assert.equal(t.date, '2026-09-15')
})

test('Existing timetable still works (dayPlan)', async () => {
  const { dayPlanFor } = await import('../../src/client/lib/daystats.js')
  const state = makeState()
  const plan = dayPlanFor(state, '2026-09-15')
  assert.ok(Array.isArray(plan))
  assert.ok(plan.length > 0)
})

test('Profile displays title correctly (structure)', () => {
  const def = TITLE_DEFINITIONS.DISCIPLINE_MONSTER
  assert.equal(def.name, 'DISCIPLINE MONSTER')
  assert.equal(def.subtitle, '10 DAY PERFECT RUN')
  assert.equal(def.icon, '⚡')
  assert.equal(def.requirement, 10)
})
