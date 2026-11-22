import { state, currentDayKey, todayStats, statsFor } from '../core/store.js'
import { confirmDialog, escapeHtml, qs, qsa } from '../core/dom.js'
import { addDays, formatDuration, minutesOfDay, weekdayShort, durationHtml } from '../lib/dates.js'
import { scheduleFor, blockState, itemDone } from '../lib/planner.js'
import { goalChain, goalProgress, taskProgress } from '../lib/relationships.js'
import { top3Stats, top3Candidates } from '../lib/top3.js'
import { overdueTasks, describeScoreFormula } from '../lib/score.js'
import { sessionTotals } from '../lib/focus.js'
import { drawChart, chartColors, alpha, vGrad } from '../core/charts.js'
import { icon, ring, empty, metric, timeLabel, bindCommon, domainTabs, DOMAIN_TABS } from '../ui/common.js'
import { buildWorkspaceContext } from '../lib/paper/context.js'
import { generateAlerts, generateRecommendations } from '../lib/paper/recommendations.js'
import { goalHealthAll } from '../lib/paper/reasoning.js'
import { updateClockAndGreeting } from '../ui/chrome.js'
import { greetingLine, intentionFor, salutationOf } from '../lib/briefing.js'
import { hybDay, toggleHybPlanDay } from '../core/hyb.js'
import { energyOf, kindOf } from '../lib/hyb.js'

const PRIORITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' }
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 }
let recoveryOpen = false

function overdueLabel(dateKey, todayKey) {
  if (!dateKey) return 'Earlier'
  const from = new Date(`${dateKey}T12:00:00`)
  const to = new Date(`${todayKey}T12:00:00`)
  const days = Math.max(0, Math.round((to.getTime() - from.getTime()) / 864e5))
  if (days <= 0) return 'Earlier'
  return days === 1 ? '1 day overdue' : `${days} days overdue`
}

function commandReason(source, relation) {
  const why =
    source === 'active' ? 'Scheduled right now — this is your window.' :
    source === 'top3' ? 'One of your three priorities for today.' :
    source === 'priority' ? 'The highest-priority mission left today.' :
    source === 'next' ? 'Next on your schedule.' :
    'An open mission, ready when you are.'
  return relation ? `${why} Toward ${relation}.` : why
}

function commandFacts(command, active, nowMinutes) {
  const start = command.time ? minutesOfDay(command.time) : null
  const duration = command.duration || 30
  let window = '—'
  if (start != null) {
    if (active) window = `${formatDuration(Math.max(0, start + duration - nowMinutes))} left`
    else if (start > nowMinutes) window = `in ${formatDuration(start - nowMinutes)}`
    else window = 'Missed'
  }
  const priority = command.priority
  return [
    { label: 'Scheduled', value: command.time ? timeLabel(command.time, true) : 'Not scheduled' },
    { label: 'Length', value: formatDuration(duration) },
    { label: 'Priority', value: priority ? (PRIORITY_LABEL[priority] || priority) : '—', tone: priority || '' },
    { label: active ? 'Remaining' : 'Window', value: window },
  ]
}

function scoreCopy(stats, hasData) {
  if (!hasData) return ['A fresh canvas.', 'Your day is still yours to shape. One meaningful step is enough to begin.']
  if (stats.score <= 0) return ['A quiet start.', 'Zero is a starting line, not a verdict. One meaningful step is enough to begin.']
  if (stats.score >= 80) return ['Finding your rhythm.', 'Built on the commitments you made to yourself.']
  if (stats.score >= 40) return ['Progress, in motion.', 'Small steps are still steps. Keep the thread alive.']
  return ['One step at a time.', 'A number is a snapshot, not a verdict. Your next win starts here.']
}

function recoveryRow(task, todayKey) {
  return `<div class="recovery-row">
    <div class="recovery-row-main">
      <strong>${escapeHtml(task.title)}</strong>
      <p>${icon('calendar')}${overdueLabel(task.date, todayKey)} · ${formatDuration(task.estimateMinutes)}</p>
    </div>
    <div class="recovery-row-actions">
      <button class="icon-btn" type="button" data-recovery-resume="${escapeHtml(task.id)}" title="Resume ${escapeHtml(task.title)}" aria-label="Resume ${escapeHtml(task.title)}">${icon('play')}</button>
      <button class="icon-btn" type="button" data-recovery-reschedule="${escapeHtml(task.id)}" title="Reschedule ${escapeHtml(task.title)}" aria-label="Reschedule ${escapeHtml(task.title)}">${icon('calendar')}</button>
      <button class="icon-btn" type="button" data-recovery-postpone="${escapeHtml(task.id)}" title="Postpone ${escapeHtml(task.title)} to tomorrow" aria-label="Postpone ${escapeHtml(task.title)} to tomorrow">${icon('arrow')}</button>
      <button class="icon-btn danger-hover" type="button" data-recovery-abandon="${escapeHtml(task.id)}" title="Abandon ${escapeHtml(task.title)}" aria-label="Abandon ${escapeHtml(task.title)}">${icon('trash')}</button>
    </div>
  </div>`
}

