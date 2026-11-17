import { state, currentDayKey, todayStats, statsFor } from '../core/store.js'
import { escapeHtml, qs, qsa } from '../core/dom.js'
import { addDays, formatDuration, minutesOfDay, weekdayShort } from '../lib/dates.js'
import { scheduleFor, blockState, itemDone } from '../lib/planner.js'
import { goalChain, goalProgress, taskProgress } from '../lib/relationships.js'
import { goalHealthReport } from '../lib/goalhealth.js'
import { top3Stats, top3Candidates } from '../lib/top3.js'
import { overdueTasks, describeScoreFormula } from '../lib/score.js'
import { sessionTotals } from '../lib/focus.js'
import { drawChart, chartColors } from '../core/charts.js'
import { icon, ring, empty, metric, timeLabel, bindCommon } from '../ui/common.js'
import { updateClockAndGreeting } from '../ui/chrome.js'
import { greetingLine, intentionFor, salutationOf } from '../lib/briefing.js'

export function renderDashboard() {
  const section = document.getElementById('view-dashboard')
  if (!section) return
  const today = currentDayKey(), now = new Date(), stats = todayStats(now)
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const blocks = scheduleFor(state, today)
  // Protected windows, imported calendar events and routine check-ins are
  // commitments — never the mission the workspace suggests you start.
  const workBlocks = blocks.filter((b) => !b.protected && !['protected', 'event', 'routine'].includes(b.kind))
  const active = workBlocks.find((b) => blockState(state, b, today, now, today) === 'active')
  const next = workBlocks.find((b) => minutesOfDay(b.time) > nowMinutes && !itemDone(state, b, today))
  const openTasks = state.tasks.filter((t) => t.date === today && !t.done && t.status !== 'cancelled' && !t.inbox)
  const priority = openTasks.find((t) => (state.top3[today] || []).includes(t.id)) || openTasks[0]
  const current = active || (priority?.time ? blocks.find((b) => b.taskId === priority.id) : null) || next || priority
  const linkedTask = current?.taskId ? state.tasks.find((t) => t.id === current.taskId) : current && !current.time && current.estimateMinutes ? current : null
  const command = current
    ? {
        title: linkedTask?.title || current.title,
        blockTitle: current.title,
        id: linkedTask?.id || current.taskId || current.id,
        blockId: current.taskId ? `task:${current.taskId}` : current.id,
        task: !!linkedTask,
        time: current.time,
        duration: current.duration || current.estimateMinutes,
        cat: current.cat,
        priority: current.priority,
        goalId: current.goalId,
        projectId: current.projectId,
        protected: !!current.protected,
        kind: current.kind || 'mission',
      }
    : null
  const chain = linkedTask ? goalChain(state, linkedTask) : { goal: null, project: null }
  const top3 = top3Stats(state, today)
  const overdue = overdueTasks(state, today)
  const inbox = state.tasks.filter((t) => t.inbox && !t.done && t.status !== 'cancelled')
  const health = goalHealthReport(state, today, { now })
  const upcoming = blocks.filter((b) => b.id !== command?.blockId && !itemDone(state, b, today) && minutesOfDay(b.time) + (b.duration || 30) > nowMinutes)
  const week = Array.from({ length: 7 }, (_, i) => statsFor(addDays(today, i - 6), { now }))
  const weekWithData = week.filter((d) => d.hasAnyActivity)
  const weekAverage = weekWithData.length ? Math.round(weekWithData.reduce((sum, d) => sum + (d.score || 0), 0) / weekWithData.length) : null
  const focusTarget = state.settings.focus.targetMinutes || 180
  const hasData = stats.hasAnyActivity
  const candidates = top3Candidates(state, today).filter((t) => !top3.items.some((x) => x.task.id === t.id))
  const priorityFoot = top3.total === 0
    ? ''
    : top3.total < 3
      ? `<div class="priority-bottom">${candidates.length ? `<select class="input-field" data-priority-picker aria-label="Choose a priority">${candidates.map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.title)}</option>`).join('')}</select><button class="btn btn-secondary" data-priority-add>${icon('plus')}Add</button>` : `<button class="text-button" data-common="new-task">${icon('plus')}Add a priority</button>`}</div>`
      : `<div class="priority-head" style="margin-top:14px;margin-bottom:0"><p style="margin:0">All three chosen. Now the work is simply to begin.</p><button class="text-button" data-common="day">My Day ${icon('upRight')}</button></div>`
  const adherence = stats.blocksElapsed ? Math.round(stats.adherence * 100) : null
  const salute = salutationOf(state)
  const intention = intentionFor(state, today)
  const briefingDate = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const openBlocks = blocks.filter((b) => !itemDone(state, b, today))
  const remainingPlanned = openBlocks.reduce((sum, b) => sum + (b.duration || 30), 0)
  const dayEnd = minutesOfDay(state.settings.dayEnd || '23:30')
  const freeAfterToday = Math.max(0, dayEnd - Math.max(nowMinutes, minutesOfDay(state.settings.workingHours.start)) - remainingPlanned)
  const commandRemaining = command?.time ? Math.max(0, minutesOfDay(command.time) + command.duration - nowMinutes) : null
  const commandProgress = linkedTask ? taskProgress(linkedTask) : null
  const commandSteps = linkedTask ? (linkedTask.subtasks || []).filter((step) => !step.done).slice(0, 3) : []
  const commandNote = linkedTask?.description || ''
  const commandEnd = command?.time ? (minutesOfDay(command.time) + (command.duration || 30)) % 1440 : null
  const commandEndLabel = commandEnd == null ? '' : timeLabel(`${String(Math.floor(commandEnd / 60)).padStart(2, '0')}:${String(commandEnd % 60).padStart(2, '0')}`, true)
  const commandStartsIn = command?.time ? minutesOfDay(command.time) - nowMinutes : null
  const commandTiming = command && command.time
    ? commandStartsIn > 0
      ? `Starts in ${formatDuration(commandStartsIn)} · ends ${commandEndLabel}`
      : commandStartsIn > -command.duration
        ? `In progress · ${formatDuration(Math.max(0, command.duration + commandStartsIn))} left`
        : `Scheduled for ${timeLabel(command.time, true)}`
    : ''
  const dayStartMin = minutesOfDay(state.settings.dayStart || '07:00')
  const dayEndMin = minutesOfDay(state.settings.dayEnd || '21:00')
  const daySpan = Math.max(60, dayEndMin - dayStartMin)
  const dayPct = (minutes) => Math.round(Math.min(100, Math.max(0, ((minutes - dayStartMin) / daySpan) * 100)) * 100) / 100
  const nowPct = dayPct(nowMinutes)
  const nowLine = nowMinutes >= dayStartMin && nowMinutes <= dayEndMin
    ? `<span class="now-tl-marker" style="left:${nowPct}%"><i></i></span>`
    : ''
  const nowTimeline = blocks.length
    ? `<div class="now-day"><div class="now-day-head"><span>Your day at a glance</span><span>${escapeHtml(timeLabel(state.settings.dayStart || '07:00', true))} – ${escapeHtml(timeLabel(state.settings.dayEnd || '21:00', true))}</span></div><div class="now-tl">${blocks.map((b) => `<span class="now-tl-block ${b.id === command?.blockId ? 'is-now' : ''} ${itemDone(state, b, today) ? 'is-done' : ''} ${b.protected || b.kind === 'event' ? 'is-protected' : ''}" style="left:${dayPct(minutesOfDay(b.time))}%;width:${Math.max(0.8, Math.round(((b.duration || 30) / daySpan) * 1000) / 10)}%" title="${escapeHtml(b.title || '')} · ${escapeHtml(timeLabel(b.time, true))}"></span>`).join('')}${nowLine}</div></div>`
    : ''
  const commandGoal = chain.goal
  const commandWhy = command
    ? command.kind === 'event'
      ? 'From your calendar — time you already committed.'
      : commandGoal
        ? `Serves “${commandGoal.title}” · ${Math.round(goalProgress(state, commandGoal))}% there.`
        : top3.items.some((x) => x.task.id === command.id)
          ? 'One of your three priorities for today.'
          : ''
    : ''
  const signalRows = []
  if (overdue.length) {
    signalRows.push({
      icon: 'recover', tone: 'danger', title: `${overdue.length} mission${overdue.length === 1 ? '' : 's'} still open from earlier`, note: 'Move them forward without starting over.', value: overdue.length, action: 'recover',
    })
  }
  if (health.summary.needingAttention) {
    const first = health.attention[0]
    signalRows.push({
      icon: 'target', tone: first.status === 'drifting' ? 'danger' : 'warning', title: `${health.summary.needingAttention} goal${health.summary.needingAttention === 1 ? ' needs' : 's need'} a look`, note: first ? `${first.goal.title} · ${first.reason}` : 'Momentum is fading.', value: `${health.summary.averageProgress}%`, action: 'goals',
    })
  }
  if (hasData) signalRows.push({
    icon: 'clock', tone: freeAfterToday < 60 ? 'warning' : 'neutral', title: freeAfterToday < 60 ? 'Today is nearly spoken for' : 'Room left in the day', note: `${formatDuration(remainingPlanned)} still planned · ${formatDuration(freeAfterToday)} unclaimed`, value: formatDuration(freeAfterToday), action: 'schedule',
  })
  if (inbox.length) {
    signalRows.push({
      icon: 'inbox', tone: 'neutral', title: `${inbox.length} capture${inbox.length === 1 ? '' : 's'} waiting for a decision`, note: 'Give each one a day, or let it go.', value: inbox.length, action: 'tasks',
    })
  }
  const railAll = blocks.slice().sort((a, b) => minutesOfDay(a.time) - minutesOfDay(b.time))
  const railItems = railAll.slice(0, 5)
  const railHtml = railItems.length
    ? railItems
        .map((b) => {
          const stateName = blockState(state, b, today, now, today)
          const isNow = stateName === 'active'
          const isDone = stateName === 'completed'
          const isProtected = b.protected || b.kind === 'protected' || b.kind === 'event' || b.kind === 'routine'
          const linked = b.taskId ? state.tasks.find((t) => t.id === b.taskId) : null
          const title = linked?.title || b.title
          const label = isProtected ? 'Protected' : b.kind === 'event' ? 'Calendar' : b.priority === 'high' ? 'High priority' : `${b.duration} min`
          return `<button class="rail-item ${isDone ? 'is-done' : ''} ${isNow ? 'is-now' : ''} ${isProtected ? 'is-protected' : ''}" data-rail-block="${escapeHtml(b.id)}" aria-label="${escapeHtml(b.title)}, ${timeLabel(b.time, true)}">
            <span class="rail-time">${timeLabel(b.time)}</span><span class="rail-dot"></span>
            <span class="rail-body"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(label)} · ${formatDuration(b.duration)}</small></span>
          </button>`
        })
        .join('')
    : `<div class="rail-empty"><strong style="color:var(--ink-2);font-weight:550;font-size:12.5px">Nothing is on the calendar yet.</strong><span>Three real priorities are enough to begin.</span><button class="text-button" data-common="plan" style="margin-top:6px">Plan my day ${icon('arrow')}</button></div>`
  section.innerHTML = `
    <div class="cockpit">
      <header class="cockpit-head">
        <div class="cockpit-greeting">
          <p class="eyebrow">Command briefing · ${escapeHtml(briefingDate)}</p>
          <h1 id="overview-greeting">${escapeHtml(greetingLine(state, now))}</h1>
          <p class="cockpit-sub">${command ? (active ? `You are in the middle of <strong style="color:var(--ink)">${escapeHtml(command.title)}</strong>. Everything else can wait.` : `At your command${salute ? `, ${escapeHtml(salute)}` : ''}. One clear move is waiting below.`) : `At your command${salute ? `, ${escapeHtml(salute)}` : ''}. Let’s give the day a shape.`}</p>
          <button class="intention ${intention ? '' : 'is-empty'}" data-common="briefing">${icon('flag')}<span>${intention ? escapeHtml(intention) : 'Set today’s intention'}</span>${icon('chevron')}</button>
        </div>
        <div class="cockpit-clock date-block">
          <p class="clock"><span id="overview-clock">—:—</span></p>
          <p class="date date-day">${escapeHtml(briefingDate)}</p>
          <div class="day-bar" id="day-progress" role="img" aria-label="Progress through your working day"><i id="day-progress-fill"></i></div>
          <div class="quick-actions-card" style="display:flex;gap:6px;margin-top:14px;justify-content:flex-end;flex-wrap:wrap">
            <button class="btn btn-ghost btn-small" data-common="briefing">${icon('bell')}Briefing</button>
            <button class="btn btn-ghost btn-small" data-common="new-task" title="New mission">${icon('plus')}Mission</button>
            <button class="btn btn-ghost btn-small" data-common="focus" aria-label="Start a focus session" title="Start a focus session">${icon('focus')}</button>
            <button class="btn btn-ghost btn-small" data-common="capture" aria-label="Quick capture" title="Quick capture (N)">${icon('inbox')}</button>
          </div>
        </div>
      </header>
      ${overdue.length ? `<div class="recovery-banner">${icon('recover')}<span>A fresh start is always possible. ${overdue.length} earlier mission${overdue.length === 1 ? ' is' : 's are'} still open.</span><button class="text-button" data-common="recover">Recover my day ${icon('arrow')}</button></div>` : ''}
      <div class="cockpit-grid">
        <article class="now-card command-card ${command ? '' : 'now-empty'}">
          <p class="now-kicker"><i></i>${active ? 'In the moment' : command ? 'Next move' : 'Today’s command'}</p>
          <h2 class="now-title">${command ? escapeHtml(command.title) : 'Make room for<br>what matters.'}</h2>
          ${command
            ? `<p class="now-context">${command.time ? `<span>${timeLabel(command.time, true)}</span><span class="dot"></span>` : ''}<span>${formatDuration(command.duration || 30)}</span>${command.priority === 'high' ? `<span class="dot"></span><span style="color:var(--accent)">High priority</span>` : ''}${commandRemaining != null && active ? `<span class="dot"></span><span>${formatDuration(commandRemaining)} remaining</span>` : ''}${(chain.goal?.title || chain.project?.title) ? `<span class="dot"></span><span class="chain">${icon('target')}${escapeHtml(chain.goal?.title || chain.project?.title)}</span>` : ''}</p>`
            : `<p class="now-context">A clear plan starts with one small step. What would make today feel meaningful?</p>`}
          ${command ? `<div class="now-brief">
            ${commandTiming || commandWhy ? `<div class="now-brief-head">
              ${commandTiming ? `<span class="now-timing">${icon('clock')}${escapeHtml(commandTiming)}</span>` : ''}
              ${commandWhy ? `<span class="now-why">${icon('target')}<span>${escapeHtml(commandWhy)}</span></span>` : ''}
            </div>` : ''}
            ${commandSteps.length ? `<ul class="now-steps">${commandSteps.map((step) => `<li><i></i><span>${escapeHtml(step.title)}</span></li>`).join('')}</ul>${(linkedTask.subtasks || []).filter((step) => !step.done).length > 3 ? `<p class="now-more">+${(linkedTask.subtasks || []).filter((step) => !step.done).length - 3} more steps</p>` : ''}` : commandNote ? `<p class="now-note">${escapeHtml(commandNote.length > 180 ? `${commandNote.slice(0, 178).trimEnd()}…` : commandNote)}</p>` : ''}
            ${command.task ? `<button class="text-button now-open" data-task-edit="${escapeHtml(command.id)}">Open mission ${icon('arrow')}</button>` : ''}
          </div>` : ''}
          ${nowTimeline}
          ${commandProgress != null && commandProgress > 0 ? `<div class="now-progress"><div class="progress-track"><div class="progress-fill" style="width:${commandProgress}%"></div></div><span>${commandProgress}% complete</span></div>` : ''}
          <div class="now-actions">
            ${command
              ? `<button class="btn-primary" data-command-start="${escapeHtml(command.id)}" data-is-task="${!!command.task}">${icon('play')}${state.focus.active ? 'Resume focus' : active ? 'Start focus' : 'Begin mission'}</button>
                 ${command.task ? `<button class="btn-ghost" data-command-complete="${escapeHtml(command.id)}">${icon('check')}Complete</button><button class="btn-ghost" data-command-delay="${escapeHtml(command.id)}">${icon('calendar')}Reschedule</button>` : `<button class="btn-ghost" data-command-block="${escapeHtml(command.blockId)}">${icon('check')}Complete block</button>`}`
              : `<button class="btn-primary" data-common="plan">${icon('sun')}Plan my day</button><button class="btn-ghost" data-common="new-task">${icon('plus')}Add a mission</button>`}
          </div>
        </article>
        <aside class="day-rail up-next-card">
          <div class="rail-head"><h3>The shape of today</h3><span>${blocks.length} block${blocks.length === 1 ? '' : 's'} · ${formatDuration(blocks.reduce((sum, b) => sum + (b.duration || 0), 0))}</span></div>
          <div class="rail-list">${railHtml}</div>
          ${railAll.length > railItems.length ? `<button class="text-button" style="margin-top:8px" data-common="schedule">+ ${railAll.length - railItems.length} more block${railAll.length - railItems.length === 1 ? '' : 's'} ${icon('arrow')}</button>` : ''}
          <div class="rail-foot"><span><strong>${openBlocks.length}</strong> still open · <strong>${formatDuration(remainingPlanned)}</strong> planned</span><button class="text-button" data-common="schedule">Open schedule ${icon('arrow')}</button></div>
        </aside>
      </div>
      <div class="cockpit-row">
        <article class="card priority-card">
          <div class="priority-head"><div><h3>Today’s three</h3><p>The few things that would make today count.</p></div><span class="chip chip-accent">${top3.done}/${top3.total || 3}</span></div>
          ${top3.total ? top3.items.map(({ task }, i) => priorityRow(task, i)).join('') : empty('target', 'Less, but better.', 'Choose up to three missions that define a good day.', `<button class="text-button" data-common="new-task">${icon('plus')}Add your first priority</button>`)}
          ${priorityFoot}
        </article>
        <aside class="card signals">
          <div class="rail-head" style="margin-bottom:4px"><h3>${!signalRows.length && !hasData ? 'Three ways to begin' : 'Signals worth a look'}</h3><span>${!signalRows.length && !hasData ? 'nothing invented' : 'from your own data'}</span></div>
          <div class="signal-list">
            ${!signalRows.length && !hasData ? [
              ['sun', 'Plan the shape of today', 'Your calendar is open. Start with two honest blocks.', 'plan'],
              ['plus', 'Capture what is on your mind', 'One line is enough. Decide what it is later.', 'capture'],
              ['target', 'Name what this quarter is for', 'A goal turns a busy week into a meaningful one.', 'goal'],
            ].map(([ic, title, note, action]) => `<button class="signal-row" data-common="${action}"><span class="signal-icon tone-neutral">${icon(ic)}</span><span class="signal-body"><strong>${title}</strong><small>${note}</small></span><span class="signal-value tone-neutral">${icon('arrow')}</span></button>`).join('') : ''}
            ${signalRows.map((row) => `<button class="signal-row" data-common="${row.action}"><span class="signal-icon tone-${row.tone}">${icon(row.icon)}</span><span class="signal-body"><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(row.note)}</small></span><span class="signal-value tone-${row.tone}">${escapeHtml(String(row.value))}</span></button>`).join('')}
          </div>
          <div style="margin-top:auto;padding-top:14px"><button class="btn-ghost btn-small" style="width:100%" data-common="review">${icon('review')}Reflect on the week</button></div>
        </aside>
      </div>
      <div class="metric-strip">
        ${metric('missions','Missions completed',`${stats.tasksDone}<small> / ${stats.tasksPlanned}</small>`,`${openTasks.length} open today`)}
        ${metric('focus','Focused time',`${stats.focusedMinutes}<small> min</small>`,`${Math.min(100,Math.round(stats.focusedMinutes / focusTarget * 100))}% of your daily intention`)}
        ${metric('calendar','Schedule adherence',adherence == null ? '—' : `${adherence}<small>%</small>`,`${stats.blocksDone} of ${stats.blocksElapsed} elapsed blocks`)}
        ${metric('routines','Consistency',`${week.filter((d) => d.hasAnyActivity).length}<small> / 7 days</small>`,'Showing up counts. Keep going.')}
      </div>
      <div class="cockpit-lower">
        <article class="card chart-card-v5">
          <div class="card-header"><div><h3>Your week, in perspective</h3><p class="meta">Execution score, last seven days</p></div><button class="text-button" data-common="progress" aria-label="Open analytics">${icon('upRight')}</button></div>
          <div class="week-summary"><strong>${weekAverage == null ? '—' : weekAverage}</strong><span>${weekAverage == null ? 'No activity recorded yet' : `average · ${weekWithData.length} day${weekWithData.length === 1 ? '' : 's'} with real work`}</span></div>
          <div class="chart-wrap"><canvas id="overviewWeekChart" role="img" aria-label="Daily execution scores for the last seven days"></canvas></div>
        </article>
        <article class="card score-card">
          <div class="card-header"><div><h3>Daily execution score</h3><p class="meta">${hasData ? 'Built on the commitments you made to yourself.' : 'Your real progress will appear here.'}</p></div><button class="text-button" data-score-info aria-label="How your score is calculated">${icon('info')}</button></div>
          <div class="score-main" style="display:flex;align-items:center;gap:20px">${ring(stats.score, 'of 100', !hasData)}<div class="score-copy"><strong style="font-size:14px;font-weight:560;color:var(--ink)">${!hasData ? 'A fresh canvas.' : stats.score >= 80 ? 'Finding your rhythm.' : stats.score >= 40 ? 'Progress, in motion.' : 'One step at a time.'}</strong><p class="meta" style="margin-top:6px;max-width:22ch">${!hasData ? 'Nothing to measure yet — and that is honest.' : `${stats.tasksDone} of ${stats.tasksPlanned} missions · ${adherence == null ? 'no elapsed blocks' : `${adherence}% adherence`}`}</p></div></div>
          <div class="score-components" style="margin-top:18px">${scorePart('Missions', stats.tasksPlanned ? stats.tasksDone / stats.tasksPlanned : null, `${stats.tasksDone}/${stats.tasksPlanned}`)}${scorePart('Priorities', top3.total ? top3.done / top3.total : null, `${top3.done}/${top3.total}`)}${scorePart('Focus', stats.focusedMinutes / focusTarget, `${stats.focusedMinutes}m`)}${scorePart('Adherence', adherence == null ? null : adherence / 100, adherence == null ? '—' : `${adherence}%`)}</div>
          <p class="score-footnote">${icon('shield')}Honest numbers. Never a judgment.</p>
        </article>
      </div>
      <div class="overview-goal-banner">${icon('target')}<span>${state.goals.length ? `${health.summary.onTrack} of ${state.goals.length} goals are moving. ${health.summary.needingAttention ? `${health.summary.needingAttention} could use your attention.` : 'Every one of them has real work behind it.'}` : 'Connect what you do today to who you want to become.'}</span><button class="text-button" data-common="goals">${state.goals.length ? 'Explore your goals' : 'Create your first goal'} ${icon('arrow')}</button></div>
    </div>`
  bindCommon(section)
  qs(section, '[data-task-edit]')?.addEventListener('click', (e) => window.CC.openTaskModal(e.currentTarget.dataset.taskEdit))
  qsa(section, '[data-priority-toggle]').forEach((b) => b.addEventListener('click', () => window.CC.toggleMission(b.dataset.priorityToggle)))
  qsa(section, '[data-priority-edit]').forEach((b) => b.addEventListener('click', () => window.CC.openTaskModal(b.dataset.priorityEdit)))
  qsa(section, '[data-priority-up]').forEach((b) => b.addEventListener('click', () => window.CC.movePriority(b.dataset.priorityUp, -1)))
  qsa(section, '[data-priority-down]').forEach((b) => b.addEventListener('click', () => window.CC.movePriority(b.dataset.priorityDown, 1)))
  qsa(section, '[data-priority-delay]').forEach((b) => b.addEventListener('click', () => window.CC.openRescheduleModal(b.dataset.priorityDelay)))
  qs(section, '[data-priority-add]')?.addEventListener('click', () => window.CC.addTaskToTop3(qs(section, '[data-priority-picker]').value))
  qsa(section, '[data-rail-block]').forEach((b) => b.addEventListener('click', () => window.CC.switchView('schedule')))
  qs(section, '[data-command-start]')?.addEventListener('click', (e) => {
    const b = e.currentTarget
    b.dataset.isTask === 'true' ? window.CC.openFocusMode(b.dataset.commandStart) : window.CC.openFocusRoom()
  })
  qs(section, '[data-command-complete]')?.addEventListener('click', (e) => window.CC.toggleMission(e.currentTarget.dataset.commandComplete))
  qs(section, '[data-command-delay]')?.addEventListener('click', (e) => window.CC.openRescheduleModal(e.currentTarget.dataset.commandDelay))
  qs(section, '[data-command-block]')?.addEventListener('click', (e) => window.CC.toggleScheduleItem(e.currentTarget.dataset.commandBlock, today))
  qs(section, '[data-score-info]')?.addEventListener('click', () => window.CC.openScoreInfo())
  const colors = chartColors()
  drawChart('overviewWeekChart', {
    type: 'bar',
    data: {
      labels: week.map((d) => weekdayShort(new Date(d.dateKey + 'T12:00:00').getDay())),
      datasets: [
        {
          label: 'Execution score',
          data: week.map((d) => (d.hasAnyActivity ? d.score : 0)),
          backgroundColor: week.map((d) => (d.dateKey === today ? colors.accent : d.hasAnyActivity ? colors.accentMuted : colors.series)),
          hoverBackgroundColor: week.map((d) => (d.dateKey === today ? colors.accent : colors.seriesHover)),
          borderRadius: 6,
          maxBarThickness: 26,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: colors.tooltipBg,
          titleColor: '#fff',
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
  updateClockAndGreeting()
}
function scorePart(label,ratio,detail) { return `<div class="score-component"><label>${label}<span>${detail}</span></label><div class="progress-track"><div class="progress-fill" style="width:${ratio==null?0:Math.min(100,Math.round(ratio*100))}%"></div></div></div>` }
export function priorityRow(task,index,{reorder=true}={}) { const chain=goalChain(state,task); return `<div class="priority-row ${task.done?'is-done':''}"><span class="priority-index">0${index+1}</span><button class="task-check ${task.done?'checked':''}" data-priority-toggle="${escapeHtml(task.id)}" aria-label="${task.done?'Reopen':'Complete'} ${escapeHtml(task.title)}" aria-pressed="${task.done}">${icon('check')}</button><div class="priority-info"><strong>${escapeHtml(task.title)}</strong><p>${task.priority==='high'?'<span class="accent">High priority</span>':'Medium priority'}<span>·</span>${escapeHtml(chain.goal?.title || chain.project?.title || formatDuration(task.estimateMinutes))}</p>${task.subtasks?.length?`<div class="subtask-progress"><div class="progress-track"><div class="progress-fill" style="width:${taskProgress(task)}%"></div></div>${taskProgress(task)}%</div>`:''}</div><div class="row-actions">${reorder?`<button class="icon-btn optional-action" data-priority-up="${escapeHtml(task.id)}" aria-label="Move priority up" ${index===0?'disabled':''}>${icon('down','rotate-180')}</button><button class="icon-btn optional-action" data-priority-down="${escapeHtml(task.id)}" aria-label="Move priority down" ${index>=(state.top3[currentDayKey()]?.length||0)-1?'disabled':''}>${icon('down')}</button>`:''}<button class="icon-btn" data-priority-edit="${escapeHtml(task.id)}" aria-label="Edit ${escapeHtml(task.title)}">${icon('edit')}</button><button class="icon-btn" data-priority-delay="${escapeHtml(task.id)}" aria-label="Reschedule ${escapeHtml(task.title)}">${icon('calendar')}</button></div></div>` }

export function renderMyDay() {
  const section=document.getElementById('view-day'); if(!section)return
  const today=currentDayKey(), stats=todayStats(), top3=top3Stats(state,today), blocks=scheduleFor(state,today)
  const tasks=state.tasks.filter((t)=>t.date===today&&!t.inbox&&t.status!=='cancelled').sort((a,b)=>Number(a.done)-Number(b.done)||(a.time||'99').localeCompare(b.time||'99'))
  section.innerHTML=`<div class="page-heading"><div><p class="eyebrow">${new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'}).toUpperCase()}</p><h1>Make today count.</h1><p>Not everything. Just the things that matter.</p></div><div class="heading-actions"><button class="btn-ghost" data-common="recover">${icon('recover')}Recover my day</button><button class="btn-primary" data-common="plan">${icon('sun')}Plan my day</button></div></div><div class="overview-middle"><article class="card priority-card"><div class="card-header"><h3>Your three priorities</h3><span class="chip chip-accent">${top3.done}/${top3.total} complete</span></div>${top3.items.length?top3.items.map(({task},i)=>priorityRow(task,i)).join(''):empty('target','Choose your direction.','Pick three missions that would make today meaningful.')}${top3.total<3?`<button class="btn-ghost" style="margin-top:16px" data-common="new-task">${icon('plus')}Add a priority</button>`:''}<div class="notice" style="margin-top:22px">${icon('leaf')}Leave room for being human. A good plan has space to breathe.</div></article><article class="card"><div class="card-header"><h3>The day at a glance</h3>${icon('sun')}</div><div class="schedule-summary"><div><span>Missions completed</span><strong>${stats.tasksDone} / ${stats.tasksPlanned}</strong></div><div><span>Time intentionally focused</span><strong>${formatDuration(stats.focusedMinutes)}</strong></div><div><span>Time blocks planned</span><strong>${blocks.length}</strong></div><div><span>Daily execution score</span><strong>${stats.hasAnyActivity?stats.score+' / 100':'Not enough data'}</strong></div></div><button class="btn-ghost" style="width:100%;margin-top:24px" data-common="focus">${icon('focus')}Enter the Focus Room</button></article></div><article class="card"><div class="card-header"><div><h3>Today’s missions</h3><p class="meta">${tasks.filter((t)=>!t.done).length} open · ${tasks.filter((t)=>t.done).length} complete</p></div><button class="text-button" data-common="new-task">${icon('plus')}Add mission</button></div>${tasks.length?tasks.map((t)=>priorityRow(t,tasks.indexOf(t),{reorder:false})).join(''):empty('missions','A little intention goes a long way.','Add a mission, estimate your time, and give it a place in your day.',`<button class="btn-primary" data-common="new-task">${icon('plus')}Add a mission</button>`)}</article>`
  bindCommon(section)
  qsa(section, '[data-priority-toggle]').forEach((b)=>b.addEventListener('click',()=>window.CC.toggleMission(b.dataset.priorityToggle)))
  qsa(section, '[data-priority-edit]').forEach((b)=>b.addEventListener('click',()=>window.CC.openTaskModal(b.dataset.priorityEdit)))
  qsa(section, '[data-priority-delay]').forEach((b)=>b.addEventListener('click',()=>window.CC.openRescheduleModal(b.dataset.priorityDelay)))
  qsa(section, '[data-priority-up],[data-priority-down]').forEach((b)=>b.addEventListener('click',()=>{const id=b.dataset.priorityUp||b.dataset.priorityDown;window.CC.movePriority(id,b.dataset.priorityUp?-1:1)}))
}
