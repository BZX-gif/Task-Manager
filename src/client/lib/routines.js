import { addDays, weekdayOf } from './dates.js'
export function routineDue(routine, date) { return !routine.archived && (!routine.days.length || routine.days.includes(weekdayOf(date))) }
export function routineDone(state, routine, date) {
  const checked = new Set(state.routineHistory?.[date]?.[routine.id] || [])
  return routine.activities.length > 0 && routine.activities.every((a) => checked.has(a.id))
}
export function toggleActivity(state, routineId, activityId, date) {
  const day = state.routineHistory[date] || (state.routineHistory[date] = {})
  const checked = new Set(day[routineId] || [])
  if (checked.has(activityId)) checked.delete(activityId); else checked.add(activityId)
  day[routineId] = [...checked]
}
/** Missed days are not debts. Momentum counts actual check-ins, never fabricated streaks. */
export function routineStats(state, routine, today, days = 30) {
  let completed = 0, scheduled = 0, bestRun = 0, run = 0
  const history = []
  for (let i=days-1; i>=0; i--) {
    const date = addDays(today,-i), due = routineDue(routine,date), done = due && routineDone(state,routine,date)
    if (due) { scheduled++; run = done ? run+1 : 0; bestRun = Math.max(bestRun,run) }
    if (done) completed++
    history.push({ date, due, done })
  }
  return { completed, scheduled, bestRun, consistency: scheduled ? Math.round(completed/scheduled*100) : 0, history }
}
