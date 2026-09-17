/* -------------------------------------------------------------------------
   DASHBOARD — "open the app, know what to do"
   Hierarchy (v2.3): TODAY (hero) → WHAT MATTERS (score, Top 3, next move)
   → PROGRESS (live schedule position) → SUPPORTING (trends, quote).
   Every number here comes from statsFor / streak / top3 — no invented data.
   ------------------------------------------------------------------------- */

import { formatDuration, minutesOfDay, nowMinutes as nowMinutesOf, weekdayShort } from '../lib/dates.js'
import { describeScoreFormula } from '../lib/score.js'
import { top3Candidates, top3Stats, TOP3_LIMIT } from '../lib/top3.js'
import { selectNextAction } from '../lib/nextaction.js'
import { overdueTasks } from '../lib/score.js'
import { PRIORITY_ORDER } from '../lib/defaults.js'
import { drawChart } from '../core/charts.js'
import { escapeHtml, hint, qsa, toast } from '../core/dom.js'
import { commit, currentDayKey, rollSeriesForward, state, statsFor, titlesInfo } from '../core/store.js'
import { statusForStreakDot } from './shared.js'
import { openFocusPickerForTask } from '../ui/focus.js'
import { openTaskModal } from './tasks.js'
import { openWeeklyReview } from './review.js'
import { openRecoveryModal } from './recovery.js'
import { formatUnlockDate } from '../lib/achievements.js'

