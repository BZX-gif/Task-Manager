/**
 * The achievement engine: Perfect Days, the 10-day run and the private title.
 *
 * A Perfect Day needs 100% of that day's planned tasks AND 100% of that day's
 * started timetable blocks — an empty day never counts. Days are local
 * calendar days, are snapshotted, and are frozen once they are over so later
 * edits cannot rewrite them.
 */
process.env.TZ = 'Pacific/Auckland' // UTC+12 — makes UTC/date bugs obvious

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PERFECT_DAY_RULE_TEXT,
  evaluatePerfectDay,
  perfectCountsFor,
  perfectRun,
  pendingCelebrations,
  syncAchievements,
  syncPerfectDays,
  titleResults,
} from '../../src/client/lib/achievements.js'
import { loadState, saveState } from '../../src/client/lib/state.js'
import { addDays, dateKey } from '../../src/client/lib/dates.js'
import { blocks, baseState, NOW, task, TODAY } from '../helpers/fixtures.js'

/* --------------------------------------------------------------- helpers */

/** A brand new state with a known 4-block timetable and no history. */
function freshState() {
  return baseState({ timetable: blocks(), dayPlans: {}, completionLog: {}, achievements: { days: {}, unlocked: {} } })
}

/** Turn one day into a genuinely perfect day in the given state. */
function makePerfectDay(state, key, { taskCount = 2, blockList = blocks() } = {}) {
  state.dayPlans[key] = blockList.map((block) => ({ ...block }))
  for (let i = 0; i < taskCount; i++) {
    state.tasks.push(task(`${key}-t${i}`, { date: key, done: true, completedAt: 1 }))
  }
  state.completionLog[key] = { ttDone: blockList.map((block) => block.id), taskDone: [] }
  return state
}

/** `count` consecutive perfect days ending yesterday. */
function runOf(count, { gapEvery = 0, extra = {} } = {}) {
  const state = freshState()
  Object.assign(state, extra.state || {})
  for (let i = 1; i <= count; i++) {
    if (gapEvery && i % gapEvery === 0) continue
    makePerfectDay(state, addDays(TODAY, -i), extra.day || {})
  }
  const result = syncAchievements(state, { todayKey: TODAY, now: NOW, full: true })
  return { state, result, title: result.titles[0] }
}

/* ------------------------------------------------- 1 · the rule itself */

test('the rule: tasks AND timetable, and never an empty day', () => {
  assert.equal(evaluatePerfectDay({ tasksPlanned: 2, tasksCompleted: 2, blocksPlanned: 4, blocksCompleted: 4 }).perfect, true)
  assert.equal(evaluatePerfectDay({ tasksPlanned: 2, tasksCompleted: 1, blocksPlanned: 4, blocksCompleted: 4 }).perfect, false)
  assert.equal(evaluatePerfectDay({ tasksPlanned: 2, tasksCompleted: 2, blocksPlanned: 4, blocksCompleted: 3 }).perfect, false)
  // 8 · zero tasks must not be 100%
  const noTasks = evaluatePerfectDay({ tasksPlanned: 0, tasksCompleted: 0, blocksPlanned: 4, blocksCompleted: 4 })
  assert.equal(noTasks.perfect, false)
  assert.equal(noTasks.hasWork, false)
  // 9 · zero timetable commitments must not be 100% either
  assert.equal(evaluatePerfectDay({ tasksPlanned: 2, tasksCompleted: 2, blocksPlanned: 0, blocksCompleted: 0 }).perfect, false)
  assert.equal(evaluatePerfectDay({}).perfect, false, 'an empty day is never perfect')
  assert.ok(PERFECT_DAY_RULE_TEXT.length >= 3)
})

/* ------------------------------------------------- 1-5 · the ten-day run */

test('1 Perfect Day = streak 1', () => {
  const { result, title } = runOf(1)
  assert.equal(result.run.current, 1)
  assert.equal(result.run.total, 1)
  assert.equal(title.unlocked, false, 'one day is not a title')
  assert.equal(title.progressLabel, '1 / 10 PERFECT DAYS')
  assert.equal(title.remainingLabel, '9 DAYS TO GO')
})

