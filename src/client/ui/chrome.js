import { MOTIVATIONAL_QUOTES } from '../lib/defaults.js'
import { escapeHtml, el, closeModal, openModal, toast } from '../core/dom.js'
import { commit, currentDayKey, state } from '../core/store.js'
import { elapsedSeconds, remainingSeconds, sessionTotals } from '../lib/focus.js'
import { formatClock, formatDuration, formatKeyLabel } from '../lib/dates.js'
import { applyTheme } from '../core/actions.js'
import { icon } from './icons.js'
import { on } from '../core/bus.js'
import { VIEWS } from './router.js'

const VIEW_LABELS = {dashboard:'Overview',day:'My Day',schedule:'Schedule',tasks:'Missions',goals:'Goals',projects:'Projects',routines:'Routines',focus:'Focus Room',progress:'Analytics',review:'Weekly Review',assistant:'Planning assistant',settings:'Settings'}
let clockTimer=null, quoteTimer=null, mobileOpen=false, notificationsBound=false
const recentReminders=[]
export function userName(){return state.settings.userName?.trim()||''}
export function greeting(now=new Date()){const hour=now.getHours();const phrase=hour<5?'A quiet moment':hour<12?'Good morning':hour<17?'Good afternoon':hour<21?'Good evening':'Time to wind down';return `${phrase}${userName()?', '+userName():''}.`}
export function updateClockAndGreeting(){
  const now=new Date(),format=state.settings.timeFormat||'12h'
  const text=(selector,value)=>{const node=el(selector);if(node&&node.textContent!==value)node.textContent=value}
  text('overview-greeting',greeting(now));text('greeting-text',greeting(now))
  const clock=now.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:format==='12h'})
  text('live-clock',clock);text('overview-clock',clock)
  const avatar=document.querySelector('.brand-avatar'),initial=userName().charAt(0).toLocaleUpperCase()||'P'
  if(avatar&&avatar.textContent!==initial){avatar.textContent=initial;avatar.setAttribute('title',userName()||'Personal workspace')}
  const workspace=document.querySelector('.workspace-avatar');if(workspace)workspace.textContent=initial
  const date=document.querySelector('.date-day');if(date)date.textContent=now.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})
}
export function rotateQuote(force=false){const node=el('quote-text');if(!node)return;const i=Math.floor(Math.random()*MOTIVATIONAL_QUOTES.length);if(!force&&node.dataset.index===String(i))return;node.dataset.index=String(i);node.textContent=MOTIVATIONAL_QUOTES[i]}
export function startChromeTimers(){updateClockAndGreeting();if(clockTimer)clearInterval(clockTimer);clockTimer=setInterval(updateClockAndGreeting,1000);rotateQuote(true);if(quoteTimer)clearInterval(quoteTimer);quoteTimer=setInterval(()=>rotateQuote(),120000)}
export function refreshStreakWidget(){const node=el('focus-mini-time');if(node)node.textContent=formatDuration(sessionTotals(state.focus.sessions,currentDayKey()).focusedMinutes);const workspace=document.querySelector('.workspace-label strong');if(workspace)workspace.textContent=userName()?`${userName()}’s workspace`:'Personal workspace'}
export function refreshFocusChip(){const chip=el('active-timer-chip'),text=el('active-timer-chip-text');if(!chip||!text)return;const session=state.focus?.active;chip.classList.toggle('hidden',!session);chip.classList.toggle('is-paused',!!session&&!session.running);if(!session)return;const now=Date.now();text.textContent=session.running?formatClock(session.mode==='stopwatch'?elapsedSeconds(session,now):remainingSeconds(session,now)):'Paused';chip.title=session.mode==='break'?'Recharge session':session.mode==='stopwatch'?'Stopwatch session':'Focus session';chip.setAttribute('aria-label',`${session.running?'Open':'Resume'} ${session.mode} session, ${text.textContent}`)}
export function renderQuoteInline(){rotateQuote(true)}
export function setMobileNav(open){mobileOpen=!!open;const nav=el('mobile-nav');if(!nav)return;nav.classList.toggle('hidden',!open);el('mobile-menu-btn')?.setAttribute('aria-expanded',String(!!open));document.body.classList.toggle('mobile-nav-open',!!open);if(open)nav.querySelector('.nav-item')?.focus();else el('mobile-menu-btn')?.focus({preventScroll:true})}
export function toggleMobileNav(){setMobileNav(!mobileOpen)}
export function footerVersion(version){const node=document.getElementById('app-version');if(node)node.textContent=`v${version}`}
export function updateBreadcrumb(view){const label=el('breadcrumb-current');if(label)label.textContent=VIEW_LABELS[view]||'Overview';document.title=`${VIEW_LABELS[view]||'Overview'} · Command`}
export function bindChrome(){
  el('sidebar-collapse')?.addEventListener('click',()=>{commit((s)=>s.settings.sidebarCollapsed=!s.settings.sidebarCollapsed,{silent:true,immediate:true});applyTheme();el('sidebar-collapse')?.setAttribute('aria-expanded',String(!state.settings.sidebarCollapsed));el('sidebar-collapse')?.setAttribute('aria-label',state.settings.sidebarCollapsed?'Expand sidebar':'Collapse sidebar')})
  el('theme-toggle')?.addEventListener('click',()=>{commit((s)=>s.settings.theme=document.documentElement.dataset.theme==='light'?'dark':'light',{silent:true,immediate:true});applyTheme();el('theme-toggle').innerHTML=icon(document.documentElement.dataset.theme==='light'?'moon':'sun')})
  el('command-search')?.addEventListener('click',openCommandPalette)
  el('mobile-menu-btn')?.addEventListener('click',()=>toggleMobileNav());el('mobile-more')?.addEventListener('click',()=>toggleMobileNav());el('mobile-nav-close')?.addEventListener('click',()=>setMobileNav(false))
  el('mobile-nav')?.addEventListener('click',(e)=>{if(e.target===el('mobile-nav'))setMobileNav(false)})
  el('notifications-btn')?.addEventListener('click',openNotifications)
  if(!notificationsBound){on('reminder',(r)=>{recentReminders.unshift({...r,at:Date.now()});recentReminders.splice(20);el('notification-dot')?.classList.remove('hidden')});notificationsBound=true}
  const online=()=>{const node=el('connection-label');if(node)node.textContent=navigator.onLine?'On this device':'Offline · saved locally'};window.addEventListener('online',online);window.addEventListener('offline',online);online()
  window.matchMedia?.('(prefers-color-scheme: light)')?.addEventListener?.('change',()=>{if(state.settings.theme==='system')applyTheme()})
  document.addEventListener('keydown',(e)=>{if(e.key==='Escape'&&mobileOpen)setMobileNav(false);if(e.key==='Tab'&&mobileOpen){const nodes=[...el('mobile-nav').querySelectorAll('button:not([disabled])')],first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}})
  applyTheme()
}
export function openCommandPalette(){
  /** @type {any[]} */ const commands=Object.entries(VIEW_LABELS).filter(([key])=>VIEWS.includes(key)).map(([key,title])=>({key,title,subtitle:'Go to '+title,icon:key==='dashboard'?'overview':key==='tasks'?'missions':key==='progress'?'analytics':key==='review'?'review':key==='settings'?'settings':key,view:key}))
  commands.push({key:'new',title:'Create a mission',subtitle:'A clear next step',icon:'plus',action:()=>window.CC.openTaskModal()},{key:'capture',title:'Quick capture',subtitle:'Get it out of your head',icon:'inbox',action:()=>window.CC.openQuickCapture()},{key:'plan',title:'Plan my day',subtitle:'Review a realistic proposal',icon:'sun',action:()=>window.CC.openDayPlanner()},{key:'recover',title:'Recover my day',subtitle:'Start again without losing your work',icon:'recover',action:()=>window.CC.openRecoveryModal()})
  const results=[...commands,...state.tasks.map((t)=>({key:t.id,title:t.title,subtitle:`Mission · ${t.done?'Completed':t.date?formatKeyLabel(t.date):'Inbox'}`,icon:'missions',action:()=>window.CC.openTaskModal(t.id)})),...state.goals.map((g)=>({key:g.id,title:g.title,subtitle:'Goal · '+g.category,icon:'target',action:()=>window.CC.openGoalDetail(g.id)})),...state.projects.map((p)=>({key:p.id,title:p.title,subtitle:'Project',icon:'projects',action:()=>window.CC.openProjectDetail(p.id)})),...state.routines.filter((r)=>!r.archived).map((r)=>({key:r.id,title:r.title,subtitle:'Routine',icon:'routines',action:()=>window.CC.openRoutineModal(r.id)}))]
  openModal({title:'Find your next move',body:`<div class="command-palette"><div class="toolbar-search">${icon('search')}<input class="input-field" id="palette-query" placeholder="Search missions, goals, or commands…" autocomplete="off" aria-label="Search your workspace" role="combobox" aria-expanded="true" aria-controls="palette-results"></div><div id="palette-results" role="listbox"></div><p class="form-hint" style="margin-top:14px">↑ ↓ to move · Enter to open · Esc to close</p></div>`,onMount:(box)=>{
    const input=box.querySelector('#palette-query'),list=box.querySelector('#palette-results');let active=0,matches=[]
    const render=()=>{const query=input.value.trim().toLowerCase();matches=results.filter((r)=>`${r.title} ${r.subtitle}`.toLowerCase().includes(query)).slice(0,query?16:10);active=Math.min(active,Math.max(0,matches.length-1));list.innerHTML=matches.length?matches.map((r,i)=>`<button class="palette-result ${i===active?'is-active':''}" data-result="${i}" role="option" aria-selected="${i===active}">${icon(r.icon)}<span><strong>${escapeHtml(r.title)}</strong><small>${escapeHtml(r.subtitle)}</small></span>${icon('arrow')}</button>`).join(''):`<div class="empty-state">${icon('search')}<p>No matches, yet.</p><p>Try another word, or press Enter to capture this as a mission.</p></div>`;list.querySelectorAll('[data-result]').forEach((b)=>b.addEventListener('click',()=>select(Number(b.dataset.result))))}
    const select=(i)=>{const match=matches[i];closeModal();if(match?.view)window.CC.switchView(match.view);else match?.action?.()};render();input.focus()
    input.addEventListener('input',()=>{active=0;render()});input.addEventListener('keydown',(e)=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();active=Math.max(0,Math.min(matches.length-1,active+(e.key==='ArrowDown'?1:-1)));render()}if(e.key==='Enter'){e.preventDefault();if(matches.length)select(active);else{const text=input.value.trim();closeModal();window.CC.openQuickCapture({prefill:text})}}})
  }})
}
export function openNotifications(){
  el('notification-dot')?.classList.add('hidden')
  openModal({title:'A gentle nudge',body:`<p class="section-sub" style="margin-bottom:20px">Only the reminders you asked for. Nothing to catch up on, nothing to feel behind about.</p>${recentReminders.length?recentReminders.map((r)=>`<article class="notification-item">${icon(r.kind==='routine'?'routines':r.kind==='overdue'?'recover':'bell')}<div><strong>${escapeHtml(r.title)}</strong><p>${escapeHtml(r.body)}</p><small>${new Date(r.at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</small></div></article>`).join(''):`<div class="empty-state">${icon('bell')}<p>A quiet moment.</p><p>New reminders will appear here while your workspace is open.</p></div>`}<div class="form-footer"><button class="btn-ghost" data-reminder-settings>${icon('settings')}Reminder preferences</button><button class="btn-primary" data-modal-close>All clear</button></div>`,onMount:(box)=>box.querySelector('[data-reminder-settings]').addEventListener('click',()=>{closeModal();window.CC.switchView('settings');setTimeout(()=>document.getElementById('settings-reminders')?.scrollIntoView({behavior:'smooth'}),80)})})
}