export function renderDashboard() {
  const section = document.getElementById('view-dashboard')
  if (!section) return
  const now = new Date()
  const today = currentDayKey(now)
  const stats = statsFor(today, { now })
  const streakInfo = window.CC?.streakInfo?.() || { current: 0, best: 0, recent: [] }
  const titles = titlesInfo(now)
  const discipline = titles.disciplineMonster
  const action = currentAction(now, today)
  const top3 = top3Stats(state, today)
  const overdue = overdueTasks(state, today)
  const { current, next } = currentBlocks(now)
  const openToday = state.tasks
    .filter((t) => t.date === today && !t.done)
    .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1))
  const week = weekTrend(now)
  const hero = heroCopy({ stats, overdue, openToday, top3, next })

  section.innerHTML = `
    <!-- TODAY -->
    <header class="dash-hero">
      <p class="dash-hero-date">${now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</p>
      <h2 class="dash-hero-title">${escapeHtml(hero.title)}</h2>
      <p class="dash-hero-sub">${escapeHtml(hero.sub)}</p>
      <div class="dash-hero-actions">
        <button class="btn-ghost" data-action="recover"><i class="fa-solid fa-wand-magic-sparkles mr-1.5"></i>Recover My Day</button>
        <button class="btn-ghost" data-action="review"><i class="fa-solid fa-clipboard-list mr-1.5"></i>Weekly Review</button>
      </div>
    </header>

    <!-- WHAT MATTERS: the score is the single dominant number -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div class="glass-card card-featured p-5 sm:p-6 lg:col-span-2" data-card="score">
        <div class="flex items-start justify-between gap-3">
          <p class="section-eyebrow">Today's Score ${hint(describeScoreFormula().join(' · '))}</p>
          <div class="flex flex-col items-end gap-1.5">
            ${stats.hasData
              ? `<span class="chip ${stats.onTrack ? 'chip-good' : 'chip-warn'}">${stats.onTrack ? 'On track' : `Behind pace (${stats.pace})`}</span>`
              : '<span class="chip">No data yet</span>'}
            <p class="text-[11px] text-slate-500">${stats.overdueCount ? `${stats.overdueCount} overdue task${stats.overdueCount > 1 ? 's' : ''}` : 'Nothing overdue'}</p>
          </div>
        </div>
        <div class="flex items-baseline gap-2 mt-3">
          <p class="score-hero-value">${stats.hasData ? stats.score : '–'}</p>
          <p class="score-hero-max">/100</p>
        </div>
        <div class="progress-track mt-3"><div class="progress-fill" style="width:${stats.hasData ? stats.score : 0}%"></div></div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-5" data-score-parts>
          ${scorePartsHtml(stats)}
        </div>
      </div>

      <div class="flex flex-col gap-5 min-w-0">
        <div class="glass-card card-supporting p-5" data-card="streak">
          <div class="flex items-center justify-between mb-1.5">
            <p class="section-eyebrow">Consistency</p>
            <i class="fa-solid fa-fire text-accent-4" aria-hidden="true"></i>
          </div>
          <p class="streak-big">${streakInfo.current}<span class="streak-big-unit">day${streakInfo.current === 1 ? '' : 's'} in a row</span></p>
          <p class="text-[12px] text-slate-500 mt-1">Best streak: ${streakInfo.best} days</p>
          <div class="flex gap-1.5 mt-3">
            ${streakInfo.recent.map(statusForStreakDot).join('')}
          </div>
          <p class="text-[11.5px] text-slate-500 mt-3 leading-relaxed">
            A day counts with <span class="text-slate-300">all Top 3 done</span>, <span class="text-slate-300">score 60+</span> or <span class="text-slate-300">45+ focused minutes</span>.
          </p>
        </div>

        <div class="glass-card discipline-dash-card p-5 ${discipline.unlocked ? 'is-unlocked' : ''}" data-card="discipline">
          ${disciplineCardHtml(discipline)}
        </div>
      </div>
    </div>

    <!-- The plan: Top 3 + the single next move -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div class="glass-card top3-card p-5" data-card="top3">
        <div class="flex items-center justify-between mb-1">
          <h3 class="section-title text-base flex items-center gap-2"><span class="top3-badge">Today's Top 3</span></h3>
          <span class="text-[11px] text-slate-500 tabular">${top3.done}/${top3.total} done</span>
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
        <p class="section-eyebrow" style="letter-spacing:0.22em">Do this now</p>
        <h3 class="font-display font-bold text-white text-xl leading-snug mt-2" data-next-title>${escapeHtml(action.title)}</h3>
        <div class="flex flex-wrap items-center gap-2 mt-2.5 text-[12px] text-slate-400">
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

    <!-- PROGRESS: where the day actually is, right now -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div class="glass-card p-2 sm:p-3 lg:col-span-2">
        <div class="flex items-center justify-between px-3 pt-2 pb-3 sm:px-2">
          <h3 class="section-title">Right Now</h3>
          <span class="text-[11px] text-slate-500">${now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</span>
        </div>
        <div class="schedule">
        ${current
          ? `<div class="tt-row active-now" style="--cat-color:${categoryColor(current.cat)}">
               <div class="tt-time">${escapeHtml(current.time)}</div>
               <div class="min-w-0">
                 <p class="tt-title truncate">${escapeHtml(current.title)}</p>
                 <p class="tt-meta">${escapeHtml(categoryName(current.cat))} · ${current.duration || 60} min · ${endsIn(current, now)} left</p>
               </div>
               <div class="flex items-center gap-2">
                 <span class="live-label">LIVE</span>
                 <button class="icon-btn" data-focus-block="${escapeHtml(current.id)}" title="Focus on this block"><i class="fa-solid fa-stopwatch text-xs"></i></button>
               </div>
             </div>`
          : `<div class="empty-state !py-6"><i class="fa-regular fa-clock"></i><p class="text-sm">No block scheduled right now</p></div>`}
        ${next
          ? `<p class="section-eyebrow px-4 pt-3 pb-1.5">Up Next</p>
             <div class="tt-row" style="--cat-color:${categoryColor(next.cat)}">
               <div class="tt-time">${escapeHtml(next.time)}</div>
               <div class="min-w-0"><p class="tt-title truncate">${escapeHtml(next.title)}</p><p class="tt-meta">${escapeHtml(categoryName(next.cat))}${next.duration ? ` · ${next.duration} min` : ''}</p></div>
               <i class="fa-solid fa-arrow-right" style="color:var(--color-text-faint)"></i>
             </div>`
          : ''}
        </div>
      </div>

      <div class="glass-card card-supporting p-5">
        <div class="flex items-center justify-between mb-3">
          <h3 class="section-title text-base">Open Tasks</h3>
          <button class="icon-btn" data-action="new-task" title="Add task"><i class="fa-solid fa-plus"></i></button>
        </div>
        <div class="space-y-1.5 max-h-[300px] overflow-y-auto scroll-thin pr-1">
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

    <!-- SUPPORTING: trends -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div class="glass-card card-supporting p-5 lg:col-span-2">
        <div class="flex items-center justify-between mb-4">
          <h3 class="section-title">Last 7 Days</h3>
          <div class="flex items-center gap-3 text-[11px] text-slate-500">
            <span class="flex items-center gap-1.5"><span class="legend-dot" style="background:#5b93e6"></span>Score</span>
            <span class="flex items-center gap-1.5"><span class="legend-dot" style="background:#57b28c"></span>Focus min</span>
          </div>
        </div>
        <div class="h-[220px]"><canvas id="dashWeekChart"></canvas></div>
      </div>
      <div class="glass-card card-supporting p-5">
        <h3 class="section-title text-base mb-4">Categories this week</h3>
        <div class="space-y-3">
          ${week.categories
            .map(
              (c) => `
            <div>
              <div class="flex items-center gap-2.5 mb-1.5">
                <span class="legend-dot" style="background:${c.color}"></span>
                <span class="text-sm text-slate-300 flex-1 truncate">${escapeHtml(c.name)}</span>
                <span class="text-xs text-slate-500 tabular">${c.completionPct}%</span>
              </div>
              <div class="progress-track !h-1"><div class="progress-fill" style="width:${c.completionPct}%"></div></div>
            </div>`,
            )
            .join('')}
        </div>
        <div class="mt-5 pt-4 border-t border-white/5">
          <p class="section-eyebrow mb-2">Today's Quote</p>
          <p class="text-sm text-slate-300 italic leading-relaxed" id="dash-quote"></p>
        </div>
      </div>
    </div>
  `

  bindDashboard(section, { today, action, discipline })
  drawWeekChart(week)
  if (window.CC?.refreshQuoteInline) window.CC.refreshQuoteInline()
}