test('5 Perfect Days = streak 5', () => {
  const { result, title } = runOf(5)
  assert.equal(result.run.current, 5)
  assert.equal(title.value, 5)
  assert.equal(title.percent, 50)
})

test('9 Perfect Days = still locked, one day to go', () => {
  const { title } = runOf(9)
  assert.equal(title.unlocked, false)
  assert.equal(title.met, false)
  assert.equal(title.progressLabel, '9 / 10 PERFECT DAYS')
  assert.equal(title.remainingLabel, '1 DAY TO GO')
})

test('10 Perfect Days = unlocked, with the local unlock date', () => {
  const { state, result, title } = runOf(10)
  assert.equal(result.run.current, 10)
  assert.deepEqual(result.newlyUnlocked, ['discipline-monster'])
  assert.equal(title.unlocked, true)
  assert.equal(title.met, true)
  assert.equal(title.progressLabel, '10 / 10 PERFECT DAYS')
  assert.equal(title.remainingLabel, '0 DAYS TO GO')
  const entry = state.achievements.unlocked['discipline-monster']
  assert.equal(entry.dateKey, TODAY, 'stamped with the local day it was noticed')
  assert.equal(entry.streak, 10)
  assert.equal(entry.seen, false, 'the ceremony has not been shown yet')
  assert.equal(pendingCelebrations(state).length, 1)
})

test('11 Perfect Days = still exactly one title, never a second copy', () => {
  const { state, result, title } = runOf(11)
  assert.equal(result.run.current, 11)
  assert.equal(Object.keys(state.achievements.unlocked).length, 1)
  assert.equal(result.titles.length, 1, 'the collection holds one title for now')
  assert.equal(title.unlocked, true)
  assert.equal(title.unlockedStreak >= 10, true)
  const second = syncAchievements(state, { todayKey: TODAY, now: NOW, full: true })
  assert.deepEqual(second.newlyUnlocked, [])
  assert.equal(Object.keys(state.achievements.unlocked).length, 1, 're-evaluating cannot duplicate the unlock')
})

/* --------------------------------------------- 6-7 · what breaks a day */

test('6 · an incomplete task breaks its day', () => {
  const state = freshState()
  makePerfectDay(state, addDays(TODAY, -1))
  makePerfectDay(state, addDays(TODAY, -2))
  // day 3: one task left open
  makePerfectDay(state, addDays(TODAY, -3), { taskCount: 1 })
  state.tasks.push(task(`${addDays(TODAY, -3)}-open`, { date: addDays(TODAY, -3), done: false }))
  const { run } = syncAchievements(state, { todayKey: TODAY, now: NOW, full: true })

  const broken = state.achievements.days[addDays(TODAY, -3)]
  assert.equal(broken.perfect, false)
  assert.equal(broken.tasksPlanned, 2)
  assert.equal(broken.tasksCompleted, 1)
  assert.equal(broken.frozen, true)
  assert.equal(run.current, 2, 'the run stops at the first imperfect day')
})

test('7 · an incomplete timetable block breaks its day', () => {
  const state = freshState()
  const key = addDays(TODAY, -1)
  makePerfectDay(state, key)
  state.completionLog[key].ttDone = blocks().slice(0, 3).map((block) => block.id) // one block missed
  const { run } = syncAchievements(state, { todayKey: TODAY, now: NOW, full: true })
  assert.equal(state.achievements.days[key].perfect, false)
  assert.equal(state.achievements.days[key].blocksCompleted, 3)
  assert.equal(state.achievements.days[key].blocksPlanned, 4)
  assert.equal(run.current, 0)
})

test('8 · a day with zero tasks is never perfect', () => {
  const state = freshState()
  const key = addDays(TODAY, -1)
  state.dayPlans[key] = blocks().map((block) => ({ ...block }))
  state.completionLog[key] = { ttDone: blocks().map((block) => block.id), taskDone: [] }
  const result = syncAchievements(state, { todayKey: TODAY, now: NOW, full: true })
  const day = state.achievements.days[key]
  assert.equal(day.tasksPlanned, 0)
  assert.equal(day.perfect, false)
  assert.equal(result.run.current, 0)
})

