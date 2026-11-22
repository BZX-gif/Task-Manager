/* -------------------------------------------------------------------------
   CALENDAR — the month at a glance
   -------------------------------------------------------------------------
   One grid over everything the workspace already knows: dated schedules and
   study plans, missions, HYB plans, routines, deadlines and journal days.
   Nothing here writes to a different source than the rest of the app, so the
   calendar and the Schedule can never disagree.

   Modes: month (the grid), week (seven days side by side), agenda (the next
   30 days as a list). Every layer can be switched off in the toolbar.
   ------------------------------------------------------------------------- */

import { commit, currentDayKey, state } from '../core/store.js'
import { escapeHtml, qs, qsa, scrollToNode, toast } from '../core/dom.js'
import { addDays, formatDuration, formatKeyLabel, isValidKey, weekdayOf, weekdayShort } from '../lib/dates.js'
import {
  CAL_LAYERS,
  agendaDays,
  daySummary,
  defaultLayers,
  monthMatrix,
  monthOverview,
  monthStats,
  monthTitle,
  shiftMonth,
  weekCells,
} from '../lib/calendar.js'
import { energyOf, kindOf, repeatOf } from '../lib/hyb.js'
import { hybDay, scheduleHybPlan, toggleHybPlanDay } from '../core/hyb.js'
import { setScheduleDate } from './schedule.js'
import { openHybPlanModal } from '../ui/hyb.js'
import { bindCommon, icon, pageHeading, timeLabel, domainTabs, DOMAIN_TABS } from '../ui/common.js'
import { on } from '../core/bus.js'

const MAX_CELL_EVENTS = 3
let mode = 'month'
let anchor = currentDayKey()
let selected = currentDayKey()
let layers = defaultLayers()
let cacheBound = false
let cacheToken = 0
const overviewCache = { key: '', map: null }

function prefsFromSettings() {
  const settings = state.settings?.calendar
  if (settings?.mode && ['month', 'week', 'agenda'].includes(settings.mode)) mode = settings.mode
  if (settings?.layers) layers = { ...defaultLayers(), ...settings.layers }
  // the HYB layer respects its own setting, so turning plans off in Settings
  // really does take them off the grid (the layer chip can turn them back on)
  if (state.settings?.hyb?.showOnCalendar === false) layers = { ...layers, hyb: false }
}

/** Mode + layer choices are preferences, so they survive a reload (silently). */
function savePrefs(patch = {}) {
  commit(
    (s) => {
      s.settings.calendar = { ...(s.settings.calendar || {}), mode, layers: { ...layers }, ...patch }
    },
    { silent: true, immediate: true },
  )
}

function overviewFor(matrix) {
  const key = `${matrix.monthKey}|${JSON.stringify(layers)}|${cacheToken}`
  if (overviewCache.key === key && overviewCache.map) return overviewCache.map
  const map = monthOverview(state, matrix, { layers, todayKey: currentDayKey() })
  overviewCache.key = key
  overviewCache.map = map
  return map
}

export function setCalendarDate(date, { viewMode = null } = {}) {
  if (isValidKey(date)) {
    anchor = date
    selected = date
  }
  if (viewMode) mode = viewMode
}

