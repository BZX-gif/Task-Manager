/** Progress is derived from real linked work; a manual estimate is explicitly labeled. */
export function taskProgress(task) {
  if (task.done || task.status === 'completed') return 100
  if (task.status === 'cancelled' || task.status === 'not_started') return 0
  if (task.subtasks?.length) return Math.round(task.subtasks.filter((s) => s.done).length / task.subtasks.length * 100)
  return Math.max(0, Math.min(100, Number(task.progress) || 0))
}
export function projectProgress(state, project) {
  if (project.status === 'completed') return 100
  if (project.progressMode === 'manual') return project.manualProgress || 0
  const tasks = state.tasks.filter((t) => t.projectId === project.id && t.status !== 'cancelled')
  const units = [...tasks.map(taskProgress), ...(project.milestones || []).map((m) => m.done ? 100 : 0)]
  return units.length ? Math.round(units.reduce((a,b) => a+b,0)/units.length) : 0
}
export function goalProgress(state, goal) {
  if (goal.status === 'completed') return 100
  if (goal.progressMode === 'manual') return goal.manualProgress || 0
  const units = goal.milestones.map((m) => {
    if (m.done) return 100
    const projects = state.projects.filter((p) => p.goalId === goal.id && p.milestoneId === m.id && p.status !== 'cancelled')
    const tasks = state.tasks.filter((t) => t.goalId === goal.id && t.milestoneId === m.id && t.status !== 'cancelled' && !projects.some((p) => p.id === t.projectId))
    const values = [...projects.map((p) => projectProgress(state,p)), ...tasks.map(taskProgress)]
    return values.length ? values.reduce((a,b) => a+b,0)/values.length : 0
  })
  const unassigned = state.tasks.filter((t) => t.goalId === goal.id && !t.milestoneId && !t.projectId && t.status !== 'cancelled')
  const orphanProjects = state.projects.filter((p) => p.goalId === goal.id && !p.milestoneId && p.status !== 'cancelled')
  units.push(...unassigned.map(taskProgress), ...orphanProjects.map((p) => projectProgress(state,p)))
  return units.length ? Math.round(units.reduce((a,b) => a+b,0)/units.length) : 0
}
export function goalChain(state, task) {
  const project = state.projects.find((p) => p.id === task.projectId)
  const goal = state.goals.find((g) => g.id === (task.goalId || project?.goalId))
  const milestone = goal?.milestones.find((m) => m.id === (task.milestoneId || project?.milestoneId))
  return { goal, project, milestone }
}
function unlinkRecords(state, kind, id) {
  for (const t of state.tasks) {
    if (kind === 'goal' && t.goalId === id) { t.goalId = null; t.milestoneId = null }
    if (kind === 'project' && t.projectId === id) t.projectId = null
  }
  if (kind === 'goal') for (const p of state.projects) if (p.goalId === id) { p.goalId = null; p.milestoneId = null }
}

// Remove dangling links from dated blocks too; immutable focus history keeps its snapshot.
export function unlinkDeleted(state, kind, id) {
  unlinkRecords(state,kind,id)
  for (const blocks of Object.values(state.schedule?.days||{})) for (const b of blocks) {
    if (kind === 'goal' && b.goalId === id) { b.goalId = null; b.milestoneId = null }
    if (kind === 'project' && b.projectId === id) b.projectId = null
  }
}