test('9 · a day with zero timetable commitments is never perfect', () => {
  const state = baseState({ timetable: [], dayPlans: {}, completionLog: {} })
  const key = addDays(TODAY, -1)
  state.tasks.push(task(`${key}-a`, { date: key, done: true }))
  state.tasks.push(task(`${key}-b`, { date: key, done: true }))
  const result = syncAchievements(state, { todayKey: TODAY, now: NOW, full: true })
  assert.equal(state.achievements.days[key].tasksCompleted, 2)
  assert.equal(state.achievements.days[key].blocksPlanned, 0)
  assert.equal(state.achievements.days[key].perfect, false)
  assert.equal(result.run.current, 0)
})

test('10 · non-consecutive perfect days do not add up', () => {
  const state = freshState()
  for (const offset of [1, 2, 4, 5]) makePerfectDay(state, addDays(TODAY, -offset)) // 3rd day missing
  const result = syncAchievements(state, { todayKey: TODAY, now: NOW, full: true })
  assert.equal(result.run.current, 2, 'the gap stops the run')
  assert.equal(result.run.best, 2)
  assert.equal(result.run.total, 4, 'total perfect days are still counted')
  assert.equal(result.titles[0].unlocked, false)

  // a gap inside a ten-day window means no title
  const gapped = runOf(10, { gapEvery: 5 })
  assert.equal(gapped.result.run.current, 4)
  assert.equal(gapped.title.unlocked, false)
  assert.deepEqual(gapped.result.newlyUnlocked, [])
})

/* ------------------------------------------------ 14 · historical stability */

test('deleting an unfinished task cannot rescue its day', () => {
  const state = freshState()
  const key = addDays(TODAY, -1)
  makePerfectDay(state, key, { taskCount: 2 })
  const open = task(`${key}-open`, { date: key, done: false })
  state.tasks.push(open)
  syncPerfectDays(state, { todayKey: TODAY, now: NOW, full: true })
  assert.equal(state.achievements.days[key].tasksPlanned, 3, 'planned work is a high-water mark')

  state.tasks = state.tasks.filter((item) => item.id !== open.id) // the "trick"
  syncPerfectDays(state, { todayKey: TODAY, now: NOW, full: true })
  assert.equal(state.achievements.days[key].tasksPlanned, 3)
  assert.equal(state.achievements.days[key].tasksCompleted, 2)
  assert.equal(state.achievements.days[key].perfect, false)
})

test('moving a task to another date cannot rescue its day either', () => {
  const state = freshState()
  const key = addDays(TODAY, -1)
  makePerfectDay(state, key, { taskCount: 1 })
  const open = task(`${key}-open`, { date: key, done: false })
  state.tasks.push(open)
  syncPerfectDays(state, { todayKey: TODAY, now: NOW, full: true })

  open.date = TODAY // moved to today
  syncPerfectDays(state, { todayKey: TODAY, now: NOW, full: true })
  const day = state.achievements.days[key]
  assert.equal(day.tasksPlanned, 2)
  assert.equal(day.perfect, false)
})

test('changing completion later cannot rewrite a finished day', () => {
  const state = freshState()
  const key = addDays(TODAY, -1)
  makePerfectDay(state, key)
  syncPerfectDays(state, { todayKey: TODAY, now: NOW, full: true })
  assert.equal(state.achievements.days[key].perfect, true)

  // uncheck everything + clear the completion log afterwards
  for (const item of state.tasks) item.done = false
  state.completionLog[key].ttDone = []
  syncPerfectDays(state, { todayKey: TODAY, now: NOW, full: true })
  assert.equal(state.achievements.days[key].perfect, true, 'frozen days are immutable')
  assert.equal(state.achievements.days[key].frozen, true)
})