export function renderCalendar() {
  const section = document.getElementById('view-calendar')
  if (!section) return
  if (!cacheBound) {
    cacheBound = true
    on('store:change', () => {
      cacheToken++
    })
  }
  prefsFromSettings()
  if (!isValidKey(anchor)) anchor = currentDayKey()
  if (!isValidKey(selected)) selected = anchor
  const today = currentDayKey()
  const matrix = monthMatrix(anchor, { weekStart: state.settings.weekStart, todayKey: today })
  const overview = overviewFor(matrix)
  const stats = monthStats(state, matrix, overview)
  const summary = daySummary(state, selected, { layers, todayKey: today })

  section.innerHTML = `
    ${pageHeading(
      'THE WHOLE MONTH',
      'Calendar.',
      'Everything you have committed to, planned or written down — in one grid. Tap a day to see it, tap the plus to add a HYB plan.',
      `<button class="btn-ghost" data-common="schedule">${icon('clock')}Day schedule</button><button class="btn-primary" data-cal-new-plan="${selected}">${icon('bolt')}Add HYB plan</button>`,
    )}
    ${domainTabs('calendar', DOMAIN_TABS.time)}

    <div class="cal-toolbar">
      <div class="cal-nav">
        <button class="icon-btn" data-cal-step="-1" aria-label="Previous month">${icon('left')}</button>
        <div class="cal-nav-label">
          <strong>${escapeHtml(mode === 'agenda' ? `Agenda from ${formatKeyLabel(anchor)}` : matrix.title)}</strong>
          <small>${escapeHtml(mode === 'month' ? `${stats.pledgedDays} of ${stats.days} day${stats.days === 1 ? '' : 's'} with a commitment` : mode === 'week' ? 'Seven days, side by side' : 'The next 30 days')}</small>
        </div>
        <button class="icon-btn" data-cal-step="1" aria-label="Next month">${icon('chevron')}</button>
        <button class="btn btn-secondary btn-small" data-cal-today>Today</button>
      </div>
      <div class="cal-toolbar-right">
        <div class="segmented" role="group" aria-label="Calendar mode">
          ${[['month', 'Month', 'board'], ['week', 'Week', 'list'], ['agenda', 'Agenda', 'review']].map(
            ([id, label, symbol]) =>
              `<button type="button" data-cal-mode="${id}" class="${mode === id ? 'seg-active' : ''}" aria-pressed="${mode === id}">${icon(symbol)}${label}</button>`,
          ).join('')}
        </div>
      </div>
    </div>

    <div class="cal-layers" role="group" aria-label="What the calendar shows">
      ${CAL_LAYERS.map(
        (layer) =>
          `<button type="button" class="cal-layer ${layers[layer.id] ? 'is-on' : ''}" data-cal-layer="${layer.id}" aria-pressed="${!!layers[layer.id]}" title="${escapeHtml(layer.hint)}">
            ${icon(layer.icon)}<span>${layer.label}</span><i class="cal-layer-dot" aria-hidden="true"></i>
          </button>`,
      ).join('')}
      <span class="cal-layer-hint">${icon('info')}Layers are saved on this device</span>
    </div>

    <div class="cal-layout">
      <div class="cal-main">
        ${mode === 'month' ? monthHtml(matrix, overview, today) : mode === 'week' ? weekHtml(today) : agendaHtml(today)}
      </div>
      <aside class="cal-side">
        ${dayRailHtml(summary, today)}
        ${monthStatsHtml(stats, matrix)}
      </aside>
    </div>`

  bindCommon(section)
  bindCalendar(section, matrix, today)
}

/* ------------------------------------------------------------------ month */

function monthHtml(matrix, overview, today) {
  return `
    <div class="cal-month" role="grid" aria-label="${escapeHtml(matrix.title)}">
      <div class="cal-weekdays" role="row">
        ${matrix.weekdayLabels.map((label) => `<span role="columnheader" aria-label="${escapeHtml(label)}">${escapeHtml(label)}</span>`).join('')}
      </div>
      ${matrix.weeks
        .map(
          (week, weekIndex) => `
        <div class="cal-week" role="row">
          ${week
            .map((cell) => {
              const summary = overview.get(cell.key)
              return cellHtml(cell, summary, today, weekIndex)
            })
            .join('')}
        </div>`,
        )
        .join('')}
    </div>`
}

