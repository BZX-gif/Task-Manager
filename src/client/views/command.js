/* -------------------------------------------------------------------------
   COMMAND CENTER — the executive home
   -------------------------------------------------------------------------
   This is the first screen and it is deliberately not a task list. It answers,
   in order:

     1. One decision that matters now            → command card + index
     2. Whether the week physically fits         → capacity board
     3. The few signals worth watching           → signal grid
     4. What to do next, in order                → next actions
     5. What yesterday actually cost and gave    → momentum + ledger pulse

   Everything is derived from real records through lib/command.js. No number
   on this screen is decorative.
   ------------------------------------------------------------------------- */

import { state, currentDayKey, todayStats } from '../core/store.js'
import { escapeHtml, qs, qsa } from '../core/dom.js'
import { addDays, formatDuration, weekdayShort } from '../lib/dates.js'
import { rangeDayStats } from '../lib/daystats.js'
import { goalProgress, goalChain } from '../lib/relationships.js'
import { top3Stats } from '../lib/top3.js'
import { overdueTasks } from '../lib/score.js'
import { sessionTotals } from '../lib/focus.js'
import { budgetStatus, formatMoney, monthSummary, moneyAdvice, noteSummary, recurringMonthlyTotal } from '../lib/ledger.js'
import { commandIndex, commandLine, headline, healthSignals, indexVerdict, loadPlan, nextActions, trendOf, weekdayRhythm } from '../lib/command.js'
import { drawChart, chartColors } from '../core/charts.js'
import { icon, ring, empty, metric, bindCommon } from '../ui/common.js'
import { greetingLine, intentionFor, salutationOf } from '../lib/briefing.js'
import { updateClockAndGreeting } from '../ui/chrome.js'

const TONE_ICON = { warn: 'bolt', good: 'leaf', info: 'info' }

