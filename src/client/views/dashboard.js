/* -------------------------------------------------------------------------
   THE COMMAND CENTER — the photographic dashboard.

   The composition is editorial rather than a grid of equal cards: a dominant
   greeting over the photograph, one command line, then three panels of
   deliberately different weights (today / schedule / priorities), a progress
   band and a quiet PAPER ribbon.

   Every number, label and action below comes from the same records the rest of
   the application uses. Nothing on this page is simulated.
   ------------------------------------------------------------------------- */

import { state, currentDayKey, todayStats, statsFor } from '../core/store.js'
import { confirmDialog, escapeHtml, qs, qsa } from '../core/dom.js'
import { addDays, formatDuration, minutesOfDay, weekdayShort } from '../lib/dates.js'
import { scheduleFor, blockState, itemDone } from '../lib/planner.js'
import { goalChain, goalProgress, taskProgress } from '../lib/relationships.js'
import { top3Stats, top3Candidates } from '../lib/top3.js'
import { overdueTasks, describeScoreFormula } from '../lib/score.js'
import { drawChart, chartColors, alpha, vGrad } from '../core/charts.js'
import { icon, ring, empty, metric, timeLabel, bindCommon, domainTabs, DOMAIN_TABS } from '../ui/common.js'
import { buildWorkspaceContext } from '../lib/paper/context.js'
import { generateAlerts, generateRecommendations } from '../lib/paper/recommendations.js'
import { goalHealthAll } from '../lib/paper/reasoning.js'
import { updateClockAndGreeting } from '../ui/chrome.js'
import { intentionFor, salutationOf } from '../lib/briefing.js'
import { atmosphereSwitch, syncSwitchState } from '../ui/atmosphere.js'
import { atmosphereInfo, resolveAtmosphere, splitGreeting } from '../lib/atmosphere.js'
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
    source === 'active' ? 'This window is open right now — the room is yours.' :
    source === 'top3' ? 'One of the three things that make today matter.' :
    source === 'priority' ? 'The highest-priority mission still open today.' :
    source === 'next' ? 'The next commitment on your schedule.' :
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
  if (!hasData) return ['A fresh canvas.', 'One meaningful step is enough to begin. The photograph is yours to fill.']
  if (stats.score <= 0) return ['A quiet start.', 'Zero is a starting line, not a verdict.']
  if (stats.score >= 80) return ['Finding your rhythm.', 'Built on the commitments you made to yourself.']
  if (stats.score >= 40) return ['Progress, in motion.', 'Small steps are still steps. Keep the thread alive.']
  return ['One step at a time.', 'A number is a snapshot, not a verdict.']
}

/* ------------------------------------------------------------ environment */

/** The at-a-glance hero copy: greeting, context and today's intention. */
function heroBlock({ now, stats, command, salute, intention, openTasks }) {
  const atmosphereId = resolveAtmosphere(state.settings.atmosphere, now)
  const { part, name } = splitGreeting(`${atmosphereInfo(atmosphereId).greeting}, ${salute}`)
  const opened = stats.tasksPlanned + (stats.blocksElapsed || 0)
  const lead = command
    ? `${escapeHtml(atmosphereInfo(atmosphereId).note)} ${openTasks.length ? `${openTasks.length} mission${openTasks.length === 1 ? '' : 's'} still open today.` : 'Everything on today’s list is done.'}`
    : `${escapeHtml(atmosphereInfo(atmosphereId).note)} ${opened ? 'Your day has shape — the next line is yours to write.' : 'Nothing is scheduled yet. One quiet decision is enough to begin.'}`
  const ws = state.settings.workingHours || {}
  const start = minutesOfDay(ws.start || '08:00')
  const end = Math.max(start + 60, minutesOfDay(ws.end || '20:00'))
  const pct = Math.max(0, Math.min(100, Math.round(((now.getHours() * 60 + now.getMinutes() - start) / (end - start)) * 100)))
  return `<header class="atmo-hero">
    <div class="atmo-hero-main">
      <p class="eyebrow">${escapeHtml(atmosphereInfo(atmosphereId).label)} in the villa</p>
      <h1 class="atmo-greeting" id="overview-greeting"><span class="greeting-part">${escapeHtml(part)}</span><span class="greeting-name">${escapeHtml(name.replace(/\.$/, ''))}</span></h1>
      <p class="atmo-lead">${lead}</p>
      <button class="atmo-intention${intention ? ' is-set' : ' is-empty'}" type="button" data-common="briefing" aria-label="${intention ? `Today’s intention: ${escapeHtml(intention)}. Open the briefing to edit` : 'Set today’s intention'}">
        <span class="atmo-intention-label">Intention</span>
        ${icon(intention ? 'check' : 'flag')}
        <span>${intention ? escapeHtml(intention) : 'Set today’s intention'}</span>
        ${icon('chevron')}
      </button>
    </div>
    <div class="atmo-hero-aside">
      <div class="atmo-switch-slot">${atmosphereSwitch()}</div>
      <p class="atmo-date" id="atmo-date">${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
      <p class="atmo-clock" id="overview-clock">${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: state.settings.timeFormat !== '24h' })}</p>
      <div class="atmo-dayrail" role="img" aria-label="${pct}% of your available hours used">
        <div class="atmo-dayrail-track"><i id="day-progress-fill" style="width:${pct}%"></i></div>
        <div class="atmo-dayrail-labels"><span>${timeLabel(ws.start || '08:00', true)}</span><span>${timeLabel(ws.end || '20:00', true)}</span></div>
      </div>
      <button class="atmo-brief" type="button" data-common="briefing">${icon('bell')}Full briefing</button>
    </div>
  </header>`
}

