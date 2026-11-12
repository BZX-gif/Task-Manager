import { state, commit, currentDayKey } from '../core/store.js'
import { saveDay, postponeMission, skipMission } from '../core/actions.js'
import { closeModal, confirmDialog, escapeHtml, openModal, toast, qs, qsa } from '../core/dom.js'
import { addDays, formatDuration, formatKeyLabel, minutesOfDay, toHHMM, weekDates } from '../lib/dates.js'
import { scheduleFor, scheduleConflicts, blockState, itemDone, extendSchedule, protectedIntervals } from '../lib/planner.js'
import { uid } from '../lib/state.js'
import { toggleActivity } from '../lib/routines.js'
import { icon, pageHeading, empty, timeLabel, bindCommon, taskOptions } from '../ui/common.js'
import { categoryOptions } from './shared.js'
import { renderStudyPlans } from './timetable.js'

let selectedDate = currentDayKey()
let mode = 'day'
const HOUR_HEIGHT = 64
export function setScheduleDate(date) { selectedDate=date }
export function renderSchedule() {
  if (mode === 'plans') { renderStudyPlans(); const section=document.getElementById('view-schedule'); section?.querySelectorAll('[data-study-back]').forEach((b)=>{b.replaceWith(b.cloneNode(true))}); section?.querySelector('[data-study-back]').addEventListener('click',()=>{mode='day';renderSchedule()}); return }
  const section=document.getElementById('view-schedule'); if(!section)return
  const today=currentDayKey(), blocks=scheduleFor(state,selectedDate), conflicts=scheduleConflicts(blocks,state.settings.protectedTime,selectedDate)
  const unscheduled=state.tasks.filter((t)=>t.date===selectedDate&&!t.time&&!t.done&&!t.inbox&&t.status!=='cancelled')
  const startHour=Math.min(Number(state.settings.workingHours.start.split(':')[0]),...blocks.map((b)=>Math.floor(minutesOfDay(b.time)/60)),8)
  const endHour=Math.min(24,Math.max(Number(state.settings.workingHours.end.split(':')[0])+1,...blocks.map((b)=>Math.ceil((minutesOfDay(b.time)+b.duration)/60)),18))
  const totalMinutes=(endHour-startHour)*60
  const now=new Date(), nowMin=now.getHours()*60+now.getMinutes()
  const protectedBlocks=protectedIntervals(state.settings.protectedTime,selectedDate).map((b)=>({...b,id:'protected:'+b.id,time:toHHMM(b.start),duration:b.end-b.start,kind:'protected',protected:true,flexible:false}))
  const visible=[...blocks,...protectedBlocks.filter((p)=>!blocks.some((b)=>b.sourceId===p.id.slice(10)))].sort((a,b)=>minutesOfDay(a.time)-minutesOfDay(b.time))
  const laidOut=layoutEvents(visible)
  section.innerHTML=`${pageHeading('TIME, WITH INTENTION','Your schedule.','A realistic plan. Protected space. Room to do your best work.',`<button class="btn-ghost" data-common="recover">${icon('recover')}Recover</button><button class="btn-primary" data-common="plan">${icon('sun')}Plan my day</button>`)}
    <div class="schedule-toolbar"><div class="schedule-date-nav"><button class="icon-btn" data-date-step="-1" aria-label="Previous ${mode==='week'?'week':'day'}">${icon('left')}</button><strong>${mode==='week'?`${formatKeyLabel(weekDates(selectedDate,state.settings.weekStart)[0],{weekday:false})} – ${formatKeyLabel(weekDates(selectedDate,state.settings.weekStart)[6],{weekday:false})}`:formatKeyLabel(selectedDate,{year:true})}</strong><button class="icon-btn" data-date-step="1" aria-label="Next ${mode==='week'?'week':'day'}">${icon('chevron')}</button><button class="btn btn-secondary btn-small" data-today>Today</button></div><div class="heading-actions"><div class="segmented" aria-label="Calendar view">${[['day','Day'],['week','Week'],['list','List'],['plans','Study plans']].map(([m,l])=>`<button data-calendar-mode="${m}" class="${mode===m?'seg-active':''}" aria-pressed="${mode===m}">${l}</button>`).join('')}</div><button class="btn-ghost btn-small" data-add-block>${icon('plus')}Time block</button></div></div>
    ${conflicts.length?`<div class="notice warning-notice" style="margin-bottom:18px">${icon('info')}<span>${conflicts.length} scheduling conflict${conflicts.length===1?'':'s'}. ${escapeHtml(conflicts[0].label)}. Nothing has been changed automatically.</span></div>`:''}
    <div class="schedule-layout"><div class="calendar-surface">${mode==='week'?weekHtml():mode==='list'?listHtml(blocks):`<div class="calendar-scroll"><div class="day-timeline" style="height:${(endHour-startHour)*HOUR_HEIGHT}px">${Array.from({length:endHour-startHour},(_,i)=>`<div class="timeline-hour"><span>${timeLabel(toHHMM((startHour+i)*60),true)}</span></div>`).join('')}<div class="timeline-events">${laidOut.map(({item,lane,lanes})=>eventHtml(item,startHour,lane,lanes,conflicts)).join('')}</div>${selectedDate===today&&nowMin>=startHour*60&&nowMin<endHour*60?`<div class="now-line" style="top:${(nowMin-startHour*60)/60*HOUR_HEIGHT}px"><span>Now</span></div>`:''}${!blocks.length?`<div class="calendar-empty-overlay">${empty('calendar','Give your day a little shape.','Add a mission or protect some time for what matters.',`<button class="btn-primary" data-common="new-task" data-date="${selectedDate}">${icon('plus')}Add a mission</button>`)}</div>`:''}</div></div>`}</div>
    <aside class="schedule-side"><article class="card"><div class="card-header"><h3>The shape of your day</h3>${icon('calendar')}</div><div class="schedule-summary"><div><span>Planned time</span><strong>${formatDuration(blocks.reduce((s,b)=>s+b.duration,0))}</strong></div><div><span>Completed</span><strong>${blocks.filter((b)=>itemDone(state,b,selectedDate)).length} / ${blocks.length}</strong></div><div><span>Protected windows</span><strong>${protectedBlocks.length}</strong></div><div><span>Conflicts</span><strong class="${conflicts.length?'warning':''}">${conflicts.length}</strong></div></div><p class="form-hint" style="margin-top:18px">Drag a block to reschedule. Prefer the keyboard? Focus it and use Alt + ↑ / ↓. On mobile, tap to edit.</p></article><article class="card"><div class="card-header"><h3>Ready to schedule</h3><span class="count-badge">${unscheduled.length}</span></div>${unscheduled.length?unscheduled.map((t)=>`<div class="unscheduled-item"><div style="flex:1;min-width:0"><strong>${escapeHtml(t.title)}</strong><p>${formatDuration(t.estimateMinutes)} · ${t.priority} priority</p></div><button class="icon-btn" data-schedule-task="${escapeHtml(t.id)}" aria-label="Schedule ${escapeHtml(t.title)}">${icon('plus')}</button></div>`).join(''):empty('inbox','All settled.','Unscheduled missions for this day will appear here.')}<button class="text-button" style="margin-top:12px" data-common="new-task" data-date="${selectedDate}">${icon('plus')}Add a mission</button></article><article class="card"><h3 class="section-title">A plan that bends.</h3><p class="form-hint" style="margin:10px 0 15px">Running behind doesn’t mean starting over. Keep what matters and make room for the rest.</p><button class="btn-ghost btn-small" data-common="recover">${icon('recover')}Recover my day</button></article></aside></div>`
  bindCommon(section)
  qsa(section, '[data-calendar-mode]').forEach((b)=>b.addEventListener('click',()=>{mode=b.dataset.calendarMode;renderSchedule()}))
  qsa(section, '[data-date-step]').forEach((b)=>b.addEventListener('click',()=>{selectedDate=addDays(selectedDate,Number(b.dataset.dateStep)*(mode==='week'?7:1));renderSchedule()}))
  qs(section, '[data-today]').addEventListener('click',()=>{selectedDate=today;renderSchedule()})
  qs(section, '[data-add-block]').addEventListener('click',()=>openScheduleBlockModal(null,selectedDate))
  qsa(section, '[data-schedule-task]').forEach((b)=>b.addEventListener('click',()=>window.CC.openTaskModal(b.dataset.scheduleTask)))
  qsa(section, '[data-event-edit]').forEach((b)=>b.addEventListener('click',(e)=>{e.stopPropagation();editEvent(b.dataset.eventEdit)}))
  qsa(section, '[data-block-toggle]').forEach((b)=>b.addEventListener('click',(e)=>{e.stopPropagation();toggleScheduleItem(b.dataset.blockToggle,selectedDate)}))
  qsa(section, '[data-event-delete]').forEach((b)=>b.addEventListener('click',async(e)=>{e.stopPropagation();const item=scheduleFor(state,selectedDate).find((x)=>x.id===b.dataset.eventDelete);if(!item)return;if(await confirmDialog({title:'Remove this time block?',message:'The mission and its focus history will stay safe. Only this scheduled block is removed.',confirmText:'Remove block'})){saveDay(selectedDate,scheduleFor(state,selectedDate).filter((x)=>x.id!==item.id),'Time block removed')}}))
  qsa(section, '[data-event]').forEach((node)=>{
    node.addEventListener('keydown',(e)=>{if(e.key==='Enter'){e.preventDefault();editEvent(node.dataset.event)}else if(e.key===' '){e.preventDefault();toggleScheduleItem(node.dataset.event,selectedDate)}else if(e.altKey&&['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();moveEvent(node.dataset.event,selectedDate,e.key==='ArrowUp'?-15:15)}})
    node.addEventListener('click',(e)=>{if(!e.target.closest('button')&&!node.dataset.dragged)editEvent(node.dataset.event)})
    attachPointerDrag(node,startHour)
  })
  qsa(section, '[data-week-day]').forEach((b)=>b.addEventListener('click',()=>{selectedDate=b.dataset.weekDay;mode='day';renderSchedule()}))
  qsa(section, '[data-week-event]').forEach((b)=>b.addEventListener('click',()=>{selectedDate=b.dataset.weekDate;editEvent(b.dataset.weekEvent)}))
  qsa(section, '[draggable=true]').forEach((node)=>node.addEventListener('dragstart',(e)=>{e.dataTransfer.setData('text/plain',JSON.stringify({id:node.dataset.event||node.dataset.weekEvent,date:node.dataset.weekDate||selectedDate}));e.dataTransfer.effectAllowed='move'}))
  qsa(section, '[data-drop-date]').forEach((node)=>{node.addEventListener('dragover',(e)=>{e.preventDefault();node.classList.add('drag-over')});node.addEventListener('dragleave',()=>node.classList.remove('drag-over'));node.addEventListener('drop',(e)=>{e.preventDefault();node.classList.remove('drag-over');try{const payload=JSON.parse(e.dataTransfer.getData('text/plain'));void transferEvent(payload.id,payload.date,node.dataset.dropDate)}catch{toast('Use a mission from this calendar to reschedule.','info')}})})
}
function layoutEvents(items) {
  const sorted=[...items].sort((a,b)=>minutesOfDay(a.time)-minutesOfDay(b.time))
  const laneEnds=[]
  const placed=sorted.map((item)=>{const start=minutesOfDay(item.time);let lane=laneEnds.findIndex((end)=>end<=start);if(lane<0)lane=laneEnds.length;laneEnds[lane]=start+item.duration;return{item,lane,start,end:start+item.duration}})
  return placed.map((p)=>({...p,lanes:Math.max(1,...placed.filter((x)=>x.start<p.end&&x.end>p.start).map((x)=>x.lane+1))}))
}
function eventHtml(b,startHour,lane,lanes,conflicts) {
  const status=blockState(state,b,selectedDate), top=(minutesOfDay(b.time)-startHour*60)/60*HOUR_HEIGHT, height=Math.max(29,b.duration/60*HOUR_HEIGHT-3)
  return `<div class="calendar-event is-${status} ${b.protected?'is-protected':''} ${conflicts.some((c)=>c.a===b.id)?'is-conflict':''}" data-event="${escapeHtml(b.id)}" role="button" tabindex="0" aria-label="${escapeHtml(b.title)}, ${timeLabel(b.time,true)}, ${b.duration} minutes, ${status}. Enter to edit; Alt and arrow keys to reschedule." style="top:${top}px;height:${height}px;left:${lane/lanes*100}%;width:calc(${100/lanes}% - 5px);${b.cat?`border-left-color:${escapeHtml(state.categories.find((c)=>c.id===b.cat)?.color||'var(--accent)')}`:''}"><strong>${b.protected?icon('shield'):status==='completed'?icon('check'):''} ${escapeHtml(b.title)}</strong>${height>=47?`<p>${timeLabel(b.time)} · ${formatDuration(b.duration)}${status==='missed'?' · Needs a new home':''}</p>`:''}<div class="event-actions">${!b.protected?`<button class="icon-btn" data-block-toggle="${escapeHtml(b.id)}" aria-label="Complete ${escapeHtml(b.title)}">${icon('check')}</button><button class="icon-btn" data-event-edit="${escapeHtml(b.id)}" aria-label="Edit ${escapeHtml(b.title)}">${icon('edit')}</button>${!b.taskId?`<button class="icon-btn" data-event-delete="${escapeHtml(b.id)}" aria-label="Remove ${escapeHtml(b.title)}">${icon('close')}</button>`:''}`:''}</div></div>`
}
function weekHtml() {
  const days=weekDates(selectedDate,state.settings.weekStart)
  return `<div class="calendar-scroll"><div class="week-grid">${days.map((date)=>`<div class="week-day ${date===currentDayKey()?'is-today':''}"><button class="week-day-head" style="width:100%;border-top:0;border-left:0;border-right:0" data-week-day="${date}"><span>${formatKeyLabel(date).split(',')[0]}</span><strong>${Number(date.slice(8))}</strong></button><div class="week-day-body" data-drop-date="${date}">${scheduleFor(state,date).map((b)=>`<button class="week-event" draggable="true" data-week-event="${escapeHtml(b.id)}" data-week-date="${date}" style="${itemDone(state,b,date)?'opacity:.5':''}"><span>${timeLabel(b.time)} · ${b.duration}m</span><strong>${escapeHtml(b.title)}</strong></button>`).join('')||'<p class="meta" style="padding:12px 3px;font-size:9px">A little breathing room.</p>'}</div></div>`).join('')}</div></div>`
}
function listHtml(blocks) { return blocks.length?blocks.map((b)=>`<div class="tt-row ${itemDone(state,b,selectedDate)?'tt-done':''}"><span class="tt-time">${timeLabel(b.time)}</span><button class="block-details text-left" data-event-edit="${escapeHtml(b.id)}"><span class="tt-title">${escapeHtml(b.title)}</span><span class="meta" style="display:block;margin-top:4px">${formatDuration(b.duration)} · ${blockState(state,b,selectedDate)}</span></button><button class="task-check ${itemDone(state,b,selectedDate)?'checked':''}" data-block-toggle="${escapeHtml(b.id)}" aria-label="Toggle ${escapeHtml(b.title)}">${icon('check')}</button></div>`).join(''):empty('calendar','A fresh calendar.','Add a mission or plan your day to get started.',`<button class="btn-primary" data-common="plan">${icon('sun')}Plan my day</button>`) }
function editEvent(id) { const item=scheduleFor(state,selectedDate).find((b)=>b.id===id);if(item?.taskId)window.CC.openTaskModal(item.taskId);else if(item)openScheduleBlockModal(item,selectedDate) }
export function toggleScheduleItem(id,date=currentDayKey()) {
  const blocks=scheduleFor(state,date), item=blocks.find((b)=>b.id===id);if(!item)return
  const done=!itemDone(state,item,date)
  if(item.taskId){window.CC.toggleMission(item.taskId)}
  else if(item.kind==='routine'&&item.routineId&&item.activityId){commit((s)=>toggleActivity(s,item.routineId,item.activityId,date));toast(done?'Activity checked in.':'Check-in reopened.','success')}
  else {
    commit((s)=>{const log=s.completionLog[date]||(s.completionLog[date]={ttDone:[],taskDone:[]});const key=item.sourceId||item.id;log.ttDone=log.ttDone.filter((x)=>x!==key);if(done)log.ttDone.push(key)})
    if(Array.isArray(state.schedule.days[date]))saveDay(date,blocks.map((b)=>b.id===id?{...b,status:done?'completed':'planned'}:b),'', {undoable:false})
    toast(done?'Time block complete.':'Time block reopened.',done?'success':'info')
  }
}
async function commitMove(date,blocks,label) {
  const conflicts=scheduleConflicts(blocks,state.settings.protectedTime,date)
  if(conflicts.length&&!await confirmDialog({title:'Keep this overlapping time?',message:`${conflicts[0].label}. You can keep both commitments, but they overlap. Protected time is never removed.`,confirmText:'Keep this time'}))return false
  saveDay(date,blocks,label);return true
}
function moveEvent(id,date,delta) { const blocks=scheduleFor(state,date), item=blocks.find((b)=>b.id===id);if(!item||item.protected)return;const start=Math.max(0,Math.min(1425,minutesOfDay(item.time)+delta));void commitMove(date,blocks.map((b)=>b.id===id?{...b,time:toHHMM(start)}:b),`Moved to ${timeLabel(toHHMM(start),true)}`) }
async function transferEvent(id,from,to) {
  if(!id||!from||!to)return
  const item=scheduleFor(state,from).find((b)=>b.id===id);if(!item||item.protected)return
  if(item.taskId){postponeMission(id.startsWith('task:')?id.slice(5):item.taskId,to);return}
  const next=scheduleFor(state,to)
  if(next.some((b)=>b.id===id)){toast('This block is already on that day.','info');return}
  const ok=await commitMove(to,[...next,{...item,status:'planned'}],`Moved to ${formatKeyLabel(to)}`)
  if(ok&&from!==to)saveDay(from,scheduleFor(state,from).filter((b)=>b.id!==id),'',{undoable:false})
}
function attachPointerDrag(node,startHour) {
  let initial=null, moved=false
  node.addEventListener('pointerdown',(e)=>{if(e.pointerType!=='mouse'||e.button!==0||e.target.closest('button'))return;const item=scheduleFor(state,selectedDate).find((b)=>b.id===node.dataset.event);if(!item||item.protected)return;initial={y:e.clientY,time:minutesOfDay(item.time)};moved=false;node.setPointerCapture(e.pointerId)})
  node.addEventListener('pointermove',(e)=>{if(!initial)return;const dy=e.clientY-initial.y;if(Math.abs(dy)<6&&!moved)return;moved=true;node.dataset.dragged='true';node.classList.add('is-dragging');node.style.transform=`translateY(${Math.round(dy/16)*16}px)`})
  node.addEventListener('pointerup',(e)=>{if(!initial)return;const delta=Math.round((e.clientY-initial.y)/16)*15;initial=null;node.classList.remove('is-dragging');node.style.transform='';if(moved&&delta){moveEvent(node.dataset.event,selectedDate,delta)}setTimeout(()=>delete node.dataset.dragged,100)})
  node.addEventListener('pointercancel',()=>{initial=null;node.classList.remove('is-dragging');node.style.transform='';delete node.dataset.dragged})
}

export function openScheduleBlockModal(item=null,date=currentDayKey()) {
  openModal({title:item?'Edit time block':'Make space in your day',body:`<form id="schedule-block-form" class="form-stack"><div><label class="field-label" for="block-name">Title</label><input class="input-field" id="block-name" required maxlength="160" value="${escapeHtml(item?.title||'')}" placeholder="A focused block, a break, a commitment…"></div><div class="form-grid"><div><label class="field-label" for="block-date">Date</label><input class="input-field" id="block-date" type="date" required value="${date}"></div><div><label class="field-label" for="block-start">Start time</label><input class="input-field" id="block-start" type="time" required value="${item?.time||state.settings.workingHours.start}"></div></div><div class="form-grid"><div><label class="field-label" for="block-length">Duration · minutes</label><input class="input-field" id="block-length" type="number" min="5" max="600" step="5" required value="${item?.duration||30}"></div><div><label class="field-label" for="block-category">Category</label><select class="input-field" id="block-category">${categoryOptions(item?.cat)}</select></div></div><label class="check-label"><input id="block-protected" type="checkbox" ${item?.protected?'checked':''}>Protect this time from automatic scheduling</label><label class="check-label"><input id="block-flexible" type="checkbox" ${item?.flexible!==false?'checked':''}>Allow this block to move when plans change</label><p class="form-hint">This creates a dated block. Your recurring study-plan templates stay unchanged.</p><div class="form-footer">${item?'<button type="button" class="btn-ghost" data-extend-block>+15 minutes</button>':''}<button type="button" class="btn-ghost" data-modal-close>Cancel</button><button type="submit" class="btn-primary">${item?'Save changes':'Add time block'}</button></div></form>`,onMount:(box)=>{
    box.querySelector('form').addEventListener('submit',(e)=>{e.preventDefault();const day=box.querySelector('#block-date').value;const blocks=scheduleFor(state,day);const next={...(item||{}),id:item?.id||uid(),title:box.querySelector('#block-name').value.trim(),time:box.querySelector('#block-start').value,duration:Number(box.querySelector('#block-length').value),cat:box.querySelector('#block-category').value||null,protected:box.querySelector('#block-protected').checked,flexible:box.querySelector('#block-flexible').checked,kind:box.querySelector('#block-protected').checked?'protected':'mission',status:item?.status||'planned'};if(!next.title)return;const result=item?blocks.map((b)=>b.id===item.id?next:b):[...blocks,next];void commitMove(day,result,item?'Time block updated':'Time block added').then((ok)=>{if(ok){if(item&&day!==date)saveDay(date,scheduleFor(state,date).filter((b)=>b.id!==item.id),'',{undoable:false});selectedDate=day;closeModal();renderSchedule()}})})
    box.querySelector('[data-extend-block]')?.addEventListener('click',()=>{const result=extendSchedule(scheduleFor(state,date),item.id,15,date,state.settings.protectedTime);void commitMove(date,result.items,`${result.moved.length} flexible block${result.moved.length===1?'':'s'} moved. Protected time preserved.`).then((ok)=>{if(ok)closeModal()})})
  }})
}

export function openRescheduleModal(id) {
  const task=state.tasks.find((t)=>t.id===id);if(!task)return
  openModal({title:'Find a better time.',body:`<p class="section-sub" style="margin-bottom:20px">${escapeHtml(task.title)}</p><form id="reschedule-form" class="form-stack"><div class="form-grid"><div><label class="field-label" for="reschedule-date">Date</label><input id="reschedule-date" class="input-field" type="date" required value="${task.date||currentDayKey()}"></div><div><label class="field-label" for="reschedule-time">Start time · optional</label><input id="reschedule-time" class="input-field" type="time" value="${task.time||''}"></div></div><p class="form-hint">The original date stays in this mission’s history. Nothing is lost by making a realistic adjustment.</p><div class="form-footer"><button type="button" class="btn-ghost" data-skip-skip>Skip mission</button><button type="button" class="btn-ghost" data-move-tomorrow>Tomorrow</button><button class="btn-primary" type="submit">Reschedule</button></div></form>`,onMount:(box)=>{
    const move=(date)=>{postponeMission(id,date);const time=box.querySelector('#reschedule-time').value||null;commit((s)=>{const t=s.tasks.find((t)=>t.id===id);t.time=time});closeModal()}
    box.querySelector('form').addEventListener('submit',(e)=>{e.preventDefault();move(box.querySelector('#reschedule-date').value)})
    box.querySelector('[data-move-tomorrow]').addEventListener('click',()=>move(addDays(currentDayKey(),1)))
    box.querySelector('[data-skip-skip]').addEventListener('click',()=>{skipMission(id);closeModal()})
  }})
}