export function renderCommand() {
  const section = document.getElementById('view-command')
  if (!section) return
  const today = currentDayKey()
  const now = new Date()
  const stats = todayStats(now)
  const head = headline(state, { todayKey: today, now })
  const index = commandIndex(state, { todayKey: today, now })
  const signals = healthSignals(state, { todayKey: today, now })
  const week = loadPlan(state, { todayKey: today, now, days: 7 })
  const actions = nextActions(state, { todayKey: today, now, limit: 4 })
  const rhythm = weekdayRhythm(state, { todayKey: today, now })
  const history = rangeDayStats(state, addDays(today, -13), today, { todayKey: today, now })
  const scoreTrend = trendOf(history.map((row) => row.score))
  const focusTrend = trendOf(history.map((row) => row.focusedMinutes))
  const focusToday = sessionTotals(state.focus.sessions, today).focusedMinutes
  const focusTarget = state.settings.focus?.targetMinutes || 180
  const top3 = top3Stats(state, today)
  const overdue = overdueTasks(state, today)
  const currency = state.settings.money?.currency || 'INR'
  const month = today.slice(0, 7)
  const money = monthSummary(state.ledger, month, { categories: state.categories })
  const budgets = budgetStatus(state.ledger, month, state.categories)
  const advice = moneyAdvice(state.ledger, { todayKey: today, month, categories: state.categories, currency })
  const notes = noteSummary(state.ledger)
  const recurring = recurringMonthlyTotal(state.ledger)
  const goals = state.goals.filter((goal) => goal.status !== 'cancelled').slice(0, 3)
  const showMoney = state.settings.money?.showInOverview !== false && (state.ledger.accounts.length > 0 || money.txCount > 0)
  const salute = salutationOf(state)
  const intention = intentionFor(state, today)
  const dateLine = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  section.innerHTML = `
    <header class="command-hero">
      <div class="command-hero-copy">
        <p class="eyebrow">${escapeHtml(dateLine.toUpperCase())} · COMMAND CENTER</p>
        <h1 id="command-greeting">${escapeHtml(greetingLine(state, now))}</h1>
        <p class="command-hero-line">${escapeHtml(head.reason)}</p>
        <button class="greeting-intention ${intention ? '' : 'is-empty'}" data-common="briefing">${icon('flag')}<span>${intention ? escapeHtml(intention) : 'Set today’s intention'}</span>${icon('chevron')}</button>
      </div>
      <div class="command-hero-side">
        <div class="command-hero-clock"><span id="command-clock">--:--</span><small>${escapeHtml(commandLine(state, { todayKey: today, now }))}</small></div>
        <div class="command-hero-actions">
          <button class="btn btn-secondary btn-small" data-common="briefing">${icon('bell')}Briefing<kbd>B</kbd></button>
          <button class="btn-primary btn-small" data-action="quick-capture">${icon('bolt')}Capture</button>
        </div>
      </div>
    </header>

    <div class="command-top">
      <article class="card command-focus-card command-focus-card--${head.tone}">
        <div class="command-focus-head">
          <span class="command-focus-icon">${icon(head.icon)}</span>
          <p class="eyebrow">${escapeHtml(head.tone === 'warn' ? 'NEEDS A DECISION' : head.tone === 'good' ? 'IN GOOD ORDER' : 'WORTH ATTENTION')}</p>
        </div>
        <h2>${escapeHtml(head.title)}</h2>
        <p class="command-focus-detail">${escapeHtml(head.detail)}</p>
        <div class="command-focus-actions">
          <button class="btn-primary" data-action="go-${head.view}">${icon('arrow')}${escapeHtml(head.action)}</button>
          <button class="btn-ghost" data-common="plan">${icon('sun')}Plan my day</button>
        </div>
        <div class="command-focus-meta">
          <span>${icon('shield')}${overdue.length ? `${overdue.length} overdue` : 'Nothing overdue'}</span>
          <span>${icon('calendar')}${week.overcommitted ? `${week.overcommitted} day${week.overcommitted === 1 ? '' : 's'} over capacity` : 'The week fits'}</span>
          <span>${icon('focus')}${formatDuration(focusToday)} focused</span>
        </div>
      </article>

      <article class="card command-index-card">
        <div class="card-header"><div><h3>Command index</h3><p class="meta">Four pillars · only what is measured</p></div><button class="text-button" data-index-info aria-label="How the index is built">${icon('info')}</button></div>
        <div class="command-index-main">
          ${ring(index.index ?? 0, 'of 100', index.index == null)}
          <div class="command-index-copy">
            <strong>${index.index == null ? 'Not enough yet' : index.index >= 70 ? 'In command' : index.index >= 45 ? 'Holding' : 'Rebuilding'}</strong>
            <p>${escapeHtml(indexVerdict(index.index))}</p>
          </div>
        </div>
        <div class="command-pillars">
          ${index.pillars.map((pillar) => `<button class="command-pillar ${pillar.available ? '' : 'is-empty'}" data-action="go-${pillar.view}" title="${escapeHtml(pillar.caption)}"><span>${icon(pillar.icon)}${escapeHtml(pillar.label)}</span><strong>${pillar.available ? pillar.value : '—'}</strong><div class="progress-track"><div class="progress-fill" style="width:${pillar.value || 0}%"></div></div></button>`).join('')}
        </div>
      </article>
    </div>

    <div class="command-signals">
      ${signals.map((signal) => `
        <button class="command-signal ${signal.good ? 'is-good' : signal.warn ? 'is-warn' : ''}" data-action="go-${signal.view}">
          <span class="command-signal-top">${icon(signal.icon)}${escapeHtml(signal.label)}</span>
          <strong>${escapeHtml(signal.display)}</strong>
          <small>${escapeHtml(signal.caption)}</small>
          <span class="command-signal-bar"><i style="width:${Math.min(100, Math.max(2, signal.value || 0))}%"></i></span>
        </button>`).join('')}
    </div>

    <div class="command-grid">
      <article class="card command-week-card">
        <div class="card-header">
          <div><h3>Can the week hold this?</h3><p class="meta">${formatDuration(week.totalPlanned)} promised against ${formatDuration(week.totalCapacity)} of realistic capacity</p></div>
          <div class="segmented" aria-label="Capacity horizon">${[7, 14].map((days) => `<button data-week-horizon="${days}" class="${days === 7 ? 'seg-active' : ''}">${days} days</button>`).join('')}</div>
        </div>
        <div class="command-week" data-week-board>
          ${week.rows.map((row) => `<button class="command-week-day is-${row.status}" data-action="go-schedule" title="${escapeHtml(`${row.weekday}: ${formatDuration(row.plannedMinutes)} planned of ${formatDuration(row.capacity)}${row.conflicts ? ' · conflict' : ''}`)}">
            <span class="command-week-name">${row.isToday ? 'Today' : escapeHtml(row.weekday)}</span>
            <span class="command-week-bar"><i style="height:${Math.min(100, Math.max(4, row.share))}%"></i></span>
            <span class="command-week-meta">${row.plannedMinutes ? formatDuration(row.plannedMinutes) : '—'}</span>
            <span class="command-week-flag">${row.conflicts ? icon('flag') : row.status === 'over' ? icon('bolt') : row.status === 'empty' ? icon('leaf') : ''}</span>
          </button>`).join('')}
        </div>
        <div class="command-week-foot">
          <span>${icon(week.overcommitted ? 'bolt' : 'shield')}${week.overcommitted ? `${week.overcommitted} day${week.overcommitted === 1 ? '' : 's'} need a decision` : 'Nothing is overcommitted'}</span>
          <span>${formatDuration(week.freeMinutes)} still unclaimed</span>
          <button class="text-button" data-common="forecast">Forecast ${icon('arrow')}</button>
        </div>
      </article>

      <article class="card command-actions-card">
        <div class="card-header"><div><h3>Your next four moves</h3><p class="meta">Ordered by what unblocks the most</p></div>${icon('command')}</div>
        ${actions.length
          ? `<ol class="command-actions">${actions.map((action, position) => `<li><button class="command-action is-${action.tone}" data-action="go-${action.view}"><span class="command-action-num">${position + 1}</span><span class="command-action-body"><strong>${escapeHtml(action.label)}</strong><small>${escapeHtml(action.hint)}</small></span>${icon('chevron')}</button></li>`).join('')}</ol>`
          : empty('shield', 'Nothing is waiting.', 'The system is quiet. That is a result, not a gap.')}
        <div class="command-actions-foot">
          <button class="text-button" data-common="new-task">${icon('plus')}New mission</button>
          <button class="text-button" data-common="review">${icon('review')}Weekly review</button>
          <button class="text-button" data-common="assistant">${icon('sparkles')}Ask the assistant</button>
        </div>
      </article>
    </div>

    <div class="command-grid command-grid--thirds">
      <article class="card command-momentum-card">
        <div class="card-header"><div><h3>Two weeks, honestly</h3><p class="meta">Execution score and focused minutes from recorded days</p></div><div class="chart-legend"><span><i></i>Score</span><span><i class="legend-line"></i>Focus</span></div></div>
        <div class="chart-wrap command-chart"><canvas id="commandMomentumChart" role="img" aria-label="Execution score and focused minutes for the last fourteen days"></canvas></div>
        <div class="command-trends">
          <span class="${scoreTrend?.direction === 'up' ? 'is-up' : scoreTrend?.direction === 'down' ? 'is-down' : ''}">${icon(scoreTrend?.direction === 'down' ? 'down' : 'trend')}Score ${scoreTrend ? `${scoreTrend.delta >= 0 ? '+' : ''}${scoreTrend.delta} vs the week before` : 'needs a few recorded days'}</span>
          <span class="${focusTrend?.direction === 'up' ? 'is-up' : focusTrend?.direction === 'down' ? 'is-down' : ''}">${icon(focusTrend?.direction === 'down' ? 'down' : 'focus')}Focus ${focusTrend ? `${focusTrend.delta >= 0 ? '+' : ''}${focusTrend.delta}m vs the week before` : 'needs a few sessions'}</span>
        </div>
      </article>

      <article class="card command-rhythm-card">
        <div class="card-header"><div><h3>Your real week</h3><p class="meta">Average score by weekday · last 8 weeks</p></div>${icon('analytics')}</div>
        <div class="command-rhythm">
          ${rhythm.days.map((day) => `<div class="command-rhythm-day"><div class="command-rhythm-bar"><i style="height:${day.average == null ? 0 : Math.max(3, day.average)}%"></i></div><span>${escapeHtml(day.label)}</span><small>${day.average == null ? '—' : day.average}</small></div>`).join('')}
        </div>
        <p class="command-rhythm-note">${rhythm.best ? `${escapeHtml(rhythm.best.label)} is your strongest day (${rhythm.best.average}). ${escapeHtml(rhythm.hardest.label)} is the hardest (${rhythm.hardest.average}) — plan lighter there instead of pretending otherwise.` : 'Two weeks of real activity and your weekly shape appears here.'}</p>
      </article>

      <article class="card command-today-card">
        <div class="card-header"><div><h3>Today, at a glance</h3><p class="meta">${stats.hasAnyActivity ? `${stats.score}/100 execution` : 'Nothing recorded yet'}</p></div><button class="text-button" data-action="go-day">My Day ${icon('chevrone')}</button></div>
        <div class="command-today-rows">
          <div><span>${icon('target')}Priorities</span><strong>${top3.done}/${top3.total || 0}</strong></div>
          <div><span>${icon('missions')}Missions</span><strong>${stats.tasksDone}/${stats.tasksPlanned}</strong></div>
          <div><span>${icon('focus')}Deep work</span><strong>${formatDuration(focusToday)}</strong><small>of ${formatDuration(focusTarget)}</small></div>
          <div><span>${icon('calendar')}Adherence</span><strong>${stats.blocksElapsed ? Math.round(stats.adherence * 100) + '%' : '—'}</strong></div>
        </div>
        <div class="progress-track command-today-bar"><div class="progress-fill" style="width:${Math.min(100, Math.round((focusToday / focusTarget) * 100))}%"></div></div>
        <div class="command-today-actions">
          <button class="btn-primary btn-small" data-common="focus">${icon('play')}Focus room</button>
          <button class="btn-ghost btn-small" data-common="plan">${icon('sun')}Plan</button>
          ${overdue.length ? `<button class="btn-ghost btn-small" data-common="recover">${icon('recover')}Recover</button>` : ''}
        </div>
      </article>
    </div>

    ${showMoney ? `
    <div class="command-grid command-grid--split">
      <article class="card command-money-card">
        <div class="card-header"><div><h3>Money, this month</h3><p class="meta">${escapeHtml(moneyAdvice(state.ledger, { todayKey: today, month, categories: state.categories, currency }).title)}</p></div><button class="text-button" data-action="go-money">Ledger ${icon('arrow')}</button></div>
        <div class="command-money-strip">
          <div><span>In</span><strong class="success">${formatMoney(money.income, { currency })}</strong></div>
          <div><span>Out</span><strong>${formatMoney(money.expense, { currency })}</strong></div>
          <div><span>Kept</span><strong class="${money.net >= 0 ? 'success' : 'danger'}">${formatMoney(money.net, { currency, sign: true })}</strong></div>
        </div>
        ${budgets.length ? `<div class="command-money-budgets">${budgets.slice(0, 3).map((row) => `<div class="command-money-budget ${row.over ? 'is-over' : ''}"><span>${escapeHtml(row.name)}</span><div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, row.pct)}%;${row.over ? 'background:var(--danger)' : ''}"></div></div><strong>${row.pct}%</strong></div>`).join('')}</div>` : `<p class="form-hint">${escapeHtml(advice.body)}</p>`}
        <div class="command-money-foot">
          <span>${icon('repeat')}${formatMoney(recurring, { currency })} recurring</span>
          <span>${icon('users')}${formatMoney(notes.net, { currency, sign: true })} in IOUs</span>
        </div>
      </article>

      <article class="card command-goals-card">
        <div class="card-header"><div><h3>What this is all for</h3><p class="meta">${goals.length ? 'Progress from real missions, not guesses' : 'No goals yet'}</p></div><button class="text-button" data-common="goals">Goals ${icon('arrow')}</button></div>
        ${goals.length
          ? goals.map((goal) => { const progress = goalProgress(state, goal); return `<button class="command-goal" data-goal="${escapeHtml(goal.id)}"><span class="command-goal-head"><strong>${escapeHtml(goal.title)}</strong><small>${escapeHtml(goal.category)}</small></span><div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div><span class="command-goal-meta">${progress}% · ${goal.milestones.filter((milestone) => milestone.done).length}/${goal.milestones.length} milestones</span></button>` }).join('')
          : empty('target', 'Direction beats speed.', 'One goal turns a list of missions into a strategy.', `<button class="btn-ghost" data-common="goal">${icon('plus')}Create a goal</button>`)}
      </article>
    </div>` : ''}

    <div class="command-footer">
      ${icon('lock')}<span>Every number above comes from records you made on this device. Nothing is uploaded, and nothing is estimated.</span>
      <button class="text-button" data-common="settings">Data & privacy ${icon('arrow')}</button>
    </div>`

  bindCommon(section)
  bindCommandActions(section, today)
  drawMomentumChart(history)
  updateClockAndGreeting()
}