function cellHtml(cell, summary, today, weekIndex) {
  const entries = summary?.entries || []
  /* Commitments first (missions, HYB plans, deadlines, journal); the recurring
   * study routine collapses to one quiet line so a month of template days no
   * longer looks like a month of appointments. */
  const routine = summary?.routine || []
  const visible = entries.filter((entry) => !entry.dotOnly)
  const commitments = visible.filter((entry) => entry.kind !== 'template' && entry.kind !== 'rest')
  // routine is summarised below, never given a chip slot — a month cell has
  // room for what the day is *for*, not for the habit that fills it
  const ordered = commitments
  const chips = ordered.slice(0, MAX_CELL_EVENTS)
  const extra = ordered.length - chips.length
  const dots = entries.filter((entry) => entry.dotOnly)
  const isSelected = cell.key === selected
  const load = Math.min(100, summary?.loadPct || 0)
  return `
    <div class="cal-cell ${cell.inMonth ? '' : 'is-outside'} ${cell.isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''} ${cell.isWeekend ? 'is-weekend' : ''} ${summary?.visibleCount ? 'has-events' : 'is-quiet'} load-${summary?.load || 'light'}"
      role="gridcell" tabindex="${isSelected ? '0' : '-1'}" data-cal-day="${cell.key}"
      aria-selected="${isSelected}" aria-label="${escapeHtml(cellLabel(cell, summary))}">
      <span class="cal-cell-top">
        <span class="cal-cell-day">${cell.day}</span>
        ${cell.isToday ? '<span class="cal-today-dot" aria-hidden="true"></span>' : ''}
        <button type="button" class="cal-cell-add" data-cal-add="${cell.key}" aria-label="Add a HYB plan on ${escapeHtml(formatKeyLabel(cell.key, { year: true }))}" tabindex="-1">${icon('plus')}</button>
      </span>
      <span class="cal-cell-events">
        ${chips
          .map(
            (entry) => `
          <button type="button" class="cal-chip cal-chip--${entry.source} kind-${entry.kind || 'block'} ${entry.source === 'hyb' ? `lane-${entry.kind}` : ''} ${entry.done ? 'is-done' : ''} ${entry.tone === 'overdue' ? 'is-overdue' : ''}"
            data-cal-entry="${escapeHtml(entry.id)}" data-cal-day="${cell.key}" tabindex="-1"
            title="${escapeHtml(entryChipTitle(entry))}">
            ${entry.kind === 'template' ? `<span class="cal-chip-mark" aria-hidden="true"></span>` : entry.time ? `<span class="cal-chip-time">${timeLabel(entry.time)}</span>` : `<span class="cal-chip-dot" aria-hidden="true"></span>`}
            <span class="cal-chip-title">${escapeHtml(entry.title)}</span>
          </button>`,
          )
          .join('')}
        ${extra > 0 ? `<button type="button" class="cal-more" data-cal-open-day="${cell.key}" tabindex="-1">+${extra} more</button>` : ''}
        ${routine.length ? `<span class="cal-routine-note" aria-hidden="true"><i></i>Routine${summary?.routineMinutes ? ` · ${formatDuration(summary.routineMinutes)}` : ` · ${routine.length}`}</span>` : ''}
      </span>
      <span class="cal-cell-dots" aria-hidden="true">
        ${dots.slice(0, 6).map((entry) => `<i class="cal-dot cal-dot--${entry.source} ${entry.tone === 'protected' ? 'is-protected' : ''} ${entry.done ? 'is-done' : ''}" title="${escapeHtml(entryChipTitle(entry))}"></i>`).join('')}
      </span>
      <span class="cal-cell-load" aria-hidden="true"><i style="width:${load}%"></i></span>
      ${cell.day === 1 ? `<span class="cal-month-tag" aria-hidden="true">${escapeHtml(monthTitle(cell.key).split(' ')[0])}</span>` : ''}
    </div>`
}

function cellLabel(cell, summary) {
  const parts = [formatKeyLabel(cell.key, { year: true })]
  if (cell.isToday) parts.push('today')
  if (!summary?.visibleCount) parts.push('nothing planned')
  else {
    const committed = summary.commitments?.length || 0
    if (committed) parts.push(`${committed} commitment${committed === 1 ? '' : 's'}`)
    if (summary.hasRoutine) parts.push(`${summary.routine.length} routine block${summary.routine.length === 1 ? '' : 's'}`)
    if (summary.minutes) parts.push(formatDuration(summary.minutes))
    if (summary.doneCount) parts.push(`${summary.doneCount} finished`)
  }
  return parts.join(', ')
}

function entryChipTitle(entry) {
  const bits = [entry.title]
  if (entry.time) bits.push(timeLabel(entry.time, true))
  if (entry.minutes) bits.push(formatDuration(entry.minutes))
  bits.push(entry.done ? 'finished' : entry.kind === 'template' ? 'Routine · part of your study template' : entry.source === 'hyb' ? `HYB · ${kindOf(entry.kind).label} · ${energyOf(entry.energy).label} energy` : entry.source)
  return bits.join(' · ')
}

/* ------------------------------------------------------------------- week */

