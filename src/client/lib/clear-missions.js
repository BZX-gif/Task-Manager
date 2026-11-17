/* -------------------------------------------------------------------------
   CLEAR MISSIONS — empty the missions list and nothing else
   -------------------------------------------------------------------------
   "Delete my missions so I can start fresh" is a reasonable thing to want, and
   it is not the same as resetting the workspace. This module draws that line
   precisely, in one place, where it can be tested:

   REMOVED — the mission layer only
     • every mission in `state.tasks` (open, done, inbox, cancelled, subtasks)
     • the blocks those missions placed on the schedule (`block.taskId`)
     • the days they were picked as a Top 3 (`state.top3`)
     • their marks in the daily completion log (`completionLog[].taskDone`)
     • their entries in the reminder "already sent" log

   KEPT — everything else, byte for byte
     goals · projects · routines and routine history · journal · HYB plans ·
     focus sessions and the running timer · categories · study plans and
     timetables · protected time · score history · reviews · assistant history ·
     plain time blocks and HYB blocks on the schedule · every preference

   Pure: it mutates the state object it is given (inside `commit()`) and reports
   exactly what it did, so the UI can promise the truth before it happens and
   repeat it afterwards.
   ------------------------------------------------------------------------- */

const asArray = (value) => (Array.isArray(value) ? value : [])
const isObj = (value) => !!value && typeof value === 'object' && !Array.isArray(value)

/** Where the browser keeps the pre-clear safety copy. */
export const MISSION_CLEAR_BACKUP_KEY = 'kcc_backup_before_mission_clear'

function scheduleDays(state) {
  return isObj(state?.schedule?.days) ? state.schedule.days : {}
}

/**
 * Count what a clear would remove and what it would leave alone.
 * Called before the confirmation dialog, so the dialog can show real numbers.
 */
export function missionClearPlan(state) {
  const tasks = asArray(state?.tasks)
  let missionBlocks = 0
  let timeBlocks = 0
  for (const blocks of Object.values(scheduleDays(state))) {
    for (const block of asArray(blocks)) {
      if (isObj(block) && block.taskId) missionBlocks++
      else timeBlocks++
    }
  }
  const top3 = isObj(state?.top3) ? state.top3 : {}
  const completionLog = isObj(state?.completionLog) ? state.completionLog : {}
  const timetables = isObj(state?.timetables) ? state.timetables : {}

  return {
    /* ---- what goes ---- */
    missions: tasks.length,
    open: tasks.filter((task) => isObj(task) && !task.done && task.status !== 'cancelled').length,
    done: tasks.filter((task) => isObj(task) && task.done === true).length,
    inbox: tasks.filter((task) => isObj(task) && task.inbox === true).length,
    subtasks: tasks.reduce((sum, task) => sum + asArray(isObj(task) ? task.subtasks : []).length, 0),
    missionBlocks,
    top3Picks: Object.values(top3).reduce((sum, ids) => sum + asArray(ids).length, 0),
    completionMarks: Object.values(completionLog).reduce((sum, log) => sum + asArray(isObj(log) ? log.taskDone : []).length, 0),

    /* ---- what stays ---- */
    kept: {
      timeBlocks,
      goals: asArray(state?.goals).length,
      projects: asArray(state?.projects).length,
      routines: asArray(state?.routines).length,
      routineDays: Object.keys(isObj(state?.routineHistory) ? state.routineHistory : {}).length,
      journalDays: Object.keys(isObj(state?.journal) ? state.journal : {}).length,
      hybPlans: asArray(state?.hyb?.plans).length,
      focusSessions: asArray(state?.focus?.sessions).length,
      studyPlanBlocks: Object.values(timetables).reduce((sum, list) => sum + asArray(list).length, 0),
      categories: asArray(state?.categories).length,
      protectedWindows: asArray(state?.settings?.protectedTime).length,
      recordedDays: Object.keys(completionLog).length,
      scoreDays: Object.keys(isObj(state?.scoreHistory) ? state.scoreHistory : {}).length,
      reviews: Object.keys(isObj(state?.reviews) ? state.reviews : {}).length,
    },
  }
}

