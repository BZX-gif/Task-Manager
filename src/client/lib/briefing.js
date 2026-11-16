/* -------------------------------------------------------------------------
   BRIEFING — the deterministic "what needs you right now?" model
   -------------------------------------------------------------------------
   One pure module powers every surface that opens the day: the startup
   briefing, the always-visible command strip, the overview hero and the
   spoken briefing. It never guesses and never invents work.

   Pick order (first match wins):
     1. the time block running right now (unless it is already ticked off)
     2. an unfinished Top 3 priority for today
     3. the most overdue open mission
     4. the highest-priority open mission for today
     5. the next scheduled block that has not started yet
     6. the newest inbox capture
     7. nothing — a clear, honest "the day is yours"

   Everything else (counts, agenda, intention) is derived from real records.
   ------------------------------------------------------------------------- */

import { addDays, minutesOfDay } from './dates.js'
import { PRIORITY_ORDER } from './defaults.js'
import { sessionTotals } from './focus.js'

export const DAY_PARTS = ['early', 'morning', 'afternoon', 'evening', 'night']

const PART_GREETING = {
  early: 'A quiet moment',
  morning: 'Good morning',
  afternoon: 'Good afternoon',
  evening: 'Good evening',
  night: 'Time to wind down',
}

const PART_LEAD = {
  early: 'The world is still quiet. Let’s use it well.',
  morning: 'The day is fresh. One clear move is enough to begin.',
  afternoon: 'The middle of the day is yours to shape.',
  evening: 'A calm finish is still a strong finish.',
  night: 'Close the day gently. Tomorrow can wait a few more minutes.',
}

/** @param {Date} [now] */
export function dayPart(now = new Date()) {
  const hour = Number(now?.getHours?.() ?? 0)
  if (hour < 5) return 'early'
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  if (hour < 21) return 'evening'
  return 'night'
}

/** The respectful address used across the product (editable in Settings). */
export function salutationOf(state) {
  const raw = state?.settings?.salutation
  const clean = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, 40) : ''
  return clean || 'Sir'
}

/** The person the briefing speaks to: a chosen name, otherwise the salutation. */
export function addresseeOf(state) {
  const name = state?.settings?.userName
  const clean = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').slice(0, 60) : ''
  return clean || salutationOf(state)
}

/** `Good evening, Sir.` — time aware, never a generic hello. */
export function greetingLine(state, now = new Date()) {
  return `${PART_GREETING[dayPart(now)]}, ${addresseeOf(state)}.`
}

export function leadLine(now = new Date()) {
  return PART_LEAD[dayPart(now)]
}

const priorityRank = (value) => PRIORITY_ORDER[value] ?? 1

function isBlockDone(block, doneSet) {
  return (
    doneSet.has(block.id) ||
    (block.sourceId && doneSet.has(block.sourceId)) ||
    block.status === 'completed' ||
    block.status === 'skipped'
  )
}

function openTasks(tasks) {
  return tasks.filter((task) => task && !task.done && task.status !== 'cancelled' && task.status !== 'paused')
}

/** A short, honest label for where a next move came from. */
export const FOCUS_REASONS = {
  block: 'Scheduled right now',
  top3: 'One of your three priorities',
  overdue: 'Still open from an earlier day',
  task: 'The highest priority left today',
  scheduled: 'Next on your schedule',
  inbox: 'Captured, waiting for a home',
  clear: 'Nothing pending',
}

/**
 * Build the whole briefing from real data.
 * @param {any} state
 * @param {{now?: Date, todayKey?: string, blocks?: any[], stats?: any, streak?: any}} [options]
 */