function weekHtml(today) {
  const cells = weekCells(anchor, { weekStart: state.settings.weekStart, todayKey: today })
  return `
    <div class="cal-week-grid">
      ${cells
        .map((cell) => {
          const summary = daySummary(state, cell.key, { layers, todayKey: today })
          return `
        <div class="cal-week-col ${cell.isToday ? 'is-today' : ''} ${cell.key === selected ? 'is-selected' : ''} ${cell.isWeekend ? 'is-weekend' : ''}" data-cal-day="${cell.key}">
          <button type="button" class="cal-week-head" data-cal-select="${cell.key}">
            <span>${weekdayShort(weekdayOf(cell.key))}</span>
            <strong>${cell.day}</strong>
            ${cell.isToday ? '<small>Today</small>' : ''}
          </button>
          <div class="cal-week-meta">
            <span>${summary.visibleCount} item${summary.visibleCount === 1 ? '' : 's'}</span>
            <span>${formatDuration(summary.minutes)}</span>
          </div>
          <div class="cal-week-list">
            ${summary.entries.length ? summary.entries.map((entry) => weekEntryHtml(entry, cell.key)).join('') : `<button type="button" class="cal-week-empty" data-cal-add="${cell.key}">${icon('plus')}Add a plan</button>`}
          </div>
          <button type="button" class="cal-week-add" data-cal-add="${cell.key}">${icon('bolt')}HYB plan</button>
        </div>`
        })
        .join('')}
    </div>`
}

function weekEntryHtml(entry, dayKey) {
  return `
    <button type="button" class="cal-line cal-line--${entry.source} ${entry.source === 'hyb' ? `lane-${entry.kind}` : ''} ${entry.done ? 'is-done' : ''}" data-cal-entry="${escapeHtml(entry.id)}" data-cal-day="${dayKey}">
      <span class="cal-line-time">${entry.time ? timeLabel(entry.time) : entry.dotOnly ? icon(entry.source === 'journal' ? 'journal' : entry.source === 'routine' ? 'routines' : 'flag') : '—'}</span>
      <span class="cal-line-title">${escapeHtml(entry.title)}</span>
      ${entry.minutes ? `<span class="cal-line-minutes">${formatDuration(entry.minutes)}</span>` : ''}
    </button>`
}

/* ----------------------------------------------------------------- agenda */

function agendaHtml(today) {
  const days = agendaDays(state, anchor, 30, { layers, todayKey: today }).filter((day) => day.entries.length)
  if (!days.length) {
    return `<div class="card empty-state">${icon('calendar')}<p>Thirty clear days.</p><p>Nothing is planned from ${escapeHtml(formatKeyLabel(anchor))}. That is either freedom or a gap — add a HYB plan if it is the second one.</p><button class="btn-primary" data-cal-new-plan="${anchor}">${icon('bolt')}Add a HYB plan</button></div>`
  }
  return `
    <div class="cal-agenda">
      ${days
        .map((day) => `
        <section class="cal-agenda-day ${day.date === today ? 'is-today' : ''} ${day.date === selected ? 'is-selected' : ''}" data-cal-day="${day.date}">
          <button type="button" class="cal-agenda-head" data-cal-select="${day.date}">
            <strong>${Number(day.date.slice(8))}</strong>
            <span>${weekdayShort(weekdayOf(day.date))}</span>
            <small>${day.date === today ? 'Today' : escapeHtml(formatKeyLabel(day.date, { year: day.date.slice(0, 4) !== today.slice(0, 4) }))}</small>
          </button>
          <div class="cal-agenda-body">
            ${day.entries.map((entry) => weekEntryHtml(entry, day.date)).join('')}
            <div class="cal-agenda-foot">
              <span>${day.visibleCount} item${day.visibleCount === 1 ? '' : 's'} · ${formatDuration(day.minutes)}</span>
              <button type="button" class="text-button" data-cal-add="${day.date}">${icon('bolt')}Add a HYB plan</button>
            </div>
          </div>
        </section>`)
        .join('')}
    </div>`
}

/* -------------------------------------------------------------- day rail */