/** Is there anything at all to clear? */
export function hasMissionsToClear(state) {
  const plan = missionClearPlan(state)
  return plan.missions > 0 || plan.missionBlocks > 0 || plan.top3Picks > 0 || plan.completionMarks > 0
}

/**
 * Remove the mission layer from `state` in place.
 * @returns the same report `missionClearPlan` gives, measured before the change
 */
export function applyMissionClear(state) {
  const plan = missionClearPlan(state)

  // 1 · the missions themselves
  state.tasks = []

  // 2 · the Top 3 picks are lists of mission ids — with no missions they are noise
  state.top3 = {}

  // 3 · the schedule: only blocks a mission placed. Plain time blocks, HYB
  //     blocks and protected windows are schedule data and stay put.
  const days = scheduleDays(state)
  for (const [key, blocks] of Object.entries(days)) {
    if (!Array.isArray(blocks)) continue
    days[key] = blocks.filter((block) => !(isObj(block) && block.taskId))
  }

  // 4 · the daily completion log keeps its study-plan marks (`ttDone`) and its
  //     days; only the mission ticks are lifted out, so analytics never report
  //     completions for missions that no longer exist.
  if (isObj(state.completionLog)) {
    for (const log of Object.values(state.completionLog)) {
      if (isObj(log) && Array.isArray(log.taskDone)) log.taskDone = []
    }
  }

  // 5 · reminders that were about a mission (the log self-prunes after 14 days,
  //     but a stale key could otherwise suppress a fresh reminder of the same shape)
  if (isObj(state.reminders) && isObj(state.reminders.sent)) {
    for (const key of Object.keys(state.reminders.sent)) {
      if (key.startsWith('task:') || key.startsWith('task-duenow:') || key.startsWith('top3:')) delete state.reminders.sent[key]
    }
  }

  return plan
}

/** One honest sentence for the confirmation dialog's detail line. */
export function describeMissionClear(plan) {
  const removed = [
    plan.missions ? `${plan.missions} mission${plan.missions === 1 ? '' : 's'} (${plan.open} open · ${plan.done} done · ${plan.inbox} in the inbox)` : 'no missions',
    plan.subtasks ? `${plan.subtasks} subtask${plan.subtasks === 1 ? '' : 's'}` : null,
    plan.missionBlocks ? `${plan.missionBlocks} scheduled block${plan.missionBlocks === 1 ? '' : 's'} placed by a mission` : null,
    plan.top3Picks ? `${plan.top3Picks} Top 3 pick${plan.top3Picks === 1 ? '' : 's'}` : null,
    plan.completionMarks ? `${plan.completionMarks} completion mark${plan.completionMarks === 1 ? '' : 's'} in the daily log` : null,
  ].filter(Boolean)

  const kept = [
    `${plan.kept.goals} goal${plan.kept.goals === 1 ? '' : 's'}`,
    `${plan.kept.projects} project${plan.kept.projects === 1 ? '' : 's'}`,
    `${plan.kept.routines} routine${plan.kept.routines === 1 ? '' : 's'}`,
    `${plan.kept.journalDays} journal day${plan.kept.journalDays === 1 ? '' : 's'}`,
    `${plan.kept.hybPlans} HYB plan${plan.kept.hybPlans === 1 ? '' : 's'}`,
    `${plan.kept.focusSessions} focus session${plan.kept.focusSessions === 1 ? '' : 's'}`,
    `${plan.kept.timeBlocks} time block${plan.kept.timeBlocks === 1 ? '' : 's'}`,
    `${plan.kept.studyPlanBlocks} study-plan block${plan.kept.studyPlanBlocks === 1 ? '' : 's'}`,
    'every preference',
  ]

  return `Removed: ${removed.join(' · ')}.\nKept: ${kept.join(' · ')}.`
}
