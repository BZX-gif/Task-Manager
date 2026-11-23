/* -------------------------------------------------------------------------
   ATMOSPHERE — the time-of-day engine behind the visual identity
   -------------------------------------------------------------------------
   Three original photographs of the same villa at morning, afternoon and
   night. The workspace reads the local device clock and chooses the matching
   atmosphere. A manual choice always wins until the user returns to Auto.

   This module is pure and deterministic: it never touches the DOM, so the
   boundaries can be tested directly and the same rules run in the shell,
   the client and the tests.

   Defaults
     05:00–11:59  morning    (atmosphere-morning.webp)
     12:00–16:59  afternoon  (atmosphere-afternoon.webp)
     17:00–04:59  evening    (atmosphere-night.webp)
   ------------------------------------------------------------------------- */

/** The three photographic environments. `id` is what `data-atmosphere` holds. */
export const ATMOSPHERES = [
  {
    id: 'morning',
    label: 'Morning',
    image: '/images/atmosphere-morning.webp',
    imageSmall: '/images/atmosphere-morning-sm.webp',
    greeting: 'Good morning',
    note: 'Golden light, a quiet house, the day still unclaimed.',
    range: [5, 11],
  },
  {
    id: 'afternoon',
    label: 'Afternoon',
    image: '/images/atmosphere-afternoon.webp',
    imageSmall: '/images/atmosphere-afternoon-sm.webp',
    greeting: 'Good afternoon',
    note: 'Clear daylight, open water, everything in motion.',
    range: [12, 16],
  },
  {
    id: 'evening',
    label: 'Evening',
    image: '/images/atmosphere-night.webp',
    imageSmall: '/images/atmosphere-night-sm.webp',
    greeting: 'Good evening',
    note: 'Warm lamps, dark water, the day settling into itself.',
    range: [17, 4],
  },
]

/** Stable order used for preloading the *next* atmosphere. */
export const ATMOSPHERE_ORDER = ['morning', 'afternoon', 'evening']

export const ATMOSPHERE_IDS = ATMOSPHERE_ORDER

/** `auto` follows the clock; anything else pins one environment. */
export const ATMOSPHERE_MODES = ['auto', ...ATMOSPHERE_IDS]

export const DEFAULT_ATMOSPHERE_MODE = 'auto'

export function isAtmosphereId(value) {
  return ATMOSPHERE_IDS.includes(value)
}

export function isAtmosphereMode(value) {
  return value === 'auto' || isAtmosphereId(value)
}

/**
 * The atmosphere that matches a local hour (0–23).
 * Boundaries: 05:00 morning · 12:00 afternoon · 17:00 evening.
 */
export function atmosphereForHour(hour) {
  const h = Number.isFinite(Number(hour)) ? Math.floor(Number(hour)) : 0
  if (h >= 5 && h < 12) return 'morning'
  if (h >= 12 && h < 17) return 'afternoon'
  return 'evening'
}

/** The atmosphere for a Date (uses the device's local time). */
export function atmosphereForDate(now = new Date()) {
  return atmosphereForHour(now?.getHours?.() ?? 0)
}

/**
 * Resolve the mode against the clock. A manual choice wins; `auto` (or any
 * unknown stored value, e.g. a hand-edited localStorage payload) follows time.
 */
export function resolveAtmosphere(mode, now = new Date()) {
  return isAtmosphereId(mode) ? mode : atmosphereForDate(now)
}

export function atmosphereInfo(id) {
  return ATMOSPHERES.find((entry) => entry.id === id) || ATMOSPHERES[2]
}

/** Where a mode sits in the day cycle — used to warm the next photograph. */
export function nextAtmosphere(id) {
  const index = ATMOSPHERE_ORDER.indexOf(id)
  return ATMOSPHERE_ORDER[(index + 1) % ATMOSPHERE_ORDER.length]
}

/**
 * The greeting the hero uses for the *active* atmosphere. Manual overrides
 * change the photograph and the light, never the facts: the greeting follows
 * the selected atmosphere so the screen stays coherent.
 */
export function greetingForAtmosphere(id) {
  return atmosphereInfo(id).greeting
}

/**
 * Split a greeting line ("Good evening, Sir.") into its two display parts so
 * the hero can set the salutation on its own line without duplicating copy.
 * Falls back to the whole string when the line has no comma.
 */
export function splitGreeting(line) {
  const text = String(line || '').trim()
  const comma = text.indexOf(',')
  if (comma < 0) return { part: text, name: '' }
  return { part: text.slice(0, comma + 1), name: text.slice(comma + 1).trim() }
}
