/* -------------------------------------------------------------------------
   ACHIEVEMENTS — private titles, earned from real days (local-only)
   -------------------------------------------------------------------------
   Everything here is a pure function over the app's *existing* data:

     tasks          → state.tasks            (dates + done)
     timetable      → state.dayPlans[date]   (the timetable as it looked that day)
     completions    → state.completionLog[date].ttDone
     history        → state.achievements      (daily snapshots written by this module)

   A PERFECT DAY needs BOTH, for the same local calendar day:

     • every planned task done        (and at least one planned task)
     • every timetable block that has already started, done
       (and at least one such block)

   An empty day (no tasks, no blocks) is never 100% — it can never be perfect.

   HISTORICAL STABILITY
     `state.achievements.days[date]` is a small daily snapshot. While the day is
     running it tracks a high-water mark of *planned* work, so deleting an
     unfinished task, moving it to another date or editing the timetable cannot
     retroactively turn a broken day into a perfect one. Once the calendar day
     is over the snapshot is frozen and never recalculated.

   PRIVACY
     Nothing leaves the browser: no server, no account, no sharing, no URL.

   ADDING A TITLE LATER
     Append one object to TITLE_CATALOG (or register another requirement kind
     with `registerRequirementKind`) — the store, Profile view, dashboard strip
     and unlock ceremony all read from this configuration.
   ------------------------------------------------------------------------- */

import { addDays, dateKey, isValidKey, minutesOfDay, nowMinutes, weekdayShort, weekdayOf } from './dates.js'
import { dayPlanFor } from './daystats.js'

/** How far back perfect days are derived/kept (days). */
export const PERFECT_HISTORY_DAYS = 400
/** Past days re-checked on a normal (non-boot) sync — covers the day rollover. */
const ROLLOVER_DAYS = 3

export const PERFECT_DAY_RULE_TEXT = [
  'all of the day’s planned tasks done',
  'all of that day’s timetable blocks that have already started, done',
  'planned work on the day (empty days never count)',
]

/* ------------------------------------------------------------------ titles */

/**
 * The title collection. Adding another title is a matter of adding an entry
 * here (plus, if it needs a new rule, one evaluator below).
 *
 * @type {Array<Object>}
 */
export const TITLE_CATALOG = [
  {
    id: 'discipline-monster',
    emoji: '⚡',
    name: 'DISCIPLINE MONSTER',
    subtitle: '10 DAY PERFECT RUN',
    description: 'A perfect day is 100% of your planned tasks and 100% of your planned timetable. Ten of those, back to back.',
    requirement: { kind: 'perfect-streak', target: 10 },
    /** copy for the unlock ceremony */
    celebration: {
      completed: 'PERFECT DAYS COMPLETED',
      note: 'You showed up. You finished. You stayed consistent.',
    },
  },
]

/**
 * Titles that are *not implemented yet* — shown as locked placeholders on the
 * Profile so the collection has somewhere to grow. No fake progress: they stay
 * "coming soon" until a real requirement is added to TITLE_CATALOG above.
 */
export const PLANNED_TITLES = [
  { id: 'focus-beast', name: 'FOCUS BEAST', hint: 'Deep-focus milestones' },
  { id: 'consistency-king', name: 'CONSISTENCY KING', hint: 'A long consistency run' },
  { id: 'task-slayer', name: 'TASK SLAYER', hint: 'Task throughput' },
  { id: 'deep-work-beast', name: 'DEEP WORK BEAST', hint: 'Long single sessions' },
  { id: '30-day-machine', name: '30 DAY MACHINE', hint: 'A full month of perfect days' },
]

/** @param {string} id */
export function titleById(id) {
  return TITLE_CATALOG.find((title) => title.id === id) || null
}

/* ------------------------------------------------------- perfect-day maths */

const int = (value) => {
  const num = Number(value)
  return Number.isFinite(num) ? Math.max(0, Math.round(num)) : 0
}

/**
 * The perfect-day rule, applied to one day's counts.
 * @param {{tasksPlanned?:number, tasksCompleted?:number, blocksPlanned?:number, blocksCompleted?:number}} counts
 */
