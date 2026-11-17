import { MOTIVATIONAL_QUOTES } from '../lib/defaults.js'
import { COMMANDS, SEARCH_KINDS, highlightMatch, searchCommands, searchWorkspace } from '../lib/search.js'
import { isDayClosed } from '../lib/shutdown.js'
import { greetingLine, salutationOf } from '../lib/briefing.js'
import { escapeHtml, el, closeModal, openModal, qsa, toast } from '../core/dom.js'
import { commit, currentDayKey, state } from '../core/store.js'
import { elapsedSeconds, remainingSeconds, sessionTotals } from '../lib/focus.js'
import { formatClock, formatDuration, formatKeyLabel } from '../lib/dates.js'
import { applyTheme } from '../core/actions.js'
import { icon } from './icons.js'
import { on } from '../core/bus.js'
import { VIEWS } from './router.js'

const VIEW_LABELS = {dashboard:'Overview',day:'My Day',schedule:'Schedule',tasks:'Missions',goals:'Goals',projects:'Projects',routines:'Routines',focus:'Focus Room',progress:'Analytics',review:'Weekly Review',journal:'Journal',forecast:'Forecast',assistant:'Planning assistant',settings:'Settings'}
let clockTimer=null, quoteTimer=null, mobileOpen=false, notificationsBound=false
const recentReminders=[]
export function userName(){return state.settings.userName?.trim()||''}
export function salutation(){return salutationOf(state)}
/** Time-aware, respectful greeting: "Good evening, Sir." */
export function greeting(now=new Date()){return greetingLine(state,now)}
export function updateClockAndGreeting(){
  const now=new Date(),format=state.settings.timeFormat||'12h'
  const text=(selector,value)=>{const node=el(selector);if(node&&node.textContent!==value)node.textContent=value}
  text('overview-greeting',greeting(now));text('greeting-text',greeting(now));text('command-strip-salute',`At your command, ${salutation()}.`)
  const clock=now.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:format==='12h'})
  text('live-clock',clock);text('overview-clock',clock)
  const avatar=document.querySelector('.brand-avatar'),initial=userName().charAt(0).toLocaleUpperCase()||'P'
  if(avatar&&avatar.textContent!==initial){avatar.textContent=initial;avatar.setAttribute('title',userName()||'Personal workspace')}
  const workspace=document.querySelector('.workspace-avatar');if(workspace)workspace.textContent=initial
  const date=document.querySelector('.date-day');if(date)date.textContent=now.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})
  const dayBar=document.getElementById('day-progress'),dayFill=document.getElementById('day-progress-fill')
  if(dayBar&&dayFill){const toMin=(t)=>{const p=String(t||'').split(':').map(Number);return (p[0]||0)*60+(p[1]||0)};const ws=state.settings.workingHours||{};const start=toMin(ws.start||'08:00');let end=toMin(ws.end||'20:00');if(end<=start)end=start+60;const pct=Math.max(0,Math.min(100,Math.round((now.getHours()*60+now.getMinutes()-start)/(end-start)*100)));dayFill.style.width=pct+'%';dayBar.setAttribute('role','img');dayBar.setAttribute('aria-label',pct+'% of your available hours used')}
}
export function rotateQuote(force=false){const node=el('quote-text');if(!node)return;const i=Math.floor(Math.random()*MOTIVATIONAL_QUOTES.length);if(!force&&node.dataset.index===String(i))return;node.dataset.index=String(i);node.textContent=MOTIVATIONAL_QUOTES[i]}
export function startChromeTimers(){updateClockAndGreeting();refreshRitualChip();if(clockTimer)clearInterval(clockTimer);clockTimer=setInterval(updateClockAndGreeting,1000);rotateQuote(true);if(quoteTimer)clearInterval(quoteTimer);quoteTimer=setInterval(()=>rotateQuote(),120000)}
/** The command strip's evening affordance: honest state, one click to close. */
export function refreshRitualChip(){
  const chip=el('ritual-chip'),label=el('ritual-chip-label');if(!chip||!label)return
  const today=currentDayKey(),closed=isDayClosed(state,today)
  const open=(state.tasks||[]).filter((task)=>task.date===today&&!task.done&&!task.inbox&&task.status!=='cancelled').length
  const next=closed?'Day closed':open?`Close the day · ${open} open`:'Close the day'
  if(label.textContent!==next)label.textContent=next
  chip.classList.toggle('is-closed',closed)
  chip.setAttribute('aria-label',closed?'The day is closed. Open the ritual to review or reopen it.':`Close the day${open?` — ${open} mission${open===1?'':'s'} still open`:''}`)
}
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
  qsa(document,'[data-close-day]').forEach((button)=>button.addEventListener('click',()=>{setMobileNav(false);window.CC.openShutdown()}))
  qsa(document,'[data-briefing-open]').forEach((button)=>button.addEventListener('click',()=>{setMobileNav(false);window.CC.openBriefing()}))
  el('mobile-menu-btn')?.addEventListener('click',()=>toggleMobileNav());el('mobile-more')?.addEventListener('click',()=>toggleMobileNav());el('mobile-nav-close')?.addEventListener('click',()=>setMobileNav(false))
  el('mobile-nav')?.addEventListener('click',(e)=>{if(e.target===el('mobile-nav'))setMobileNav(false)})
  el('notifications-btn')?.addEventListener('click',openNotifications)
  if(!notificationsBound){on('reminder',(r)=>{recentReminders.unshift({...r,at:Date.now()});recentReminders.splice(20);el('notification-dot')?.classList.remove('hidden')});notificationsBound=true}
  const online=()=>{const node=el('connection-label');if(node)node.textContent=navigator.onLine?'On this device':'Offline · saved locally'};window.addEventListener('online',online);window.addEventListener('offline',online);online()
  window.matchMedia?.('(prefers-color-scheme: light)')?.addEventListener?.('change',()=>{if(state.settings.theme==='system')applyTheme()})
  document.addEventListener('keydown',(e)=>{if(e.key==='Escape'&&mobileOpen)setMobileNav(false);if(e.key==='Tab'&&mobileOpen){const nodes=[...el('mobile-nav').querySelectorAll('button:not([disabled])')],first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}})
  applyTheme()
}
export function openShortcuts(){
  /** @type {Array<[string, Array<[string, string]>]>} */
  const groups=[
    ['Getting around',[['⌘K / Ctrl K','Quick capture'],['⇧⌘K','Command palette'],['1 – 9','Jump to a view'],['B','Today’s briefing'],['E','Close the day'],['J','Journal'],['O','Forecast'],['F','Focus Room'],['N','Quick capture'],['Esc','Close whatever is open']]],
    ['While writing',[['⌘Enter / Ctrl Enter','Save the open form'],['Tab','Move between fields'],['Esc','Cancel without saving']]],
  ]
  openModal({title:'Keyboard shortcuts',body:`<div class="shortcut-sheet">${groups.map(([label,rows])=>`<div class="shortcut-group"><p class="field-label">${escapeHtml(label)}</p>${rows.map(([keys,what])=>`<div class="shortcut-row"><span>${escapeHtml(what)}</span><span>${keys.split(' / ').flatMap((part)=>part.split(' ')).filter(Boolean).map((part)=>/^[⌘⇧⌥]$/.test(part)?`<kbd class="kbd">${part}</kbd>`:`<kbd class="kbd">${escapeHtml(part)}</kbd>`).join('')}</span></div>`).join('')}</div>`).join('')}</div><p class="form-hint" style="margin-top:16px">Shortcuts pause while you are typing, so nothing fires mid-sentence.</p><div class="form-footer"><button class="btn-primary" data-modal-close>Got it</button></div>`})
}