/* ------------------------------------------------------------- the panels */

function todayPanel({ stats, top3, adherence, focusTarget, consistentDays }) {
  const done = stats.tasksPlanned ? Math.round((stats.tasksDone / stats.tasksPlanned) * 100) : 0
  return `<article class="card atmo-panel atmo-today-panel" aria-label="Today’s overview">
    <div class="atmo-panel-head">
      <div class="atmo-panel-titles"><h2>Today’s overview</h2><p>${stats.hasAnyActivity ? 'The shape of the day so far.' : 'A quiet canvas, ready for one decision.'}</p></div>
      <button class="text-button" type="button" data-score-info aria-label="How your score is calculated">${icon('info')}</button>
    </div>
    <div class="atmo-today">
      ${ring(stats.score, 'of 100', !stats.hasAnyActivity)}
      <div class="atmo-today-facts">
        <div class="atmo-stat"><span class="atmo-stat-label">Completed</span><strong>${stats.tasksDone}<small>/ ${stats.tasksPlanned}</small></strong></div>
        <div class="atmo-stat"><span class="atmo-stat-label">Remaining</span><strong>${Math.max(0, stats.tasksPlanned - stats.tasksDone)}</strong></div>
        <div class="atmo-stat"><span class="atmo-stat-label">Priorities</span><strong>${top3.done}<small>/ ${top3.total || 3}</small></strong></div>
        <div class="atmo-stat"><span class="atmo-stat-label">Focused</span><strong>${formatDuration(stats.focusedMinutes)}<small>/ ${formatDuration(focusTarget)}</small></strong></div>
      </div>
    </div>
    <div class="atmo-progress">
      <div class="atmo-progress-row"><span>Missions complete</span><strong>${done}%</strong></div>
      <div class="progress-track"><div class="progress-fill" style="width:${done}%"></div></div>
      <div class="atmo-progress-row"><span>Schedule adherence</span><strong>${adherence == null ? '—' : `${adherence}%`}</strong></div>
      <div class="progress-track"><div class="progress-fill" style="width:${adherence == null ? 0 : adherence}%"></div></div>
    </div>
    <p class="atmo-priority-note">${top3.total ? `${top3.done} of ${top3.total} priorities done. <span>${top3.done === top3.total ? 'A clean sweep — well held.' : 'The most important thing still has your name on it.'}</span>` : `<span>Choose up to three priorities</span> and the day will have a centre of gravity.`}</p>
    <div class="metric-strip metric-strip-sr" aria-label="Today’s numbers">
      ${metric('missions','Missions completed',`${stats.tasksDone}<small>/${stats.tasksPlanned}</small>`,`${Math.max(0, stats.tasksPlanned - stats.tasksDone)} remaining today`)}
      ${metric('focus','Focused time',formatDuration(stats.focusedMinutes),`${Math.min(100, Math.round((stats.focusedMinutes / focusTarget) * 100))}% of your daily intention`)}
      ${metric('calendar','Schedule adherence',adherence == null ? '—' : `${adherence}<small>%</small>`,`${stats.blocksDone} of ${stats.blocksElapsed} elapsed blocks`)}
      ${metric('routines','Consistency',`${consistentDays}<small> / 7 days</small>`,'Showing up counts. Keep going.')}
    </div>
  </article>`
}

