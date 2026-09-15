/* -------------------------------------------------------------------------
   AI CONTEXT + COMMANDS (pure)
   -------------------------------------------------------------------------
   Builds the *small* productivity snapshot that is sent to /api/ai together
   with the user's message. Only what the assistant needs is included: today's
   plan, priorities, focus history and the score — never notes, chat logs of
   other apps or anything unrelated.

   Errors coming back from the worker are mapped to friendly sentences here so
   no stack trace, status dump or secret ever reaches the screen.
   ------------------------------------------------------------------------- */

import { addDays, dateKey, formatDuration, minutesOfDay, weekdayName } from './dates.js'
import { dayStats } from './daystats.js'
import { overdueTasks } from './score.js'
import { selectNextAction } from './nextaction.js'
import { top3Stats } from './top3.js'
import { sessionTotals } from './focus.js'

export const MAX_CONTEXT_CHARS = 1800

/**
 * Compact, human-readable context block for the assistant.
 * @param {any} state
 * @param {{ todayKey?: string, now?: Date, maxChars?: number }} [options]
 */
export function buildAiContext(state, options = {}) {
  const todayKey = options.todayKey || dateKey()
  const now = options.now || new Date()
  const maxChars = options.maxChars || MAX_CONTEXT_CHARS
  const stats = dayStats(state, todayKey, { todayKey, now })
  const top3 = top3Stats(state, todayKey)
  const today = (state.tasks || []).filter((t) => t.date === todayKey)
  const overdue = overdueTasks(state, todayKey)
  const nowMin = now.getHours() * 60 + now.getMinutes()

  const blocks = [...(state.timetable || [])].sort((a, b) => minutesOfDay(a.time) - minutesOfDay(b.time))
  const log = state.completionLog?.[todayKey] || { ttDone: [] }
  const currentBlock = blocks.find((b) => nowMin >= minutesOfDay(b.time) && nowMin < minutesOfDay(b.time) + (b.duration || 60))
  const nextBlock = blocks.find((b) => minutesOfDay(b.time) > nowMin)

  const next = selectNextAction({
    tasks: state.tasks || [],
    timetable: state.timetable || [],
    ttDone: log.ttDone || [],
    top3Ids: state.top3?.[todayKey] || [],
    todayKey,
    nowMinutes: nowMin,
    protectedBlocks: state.settings?.protectedTime || [],
  })

  const yesterday = addDays(todayKey, -1)
  const yesterdayStats = dayStats(state, yesterday, { todayKey, now })
  const weekTotals = { focused: 0, planned: 0, completed: 0 }
  for (let i = 0; i < 7; i++) {
    const key = addDays(todayKey, -i)
    const day = dayStats(state, key, { todayKey, now })
    weekTotals.focused += day.focusedMinutes
    weekTotals.planned += day.totalPlannedMinutes
    weekTotals.completed += day.completedMinutes + day.taskDoneMinutes
  }

  const lines = [
    `Date: ${todayKey} (${weekdayName(new Date(`${todayKey}T12:00:00`).getDay())}), time ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    `Daily score: ${stats.hasData ? `${stats.score}/100` : 'not enough data yet'} (pace ${stats.pace})`,
    `Top 3 (${top3.done}/${top3.total}): ${top3.items.map((i) => `${i.task.title}${i.task.done ? ' ✓' : ''}`).join('; ') || 'none chosen'}`,
    `Today's tasks (${today.length}): ${today.map((t) => `${t.title} [${t.done ? 'done' : 'open'}, ${t.priority}${t.time ? `, ${t.time}` : ''}${t.estimateMinutes ? `, ${t.estimateMinutes}m` : ''}]`).join('; ') || 'none'}`,
    `Timetable now: ${currentBlock ? `${currentBlock.title} (${currentBlock.time}, ${currentBlock.duration}m)` : 'nothing scheduled'}; next: ${nextBlock ? `${nextBlock.title} at ${nextBlock.time}` : 'nothing left today'}`,
    `Timetable today: ${blocks.map((b) => `${b.time} ${b.title}${log.ttDone?.includes(b.id) ? '✓' : ''}`).join(' | ').slice(0, 700)}`,
    `Focused today: ${formatDuration(sessionTotals(state.focus?.sessions || [], todayKey).focusedMinutes)}; yesterday: ${yesterdayStats.focusedMinutes}m; this week: ${formatDuration(weekTotals.focused)}`,
    `This week: planned ${formatDuration(weekTotals.planned)}, completed ${formatDuration(weekTotals.completed)}`,
    `Overdue (${overdue.length}): ${overdue.slice(0, 5).map((t) => t.title).join('; ') || 'none'}`,
    `Next recommended action: ${next.title} (${next.reason})`,
    `Categories: ${(state.categories || []).map((c) => c.name).join(', ') || 'none'}`,
  ]
  if (state.settings?.protectedTime?.length) {
    lines.push(`Protected time: ${state.settings.protectedTime.map((b) => `${b.label} ${b.start}-${b.end}`).join('; ')}`)
  }

  const text = lines.join('\n')
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text
}

