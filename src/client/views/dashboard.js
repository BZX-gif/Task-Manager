/* -------------------------------------------------------------------------
   DASHBOARD — "open the app, know what to do"
   Order: Daily Score + streak + focus, then Top 3 & Do This Now, then the
   live timetable position, then trends.
   ------------------------------------------------------------------------- */

import { formatDuration, minutesOfDay, nowMinutes as nowMinutesOf, weekdayShort } from '../lib/dates.js'
import { describeScoreFormula } from '../lib/score.js'
import { top3Candidates, top3Stats, TOP3_LIMIT } from '../lib/top3.js'
import { selectNextAction } from '../lib/nextaction.js'
import { overdueTasks } from '../lib/score.js'
import { PRIORITY_COLORS, PRIORITY_ORDER } from '../lib/defaults.js'
import { drawChart } from '../core/charts.js'
import { escapeHtml, hint, qsa, toast } from '../core/dom.js'
import { commit, currentDayKey, rollSeriesForward, state, statsFor, titleStates } from '../core/store.js'
import { disciplineStripHtml } from '../ui/titles.js'
import { statusForStreakDot } from './shared.js'
import { openFocusPickerForTask } from '../ui/focus.js'
import { openTaskModal } from './tasks.js'
import { openWeeklyReview } from './review.js'
import { openRecoveryModal } from './recovery.js'