function schedulePanel({ blocks, now, today, nowMinutes }) {
  const dayBlocks = blocks
    .filter((b) => b.time && b.kind !== 'protected')
    .sort((a, b) => minutesOfDay(a.time) - minutesOfDay(b.time))
  let rows = dayBlocks.slice(0, 7)
  const upcomingCount = dayBlocks.filter((b) => !itemDone(state, b, today) && minutesOfDay(b.time) + (b.duration || 30) > nowMinutes).length
  if (!rows.length) {
    return `<article class="card atmo-panel atmo-schedule-panel" aria-label="My schedule">
      <div class="atmo-panel-head">
        <div class="atmo-panel-titles"><h2>My schedule</h2><p>The day, hour by hour.</p></div>
        <button class="text-button" type="button" data-common="schedule">Open ${icon('upRight')}</button>
      </div>
      ${empty('calendar', 'The day is still open.', 'Nothing is placed on the calendar yet. A schedule gives the day its rhythm — or leave space for what arrives.', `<button class="btn-ghost btn-small" type="button" data-common="plan">${icon('sun')}Plan my day</button>`)}
    </article>`
  }
  const items = rows.map((b) => {
    const stateName = blockState(state, b, today, now, today)
    const done = itemDone(state, b, today)
    const live = stateName === 'active'
    const label = done ? 'Done' : live ? 'Now' : stateName === 'missed' ? 'Missed' : stateName === 'skipped' ? 'Skipped' : stateName === 'delayed' ? 'Moved' : 'Upcoming'
    return `<div class="atmo-slot${live ? ' is-active is-now' : ''}${done ? ' is-done' : ''}">
      <span class="atmo-slot-time">${timeLabel(b.time, true)}<small>${formatDuration(b.duration || 30)}</small></span>
      <div class="atmo-slot-copy"><strong>${escapeHtml(b.title)}</strong><p>${escapeHtml(b.protected ? 'Protected time' : b.kind === 'routine' ? 'Routine' : b.cat ? (state.categories.find((c) => c.id === b.cat)?.name || 'Scheduled') : 'Scheduled')}${b.priority === 'high' ? ' · High priority' : ''}</p></div>
      <span class="atmo-slot-state">${label}</span>
    </div>`
  }).join('')
  return `<article class="card atmo-panel atmo-schedule-panel" aria-label="My schedule">
    <div class="atmo-panel-head">
      <div class="atmo-panel-titles"><h2>My schedule</h2><p>${upcomingCount} still ahead of you today.</p></div>
      <button class="text-button" type="button" data-common="schedule">Open ${icon('upRight')}</button>
    </div>
    <div class="atmo-schedule">${items}</div>
    <div class="atmo-panel-foot"><span>${dayBlocks.length} commitment${dayBlocks.length === 1 ? '' : 's'} today</span><button class="text-button" type="button" data-common="calendar">Calendar ${icon('arrow')}</button></div>
  </article>`
}

