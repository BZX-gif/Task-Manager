/* -------------------------------------------------------------------------
   PAPER · intent — the local command parser for "Ask PAPER".

   This is a deterministic keyword/phrase matcher over a fixed catalog of
   supported requests. It does not pretend to be open-ended conversation:
   when nothing matches with confidence, PAPER says so and lists what it
   can answer. Variations in phrasing are handled by scoring multiple signal
   sets per intent, not by one brittle regex.
   ------------------------------------------------------------------------- */

/**
 * The supported request catalog. Each intent carries the signals that fire it
 * and an example phrasing the UI can show.
 */
export const INTENTS = [
  {
    id: 'focus_today',
    label: 'What should I focus on today?',
    examples: ['what should I focus on today?', 'what do I do now', 'my next move', 'priorities for today', 'top priorities'],
    signals: ['focus on today', 'should i focus', 'focus on', 'focus today', 'what should i do', 'what do i do', 'do now', 'next move', 'next action', 'next step', 'priorit', 'most important today', 'what matters today', 'top 3', 'top three', 'where do i start', 'start today'],
  },
  {
    id: 'overdue_missions',
    label: 'Show my overdue missions',
    examples: ['show me my overdue missions', 'what is late', 'what did I miss'],
    signals: ['overdue', 'late', 'behind on', 'missed', 'past due', 'did i miss', 'what did i miss'],
  },
  {
    id: 'goal_status',
    label: 'Which goal is falling behind?',
    examples: ['which goal is falling behind', 'goal health', 'how are my goals'],
    signals: ['goal', 'goals', 'ambition', 'falling behind', 'goal health', 'slipping', 'stuck goal'],
  },
  {
    id: 'upcoming_deadlines',
    label: 'Find my upcoming deadlines',
    examples: ['find my upcoming deadlines', 'what is due soon'],
    signals: ['deadline', 'deadlines', 'due soon', 'due this week', 'coming up', 'what is due', 'upcoming'],
  },
  {
    id: 'plan_tomorrow',
    label: 'Plan tomorrow',
    examples: ['plan tomorrow', 'prepare my day tomorrow', 'what does tomorrow look like'],
    signals: ['plan tomorrow', 'tomorrow', 'prepare tomorrow', 'plan my day tomorrow', 'tomorrow look', 'next day'],
  },
  {
    id: 'time_this_week',
    label: 'How much time do I have this week?',
    examples: ['how much time do I have this week', 'free time', 'my availability'],
    signals: ['how much time', 'free time', 'available time', 'availability', 'this week', 'week look', 'capacity', 'room this week'],
  },
  {
    id: 'important_projects',
    label: 'Show my most important projects',
    examples: ['show me my most important projects', 'project status'],
    signals: ['project', 'projects', 'project status', 'important projects'],
  },
  {
    id: 'progress_decline',
    label: 'Why is my progress declining?',
    examples: ['why is my progress declining', 'am I less productive lately'],
    signals: ['declin', 'dropping', 'less productive', 'progress down', 'worse', 'why is my progress', 'slowing', 'productivity'],
  },
  {
    id: 'today_briefing',
    label: 'Brief me on today',
    examples: ['brief me', 'how does my day look', 'summary of my day'],
    signals: ['brief', 'briefing', 'summary', 'how does my day', 'my day look', 'situation', 'where do i stand', 'catch me up'],
  },
  {
    id: 'workload',
    label: 'Am I overloaded?',
    examples: ['am I overloaded', 'how is my workload', 'is tomorrow too full'],
    signals: ['overload', 'workload', 'too much', 'too full', 'overcommitted', 'burnout', 'how busy'],
  },
  {
    id: 'recommendations',
    label: 'What do you recommend?',
    examples: ['what do you recommend', 'any suggestions', 'what should change'],
    signals: ['recommend', 'suggest', 'advice', 'what should change', 'improve', 'better'],
  },
  {
    id: 'alerts',
    label: 'What needs my attention?',
    examples: ['what needs my attention', 'any problems', 'risks'],
    signals: ['alert', 'alerts', 'problem', 'problems', 'risk', 'risks', 'need my attention', 'attention', 'wrong', 'on fire'],
  },
  {
    id: 'patterns',
    label: 'What patterns do you see?',
    examples: ['when am I most productive', 'what patterns do you see', 'my consistency'],
    signals: ['pattern', 'patterns', 'productive hours', 'most productive', 'consistency', 'habit', 'trend', 'history'],
  },
  {
    id: 'recovery',
    label: 'Help me recover my day',
    examples: ['I fell behind, help me recover', 'catch me up', 'recover my day'],
    signals: ['recover', 'recovery', 'fell behind', 'fallen behind', 'catch up', 'catch me up', 'get back on track', 'redo my day', 'salvage'],
  },
  {
    id: 'help',
    label: 'What can you do?',
    examples: ['help', 'what can you do', 'commands'],
    signals: ['help', 'what can you do', 'commands', 'command list', 'what do you do', 'who are you', 'about you', 'paper'],
  },
]