export function renderDashboard() {
  const section = document.getElementById('view-dashboard')
  if (!section) return
  const now = new Date()
  const today = currentDayKey(now)
  const stats = statsFor(today, { now })
  const streakInfo = window.CC?.streakInfo?.() || { current: 0, best: 0, recent: [] }
  const action = currentAction(now, today)
  const top3 = top3Stats(state, today)
  const overdue = overdueTasks(state, today)
  const { current, next } = currentBlocks(now)
  const openToday = state.tasks
    .filter((t) => t.date === today && !t.done)
    .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1))
  const week = weekTrend(now)
  const titles = titleStates(now)

  section.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="section-title">Dashboard</h2>
        <p class="section-sub">${now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })} · ${state.timetable.length} scheduled blocks · ${openToday.length} open task${openToday.length === 1 ? '' : 's'}</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="btn-ghost" data-action="recover"><i class="fa-solid fa-wand-magic-sparkles mr-1.5"></i>Recover My Day</button>
        <button class="btn-ghost" data-action="review"><i class="fa-solid fa-clipboard-list mr-1.5"></i>Weekly Review</button>
      </div>
    </div>

    <!-- Score · Streak · Focus -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div class="glass-card p-5 lg:col-span-2" data-card="score">
        <div class="flex items-start justify-between gap-3 mb-3">
          <div>
            <p class="text-[11px] uppercase tracking-wider font-bold text-slate-500">Today's Score ${hint(describeScoreFormula().join(' · '))}</p>
            <p class="font-display font-extrabold text-white text-4xl leading-none mt-1">
              ${stats.hasData ? stats.score : '–'}<span class="text-lg text-slate-500">/100</span>
            </p>
          </div>
          <div class="text-right">
            ${stats.hasData
              ? `<span class="chip ${stats.onTrack ? 'chip-good' : 'chip-warn'}">${stats.onTrack ? 'On track' : `Behind pace (${stats.pace})`}</span>`
              : '<span class="chip">No data yet</span>'}
            <p class="text-[11px] text-slate-500 mt-2">${stats.overdueCount ? `${stats.overdueCount} overdue task${stats.overdueCount > 1 ? 's' : ''}` : 'Nothing overdue'}</p>
          </div>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4" data-score-parts>
          ${scorePartsHtml(stats)}
        </div>
        <div class="progress-track mt-4"><div class="progress-fill" style="width:${stats.hasData ? stats.score : 0}%"></div></div>
      </div>

      <div class="glass-card p-5" data-card="streak">
        <div class="flex items-center justify-between mb-2">
          <p class="text-[11px] uppercase tracking-wider font-bold text-slate-500">Consistency</p>
          <i class="fa-solid fa-fire text-accent-4"></i>
        </div>
        <p class="font-display font-extrabold text-white text-3xl">🔥 ${streakInfo.current}<span class="text-base text-slate-500"> day${streakInfo.current === 1 ? '' : 's'}</span></p>
        <p class="text-[12px] text-slate-500 mt-1">Best streak: ${streakInfo.best} days</p>
        <div class="flex gap-1.5 mt-3">
          ${streakInfo.recent.map(statusForStreakDot).join('')}
        </div>
        <p class="text-[11.5px] text-slate-500 mt-3 leading-relaxed">
          A day counts with <span class="text-slate-300">all Top 3 done</span>, <span class="text-slate-300">score 60+</span> or <span class="text-slate-300">45+ focused minutes</span>.
        </p>
      </div>
    </div>

    <!-- Private title progression (small on purpose) -->
    ${disciplineStripHtml(titles)}

    <!-- Top 3 + Do This Now -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div class="glass-card top3-card p-5" data-card="top3">
        <div class="flex items-center justify-between mb-1">
          <h3 class="section-title text-base flex items-center gap-2"><span class="top3-badge">TODAY'S TOP 3</span></h3>
          <span class="text-[11px] text-slate-500">${top3.done}/${top3.total} done</span>
        </div>
        <p class="text-[12px] text-slate-500 mb-4">The three things that make today a win.</p>
        <div class="space-y-2.5" data-top3-list>
          ${top3ListHtml(top3)}
        </div>
        ${top3.total < TOP3_LIMIT
          ? `<div class="mt-4 pt-4 border-t border-white/5">
               <label class="field-label">Add a priority</label>
               <div class="flex flex-col sm:flex-row gap-2">
                 <select class="input-field flex-1" data-top3-picker>
                   <option value="">Choose an open task…</option>
                   ${top3Candidates(state, today, { overdueIds: overdue.map((t) => t.id) })
                     .map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.title)}</option>`)
                     .join('')}
                 </select>
                 <button class="btn-primary whitespace-nowrap" data-top3-add>Add to Top 3</button>
                 <button class="btn-ghost whitespace-nowrap" data-action="new-task">New task</button>
               </div>
             </div>`
          : ''}
      </div>

      <div class="glass-card now-card p-5" data-card="next-action">
        <p class="text-[11px] uppercase tracking-[0.25em] font-bold text-accent-2 mb-2">Do this now</p>
        <h3 class="font-display font-bold text-white text-xl leading-snug" data-next-title>${escapeHtml(action.title)}</h3>
        <div class="flex flex-wrap items-center gap-2 mt-2 text-[12px] text-slate-400">
          <span class="chip">${escapeHtml(action.reason)}</span>
          ${action.categoryId ? `<span class="chip">${escapeHtml(categoryName(action.categoryId))}</span>` : ''}
          ${action.minutes ? `<span class="chip"><i class="fa-regular fa-clock mr-1"></i>${formatDuration(action.minutes)}</span>` : ''}
          ${action.startsAt ? `<span class="chip">starts ${escapeHtml(action.startsAt)}</span>` : ''}
        </div>
        ${action.protectedLabel ? `<p class="text-[12px] text-amber-300 mt-3"><i class="fa-solid fa-moon mr-1.5"></i>This falls inside your protected “${escapeHtml(action.protectedLabel)}” window — pick it up after.</p>` : ''}
        <div class="flex flex-wrap gap-2.5 mt-5">
          ${action.kind !== 'clear'
            ? `<button class="btn-primary" data-next-start><i class="fa-solid fa-play mr-1.5"></i>Start Focus</button>
               ${action.task ? `<button class="btn-ghost" data-next-done><i class="fa-solid fa-check mr-1.5"></i>Mark done</button>` : ''}
               ${action.block ? `<button class="btn-ghost" data-next-block><i class="fa-solid fa-table-cells-large mr-1.5"></i>Timetable</button>` : ''}`
            : `<button class="btn-ghost" data-action="new-task"><i class="fa-solid fa-plus mr-1.5"></i>Plan something</button>`}
        </div>
        <p class="text-[11.5px] text-slate-500 mt-4">Picked automatically: Top 3 → running block → overdue → priority → next block.</p>
      </div>
    </div>

    <!-- Right now / queue -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div class="glass-card p-5 lg:col-span-2">
        <div class="flex items-center justify-between mb-4">
          <h3 class="section-title">Right Now</h3>
          <span class="text-[11px] text-slate-500">${now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</span>
        </div>
        ${current
          ? `<div class="tt-row active-now mb-3" style="--cat-color:${categoryColor(current.cat)}">
               <div class="tt-time">${escapeHtml(current.time)}</div>
               <div class="min-w-0">
                 <p class="tt-title truncate">${escapeHtml(current.title)}</p>
                 <p class="text-[11px] text-slate-500">${escapeHtml(categoryName(current.cat))} · ${current.duration || 60} min · ${endsIn(current, now)} left</p>
               </div>
               <div class="flex items-center gap-2">
                 <span class="dot bg-emerald-400 animate-pulse-slow" style="width:10px;height:10px"></span>
                 <button class="icon-btn" data-focus-block="${escapeHtml(current.id)}" title="Focus on this block"><i class="fa-solid fa-stopwatch text-xs"></i></button>
               </div>
             </div>`
          : `<div class="empty-state !py-6"><i class="fa-regular fa-clock"></i><p class="text-sm">No block scheduled right now</p></div>`}
        ${next
          ? `<p class="text-[11px] uppercase tracking-wider font-bold text-slate-500 mb-2 mt-4">Up Next</p>
             <div class="tt-row" style="--cat-color:${categoryColor(next.cat)}">
               <div class="tt-time">${escapeHtml(next.time)}</div>
               <div class="min-w-0"><p class="tt-title truncate">${escapeHtml(next.title)}</p><p class="text-[11px] text-slate-500">${escapeHtml(categoryName(next.cat))} ${next.duration ? `· ${next.duration} min` : ''}</p></div>
               <i class="fa-solid fa-arrow-right text-slate-600"></i>
             </div>`
          : ''}
      </div>

      <div class="glass-card p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="section-title text-base">Open Tasks</h3>
          <button class="icon-btn" data-action="new-task" title="Add task"><i class="fa-solid fa-plus"></i></button>
        </div>
        <div class="space-y-2.5 max-h-[300px] overflow-y-auto scroll-thin pr-1">
          ${openToday.length
            ? openToday.slice(0, 8).map((t) => taskLineHtml(t, today)).join('')
            : `<div class="empty-state !py-8"><i class="fa-regular fa-square-check"></i><p class="text-sm">Nothing open for today</p><button class="btn-ghost mt-3 !text-xs" data-action="new-task">Add a task</button></div>`}
        </div>
        ${overdue.length
          ? `<div class="mt-4 pt-3 border-t border-white/5">
               <p class="text-[11px] uppercase tracking-wider font-bold text-accent-5 mb-2">Overdue (${overdue.length})</p>
               ${overdue.slice(0, 3).map((t) => taskLineHtml(t, today)).join('')}
             </div>`
          : ''}
      </div>
    </div>

    <!-- Trends -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div class="glass-card p-5 lg:col-span-2">
        <div class="flex items-center justify-between mb-4">
          <h3 class="section-title">Last 7 Days</h3>
          <div class="flex items-center gap-3 text-[11px] text-slate-500">
            <span class="flex items-center gap-1.5"><span class="legend-dot" style="background:#7c5cff"></span>Score</span>
            <span class="flex items-center gap-1.5"><span class="legend-dot" style="background:#22d3ee"></span>Focus min</span>
          </div>
        </div>
        <div class="h-[220px]"><canvas id="dashWeekChart"></canvas></div>
      </div>
      <div class="glass-card p-5">
        <h3 class="section-title text-base mb-4">Categories this week</h3>
        <div class="space-y-3">
          ${week.categories
            .map(
              (c) => `
            <div>
              <div class="flex items-center gap-2.5 mb-1.5">
                <span class="legend-dot" style="background:${c.color}"></span>
                <span class="text-sm text-slate-300 flex-1 truncate">${escapeHtml(c.name)}</span>
                <span class="text-xs text-slate-500">${c.completionPct}%</span>
              </div>
              <div class="progress-track !h-1.5"><div class="progress-fill" style="width:${c.completionPct}%"></div></div>
            </div>`,
            )
            .join('')}
        </div>
        <div class="mt-5 pt-4 border-t border-white/5">
          <p class="text-[11px] uppercase tracking-wider font-bold text-slate-500 mb-2">Today's Quote</p>
          <p class="text-sm text-slate-300 italic leading-relaxed" id="dash-quote"></p>
        </div>
      </div>
    </div>
  `

  bindDashboard(section, { today, action })
  drawWeekChart(week)
  if (window.CC?.refreshQuoteInline) window.CC.refreshQuoteInline()
}