export function buildBriefing(state, { now = new Date(), todayKey = null, blocks = [], stats = null, streak = null } = {}) {
  const day = todayKey || dateKeyOf(now)
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const tasks = Array.isArray(state?.tasks) ? state.tasks : []
  const safeBlocks = Array.isArray(blocks) ? blocks.filter(Boolean) : []
  const doneSet = new Set([...(state?.completionLog?.[day]?.ttDone || [])].map(String))

  const open = openTasks(tasks)
  const openToday = open.filter((t) => t.date === day && !t.inbox)
  const overdue = open.filter((t) => t.date && t.date < day && !t.inbox)
  const inbox = open.filter((t) => t.inbox)
  const planned = tasks.filter((t) => t.date === day && !t.inbox && t.status !== 'cancelled')

  const byId = new Map(tasks.map((t) => [t.id, t]))
  const taskOpen = (task) => !!task && !task.done && task.status !== 'cancelled' && task.status !== 'paused'
  const top3Ids = Array.isArray(state?.top3?.[day]) ? state.top3[day] : []
  const top3Tasks = top3Ids.map((id) => byId.get(String(id))).filter((t) => t && t.status !== 'cancelled')
  const top3Open = top3Tasks.filter(taskOpen)
  const top3Pick = top3Open.find((t) => t.date === day) || top3Open[0] || null

  const usableBlock = (block) =>
    !isBlockDone(block, doneSet) &&
    !block.protected &&
    block.kind !== 'protected' &&
    !(block.taskId && !taskOpen(byId.get(String(block.taskId))))

  const activeBlock = safeBlocks.find((block) => {
    if (!usableBlock(block)) return false
    const start = minutesOfDay(block.time)
    return nowMinutes >= start && nowMinutes < start + (block.duration || 60)
  })

  const nextBlock = [...safeBlocks]
    .filter((block) => usableBlock(block) && minutesOfDay(block.time) > nowMinutes)
    .sort((a, b) => minutesOfDay(a.time) - minutesOfDay(b.time))[0]

  const overduePick = [...overdue].sort((a, b) => {
    if (priorityRank(a.priority) !== priorityRank(b.priority)) return priorityRank(a.priority) - priorityRank(b.priority)
    return String(a.date || '').localeCompare(String(b.date || ''))
  })[0]

  const todayPick = [...openToday].sort((a, b) => {
    if (priorityRank(a.priority) !== priorityRank(b.priority)) return priorityRank(a.priority) - priorityRank(b.priority)
    return String(a.time || '99:99').localeCompare(String(b.time || '99:99'))
  })[0]

  const inboxPick = [...inbox].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))[0]
  const tomorrowKey = addDays(day, 1)
  const tomorrowPick = open
    .filter((t) => t.date === tomorrowKey && !t.inbox)
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || String(a.time || '99:99').localeCompare(String(b.time || '99:99')))[0] || null

  /** @type {any} */
  let focus = null
  if (activeBlock) {
    const task = activeBlock.taskId ? byId.get(String(activeBlock.taskId)) : null
    focus = focusFrom({ kind: 'block', block: activeBlock, task })
  } else if (top3Pick) {
    focus = focusFrom({ kind: 'top3', task: top3Pick })
  } else if (overduePick) {
    focus = focusFrom({ kind: 'overdue', task: overduePick })
  } else if (todayPick) {
    focus = focusFrom({ kind: 'task', task: todayPick })
  } else if (nextBlock) {
    focus = focusFrom({ kind: 'scheduled', block: nextBlock })
  } else if (inboxPick) {
    focus = focusFrom({ kind: 'inbox', task: inboxPick })
  } else {
    focus = {
      kind: 'clear',
      title: 'The day is yours.',
      reason: FOCUS_REASONS.clear,
      taskId: null,
      blockId: null,
      time: null,
      minutes: null,
      priority: null,
      categoryId: null,
      goalId: null,
      goalTitle: null,
      projectId: null,
      projectTitle: null,
    }
  }

  const focusMinutes = stats && Number.isFinite(stats.focusedMinutes)
    ? stats.focusedMinutes
    : sessionTotals(state?.focus?.sessions || [], day).focusedMinutes
  const top3Done = top3Tasks.filter((t) => t.done).length
  const nextUp = safeBlocks
    .filter((block) => usableBlock(block) && minutesOfDay(block.time) > nowMinutes)
    .sort((a, b) => minutesOfDay(a.time) - minutesOfDay(b.time))
    .slice(0, 3)
    .map((block) => ({
      id: String(block.id || block.time),
      time: block.time,
      title: String(block.title || 'Time block'),
      duration: Number(block.duration) || 0,
      priority: block.priority || 'medium',
    }))

  return {
    todayKey: day,
    part: dayPart(now),
    salutation: salutationOf(state),
    addressee: addresseeOf(state),
    greeting: greetingLine(state, now),
    lead: leadLine(now),
    focus,
    intention: intentionFor(state, day),
    counts: {
      planned: planned.length,
      done: planned.filter((t) => t.done).length,
      open: openToday.length,
      overdue: overdue.length,
      inbox: inbox.length,
      top3Total: top3Ids.length,
      top3Done,
      focusMinutes,
      focusTarget: Number(state?.settings?.focus?.targetMinutes) || 180,
      score: stats && Number.isFinite(stats.score) ? stats.score : null,
      hasActivity: !!stats?.hasAnyActivity,
      blocks: safeBlocks.length,
      blocksDone: safeBlocks.filter((b) => isBlockDone(b, doneSet)).length,
      streak: streak && Number.isFinite(streak.current) ? streak.current : null,
      bestStreak: streak && Number.isFinite(streak.best) ? streak.best : null,
    },
    nextUp,
    tomorrowKey,
    tomorrow: tomorrowPick
      ? {
          title: String(tomorrowPick.title || ''),
          time: tomorrowPick.time || null,
          minutes: Number(tomorrowPick.estimateMinutes) || null,
          priority: tomorrowPick.priority || null,
          taskId: String(tomorrowPick.id),
        }
      : null,
    hasAnything: tasks.length > 0 || safeBlocks.length > 0,
  }
}

