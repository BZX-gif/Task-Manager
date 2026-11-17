/* -------------------------------------------------------------------------
   WORKSPACE SEARCH — one ranked index across everything you have written
   -------------------------------------------------------------------------
   Search is deliberately local, deterministic and explainable. There is no
   server, no embedding and no hidden ranking: every result comes from a field
   you can see in the app.

   Ranking, in order of weight:
     1. a whole-word (or string-start) hit in a title
     2. a substring hit in a title
     3. a title that contains every query token in any order
     4. an ordered subsequence match ("plnday" → "Plan my day")
     5. a hit in a secondary field (description, notes, subtasks, milestones)
   Recent work receives a small, capped recency boost so that two equally good
   matches return the thing you touched most recently.

   Everything here is pure; the command palette is the only caller.
   ------------------------------------------------------------------------- */

import { isValidKey } from './dates.js'

export const SEARCH_KINDS = {
  mission: { label: 'Missions', order: 1, icon: 'missions' },
  goal: { label: 'Goals', order: 2, icon: 'target' },
  project: { label: 'Projects', order: 3, icon: 'projects' },
  routine: { label: 'Routines', order: 4, icon: 'routines' },
  journal: { label: 'Journal', order: 5, icon: 'journal' },
}

const SEARCH_FIELDS = {
  mission: [
    ['title', 1.6],
    ['description', 0.7],
    ['notes', 0.55],
    ['subtasks', 0.5],
  ],
  goal: [
    ['title', 1.6],
    ['description', 0.7],
    ['notes', 0.55],
    ['milestones', 0.6],
  ],
  project: [
    ['title', 1.6],
    ['description', 0.7],
    ['notes', 0.55],
    ['milestones', 0.6],
  ],
  routine: [
    ['title', 1.6],
    ['description', 0.7],
    ['activities', 0.5],
  ],
  journal: [
    ['note', 1.1],
    ['win', 1.2],
    ['nextStep', 1.2],
  ],
}