function priorityPanel({ top3, candidates }) {
  const rows = top3.items.map(({ task }, index) => {
    const chain = goalChain(state, task)
    const relation = chain.goal?.title || chain.project?.title
    return `<div class="atmo-priority${task.done ? ' is-done' : ''}">
      <span class="atmo-priority-index">0${index + 1}</span>
      <button class="atmo-priority-check${task.done ? ' is-checked' : ''}" type="button" data-priority-toggle="${escapeHtml(task.id)}" aria-label="${task.done ? 'Reopen' : 'Complete'} ${escapeHtml(task.title)}" aria-pressed="${task.done}">${icon('check')}</button>
      <div class="atmo-priority-copy">
        <strong>${escapeHtml(task.title)}</strong>
        <small>${PRIORITY_LABEL[task.priority] || 'Medium'} priority${relation ? ` · ${escapeHtml(relation)}` : ` · ${formatDuration(task.estimateMinutes)}`}${task.subtasks?.length ? ` · ${taskProgress(task)}% of steps` : ''}</small>
      </div>
      <div class="atmo-priority-actions">
        <button class="icon-btn" type="button" data-priority-up="${escapeHtml(task.id)}" aria-label="Move priority up" ${index === 0 ? 'disabled' : ''}>${icon('down', 'rotate-180')}</button>
        <button class="icon-btn" type="button" data-priority-down="${escapeHtml(task.id)}" aria-label="Move priority down" ${index >= (state.top3[currentDayKey()]?.length || 0) - 1 ? 'disabled' : ''}>${icon('down')}</button>
        <button class="icon-btn" type="button" data-priority-edit="${escapeHtml(task.id)}" aria-label="Edit ${escapeHtml(task.title)}">${icon('edit')}</button>
        <button class="icon-btn" type="button" data-priority-delay="${escapeHtml(task.id)}" aria-label="Reschedule ${escapeHtml(task.title)}">${icon('calendar')}</button>
      </div>
    </div>`
  }).join('')
  const add = top3.total < 3
    ? (candidates.length
      ? `<div class="priority-bottom atmo-priority-bottom"><select class="input-field" data-priority-picker aria-label="Choose a priority">${candidates.map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.title)}</option>`).join('')}</select><button class="btn btn-secondary btn-small" type="button" data-priority-add>${icon('plus')}Add</button></div>`
      : `<button class="atmo-add-priority" type="button" data-common="new-task">${icon('plus')}Add a priority</button>`)
    : ''
  return `<article class="card atmo-panel atmo-priorities-panel" aria-label="Priorities">
    <div class="atmo-panel-head">
      <div class="atmo-panel-titles"><h2>Priorities</h2><p>The few things that make a difference.</p></div>
      <span class="chip">${top3.done}/${top3.total || 3}</span>
    </div>
    <div class="atmo-priorities">${top3.total ? rows : empty('target', 'Less, but better.', 'Choose up to three missions that would make today feel well spent.')}${add}</div>
    <div class="atmo-panel-foot"><span>${top3.total ? 'Ordered by choice, not by urgency.' : 'Nothing chosen yet.'}</span><button class="text-button" type="button" data-common="day">My Day ${icon('arrow')}</button></div>
  </article>`
}

function commandBlock({ command, factsHtml, active }) {
  const label = active ? 'In the moment' : command ? 'Your next move' : 'Today’s command'
  const title = command ? escapeHtml(command.title) : 'Make room for<br>what matters.'
  const reason = command
    ? commandReasonText
    : 'A clear plan starts with one small step. What would make today feel meaningful?'
  return `<section class="card atmo-command${command ? '' : ' is-clear'}" aria-label="Today’s command">
    <div class="atmo-command-main">
      <p class="eyebrow"><span class="status-dot" aria-hidden="true"></span>${label}</p>
      <h2 class="atmo-command-title">${title}</h2>
      <p class="atmo-command-reason">${reason}</p>
      ${command ? `<div class="atmo-facts">${factsHtml}</div>` : ''}
    </div>
    <div class="atmo-command-actions">
      ${command
        ? `<button class="atmo-action-primary" type="button" data-command-start="${escapeHtml(command.id)}" data-is-task="${!!command.task}">${icon('play')}${state.focus.active ? 'Resume focus' : active ? 'Begin focus' : 'Begin mission'}</button>
           ${command.task
            ? `<button class="atmo-action-quiet" type="button" data-command-complete="${escapeHtml(command.id)}">${icon('check')}Complete</button>`
            : `<button class="atmo-action-quiet" type="button" data-command-block="${escapeHtml(command.id)}">${icon('check')}Complete block</button>`}
           <button class="atmo-link" type="button" data-command-delay="${escapeHtml(command.id)}">Reschedule ${icon('arrow')}</button>`
        : `<button class="atmo-action-primary" type="button" data-common="plan">${icon('sun')}Plan my day</button>
           <button class="atmo-action-quiet" type="button" data-common="new-task">${icon('plus')}Add a mission</button>
           <button class="atmo-link" type="button" data-common="focus">Enter the Focus Room ${icon('arrow')}</button>`}
    </div>
  </section>`
}

/* ---------------------------------------------------------------- ribbons */

function progressBand({ stats, week, today, focusTarget }) {
  const pct = stats.tasksPlanned ? Math.round((stats.tasksDone / stats.tasksPlanned) * 100) : 0
  const activeDays = week.filter((d) => d.hasAnyActivity).length
  const average = Math.round(week.reduce((sum, d) => sum + (d.hasAnyActivity ? d.score : 0), 0) / 7)
  const max = Math.max(20, ...week.map((d) => (d.hasAnyActivity ? d.score : 0)))
  return `<article class="card atmo-panel atmo-progress-panel" aria-label="Daily progress">
    <div class="atmo-panel-head">
      <div class="atmo-panel-titles"><h2>Daily progress</h2><p>Small steps, visible over a week.</p></div>
      <button class="text-button" type="button" data-common="progress">Analytics ${icon('upRight')}</button>
    </div>
    <div class="atmo-progress-big">
      <div><strong>${pct}<small>%</small></strong><p>of today’s missions complete${stats.tasksPlanned ? ` · ${stats.tasksDone} of ${stats.tasksPlanned}` : ''}</p></div>
      <div class="atmo-progress-delta"><b>${activeDays} / 7</b>active days<br><b>${average}</b>avg. score</div>
    </div>
    <div class="atmo-week" role="img" aria-label="Execution score for each of the last seven days">
      ${week.map((d) => {
        const value = d.hasAnyActivity ? d.score : 0
        const height = d.hasAnyActivity ? Math.max(8, Math.round((value / max) * 100)) : 6
        return `<i class="${d.dateKey === today ? 'is-today' : ''}${d.hasAnyActivity ? '' : ' is-empty'}" style="height:${height}%" title="${d.dateKey}: ${d.hasAnyActivity ? `${value}/100` : 'no activity recorded'}"></i>`
      }).join('')}
    </div>
    <div class="atmo-week-labels">${week.map((d) => `<span class="${d.dateKey === today ? 'is-today' : ''}">${weekdayShort(new Date(`${d.dateKey}T12:00:00`).getDay())}</span>`).join('')}</div>
    <p class="atmo-priority-note">${stats.focusedMinutes ? `${formatDuration(stats.focusedMinutes)} of focused work today — <span>${Math.min(100, Math.round((stats.focusedMinutes / focusTarget) * 100))}% of your daily intention.</span>` : `No focus sessions logged yet. <span>The room is quiet until you begin.</span>`}</p>
  </article>`
}

function actionsPanel() {
  const actions = [
    ['new-task', 'plus', 'Add a mission'],
    ['project', 'projects', 'Create a project'],
    ['plan', 'sun', 'Open the planner'],
    ['calendar', 'calendar', 'View the calendar'],
  ]
  return `<article class="card atmo-panel atmo-actions-panel" aria-label="Quick actions">
    <div class="atmo-panel-head"><div class="atmo-panel-titles"><h2>Quick actions</h2><p>The shortest path to the next thing.</p></div></div>
    <div class="atmo-actions">
      ${actions.map(([action, symbol, label]) => `<button class="atmo-action" type="button" data-common="${action}">${icon(symbol)}${label}${icon('chevron')}</button>`).join('')}
      <button class="atmo-action" type="button" data-common="capture">${icon('inbox')}Quick capture${icon('chevron')}</button>
    </div>
    <div class="atmo-panel-foot"><span>Every action stays on this device.</span></div>
  </article>`
}

function paperRibbon({ alerts, stripRecs, slipping }) {
  const alertCard = `<article class="card atmo-panel atmo-paper-card" aria-label="Alerts">
    <div class="atmo-panel-head"><div class="atmo-panel-titles"><h2>${icon('bell')} Alerts</h2><p>${alerts.length} open</p></div></div>
    ${alerts.length ? `<div class="paper-strip-list">${alerts.slice(0, 2).map((a) => `<button class="paper-strip-row" type="button" data-common="paper"><span class="paper-severity severity-${escapeHtml(a.severity)}">${escapeHtml(a.severity)}</span><span><strong>${escapeHtml(a.title)}</strong><small>${escapeHtml(a.detail)}</small></span></button>`).join('')}</div>` : empty('check', 'Nothing needs attention.', 'Overdue work, close deadlines and conflicts would be flagged here.')}
  </article>`
  const recCard = `<article class="card atmo-panel atmo-paper-card" aria-label="PAPER recommendations">
    <div class="atmo-panel-head"><div class="atmo-panel-titles"><h2>${icon('sparkles')} PAPER recommends</h2><p>Reasoned from your own records.</p></div><button class="text-button" type="button" data-common="paper">Open ${icon('upRight')}</button></div>
    ${stripRecs.length ? `<div class="paper-strip-list">${stripRecs.slice(0, 2).map((r) => `<button class="paper-strip-row" type="button" data-common="paper"><span class="paper-priority">${escapeHtml(r.priority)}</span><span><strong>${escapeHtml(r.title)}</strong><small>${escapeHtml(r.nextStep || r.detail)}</small></span></button>`).join('')}</div>` : empty('leaf', 'No changes needed right now.', 'When the workspace needs a decision, PAPER will explain exactly why.')}
  </article>`
  const goalCard = `<article class="card atmo-panel atmo-paper-card" aria-label="Goal health">
    <div class="atmo-panel-head"><div class="atmo-panel-titles"><h2>${icon('target')} Goal health</h2><p>Direction, not decoration.</p></div><button class="text-button" type="button" data-common="goals">Goals ${icon('upRight')}</button></div>
    ${slipping.length ? `<div class="paper-strip-list">${slipping.slice(0, 3).map((h) => `<button class="paper-strip-row" type="button" data-common="goals"><span class="paper-severity">${escapeHtml(h.status.replace('_', ' '))}</span><span><strong>${escapeHtml((state.goals.find((g) => g.id === h.goalId) || {}).title || '')}</strong><small>${Math.round(h.progressPct)}% · ${h.openMissions} open mission${h.openMissions === 1 ? '' : 's'}</small></span></button>`).join('')}</div>` : empty('target', 'Your goals are in good shape.', 'Goals that stall, slip or lose their next step will be named here.')}
  </article>`
  return `<div class="atmo-paper">${alertCard}${recCard}${goalCard}</div>`
}

function weekChartCard() {
  return `<article class="card atmo-panel atmo-chart" aria-label="Weekly execution score">
    <div class="atmo-panel-head">
      <div class="atmo-panel-titles"><h2>Your week, in perspective</h2><p>Execution score · the last seven days.</p></div>
      <div class="chart-legend"><span><i></i>Score</span></div>
      <button class="text-button" type="button" data-common="progress" aria-label="Open analytics">${icon('upRight')}</button>
    </div>
    <div class="chart-wrap"><canvas id="overviewWeekChart" role="img" aria-label="Daily execution scores for the last seven days"></canvas></div>
  </article>`
}

/* the recovery assistant keeps its explicit, non-punitive contract */
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

function recoveryCard(overdue, todayKey) {
  const rank = (t) => PRIORITY_RANK[t.priority] ?? 1
  const shown = [...overdue]
    .sort((a, b) => (rank(a) - rank(b)) || String(a.date || '').localeCompare(String(b.date || '')))
    .slice(0, 5)
  const open = recoveryOpen
  return `<section class="recovery-card atmo-recovery" data-recovery aria-label="Mission recovery">
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

