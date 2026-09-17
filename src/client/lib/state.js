/* -------------------------------------------------------------------------
   STATE — versioned schema, validation and safe migrations
   -------------------------------------------------------------------------
   The localStorage KEY stays `kcc_state_v1` on purpose: every existing user
   keeps their data, and the *schema* version lives inside the payload
   (`state.version`). Loading never resets data — it normalises whatever it
   finds, migrates it forward and reports what happened.

   Migration path
     v1 (original app) ──► v2 ──► v3 (discipline monster + titles)
   ------------------------------------------------------------------------- */

import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS, DEFAULT_TIMETABLE, STATE_VERSION } from './defaults.js'
import { isValidKey, minutesOfDay } from './dates.js'
import { normalizeRecurrence } from './recurrence.js'

/** Legacy key kept for backward compatibility with existing installs. */
export const STORAGE_KEY = 'kcc_state_v1'
export const PRE_MIGRATION_BACKUP_KEY = 'kcc_backup_pre_v2'
/** Where an unparseable payload is parked so the user can still rescue it. */
export const CORRUPT_BACKUP_KEY = 'kcc_backup_unreadable'

export const PRIORITIES = ['high', 'medium', 'low']

/** Random-ish, collision-safe id. Injectable in tests. */
export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export function makeContext({ now = Date.now(), id = uid } = {}) {
  return { now, uid: id }
}

const isObj = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
const asArray = (value) => (Array.isArray(value) ? value : [])

