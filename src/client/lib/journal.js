/* -------------------------------------------------------------------------
   JOURNAL — a short, honest record of the day
   -------------------------------------------------------------------------
   Not a diary and not a performance review. One entry per day: what happened,
   one thing that went right, one next step, and how the day actually felt.

   Everything here is pure: `state.journal` is a `{ "YYYY-MM-DD": entry }` map
   and the view is the only thing that writes to it (through `saveEntry`).
   ------------------------------------------------------------------------- */

import { addDays, isValidKey, weekdayShort } from './dates.js'

export const MOODS = [
  { id: 'heavy', label: 'Heavy', score: 1, hint: 'Carrying more than usual' },
  { id: 'low', label: 'Low', score: 2, hint: 'Running on empty' },
  { id: 'steady', label: 'Steady', score: 3, hint: 'Holding the line' },
  { id: 'good', label: 'Good', score: 4, hint: 'In the flow' },
  { id: 'bright', label: 'Bright', score: 5, hint: 'Genuinely light' },
]

export const ENERGY_LEVELS = [
  { id: 'low', label: 'Low', value: 1 },
  { id: 'medium', label: 'Medium', value: 2 },
  { id: 'high', label: 'High', value: 3 },
]

const MOOD_BY_ID = new Map(MOODS.map((mood) => [mood.id, mood]))
const ENERGY_BY_ID = new Map(ENERGY_LEVELS.map((level) => [level.id, level]))

export const JOURNAL_PROMPTS = {
  morning: [
    'What deserves your best hours today?',
    'What would make today feel honest?',
    'What are you protecting time for?',
  ],
  afternoon: [
    'What has actually moved since this morning?',
    'Where did your attention go — and was it your choice?',
    'What is the smallest useful next step?',
  ],
  evening: [
    'What went better than you expected?',
    'What did today teach you about your pace?',
    'What would you keep from today?',
  ],
  night: [
    'One sentence for today — nothing polished.',
    'What are you leaving unfinished on purpose?',
    'What does tomorrow need from you?',
  ],
}

/** A prompt that fits the time of day, stable for the date (no flicker). */
export function promptFor(part, dayKey = '') {
  const list = JOURNAL_PROMPTS[part] || JOURNAL_PROMPTS.evening
  const seed = String(dayKey).split('-').reduce((sum, piece) => sum + (Number(piece) || 0), 0)
  return list[seed % list.length]
}

export function moodOf(id) {
  return MOOD_BY_ID.get(id) || null
}

export function energyOf(id) {
  return ENERGY_BY_ID.get(id) || null
}

export function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null
  const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
  const mood = MOOD_BY_ID.has(raw.mood) ? raw.mood : null
  const energy = ENERGY_BY_ID.has(raw.energy) ? raw.energy : null
  const entry = {
    note: text(raw.note, 4000),
    win: text(raw.win, 280),
    nextStep: text(raw.nextStep, 280),
    mood,
    energy,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
  }
  const empty = !entry.note && !entry.win && !entry.nextStep && !entry.mood && !entry.energy
  return empty ? null : entry
}

/** Validate the whole journal map, dropping unusable rows. */
export function normalizeJournal(raw) {
  const journal = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return journal
  for (const [key, value] of Object.entries(raw)) {
    if (!isValidKey(key)) continue
    const entry = normalizeEntry(value)
    if (entry) journal[key] = entry
  }
  return journal
}

/** Write one day's entry. Empty entries are removed rather than saved blank. */
export function saveEntry(state, dayKey, patch, { now = Date.now() } = {}) {
  if (!state.journal || typeof state.journal !== 'object') state.journal = {}
  if (!isValidKey(dayKey)) return null
  const current = state.journal[dayKey] || {}
  const entry = normalizeEntry({ ...current, ...patch, updatedAt: now })
  if (entry) state.journal[dayKey] = entry
  else delete state.journal[dayKey]
  return entry
}

export function entryFor(state, dayKey) {
  return (state.journal && state.journal[dayKey]) || null
}

const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0)

/** Nearest mood label for a 1–5 average. */
export function moodFromAverage(score) {
  if (!score) return null
  return MOODS.reduce((best, mood) => (Math.abs(mood.score - score) < Math.abs(best.score - score) ? mood : best), MOODS[0])
}

/**
 * Aggregate the journal for the last `days` days.
 * Streak counts consecutive days with an entry, ending today (or yesterday —
 * writing about yesterday still counts while today is young).
 *
 * @param {any} journal
 * @param {{todayKey?:string, days?:number}} [options]
 */
export function journalStats(journal, { todayKey, days = 30 } = {}) {
  const rows = []
  if (todayKey) {
    for (let i = days - 1; i >= 0; i -= 1) {
      const key = addDays(todayKey, -i)
      const entry = journal?.[key] || null
      rows.push({ key, weekday: weekdayShort(new Date(`${key}T12:00:00`).getDay()), entry })
    }
  }
  const written = rows.filter((row) => row.entry)
  const moods = written.map((row) => moodOf(row.entry.mood)?.score).filter(Boolean)
  const energies = written.map((row) => energyOf(row.entry.energy)?.value).filter(Boolean)

  let streak = 0
  if (todayKey) {
    let cursor = todayKey
    if (!journal?.[cursor]) cursor = addDays(todayKey, -1)
    while (journal?.[cursor]) {
      streak += 1
      cursor = addDays(cursor, -1)
    }
  }

  const recent = rows.slice(-7).filter((row) => row.entry)
  const previous = rows.slice(-14, -7).filter((row) => row.entry)
  const recentAvg = average(recent.map((row) => moodOf(row.entry.mood)?.score).filter(Boolean))
  const previousAvg = average(previous.map((row) => moodOf(row.entry.mood)?.score).filter(Boolean))
  let trend = 'flat'
  if (recentAvg && previousAvg) {
    if (recentAvg - previousAvg >= 0.35) trend = 'up'
    else if (previousAvg - recentAvg >= 0.35) trend = 'down'
  }

  const wins = written.map((row) => row.entry.win).filter(Boolean)
  const nextSteps = written.map((row) => row.entry.nextStep).filter(Boolean)

  return {
    rows,
    written,
    count: written.length,
    days,
    streak,
    consistency: rows.length ? Math.round((written.length / rows.length) * 100) : 0,
    averageMood: recentAvg || average(moods),
    averageEnergy: average(energies),
    mood: moodFromAverage(recentAvg || average(moods)),
    trend,
    latest: written.length ? written[written.length - 1] : null,
    lastWin: wins.length ? wins[wins.length - 1] : '',
    lastNextStep: nextSteps.length ? nextSteps[nextSteps.length - 1] : '',
    winsCount: wins.length,
  }
}

/** A gentle, factual line for the journal header. Never scolding. */
export function journalSummaryLine(stats) {
  if (!stats?.count) return 'Nothing written yet. One honest sentence is enough.'
  const parts = []
  if (stats.streak > 1) parts.push(`${stats.streak} days in a row`)
  else parts.push(`${stats.count} ${stats.count === 1 ? 'entry' : 'entries'} in the last ${stats.days} days`)
  if (stats.mood) parts.push(`mood mostly ${stats.mood.label.toLowerCase()}`)
  if (stats.trend === 'up') parts.push('a lighter week than the one before')
  else if (stats.trend === 'down') parts.push('a heavier week than the one before — go gently')
  return `${parts.join(' · ')}.`
}