/* --------------------------------------------------------------- renderer */

let commandReasonText = ''

export function renderDashboard() {
  const section = document.getElementById('view-dashboard')
  if (!section) return
  const today = currentDayKey()
  const now = new Date()
  const stats = todayStats(now)
  const blocks = scheduleFor(state, today)
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const active = blocks.find((b) => blockState(state, b, today, now, today) === 'active')
  const next = blocks.find((b) => minutesOfDay(b.time) > nowMinutes && !itemDone(state, b, today))
  const openTasks = state.tasks.filter((t) => t.date === today && !t.done && t.status !== 'cancelled' && !t.inbox)
  const top3Ids = state.top3[today] || []
  const priority = openTasks.find((t) => top3Ids.includes(t.id)) || openTasks[0]
  let current = null
  let source = null
  if (active) { current = active; source = 'active' }
  else if (priority?.time) { current = blocks.find((b) => b.taskId === priority.id) || null; source = top3Ids.includes(priority.id) ? 'top3' : 'priority' }
  else if (next) { current = next; source = 'next' }
  else if (priority) { current = priority; source = top3Ids.includes(priority.id) ? 'top3' : 'task' }
  const linkedTask = current?.taskId ? state.tasks.find((t) => t.id === current.taskId) : current && !current.time && current.estimateMinutes ? current : null
  const command = current ? {
    title: linkedTask?.title || current.title,
    id: linkedTask?.id || current.taskId || current.id,
    blockId: current.taskId ? `task:${current.taskId}` : current.id,
    task: !!linkedTask,
    time: current.time,
    duration: current.duration || current.estimateMinutes,
    cat: current.cat,
    priority: current.priority,
    goalId: current.goalId || linkedTask?.goalId,
    projectId: current.projectId || linkedTask?.projectId,
    source,
  } : null
  const linkedGoal = command?.goalId ? state.goals.find((g) => g.id === command.goalId) : null
  const linkedProject = command?.projectId ? state.projects.find((p) => p.id === command.projectId) : null
  const relation = linkedGoal?.title || linkedProject?.title || null
  commandReasonText = command ? escapeHtml(commandReason(source, relation)) : ''
  const facts = command ? commandFacts(command, active, nowMinutes) : []
  const factsHtml = facts.map((f) => `<div class="atmo-fact${f.tone ? ` priority-${f.tone}` : ''}"><span class="atmo-fact-label">${f.label}</span><strong class="atmo-fact-value">${f.tone ? '<span class="priority-dot" aria-hidden="true"></span>' : ''}${escapeHtml(f.value)}</strong></div>`).join('')
  const top3 = top3Stats(state, today)
  const candidates = top3Candidates(state, today).filter((t) => !top3.items.some((x) => x.task.id === t.id))
  const overdue = overdueTasks(state, today)
  if (!overdue.length) recoveryOpen = false
  const week = Array.from({ length: 7 }, (_, i) => statsFor(addDays(today, i - 6), { now }))
  const focusTarget = state.settings.focus.targetMinutes || 180
  const adherence = stats.blocksElapsed ? Math.round(stats.adherence * 100) : null
  const salute = salutationOf(state)
  const intention = intentionFor(state, today)
  const paperCtx = buildWorkspaceContext(state, { now })
  const alerts = generateAlerts(state, paperCtx)
  const stripRecs = generateRecommendations(state, paperCtx)
  const slipping = goalHealthAll(state, paperCtx).filter((h) => h.status !== 'on_track' && h.status !== 'complete')

  section.innerHTML = `
    ${heroBlock({ now, stats, command, salute, intention, openTasks })}
    ${overdue.length ? recoveryCard(overdue, today) : ''}
    ${commandBlock({ command, factsHtml, active })}
    <div class="atmo-body">
      <div class="atmo-column">
        ${todayPanel({ stats, top3, adherence, focusTarget, consistentDays: week.filter((d) => d.hasAnyActivity).length })}
        ${progressBand({ stats, week, today, focusTarget })}
      </div>
      <div class="atmo-column">
        ${schedulePanel({ blocks, now, today, nowMinutes })}
        ${weekChartCard()}
      </div>
      <div class="atmo-column">
        ${priorityPanel({ top3, candidates })}
        ${actionsPanel()}
      </div>
    </div>
    ${paperRibbon({ alerts, stripRecs, slipping })}
    <div class="atmo-goal-banner">${icon('target')}<span>${state.goals.length ? `${state.goals.length} meaningful goal${state.goals.length === 1 ? '' : 's'}. Every mission is a step toward something bigger.` : 'Connect what you do today to who you want to become.'}</span><button class="text-button" type="button" data-common="goals">${state.goals.length ? 'Explore your goals' : 'Create your first goal'} ${icon('arrow')}</button></div>`

  bindCommon(section)
  qsa(section, '[data-priority-toggle]').forEach((b) => b.addEventListener('click', () => window.CC.toggleMission(b.dataset.priorityToggle)))
  qsa(section, '[data-priority-edit]').forEach((b) => b.addEventListener('click', () => window.CC.openTaskModal(b.dataset.priorityEdit)))
  qsa(section, '[data-priority-up]').forEach((b) => b.addEventListener('click', () => window.CC.movePriority(b.dataset.priorityUp, -1)))
  qsa(section, '[data-priority-down]').forEach((b) => b.addEventListener('click', () => window.CC.movePriority(b.dataset.priorityDown, 1)))
  qsa(section, '[data-priority-delay]').forEach((b) => b.addEventListener('click', () => window.CC.openRescheduleModal(b.dataset.priorityDelay)))
  qs(section, '[data-priority-add]')?.addEventListener('click', () => window.CC.addTaskToTop3(qs(section, '[data-priority-picker]').value))
  qs(section, '[data-command-start]')?.addEventListener('click', (e) => {
    const b = e.currentTarget
    b.dataset.isTask === 'true' ? window.CC.openFocusMode(b.dataset.commandStart) : window.CC.openFocusRoom()
  })
  qs(section, '[data-command-complete]')?.addEventListener('click', (e) => window.CC.toggleMission(e.currentTarget.dataset.commandComplete))
  qs(section, '[data-command-delay]')?.addEventListener('click', (e) => window.CC.openRescheduleModal(e.currentTarget.dataset.commandDelay))
  qs(section, '[data-command-block]')?.addEventListener('click', (e) => window.CC.toggleScheduleItem(e.currentTarget.dataset.commandBlock, today))
  qs(section, '[data-score-info]')?.addEventListener('click', () => window.CC.openScoreInfo())
  const recoveryToggle = qs(section, '[data-recovery-toggle]')
  recoveryToggle?.addEventListener('click', () => {
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
  qsa(section, '[data-recovery-resume]').forEach((b) => b.addEventListener('click', () => window.CC.openFocusMode(b.dataset.recoveryResume)))
  qsa(section, '[data-recovery-reschedule]').forEach((b) => b.addEventListener('click', () => window.CC.openRescheduleModal(b.dataset.recoveryReschedule)))
  qsa(section, '[data-recovery-postpone]').forEach((b) => b.addEventListener('click', () => window.CC.postponeMission(b.dataset.recoveryPostpone)))
  qsa(section, '[data-recovery-abandon]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.recoveryAbandon
    const task = state.tasks.find((t) => t.id === id)
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

  // the transparent weekly chart, drawn only when a canvas can take it
  const colors = chartColors()
  drawChart('overviewWeekChart', {
    type: 'bar',
    data: {
      labels: week.map((d) => weekdayShort(new Date(`${d.dateKey}T12:00:00`).getDay())),
      datasets: [{
        label: 'Execution score',
        data: week.map((d) => (d.hasAnyActivity ? d.score : 0)),
        backgroundColor: (ctx) => {
          const hot = week[ctx.dataIndex]?.dateKey === today
          return vGrad(ctx.chart, hot ? colors.accent : colors.seriesHover, hot ? alpha(colors.accent, 0.32) : colors.series)
        },
        hoverBackgroundColor: (ctx) => (week[ctx.dataIndex]?.dateKey === today ? colors.accent : colors.seriesHover),
        borderRadius: 4,
        maxBarThickness: 26,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: colors.tooltipBg,
          titleColor: colors.text,
          bodyColor: colors.muted,
          borderColor: colors.tooltipBorder,
          borderWidth: 1,
          padding: 12,
          cornerRadius: 10,
          callbacks: { label: (c) => (week[c.dataIndex].hasAnyActivity ? `Score: ${c.raw}/100` : 'No activity recorded') },
        },
      },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: colors.muted, font: { size: 10 } } },
        y: { min: 0, max: 100, border: { display: false }, grid: { color: colors.border }, ticks: { stepSize: 50, color: colors.muted, font: { size: 9 } } },
      },
    },
  })
  syncSwitchState()
  updateClockAndGreeting()
}

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
