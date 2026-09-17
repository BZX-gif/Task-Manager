/* -------------------------------------------------------------------------
   PROGRESS — analytics: scores, categories, focus history, weekly review
   ------------------------------------------------------------------------- */

import { addDays, formatDuration, weekdayShort } from '../lib/dates.js'
import { categoryInsights, strongestAndWeakest } from '../lib/insights.js'
import { focusedMinutesByDay, sessionTotals } from '../lib/focus.js'
import { weeklyReview } from '../lib/review.js'
import { drawChart } from '../core/charts.js'
import { escapeHtml, qsa } from '../core/dom.js'
import { currentDayKey, state, statsFor } from '../core/store.js'
import { STATUS_STYLES, dayStatus } from '../ui/status.js'
import { emptyState, fieldRow } from './shared.js'
import { openWeeklyReview } from './review.js'

let range = 'week'
const RANGE_DAYS = { week: 7, month: 30, year: 365 }

export function renderProgress() {
  const section = document.getElementById('view-progress')
  if (!section) return
  const now = new Date()
  const today = currentDayKey(now)
  const days = RANGE_DAYS[range]
  const from = addDays(today, -(days - 1))
  const rows = []
  for (let i = days - 1; i >= 0; i--) {
    const key = addDays(today, -i)
    rows.push(statsFor(key, { now }))
  }

  const withData = rows.filter((r) => r.dateKey <= today && (r.hasAnyActivity || r.score > 0))
  const avgScore = withData.length ? Math.round(withData.reduce((s, r) => s + r.score, 0) / withData.length) : 0
  const totalFocus = rows.reduce((s, r) => s + r.focusedMinutes, 0)
  const totalSessions = rows.reduce((s, r) => s + r.focusSessions, 0)
  const completedSessions = rows.reduce((s, r) => s + r.completedSessions, 0)
  const planned = rows.reduce((s, r) => s + r.totalPlannedMinutes, 0)
  const completed = rows.reduce((s, r) => s + r.completedMinutes + r.taskDoneMinutes, 0)
  const completionPct = planned ? Math.round((completed / planned) * 100) : 0
  const categories = categoryInsights(state, { from, to: today, todayKey: today })
  const { strongest, weakest, recommendation } = strongestAndWeakest(categories)
  const review = weeklyReview(state, { dateKey: today, todayKey: today, now })
  const bestDay = withData.length ? withData.reduce((best, r) => (r.score > best.score ? r : best), withData[0]) : null

  section.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="section-title">Progress Analytics</h2>
        <p class="section-sub">Every number here comes from your own records — no estimates, no demo data.</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <div class="segmented" id="progress-range-seg">
          <button data-r="week" class="${range === 'week' ? 'seg-active' : ''}">Week</button>
          <button data-r="month" class="${range === 'month' ? 'seg-active' : ''}">Month</button>
          <button data-r="year" class="${range === 'year' ? 'seg-active' : ''}">Year</button>
        </div>
        <button class="btn-primary" data-action="review"><i class="fa-solid fa-clipboard-list mr-1.5"></i>Weekly Review</button>
      </div>
    </div>

    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
      ${statCard('Average score', `${avgScore}<span class="text-base text-slate-500">/100</span>`, `Best ${bestDay ? bestDay.score : 0} · ${bestDay ? escapeHtml(bestDay.dateKey) : '—'}`)}
      ${statCard('Completion', `${completionPct}%`, `${formatDuration(completed)} of ${formatDuration(planned)}`)}
      ${statCard('Focused time', formatDuration(totalFocus), `${totalSessions} session${totalSessions === 1 ? '' : 's'} · ${completedSessions} completed`)}
      ${statCard('Consistency', `${review.consistency}%`, `${review.activeDays}/7 active days this week`)}
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div class="glass-card p-5 lg:col-span-2">
        <h3 class="section-title text-base mb-1">Daily score trend</h3>
        <p class="text-[12px] text-slate-500 mb-4">Bars = daily score · line = focused minutes</p>
        <div class="h-[260px]"><canvas id="progressScoreChart"></canvas></div>
      </div>
      <div class="glass-card p-5">
        <h3 class="section-title text-base mb-4">Category performance</h3>
        ${categories.length
          ? `<div class="h-[180px]"><canvas id="progressCatChart"></canvas></div>
             <div class="mt-4 space-y-2">
               ${strongest ? fieldRow('Strongest area', `<span class="text-emerald-400">${escapeHtml(strongest.name)} ${strongest.completionPct}%</span>`) : ''}
               ${weakest ? fieldRow('Weakest area', `<span class="text-accent-5">${escapeHtml(weakest.name)} ${weakest.completionPct}%</span>`) : ''}
             </div>
             ${recommendation ? `<p class="text-[12.5px] text-slate-400 mt-3 leading-relaxed"><i class="fa-solid fa-lightbulb text-accent-4 mr-1.5"></i>${escapeHtml(recommendation)}</p>` : ''}`
          : emptyState({ icon: 'fa-solid fa-chart-pie', title: 'No category data yet', body: 'Log tasks and complete timetable blocks to build this view.' })}
      </div>
    </div>

    <div class="glass-card p-5">
      <h3 class="section-title text-base mb-4">Category breakdown</h3>
      ${
        categories.length
          ? `<div class="overflow-x-auto scroll-thin">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Area</th><th>Completion</th><th>Planned</th><th>Focused</th><th>Score</th>
                  </tr>
                </thead>
                <tbody>
                  ${categories
                    .map(
                      (c) => `
                    <tr>
                      <td><span class="flex items-center gap-2"><span class="legend-dot" style="background:${c.color}"></span>${escapeHtml(c.name)}</span></td>
                      <td>
                        <div class="flex items-center gap-2">
                          <div class="progress-track !h-1.5 w-20"><div class="progress-fill" style="width:${c.completionPct}%"></div></div>
                          <span class="text-[12px] text-slate-400">${c.completionPct}%</span>
                        </div>
                      </td>
                      <td class="text-slate-400">${formatDuration(c.plannedMinutes)}</td>
                      <td class="text-slate-400">${formatDuration(c.focusedMinutes)}</td>
                      <td><span class="chip ${c.score >= 70 ? 'chip-good' : c.score >= 45 ? 'chip-warn' : ''}">${c.score}</span></td>
                    </tr>`,
                    )
                    .join('')}
                </tbody>
              </table>
            </div>`
          : emptyState({ icon: 'fa-solid fa-table', title: 'Nothing to break down yet' })
      }
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div class="glass-card p-5">
        <h3 class="section-title text-base mb-4">Focus history</h3>
        <div class="h-[200px] mb-4"><canvas id="progressFocusChart"></canvas></div>
        <div class="space-y-2 max-h-[220px] overflow-y-auto scroll-thin pr-1">
          ${
            state.focus.sessions.length
              ? [...state.focus.sessions]
                  .reverse()
                  .slice(0, 12)
                  .map((s) => {
                    const task = s.taskId ? state.tasks.find((t) => t.id === s.taskId) : null
                    const minutes = Math.round((s.focusedSeconds || 0) / 60)
                    return `
                    <div class="flex items-center gap-3 text-[12.5px]">
                      <span class="chip ${s.mode === 'break' ? '' : 'chip-good'}">${s.mode === 'break' ? 'Break' : 'Focus'}</span>
                      <span class="text-slate-300 flex-1 truncate">${escapeHtml(task ? task.title : s.mode === 'break' ? 'Break' : 'Deep work')}</span>
                      <span class="text-slate-500">${minutes}m</span>
                      <span class="text-slate-600">${escapeHtml(s.date || '')}</span>
                      <span class="text-[11px] ${s.status === 'completed' ? 'text-emerald-400' : 'text-slate-500'}">${s.status}</span>
                    </div>`
                  })
                  .join('')
              : emptyState({ icon: 'fa-solid fa-stopwatch', title: 'No focus sessions yet', body: 'Start one from the dashboard or any task.' })
          }
        </div>
      </div>
      <div class="glass-card p-5">
        <h3 class="section-title text-base mb-4">Consistency map — last 12 weeks</h3>
        <div id="progress-heatmap" class="overflow-x-auto scroll-thin pb-2"></div>
        <div class="flex flex-wrap items-center gap-3 mt-3 text-[11px] text-slate-500">
          ${Object.entries(STATUS_STYLES)
            .map(([, style]) => `<span class="flex items-center gap-1.5"><span class="heat-cell" style="background:${style.cell}"></span>${style.label}</span>`)
            .join('')}
        </div>
        <p class="text-[11.5px] text-slate-500 mt-3 leading-relaxed">Green days satisfied the streak rule. Blue days had real activity but not enough to count.</p>
      </div>
    </div>
  `

  qsa(section, '#progress-range-seg button').forEach((btn) =>
    btn.addEventListener('click', () => {
      range = btn.dataset.r
      renderProgress()
    }),
  )
  section.querySelector('[data-action="review"]')?.addEventListener('click', () => openWeeklyReview())

  drawTrendChart(rows)
  drawCategoryChart(categories)
  drawFocusChart(rows)
  renderHeatmap(today)
}

function statCard(label, value, sub) {
  return `
    <div class="glass-card card-supporting p-4">
      <p class="section-eyebrow">${label}</p>
      <p class="stat-value">${value}</p>
      <p class="stat-sub">${sub}</p>
    </div>`
}

function drawTrendChart(rows) {
  drawChart('progressScoreChart', {
    type: 'bar',
    data: {
      labels: rows.map((r) => weekdayShort(new Date(`${r.dateKey}T12:00:00`).getDay())),
      datasets: [
        {
          label: 'Score',
          data: rows.map((r) => r.score),
          backgroundColor: rows.map((r) => (r.score >= 80 ? 'rgba(87,178,140,0.85)' : r.score >= 50 ? 'rgba(91,147,230,0.8)' : r.score > 0 ? 'rgba(207,159,95,0.75)' : 'rgba(255,255,255,0.06)')),
          borderRadius: 6,
          maxBarThickness: rows.length > 60 ? 6 : 26,
          yAxisID: 'y',
        },
        {
          type: 'line',
          label: 'Focus minutes',
          data: rows.map((r) => r.focusedMinutes),
          borderColor: '#57b28c',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.35,
          yAxisID: 'y1',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#828b99' } },
        y1: { position: 'right', min: 0, grid: { display: false }, ticks: { color: '#828b99', callback: (v) => `${v}m` } },
        x: { grid: { display: false }, ticks: { color: '#7c8499', maxRotation: 0, autoSkip: true } },
      },
    },
  })
}

function drawCategoryChart(categories) {
  if (!categories.length) return
  const withTime = categories.filter((c) => c.plannedMinutes > 0 || c.focusedMinutes > 0)
  if (!withTime.length) return
  drawChart('progressCatChart', {
    type: 'doughnut',
    data: {
      labels: withTime.map((c) => c.name),
      datasets: [
        {
          data: withTime.map((c) => c.plannedMinutes),
          backgroundColor: withTime.map((c) => c.color),
          borderColor: '#141820',
          borderWidth: 3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      plugins: { legend: { position: 'bottom', labels: { color: '#c2c8d2', boxWidth: 10, font: { size: 11 }, padding: 10 } } },
    },
  })
}

function drawFocusChart(rows) {
  drawChart('progressFocusChart', {
    type: 'bar',
    data: {
      labels: rows.map((r) => weekdayShort(new Date(`${r.dateKey}T12:00:00`).getDay())),
      datasets: [
        {
          label: 'Focused minutes',
          data: rows.map((r) => r.focusedMinutes),
          backgroundColor: 'rgba(91,147,230,0.55)',
          borderRadius: 6,
          maxBarThickness: rows.length > 60 ? 6 : 24,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { min: 0, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#828b99', callback: (v) => `${v}m` } },
        x: { grid: { display: false }, ticks: { color: '#7c8499', autoSkip: true, maxRotation: 0 } },
      },
    },
  })
}

function renderHeatmap(today) {
  const container = document.getElementById('progress-heatmap')
  if (!container) return
  const weeks = 12
  const start = addDays(today, -((weeks - 1) * 7) - 6)
  let cells = ''
  for (let i = 0; i < weeks * 7; i++) {
    const key = addDays(start, i)
    if (key > today) {
      cells += '<div class="heat-cell" style="background:transparent"></div>'
      continue
    }
    const status = dayStatus(state, key, today)
    const style = STATUS_STYLES[status.status]
    const title = `${key} · ${style.label}${status.reasons.length ? ` (${status.reasons.join(', ')})` : ''}`
    cells += `<div class="heat-cell" style="background:${style.cell}" title="${escapeHtml(title)}"></div>`
  }
  container.innerHTML = `<div class="heatmap-grid" style="grid-auto-flow:column;grid-template-rows:repeat(7,13px)">${cells}</div>`
}

/** Small helper used from the dashboard "focus today" tile. */
export function focusTodaySummary(now = new Date()) {
  const totals = sessionTotals(state.focus.sessions, currentDayKey(now))
  const byDay = focusedMinutesByDay(state.focus.sessions, currentDayKey(now), 7)
  return { totals, byDay }
}