/* ------------------------------------------------------------------- hero */

/**
 * The headline is derived only from stats that already exist — never invented.
 * One clear sentence about where the day stands, then the honest numbers.
 */
function heroCopy({ stats, overdue, openToday, top3, next }) {
  let title
  if (overdue.length) title = `${overdue.length} overdue — start with the oldest`
  else if (openToday.length === 0 && stats.hasAnyActivity) title = 'Everything planned is done'
  else if (top3.total > 0 && top3.done >= top3.total) title = 'Top 3 complete — finish strong'
  else if (stats.hasData && stats.score >= 75) title = 'Strong day. Protect the pace.'
  else if (stats.hasData && stats.score >= 45) title = 'Steady — keep the rhythm'
  else if (stats.hasAnyActivity) title = 'Early yet — the next block decides the day'
  else title = 'Today is still unwritten'

  const parts = [
    openToday.length === 0 ? 'no open tasks' : `${openToday.length} open task${openToday.length === 1 ? '' : 's'}`,
    `${stats.focusedMinutes} min focused`,
    `${stats.blocksDone}/${stats.blocksTotal} blocks done`,
  ]
  if (next) parts.push(`next up ${next.time}`)
  return { title, sub: parts.join(' · ') }
}

/* ------------------------------------------------------------ score + cards */

function scorePartsHtml(stats) {
  return stats.scoreParts
    .map((part) => {
      const value = part.key === 'focus' ? formatDuration(stats.focusedMinutes) : part.detail
      const percent = part.available ? Math.round(part.ratio * 100) : 0
      return `
        <div class="score-part ${part.available ? '' : 'opacity-45'}">
          <p class="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold">${part.label}</p>
          <p class="font-semibold text-slate-200 text-sm mt-0.5">${value}</p>
          <div class="progress-track !h-1 mt-1.5"><div class="progress-fill" style="width:${percent}%"></div></div>
        </div>`
    })
    .join('')
}