/** Lowercase, trim and strip accents without touching the stored text. */
export function normalizeSearch(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

/** Split a raw query into meaningful tokens (`#work`, `!high` included). */
export function searchTokens(query) {
  return normalizeSearch(query)
    .replace(/[#!]+/g, ' ')
    .split(/[^a-z0-9@._-]+/)
    .filter(Boolean)
}

const BOUNDARY = /[\s\-_/·,.:;()[\]]/

/**
 * Score one token against one normalised text. Returns 0 when the token is
 * absent, so callers can implement an "every token must match" rule.
 */
export function tokenScore(token, text) {
  if (!token || !text) return 0
  const index = text.indexOf(token)
  if (index >= 0) {
    const startsWord = index === 0 || BOUNDARY.test(text[index - 1])
    const endsWord = index + token.length === text.length || BOUNDARY.test(text[index + token.length])
    return 100 + (startsWord ? 45 : 0) + (endsWord ? 12 : 0) + Math.max(0, 30 - index) + Math.min(24, token.length * 3)
  }
  // Ordered subsequence: every character appears in order. Cheap to compute and
  // it makes "plnday" find "Plan my day" without a dependency.
  let tokenIndex = 0
  let gaps = 0
  let previous = -1
  for (let i = 0; i < text.length && tokenIndex < token.length; i += 1) {
    if (text[i] !== token[tokenIndex]) continue
    if (previous >= 0) gaps += i - previous - 1
    previous = i
    tokenIndex += 1
  }
  if (tokenIndex < token.length) return 0
  const spread = Math.max(0, (previous + 1 - token.length) / Math.max(1, token.length))
  return Math.max(3, 46 - gaps * 0.9 - spread * 2)
}

/** Score every token against a text; all tokens must be present. */
export function scoreText(tokens, text) {
  const normalized = normalizeSearch(text)
  if (!normalized || !tokens.length) return 0
  let total = 0
  for (const token of tokens) {
    const score = tokenScore(token, normalized)
    if (!score) return 0
    total += score
  }
  return total
}

function recencyBoost(timestamp, now, cap = 10) {
  const value = Number(timestamp)
  if (!Number.isFinite(value) || value <= 0) return 0
  const days = Math.max(0, (now - value) / 86_400_000)
  if (days <= 1) return cap
  if (days <= 7) return cap * 0.6
  if (days <= 30) return cap * 0.25
  return 0
}

function timestampOfDateKey(key) {
  if (!isValidKey(key)) return 0
  return new Date(`${key}T12:00:00`).getTime()
}

/** A short, readable excerpt around the first matching token. */
export function snippetAround(text, tokens, maxLength = 96) {
  const raw = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!raw) return ''
  if (raw.length <= maxLength) return raw
  const lower = normalizeSearch(raw)
  let index = -1
  for (const token of tokens) {
    const found = lower.indexOf(token)
    if (found >= 0 && (index < 0 || found < index)) index = found
  }
  if (index < 0) return `${raw.slice(0, maxLength - 1).trimEnd()}…`
  const start = Math.max(0, index - Math.floor(maxLength * 0.35))
  const end = Math.min(raw.length, start + maxLength)
  return `${start > 0 ? '…' : ''}${raw.slice(start, end).trim()}${end < raw.length ? '…' : ''}`
}

function escapeSearchHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
}

/**
 * Escape user text and wrap the first matching token in <mark>. Safe to pass
 * straight into innerHTML.
 */
export function highlightMatch(text, query) {
  const raw = String(text ?? '')
  const tokens = searchTokens(query)
  if (!tokens.length) return escapeSearchHtml(raw)
  const lower = raw.toLowerCase()
  let best = null
  for (const token of tokens) {
    const index = lower.indexOf(token)
    if (index >= 0 && (!best || index < best.index || (index === best.index && token.length > best.length))) {
      best = { index, length: token.length }
    }
  }
  if (!best) return escapeSearchHtml(raw)
  return `${escapeSearchHtml(raw.slice(0, best.index))}<mark>${escapeSearchHtml(raw.slice(best.index, best.index + best.length))}</mark>${escapeSearchHtml(raw.slice(best.index + best.length))}`
}

function fieldsOf(kind, record) {
  if (kind === 'mission') {
    return {
      title: record.title,
      description: record.description,
      notes: record.notes,
      subtasks: (record.subtasks || []).map((sub) => sub.title).join(' · '),
    }
  }
  if (kind === 'goal' || kind === 'project') {
    return {
      title: record.title,
      description: record.description,
      notes: record.notes,
      milestones: (record.milestones || []).map((step) => step.title).join(' · '),
    }
  }
  if (kind === 'routine') {
    return {
      title: record.title,
      description: record.description,
      activities: (record.activities || []).map((activity) => activity.title).join(' · '),
    }
  }
  return { note: record.note, win: record.win, nextStep: record.nextStep }
}

function bestFieldScore(kind, tokens, fields) {
  let best = null
  let secondary = 0
  for (const [name, weight] of SEARCH_FIELDS[kind]) {
    const text = fields[name]
    if (!text) continue
    const raw = scoreText(tokens, text)
    if (!raw) continue
    const weighted = raw * weight
    if (name === 'title') {
      if (!best || weighted > best.score) best = { field: name, score: weighted }
    } else {
      secondary = Math.max(secondary, weighted * 0.35)
    }
  }
  const chosen = best || (secondary ? { field: 'body', score: secondary } : null)
  if (!chosen) return null
  return { ...chosen, score: chosen.score + secondary * 0.25 }
}

function missionSubtitle(record, state) {
  const parts = []
  if (record.done) parts.push('Completed')
  else if (record.status === 'cancelled') parts.push('Skipped')
  if (record.inbox) parts.push('Inbox')
  else if (record.date) parts.push(record.date)
  if (record.time) parts.push(record.time)
  const category = state.categories?.find((cat) => cat.id === record.cat)
  if (category) parts.push(category.name)
  if (record.priority === 'high') parts.push('High priority')
  return parts.join(' · ') || 'Mission'
}

/**
 * Rank the workspace against a query.
 *
 * @returns {{ query:string, tokens:string[], groups:Array, flat:Array, total:number }}
 *   `flat` is the same results in display order, which is what keyboard
 *   navigation walks through.
 */
export function searchWorkspace(state, query, { limit = 30, now = Date.now(), includeJournal = true } = {}) {
  const tokens = searchTokens(query)
  const groups = new Map()
  const flat = []
  if (!tokens.length || !state) return { query: String(query || ''), tokens, groups: [], flat, total: 0 }

  const push = (kind, record, extra = {}) => {
    const fields = fieldsOf(kind, record)
    const scored = bestFieldScore(kind, tokens, fields)
    if (!scored) return
    const item = {
      id: String(record.id ?? extra.id ?? ''),
      kind,
      title: extra.title || String(record.title || record.win || record.note || 'Untitled'),
      subtitle: extra.subtitle || '',
      snippet: scored.field === 'body' || scored.field === 'notes' || scored.field === 'description' ? snippetAround(extra.snippetSource || fields[scored.field] || '', tokens) : '',
      score: Math.round((scored.score + recencyBoost(extra.timestamp, now)) * 100) / 100,
      matchedField: scored.field,
      ...extra.meta,
    }
    if (!groups.has(kind)) groups.set(kind, [])
    groups.get(kind).push(item)
  }

  for (const task of state.tasks || []) {
    push('mission', task, {
      subtitle: missionSubtitle(task, state),
      timestamp: task.completedAt || task.createdAt,
      meta: { done: task.done, date: task.date, inbox: task.inbox },
    })
  }
  for (const goal of state.goals || []) {
    push('goal', goal, { subtitle: `${goal.status || 'active'} · ${goal.category || 'Goal'}`, timestamp: 0 })
  }
  for (const project of state.projects || []) {
    push('project', project, { subtitle: `${project.status || 'active'} · Project`, timestamp: 0 })
  }
  for (const routine of state.routines || []) {
    if (routine.archived) continue
    push('routine', routine, { subtitle: `${(routine.activities || []).length} activities · Routine`, timestamp: 0 })
  }
  if (includeJournal) {
    for (const [day, entry] of Object.entries(state.journal || {})) {
      if (!entry || !isValidKey(day)) continue
      push('journal', entry, {
        title: entry.win || entry.nextStep || entry.note || 'Journal entry',
        subtitle: `Journal · ${day}`,
        snippetSource: [entry.note, entry.win, entry.nextStep].filter(Boolean).join(' — '),
        timestamp: timestampOfDateKey(day),
        meta: { date: day },
      })
    }
  }

  const orderedGroups = [...groups.entries()]
    .filter(([, items]) => items.length)
    .map(([kind, items]) => ({
      kind,
      label: SEARCH_KINDS[kind].label,
      order: SEARCH_KINDS[kind].order,
      icon: SEARCH_KINDS[kind].icon,
      count: items.length,
      items: items.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)),
    }))
    .sort((a, b) => a.order - b.order)

  for (const group of orderedGroups) {
    const keep = group.items.slice(0, kindLimit(limit, orderedGroups.length))
    group.items = keep
    group.count = keep.length
    for (const item of keep) flat.push(item)
  }

  const capped = flat.slice(0, limit)
  // Keep group membership consistent with the global cap.
  const allowed = new Set(capped.map((item) => `${item.kind}:${item.id}`))
  for (const group of orderedGroups) {
    group.items = group.items.filter((item) => allowed.has(`${item.kind}:${item.id}`))
    group.count = group.items.length
  }

  return { query: String(query || ''), tokens, groups: orderedGroups.filter((group) => group.items.length), flat: capped, total: capped.length }
}

