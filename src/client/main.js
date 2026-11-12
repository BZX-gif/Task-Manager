import { closeModal, isModalOpen, openModal, escapeHtml, toast } from './core/dom.js'
import { on } from './core/bus.js'
import { announceStatus, commit, currentDayKey, ensureRecurringOccurrences, initStore, state, streak, syncScoreHistory, titlesInfo, disciplineStreak, todayStats, flush } from './core/store.js'
import { addToTop3, removeFromTop3, getTop3Ids, setTop3Ids } from './lib/top3.js'
import { describeScoreFormula } from './lib/score.js'
import { initRouter, refreshCurrentView, switchView, getCurrentView } from './ui/router.js'
import { bindChrome, footerVersion, refreshFocusChip, refreshStreakWidget, renderQuoteInline, startChromeTimers, toggleMobileNav, openCommandPalette, updateClockAndGreeting } from './ui/chrome.js'
import { dayStatus } from './ui/status.js'
import { completeFocus, hasRunningSession, initFocus, openFocusMode, pauseFocus, resumeFocus, stopFocus } from './ui/focus.js'
import { handleChatKey, sendMessage, runLocalCommand } from './views/assistant.js'
import { openQuickCapture, isQuickCaptureOpen, closeQuickCapture } from './ui/quickcapture.js'
import { checkReminders, startReminderRunner } from './ui/reminders-runner.js'
import { initPwa } from './ui/pwa.js'
import { openTaskModal } from './views/tasks.js'
import { openWeeklyReview } from './views/review.js'
import { openDayPlanner, openRecoveryModal } from './views/planner.js'
import { openGoalModal, openGoalDetail } from './views/goals.js'
import { openProjectModal, openProjectDetail } from './views/projects.js'
import { openRoutineModal } from './views/routines.js'
import { openRescheduleModal, toggleScheduleItem } from './views/schedule.js'
import { openFocusRoom, paintFocusRoom, exitFocusFullscreen, isFocusFullscreen } from './views/focus-room.js'
import { toggleMission, applyTheme } from './core/actions.js'
import { handleTitlesUnlocked } from './ui/titles.js'
import { icon } from './ui/icons.js'

const APP_VERSION='3.0'
function refreshAll(){refreshStreakWidget();refreshFocusChip();refreshCurrentView()}
function streakInfo(){const result=streak();return{...result,recent:result.recent.map((day)=>({...day,status:dayStatus(state,day.dateKey).status}))}}
function disciplineInfo(){return disciplineStreak()}
function titles(){return titlesInfo()}
function addTaskToTop3(taskId){
  /** @type {any} */
  let result={ok:false,reason:'Mission not found.',ids:[]};commit((s)=>{result=addToTop3(s,currentDayKey(),taskId)});return result}