test('editing the timetable after the fact cannot rewrite a finished day', () => {
  const state = freshState()
  const key = addDays(TODAY, -1)
  makePerfectDay(state, key)
  syncPerfectDays(state, { todayKey: TODAY, now: NOW, full: true })
  state.timetable = [blocks()[0]]
  state.dayPlans = {}
  syncPerfectDays(state, { todayKey: TODAY, now: NOW, full: true })
  assert.equal(state.achievements.days[key].blocksPlanned, 4)
  assert.equal(state.achievements.days[key].perfect, true)
})

test('today is never counted before it is over (no premature unlock)', () => {
  const state = freshState()
  for (let i = 1; i <= 9; i++) makePerfectDay(state, addDays(TODAY, -i))
  // today itself is flawless so far — tasks done, every started block ticked
  state.tasks.push(task('today-1', { date: TODAY, done: true }))
  state.completionLog[TODAY] = { ttDone: blocks().map((block) => block.id), taskDone: [] }
  const before = syncAchievements(state, { todayKey: TODAY, now: NOW, full: true })

  assert.equal(before.run.today.perfect, true, 'the live day is judged for feedback')
  assert.equal(before.run.current, 9, 'but it is not banked yet')
  assert.equal(before.titles[0].unlocked, false)
  assert.deepEqual(before.newlyUnlocked, [])

  // the next local day: yesterday (the flawless day) is now banked
  const tomorrow = addDays(TODAY, 1)
  const after = syncAchievements(state, { todayKey: tomorrow, now: new Date(2026, 8, 16, 0, 30) })
  assert.equal(after.run.current, 10)
  assert.equal(after.titles[0].unlocked, true)
  assert.deepEqual(after.newlyUnlocked, ['discipline-monster'])
})

test('only banked (finished) days count — a live snapshot never unlocks anything', () => {
  const state = freshState()
  const yesterday = addDays(TODAY, -1)
  // a record that looks perfect but was never closed out
  state.achievements.days[yesterday] = {
    tasksPlanned: 1,
    tasksCompleted: 1,
    blocksPlanned: 1,
    blocksCompleted: 1,
    blocksScheduled: 1,
    perfect: true,
    frozen: false,
  }
  const { run, newlyUnlocked } = syncAchievements(state, { todayKey: TODAY, now: NOW })
  assert.equal(run.current, 0, 'an unfinished snapshot is not proof of a perfect day')
  assert.deepEqual(newlyUnlocked, [])
})

/* ------------------------------------------- 11 · local calendar handling */

test('11 · days are the user’s local calendar days, not UTC', () => {
  // TZ is Pacific/Auckland (UTC+12) for this file
  const justAfterMidnight = new Date(2026, 8, 15, 0, 30)
  assert.equal(dateKey(justAfterMidnight), '2026-09-15')
  assert.notEqual(justAfterMidnight.toISOString().slice(0, 10), '2026-09-15', 'UTC would still be the 14th here')

  const state = freshState()
  const key = dateKey(justAfterMidnight)
  makePerfectDay(state, addDays(key, -1))
  const result = syncAchievements(state, { todayKey: key, now: justAfterMidnight, full: true })
  assert.equal(result.run.current, 1)
  assert.equal(state.achievements.days[key].frozen, false, 'today is live')
  assert.equal(state.achievements.days[addDays(key, -1)].frozen, true)
})

test('blocks only count once they have started', () => {
  const state = freshState()
  const key = TODAY
  state.dayPlans[key] = blocks().map((block) => ({ ...block })) // 09:00 → 12:00
  state.tasks.push(task('t-live', { date: key, done: true }))
  state.completionLog[key] = { ttDone: ['b1', 'b2'], taskDone: [] }

  const lateMorning = new Date(2026, 8, 15, 10, 30)
  const counts = perfectCountsFor(state, key, { todayKey: key, now: lateMorning })
  assert.equal(counts.blocksPlanned, 2, 'only 09:00 and 10:00 have started')
  assert.equal(counts.blocksCompleted, 2)
  assert.equal(counts.blocksScheduled, 4)
  assert.equal(evaluatePerfectDay(counts).perfect, true)

  const afternoon = new Date(2026, 8, 15, 12, 30)
  const later = perfectCountsFor(state, key, { todayKey: key, now: afternoon })
  assert.equal(later.blocksPlanned, 4)
  assert.equal(evaluatePerfectDay(later).perfect, false, 'a block that started and was missed breaks the day')
})

