import { state, currentDayKey, commit } from '../core/store.js'
import { saveDay } from '../core/actions.js'
import { closeModal, escapeHtml, openModal, confirmDialog, toast } from '../core/dom.js'
import { addDays, formatDuration, formatKeyLabel, minutesOfDay, toHHMM } from '../lib/dates.js'
import { proposeDay, recoveryProposal, scheduleFor, scheduleConflicts, itemDone } from '../lib/planner.js'
import { uid } from '../lib/state.js'
import { icon, empty, goalOptions, timeLabel } from '../ui/common.js'

export function openDayPlanner({date=currentDayKey()}={}) {
  const today=currentDayKey(), now=new Date()
  const start=date===today?toHHMM(Math.min(1410,Math.ceil((now.getHours()*60+now.getMinutes())/15)*15)):state.settings.workingHours.start
  const candidates=state.tasks.filter((t)=>!t.done&&!t.inbox&&t.status!=='cancelled'&&((t.date===date&&!t.time)||(t.date&&t.date<date)))
  openModal({title:'Plan my day',size:'modal-wide',body:`<p class="section-sub" style="margin-bottom:20px">A plan for ${formatKeyLabel(date)}. Choose what matters, give it realistic time, and review before anything changes.</p><form id="day-plan-form" class="form-stack"><div class="form-grid"><div><label class="field-label" for="plan-date">Planning for</label><input id="plan-date" type="date" class="input-field" required value="${date}"></div><div><label class="field-label" for="plan-goal">Connect new missions to a goal</label><select id="plan-goal" class="input-field">${goalOptions()}</select></div></div><div class="form-grid"><div><label class="field-label" for="plan-start">Available from</label><input id="plan-start" type="time" class="input-field" required value="${start}"></div><div><label class="field-label" for="plan-end">Available until</label><input id="plan-end" type="time" class="input-field" required value="${state.settings.workingHours.end}"></div></div><div class="form-grid"><div><label class="field-label" for="plan-break">Break after a focus stretch · minutes</label><input id="plan-break" type="number" min="0" max="60" class="input-field" value="${state.settings.focus.breakMinutes}"></div><div class="field-label" style="align-self:center;font-weight:400;line-height:1.8">A 10-minute breather after 90 minutes of work. Existing commitments and protected windows stay put.</div></div>${candidates.length?`<div><p class="field-label">Bring existing missions into this plan</p><div style="max-height:150px;overflow:auto">${candidates.map((t)=>`<label class="check-label" style="padding:7px 0"><input type="checkbox" data-plan-task="${escapeHtml(t.id)}" checked>${escapeHtml(t.title)} <span class="muted small">${formatDuration(t.estimateMinutes)}</span></label>`).join('')}</div></div>`:''}<div><label class="field-label" for="plan-tasks">What else needs your attention?</label><textarea id="plan-tasks" class="input-field" rows="4" placeholder="One mission per line. Add an optional estimate:\nRead one chapter | 45\nFinish the proposal | 60\nReply to important emails"></textarea><p class="form-hint" style="margin-top:6px">Default estimate: ${state.settings.defaultTaskMinutes} minutes. High-priority work is scheduled first.</p></div><div class="form-footer"><button type="button" class="btn-ghost" data-modal-close>Not now</button><button type="submit" class="btn-primary">${icon('sun')}Suggest a schedule</button></div></form>`,onMount:(box)=>{
    box.querySelector('form').addEventListener('submit',(e)=>{
      e.preventDefault()
      const day=box.querySelector('#plan-date').value, from=box.querySelector('#plan-start').value, until=box.querySelector('#plan-end').value, goalId=box.querySelector('#plan-goal').value||null
      if(minutesOfDay(until)<=minutesOfDay(from)){toast('Your available time needs to end after it starts.','error');return}
      const chosen=new Set([...box.querySelectorAll('[data-plan-task]:checked')].map((b)=>b.dataset.planTask))
      const existing=candidates.filter((t)=>chosen.has(t.id))
      const fresh=box.querySelector('#plan-tasks').value.split('\n').map((line)=>line.trim()).filter(Boolean).slice(0,40).map((line)=>{const parts=line.split('|');const duration=Number(parts[1]?.replace(/[^\d.]/g,''));return{id:null,title:parts[0].trim().slice(0,200),estimateMinutes:Math.max(5,Math.min(600,duration||state.settings.defaultTaskMinutes)),priority:'medium',goalId,isNew:true}}).filter((t)=>t.title)
      if(!existing.length&&!fresh.length){toast('Add at least one mission to plan.','info');return}
      const fixed=scheduleFor(state,day).filter((b)=>!chosen.has(b.taskId))
      const result=proposeDay({tasks:[...existing,...fresh],start:from,end:until,date:day,breakMinutes:Number(box.querySelector('#plan-break').value),breakEvery:90,fixedBlocks:fixed,protectedBlocks:state.settings.protectedTime})
      showProposal({day,plan:result,fixed,existing,fresh,recovery:false})
    })
  }})
}