/* --------------------------------------------------------------- sections */

function scorePartsHtml(stats) {
  return stats.scoreParts
    .map((part) => {
      const value = part.key === 'focus' ? formatDuration(stats.focusedMinutes) : part.detail
      const percent = part.available ? Math.round(part.ratio * 100) : 0
      return `
        <div class="score-part ${part.available ? '' : 'opacity-40'}">
          <p class="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">${part.label}</p>
          <p class="font-display font-bold text-white text-lg">${value}</p>
          <div class="progress-track !h-1 mt-1.5"><div class="progress-fill" style="width:${percent}%"></div></div>
        </div>`
    })
    .join('')
}

function top3ListHtml(top3) {
  if (!top3.total) {
    return `<div class="empty-state !py-6"><i class="fa-solid fa-ranking-star"></i><p class="text-sm">No priorities chosen yet</p><p class="text-[12px] text-slate-500">Pick the three tasks that define a good day.</p></div>`
  }
  return top3.items
    .map(({ task }, index) => {
      const minutes = Math.round(
        (state.focus.sessions || []).filter((s) => s.taskId === task.id && s.mode !== 'break').reduce((sum, s) => sum + s.focusedSeconds, 0) / 60,
      )
      return `
      <div class="top3-row ${task.done ? 'is-done' : ''}">
        <span class="top3-index">${index + 1}</span>
        <button class="task-check ${task.done ? 'checked' : ''}" data-top3-toggle="${escapeHtml(task.id)}" aria-label="Toggle ${escapeHtml(task.title)}"><i class="fa-solid fa-check"></i></button>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold text-slate-100 truncate">${escapeHtml(task.title)}</p>
          <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-slate-500">
            ${task.cat ? `<span>${escapeHtml(categoryName(task.cat))}</span>` : ''}
            <span><i class="fa-regular fa-clock mr-1"></i>${formatDuration(task.estimateMinutes || 30)}</span>
            ${minutes ? `<span class="text-accent-2">${formatDuration(minutes)} focused</span>` : ''}
          </div>
        </div>
        <div class="flex items-center gap-1">
          ${!task.done ? `<button class="icon-btn" data-top3-focus="${escapeHtml(task.id)}" title="Start focus session"><i class="fa-solid fa-play text-xs"></i></button>` : ''}
          <button class="icon-btn" data-top3-edit="${escapeHtml(task.id)}" title="Edit task"><i class="fa-solid fa-pen text-xs"></i></button>
          <button class="icon-btn" data-top3-remove="${escapeHtml(task.id)}" title="Remove from Top 3"><i class="fa-solid fa-xmark text-xs"></i></button>
        </div>
      </div>`
    })
    .join('')
}