export function openCommandPalette(){
  const today = currentDayKey()
  const viewCommands = Object.entries(VIEW_LABELS).filter(([key]) => VIEWS.includes(key)).map(([key, title]) => ({ id: `view-${key}`, title: `Go to ${title}`, subtitle: 'View', icon: key === 'dashboard' ? 'overview' : key === 'tasks' ? 'missions' : key === 'progress' ? 'analytics' : key, action: 'view', view: key }))
  const actionFor = (action) => {
    const cc = window.CC
    if (action === 'capture') cc.openQuickCapture()
    else if (action === 'new-mission') cc.openTaskModal()
    else if (action === 'plan') cc.openDayPlanner()
    else if (action === 'recover') cc.openRecoveryModal()
    else if (action === 'close-day') cc.openShutdown()
    else if (action === 'briefing') cc.openBriefing()
    else if (action === 'export-calendar') cc.exportCalendar({ days: 14 })
    else if (action === 'print-day') cc.openPrintSheet(today)
    else if (action === 'shortcuts') openShortcuts()
  }
  const openResult = (item) => {
    closeModal()
    const cc = window.CC
    if (item.kind === 'mission') cc.openTaskModal(item.id)
    else if (item.kind === 'goal') cc.openGoalDetail(item.id)
    else if (item.kind === 'project') cc.openProjectDetail(item.id)
    else if (item.kind === 'routine') cc.openRoutineModal(item.id)
    else if (item.kind === 'journal') cc.switchView('journal')
  }
  const recentMissions = [...state.tasks].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 5)

  openModal({ title: 'Find your next move', body: `<div class="command-palette"><div class="toolbar-search">${icon('search')}<input class="input-field" id="palette-query" placeholder="Search missions, notes, journal, or a command…" autocomplete="off" aria-label="Search your workspace" role="combobox" aria-expanded="true" aria-controls="palette-results"></div><div id="palette-results" role="listbox" class="palette-results"></div><p class="form-hint palette-hint">↑ ↓ to move · Enter to open · Esc to close · <kbd class="kbd">⌘</kbd><kbd class="kbd">K</kbd> anytime</p></div>`, onMount: (box) => {
    const input = box.querySelector('#palette-query')
    const list = box.querySelector('#palette-results')
    let active = 0
    let flat = []

    const commandGroup = (query) => {
      const matches = searchCommands(query, COMMANDS).slice(0, query ? 4 : 6)
      return matches.length ? [{ kind: 'commands', label: query ? 'Actions' : 'At your command', icon: 'bolt', entries: matches.map((command) => ({ type: 'command', ...command })) }] : []
    }
    const viewGroup = (query) => {
      if (!query) return []
      const matches = searchCommands(query, viewCommands).slice(0, 3)
      return matches.length ? [{ kind: 'views', label: 'Go to', icon: 'overview', entries: matches.map((command) => ({ type: 'command', ...command })) }] : []
    }
    const recentGroup = (query) => {
      if (query || !recentMissions.length) return []
      return [{ kind: 'recent', label: 'Continue where you left off', icon: 'clock', entries: recentMissions.map((task) => ({ type: 'result', kind: 'mission', id: task.id, title: task.title, subtitle: task.done ? 'Completed mission' : task.inbox ? 'Inbox' : task.date || 'No date', icon: 'missions' })) }]
    }

    const render = () => {
      const query = input.value.trim()
      const search = query ? searchWorkspace(state, query, { limit: 24 }) : { groups: [] }
      const groups = [
        ...commandGroup(query),
        ...search.groups.map((group) => ({ kind: group.kind, label: group.label, icon: group.icon, entries: group.items.map((item) => ({ type: 'result', ...item })) })),
        ...viewGroup(query),
        ...recentGroup(query),
      ]
      flat = groups.flatMap((group) => group.entries)
      active = Math.max(0, Math.min(active, flat.length - 1))
      if (!flat.length) {
        list.innerHTML = `<div class="empty-state">${icon('search')}<p>No matches, yet.</p><p>Press Enter to capture “${escapeHtml(query)}” as a mission. Nothing is lost.</p></div>`
        return
      }
      let index = 0
      list.innerHTML = groups.map((group) => `<div class="palette-group"><p class="palette-group-label">${icon(group.icon)}${escapeHtml(group.label)}<span>${group.entries.length}</span></p>${group.entries.map((entry) => {
        const current = index++
        if (entry.type === 'command') {
          return `<button class="palette-result ${current === active ? 'is-active' : ''}" data-result="${current}" role="option" aria-selected="${current === active}"><span class="palette-result-icon">${icon(entry.icon)}</span><span class="palette-result-copy"><strong>${highlightMatch(entry.title, query)}</strong><small>${escapeHtml(entry.subtitle)}</small></span><kbd class="palette-enter">↵</kbd></button>`
        }
        return `<button class="palette-result ${current === active ? 'is-active' : ''} ${entry.done ? 'is-done' : ''}" data-result="${current}" role="option" aria-selected="${current === active}"><span class="palette-result-icon">${icon(SEARCH_KINDS[entry.kind]?.icon || 'search')}</span><span class="palette-result-copy"><strong>${highlightMatch(entry.title, query)}</strong><small>${escapeHtml(entry.snippet ? `${entry.subtitle} — ${entry.snippet}` : entry.subtitle)}</small></span>${icon('arrow')}</button>`
      }).join('')}</div>`).join('')
      try { list.querySelector('.is-active')?.scrollIntoView?.({ block: 'nearest' }) } catch { /* jsdom */ }
    }

    const select = (index) => {
      const entry = flat[index]
      if (!entry) {
        const text = input.value.trim()
        if (text) { closeModal(); window.CC.openQuickCapture({ prefill: text }) }
        return
      }
      if (entry.type === 'command') {
        closeModal()
        if (entry.action === 'view') window.CC.switchView(entry.view)
        else actionFor(entry.action)
      } else openResult(entry)
    }

    render()
    input.focus()
    // Delegated: results are re-rendered on every keystroke.
    list.addEventListener('click', (event) => {
      const button = event.target.closest('[data-result]')
      if (button) select(Number(button.dataset.result))
    })
    input.addEventListener('input', () => { active = 0; render() })
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        if (!flat.length) return
        active = (active + (event.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length
        render()
      }
      if (event.key === 'Enter') { event.preventDefault(); select(active) }
    })
  }})
}
export function openNotifications(){
  el('notification-dot')?.classList.add('hidden')
  openModal({title:'A gentle nudge',body:`<p class="section-sub" style="margin-bottom:20px">Only the reminders you asked for. Nothing to catch up on, nothing to feel behind about.</p>${recentReminders.length?recentReminders.map((r)=>`<article class="notification-item">${icon(r.kind==='routine'?'routines':r.kind==='overdue'?'recover':'bell')}<div><strong>${escapeHtml(r.title)}</strong><p>${escapeHtml(r.body)}</p><small>${new Date(r.at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</small></div></article>`).join(''):`<div class="empty-state">${icon('bell')}<p>A quiet moment.</p><p>New reminders will appear here while your workspace is open.</p></div>`}<div class="form-footer"><button class="btn-ghost" data-reminder-settings>${icon('settings')}Reminder preferences</button><button class="btn-primary" data-modal-close>All clear</button></div>`,onMount:(box)=>box.querySelector('[data-reminder-settings]').addEventListener('click',()=>{closeModal();window.CC.switchView('settings');setTimeout(()=>document.getElementById('settings-reminders')?.scrollIntoView({behavior:'smooth'}),80)})})
}