function dayRailHtml(summary, today) {
  const hyb = hybDay(summary.date)
  return `
    <article class="card cal-day-card">
      <div class="card-header">
        <div>
          <h3>${escapeHtml(summary.date === today ? 'Today' : formatKeyLabel(summary.date, { year: true }))}</h3>
          <p class="meta">${summary.visibleCount} item${summary.visibleCount === 1 ? '' : 's'} · ${formatDuration(summary.minutes)} · ${summary.doneCount} finished</p>
        </div>
        ${icon('calendar')}
      </div>
      <div class="cal-day-load">
        <span class="cal-day-load-track"><i style="width:${Math.min(100, summary.loadPct)}%"></i></span>
        <small>${summary.loadPct}% of a normal day</small>
      </div>
      ${summary.entries.length ? `<div class="cal-day-list">${summary.entries.map((entry) => dayEntryHtml(entry, summary.date, today)).join('')}</div>` : `<div class="cal-day-empty">${icon('leaf')}<p>Nothing on this day.</p><button class="btn-primary btn-small" data-cal-add="${summary.date}">${icon('bolt')}Add a HYB plan</button></div>`}
      <div class="cal-day-actions">
        <button class="btn-ghost btn-small" data-cal-open-schedule="${summary.date}">${icon('clock')}Open in Schedule</button>
        <button class="btn-ghost btn-small" data-cal-new-mission="${summary.date}">${icon('missions')}Add mission</button>
        <button class="btn-primary btn-small" data-cal-add="${summary.date}">${icon('bolt')}HYB plan</button>
      </div>
      ${hyb.length ? `<p class="form-hint cal-day-hint">${icon('bolt')}<span>${hyb.filter((item) => !item.done).length} HYB plan${hyb.filter((item) => !item.done).length === 1 ? '' : 's'} still open on this day.</span></p>` : ''}
    </article>`
}

function dayEntryHtml(entry, dayKey, today) {
  return `
    <div class="cal-day-row cal-day-row--${entry.source} ${entry.source === 'hyb' ? `lane-${entry.kind}` : ''} ${entry.done ? 'is-done' : ''} ${entry.dotOnly ? 'is-marker' : ''}">
      <span class="cal-day-time">${entry.time ? timeLabel(entry.time, true) : entry.source === 'journal' ? icon('journal') : entry.source === 'routine' ? icon('routines') : entry.source === 'deadline' ? icon('flag') : icon('clock')}</span>
      <button type="button" class="cal-day-title" data-cal-entry="${escapeHtml(entry.id)}" data-cal-day="${dayKey}">
        <strong>${escapeHtml(entry.title)}</strong>
        <small>${escapeHtml(dayEntryMeta(entry, dayKey, today))}</small>
      </button>
      ${entry.source === 'hyb' && !entry.scheduled ? `<button type="button" class="icon-btn cal-day-place" data-cal-hyb-schedule="${escapeHtml(entry.refId)}" data-cal-day="${dayKey}" aria-label="Put ${escapeHtml(entry.title)} on the schedule">${icon('clock')}</button>` : ''}
      ${entry.source === 'hyb' ? `<button type="button" class="hyb-check mini ${entry.done ? 'checked' : ''}" data-cal-hyb-toggle="${escapeHtml(entry.refId)}" data-cal-day="${dayKey}" aria-pressed="${entry.done}" aria-label="${entry.done ? 'Reopen' : 'Finish'} ${escapeHtml(entry.title)}">${icon('check')}</button>` : ''}
      ${entry.source === 'mission' && !entry.done ? `<button type="button" class="hyb-check mini" data-cal-mission-toggle="${escapeHtml(entry.refId)}" aria-pressed="false" aria-label="Finish ${escapeHtml(entry.title)}">${icon('check')}</button>` : ''}
    </div>`
}

function dayEntryMeta(entry, dayKey, today) {
  const bits = []
  if (entry.minutes) bits.push(formatDuration(entry.minutes))
  if (entry.source === 'hyb') {
    const plan = (state.hyb?.plans || []).find((item) => item.id === entry.refId)
    if (plan) {
      bits.push(kindOf(plan.kind).label, `${energyOf(plan.energy).label} energy`)
      if (plan.repeat !== 'none') bits.push(repeatOf(plan.repeat).label)
      if (entry.scheduled) bits.push('On the schedule')
    }
  } else if (entry.source === 'block') bits.push(entry.kind === 'protected' ? 'Protected time' : 'Time block')
  else if (entry.source === 'mission') bits.push(entry.done ? 'Mission finished' : dayKey < today ? 'Mission · overdue' : 'Mission')
  else if (entry.source === 'routine') bits.push(entry.done ? 'Routine complete' : 'Routine')
  else if (entry.source === 'deadline') bits.push('Deadline')
  else if (entry.source === 'journal') bits.push('Journal written')
  else if (entry.source === 'protected') bits.push('Protected window')
  if (entry.cat) {
    const category = state.categories.find((item) => item.id === entry.cat)
    if (category) bits.push(category.name)
  }
  return bits.join(' · ')
}

