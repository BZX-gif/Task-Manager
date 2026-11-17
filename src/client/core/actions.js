import { commit, currentDayKey, replaceState, rollSeriesForward, state } from './store.js'
import { confirmDialog, toast } from './dom.js'
import { scheduleFor } from '../lib/planner.js'
import { addDays } from '../lib/dates.js'
import { getStorage, uid } from '../lib/state.js'
import { buildExport } from '../lib/backup.js'
import { MISSION_CLEAR_BACKUP_KEY, applyMissionClear, describeMissionClear, hasMissionsToClear, missionClearPlan } from '../lib/clear-missions.js'

/** Every calendar edit is dated and undoable; recurring templates are never rewritten. */
export function saveDay(date, blocks, label = 'Schedule updated', { undoable = true, before = scheduleFor(state,date), taskSnapshots = null, createdTaskIds = [] } = {}) {
  const taskTimes = Object.fromEntries(state.tasks.filter((t) => t.date === date).map((t) => [t.id,{ time: t.time, estimateMinutes: t.estimateMinutes }]))
  commit((s) => {
    s.schedule.days[date] = blocks
    for (const b of blocks) {
      const task = s.tasks.find((t) => t.id === b.taskId)
      if (task) {
        task.time = b.time; task.estimateMinutes = b.duration; task.date = date
        if (b.title) task.title = b.title
        if (b.cat !== undefined) task.cat = b.cat
        if (b.priority) task.priority = b.priority
        if (b.protected !== undefined) task.protected = !!b.protected
        if (b.flexible !== undefined) task.flexible = !!b.flexible
        if (b.goalId !== undefined) task.goalId = b.goalId
        if (b.projectId !== undefined) task.projectId = b.projectId
        if (b.milestoneId !== undefined) task.milestoneId = b.milestoneId
      }
    }
    // A task block removed from a dated plan becomes unscheduled, never a
    // hidden timed task that reappears on the next render.
    const kept = new Set(blocks.map((b) => b.taskId).filter(Boolean))
    for (const [id, snapshot] of Object.entries(taskTimes)) {
      if (!kept.has(id)) { const task = s.tasks.find((t) => t.id === id); if (task && task.date === date) task.time = null }
    }
    s.schedule.history.push({ id: uid(), at: Date.now(), date, label, before })
    s.schedule.history = s.schedule.history.slice(-30)
  })
  if (label) toast(label, 'success', undoable ? { timeout: 8000, action: { label: 'Undo', onClick: () => {
    commit((s) => {
      s.schedule.days[date] = before
      for (const [id, snapshot] of Object.entries(taskTimes)) { const task = s.tasks.find((t) => t.id === id); if (task) Object.assign(task, snapshot) }
      for (const b of before) if (b.taskId && taskTimes[b.taskId]) Object.assign(s.tasks.find((t) => t.id === b.taskId) || {},taskTimes[b.taskId])
      for (const snapshot of taskSnapshots || []) { const task = s.tasks.find((t) => t.id === snapshot.id); if (task) Object.assign(task,snapshot) }
      for (const id of createdTaskIds) { const task = s.tasks.find((t) => t.id === id); if (task) { task.time = null; task.date = date; task.inbox = false } }
    })
    toast('Previous schedule restored', 'info')
  } } } : undefined)
}

export function toggleMission(id) {
  let completed = false
  let title = ''
  commit((s) => {
    const task = s.tasks.find((t) => t.id === id)
    if (!task || task.status === 'cancelled') return
    task.done = !task.done
    title = task.title
    completed = task.done
    task.status = task.done ? 'completed' : 'ready'
    task.completedAt = task.done ? Date.now() : null
    task.history = [...(task.history || []), { at: Date.now(), action: task.done ? 'completed' : 'reopened', date: task.date }].slice(-100)
    if (task.done) rollSeriesForward(task)
    const day = task.date || currentDayKey()
    const log = s.completionLog[day] || (s.completionLog[day] = { ttDone: [], taskDone: [] })
    log.taskDone = log.taskDone.filter((x) => x !== id)
    if (task.done) log.taskDone.push(id)
  })
  if (title) toast(completed ? 'Mission complete. One step forward.' : 'Mission reopened', completed ? 'success' : 'info')
  return completed
}

export function postponeMission(id, date = addDays(currentDayKey(),1)) {
  commit((s) => {
    const task = s.tasks.find((t) => t.id === id)
    if (!task) return
    task.history = [...(task.history || []), { at: Date.now(), action: 'rescheduled', from: task.date, to: date, time: task.time }].slice(-100)
    task.date = date; task.inbox = false; task.status = 'rescheduled'
    if (task.seriesId) task.occurrenceDate = date
    for (const key of Object.keys(s.schedule.days)) {
      if (key !== date) s.schedule.days[key] = s.schedule.days[key].filter((b) => b.taskId !== id)
    }
  })
  toast('Mission moved. Your original commitment is kept in its history.', 'info')
}

