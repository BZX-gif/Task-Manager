/* -------------------------------------------------------------------------
   BACKUP — export / import validation
   -------------------------------------------------------------------------
   Export wraps the whole state in a small envelope:

     { kind: "command-center-backup", version: 2, exportedAt, app, data: {...} }

   Import is defensive: it accepts the envelope *and* the raw v1 state files
   that older builds produced, validates every field, migrates forward and
   never partially applies a broken payload.
   ------------------------------------------------------------------------- */

import { migrateState, normalizeState, makeContext, uid as defaultUid } from './state.js'
import { STATE_VERSION } from './defaults.js'

export const BACKUP_KIND = 'command-center-backup'
export const BACKUP_VERSION = STATE_VERSION

export function buildExport(state, { now = Date.now(), app = "Kulshresth's Command Center" } = {}) {
  const data = JSON.parse(JSON.stringify(state))
  // Never ship a browser-side API key (legacy field) in a backup file.
  if (data.settings) delete data.settings.geminiApiKey
  return {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    app,
    exportedAt: new Date(now).toISOString(),
    counts: {
      tasks: data.tasks?.length ?? 0,
      timetable: data.timetable?.length ?? 0,
      focusSessions: data.focus?.sessions?.length ?? 0,
      days: Object.keys(data.completionLog || {}).length,
    },
    data,
  }
}

export function exportFilename(now = Date.now()) {
  const d = new Date(now)
  const pad = (n) => String(n).padStart(2, '0')
  return `command-center-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`
}

/**
 * Validate + migrate an imported payload.
 * @returns {{ok:boolean, errors:string[], warnings:string[], state:any|null, summary:object|null, sourceVersion:number|null}}
 */
export function validateImport(payload, { now = Date.now(), id = defaultUid } = {}) {
  const errors = []
  const warnings = []
  const ctx = makeContext({ now, id })

  if (payload === null || payload === undefined || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, errors: ['The file does not contain a backup object.'], warnings, state: null, summary: null, sourceVersion: null }
  }

  let data
  let sourceVersion = null
  if (payload.kind === BACKUP_KIND) {
    if (payload.version !== undefined && Number(payload.version) > BACKUP_VERSION) {
      warnings.push(`This backup was created by a newer version (v${payload.version}). Unknown fields will be ignored.`)
    }
    data = payload.data
    sourceVersion = Number(payload.version) ?? null
    if (!data || typeof data !== 'object') {
      return { ok: false, errors: ['Backup file is missing its `data` section.'], warnings, state: null, summary: null, sourceVersion }
    }
  } else if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.tasks)) {
    data = payload.data
    warnings.push('Backup envelope was not recognised — reading the `data` section directly.')
  } else {
    // legacy: a raw state dump
    data = payload
    warnings.push('Legacy backup detected (raw state file) — it will be migrated to the current schema.')
  }

  const hasAnything = ['tasks', 'timetable', 'completionLog', 'focus', 'categories', 'settings'].some((key) => key in data)
  if (!hasAnything) {
    return { ok: false, errors: ['This JSON has no Command Center data (no tasks, timetable or history found).'], warnings, state: null, summary: null, sourceVersion }
  }

  let state
  try {
    const migrated = migrateState(data, ctx)
    warnings.push(...migrated.warnings)
    state = migrated.state
  } catch (error) {
    return {
      ok: false,
      errors: ['The backup could not be read (unexpected structure). Nothing was changed.'],
      warnings,
      state: null,
      summary: null,
      sourceVersion,
    }
  }

  // sanity checks on required collections
  if (!Array.isArray(state.tasks)) errors.push('`tasks` is not a list.')
  if (!Array.isArray(state.timetable)) errors.push('`timetable` is not a list.')
  if (errors.length) return { ok: false, errors, warnings, state: null, summary: null, sourceVersion }

  const normalized = normalizeState(state, ctx, warnings)
  normalized.version = STATE_VERSION

  const dates = Object.keys(normalized.completionLog || {}).sort()
  const taskDates = normalized.tasks.map((t) => t.date).filter(Boolean).sort()

  return {
    ok: true,
    errors: [],
    warnings,
    state: normalized,
    sourceVersion,
    summary: {
      categories: normalized.categories.length,
      timetable: normalized.timetable.length,
      tasks: normalized.tasks.length,
      openTasks: normalized.tasks.filter((t) => !t.done).length,
      recurring: normalized.tasks.filter((t) => t.recurrence).length,
      focusSessions: normalized.focus.sessions.length,
      trackedDays: dates.length,
      historyFrom: dates[0] || taskDates[0] || null,
      historyTo: dates[dates.length - 1] || taskDates[taskDates.length - 1] || null,
      protectedWindows: normalized.settings.protectedTime.length,
    },
  }
}

/** Small text summary used in the import confirmation dialog. */
export function describeImport(summary) {
  if (!summary) return 'No data found.'
  const parts = [
    `${summary.tasks} task${summary.tasks === 1 ? '' : 's'} (${summary.openTasks} open)`,
    `${summary.timetable} timetable block${summary.timetable === 1 ? '' : 's'}`,
    `${summary.focusSessions} focus session${summary.focusSessions === 1 ? '' : 's'}`,
    `${summary.trackedDays} tracked day${summary.trackedDays === 1 ? '' : 's'}`,
  ]
  let text = parts.join(' · ')
  if (summary.historyFrom) text += `\nHistory: ${summary.historyFrom} → ${summary.historyTo}`
  return text
}