function taskLineHtml(task, today) {
  const isOverdue = task.date && task.date < today && !task.done
  return `
    <div class="flex items-center gap-2.5 ${task.done ? 'opacity-50' : ''}">
      <button class="task-check ${task.done ? 'checked' : ''}" data-task-toggle="${escapeHtml(task.id)}" aria-label="Toggle task"><i class="fa-solid fa-check"></i></button>
      <span class="priority-dot" style="background:${PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium}"></span>
      <div class="flex-1 min-w-0">
        <p class="text-[13px] text-slate-200 truncate ${task.done ? 'line-through' : ''}">${escapeHtml(task.title)}</p>
        <p class="text-[11px] text-slate-500 truncate">
          ${isOverdue ? `<span class="text-accent-5">Overdue ${escapeHtml(task.date)}</span>` : ''}
          ${!isOverdue && task.cat ? escapeHtml(categoryName(task.cat)) : ''}
          ${!isOverdue && !task.cat ? 'No category' : ''}
        </p>
      </div>
      ${!task.done ? `<button class="icon-btn" data-task-focus="${escapeHtml(task.id)}" title="Start focus session"><i class="fa-solid fa-play text-xs"></i></button>` : ''}
    </div>`
}

/* ---------------------------------------------------------------- binding */

function bindDashboard(section, { today, action }) {
  qsa(section, '[data-open-title]').forEach((btn) =>
    btn.addEventListener('click', () => window.CC?.switchView?.('profile')),
  )

  qsa(section, '[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const kind = btn.dataset.action
      if (kind === 'new-task') openTaskModal()
      else if (kind === 'review') openWeeklyReview()
      else if (kind === 'recover') openRecoveryModal()
    })
  })

  qsa(section, '[data-top3-toggle]').forEach((btn) =>
    btn.addEventListener('click', () => toggleTask(btn.dataset.top3Toggle)),
  )
  qsa(section, '[data-top3-remove]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const id = btn.dataset.top3Remove
      commit((s) => {
        s.top3[today] = (s.top3[today] || []).filter((x) => x !== id)
        if (!s.top3[today].length) delete s.top3[today]
      })
      toast('Removed from Top 3', 'info')
    }),
  )
  qsa(section, '[data-top3-edit]').forEach((btn) => btn.addEventListener('click', () => openTaskModal(btn.dataset.top3Edit)))
  qsa(section, '[data-top3-focus]').forEach((btn) => btn.addEventListener('click', () => openFocusPickerForTask(btn.dataset.top3Focus)))
  qsa(section, '[data-task-toggle]').forEach((btn) => btn.addEventListener('click', () => toggleTask(btn.dataset.taskToggle)))
  qsa(section, '[data-task-focus]').forEach((btn) => btn.addEventListener('click', () => openFocusPickerForTask(btn.dataset.taskFocus)))

  section.querySelector('[data-top3-add]')?.addEventListener('click', () => {
    const select = section.querySelector('[data-top3-picker]')
    const id = select?.value
    if (!id) {
      toast('Pick a task first', 'error')
      return
    }
    const result = window.CC.addTaskToTop3(id)
    if (!result.ok) toast(result.reason || 'Could not add to Top 3', 'error')
    else toast('Added to today\'s Top 3', 'success')
  })

  section.querySelector('[data-next-start]')?.addEventListener('click', () => {
    if (action.task) openFocusPickerForTask(action.task.id)
    else if (action.block) openFocusPickerForTask(null)
    else window.CC.openFocusMode(undefined)
  })
  section.querySelector('[data-next-done]')?.addEventListener('click', () => {
    if (action.task) toggleTask(action.task.id)
  })
  section.querySelector('[data-next-block]')?.addEventListener('click', () => window.CC.switchView('timetable'))
  section.querySelector('[data-focus-block]')?.addEventListener('click', () => window.CC.openFocusMode(undefined))
}

