/** Roadmap definitions are data-driven so future missions need no UI rewrite. */
export const DEFAULT_MISSIONS = {
  activeMissionId: 'ssc_cgl_2027',
  definitions: {
    ssc_cgl_2027: { id: 'ssc_cgl_2027', exam: 'SSC CGL', year: 2027, targetRole: 'CBI Sub-Inspector', target: 'AIR 1', status: 'active' },
    ras_2028: { id: 'ras_2028', exam: 'RAS', year: 2028, targetRole: 'SDM', target: 'AIR 1', status: 'future' },
    upsc_cse_2028: { id: 'upsc_cse_2028', exam: 'UPSC CSE', year: 2028, targetRole: 'Indian Foreign Service (IFS)', target: 'AIR 1', status: 'future' },
  },
}

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