/* ----------------------------------- 12 · refresh / reload never duplicates */

test('12 · a reload never re-unlocks or re-celebrates', () => {
  const { state } = runOf(10)
  const storage = memoryStorage()
  saveState(state, { storage })

  const loaded = loadState({ storage, now: NOW.getTime() }).state
  assert.equal(Object.keys(loaded.achievements.unlocked).length, 1)
  assert.equal(loaded.achievements.unlocked['discipline-monster'].seen, false, 'the ceremony is still pending once')

  // the UI marks it as seen as soon as it is shown
  loaded.achievements.unlocked['discipline-monster'].seen = true
  saveState(loaded, { storage })

  const refreshed = loadState({ storage, now: NOW.getTime() }).state
  const again = syncAchievements(refreshed, { todayKey: TODAY, now: NOW, full: true })
  assert.deepEqual(again.newlyUnlocked, [], 'nothing is unlocked twice')
  assert.equal(Object.keys(refreshed.achievements.unlocked).length, 1)
  assert.deepEqual(pendingCelebrations(refreshed), [], 'no second ceremony after a refresh')

  // and the day snapshots survive the round-trip too
  assert.equal(refreshed.achievements.days[addDays(TODAY, -1)].frozen, true)
  assert.equal(again.run.current, 10)
})

/* ------------------------------------------------------ extras & catalog */

test('the title catalog is data-driven and easy to extend', () => {
  const { state } = runOf(3)
  const titles = titleResults(state, { todayKey: TODAY, now: NOW })
  assert.equal(titles.length, 1)
  const title = titles[0]
  assert.equal(title.name, 'DISCIPLINE MONSTER')
  assert.equal(title.subtitle, '10 DAY PERFECT RUN')
  assert.equal(title.emoji, '⚡')
  assert.equal(title.requirement.kind, 'perfect-streak')
  assert.equal(title.run.recent.length, 10, 'the ten-day strip is always renderable')
  assert.equal(title.run.recent.at(-1).isToday, true)
  assert.equal(title.run.recent.filter((day) => day.perfect).length, 3)
})

test('the sync reports whether it changed anything (no idle writes)', () => {
  const state = freshState()
  makePerfectDay(state, addDays(TODAY, -1))
  const first = syncAchievements(state, { todayKey: TODAY, now: NOW })
  assert.equal(first.changed, true, 'new snapshots were written')
  const second = syncAchievements(state, { todayKey: TODAY, now: NOW })
  assert.equal(second.changed, false, 're-running on the same data writes nothing')
  assert.deepEqual(second.newlyUnlocked, [])
})

test('records older than the lookback window are dropped', () => {
  const state = freshState()
  makePerfectDay(state, addDays(TODAY, -500))
  syncPerfectDays(state, { todayKey: TODAY, now: NOW, full: true })
  assert.equal(state.achievements.days[addDays(TODAY, -500)], undefined)
  assert.ok(state.achievements.days[TODAY], 'today is still tracked')
})

test('a legacy payload without the achievements key still resolves', () => {
  const state = baseState({ timetable: blocks(), dayPlans: {}, completionLog: {} })
  delete state.achievements
  const { run, titles } = syncAchievements(state, { todayKey: TODAY, now: NOW })
  assert.equal(run.current, 0)
  assert.equal(titles[0].unlocked, false)
  assert.ok(state.achievements.days[TODAY], 'today gets a live snapshot')
})

test('perfectRun tolerates an empty history', () => {
  const run = perfectRun({}, { todayKey: TODAY })
  assert.equal(run.current, 0)
  assert.equal(run.best, 0)
  assert.equal(run.total, 0)
  assert.equal(run.today.perfect, false)
  assert.equal(run.today.started, false)
})

/* ---------------------------------------------------------------- utils */

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    get length() {
      return map.size
    },
  }
}