function showProposal({day,plan,fixed,existing=[],fresh=[],recovery=false}) {
  const rows=[...plan.proposals,...plan.deferred.map((t)=>({...t,id:t.id,time:'',duration:t.estimateMinutes||t.duration||30,include:false,deferred:true}))]
  openModal({title:recovery?'A fresh way forward.':'Your day, with room to breathe.',size:'modal-wide',body:`<div class="notice">${icon(recovery?'recover':'sun')}<span>${recovery?'Keep the important commitments. Move what can wait. Nothing changes until you approve.':'A suggestion, not a sentence.'} ${formatDuration(plan.plannedMinutes)} of focused work fits in ${formatDuration(plan.availableMinutes)} of available time.</span></div>${plan.deferred.length?`<div class="notice warning-notice" style="margin-top:12px">${icon('info')}<span>${plan.deferred.length} mission${plan.deferred.length===1?' doesn’t':'s don’t'} fit today. Leave ${plan.deferred.length===1?'it':'them'} out, or explicitly move ${plan.deferred.length===1?'it':'them'} to tomorrow. No unrealistic catch-up required.</span></div>`:''}<div class="proposal-list"><div class="plan-row-labels"><span></span><span>Mission</span><span>Start</span><span>Minutes</span></div>${rows.map((t,i)=>`<div class="plan-row" data-proposal-row="${i}"><input type="checkbox" data-proposal-include aria-label="Include ${escapeHtml(t.title)}" ${t.include?'checked':''}><div><input class="input-field" data-proposal-title aria-label="Mission title" value="${escapeHtml(t.title)}" required>${t.deferred?'<p class="form-hint" style="font-size:9px;margin-top:4px">Move to tomorrow if selected</p>':''}</div><input class="input-field" type="time" data-proposal-time aria-label="Start time" value="${t.time||''}" ${t.deferred?'disabled':''}><input class="input-field" type="number" min="5" max="600" data-proposal-duration aria-label="Duration in minutes" value="${t.duration||t.estimateMinutes||30}"></div>`).join('')}</div><p class="form-hint" data-proposal-feedback>Protected time and existing commitments are preserved. Edit any row before accepting.</p><div class="form-footer"><button class="btn-ghost" data-back-plan>${recovery?'Not now':'Back to planning'}</button><button class="btn-primary" data-apply ${rows.length?'':'disabled'}>${icon('check')}${recovery?'Accept recovery plan':'Accept schedule'}</button></div>`,onMount:(box)=>{
    box.querySelector('[data-back-plan]').addEventListener('click',()=>recovery?closeModal():openDayPlanner({date:day}))
    const readRows=()=>[...box.querySelectorAll('[data-proposal-row]')].map((row,i)=>({...rows[i],title:row.querySelector('[data-proposal-title]').value.trim(),time:row.querySelector('[data-proposal-time]').value,duration:Number(row.querySelector('[data-proposal-duration]').value),include:row.querySelector('[data-proposal-include]').checked})).filter((t)=>t.include)
    box.querySelector('[data-apply]').addEventListener('click',async()=>{
      const selected=readRows()
      if(!selected.length){toast('Choose at least one mission, or cancel to keep your current plan.','info');return}
      if(selected.some((t)=>!t.title||!Number.isFinite(t.duration)||t.duration<5||t.duration>600||(!t.deferred&&!t.time))){toast('Each scheduled mission needs a title, start time and 5–600 minute duration.','error');return}
      const newBlocks=selected.filter((t)=>!t.deferred).map((t)=>{const linkedId=t.taskId||(!t.isNew&&state.tasks.some((x)=>x.id===t.id)?t.id:null);return {id:t.isNew&&!linkedId?`task:new:${selected.indexOf(t)}`:linkedId?`task:${linkedId}`:t.id,title:t.title,time:t.time,duration:t.duration,cat:t.cat||null,priority:t.priority||'medium',goalId:t.goalId||null,projectId:t.projectId||null,milestoneId:t.milestoneId||null,kind:t.kind==='break'?'break':'mission',status:'planned',flexible:!t.protected,protected:!!t.protected,taskId:linkedId,sourceId:t.sourceId||linkedId||null}})
      const conflicts=scheduleConflicts([...fixed,...newBlocks],state.settings.protectedTime,day)
      if(conflicts.length&&!await confirmDialog({title:'This plan has an overlap.',message:`${conflicts[0].label}. Adjust the times, or explicitly keep both commitments. No protected window will be deleted.`,confirmText:'Keep both commitments'}))return
      const ids=new Map()
      const originalBlocks=scheduleFor(state,day)
      const taskSnapshots=state.tasks.filter((t)=>selected.some((p)=>p.id===t.id||p.taskId===t.id)).map((t)=>({...t}))
      commit((s)=>{
        for(const t of selected){
          let task=s.tasks.find((x)=>x.id===t.id)
          if(!task){const id=uid();ids.set(selected.indexOf(t),id);task={id,title:t.title,date:day,time:t.deferred?null:t.time,priority:t.priority||'medium',cat:t.cat||null,notes:'',description:'',estimateMinutes:t.duration,done:false,status:'ready',inbox:false,createdAt:Date.now(),completedAt:null,recurrence:null,seriesId:null,occurrenceDate:null,goalId:t.goalId||null,projectId:null,milestoneId:null,horizon:'daily',subtasks:[],history:[],progress:null,flexible:true,protected:false};s.tasks.push(task); t.taskId = task.id; t.isNew = true; t.sourceId = null}
          else {if(t.deferred){task.history=[...(task.history||[]),{at:Date.now(),action:'recovery_deferred',from:task.date,to:addDays(day,1)}];task.date=addDays(day,1);task.time=null;task.status='rescheduled'}else{task.date=day;task.time=t.time;task.estimateMinutes=t.duration;task.inbox=false}}
        }
      },{silent:true})
      for(const b of newBlocks){if(b.id.startsWith('task:new:')){const index=Number(b.id.split(':').pop());const id=ids.get(index);b.id=`task:${id}`;b.taskId=id;b.sourceId=id}}
      // Existing blocks that were deliberately deferred leave today's dated plan.
      const deferredIds=new Set(selected.filter((t)=>t.deferred).map((t)=>t.id))
      const keptFixed=fixed.filter((b)=>!deferredIds.has(b.taskId)&&!deferredIds.has(b.id))
      saveDay(day,[...keptFixed,...newBlocks],recovery?'A more realistic day. You’re back in control.':'Your plan is in place.',{undoable:true,before:originalBlocks,taskSnapshots,createdTaskIds:[...ids.values()]})
      closeModal()
    })
  }})
}

export function openRecoveryModal({nowMinutes=null}={}) {
  const day=currentDayKey(), now=new Date()
  if(nowMinutes!=null)now.setHours(Math.floor(nowMinutes/60),nowMinutes%60,0,0)
  const plan=recoveryProposal(state,day,now)
  if(!plan.remaining.length&&!state.tasks.some((t)=>!t.done&&!t.inbox&&t.date===day&&!t.time&&t.status!=='cancelled')){
    openModal({title:'Recover my day',body:`${empty('leaf','You’re right where you need to be.','There are no missed or remaining commitments to reorganize. Take a breath, or make space for something meaningful.')}<div class="form-footer"><button class="btn-ghost" data-modal-close>Done</button><button class="btn-primary" data-replan>${icon('sun')}Plan something new</button></div>`,onMount:(box)=>box.querySelector('[data-replan]').addEventListener('click',()=>openDayPlanner())})
    return
  }
  showProposal({day,plan,fixed:plan.fixedBlocks,recovery:true})
}