function movePriority(id,direction){const date=currentDayKey();commit((s)=>{const ids=getTop3Ids(s,date),index=ids.indexOf(id),next=index+Number(direction);if(index<0||next<0||next>=ids.length)return;[ids[index],ids[next]]=[ids[next],ids[index]];setTop3Ids(s,date,ids)});return true}
function openScoreInfo(){const stats=todayStats();openModal({title:'A number with nothing hidden.',body:`<p class="section-sub" style="margin-bottom:20px">Your execution score reflects the commitments you chose. It is not a measure of your worth.</p><div class="score-formula">${stats.scoreParts.map((p)=>`<div><span>${icon(p.key==='tasks'?'missions':p.key==='top3'?'target':p.key==='focus'?'focus':'calendar')}<strong>${p.label}</strong></span><span>${p.available?`${p.detail} · ${p.contribution}/${p.maxContribution} points`:'No data · excluded'}</span><div class="progress-track"><div class="progress-fill" style="width:${p.maxContribution?p.contribution/p.maxContribution*100:0}%"></div></div></div>`).join('')}</div><div class="notice" style="margin-top:20px">${icon('info')}<span>${describeScoreFormula().map(escapeHtml).join('<br>')}</span></div><p class="form-hint" style="margin-top:16px">Today: ${stats.hasData?stats.score+'/100':'not enough activity for a meaningful score'}. ${stats.penalty?`${stats.penalty} points reflect overdue missions (capped at 15).`:''} Components with no data are excluded and remaining weights are redistributed. Future time blocks aren’t counted against you.</p><div class="form-footer"><button class="btn-primary" data-modal-close>That makes sense</button></div>`})}
window.CC = {
  version:APP_VERSION,
  switchView,
  refreshAll,
  refreshCurrentView,
  openTaskModal,
  openQuickCapture,
  closeQuickCapture,
  openWeeklyReview,
  openRecoveryModal,
  openDayPlanner,
  openGoalModal,
  openGoalDetail,
  openProjectModal,
  openProjectDetail,
  openRoutineModal,
  openRescheduleModal,
  openFocusRoom,
  openScoreInfo,
  openCommandPalette,
  closeModal,
  toggleMission,
  movePriority,
  toggleScheduleItem,
  removeFromTop3(taskId){commit((s)=>removeFromTop3(s,currentDayKey(),taskId));return true},
  openFocusMode,
  pauseFocus,
  resumeFocus,
  stopFocus,
  completeFocus,
  hasRunningSession,
  addTaskToTop3,
  streakInfo,
  disciplineInfo,
  titles,
  todayKey:currentDayKey,
  getState:()=>state,
  askAI:(text)=>{switchView('assistant');const input=/** @type {any} */(document.getElementById('chat-input'));if(input)input.value=text;sendMessage(text)},
  handleChatKey,
  runLocalCommand,
  toggleMobileNav,
  checkReminders:()=>checkReminders(),
  refreshQuoteInline:renderQuoteInline,
}
function bindKeyboard(){document.addEventListener('keydown',(event)=>{const target=event.target,typing=target instanceof HTMLElement&&(target.tagName==='INPUT'||target.tagName==='TEXTAREA'||target.tagName==='SELECT'||target.isContentEditable);if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();if(event.shiftKey){if(document.getElementById('palette-query'))closeModal();else openCommandPalette()}else if(isQuickCaptureOpen())closeQuickCapture();else openQuickCapture();return}if(event.key==='Escape'){if(isFocusFullscreen()){exitFocusFullscreen();return}if(isModalOpen()){closeModal();return}}if(typing||isModalOpen()||document.querySelector('.focus-overlay'))return;if(!event.ctrlKey&&!event.metaKey&&event.key.toLowerCase()==='f'){event.preventDefault();openFocusRoom()}if(!event.ctrlKey&&!event.metaKey&&event.key.toLowerCase()==='n'){event.preventDefault();openQuickCapture()}if(!event.ctrlKey&&!event.metaKey&&/^[1-9]$/.test(event.key)){const views=['dashboard','day','schedule','tasks','goals','projects','routines','focus','progress'];switchView(views[Number(event.key)-1])}})}
let lastDay=currentDayKey(),reminderInterval=null,minuteInterval=null,recurrenceInterval=null
function boot(){
  initStore();ensureRecurringOccurrences(currentDayKey());lastDay=currentDayKey();applyTheme();startChromeTimers();bindChrome();initRouter();initFocus();initPwa();bindKeyboard()
  document.getElementById('quick-add-btn')?.addEventListener('click',()=>openTaskModal())
  document.getElementById('focus-mini-start')?.addEventListener('click',()=>openFocusRoom())
  document.getElementById('active-timer-chip')?.addEventListener('click',()=>openFocusMode())
  on('focus:tick',()=>{refreshFocusChip();paintFocusRoom()})
  on('store:change',()=>{refreshStreakWidget();refreshFocusChip();applyTheme()})
  on('titles:unlocked',(detail)=>handleTitlesUnlocked(detail))
  const persist=()=>{syncScoreHistory(currentDayKey());flush()};window.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')persist();else{updateClockAndGreeting();refreshCurrentView();checkReminders()}});window.addEventListener('pagehide',persist)
  document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&isFocusFullscreen())exitFocusFullscreen()})
  refreshAll();switchView('dashboard');reminderInterval=startReminderRunner();announceStatus();footerVersion(APP_VERSION)
  minuteInterval=setInterval(()=>{if(document.visibilityState!=='visible')return;const day=currentDayKey();if(day!==lastDay){lastDay=day;ensureRecurringOccurrences(day);syncScoreHistory(day);commit(()=>{},{immediate:true});return}if(!isModalOpen()&&!['settings','assistant','focus'].includes(getCurrentView())&&!document.querySelector('.calendar-event.is-dragging'))refreshCurrentView()},60000)
  recurrenceInterval=setInterval(()=>{const created=ensureRecurringOccurrences();if(created.length)commit(()=>{},{immediate:true})},3600000)
  const action=new URLSearchParams(location.search).get('action');if(action==='capture')openQuickCapture();if(action==='focus')openFocusRoom()
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot()
export {refreshAll,streakInfo}