/** validate `09:30` */
export function normalizeTime(value, fallback = '09:00') {
  const str = String(value ?? '').trim()
  if (!/^\d{1,2}:\d{2}$/.test(str)) return fallback
  const [h, m] = str.split(':').map(Number)
  if (h > 23 || m > 59) return fallback
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function normalizeCategory(cat, fallbackId = 'misc') {
  const id = String(cat?.id || fallbackId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || fallbackId
  const color = /^#[0-9a-fA-F]{3,8}$/.test(String(cat?.color)) ? String(cat.color) : '#7c5cff'
  return { id, name: String(cat?.name || id).slice(0, 60), color }
}

/** Give every timetable block a stable id. */
export function ensureIds(timetable, ctx) {
  return asArray(timetable).map((item) => (item && item.id ? item : { ...item, id: ctx.uid() }))
}

export function normalizeTimetableItem(item, ctx) {
  return {
    id: String(item?.id || ctx.uid()),
    time: normalizeTime(item?.time),
    title: String(item?.title || 'Untitled block').slice(0, 160),
    duration: clampNumber(item?.duration, 5, 600, 60),
    cat: item?.cat ? String(item.cat) : null,
  }
}

export function normalizeTask(task, ctx) {
  const date = isValidKey(task?.date) ? task.date : null
  const recurrence = normalizeRecurrence(task?.recurrence)
  const seriesId = task?.seriesId ? String(task.seriesId) : recurrence && task?.id ? String(task.id) : null
  return {
    id: String(task?.id || ctx.uid()),
    title: String(task?.title || '').trim().slice(0, 200) || 'Untitled task',
    date,
    time: task?.time ? normalizeTime(task.time) : null,
    priority: PRIORITIES.includes(task?.priority) ? task.priority : 'medium',
    cat: task?.cat ? String(task.cat) : null,
    notes: typeof task?.notes === 'string' ? task.notes.slice(0, 2000) : '',
    estimateMinutes: clampNumber(task?.estimateMinutes, 5, 600, 30),
    done: task?.done === true,
    inbox: task?.inbox === true || (!date && !task?.cat && task?.inbox !== false),
    createdAt: Number.isFinite(task?.createdAt) ? task.createdAt : ctx.now,
    completedAt: Number.isFinite(task?.completedAt) ? task.completedAt : null,
    recurrence,
    seriesId,
    occurrenceDate: isValidKey(task?.occurrenceDate) ? task.occurrenceDate : seriesId ? date : null,
  }
}

export function normalizeFocusSession(session) {
  if (!isObj(session)) return null
  const focusedSeconds = clampNumber(session.focusedSeconds, 0, 12 * 3600, 0)
  return {
    id: String(session.id || uid()),
    taskId: session.taskId ? String(session.taskId) : null,
    categoryId: session.categoryId ? String(session.categoryId) : null,
    mode: session.mode === 'break' ? 'break' : 'focus',
    plannedMinutes: clampNumber(session.plannedMinutes, 1, 600, 25),
    focusedSeconds,
    startedAt: Number.isFinite(session.startedAt) ? session.startedAt : Date.now(),
    endedAt: Number.isFinite(session.endedAt) ? session.endedAt : null,
    status: session.status === 'completed' ? 'completed' : 'stopped',
    date: isValidKey(session.date) ? session.date : null,
  }
}

export function clampNumber(value, min, max, fallback) {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(max, Math.max(min, Math.round(num)))
}

/** Merge stored settings with defaults (deep for the nested objects we own). */
export function normalizeSettings(raw) {
  const settings = isObj(raw) ? raw : {}
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    focus: { ...DEFAULT_SETTINGS.focus, ...(isObj(settings.focus) ? settings.focus : {}) },
    reminders: { ...DEFAULT_SETTINGS.reminders, ...(isObj(settings.reminders) ? settings.reminders : {}) },
    onboarding: { ...DEFAULT_SETTINGS.onboarding, ...(isObj(settings.onboarding) ? settings.onboarding : {}) },
    protectedTime: asArray(settings.protectedTime)
      .filter((b) => isObj(b))
      .map((b) => {
        const id = String(b.id || uid())
        const days = Array.isArray(b.days) ? b.days.map(Number).filter((d) => d >= 0 && d <= 6) : []
        return {
          id,
          label: String(b.label || 'Protected time').slice(0, 60),
          start: normalizeTime(b.start, '23:00'),
          end: normalizeTime(b.end, '06:00'),
          days,
        }
      }),
    weekStart: settings.weekStart === 0 ? 0 : 1,
    dayEnd: normalizeTime(settings.dayEnd, '23:30'),
    // The Gemini key never belongs to the browser any more (server secret).
    geminiApiKey: undefined,
  }
}

/** A brand-new state for a first-time user. */
export function emptyState(ctx = makeContext()) {
  const state = {
    version: STATE_VERSION,
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    timetable: ensureIds(DEFAULT_TIMETABLE, ctx).map((item) => normalizeTimetableItem(item, ctx)),
    tasks: [],
    top3: {},
    completionLog: {},
    dayPlans: {},
    focus: { active: null, sessions: [] },
    scoreHistory: {},
    chatHistory: [],
    reminders: { sent: {} },
    settings: normalizeSettings({}),
    onboarding: { seen: false },
    dailyProgress: {},
    titles: {
      disciplineMonster: {
        unlocked: false,
        unlockedAt: null,
        unlockedAtTs: null,
        seen: false,
        bestStreak: 0,
        currentStreak: 0,
      },
    },
    meta: { createdAt: ctx.now, updatedAt: ctx.now, migratedFrom: null, migrations: [] },
  }
  return state
}

/**
 * Normalise + migrate any payload (localStorage, imported JSON, …).
 * @returns {{state:any, applied:string[], warnings:string[]}}
 */
export function migrateState(raw, ctx = makeContext()) {
  const applied = []
  const warnings = []
  if (!isObj(raw)) {
    return { state: emptyState(ctx), applied: ['reset-invalid'], warnings: ['Saved data was not an object — started from defaults.'] }
  }

  let version = Number.isFinite(raw.version) ? Number(raw.version) : 1
  let working = { ...raw }

  if (version < 2) {
    working = migrateStateV1ToV2(working, ctx)
    applied.push('migrateStateV1ToV2')
    version = 2
  }
  if (version < 3) {
    working = migrateStateV2ToV3(working, ctx)
    applied.push('migrateStateV2ToV3')
    version = 3
  }

  const state = normalizeState(working, ctx, warnings)
  state.meta = {
    ...(isObj(working.meta) ? working.meta : {}),
    createdAt: Number.isFinite(working.meta?.createdAt) ? working.meta.createdAt : ctx.now,
    // keep the stored write time: loading is not a write
    updatedAt: Number.isFinite(working.meta?.updatedAt) ? working.meta.updatedAt : ctx.now,
    migratedFrom: applied.length ? `v${version}→v${STATE_VERSION}` : isObj(working.meta) ? working.meta.migratedFrom ?? null : null,
    migrations: [...asArray(working.meta?.migrations), ...applied],
  }
  state.version = STATE_VERSION
  return { state, applied, warnings }
}

/**
 * v1 → v2: adds the new collections, keeps every existing record intact and
 * removes the browser-side Gemini key that v1 used to store.
 */
export function migrateStateV1ToV2(raw, ctx = makeContext()) {
  const next = { ...raw }
  next.version = 2
  next.categories = asArray(raw.categories).length ? raw.categories : DEFAULT_CATEGORIES.map((c) => ({ ...c }))
  next.timetable = ensureIds(asArray(raw.timetable).length ? raw.timetable : DEFAULT_TIMETABLE, ctx)
  next.tasks = asArray(raw.tasks)
  next.top3 = isObj(raw.top3) ? raw.top3 : {}
  next.completionLog = isObj(raw.completionLog) ? raw.completionLog : {}
  next.dayPlans = isObj(raw.dayPlans) ? raw.dayPlans : {}
  next.focus = isObj(raw.focus) ? raw.focus : { active: null, sessions: [] }
  next.focus.sessions = asArray(next.focus.sessions)
  next.focus.active = isObj(next.focus.active) ? next.focus.active : null
  next.scoreHistory = isObj(raw.scoreHistory) ? raw.scoreHistory : {}
  next.chatHistory = asArray(raw.chatHistory).slice(-40)
  next.reminders = isObj(raw.reminders) ? raw.reminders : { sent: {} }
  next.reminders.sent = isObj(next.reminders.sent) ? next.reminders.sent : {}

  const legacyKey = typeof raw.settings?.geminiApiKey === 'string' ? raw.settings.geminiApiKey : ''
  next.settings = normalizeSettings({ ...(isObj(raw.settings) ? raw.settings : {}), geminiApiKey: undefined })
  if (legacyKey) {
    // Security: the key must live in the Worker secret, never in the browser.
    next.meta = { ...(isObj(raw.meta) ? raw.meta : {}), removedBrowserApiKey: true }
  }
  return next
}

/**
 * v2 → v3: adds dailyProgress snapshots and private titles collection
 * for the Discipline Monster achievement system.
 */
export function migrateStateV2ToV3(raw, ctx = makeContext()) {
  const next = { ...raw }
  next.version = 3
  if (!isObj(next.dailyProgress)) next.dailyProgress = {}
  if (!isObj(next.titles)) {
    next.titles = {
      disciplineMonster: {
        unlocked: false,
        unlockedAt: null,
        unlockedAtTs: null,
        seen: false,
        bestStreak: 0,
        currentStreak: 0,
      },
    }
  } else {
    // Ensure disciplineMonster exists even if titles object was partially present
    if (!isObj(next.titles.disciplineMonster)) {
      next.titles.disciplineMonster = {
        unlocked: false,
        unlockedAt: null,
        unlockedAtTs: null,
        seen: false,
        bestStreak: 0,
        currentStreak: 0,
      }
    }
  }
  return next
}

/** Shape-safe normalisation used for every load/import. */
export function normalizeState(raw, ctx = makeContext(), warnings = []) {
  const state = emptyState(ctx)
  state.categories = (asArray(raw.categories).length ? asArray(raw.categories) : DEFAULT_CATEGORIES)
    .map((c) => normalizeCategory(c))
    .filter((c, index, all) => all.findIndex((x) => x.id === c.id) === index)
  if (!state.categories.length) state.categories = DEFAULT_CATEGORIES.map((c) => ({ ...c }))
  const catIds = new Set(state.categories.map((c) => c.id))

  state.timetable = asArray(raw.timetable).map((item) => normalizeTimetableItem(item, ctx))
  if (!state.timetable.length && asArray(raw.timetable).length === 0 && !raw.timetable) {
    state.timetable = ensureIds(DEFAULT_TIMETABLE, ctx).map((item) => normalizeTimetableItem(item, ctx))
  }
  state.timetable.forEach((item) => {
    if (item.cat && !catIds.has(item.cat)) item.cat = null
  })

  const rawTasks = asArray(raw.tasks)
  state.tasks = rawTasks.map((task) => normalizeTask(task, ctx))
  state.tasks.forEach((task) => {
    if (task.cat && !catIds.has(task.cat)) task.cat = null
  })
  if (state.tasks.length !== rawTasks.length) warnings.push('Some task records were skipped (invalid shape).')

  // Top 3: string ids of existing tasks, capped at 3, per day
  const taskIds = new Set(state.tasks.map((t) => t.id))
  state.top3 = {}
  for (const [key, ids] of Object.entries(isObj(raw.top3) ? raw.top3 : {})) {
    if (!isValidKey(key)) continue
    const clean = asArray(ids)
      .map(String)
      .filter((id) => taskIds.has(id))
      .filter((id, i, all) => all.indexOf(id) === i)
      .slice(0, 3)
    if (clean.length) state.top3[key] = clean
  }

  state.completionLog = {}
  for (const [key, log] of Object.entries(isObj(raw.completionLog) ? raw.completionLog : {})) {
    if (!isValidKey(key)) continue
    state.completionLog[key] = {
      ttDone: asArray(log?.ttDone).map(String),
      taskDone: asArray(log?.taskDone).map(String),
    }
  }

  state.dayPlans = {}
  for (const [key, plan] of Object.entries(isObj(raw.dayPlans) ? raw.dayPlans : {})) {
    if (!isValidKey(key || '')) continue
    const items = asArray(plan)
      .filter((item) => isObj(item))
      .map((item) => ({
        id: String(item.id || ctx.uid()),
        time: normalizeTime(item.time),
        title: String(item.title || 'Block').slice(0, 160),
        duration: clampNumber(item.duration, 5, 600, 60),
        cat: item.cat ? String(item.cat) : null,
      }))
    if (items.length) state.dayPlans[key] = items
  }

  const active = isObj(raw.focus?.active) ? raw.focus.active : null
  state.focus = {
    active: active
      ? {
          ...active,
          id: String(active.id || ctx.uid()),
          mode: active.mode === 'break' ? 'break' : 'focus',
          plannedMinutes: clampNumber(active.plannedMinutes, 1, 600, 25),
          accumulatedSeconds: Math.max(0, Number(active.accumulatedSeconds) || 0),
          running: active.running !== false,
          startedAt: Number.isFinite(active.startedAt) ? active.startedAt : ctx.now,
          lastTickAt: Number.isFinite(active.lastTickAt) ? active.lastTickAt : Number.isFinite(active.startedAt) ? active.startedAt : ctx.now,
          taskId: active.taskId ? String(active.taskId) : null,
          status: 'active',
        }
      : null,
    sessions: asArray(raw.focus?.sessions).map(normalizeFocusSession).filter(Boolean).slice(-2000),
  }

  state.chatHistory = asArray(raw.chatHistory)
    .filter((m) => isObj(m) && typeof m.text === 'string')
    .map((m) => ({ role: m.role === 'user' ? 'user' : 'model', text: String(m.text).slice(0, 8000), ts: Number.isFinite(m.ts) ? m.ts : ctx.now }))
    .slice(-40)

  state.reminders = { sent: {} }
  for (const [key, value] of Object.entries(isObj(raw.reminders?.sent) ? raw.reminders.sent : {})) {
    if (Number.isFinite(Number(value))) state.reminders.sent[key] = Number(value)
  }

  state.scoreHistory = {}
  for (const [key, value] of Object.entries(isObj(raw.scoreHistory) ? raw.scoreHistory : {})) {
    if (!isValidKey(key)) continue
    state.scoreHistory[key] = {
      score: clampNumber(value?.score, 0, 100, 0),
      focusedMinutes: clampNumber(value?.focusedMinutes, 0, 1440, 0),
      top3Done: clampNumber(value?.top3Done, 0, 3, 0),
      top3Total: clampNumber(value?.top3Total, 0, 3, 0),
      computedAt: Number.isFinite(value?.computedAt) ? value.computedAt : ctx.now,
    }
  }

  state.settings = normalizeSettings(raw.settings)
  state.onboarding = { ...DEFAULT_SETTINGS.onboarding, ...(isObj(raw.onboarding) ? raw.onboarding : isObj(raw.settings?.onboarding) ? raw.settings.onboarding : {}) }

  // --- v3: dailyProgress snapshots (frozen historical truth) ---
  state.dailyProgress = {}
  for (const [key, value] of Object.entries(isObj(raw.dailyProgress) ? raw.dailyProgress : {})) {
    if (!isValidKey(key)) continue
    state.dailyProgress[key] = {
      tasksPlanned: clampNumber(value?.tasksPlanned, 0, 10000, 0),
      tasksCompleted: clampNumber(value?.tasksCompleted, 0, 10000, 0),
      timetablePlanned: clampNumber(value?.timetablePlanned, 0, 10000, 0),
      timetableCompleted: clampNumber(value?.timetableCompleted, 0, 10000, 0),
      perfect: !!value?.perfect,
      recordedAt: Number.isFinite(value?.recordedAt) ? value.recordedAt : ctx.now,
    }
  }

  // --- v3: private titles ---
  const rawTitles = isObj(raw.titles) ? raw.titles : {}
  const dm = isObj(rawTitles.disciplineMonster) ? rawTitles.disciplineMonster : {}
  state.titles = {
    disciplineMonster: {
      unlocked: !!dm.unlocked,
      unlockedAt: typeof dm.unlockedAt === 'string' && isValidKey(dm.unlockedAt) ? dm.unlockedAt : dm.unlockedAt ? String(dm.unlockedAt).slice(0, 10) : null,
      unlockedAtTs: Number.isFinite(dm.unlockedAtTs) ? dm.unlockedAtTs : dm.unlockedAt ? Date.parse(dm.unlockedAt) || null : null,
      seen: !!dm.seen,
      bestStreak: clampNumber(dm.bestStreak, 0, 10000, 0),
      currentStreak: clampNumber(dm.currentStreak, 0, 10000, 0),
    },
  }
  // Preserve any future titles generically (so adding new titles later doesn't wipe)
  for (const [k, v] of Object.entries(rawTitles)) {
    if (k === 'disciplineMonster') continue
    if (!isObj(v)) continue
    state.titles[k] = {
      unlocked: !!v.unlocked,
      unlockedAt: typeof v.unlockedAt === 'string' ? v.unlockedAt.slice(0, 10) : null,
      unlockedAtTs: Number.isFinite(v.unlockedAtTs) ? v.unlockedAtTs : null,
      seen: !!v.seen,
      bestStreak: clampNumber(v.bestStreak, 0, 10000, 0),
      currentStreak: clampNumber(v.currentStreak, 0, 10000, 0),
    }
  }

  return state
}

/* ------------------------------------------------------------------ *
 * Storage access (injectable so tests can run against a fake storage) *
 * ------------------------------------------------------------------ */

export function getStorage(explicit) {
  if (explicit) return explicit
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/**
 * Load, migrate and persist the state.
 * @param {{ storage?: any, now?: number, id?: () => string }} [options]
 * @returns {any}
 */
export function loadState({ storage, now = Date.now(), id = uid } = {}) {
  const store = getStorage(storage)
  const ctx = makeContext({ now, id })
  const warnings = []
  if (!store) return { state: emptyState(ctx), migrated: false, warnings: [], fresh: true }

  let raw = null
  let unreadable = null
  try {
    const stored = store.getItem(STORAGE_KEY)
    if (stored) raw = JSON.parse(stored)
  } catch (error) {
    unreadable = store.getItem(STORAGE_KEY)
    // park a copy before the app writes anything, so nothing is silently lost
    try {
      if (unreadable) store.setItem(CORRUPT_BACKUP_KEY, unreadable)
      warnings.push('Saved data could not be read — the app started from defaults and kept a copy of the unreadable data.')
    } catch {
      warnings.push('Saved data could not be read — the app started from defaults.')
    }
    return { state: emptyState(ctx), migrated: false, warnings, fresh: true, corrupted: true, raw: unreadable }
  }

  if (!raw) return { state: emptyState(ctx), migrated: false, warnings, fresh: true }

  const { state, applied, warnings: migrateWarnings } = migrateState(raw, ctx)
  warnings.push(...migrateWarnings)
  const migrated = applied.length > 0
  if (migrated) {
    try {
      // Keep a one-time safety copy of the pre-migration payload.
      if (!store.getItem(PRE_MIGRATION_BACKUP_KEY)) {
        store.setItem(PRE_MIGRATION_BACKUP_KEY, JSON.stringify(raw))
      }
    } catch {
      warnings.push('Could not store a pre-migration backup (storage full?).')
    }
  }
  return { state, migrated, warnings, fresh: false, applied }
}

/**
 * @param {any} state
 * @param {{ storage?: any, now?: number }} [options]
 */
export function saveState(state, { storage, now = Date.now() } = {}) {
  const store = getStorage(storage)
  if (!store) return false
  try {
    state.meta = { ...(state.meta || {}), updatedAt: now }
    store.setItem(STORAGE_KEY, JSON.stringify(state))
    return true
  } catch (error) {
    return false
  }
}

/**
 * Storage usage estimate for the Settings screen.
 * @param {{ storage?: any }} [options]
 */
export function storageUsage({ storage } = {}) {
  const store = getStorage(storage)
  if (!store) return { bytes: 0, kb: 0 }
  const bytes = (store.getItem(STORAGE_KEY) || '').length * 2
  return { bytes, kb: Math.round(bytes / 1024) }
}

export { minutesOfDay }