/** Phrases that mean the user wants to *do* something, not just look. */
export const ACTION_SIGNALS = {
  create_mission: ['create a mission', 'add a mission', 'new mission', 'make a task', 'add a task', 'create task', 'new task'],
  reschedule_mission: ['reschedule', 'move the mission', 'move my mission', 'push to tomorrow', 'postpone'],
  plan_day: ['plan my day', 'plan the day', 'plan tomorrow', 'build my day'],
  set_intention: ['set intention', 'today i will', 'my intention'],
}

const clean = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9\s?']/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Score every intent against the utterance and return the best confident
 * match. Ties are broken by signal count then catalog order.
 * @param {string} text
 * @returns {{ intent: string, confidence: 'high'|'low'|'none', matched: string[], slots: any, suggestion?: any }}
 */
export function parseIntent(text) {
  const utterance = clean(text)
  if (!utterance) return { intent: 'none', confidence: 'none', matched: [], slots: {} }

  const slots = parseSlots(utterance)
  let best = null
  let bestScore = 0
  let bestMatched = []

  INTENTS.forEach((entry, index) => {
    const matched = entry.signals.filter((signal) => utterance.includes(signal))
    if (!matched.length) return
    // longer signal phrases are stronger evidence than short ones; a
    // multi-word id phrase ("goal status") is extra evidence, but a
    // single-word id ("help") must not double-count its own signal
    const idPhrase = entry.id.replace(/_/g, ' ')
    const bonus = idPhrase.includes(' ') && utterance.includes(idPhrase) ? 20 : 0
    const score = matched.reduce((sum, signal) => sum + signal.length, 0) + bonus
    const better = score > bestScore || (score === bestScore && best && index < INTENTS.indexOf(best))
    if (score > 0 && (best === null || better)) {
      best = entry
      bestScore = score
      bestMatched = matched
    }
  })

  if (!best) {
    const suggestion = closestExample(utterance)
    return { intent: 'none', confidence: 'none', matched: [], slots, suggestion }
  }

  // A single short keyword match is weak evidence — be honest about it.
  const confidence = bestScore >= 12 ? 'high' : 'low'
  return { intent: best.id, confidence, matched: bestMatched, slots, catalog: best }
}

/** Pull time words out of the utterance ("today", "tomorrow", "this week"…). */
export function parseSlots(utterance) {
  const slots = {}
  if (/\btoday\b/.test(utterance)) slots.day = 'today'
  else if (/\btomorrow\b|\bnext day\b/.test(utterance)) slots.day = 'tomorrow'
  if (/\bthis week\b/.test(utterance)) slots.range = 'week'
  else if (/\bthis month\b/.test(utterance)) slots.range = 'month'
  if (/\bmy\b|\bme\b|\bi\b/.test(utterance)) slots.personal = true
  return slots
}

/** The catalog entry that shares the most words with an unmatched request. */
function closestExample(utterance) {
  const words = new Set(utterance.split(' ').filter((w) => w.length > 3))
  let best = null
  let bestOverlap = 0
  for (const entry of INTENTS) {
    for (const example of entry.examples) {
      const overlap = [...words].filter((w) => example.includes(w)).length
      if (overlap > bestOverlap) {
        bestOverlap = overlap
        best = entry
      }
    }
  }
  return bestOverlap >= 2 ? best : null
}

/** Ready-to-send example prompts for the empty state. */
export function examplePrompts() {
  return INTENTS.slice(0, 8).flatMap((entry) => entry.examples.slice(0, 1))
}

/** The honest "I didn't get that" reply, with what PAPER can do. */
export function unsupportedReply(text) {
  const suggestion = parseIntent(text).suggestion
  return {
    intent: 'none',
    text: suggestion
      ? `I could not match that request with confidence. Did you mean: “${suggestion.label}”?`
      : 'I could not match that request with confidence. I answer from a fixed set of workspace questions — I do not have open-ended conversation.',
  }
}

/** Does this utterance ask PAPER to perform an action? */
export function detectAction(utterance) {
  const text = clean(utterance)
  for (const [kind, signals] of Object.entries(ACTION_SIGNALS)) {
    const matched = signals.filter((signal) => text.includes(signal))
    if (matched.length) return { kind, matched }
  }
  return null
}