function disciplineCardHtml(d) {
  const def = d.definition
  if (d.unlocked) {
    return `
      <div class="discipline-header">
        <span class="discipline-icon is-unlocked" aria-hidden="true">${escapeHtml(def.icon)}</span>
        <div>
          <p class="discipline-name">${escapeHtml(def.name)}</p>
          <p class="discipline-sub">${escapeHtml(def.subtitle)}</p>
        </div>
        <span class="chip chip-good ml-auto">UNLOCKED ✓</span>
      </div>
      <div class="mt-4">
        <p class="text-[12px] text-slate-400">10+ perfect days achieved</p>
        <div class="progress-track !h-1 mt-2"><div class="progress-fill discipline-fill" style="width:100%"></div></div>
        <p class="text-[11px] text-slate-500 mt-2 tabular">Current streak: ${d.current} days · Best: ${d.best} days</p>
        ${d.unlockedAt ? `<p class="text-[11px] text-slate-500 mt-1">Unlocked ${escapeHtml(formatUnlockDate(d.unlockedAt))}</p>` : ''}
      </div>
    `
  }

  const pct = Math.round((d.progress / d.total) * 100)
  return `
    <div class="discipline-header">
      <span class="discipline-icon" aria-hidden="true">${escapeHtml(def.lockedIcon)}</span>
      <div>
        <p class="discipline-name">${escapeHtml(def.name)}</p>
        <p class="discipline-sub">${escapeHtml(def.subtitle)}</p>
      </div>
      <span class="discipline-ratio tabular" aria-hidden="true">${d.progress}<span>/${d.total}</span></span>
    </div>
    <div class="mt-4">
      <div class="flex items-center justify-between">
        <p class="section-eyebrow">Current Streak</p>
        <p class="text-[11px] text-slate-400 tabular">${d.progress} / ${d.total} perfect days</p>
      </div>
      <p class="streak-big mt-1">${d.current}<span class="streak-big-unit">day${d.current === 1 ? '' : 's'}</span></p>
      <div class="progress-track !h-1 mt-3"><div class="progress-fill discipline-fill" style="width:${pct}%"></div></div>
      <div class="flex gap-1 mt-3" aria-hidden="true">
        ${d.recent.map((day) => `<span class="streak-dot ${day.perfect ? 'is-perfect' : ''} ${day.isToday ? 'is-today' : ''}" style="background:${day.perfect ? 'var(--color-warning)' : 'rgba(255,255,255,0.07)'}" title="${day.dateKey} · ${day.perfect ? 'Perfect ✓' : 'Not perfect'}"></span>`).join('')}
      </div>
      <p class="text-[12px] text-slate-400 mt-3">${d.remaining === 0 ? 'Complete today to keep the streak!' : `${d.remaining} perfect day${d.remaining === 1 ? '' : 's'} to go`}</p>
      <p class="text-[11px] text-slate-500 mt-2 leading-relaxed">100% tasks + 100% timetable for 10 consecutive days. Zero-task days don't count.</p>
    </div>
  `
}

function top3ListHtml(top3) {
  if (!top3.total) {
    return `<div class="empty-state !py-6"><i class="fa-solid fa-list-ol"></i><p class="text-sm">No priorities yet</p><p class="text-[12px] text-slate-500 mt-1">Pick the three tasks that define a good day.</p></div>`
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
          <p class="text-sm font-semibold text-slate-100 truncate ${task.done ? 'line-through' : ''}">${escapeHtml(task.title)}</p>
          <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-slate-500">
            ${task.cat ? `<span>${escapeHtml(categoryName(task.cat))}</span>` : ''}
            <span><i class="fa-regular fa-clock mr-1"></i>${formatDuration(task.estimateMinutes || 30)}</span>
            ${minutes ? `<span class="text-accent-2 tabular">${formatDuration(minutes)} focused</span>` : ''}
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
    <div class="flex items-center gap-2.5 px-2 py-1.5 rounded-lg ${task.done ? 'opacity-50' : ''}">
      <button class="task-check ${task.done ? 'checked' : ''}" data-task-toggle="${escapeHtml(task.id)}" aria-label="Toggle task"><i class="fa-solid fa-check"></i></button>
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

function bindDashboard(section, { today, action, discipline }) {
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
    else toast("Added to today's Top 3", 'success')
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

  section.querySelector('[data-discipline-view]')?.addEventListener('click', () => {
    window.CC?.switchView('settings')
  })
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
          borderColor: '#5b93e6',
          backgroundColor: 'rgba(91,147,230,0.12)',
          fill: true,
          tension: 0.35,
          pointRadius: 2.5,
          yAxisID: 'y',
        },
        {
          label: 'Focus minutes',
          data: week.rows.map((r) => r.focus),
          borderColor: '#57b28c',
          borderDash: [4, 4],
          tension: 0.35,
          pointRadius: 0,
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
        y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#828b99' } },
        y1: { position: 'right', min: 0, grid: { display: false }, ticks: { color: '#828b99', callback: (v) => `${v}m` } },
        x: { grid: { display: false }, ticks: { color: '#828b99' } },
      },
    },
  })
}

/* -------------------------------------------------------------- small bits */

function categoryName(id) {
  return state.categories.find((c) => c.id === id)?.name || 'Uncategorised'
}

function categoryColor(id) {
  return state.categories.find((c) => c.id === id)?.color || '#5b93e6'
}

function endsIn(block, now) {
  const end = minutesOfDay(block.time) + (block.duration || 60)
  const left = Math.max(0, end - nowMinutesOf(now))
  return formatDuration(left)
}