export function evaluatePerfectDay(counts) {
  const source = counts || {}
  const tasksPlanned = int(source.tasksPlanned)
  const tasksCompleted = int(source.tasksCompleted)
  const blocksPlanned = int(source.blocksPlanned)
  const blocksCompleted = int(source.blocksCompleted)
  const hasWork = tasksPlanned > 0 && blocksPlanned > 0
  const tasksComplete = tasksPlanned > 0 && tasksCompleted >= tasksPlanned
  const blocksComplete = blocksPlanned > 0 && blocksCompleted >= blocksPlanned
  return {
    tasksPlanned,
    tasksCompleted,
    blocksPlanned,
    blocksCompleted,
    hasWork,
    tasksComplete,
    blocksComplete,
    /** a day is only perfect with real planned work on BOTH sides */
    perfect: hasWork && tasksComplete && blocksComplete,
  }
}

/**
 * Human explanation of why a day is (not) perfect — used by the Profile view.
 * @param {any} counts
 */
export function perfectDayDetail(counts) {
  const state = evaluatePerfectDay(counts)
  const missing = []
  if (!state.hasWork) missing.push('no planned work')
  else {
    if (!state.tasksComplete) missing.push(`${state.tasksCompleted}/${state.tasksPlanned} tasks`)
    if (!state.blocksComplete) missing.push(`${state.blocksCompleted}/${state.blocksPlanned} blocks`)
  }
  return {
    ...state,
    missing,
    summary: state.perfect
      ? `${state.tasksPlanned} tasks · ${state.blocksPlanned} blocks · all done`
      : missing.join(' · '),
  }
}

/** A stored day snapshot is judged by the rule, never by a stored boolean. */
export function dayIsPerfect(record) {
  return evaluatePerfectDay(record).perfect
}

/**
 * A *banked* day: the calendar day is over (the snapshot is frozen) and the
 * rule was satisfied. Only banked days count towards the run — today is still
 * being written, so it can never unlock anything early.
 */
export function dayIsBankedPerfect(record) {
  return record?.frozen === true && dayIsPerfect(record)
}

/**
 * Count planned/completed work for one calendar day from the app's real data.
 * Timetable blocks only count once they have started (today) or once the day
 * is over (past days) — a block at 21:00 does not make 09:00 imperfect.
 */
export function perfectCountsFor(state, dateKeyValue, { todayKey = dateKeyValue, now = new Date() } = {}) {
  const key = dateKeyValue
  const tasks = (state?.tasks || []).filter((task) => task.date === key)
  const log = state?.completionLog?.[key] || { ttDone: [] }
  const doneSet = new Set(Array.isArray(log.ttDone) ? log.ttDone : [])
  const plan = dayPlanFor(state, key)
  const isToday = key === todayKey
  const isPast = key < todayKey
  const cutoff = isToday ? nowMinutes(now) : isPast ? 24 * 60 : -1
  const due = plan.filter((block) => minutesOfDay(block.time) <= cutoff)
  return {
    tasksPlanned: tasks.length,
    tasksCompleted: tasks.filter((task) => task.done).length,
    blocksPlanned: due.length,
    blocksCompleted: due.filter((block) => doneSet.has(block.id)).length,
    /** the whole day's plan (including blocks that have not started yet) */
    blocksScheduled: plan.length,
  }
}

/**
 * Fold fresh counts into the stored snapshot.
 * Planned work keeps its high-water mark (anti-manipulation); completions are
 * live while the day runs and frozen together with the day.
 */
export function mergePerfectRecord(stored, counts, { frozen = false } = {}) {
  const merged = {
    tasksPlanned: Math.max(int(stored?.tasksPlanned), int(counts.tasksPlanned)),
    tasksCompleted: int(counts.tasksCompleted),
    blocksPlanned: Math.max(int(stored?.blocksPlanned), int(counts.blocksPlanned)),
    blocksCompleted: int(counts.blocksCompleted),
    blocksScheduled: Math.max(int(stored?.blocksScheduled), int(counts.blocksScheduled)),
  }
  return { ...merged, perfect: evaluatePerfectDay(merged).perfect, frozen: !!frozen }
}

