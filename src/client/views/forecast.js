/* -------------------------------------------------------------------------
   FORECAST — two weeks of commitments at a glance
   -------------------------------------------------------------------------
   The only forward-looking view in the app: what is already promised, where
   it collides, and which day has room for one more thing.
   ------------------------------------------------------------------------- */

import { state, currentDayKey } from '../core/store.js'
import { escapeHtml, qsa } from '../core/dom.js'
import { addDays, durationHtml, formatDuration } from '../lib/dates.js'
import { buildForecast, forecastAdvice, busyShare, LOAD_LABELS } from '../lib/forecast.js'
import { drawChart, chartColors, alpha, vGrad } from '../core/charts.js'
import { icon, pageHeading, metric, empty, bindCommon, domainTabs, DOMAIN_TABS } from '../ui/common.js'

let horizon = 14

const STATUS_ICON = { light: 'leaf', balanced: 'check', full: 'clock', over: 'bolt', conflict: 'flag' }

export function renderForecast() {
  const section = document.getElementById('view-forecast')
  if (!section) return
  const today = currentDayKey()
  const forecast = buildForecast(state, { todayKey: today, days: horizon })
  const advice = forecastAdvice(forecast)

  section.innerHTML = `
    ${pageHeading(
      'LOOKING AHEAD',
      'The next two weeks, honestly.',
      'Everything already promised — timetable, missions, and the work you have not placed yet. Rest blocks are not counted.',
      `<button class="btn-ghost" data-forecast-plan>${icon('calendar')}Plan today</button>`,
    )}
    ${domainTabs('forecast', DOMAIN_TABS.analytics)}
    <div class="segmented forecast-horizon" aria-label="Forecast horizon">
      ${[7, 14, 30].map((days) => `<button data-forecast-horizon="${days}" class="${horizon === days ? 'seg-active' : ''}">${days} days</button>`).join('')}
    </div>
    <div class="forecast-advice forecast-advice--${advice.tone}" role="status">
      <span class="forecast-advice-icon">${icon(advice.tone === 'warn' ? 'bolt' : advice.tone === 'good' ? 'leaf' : 'info')}</span>
      <div><strong>${escapeHtml(advice.title)}</strong><p>${escapeHtml(advice.body)}</p></div>
    </div>
    <div class="metric-strip forecast-metrics">
      ${metric('calendar', 'Committed time', durationHtml(forecast.totalPlanned), `across ${horizon} days · ${forecast.totalBlocks} blocks`)}
      ${metric('focus', 'Daily average', durationHtml(forecast.averagePlanned), `${forecast.averageLoadPct}% of a ${forecast.capacityLabel} focused day`)}
      ${metric('bolt', 'Days needing a decision', `${forecast.heavyDays.length}`, forecast.heavyDays.length ? 'Over 92% committed or double-booked' : 'Nothing is overcommitted')}
      ${metric('missions', 'Carried over', `${forecast.carriedCount}`, forecast.carriedCount ? `${formatDuration(forecast.overdueMinutes)} of unresolved work` : 'Nothing is following you in')}
    </div>
    <div class="forecast-grid">
      <article class="card forecast-chart-card">
        <div class="card-header">
          <div><h3>Committed load</h3><p class="meta">Minutes already promised · ${busyShare(forecast)}% of days are busy</p></div>
          <div class="chart-legend"><span><i></i>Committed</span><span><i class="legend-line"></i>Capacity</span></div>
        </div>
        <div class="chart-wrap chart-tall"><canvas id="forecastChart" role="img" aria-label="Committed minutes per day for the next ${horizon} days against a ${forecast.capacityLabel} capacity"></canvas></div>
        <details class="chart-data"><summary>View the forecast data</summary><table><thead><tr><th>Day</th><th>Committed</th><th>Blocks</th><th>HYB unplaced</th><th>Status</th></tr></thead><tbody>${forecast.days
          .map((row) => `<tr><td>${row.key} (${row.weekday})</td><td>${formatDuration(row.plannedMinutes)}</td><td>${row.blockCount}</td><td>${row.hybCount ? `${formatDuration(row.hybMinutes)} · ${row.hybCount}` : '—'}</td><td>${LOAD_LABELS[row.status]}</td></tr>`)
          .join('')}</tbody></table></details>
      </article>
      <article class="card forecast-balance-card">
        <div class="card-header"><div><h3>Where the time goes</h3><p class="meta">Committed minutes by category</p></div>${icon('target')}</div>
        ${forecast.balance.length
          ? `<div class="forecast-balance">${forecast.balance
              .slice(0, 7)
              .map(
                (row) => `<div class="forecast-balance-row">
                  <span class="forecast-balance-label"><i class="legend-dot" style="background:${escapeHtml(row.color)}"></i>${escapeHtml(row.name)}</span>
                  <div class="progress-track"><div class="progress-fill" style="width:${row.share}%;background:${escapeHtml(row.color)}"></div></div>
                  <strong>${formatDuration(row.minutes)}</strong>
                </div>`,
              )
              .join('')}</div>`
          : empty('target', 'Nothing committed yet.', 'Add missions or timetable blocks and the balance appears here.')}
        ${forecast.lightest
          ? `<button class="forecast-lightest" data-forecast-day="${forecast.lightest.key}">
              <span>${icon('leaf')}<span><strong>${forecast.lightest.weekday}</strong> has the most room</span></span>
              <span class="meta">${formatDuration(forecast.lightest.freeMinutes)} free</span>
            </button>`
          : ''}
      </article>
    </div>
    <article class="card forecast-days-card">
      <div class="card-header"><div><h3>Day by day</h3><p class="meta">${forecast.totalHybCount ? `${formatDuration(forecast.totalHybMinutes)} of HYB plans still unplaced · select a day to open its planner` : 'Select a day to open its planner'}</p></div>${icon('calendar')}</div>
      <div class="forecast-days">
        ${forecast.days
          .map(
            (row) => `<button class="forecast-day forecast-day--${row.status} ${row.isToday ? 'is-today' : ''}" data-forecast-day="${row.key}" aria-label="${row.key}: ${formatDuration(row.plannedMinutes)} committed${row.hybMinutes ? `, ${formatDuration(row.hybMinutes)} of HYB plans unplaced` : ''}, ${LOAD_LABELS[row.status]}">
              <span class="forecast-day-head"><span class="forecast-day-name">${row.isToday ? 'Today' : row.weekday}</span><span class="forecast-day-num">${row.dayOfMonth}</span></span>
              <span class="forecast-day-bar"><i style="width:${Math.min(100, row.loadPct)}%"></i></span>
              <span class="forecast-day-meta">${icon(STATUS_ICON[row.status])}${row.plannedMinutes ? formatDuration(row.plannedMinutes) : 'Free'}</span>
              ${row.hybCount ? `<span class="forecast-day-hyb">${icon('bolt')}${formatDuration(row.hybMinutes)} HYB</span>` : ''}
              ${row.conflictCount ? `<span class="forecast-day-flag">${row.conflictCount} clash${row.conflictCount === 1 ? '' : 'es'}</span>` : ''}
            </button>`,
          )
          .join('')}
      </div>
    </article>
    ${
      forecast.carriedCount
        ? `<article class="card forecast-carried-card"><div class="card-header"><div><h3>Following you forward</h3><p class="meta">Missions from earlier days that are still open</p></div>${icon('recover')}</div>
            <div class="forecast-carried">${forecast.carried
              .slice(0, 6)
              .map(
                (task) => `<button class="forecast-carried-row" data-forecast-task="${escapeHtml(task.id)}">
                  <span class="priority-dot priority-${escapeHtml(task.priority || 'medium')}"></span>
                  <span><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(task.date)} · ${formatDuration(task.estimateMinutes || 30)}</small></span>
                  ${icon('arrow')}
                </button>`,
              )
              .join('')}</div>
            <p class="form-hint">Decide once: do it, shrink it, or let it go. Carried work is heavier than the work itself.</p>
          </article>`
        : ''
    }`

  bindCommon(section)
  qsa(section, '[data-forecast-horizon]').forEach((button) =>
    button.addEventListener('click', () => {
      horizon = Number(button.dataset.forecastHorizon) || 14
      renderForecast()
    }),
  )
  qsa(section, '[data-forecast-day]').forEach((button) => button.addEventListener('click', () => window.CC.openDayPlanner({ date: button.dataset.forecastDay })))
  qsa(section, '[data-forecast-task]').forEach((button) => button.addEventListener('click', () => window.CC.openTaskModal(button.dataset.forecastTask)))
  section.querySelector('[data-forecast-plan]')?.addEventListener('click', () => window.CC.openDayPlanner({ date: today }))

  drawForecastChart(forecast)
}