/**
 * Recovery is an assistant, not an alarm. The summary always states the count
 * and the "no catch-up required" promise; the detail view is opt-in and every
 * action is explicit — nothing is completed, moved or abandoned for the user.
 */
function recoveryCard(overdue, todayKey) {
  const rank = (t) => PRIORITY_RANK[t.priority] ?? 1
  const shown = [...overdue]
    .sort((a, b) => (rank(a) - rank(b)) || String(a.date || '').localeCompare(String(b.date || '')))
    .slice(0, 5)
  const open = recoveryOpen
  return `<section class="recovery-card" data-recovery aria-label="Mission recovery">
    <div class="recovery-main">
      <span class="recovery-icon" aria-hidden="true">${icon('recover')}</span>
      <div class="recovery-copy">
        <p class="recovery-title"><strong>${overdue.length} earlier mission${overdue.length === 1 ? ' is' : 's are'} still open.</strong></p>
        <p class="recovery-sub">No catch-up required. Review them, resume one, or reschedule what still matters — nothing changes until you decide.</p>
      </div>
      <div class="recovery-actions">
        <button class="btn btn-primary btn-small" type="button" data-common="recover">Review &amp; recover</button>
        <button class="text-button" type="button" data-recovery-toggle aria-expanded="${open}" aria-controls="recovery-detail"><span data-recovery-toggle-label>${open ? 'Hide details' : 'Details'}</span>${icon('chevron', open ? 'flip-up' : '')}</button>
      </div>
    </div>
    <div class="recovery-detail${open ? ' is-open' : ''}" id="recovery-detail" data-recovery-detail aria-hidden="${!open}">
      <div class="recovery-detail-inner">
        <div class="recovery-list">${shown.map((task) => recoveryRow(task, todayKey)).join('')}</div>
        <p class="recovery-foot">${icon('shield')}Showing ${shown.length} of ${overdue.length}. Nothing is completed, moved or abandoned automatically.</p>
      </div>
    </div>
  </section>`
}

