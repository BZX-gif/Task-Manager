/* -------------------------------------------------------------------------
   PAPER · actions — prepared changes that never execute themselves.

   PAPER can *prepare* consequential changes: create a mission, reschedule
   one, schedule a block, plan tomorrow, set an intention. Each preparation
   returns a descriptor with a human-readable preview of exactly what will
   change. `executeAction` performs the change on a draft state and reports
   a summary — the workspace layer calls it only after the user confirms.

   PAPER never silently modifies or deletes missions.
   ------------------------------------------------------------------------- */

import { isValidKey, addDays } from '../dates.js'
import { normalizeTime, uid } from '../state.js'
import { finding } from './core.js'

/** All descriptor kinds PAPER can prepare. */
export const ACTION_KINDS = ['create_mission', 'reschedule_mission', 'schedule_mission', 'plan_tomorrow', 'set_intention', 'create_project', 'start_focus', 'open_view', 'review_mission']

/** Consequential kinds that must go through explicit user confirmation. */
export const CONFIRMATION_REQUIRED = new Set(['create_mission', 'reschedule_mission', 'schedule_mission', 'plan_tomorrow', 'set_intention', 'create_project'])

/**
 * Build a descriptor for creating a mission.
 * @param {{ title: string, date?: string|null, minutes?: number, priority?: string, goalId?: string|null, projectId?: string|null, cat?: string|null }} params
 */
export function prepareCreateMission(params = {}) {
  const title = String(params.title || '').trim().slice(0, 200)
  return {
    kind: 'create_mission',
    title: title || 'Untitled mission',
    preview: `Create mission “${title || 'Untitled mission'}”${params.date ? ` dated ${params.date}` : ' in the inbox'}${params.minutes ? ` · ${params.minutes} min` : ''}.`,
    params: {
      title,
      date: isValidKey(params.date) ? params.date : null,
      startLabel: params.startLabel || null,
      minutes: Math.min(600, Math.max(5, Number(params.minutes) || 30)),
      priority: ['high', 'medium', 'low'].includes(params.priority) ? params.priority : 'medium',
      goalId: params.goalId || null,
      projectId: params.projectId || null,
      cat: params.cat || null,
    },
  }
}

/** Build a descriptor for moving a mission to a new day (and optional time). */
export function prepareReschedule({ taskId, dayKey, startLabel = null, minutes = null, reason = '' }) {
  return {
    kind: 'reschedule_mission',
    title: 'Reschedule mission',
    preview: `Move the mission to ${dayKey}${startLabel ? ` at ${startLabel}` : ''}${minutes ? ` for ${minutes} min` : ''}.`,
    params: { taskId: String(taskId), dayKey: String(dayKey), startLabel, minutes, reason: String(reason) },
  }
}

/** Build a descriptor for planning tomorrow from today's unfinished work. */
export function preparePlanTomorrow({ taskIds = [], dayKey }) {
  return {
    kind: 'plan_tomorrow',
    title: 'Plan tomorrow',
    preview: `Move ${taskIds.length} unfinished mission${taskIds.length === 1 ? '' : 's'} to ${dayKey}.`,
    params: { taskIds: [...taskIds], dayKey: String(dayKey) },
  }
}

/** Build a descriptor for setting today's intention. */
export function prepareSetIntention({ text, dayKey }) {
  return {
    kind: 'set_intention',
    title: 'Set today’s intention',
    preview: `Save “${String(text).slice(0, 120)}” as the intention for ${dayKey}.`,
    params: { text: String(text).slice(0, 200), dayKey: String(dayKey) },
  }
}

/**
 * Execute a prepared action against a draft state. Pure with respect to the
 * rest of the app: it mutates only the state object it is given and returns
 * a summary the UI can show. Unknown or malformed descriptors fail loudly
 * with `ok: false` and change nothing.
 *
 * @param {any} state draft state (inside a commit, or a fixture in tests)
 * @param {any} descriptor
 * @param {{ uid?: () => string, now?: number }} [ctx]
 * @returns {{ ok: boolean, summary: string, findings: any[], error?: string }}
 */
