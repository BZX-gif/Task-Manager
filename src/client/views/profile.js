/* -------------------------------------------------------------------------
   PROFILE — my private identity / progression page
   -------------------------------------------------------------------------
   Personal information, real statistics and MY TITLES.
   Everything is computed from the data already stored in this browser:
   nothing here is public, shared, ranked or published anywhere.
   ------------------------------------------------------------------------- */

import { formatDuration } from '../lib/dates.js'
import { PLANNED_TITLES, PERFECT_DAY_RULE_TEXT, PERFECT_HISTORY_DAYS } from '../lib/achievements.js'
import { sessionTotals } from '../lib/focus.js'
import { escapeHtml, hint } from '../core/dom.js'
import { currentDayKey, perfectDayRun, state, statsFor, streak, titleStates } from '../core/store.js'
import { titleCardHtml } from '../ui/titles.js'

export function renderProfile() {
  const section = document.getElementById('view-profile')
  if (!section) return
  const now = new Date()
  const today = currentDayKey(now)
  const titles = titleStates(now)
  const run = perfectDayRun(now)
  const streakInfo = streak(now)
  const focus = sessionTotals(state.focus?.sessions || [], null)

  const doneTasks = state.tasks.filter((task) => task.done).length
  const trackedDays = new Set([
    ...Object.keys(state.completionLog || {}),
    ...Object.keys(state.scoreHistory || {}),
    ...state.tasks.map((task) => task.date).filter(Boolean),
  ]).size
  const createdAt = Number(state.meta?.createdAt)
  const memberSince = Number.isFinite(createdAt) ? new Date(createdAt) : null
  const perfectDays = run?.total ?? 0
  const bestRun = run?.best ?? 0
  const notes = state.tasks.filter((task) => task.notes && task.notes.trim().length).length

  const stats = [
    { label: 'Perfect days', value: perfectDays, icon: 'fa-solid fa-crown', hintText: `Days with 100% of that day's tasks and started timetable blocks (last ${PERFECT_HISTORY_DAYS} days)` },
    { label: 'Best perfect run', value: bestRun, icon: 'fa-solid fa-bolt', hintText: 'Longest consecutive run of perfect days' },
    { label: 'Current streak', value: streakInfo.current, icon: 'fa-solid fa-fire', hintText: 'Meaningful-productivity streak: Top 3 done, score 60+ or 45+ focused minutes' },
    { label: 'Focused time', value: formatDuration(focus.focusedMinutes), icon: 'fa-solid fa-stopwatch', hintText: 'Every focus session ever logged in this browser' },
    { label: 'Tasks completed', value: doneTasks, icon: 'fa-solid fa-list-check', hintText: 'Completed tasks across all dates' },
    { label: 'Tracked days', value: trackedDays, icon: 'fa-solid fa-calendar-check', hintText: 'Days with tasks, timetable or focus activity' },
  ]

  section.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="section-title">Profile</h2>
        <p class="section-sub">Your private progression page — stored only in this browser.</p>
      </div>
      <span class="chip chip-muted"><i class="fa-solid fa-lock"></i> PRIVATE · LOCAL ONLY</span>
    </div>

    <div class="glass-card profile-hero p-5 sm:p-6">
      <div class="flex items-start gap-4 flex-wrap">
        <div class="profile-avatar" aria-hidden="true">${escapeHtml(initial(userName()))}</div>
        <div class="min-w-0 flex-1">
          <h3 class="profile-name">${escapeHtml(userName())}</h3>
          <p class="profile-role">Command Center · personal edition</p>
          <div class="flex flex-wrap gap-2 mt-2.5">
            <span class="chip"><i class="fa-solid fa-user-shield"></i> No account</span>
            <span class="chip"><i class="fa-solid fa-database"></i> Browser storage only</span>
            ${memberSince ? `<span class="chip"><i class="fa-regular fa-calendar"></i> Since ${escapeHtml(memberSince.toLocaleDateString([], { month: 'long', year: 'numeric' }))}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="profile-today">
        <div class="profile-today-item">
          <p class="profile-stat-label">Today's score</p>
          <p class="profile-stat-value">${todayScore(now)}<span class="text-slate-500 text-base">/100</span></p>
        </div>
        <div class="profile-today-item">
          <p class="profile-stat-label">Focused today</p>
          <p class="profile-stat-value">${formatDuration(sessionTotals(state.focus?.sessions || [], today).focusedMinutes)}</p>
        </div>
        <div class="profile-today-item">
          <p class="profile-stat-label">Discipline monster</p>
          <p class="profile-stat-value">${titles[0]?.value ?? 0}<span class="text-slate-500 text-base">/${titles[0]?.target ?? 10}</span></p>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-2 lg:grid-cols-3 gap-3.5">
      ${stats.map(profileStatHtml).join('')}
    </div>

    <div class="title-section">
      <div class="title-section-head">
        <div>
          <h3 class="section-title text-base">MY TITLES</h3>
          <p class="section-sub">Earned here, kept here. ${hint(PERFECT_DAY_RULE_TEXT.join(' · '), 'How a Perfect Day is judged')}</p>
        </div>
        <span class="chip chip-muted">${titles.filter((t) => t.unlocked).length}/${titles.length} unlocked</span>
      </div>
      ${titles.map(titleCardHtml).join('')}
    </div>

    <div class="title-section">
      <div class="title-section-head">
        <div>
          <h3 class="section-title text-base">LOCKED TITLES</h3>
          <p class="section-sub">Future achievements — the collection is built to grow.</p>
        </div>
        <span class="chip chip-muted"><i class="fa-solid fa-lock"></i> Coming soon</span>
      </div>
      <div class="glass-card p-4 sm:p-5">
        <div class="space-y-2">
          ${PLANNED_TITLES.map(
            (planned) => `
            <div class="locked-title-row glass-inset">
              <span class="locked-title-icon" aria-hidden="true">🔒</span>
              <div class="min-w-0 flex-1">
                <p class="locked-title-name">${escapeHtml(planned.name)}</p>
                <p class="text-[11.5px] text-slate-500 truncate">${escapeHtml(planned.hint)}</p>
              </div>
              <span class="chip chip-muted">LOCKED</span>
            </div>`,
          ).join('')}
        </div>
        <p class="text-[11.5px] text-slate-500 mt-4">Adding a title later is a config entry — no new storage, no server, no cost.</p>
      </div>
    </div>
  `
}

function profileStatHtml(stat) {
  return `
    <div class="glass-card profile-stat p-4">
      <div class="flex items-center justify-between gap-2">
        <p class="profile-stat-label">${escapeHtml(stat.label)} ${hint(stat.hintText)}</p>
        <i class="${stat.icon} text-slate-600 text-xs"></i>
      </div>
      <p class="profile-stat-value">${escapeHtml(String(stat.value))}</p>
    </div>`
}

function todayScore(now) {
  const stats = statsFor(currentDayKey(now), { now })
  return stats.hasData ? stats.score : 0
}

function userName() {
  return state.settings?.userName || 'Kulshresth'
}

function initial(name) {
  return String(name || '?').trim().charAt(0).toUpperCase() || '?'
}