export function renderDashboard() {
  const section = document.getElementById('view-dashboard')
  if (!section) return
  const today = currentDayKey(), now = new Date(), stats = todayStats(now)
  const blocks = scheduleFor(state,today)
  const nowMinutes = now.getHours()*60+now.getMinutes()
  const active = blocks.find((b) => blockState(state,b,today,now,today) === 'active')
  const next = blocks.find((b) => minutesOfDay(b.time) > nowMinutes && !itemDone(state,b,today))
  const openTasks = state.tasks.filter((t) => t.date === today && !t.done && t.status !== 'cancelled' && !t.inbox)
  const top3Ids = state.top3[today] || []
  const priority = openTasks.find((t) => top3Ids.includes(t.id)) || openTasks[0]
  let current = null, source = null
  if (active) { current = active; source = 'active' }
  else if (priority?.time) { current = blocks.find((b)=>b.taskId===priority.id) || null; source = top3Ids.includes(priority.id) ? 'top3' : 'priority' }
  else if (next) { current = next; source = 'next' }
  else if (priority) { current = priority; source = top3Ids.includes(priority.id) ? 'top3' : 'task' }
  const linkedTask = current?.taskId ? state.tasks.find((t)=>t.id===current.taskId) : current && !current.time && current.estimateMinutes ? current : null
  const command = current ? { title: linkedTask?.title || current.title, id: linkedTask?.id || current.taskId || current.id, blockId: current.taskId ? `task:${current.taskId}` : current.id, task: !!linkedTask, time: current.time, duration: current.duration || current.estimateMinutes, cat: current.cat, priority: current.priority, goalId: current.goalId || linkedTask?.goalId, projectId: current.projectId || linkedTask?.projectId, source } : null
  const linkedGoal = command?.goalId ? state.goals.find((g)=>g.id===command.goalId) : null
  const linkedProject = command?.projectId ? state.projects.find((p)=>p.id===command.projectId) : null
  const relation = linkedGoal?.title || linkedProject?.title || null
  const facts = command ? commandFacts(command, active, nowMinutes) : []
  const factsHtml = facts.map((f)=>`<div class="command-fact${f.tone ? ` priority-${f.tone}` : ''}"><span class="command-fact-label">${f.label}</span><strong class="command-fact-value">${f.tone ? '<span class="priority-dot" aria-hidden="true"></span>' : ''}${escapeHtml(f.value)}</strong></div>`).join('')
  const top3 = top3Stats(state,today)
  const overdue = overdueTasks(state,today)
  // the detail view is a convenience, not a remembered preference — once every
  // mission is resolved the card disappears and the next one starts closed.
  if (!overdue.length) recoveryOpen = false
  const upcoming = blocks.filter((b) => b.id !== command?.blockId && !itemDone(state,b,today) && minutesOfDay(b.time)+(b.duration||30) > nowMinutes).slice(0,4)
  const week = Array.from({length:7},(_,i) => statsFor(addDays(today,i-6),{now}))
  const focusTarget = state.settings.focus.targetMinutes || 180
  const hasData = stats.hasAnyActivity
  const candidates = top3Candidates(state,today).filter((t) => !top3.items.some((x) => x.task.id === t.id))
  const adherence = stats.blocksElapsed ? Math.round(stats.adherence*100) : null
  const paperCtx = buildWorkspaceContext(state, { now })
  const alerts = generateAlerts(state, paperCtx)
  const stripRecs = generateRecommendations(state, paperCtx)
  const slipping = goalHealthAll(state, paperCtx).filter((h) => h.status !== 'on_track' && h.status !== 'complete')
  const salute = salutationOf(state)
  const intention = intentionFor(state, today)
  const briefingDate = now.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})
  const scoreTitle = scoreCopy(stats, hasData)[0]
  const scoreBody = scoreCopy(stats, hasData)[1]
  const commandLabel = active ? 'IN THE MOMENT' : command ? 'YOUR NEXT MOVE' : 'TODAY’S COMMAND'
  const commandTitle = command ? escapeHtml(command.title) : 'Make room for<br>what matters.'
  const commandReasonText = command ? escapeHtml(commandReason(source, relation)) : 'A clear plan starts with one small step. What would make today feel meaningful?'
  section.innerHTML = `
    <div class="overview-greeting"><div class="greeting-copy"><p class="eyebrow"><span class="eyebrow-tick" aria-hidden="true"></span>Command briefing</p><h1 id="overview-greeting">${escapeHtml(greetingLine(state, now))}</h1><p class="greeting-lead">${command ? `At your command, ${escapeHtml(salute)}. One clear move is waiting below.` : `At your command, ${escapeHtml(salute)}. Let’s give the day a shape.`}</p><div class="intention-commit"><p class="intention-label">${icon('flag')}Today’s intention</p><button class="greeting-intention ${intention ? 'is-set' : 'is-empty'}" data-common="briefing" aria-label="${intention ? `Today’s intention: ${escapeHtml(intention)}. Open the briefing to edit` : 'Set today’s intention'}">${icon(intention ? 'check' : 'flag')}<span>${intention ? escapeHtml(intention) : 'Set today’s intention'}</span>${icon('chevron')}</button></div></div><div class="date-block"><p class="date-day"><span class="date-full">${briefingDate}</span><span class="date-short">${now.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}</span></p><p class="date-clock" id="overview-clock"></p><div class="day-progress" id="day-progress"><i id="day-progress-fill"></i></div><button class="btn btn-secondary btn-small greeting-brief" data-common="briefing">${icon('bell')}Full briefing</button></div></div>
    ${overdue.length ? recoveryCard(overdue, today) : ''}
    <div class="overview-top">
      <article class="card command-card"><div class="orbital-art" aria-hidden="true"><span></span><span></span><span></span><span></span></div><div class="command-head"><p class="eyebrow"><span class="status-dot"></span>${commandLabel}</p>
      <h2>${commandTitle}</h2>
      <p class="command-reason">${commandReasonText}</p></div>
      ${command ? `<div class="command-facts">${factsHtml}</div>` : ''}
      <div class="command-actions">${command ? `<button class="btn-primary" data-command-start="${escapeHtml(command.id)}" data-is-task="${!!command.task}">${icon('play')}${state.focus.active ? 'Resume focus' : active ? 'Start focus' : 'Begin mission'}</button>${command.task ? `<button class="btn-ghost" data-command-complete="${escapeHtml(command.id)}">${icon('check')}Complete</button><button class="text-button" data-command-delay="${escapeHtml(command.id)}">Reschedule ${icon('arrow')}</button>` : `<button class="btn-ghost" data-command-block="${escapeHtml(command.id)}">${icon('check')}Complete block</button>`}` : `<button class="btn-primary" data-common="plan">${icon('sun')}Plan my day</button><button class="btn-ghost" data-common="new-task">${icon('plus')}Add a mission</button>`}</div></article>
      <article class="card score-card"><div class="card-header"><h3>Daily execution score</h3><button class="text-button" data-score-info aria-label="How your score is calculated">${icon('info')}</button></div><div class="score-main">${ring(stats.score,'of 100',!hasData)}<div class="score-copy"><strong>${scoreTitle}</strong><p>${scoreBody}</p></div></div><div class="score-components">${scorePart('Missions',stats.tasksPlanned ? stats.tasksDone/stats.tasksPlanned : null,`${stats.tasksDone}/${stats.tasksPlanned}`)}${scorePart('Priorities',top3.total ? top3.done/top3.total : null,`${top3.done}/${top3.total}`)}${scorePart('Focus',stats.focusedMinutes/focusTarget,`${stats.focusedMinutes}m`)}${scorePart('Adherence',adherence == null ? null : adherence/100,adherence == null ? '—' : `${adherence}%`)}</div><p class="score-footnote">${icon('shield')}Honest numbers. Never a judgment.</p></article>
    </div>
    <div class="overview-middle"><article class="card priority-card"><div class="card-header"><div><h3>Today’s priorities <span class="count-badge">${top3.total}/3</span></h3><p class="meta" style="margin-top:5px">The few things that make a difference.</p></div><button class="text-button" data-common="day">My Day ${icon('upRight')}</button></div>
      ${top3.total ? top3.items.map(({task},i) => priorityRow(task,i)).join('') : empty('target','Less, but better.','Choose up to three missions that define a good day.',`<button class="text-button" data-common="new-task">${icon('plus')}Add your first priority</button>`)}
      ${top3.total < 3 ? `<div class="priority-bottom">${candidates.length ? `<select class="input-field" data-priority-picker aria-label="Choose a priority">${candidates.map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.title)}</option>`).join('')}</select><button class="btn btn-secondary" data-priority-add>${icon('plus')}Add priority</button>` : `<button class="text-button" data-common="new-task">${icon('plus')}Add a priority</button>`}</div>` : ''}
    </article><article class="card up-next-card"><div class="card-header"><h3>Coming up</h3><button class="text-button" data-common="schedule" aria-label="Open schedule">${icon('upRight')}</button></div>${upcoming.length ? `<div class="timeline-mini">${upcoming.map((b) => `<div class="timeline-mini-row ${blockState(state,b,today,now,today)==='active'?'is-active':''}"><span class="timeline-mini-time">${timeLabel(b.time)}</span><span class="timeline-mini-dot"></span><div class="timeline-mini-info"><strong>${escapeHtml(b.title)}</strong><p>${formatDuration(b.duration)}${b.protected?' · Protected':''}</p>${b.priority === 'high' ? '<span class="chip chip-accent">High priority</span>' : ''}</div></div>`).join('')}</div>` : empty('calendar','Room to breathe.','No upcoming commitments. Make space for focused work or a well-earned break.',`<button class="text-button" data-common="plan">Plan your afternoon ${icon('arrow')}</button>`)}</article></div>
    <div class="metric-strip">${metric('missions','Missions completed',`${stats.tasksDone}<small>/${stats.tasksPlanned}</small>`,`${openTasks.length} remaining today`)}${metric('focus','Focused time',durationHtml(stats.focusedMinutes),`${Math.min(100,Math.round(stats.focusedMinutes/focusTarget*100))}% of your daily intention`)}${metric('calendar','Schedule adherence',adherence == null ? '—' : `${adherence}<small>%</small>`,`${stats.blocksDone} of ${stats.blocksElapsed} elapsed blocks`)}${metric('routines','Consistency',`${week.filter((d) => d.hasAnyActivity).length}<small> / 7 days</small>`,'Showing up counts. Keep going.')}</div>
    <div class="paper-strip"><article class="card paper-strip-card"><div class="card-header"><h3>${icon('bell')}Alerts</h3><span class="meta">${alerts.length} open</span></div>${alerts.length ? `<div class="paper-strip-list">${alerts.slice(0,2).map((a) => `<button class="paper-strip-row" data-common="paper"><span class="paper-severity severity-${escapeHtml(a.severity)}">${escapeHtml(a.severity)}</span><span><strong>${escapeHtml(a.title)}</strong><small>${escapeHtml(a.detail)}</small></span></button>`).join('')}</div>` : empty('check','Nothing needs attention.','Overdue work, close deadlines and conflicts would be flagged here.')}</article><article class="card paper-strip-card paper-strip-recs"><div class="card-header"><h3>${icon('sparkles')}PAPER recommends</h3><button class="text-button" data-common="paper">Open PAPER ${icon('upRight')}</button></div>${stripRecs.length ? `<div class="paper-strip-list">${stripRecs.slice(0,2).map((r) => `<button class="paper-strip-row" data-common="paper"><span class="paper-priority">${escapeHtml(r.priority)}</span><span><strong>${escapeHtml(r.title)}</strong><small>${escapeHtml(r.nextStep || r.detail)}</small></span></button>`).join('')}</div>` : empty('leaf','No changes needed right now.','When the workspace needs a decision, PAPER will explain exactly why.')}</article><article class="card paper-strip-card"><div class="card-header"><h3>${icon('target')}Goal health</h3><button class="text-button" data-common="goals">Goals ${icon('upRight')}</button></div>${slipping.length ? `<div class="paper-strip-list">${slipping.slice(0,3).map((h) => `<button class="paper-strip-row" data-common="goals"><span class="paper-severity">${escapeHtml(h.status.replace('_',' '))}</span><span><strong>${escapeHtml((state.goals.find((g) => g.id === h.goalId) || {}).title || '')}</strong><small>${Math.round(h.progressPct)}% · ${h.openMissions} open mission${h.openMissions === 1 ? '' : 's'}</small></span></button>`).join('')}</div>` : empty('target','Your goals are in good shape.','Goals that stall, slip or lose their next step will be named here.')}</article></div>
    <div class="overview-bottom"><article class="card week-chart-card"><div class="card-header"><div><h3>Your week, in perspective</h3><p class="meta" style="margin-top:5px">Small steps. Visible progress.</p></div><div class="chart-legend"><span><i></i>Execution score</span></div><button class="text-button" data-common="progress" aria-label="Open analytics">${icon('upRight')}</button></div><div class="chart-wrap"><canvas id="overviewWeekChart" role="img" aria-label="Daily execution scores for the last seven days"></canvas></div>${!week.some((d)=>d.hasAnyActivity)?'<p class="meta" style="text-align:center;margin-top:8px">Your first session is the beginning of this story.</p>':''}</article><article class="card quick-actions-card"><div class="card-header"><h3>A little momentum</h3>${icon('bolt')}</div>${[['briefing','bell','Open today’s briefing'],['new-task','plus','Add a mission'],['focus','focus','Start a focus session'],['plan','sun','Plan my day'],['goal','target','Set a meaningful goal'],['capture','inbox','Quick capture']].map(([a,i,l])=>`<button class="quick-action" data-common="${a}">${icon(i)}${l}${icon('chevron')}</button>`).join('')}</article></div>
    <div class="overview-goal-banner">${icon('target')}<span>${state.goals.length ? `${state.goals.length} meaningful goal${state.goals.length===1?'':'s'}. Every mission is a step toward something bigger.` : 'Connect what you do today to who you want to become.'}</span><button class="text-button" data-common="goals">${state.goals.length?'Explore your goals':'Create your first goal'} ${icon('arrow')}</button></div>`
  bindCommon(section)
  qsa(section, '[data-priority-toggle]').forEach((b)=>b.addEventListener('click',()=>window.CC.toggleMission(b.dataset.priorityToggle)))
  qsa(section, '[data-priority-edit]').forEach((b)=>b.addEventListener('click',()=>window.CC.openTaskModal(b.dataset.priorityEdit)))
  qsa(section, '[data-priority-up]').forEach((b)=>b.addEventListener('click',()=>window.CC.movePriority(b.dataset.priorityUp,-1)))
  qsa(section, '[data-priority-down]').forEach((b)=>b.addEventListener('click',()=>window.CC.movePriority(b.dataset.priorityDown,1)))
  qsa(section, '[data-priority-delay]').forEach((b)=>b.addEventListener('click',()=>window.CC.openRescheduleModal(b.dataset.priorityDelay)))
  qs(section, '[data-priority-add]')?.addEventListener('click',()=>window.CC.addTaskToTop3(qs(section, '[data-priority-picker]').value))
  qs(section, '[data-command-start]')?.addEventListener('click',(e)=>{const b=e.currentTarget; b.dataset.isTask==='true'?window.CC.openFocusMode(b.dataset.commandStart):window.CC.openFocusRoom()})
  qs(section, '[data-command-complete]')?.addEventListener('click',(e)=>window.CC.toggleMission(e.currentTarget.dataset.commandComplete))
  qs(section, '[data-command-delay]')?.addEventListener('click',(e)=>window.CC.openRescheduleModal(e.currentTarget.dataset.commandDelay))
  qs(section, '[data-command-block]')?.addEventListener('click',(e)=>window.CC.toggleScheduleItem(e.currentTarget.dataset.commandBlock,today))
  qs(section, '[data-score-info]')?.addEventListener('click',()=>window.CC.openScoreInfo())
  const recoveryToggle = qs(section, '[data-recovery-toggle]')
  recoveryToggle?.addEventListener('click',()=>{
    recoveryOpen = !recoveryOpen
    const detail = qs(section, '[data-recovery-detail]')
    if (!detail) return
    detail.classList.toggle('is-open', recoveryOpen)
    detail.setAttribute('aria-hidden', String(!recoveryOpen))
    recoveryToggle.setAttribute('aria-expanded', String(recoveryOpen))
    const label = qs(recoveryToggle, '[data-recovery-toggle-label]')
    if (label) label.textContent = recoveryOpen ? 'Hide details' : 'Details'
    const chevron = qs(recoveryToggle, '.icon')
    chevron?.classList.toggle('flip-up', recoveryOpen)
  })
  qsa(section, '[data-recovery-resume]').forEach((b)=>b.addEventListener('click',()=>window.CC.openFocusMode(b.dataset.recoveryResume)))
  qsa(section, '[data-recovery-reschedule]').forEach((b)=>b.addEventListener('click',()=>window.CC.openRescheduleModal(b.dataset.recoveryReschedule)))
  qsa(section, '[data-recovery-postpone]').forEach((b)=>b.addEventListener('click',()=>window.CC.postponeMission(b.dataset.recoveryPostpone)))
  qsa(section, '[data-recovery-abandon]').forEach((b)=>b.addEventListener('click',async()=>{
    const id = b.dataset.recoveryAbandon
    const task = state.tasks.find((t)=>t.id===id)
    if (!task) return
    const ok = await confirmDialog({
      title: 'Abandon this mission?',
      message: `“${task.title}” will be marked abandoned. It stays in your history and can be reopened from Missions.`,
      confirmText: 'Abandon mission',
      cancelText: 'Keep it',
      danger: true,
    })
    if (ok) window.CC.abandonMission(id)
  }))
  const colors = chartColors()
  drawChart('overviewWeekChart',{type:'bar',data:{labels:week.map((d)=>weekdayShort(new Date(d.dateKey+'T12:00:00').getDay())),datasets:[{label:'Execution score',data:week.map((d)=>d.hasAnyActivity?d.score:0),backgroundColor:(ctx)=>{const hot=week[ctx.dataIndex]?.dateKey===today;return vGrad(ctx.chart,hot?colors.accent:colors.seriesHover,hot?alpha(colors.accent,.42):colors.series)},hoverBackgroundColor:(ctx)=>week[ctx.dataIndex]?.dateKey===today?colors.accent:colors.seriesHover,borderRadius:5,maxBarThickness:27}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{backgroundColor:colors.tooltipBg,titleColor:colors.text,bodyColor:colors.muted,borderColor:colors.tooltipBorder,borderWidth:1,padding:12,cornerRadius:10,callbacks:{label:(c)=>week[c.dataIndex].hasAnyActivity?`Score: ${c.raw}/100`:'No activity recorded'}}},scales:{x:{grid:{display:false},border:{display:false},ticks:{color:colors.muted,font:{size:10}}},y:{min:0,max:100,border:{display:false},grid:{color:colors.border},ticks:{stepSize:50,color:colors.muted,font:{size:9}}}}}})
  updateClockAndGreeting()
}
function scorePart(label,ratio,detail) { return `<div class="score-component${ratio==null?' is-empty':''}"><label>${label}<span>${detail}</span></label><div class="progress-track"><div class="progress-fill" style="width:${ratio==null?0:Math.min(100,Math.round(ratio*100))}%"></div></div></div>` }
export function priorityRow(task,index,{reorder=true}={}) { const chain=goalChain(state,task); return `<div class="priority-row ${task.done?'is-done':''}"><span class="priority-index">0${index+1}</span><button class="task-check ${task.done?'checked':''}" data-priority-toggle="${escapeHtml(task.id)}" aria-label="${task.done?'Reopen':'Complete'} ${escapeHtml(task.title)}" aria-pressed="${task.done}">${icon('check')}</button><div class="priority-info"><strong>${escapeHtml(task.title)}</strong><p>${task.priority==='high'?'<span class="accent">High priority</span>':'Medium priority'}<span>·</span>${escapeHtml(chain.goal?.title || chain.project?.title || formatDuration(task.estimateMinutes))}</p>${task.subtasks?.length?`<div class="subtask-progress"><div class="progress-track"><div class="progress-fill" style="width:${taskProgress(task)}%"></div></div>${taskProgress(task)}%</div>`:''}</div><div class="row-actions">${reorder?`<button class="icon-btn optional-action" data-priority-up="${escapeHtml(task.id)}" aria-label="Move priority up" ${index===0?'disabled':''}>${icon('down','rotate-180')}</button><button class="icon-btn optional-action" data-priority-down="${escapeHtml(task.id)}" aria-label="Move priority down" ${index>=(state.top3[currentDayKey()]?.length||0)-1?'disabled':''}>${icon('down')}</button>`:''}<button class="icon-btn" data-priority-edit="${escapeHtml(task.id)}" aria-label="Edit ${escapeHtml(task.title)}">${icon('edit')}</button><button class="icon-btn" data-priority-delay="${escapeHtml(task.id)}" aria-label="Reschedule ${escapeHtml(task.title)}">${icon('calendar')}</button></div></div>` }

/**
 * My Day also carries the hybrid layer: the plans you typed into the HYB deck
 * live here, tickable in place, so "add a plan" and "see my day" are one loop.
 * Finished and skipped days are shown, not hidden — the day is a record.
 */
function hybTodayCard(today, occurrences) {
  const done = occurrences.filter((item) => item.done).length
  const minutes = occurrences.reduce((sum, item) => sum + item.minutes, 0)
  const rows = occurrences
    .map(
      (item) => `<div class="hyb-day-row lane-${item.plan.kind} ${item.done ? 'is-done' : ''} ${item.skipped ? 'is-skipped' : ''}">
        <button type="button" class="hyb-check mini ${item.done ? 'checked' : ''}" data-hyb-day-toggle="${escapeHtml(item.plan.id)}" aria-pressed="${item.done}" aria-label="${item.done ? 'Reopen' : 'Finish'} ${escapeHtml(item.plan.title)}">${icon('check')}</button>
        <div class="hyb-day-copy"><strong>${escapeHtml(item.plan.title)}</strong><small>${item.plan.startTime ? `${timeLabel(item.plan.startTime, true)} · ` : ''}${formatDuration(item.minutes)} · ${kindOf(item.plan.kind).label} · ${energyOf(item.plan.energy).label} energy${item.skipped ? ' · skipped' : ''}</small></div>
        <button type="button" class="icon-btn" data-hyb-day-edit="${escapeHtml(item.plan.id)}" aria-label="Edit ${escapeHtml(item.plan.title)}">${icon('edit')}</button>
      </div>`,
    )
    .join('')
  return `<article class="card hyb-day-card"><div class="card-header"><div><h3>HYB · today’s plans</h3><p class="meta">${occurrences.length ? `${done}/${occurrences.length} done · ${formatDuration(minutes)} planned` : 'Study · work · body · people · events · ideas'}</p></div><div class="heading-actions"><button class="text-button" data-hyb-open-deck>${icon('bolt')}HYB deck</button><button class="text-button" data-common="hyb">${icon('board')}Studio</button></div></div>${
    occurrences.length
      ? `<div class="hyb-day-list">${rows}</div>`
      : empty('bolt', 'A plan is lighter than a mission.', 'Type one line — “Revision tomorrow 6pm 90m @study” — and it lands here, on the calendar and in the forecast.', `<button class="btn-primary" data-hyb-open-deck>${icon('bolt')}Add a HYB plan</button>`)
  }</article>`
}

export function renderMyDay() {
  const section=document.getElementById('view-day'); if(!section)return
  const today=currentDayKey(), stats=todayStats(), top3=top3Stats(state,today), blocks=scheduleFor(state,today)
  const tasks=state.tasks.filter((t)=>t.date===today&&!t.inbox&&t.status!=='cancelled').sort((a,b)=>Number(a.done)-Number(b.done)||(a.time||'99').localeCompare(b.time||'99'))
  section.innerHTML=`<div class="page-heading"><div><p class="eyebrow">${new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'}).toUpperCase()}</p><h1>Make today count.</h1><p>Not everything. Just the things that matter.</p></div><div class="heading-actions"><button class="btn-ghost" data-common="recover">${icon('recover')}Recover my day</button><button class="btn-primary" data-common="plan">${icon('sun')}Plan my day</button></div></div>${domainTabs('day', DOMAIN_TABS.myDay)}<div class="overview-middle"><article class="card priority-card"><div class="card-header"><h3>Your three priorities</h3><span class="chip chip-accent">${top3.done}/${top3.total} complete</span></div>${top3.items.length?top3.items.map(({task},i)=>priorityRow(task,i)).join(''):empty('target','Choose your direction.','Pick three missions that would make today meaningful.')}${top3.total<3?`<button class="btn-ghost" style="margin-top:16px" data-common="new-task">${icon('plus')}Add a priority</button>`:''}<div class="notice" style="margin-top:22px">${icon('leaf')}Leave room for being human. A good plan has space to breathe.</div></article><article class="card"><div class="card-header"><h3>The day at a glance</h3>${icon('sun')}</div><div class="schedule-summary"><div><span>Missions completed</span><strong>${stats.tasksDone} / ${stats.tasksPlanned}</strong></div><div><span>Time intentionally focused</span><strong>${formatDuration(stats.focusedMinutes)}</strong></div><div><span>Time blocks planned</span><strong>${blocks.length}</strong></div><div><span>Daily execution score</span><strong>${stats.hasAnyActivity?stats.score+' / 100':'Not enough data'}</strong></div></div><button class="btn-ghost" style="width:100%;margin-top:24px" data-common="focus">${icon('focus')}Enter the Focus Room</button></article></div><article class="card"><div class="card-header"><div><h3>Today’s missions</h3><p class="meta">${tasks.filter((t)=>!t.done).length} open · ${tasks.filter((t)=>t.done).length} complete</p></div><button class="text-button" data-common="new-task">${icon('plus')}Add mission</button></div>${tasks.length?tasks.map((t)=>priorityRow(t,tasks.indexOf(t),{reorder:false})).join(''):empty('missions','A little intention goes a long way.','Add a mission, estimate your time, and give it a place in your day.',`<button class="btn-primary" data-common="new-task">${icon('plus')}Add a mission</button>`)}</article>${hybTodayCard(today,hybDay(today))}`
  bindCommon(section)
  qsa(section, '[data-priority-toggle]').forEach((b)=>b.addEventListener('click',()=>window.CC.toggleMission(b.dataset.priorityToggle)))
  qsa(section, '[data-priority-edit]').forEach((b)=>b.addEventListener('click',()=>window.CC.openTaskModal(b.dataset.priorityEdit)))
  qsa(section, '[data-priority-delay]').forEach((b)=>b.addEventListener('click',()=>window.CC.openRescheduleModal(b.dataset.priorityDelay)))
  qsa(section, '[data-priority-up],[data-priority-down]').forEach((b)=>b.addEventListener('click',()=>{const id=b.dataset.priorityUp||b.dataset.priorityDown;window.CC.movePriority(id,b.dataset.priorityUp?-1:1)}))
  qsa(section, '[data-hyb-day-toggle]').forEach((b)=>b.addEventListener('click',()=>toggleHybPlanDay(b.dataset.hybDayToggle,today)))
  qsa(section, '[data-hyb-day-edit]').forEach((b)=>b.addEventListener('click',()=>window.CC.openHybPlanModal(b.dataset.hybDayEdit)))
  qsa(section, '[data-hyb-open-deck]').forEach((b)=>b.addEventListener('click',()=>window.CC.openHybDeck({date:today})))
}