function monthStatsHtml(stats, matrix) {
  const busiest = stats.busiestDate
    ? { date: stats.busiestDate, minutes: stats.busiestMinutes, summary: daySummary(state, stats.busiestDate, { layers, todayKey: currentDayKey() }) }
    : null
  return `
    <article class="card cal-stats-card">
      <div class="card-header"><h3>${escapeHtml(matrix.title)}</h3>${icon('analytics')}</div>
      <div class="cal-stats">
        <div><span>Committed</span><strong>${formatDuration(stats.minutes)}</strong></div>
        <div><span>Days with plans</span><strong>${stats.committedDays}<small>/${stats.days}</small></strong></div>
        <div><span>Heavy days</span><strong class="${stats.heavyDays ? 'warning' : ''}">${stats.heavyDays}</strong></div>
        <div><span>HYB days</span><strong>${stats.hybDays}</strong></div>
        <div><span>Journal days</span><strong>${stats.journalDays}</strong></div>
        <div><span>Deadlines</span><strong>${stats.deadlineCount}</strong></div>
      </div>
      ${busiest ? `<p class="form-hint cal-busiest">${icon('bolt')}<span>Heaviest day: <strong>${escapeHtml(formatKeyLabel(busiest.date))}</strong> · ${formatDuration(busiest.minutes)} across ${busiest.summary.visibleCount} items.</span></p>` : `<p class="form-hint cal-busiest">${icon('leaf')}<span>A completely open month. Rare, and worth protecting.</span></p>`}
      <div class="cal-stats-actions">
        <button class="btn-ghost btn-small" data-common="forecast">${icon('forecast')}Load forecast</button>
        <button class="btn-ghost btn-small" data-common="hyb">${icon('board')}HYB Studio</button>
      </div>
    </article>`
}

/* ------------------------------------------------------------------ bind */

function bindCalendar(section, matrix, today) {
  qsa(section, '[data-cal-mode]').forEach((button) =>
    button.addEventListener('click', () => {
      mode = button.dataset.calMode
      savePrefs()
      renderCalendar()
    }),
  )

  qsa(section, '[data-cal-step]').forEach((button) =>
    button.addEventListener('click', () => step(Number(button.dataset.calStep))),
  )

  qs(section, '[data-cal-today]')?.addEventListener('click', () => {
    anchor = today
    selected = today
    renderCalendar()
  })

  qsa(section, '[data-cal-layer]').forEach((button) =>
    button.addEventListener('click', () => {
      const id = button.dataset.calLayer
      const on = !layers[id]
      const next = { ...layers, [id]: on }
      if (!Object.values(next).some(Boolean)) {
        toast('At least one layer has to stay on, or the grid is just numbers.', 'info')
        return
      }
      layers = next
      savePrefs()
      // turning the HYB layer on is also a decision about the setting behind it
      if (id === 'hyb' && on && state.settings?.hyb?.showOnCalendar === false) {
        commit((s) => {
          s.settings.hyb.showOnCalendar = true
        }, { silent: true, immediate: true })
      }
      renderCalendar()
    }),
  )

  qsa(section, '[data-cal-select]').forEach((button) =>
    button.addEventListener('click', () => {
      selected = button.dataset.calSelect
      anchor = selected
      renderCalendar()
    }),
  )

  qsa(section, '[data-cal-day]').forEach((node) => {
    if (node.classList.contains('cal-cell')) {
      node.addEventListener('click', (event) => {
        if (/** @type {any} */ (event.target).closest('button')) return
        selected = node.dataset.calDay
        anchor = selected
        renderCalendar()
        qs(document.getElementById('view-calendar'), `.cal-cell[data-cal-day="${selected}"]`)?.focus()
      })
      node.addEventListener('dblclick', () => openHybPlanModal(null, { date: node.dataset.calDay }))
      node.addEventListener('keydown', (event) => cellKeydown(event, node, matrix))
    }
  })

  qsa(section, '[data-cal-add]').forEach((button) =>
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      const date = button.dataset.calAdd
      selected = date
      anchor = date
      openHybPlanModal(null, { date })
    }),
  )

  qsa(section, '[data-cal-new-plan]').forEach((button) =>
    button.addEventListener('click', () => openHybPlanModal(null, { date: button.dataset.calNewPlan || selected })),
  )

  qsa(section, '[data-cal-new-mission]').forEach((button) =>
    button.addEventListener('click', () => window.CC.openTaskModal(null, { date: button.dataset.calNewMission })),
  )

  qsa(section, '[data-cal-open-day]').forEach((button) =>
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      selected = button.dataset.calOpenDay
      anchor = selected
      renderCalendar()
      scrollToNode(qs(document.getElementById('view-calendar'), '.cal-day-card'), { behavior: 'smooth', block: 'nearest' })
    }),
  )

  qsa(section, '[data-cal-open-schedule]').forEach((button) =>
    button.addEventListener('click', () => {
      setScheduleDate(button.dataset.calOpenSchedule)
      window.CC.switchView('schedule')
    }),
  )

  qsa(section, '[data-cal-hyb-schedule]').forEach((button) =>
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      scheduleHybPlan(button.dataset.calHybSchedule, { date: button.dataset.calDay || selected, time: null })
    }),
  )

  qsa(section, '[data-cal-hyb-toggle]').forEach((button) =>
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      toggleHybPlanDay(button.dataset.calHybToggle, button.dataset.calDay || today)
    }),
  )

  qsa(section, '[data-cal-mission-toggle]').forEach((button) =>
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      window.CC.toggleMission(button.dataset.calMissionToggle)
    }),
  )

  qsa(section, '[data-cal-entry]').forEach((button) =>
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      openEntry(button.dataset.calEntry, button.dataset.calDay || selected)
    }),
  )
}

