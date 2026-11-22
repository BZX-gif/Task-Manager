/* -------------------------------------------------------------------------
   PAPER · memory — local, private interaction history.

   PAPER remembers what it was asked and answered so the workspace can show
   a history and learn nothing else. The record lives inside the existing
   state payload (additive `state.paper`) and travels with backups like
   everything else. Nothing leaves the device.

   Memory is bounded: only the most recent entries are kept.
   ------------------------------------------------------------------------- */

export const MAX_HISTORY = 50

/** Normalize the additive `state.paper` payload. Older payloads get defaults. */
export function normalizePaper(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const history = Array.isArray(source.history) ? source.history : []
  return {
    history: history
      .filter((entry) => entry && typeof entry === 'object' && typeof entry.text === 'string')
      .slice(-MAX_HISTORY)
      .map((entry) => ({
        id: String(entry.id || `${entry.ts || 0}`),
        role: entry.role === 'user' ? 'user' : 'paper',
        intent: typeof entry.intent === 'string' ? entry.intent.slice(0, 40) : null,
        text: String(entry.text).slice(0, 4000),
        ts: Number.isFinite(entry.ts) ? entry.ts : Date.now(),
      })),
    notes: source.notes && typeof source.notes === 'object' && !Array.isArray(source.notes) ? { ...source.notes } : {},
  }
}

/** An empty PAPER memory. */
export function emptyPaper() {
  return { history: [], notes: {} }
}

/**
 * Record one interaction. Returns the entry so callers can render it without
 * re-reading state. Mutates only the given state (call inside a commit).
 */
export function recordInteraction(state, { role, text, intent = null, id = null, ts = Date.now() }) {
  if (!state.paper) state.paper = emptyPaper()
  const entry = {
    id: id || `${ts}-${Math.random().toString(36).slice(2, 8)}`,
    role: role === 'user' ? 'user' : 'paper',
    intent: intent ? String(intent).slice(0, 40) : null,
    text: String(text).slice(0, 4000),
    ts,
  }
  state.paper.history = [...(state.paper.history || []), entry].slice(-MAX_HISTORY)
  return entry
}

/** Clear the history (a deliberate user action, confirmed in the UI). */
export function clearHistory(state) {
  if (!state.paper) state.paper = emptyPaper()
  state.paper.history = []
  return state.paper
}

/** Today's interaction count — a small honesty metric for the workspace. */
export function interactionCount(state, dayKey) {
  const day = new Date(`${dayKey}T12:00:00`).getTime()
  return (state.paper?.history || []).filter((entry) => entry.role === 'user' && Math.abs(entry.ts - day) < 43200000).length
}