/** The keys the day walker is allowed to look at. */
function trackedKeys(state, { todayKey, lookback }) {
  const floor = addDays(todayKey, -lookback)
  const keys = new Set()
  const add = (key) => {
    if (isValidKey(key) && key >= floor && key <= todayKey) keys.add(key)
  }
  for (const key of Object.keys(state?.completionLog || {})) add(key)
  for (const key of Object.keys(state?.dayPlans || {})) add(key)
  for (const task of state?.tasks || []) add(task.date)
  for (const key of Object.keys(state?.scoreHistory || {})) add(key)
  for (const key of Object.keys(state?.achievements?.days || {})) add(key)
  return keys
}

/** True when there is *any* reason to believe the day had a plan. */
function dayHasSignal(state, key) {
  if (state?.dayPlans?.[key]) return true
  const log = state?.completionLog?.[key]
  if (log && ((log.ttDone || []).length || (log.taskDone || []).length)) return true
  if ((state?.tasks || []).some((task) => task.date === key)) return true
  return false
}

/**
 * Refresh `state.achievements.days` in place and report whether it changed.
 * • today   → live snapshot (never frozen)
 * • past    → frozen snapshot, written once and never recalculated
 *
 * @param {any} state
 * @param {{ todayKey?: string, now?: Date, lookback?: number, full?: boolean }} [options]
 * @returns {{ days: Record<string, any>, changed: boolean }}
 */
function syncPerfectDaysDetailed(state, { todayKey = dateKey(), now = new Date(), lookback = PERFECT_HISTORY_DAYS, full = false } = {}) {
  if (!state.achievements) state.achievements = { days: {}, unlocked: {} }
  if (!state.achievements.days) state.achievements.days = {}
  if (!state.achievements.unlocked) state.achievements.unlocked = {}
  const days = state.achievements.days
  const floor = addDays(todayKey, -lookback)
  let changed = false
  /** store the record only when it actually differs (keeps writes rare) */
  const write = (key, record) => {
    const previous = days[key] || null
    if (JSON.stringify(previous) === JSON.stringify(record)) return
    days[key] = record
    changed = true
  }

  const candidates = full ? trackedKeys(state, { todayKey, lookback }) : new Set()
  if (!full) {
    for (let i = 0; i <= ROLLOVER_DAYS; i++) candidates.add(addDays(todayKey, -i))
  }
  candidates.add(todayKey)

  for (const key of candidates) {
    if (key < floor || key > todayKey) continue
    const stored = days[key]
    if (key === todayKey) {
      write(key, mergePerfectRecord(stored, perfectCountsFor(state, key, { todayKey, now }), { frozen: false }))
      continue
    }
    if (stored?.frozen) continue
    if (!stored && !dayHasSignal(state, key)) continue
    write(key, mergePerfectRecord(stored, perfectCountsFor(state, key, { todayKey, now }), { frozen: true }))
  }

  for (const key of Object.keys(days)) {
    if (!isValidKey(key) || key < floor || key > todayKey) {
      delete days[key]
      changed = true
    }
  }
  return { days, changed }
}

/**
 * Refresh the day snapshots in place (today live, finished days frozen).
 * @see syncPerfectDaysDetailed for the change flag the store uses.
 */
export function syncPerfectDays(state, options = {}) {
  return syncPerfectDaysDetailed(state, options).days
}

/**
 * The perfect-day history, summarised.
 * Consecutive means consecutive *local calendar dates*, ending yesterday:
 * today is still being written, so it never breaks the run.
 *
 * @param {Record<string, any>} records
 */