function step(delta) {
  if (mode === 'week') anchor = addDays(anchor, delta * 7)
  else if (mode === 'agenda') anchor = addDays(anchor, delta * 30)
  else anchor = shiftMonth(anchor, delta)
  selected = mode === 'month' ? anchor : selected
  renderCalendar()
}

function cellKeydown(event, node, matrix) {
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' ', 'PageUp', 'PageDown', '+']
  if (!keys.includes(event.key)) return
  event.preventDefault()
  const flat = matrix.days
  const index = flat.indexOf(node.dataset.calDay)
  let next = null
  if (event.key === 'ArrowLeft') next = flat[Math.max(0, index - 1)]
  else if (event.key === 'ArrowRight') next = flat[Math.min(flat.length - 1, index + 1)]
  else if (event.key === 'ArrowUp') next = flat[Math.max(0, index - 7)]
  else if (event.key === 'ArrowDown') next = flat[Math.min(flat.length - 1, index + 7)]
  else if (event.key === 'PageUp') return step(-1)
  else if (event.key === 'PageDown') return step(1)
  else if (event.key === '+' || event.key === ' ') return openHybPlanModal(null, { date: node.dataset.calDay })
  else if (event.key === 'Enter') {
    selected = node.dataset.calDay
    setScheduleDate(selected)
    window.CC.switchView('schedule')
    return
  }
  if (!next) return
  selected = next
  anchor = next
  renderCalendar()
  qs(document.getElementById('view-calendar'), `.cal-cell[data-cal-day="${next}"]`)?.focus()
}

/** One click on anything in the grid opens the thing itself. */
function openEntry(entryId, dayKey) {
  const [source, ...rest] = String(entryId).split(':')
  const id = rest.join(':')
  if (source === 'hyb') {
    openHybPlanModal(id)
    return
  }
  if (source === 'mission') {
    window.CC.openTaskModal(id)
    return
  }
  if (source === 'block') {
    setScheduleDate(dayKey)
    window.CC.switchView('schedule')
    toast('Open in the Schedule to move this block.', 'info')
    return
  }
  if (source === 'routine') {
    window.CC.switchView('routines')
    return
  }
  if (source === 'journal') {
    window.CC.switchView('journal')
    return
  }
  if (source === 'deadline') {
    const [kind, refId] = [id.split(':')[0], id.split(':').slice(1).join(':')]
    if (kind === 'goal') window.CC.openGoalDetail(refId)
    else if (kind === 'project') window.CC.openProjectDetail(refId)
    else window.CC.openTaskModal(refId)
    return
  }
  if (source === 'protected') {
    window.CC.switchView('settings')
    toast('Protected time is edited in Settings.', 'info')
  }
}