export const AI_SYSTEM_PROMPT = `You are the productivity assistant inside a personal Command Center app.
Be concise, warm, practical and specific. Prefer short numbered plans with time estimates (in minutes) over long prose.
Always ground your answer in the context you are given: use the user's real categories, tasks, timetable and numbers.
Never invent tasks, categories or numbers that are not in the context. Never mention being an AI model, never output code, keys or internal details.
When the user asks for a plan, finish with one clear first action starting with "Start with".`

/**
 * Ready-made commands. `build` receives extra data (e.g. a chosen task).
 * @type {Array<{id:string,label:string,icon:string,needsTask?:boolean,prompt:string}>}
 */
export const AI_COMMANDS = [
  { id: 'plan-day', label: 'Plan My Day', icon: 'fa-calendar-day', prompt: 'Plan my day using my real remaining time. Give a time-blocked plan with minutes and one clear first action.' },
  { id: 'next', label: 'What Should I Do Next?', icon: 'fa-arrow-right', prompt: 'What should I do next, right now? Pick one thing, explain why in one line, then give the shortest path to finish it.' },
  { id: 'fix-timetable', label: 'Fix My Timetable', icon: 'fa-table-cells-large', prompt: 'Review my timetable and suggest concrete fixes: overlaps, no buffers, unrealistic blocks, protected-time conflicts. Give a short corrected list.' },
  { id: 'review-week', label: 'Review My Week', icon: 'fa-clipboard-list', prompt: 'Review my week from the data: what worked, what slipped, and the two changes that would help most next week.' },
  { id: 'tomorrow', label: "Make Tomorrow's Plan", icon: 'fa-sun', prompt: "Make tomorrow's plan: the three priorities in order, a realistic schedule, and what to skip." },
  { id: 'breakdown', label: 'Break Down This Task', icon: 'fa-diagram-project', needsTask: true, prompt: 'Break this task into 3-6 concrete subtasks with time estimates, in the order I should do them.' },
  { id: 'behind', label: 'Why Am I Falling Behind?', icon: 'fa-triangle-exclamation', prompt: 'Diagnose why I am falling behind using my completion, focus and overdue data. Be direct, no flattery, then give the fix.' },
]

export function commandById(id) {
  return AI_COMMANDS.find((c) => c.id === id) || null
}

/** Build the final user prompt for a command (optionally with a task). */
export function buildCommandPrompt(id, { task = null } = {}) {
  const command = commandById(id)
  if (!command) return ''
  if (!command.needsTask) return command.prompt
  if (!task) return command.prompt
  return `${command.prompt}\n\nTask: ${task.title}\nCategory: ${task.cat || 'none'}\nPriority: ${task.priority || 'medium'}\nEstimate: ${task.estimateMinutes || 30} minutes\nNotes: ${(task.notes || '').slice(0, 300) || 'none'}`
}

/** Where to find the first free slot for a task (used by the planner hints). */
export function nextFreeSlot(state, todayKey, now = new Date(), durationMinutes = 30) {
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const blocks = [...(state.timetable || [])].sort((a, b) => minutesOfDay(a.time) - minutesOfDay(b.time))
  let cursor = nowMin + 5
  for (const block of blocks) {
    const start = minutesOfDay(block.time)
    const end = start + (block.duration || 60)
    if (end <= cursor) continue
    if (start - cursor >= durationMinutes) return cursor
    cursor = Math.max(cursor, end)
  }
  return cursor + durationMinutes <= 24 * 60 ? cursor : null
}

/**
 * Map a worker/network failure to a friendly, non-technical message.
 * @param {number} status
 * @param {any} payload
 */
export function friendlyAiError(status, payload) {
  const raw = String(payload?.error?.message || payload?.message || '').toLowerCase()
  if (status === 0 || status === undefined) return 'I could not reach the assistant. Check your internet connection and try again.'
  if (status === 429) return 'The assistant is temporarily rate-limited. Wait a moment and try again.'
  if (status === 400) return 'That request could not be understood. Try rephrasing it more simply.'
  if (status === 403) return 'The assistant refused that request. Try a different question.'
  if (status >= 500) {
    if (raw.includes('not configured')) return 'The assistant is not configured on the server yet. Add the GEMINI_API_KEY secret to your Worker and redeploy.'
    return 'The assistant is having trouble right now. Your data is safe — please try again in a moment.'
  }
  return 'The assistant could not answer that just now. Please try again.'
}

/**
 * Trim chat history before sending (token discipline).
 * @param {any[]} [history]
 * @param {number} [max]
 */

export function trimHistory(history = [], max = 12) {
  return history
    .filter((m) => m && typeof m.text === 'string' && m.text.trim())
    .slice(-max)
    .map((m) => ({ role: m.role === 'user' ? 'user' : 'model', content: m.text.slice(0, 4000) }))
}