export function executeAction(state, descriptor, ctx = {}) {
  const id = ctx.uid || uid
  const now = ctx.now ?? Date.now()
  if (!state || !descriptor || !ACTION_KINDS.includes(descriptor.kind)) {
    return { ok: false, summary: 'Nothing was changed.', findings: [], error: 'Unknown action.' }
  }
  const params = descriptor.params || {}

  switch (descriptor.kind) {
    case 'create_mission': {
      const title = String(params.title || '').trim()
      if (!title) return { ok: false, summary: 'Nothing was changed.', findings: [], error: 'A mission needs a title.' }
      if (!Array.isArray(state.tasks)) state.tasks = []
      const task = {
        id: id(),
        title: title.slice(0, 200),
        date: isValidKey(params.date) ? params.date : null,
        time: params.startLabel ? normalizeTime(params.startLabel) : null,
        priority: params.priority || 'medium',
        cat: params.cat || null,
        notes: '',
        estimateMinutes: params.minutes || 30,
        done: false,
        status: 'ready',
        description: '',
        deadline: null,
        goalId: params.goalId || null,
        projectId: params.projectId || null,
        milestoneId: null,
        horizon: 'daily',
        subtasks: [],
        progress: null,
        history: [],
        protected: false,
        flexible: true,
        inbox: !params.date,
        createdAt: now,
        completedAt: null,
        recurrence: null,
        seriesId: null,
      }
      state.tasks.push(task)
      return {
        ok: true,
        summary: `Mission “${task.title}” created${task.date ? ` for ${task.date}` : ' in the inbox'}.`,
        findings: [finding('fact', `A new mission now exists with id ${task.id}.`, 'actions')],
        taskId: task.id,
      }
    }

    case 'reschedule_mission':
    case 'schedule_mission': {
      const task = (state.tasks || []).find((t) => t.id === params.taskId)
      if (!task) return { ok: false, summary: 'Nothing was changed.', findings: [], error: 'Mission not found.' }
      if (!isValidKey(params.dayKey)) return { ok: false, summary: 'Nothing was changed.', findings: [], error: 'Invalid date.' }
      const before = `${task.date || 'no date'}${task.time ? ` ${task.time}` : ''}`
      task.date = params.dayKey
      task.time = params.startLabel ? normalizeTime(params.startLabel) : task.time
      if (params.minutes) task.estimateMinutes = Math.min(600, Math.max(5, Number(params.minutes)))
      if (task.inbox) task.inbox = false
      task.history = [...(task.history || []), { at: now, action: 'rescheduled', date: params.dayKey }].slice(-100)
      return {
        ok: true,
        summary: `“${task.title}” moved from ${before} to ${params.dayKey}${task.time ? ` ${task.time}` : ''}.`,
        findings: [finding('fact', 'The mission record now carries the new date; the old date is preserved in its history.', 'actions')],
        taskId: task.id,
      }
    }

    case 'plan_tomorrow': {
      const ids = Array.isArray(params.taskIds) ? params.taskIds : []
      const moved = []
      for (const taskId of ids) {
        const task = (state.tasks || []).find((t) => t.id === taskId)
        if (!task || task.done || task.status === 'cancelled') continue
        task.date = params.dayKey
        task.inbox = false
        task.history = [...(task.history || []), { at: now, action: 'rescheduled', date: params.dayKey }].slice(-100)
        moved.push(task.title)
      }
      if (!moved.length) return { ok: false, summary: 'Nothing was changed.', findings: [], error: 'No unfinished missions to move.' }
      return {
        ok: true,
        summary: `${moved.length} mission${moved.length === 1 ? '' : 's'} planned for ${params.dayKey}.`,
        findings: [finding('fact', `Moved: ${moved.join('; ')}.`, 'actions')],
      }
    }

    case 'set_intention': {
      const text = String(params.text || '').trim().slice(0, 200)
      const dayKey = isValidKey(params.dayKey) ? params.dayKey : null
      if (!text || !dayKey) return { ok: false, summary: 'Nothing was changed.', findings: [], error: 'An intention needs text and a date.' }
      if (!state.briefing) state.briefing = { lastShownDay: null, intentions: {} }
      if (!state.briefing.intentions) state.briefing.intentions = {}
      state.briefing.intentions[dayKey] = text
      return { ok: true, summary: `Intention saved for ${dayKey}.`, findings: [finding('fact', `“${text}” is now today's stated intention.`, 'actions')] }
    }

    case 'create_project': {
      const title = String(params.title || '').trim()
      if (!title) return { ok: false, summary: 'Nothing was changed.', findings: [], error: 'A project needs a title.' }
      if (!Array.isArray(state.projects)) state.projects = []
      const project = {
        id: id(),
        title: title.slice(0, 200),
        description: '',
        notes: '',
        deadline: isValidKey(params.deadline) ? params.deadline : null,
        targetDate: null,
        priority: params.priority || 'medium',
        status: 'active',
        createdAt: now,
        progressMode: 'auto',
        manualProgress: 0,
        goalId: params.goalId || null,
        milestoneId: null,
        milestones: [],
      }
      state.projects.push(project)
      return { ok: true, summary: `Project “${project.title}” created.`, findings: [finding('fact', `A new project now exists with id ${project.id}.`, 'actions')], projectId: project.id }
    }

    default:
      // Navigation/review/focus actions change nothing in the data layer.
      return { ok: true, summary: 'No data changes for this action.', findings: [] }
  }
}

/** Human-readable line for a descriptor (used in confirmation dialogs). */
export function describeAction(descriptor) {
  return descriptor?.preview || descriptor?.title || 'Prepared action'
}

/** Default day for "tomorrow" style actions. */
export function tomorrowOf(todayKey) {
  return addDays(todayKey, 1)
}