function focusFrom({ kind, task = null, block = null }) {
  const goal = task?.goalId || block?.goalId || null
  const project = task?.projectId || block?.projectId || null
  return {
    kind,
    title: String(task?.title || block?.title || 'Your next move'),
    reason: FOCUS_REASONS[kind] || '',
    taskId: task?.id ? String(task.id) : null,
    blockId: block ? (block.taskId ? `task:${block.taskId}` : String(block.id)) : null,
    time: task?.time || block?.time || null,
    minutes: Number(block?.duration || task?.estimateMinutes) || null,
    priority: task?.priority || block?.priority || null,
    categoryId: task?.cat || block?.cat || null,
    goalId: goal ? String(goal) : null,
    goalTitle: null,
    projectId: project ? String(project) : null,
    projectTitle: null,
  }
}

/** Attach human titles for linked goals/projects (used by the UI only). */
export function withRelations(briefing, state) {
  const goal = briefing.focus?.goalId ? (state?.goals || []).find((g) => g.id === briefing.focus.goalId) : null
  const project = briefing.focus?.projectId ? (state?.projects || []).find((p) => p.id === briefing.focus.projectId) : null
  return {
    ...briefing,
    focus: {
      ...briefing.focus,
      goalTitle: goal?.title || null,
      projectTitle: project?.title || null,
    },
  }
}

/* ----------------------------------------------------------- intentions */

export function intentionFor(state, day) {
  const value = state?.briefing?.intentions?.[day]
  return typeof value === 'string' ? value.slice(0, 200) : ''
}

/** Mutates the passed state (call inside `commit`). Returns the saved text. */
export function writeIntention(state, day, value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
  if (!state.briefing || typeof state.briefing !== 'object') state.briefing = { lastShownDay: null, intentions: {} }
  if (!state.briefing.intentions || typeof state.briefing.intentions !== 'object') state.briefing.intentions = {}
  if (text) state.briefing.intentions[day] = text
  else delete state.briefing.intentions[day]
  // Keep the map small: only the most recent 120 days can be written at once.
  const keys = Object.keys(state.briefing.intentions).sort()
  if (keys.length > 120) for (const key of keys.slice(0, keys.length - 120)) delete state.briefing.intentions[key]
  return text
}

/* -------------------------------------------------------------- schedule */

export const BRIEFING_MODES = ['daily', 'every', 'off']

export function briefingMode(state) {
  const mode = state?.settings?.briefingMode
  return BRIEFING_MODES.includes(mode) ? mode : 'daily'
}

/** Should the briefing greet the user automatically on this load? */
export function shouldShowBriefing(state, day) {
  const mode = briefingMode(state)
  if (mode === 'off') return false
  if (mode === 'every') return true
  return state?.briefing?.lastShownDay !== day
}

/** Mutates the passed state (call inside `commit`). */
export function markBriefingShown(state, day) {
  if (!state.briefing || typeof state.briefing !== 'object') state.briefing = { lastShownDay: null, intentions: {} }
  state.briefing.lastShownDay = day
}

/* ---------------------------------------------------------------- speech */

/**
 * A short spoken version of the briefing. Plain words only — no markup.
 * @param {any} briefing
 */
export function briefingSpeech(briefing) {
  const focus = briefing?.focus
  const counts = briefing?.counts || {}
  const lines = [briefing?.greeting || 'At your command.']
  if (focus && focus.kind !== 'clear') {
    lines.push(`Your next move is ${focus.title}.`)
    if (focus.minutes) lines.push(`About ${focus.minutes} minutes.`)
    lines.push(`${focus.reason}.`)
  } else {
    lines.push('Nothing is pending. The day is yours to shape.')
  }
  if (counts.open) lines.push(`${counts.open} mission${counts.open === 1 ? '' : 's'} still open today.`)
  if (counts.overdue) lines.push(`${counts.overdue} from earlier still waiting — no judgment.`)
  if (counts.focusMinutes) lines.push(`${counts.focusMinutes} minutes focused so far.`)
  if (briefing?.tomorrow && (briefing.part === 'evening' || briefing.part === 'night')) {
    lines.push(`Tomorrow begins with ${briefing.tomorrow.title}.`)
  }
  if (briefing?.intention) lines.push(`Today's intention: ${briefing.intention}.`)
  return lines.join(' ')
}

/** Local date key without importing the store (keeps this module standalone). */
function dateKeyOf(date) {
  const d = date instanceof Date ? date : new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