function bindCommandActions(section, today) {
  qsa(section, '[data-action]').forEach((button) =>
    button.addEventListener('click', () => {
      const action = button.dataset.action
      if (action === 'quick-capture') { window.CC.openQuickCapture(); return }
      if (action.startsWith('go-')) { window.CC.switchView(action.slice(3)); return }
    }),
  )
  qsa(section, '[data-goal]').forEach((button) => button.addEventListener('click', () => window.CC.openGoalDetail(button.dataset.goal)))
  qs(section, '[data-index-info]')?.addEventListener('click', () => window.CC.openIndexInfo())
  qsa(section, '[data-week-horizon]').forEach((button) =>
    button.addEventListener('click', () => {
      const horizon = Number(button.dataset.weekHorizon)
      const board = qs(section, '[data-week-board]')
      if (!board) return
      const week = loadPlan(state, { todayKey: today, now: new Date(), days: horizon })
      board.innerHTML = week.rows
        .map(
          (row) => `<button class="command-week-day is-${row.status}" data-action="go-schedule" title="${escapeHtml(`${row.weekday}: ${formatDuration(row.plannedMinutes)} planned of ${formatDuration(row.capacity)}${row.conflicts ? ' · conflict' : ''}`)}">
            <span class="command-week-name">${row.isToday ? 'Today' : escapeHtml(row.weekday)}</span>
            <span class="command-week-bar"><i style="height:${Math.min(100, Math.max(4, row.share))}%"></i></span>
            <span class="command-week-meta">${row.plannedMinutes ? formatDuration(row.plannedMinutes) : '—'}</span>
            <span class="command-week-flag">${row.conflicts ? icon('flag') : row.status === 'over' ? icon('bolt') : ''}</span>
          </button>`,
        )
        .join('')
      qsa(section, '[data-week-horizon]').forEach((other) => {
        const active = other === button
        other.classList.toggle('seg-active', active)
        other.setAttribute('aria-pressed', String(active))
      })
    }),
  )
}