function kindLimit(limit, groupCount) {
  return Math.max(3, Math.ceil(limit / Math.max(1, groupCount)))
}

/** Commands the palette offers alongside data results. */
export const COMMANDS = [
  { id: 'capture', title: 'Quick capture', subtitle: 'Get it out of your head', icon: 'inbox', action: 'capture' },
  { id: 'new-mission', title: 'Create a mission', subtitle: 'A clear next step', icon: 'plus', action: 'new-mission' },
  { id: 'plan', title: 'Plan my day', subtitle: 'Review a realistic proposal', icon: 'sun', action: 'plan' },
  { id: 'recover', title: 'Recover my day', subtitle: 'Start again without losing your work', icon: 'recover', action: 'recover' },
  { id: 'close-day', title: 'Close the day', subtitle: 'Carry what matters into tomorrow', icon: 'moon', action: 'close-day' },
  { id: 'briefing', title: 'Open the briefing', subtitle: 'Your next move, explained', icon: 'bell', action: 'briefing' },
  { id: 'export-calendar', title: 'Export calendar (.ics)', subtitle: 'Take your commitments anywhere', icon: 'download', action: 'export-calendar' },
  { id: 'print-day', title: 'Print today’s plan', subtitle: 'A calm sheet for the desk', icon: 'calendar', action: 'print-day' },
  { id: 'shortcuts', title: 'Keyboard shortcuts', subtitle: 'Every shortcut, in one place', icon: 'info', action: 'shortcuts' },
]

/** Commands filtered by the same token rules as data results. */
export function searchCommands(query, commands = COMMANDS) {
  const tokens = searchTokens(query)
  if (!tokens.length) return commands
  return commands
    .map((command) => ({ command, score: scoreText(tokens, `${command.title} ${command.subtitle}`) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.command)
}