export function perfectRun(records = {}, { todayKey = dateKey(), lookback = PERFECT_HISTORY_DAYS } = {}) {
  let current = 0
  let cursor = addDays(todayKey, -1)
  for (let i = 0; i < lookback; i++) {
    if (!dayIsBankedPerfect(records[cursor])) break
    current++
    cursor = addDays(cursor, -1)
  }

  const floor = addDays(todayKey, -lookback)
  const keys = Object.keys(records)
    .filter((key) => isValidKey(key) && key <= todayKey && key >= floor)
    .sort()
  let run = 0
  let best = 0
  let total = 0
  let previous = null
  for (const key of keys) {
    if (key === todayKey) continue
    if (!dayIsBankedPerfect(records[key])) {
      run = 0
      previous = key
      continue
    }
    total++
    run = previous && addDays(previous, 1) === key ? run + 1 : 1
    previous = key
    if (run > best) best = run
  }
  best = Math.max(best, current)

  const todayRecord = records[todayKey] || null
  const todayDetail = perfectDayDetail(todayRecord || {})
  const yesterday = records[addDays(todayKey, -1)] || null
  const blocksAhead = Math.max(0, int(todayRecord?.blocksScheduled) - todayDetail.blocksPlanned)

  return {
    current,
    best,
    total,
    yesterday: yesterday ? { dateKey: addDays(todayKey, -1), ...perfectDayDetail(yesterday) } : null,
    today: {
      dateKey: todayKey,
      ...todayDetail,
      started: Boolean(todayRecord),
      blocksAhead,
      /** everything due so far today is done (the day is still running) */
      onTrack: todayDetail.hasWork && todayDetail.tasksComplete && todayDetail.blocksComplete,
      tasksLeft: Math.max(0, todayDetail.tasksPlanned - todayDetail.tasksCompleted),
      blocksLeft: Math.max(0, todayDetail.blocksPlanned - todayDetail.blocksCompleted),
    },
    recent: recentDays(records, { todayKey }),
  }
}

/** Last N days as dots for the UI (newest last). */
export function recentDays(records = {}, { todayKey = dateKey(), days = 10 } = {}) {
  const out = []
  for (let i = days - 1; i >= 0; i--) {
    const key = addDays(todayKey, -i)
    const record = records[key] || null
    out.push({
      dateKey: key,
      isToday: key === todayKey,
      planned: Boolean(record),
      frozen: Boolean(record?.frozen),
      perfect: dayIsPerfect(record),
      banked: dayIsBankedPerfect(record),
      label: weekdayShort(weekdayOf(key)),
    })
  }
  return out
}

/* --------------------------------------------------------- title evaluation */

/**
 * Requirement kinds. A kind turns the shared context into
 * `{ value, target, met, remaining, copy }`.
 * Register more with `registerRequirementKind` — no other file needs to change.
 * @type {Record<string, (requirement: any, context: any) => any>}
 */
const REQUIREMENT_KINDS = {
  /** consecutive perfect days (today is pending, not counted until it is over) */
  'perfect-streak': (requirement, { run }) => {
    const target = int(requirement?.target) || 1
    const value = Math.min(run.current, target)
    return {
      value,
      raw: run.current,
      target,
      met: run.current >= target,
      remaining: Math.max(0, target - run.current),
      copy: {
        progress: `${value} / ${target} PERFECT DAYS`,
        remaining: (n) => `${n} DAY${n === 1 ? '' : 'S'} TO GO`,
        completed: (n) => `${n} PERFECT DAYS COMPLETED`,
      },
    }
  },
  /** lifetime perfect days (kept in the catalog for the next title) */
  'perfect-days-total': (requirement, { run }) => {
    const target = int(requirement?.target) || 1
    const value = Math.min(run.total, target)
    return {
      value,
      raw: run.total,
      target,
      met: run.total >= target,
      remaining: Math.max(0, target - run.total),
      copy: {
        progress: `${value} / ${target} PERFECT DAYS`,
        remaining: (n) => `${n} MORE PERFECT DAY${n === 1 ? '' : 'S'}`,
        completed: (n) => `${n} PERFECT DAYS LOGGED`,
      },
    }
  },
}

/** Extension point for future titles. */
export function registerRequirementKind(kind, evaluate) {
  if (!kind || typeof evaluate !== 'function') return false
  REQUIREMENT_KINDS[kind] = evaluate
  return true
}

export function requirementKinds() {
  return Object.keys(REQUIREMENT_KINDS)
}