function drawMomentumChart(history) {
  const colors = chartColors()
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  drawChart('commandMomentumChart', {
    data: {
      labels: history.map((row) => weekdayShort(new Date(`${row.dateKey}T12:00:00`).getDay())),
      datasets: [
        { type: 'bar', label: 'Execution score', data: history.map((row) => (row.hasAnyActivity ? row.score : 0)), backgroundColor: history.map((row) => (row.dateKey === currentDayKey() ? colors.accent : colors.series)), hoverBackgroundColor: colors.accent, borderRadius: 4, maxBarThickness: 16, yAxisID: 'y' },
        { type: 'line', label: 'Focused minutes', data: history.map((row) => row.focusedMinutes), borderColor: colors.seriesStrong, backgroundColor: colors.series, tension: 0.35, borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 4, fill: false, yAxisID: 'y1' },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: reduced ? 0 : 420 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: colors.tooltipBg, titleColor: '#fff', bodyColor: colors.muted, borderColor: colors.tooltipBorder, borderWidth: 1, padding: 12, cornerRadius: 10 },
      },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: colors.muted, font: { size: 10 }, maxRotation: 0 } },
        y: { min: 0, max: 100, grid: { color: colors.border }, border: { display: false }, ticks: { color: colors.muted, font: { size: 9 }, stepSize: 50, maxTicksLimit: 3 } },
        y1: { position: 'right', grid: { display: false }, border: { display: false }, ticks: { color: colors.muted, font: { size: 9 }, maxTicksLimit: 3 } },
      },
    },
  })
}