export function skipMission(id) {
  commit((s) => {
    const task = s.tasks.find((t) => t.id === id)
    if (!task) return
    task.history = [...(task.history || []), { at: Date.now(), action: 'skipped', date: task.date }].slice(-100)
    task.status = 'cancelled'; task.done = false
  })
  toast('Mission skipped — your focus history is preserved.', 'info')
}

export function applyTheme() {
  const settings = state.settings
  const theme = settings.theme === 'system' ? (typeof matchMedia==='function'&&matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : settings.theme
  document.documentElement.dataset.theme = theme
  document.documentElement.dataset.accent = settings.accent
  document.documentElement.classList.toggle('sidebar-collapsed', !!settings.sidebarCollapsed)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f6f4f1' : '#080808')
  const toggle = document.getElementById('theme-toggle')
  toggle?.setAttribute('aria-label', `Switch to ${theme === 'light' ? 'dark' : 'light'} theme`)
}

/**
 * Empty the missions list — and only the missions list.
 *
 * A safety copy of the whole workspace is written to the browser first; if that
 * fails nothing is touched, exactly like Reset and Import. The toast carries an
 * Undo that restores the snapshot taken immediately before the change, so a
 * mis-click costs nothing.
 *
 * @param {{backup?: boolean, silent?: boolean}} [options]
 * @returns {{ok: boolean, reason?: string, plan: any}}
 */
/**
 * Empty the missions list — and only the missions list.
 * Writes a safety copy to localStorage first, snapshots state for the toast's
 * Undo, then commits the surgical clear.
 * @param {{backup?: boolean, silent?: boolean}} [options]
 * @returns {MissionClearResult}
 */
export function clearAllMissions({ backup = true, silent = false } = {}) {
  const before = missionClearPlan(state)
  if (!hasMissionsToClear(state)) {
    if (!silent) toast('There are no missions to clear. Your list is already fresh.', 'info')
    return { ok: false, reason: 'empty', plan: before }
  }

  let snapshot = null
  if (backup) {
    // the same promise Reset makes: no destructive write without a way back
    try {
      getStorage()?.setItem(MISSION_CLEAR_BACKUP_KEY, JSON.stringify(buildExport(state).data))
    } catch {
      if (!silent) toast('Clear stopped: a safety copy could not be saved. Export your data first, then try again. Nothing was changed.', 'error', { timeout: 9000 })
      return { ok: false, reason: 'backup', plan: before }
    }
    try {
      snapshot = JSON.parse(JSON.stringify(state))
    } catch {
      snapshot = null
    }
  }

  // commit() returns nothing, so the report comes back through the closure
  let plan = before
  commit((next) => {
    plan = applyMissionClear(next) || before
  })

  if (!silent) {
    toast(
      `Missions cleared · ${plan.missions} removed. Goals, projects, routines, journal, HYB plans and focus history are untouched.`,
      'success',
      snapshot
        ? {
            timeout: 10000,
            action: {
              label: 'Undo',
              onClick: () => {
                replaceState(snapshot)
                applyTheme()
                toast('Missions restored.', 'info')
              },
            },
          }
        : { timeout: 8000 },
    )
  }
  return { ok: true, plan, describe: describeMissionClear(plan) }
}

/** The confirmation step, kept next to the action so every entry point asks the same way. */
export function missionClearPrompt() {
  const plan = missionClearPlan(state)
  return {
    title: 'Clear every mission?',
    message: 'Your missions list will be emptied so you can start fresh. Nothing else is touched.',
    details: describeMissionClear(plan),
    confirmText: `Clear ${plan.missions || ''} mission${plan.missions === 1 ? '' : 's'}`.replace('  ', ' ').trim(),
    danger: true,
  }
}

/**
 * Ask, then clear. Every entry point (Settings, the command palette, the
 * console) goes through here so the question is always the same and always
 * shows real numbers.
 */
/** @returns {Promise<MissionClearResult>} */
export async function confirmClearMissions() {
  if (!hasMissionsToClear(state)) {
    toast('There are no missions to clear. Your list is already fresh.', 'info')
    return { ok: false, reason: 'empty' }
  }
  if (!(await confirmDialog(missionClearPrompt()))) return { ok: false, reason: 'cancelled' }
  const result = clearAllMissions()
  // land them where they can start again straight away
  if (result.ok) window.CC?.switchView?.('tasks')
  return result
}