/** One title, resolved into everything a view needs (single canonical shape). */
function shapeTitle(title, requirement, unlockedEntry, run) {
  return {
    ...title,
    unlocked: !!unlockedEntry,
    unlockedAt: unlockedEntry?.at ?? null,
    unlockedDateKey: unlockedEntry?.dateKey ?? null,
    unlockedStreak: int(unlockedEntry?.streak) || requirement.target,
    value: requirement.value,
    target: requirement.target,
    met: requirement.met,
    remaining: requirement.remaining,
    percent: requirement.target ? Math.round((requirement.value / requirement.target) * 100) : 0,
    progressLabel: requirement.copy?.progress || `${requirement.value} / ${requirement.target}`,
    remainingLabel: typeof requirement.copy?.remaining === 'function' ? requirement.copy.remaining(requirement.remaining) : '',
    completedLabel: typeof requirement.copy?.completed === 'function' ? requirement.copy.completed(requirement.raw) : '',
    run,
    today: run.today,
  }
}

function resolveRequirement(title, context) {
  const kind = REQUIREMENT_KINDS[title.requirement?.kind]
  if (!kind) {
    const target = int(title.requirement?.target) || 1
    return { value: 0, raw: 0, target, met: false, remaining: target, copy: {} }
  }
  return kind(title.requirement, context)
}

/**
 * Every title with its real progress, for the current local day (read-only).
 * @param {any} state
 * @param {{ todayKey?: string, now?: Date }} [options]
 */
export function titleResults(state, { todayKey = dateKey(), now = new Date() } = {}) {
  const records = state?.achievements?.days || {}
  const run = perfectRun(records, { todayKey })
  const unlocked = state?.achievements?.unlocked || {}
  return TITLE_CATALOG.map((title) =>
    shapeTitle(title, resolveRequirement(title, { state, run, todayKey, now }), unlocked[title.id] || null, run),
  )
}

/**
 * Write the day snapshots and stamp any newly earned title.
 * Idempotent: an unlocked title is only ever recorded once (reloads, repeated
 * calls and 11+ perfect days keep exactly one entry).
 *
 * @param {any} state
 * @param {{ todayKey?: string, now?: Date, lookback?: number, full?: boolean }} [options]
 * @returns {{ days: Record<string, any>, run: any, titles: any[], newlyUnlocked: string[], changed: boolean }}
 */
export function syncAchievements(state, { todayKey = dateKey(), now = new Date(), lookback = PERFECT_HISTORY_DAYS, full = false } = {}) {
  const { days, changed: daysChanged } = syncPerfectDaysDetailed(state, { todayKey, now, lookback, full })
  const run = perfectRun(days, { todayKey, lookback })
  const newlyUnlocked = []
  const titles = TITLE_CATALOG.map((title) => {
    const requirement = resolveRequirement(title, { state, run, todayKey, now })
    let entry = state.achievements.unlocked[title.id] || null
    if (requirement.met && !entry) {
      // stamped exactly once: the ceremony can never replay on a reload
      entry = { dateKey: todayKey, at: now.getTime(), seen: false, streak: requirement.raw }
      state.achievements.unlocked[title.id] = entry
      newlyUnlocked.push(title.id)
    }
    return shapeTitle(title, requirement, entry, run)
  })
  return { days, run, titles, newlyUnlocked, changed: daysChanged || newlyUnlocked.length > 0 }
}

/** Titles that were earned but whose ceremony has not been shown yet. */
export function pendingCelebrations(state) {
  const unlocked = state?.achievements?.unlocked || {}
  return Object.keys(unlocked).filter((id) => titleById(id) && unlocked[id]?.seen === false)
}

/**
 * Ceremony copy for a freshly unlocked title (config-driven, so a future title
 * only needs a `celebration` block).
 * @param {any} title
 * @param {{streak?:number}|null} entry
 */
export function unlockSummary(title, entry = null) {
  const target = int(title?.requirement?.target) || 0
  const streak = Math.max(int(entry?.streak) || 0, target)
  const unit = String(title?.celebration?.completed || 'COMPLETED')
  return {
    count: streak,
    completedLabel: `${streak} ${unit}`,
    note: String(title?.celebration?.note || 'You showed up. You finished. You stayed consistent.'),
  }
}

/** Local, human date for an unlock stamp: "September 27, 2026". */
export function formatUnlockDate(key) {
  if (!isValidKey(key)) return ''
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d, 12).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' })
}
