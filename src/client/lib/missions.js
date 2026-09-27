/** Roadmap definitions are data-driven so future missions need no UI rewrite. */
export const DEFAULT_MISSIONS = {
  activeMissionId: 'ssc_cgl_2027',
  definitions: {
    ssc_cgl_2027: { id: 'ssc_cgl_2027', exam: 'SSC CGL', year: 2027, targetRole: 'CBI Sub-Inspector', target: 'AIR 1', status: 'active' },
    ras_2028: { id: 'ras_2028', exam: 'RAS', year: 2028, targetRole: 'SDM', target: 'AIR 1', status: 'future' },
    upsc_cse_2028: { id: 'upsc_cse_2028', exam: 'UPSC CSE', year: 2028, targetRole: 'Indian Foreign Service (IFS)', target: 'AIR 1', status: 'future' },
  },
}

/**
 * The pre-v5 app kept a single flat timetable. That legacy schedule (and the
 * starter routine that shipped with it) is preserved under the UPSC mission.
 */
export const LEGACY_TIMETABLE_MISSION_ID = 'upsc_cse_2028'

export function normalizeMissions(raw) {
  const definitions = { ...DEFAULT_MISSIONS.definitions }
  if (raw?.definitions && typeof raw.definitions === 'object') {
    for (const [key, value] of Object.entries(raw.definitions)) {
      if (!value || typeof value !== 'object') continue
      definitions[key] = { ...value, id: String(value.id || key), exam: String(value.exam || key), year: Number(value.year) || '', targetRole: String(value.targetRole || ''), target: String(value.target || ''), status: String(value.status || 'future') }
    }
  }
  const activeMissionId = definitions[raw?.activeMissionId] ? raw.activeMissionId : DEFAULT_MISSIONS.activeMissionId
  for (const mission of Object.values(definitions)) mission.status = mission.id === activeMissionId ? 'active' : 'future'
  return { activeMissionId, definitions }
}

export function activeMission(missions) {
  return missions?.definitions?.[missions.activeMissionId] || DEFAULT_MISSIONS.definitions.ssc_cgl_2027
}

/** The mission whose timetable/plan the UI is currently working on. */
export function activeMissionId(state) {
  return state?.missions?.activeMissionId || DEFAULT_MISSIONS.activeMissionId
}

/**
 * The timetable of one mission (defaults to the active one).
 * v5 keeps `state.timetables` keyed by mission id; pre-v5 payloads that still
 * carry a flat `state.timetable` are honoured so nothing ever crashes on old
 * or hand-made data.
 */
export function timetableFor(state, missionId = null) {
  const id = missionId || activeMissionId(state)
  const map = state?.timetables
  if (map && Array.isArray(map[id])) return map[id]
  return Array.isArray(state?.timetable) ? state.timetable : []
}

/** Alias that documents *which* timetable every view/scheduler works on. */
export function activeTimetable(state) {
  return timetableFor(state)
}

/**
 * The mutable array behind a mission's timetable (created on demand so edits
 * to the active mission always land in the bucket the UI is showing).
 */
export function timetableSlot(state, missionId = null) {
  const id = missionId || activeMissionId(state)
  if (!state.timetables || typeof state.timetables !== 'object') state.timetables = {}
  if (!Array.isArray(state.timetables[id])) {
    // adopt a pre-v5 flat timetable on first write so edits land where they show
    state.timetables[id] = id === activeMissionId(state) && Array.isArray(state.timetable) ? state.timetable : []
  }
  return state.timetables[id]
}

/** Every block across every mission (category accounting, backups, settings). */
export function allTimetableBlocks(state) {
  const map = state?.timetables
  if (map && typeof map === 'object') {
    return Object.values(map).flatMap((list) => (Array.isArray(list) ? list : []))
  }
  return timetableFor(state)
}