function toggleTask(id) {
  const task = state.tasks.find((t) => t.id === id)
  if (!task) return
  /** @type {any} */
  let followUp = null
  commit((s) => {
    const target = s.tasks.find((t) => t.id === id)
    target.done = !target.done
    target.completedAt = target.done ? Date.now() : null
    if (target.done && target.recurrence) followUp = rollSeriesForward(target)
  })
  if (task.done) toast(`“${task.title}” completed 🎉`, 'success')
  if (followUp) toast(`Next occurrence created · ${followUp.date}`, 'info')
}

/* ------------------------------------------------------------- live pieces */

function currentBlocks(now) {
  const nowMin = nowMinutesOf(now)
  const sorted = [...state.timetable].sort((a, b) => minutesOfDay(a.time) - minutesOfDay(b.time))
  const log = state.completionLog[currentDayKey(now)] || { ttDone: [] }
  let current = null
  let next = null
  for (const block of sorted) {
    const start = minutesOfDay(block.time)
    const end = start + (block.duration || 60)
    if (nowMin >= start && nowMin < end && !log.ttDone.includes(block.id)) current = block
    if (nowMin < start && !next && !log.ttDone.includes(block.id)) next = block
  }
  return { current, next }
}

function currentAction(now, today) {
  const nowMin = nowMinutesOf(now)
  const log = state.completionLog[today] || { ttDone: [] }
  return selectNextAction({
    tasks: state.tasks,
    timetable: state.timetable,
    ttDone: log.ttDone,
    top3Ids: state.top3?.[today] || [],
    todayKey: today,
    nowMinutes: nowMin,
    protectedBlocks: state.settings.protectedTime || [],
  })
}