function drawForecastChart(forecast) {
  const colors = chartColors()
  const labels = forecast.days.map((row) => (row.isToday ? 'Today' : `${row.weekday} ${row.dayOfMonth}`))
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  const statusColor = (status) => {
    if (status === 'conflict') return colors.danger || '#EFA0A0'
    if (status === 'over') return colors.warning || '#E2BC85'
    return colors.seriesStrong
  }
  drawChart('forecastChart', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Committed minutes',
          data: forecast.days.map((row) => row.plannedMinutes),
          backgroundColor: (ctx) => { const col = statusColor(forecast.days[ctx.dataIndex]?.status); return vGrad(ctx.chart, col, alpha(col, .5)) },
          hoverBackgroundColor: colors.accent,
          borderRadius: 5,
          maxBarThickness: 26,
          order: 2,
        },
        {
          label: 'Capacity',
          data: forecast.days.map(() => forecast.capacityMinutes),
          type: 'line',
          borderColor: colors.border,
          borderDash: [5, 5],
          borderWidth: 1,
          pointRadius: 0,
          fill: false,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: reduced ? 0 : 420 },
      interaction: { mode: 'index', intersect: false },
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
          callbacks: { label: (item) => `${item.dataset.label}: ${formatDuration(item.parsed.y)}` },
        },
      },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: colors.muted, maxRotation: 0, maxTicksLimit: 8, font: { size: 10 } } },
        y: {
          beginAtZero: true,
          grid: { color: colors.border },
          border: { display: false },
          ticks: { color: colors.muted, font: { size: 10 }, maxTicksLimit: 5, callback: (value) => `${Math.round(Number(value) / 60)}h` },
        },
      },
    },
  })
}

/** Used by the dashboard glance when a crunch is close. */
export function upcomingLoad(days = 7) {
  const today = currentDayKey()
  const forecast = buildForecast(state, { todayKey: today, days })
  return { forecast, next: forecast.heavyDays[0] || null, window: { from: today, to: addDays(today, days - 1) } }
}
