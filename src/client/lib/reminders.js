/** Pure, stable-key reminder rules. Delivery is optional and never prompts for permission. */
import { addDays, minutesOfDay, toHHMM, weekdayOf } from './dates.js'
import { protectionAt } from './protected.js'
import { scheduleFor, itemDone } from './planner.js'
import { routineDue, routineDone } from './routines.js'
import { overdueTasks } from './score.js'
export const DEFAULT_BEFORE_MINUTES=10
export const OVERDUE_HOUR=10
export function computeDueReminders({state,todayKey,nowMinutes,now=new Date(),maxPerRun=2}){
  const settings=state.settings?.reminders||{};if(!settings.enabled)return []
  const protectedBlocks=state.settings?.protectedTime||[]
  if(settings.respectProtectedTime!==false&&protectionAt(nowMinutes,protectedBlocks,todayKey))return []
  const before=Number.isFinite(settings.beforeMinutes)?settings.beforeMinutes:DEFAULT_BEFORE_MINUTES,due=[],blocks=scheduleFor(state,todayKey)
  if(settings.timetable!==false)for(const block of blocks){if(block.taskId||block.protected||itemDone(state,block,todayKey))continue;const delta=minutesOfDay(block.time)-nowMinutes;if(delta>0&&delta<=before)due.push({key:`block:${block.id}:${todayKey}:${before}`,kind:'timetable',title:`Starting in ${delta} min · ${block.time}`,body:block.title,blockId:block.id,taskId:null})}
  if(settings.taskDue!==false)for(const task of state.tasks||[]){if(task.done||task.status==='cancelled'||task.date!==todayKey||!task.time||task.inbox)continue;const delta=minutesOfDay(task.time)-nowMinutes;if(delta>0&&delta<=before)due.push({key:`task:${task.id}:${todayKey}:${before}`,kind:'task',title:`Task in ${delta} min · ${task.time}`,body:task.title,taskId:task.id,blockId:null});if(delta<=0&&nowMinutes-minutesOfDay(task.time)<=15)due.push({key:`task-duenow:${task.id}:${todayKey}`,kind:'task',title:'Scheduled for now',body:task.title,taskId:task.id,blockId:null})}
  if(settings.overdue!==false&&nowMinutes>=OVERDUE_HOUR*60){const overdue=overdueTasks(state,todayKey).filter((t)=>t.status!=='cancelled');if(overdue.length)due.push({key:`overdue:${todayKey}`,kind:'overdue',title:`${overdue.length} overdue task${overdue.length>1?'s':''}`,body:overdue.slice(0,3).map((t)=>t.title).join(' · '),taskId:overdue[0].id,blockId:null})}
  if(settings.top3NudgeAt){const ids=state.top3?.[todayKey]||[],open=ids.filter((id)=>{const t=state.tasks?.find((t)=>t.id===id);return t&&!t.done&&t.status!=='cancelled'});if(open.length&&nowMinutes>=minutesOfDay(settings.top3NudgeAt))due.push({key:`top3:${todayKey}`,kind:'top3',title:`${open.length} of your Top 3 still open`,body:'A small next step counts. Or make a kinder plan for the time you have.',taskId:open[0],blockId:null})}
  // Time-bound nudges have a 30-minute delivery window; reopening the app late never creates a pile-up.
  const nudge=(at)=>{const delta=nowMinutes-minutesOfDay(at);return delta>=0&&delta<=30}
  if(settings.planningAt&&nudge(settings.planningAt)&&!(state.top3?.[todayKey]||[]).length)due.push({key:`planning:${todayKey}`,kind:'planning',title:'A little intention for today',body:'Choose up to three priorities and give them realistic time.',taskId:null,blockId:null})
  if(settings.reviewAt&&Number(settings.reviewDay)===weekdayOf(todayKey)&&nudge(settings.reviewAt))due.push({key:`weekly-review:${todayKey}`,kind:'review',title:'A moment to look back',body:'Notice what worked this week, then make room for what is next.',taskId:null,blockId:null})
  if(settings.routines!==false)for(const routine of state.routines||[]){if(!routineDue(routine,todayKey)||routineDone(state,routine,todayKey))continue;const delta=nowMinutes-minutesOfDay(routine.time);if(delta>=0&&delta<=before)due.push({key:`routine:${routine.id}:${todayKey}`,kind:'routine',title:routine.title,body:'Your routine is ready when you are. A small check-in counts.',taskId:null,blockId:null,routineId:routine.id})}
  return due.slice(0,maxPerRun)
}
export function pruneSentLog(sent={},todayKey,days=14){const cutoff=addDays(todayKey,-days),kept={};for(const [key,value]of Object.entries(sent)){const match=key.match(/(\d{4}-\d{2}-\d{2})/);if(!match||match[1]>=cutoff)kept[key]=value}return kept}
export function reminderSummary(settings={}){if(!settings.enabled)return 'Reminders are off.';const parts=[];if(settings.timetable!==false)parts.push(`timetable blocks ${settings.beforeMinutes??DEFAULT_BEFORE_MINUTES} min before`);if(settings.taskDue!==false)parts.push('timed missions');if(settings.overdue!==false)parts.push('overdue summary at 10:00');if(settings.top3NudgeAt)parts.push(`priority check-in at ${settings.top3NudgeAt}`);if(settings.planningAt)parts.push(`planning at ${settings.planningAt}`);if(settings.reviewAt)parts.push('weekly reflection');if(settings.routines!==false)parts.push('routine check-ins');return parts.length?`You will get: ${parts.join(', ')}.`:'No reminder types selected.'}