function weekTrend(now) {
  const today = currentDayKey(now)
  const rows = []
  let focusTotal = 0
  for (let i = 6; i >= 0; i--) {
    const date = new Date(now)
    date.setDate(date.getDate() - i)
    const key = currentDayKey(date)
    const stats = statsFor(key, { now })
    focusTotal += stats.focusedMinutes
    rows.push({ key, label: weekdayShort(date.getDay()), score: stats.score, focus: stats.focusedMinutes })
  }
  const categories = [...new Set(state.timetable.map((b) => b.cat).filter(Boolean))]
  const categoryRows = (state.categories.length ? state.categories : [])
    .map((cat) => {
      const blocks = state.timetable.filter((b) => b.cat === cat.id)
      let planned = 0
      let done = 0
      for (const row of rows) {
        const log = state.completionLog[row.key] || { ttDone: [] }
        for (const block of blocks) {
          planned++
          if (log.ttDone.includes(block.id)) done++
        }
      }
      return { ...cat, completionPct: planned ? Math.round((done / planned) * 100) : 0, planned }
    })
    .filter((c) => categories.includes(c.id))
  return { rows, focusTotal, categories: categoryRows }
}

function drawWeekChart(week) {
  drawChart('dashWeekChart', {
    type: 'line',
    data: {
      labels: week.rows.map((r) => r.label),
      datasets: [
        {
          label: 'Score',
          data: week.rows.map((r) => r.score),
          borderColor: '#7c5cff',
          backgroundColor: 'rgba(124,92,255,0.18)',
          fill: true,
          tension: 0.4,
          pointRadius: 3,
          yAxisID: 'y',
        },
        {
          label: 'Focus minutes',
          data: week.rows.map((r) => r.focus),
          borderColor: '#22d3ee',
          borderDash: [4, 4],
          tension: 0.4,
          pointRadius: 2,
          fill: false,
          yAxisID: 'y1',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false } },
      scales: {
        y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#7c8499' } },
        y1: { position: 'right', min: 0, grid: { display: false }, ticks: { color: '#7c8499', callback: (v) => `${v}m` } },
        x: { grid: { display: false }, ticks: { color: '#7c8499' } },
      },
    },
  })
}

/* -------------------------------------------------------------- small bits */

function categoryName(id) {
  return state.categories.find((c) => c.id === id)?.name || 'Uncategorised'
}

function categoryColor(id) {
  return state.categories.find((c) => c.id === id)?.color || '#7c5cff'
}

function endsIn(block, now) {
  const end = minutesOfDay(block.time) + (block.duration || 60)
  const left = Math.max(0, end - nowMinutesOf(now))
  return formatDuration(left)
}
