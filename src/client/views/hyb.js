/* -------------------------------------------------------------------------
   HYB STUDIO — every hybrid plan in one room
   -------------------------------------------------------------------------
   The deck is for speed; the studio is for perspective. Same data, same
   actions, laid out as a filtered list over a week strip, a lane balance and
   the honest list of plans that are still waiting for a day.
   ------------------------------------------------------------------------- */

import { escapeHtml, qs, qsa, toast } from '../core/dom.js'
import { commit, currentDayKey, state } from '../core/store.js'
import {
  addHybPlan,
  dropHybPlan,
  duplicateHybPlan,
  getHybPlan,
  hybPlans,
  hybSummary,
  moveHybPlanDate,
  scheduleHybPlan,
  toggleHybPlanDay,
  completeHybDay,
} from '../core/hyb.js'
import { openHybDeck, openHybPlanModal } from '../ui/hyb.js'
import { addDays, formatDuration, formatKeyLabel, isValidKey, startOfWeek, weekdayOf, weekdayShort } from '../lib/dates.js'
import { HYB_KINDS, HYB_ENERGY, energyOf, kindOf, parseHybInput, repeatOf } from '../lib/hyb.js'
import { bindCommon, icon, metric, pageHeading, timeLabel } from '../ui/common.js'

const SCOPES = [
  ['today', 'Today'],
  ['week', 'This week'],
  ['month', 'This month'],
  ['upcoming', 'Next 14'],
  ['someday', 'Someday'],
  ['done', 'Finished'],
  ['all', 'Everything'],
]

let scope = 'today'
let lane = 'all'
let energy = 'all'
let query = ''
let signatureProgressTimer = null

export function setHybScope(next) {
  if (SCOPES.some(([id]) => id === next)) scope = next
}

export function renderHyb() {
  const section = document.getElementById('view-hyb')
  if (!section) return
  const today = currentDayKey()
  const stats = hybSummary({ todayKey: today, days: 14 })
  const groups = groupsFor(stats, today)
  const plans = hybPlans()

  section.innerHTML = `
    ${pageHeading(
      'THE HYBRID LAYER',
      'HYB Studio.',
      'Study, work, body, people, events and ideas — six lanes, one place. A plan is lighter than a mission and heavier than a note.',
      `<button class="btn-ghost" data-common="calendar">${icon('calendar')}Calendar</button><button class="btn-ghost" data-hyb-open-deck>${icon('bolt')}HYB deck</button><button class="btn-primary" data-hyb-studio-new>${icon('plus')}New plan</button>`,
    )}

    <div class="metric-strip hyb-metrics">
      ${metric('bolt', 'Today', `${stats.today.doneCount}<small>/${stats.today.count}</small>`, stats.today.count ? 'HYB plans finished' : 'Nothing planned today')}
      ${metric('focus', 'Planned today', `${Math.floor(stats.today.minutes / 60)}<small>h ${stats.today.minutes % 60}m</small>`, `${stats.today.open} still open`)}
      ${metric('calendar', 'Next 14 days', `${stats.windowPlanned}`, `${formatDuration(stats.minutesPlanned)} of HYB time`)}
      ${metric('flag', 'Momentum', `${stats.streak.current}<small> day${stats.streak.current === 1 ? '' : 's'}</small>`, `best run ${stats.streak.best} · ${stats.completion}% finished in the window`)}
    </div>

    <div class="hyb-studio-layout">
      <div class="hyb-studio-main">
        <form class="hyb-quick hyb-quick--studio" id="hyb-studio-quick" autocomplete="off">
          <div class="hyb-quick-field">
            <span class="hyb-quick-icon" aria-hidden="true">${icon('bolt')}</span>
            <input id="hyb-studio-input" class="hyb-quick-input" placeholder="Add a plan… “Mock test Saturday 9am 3h @study ~deep !high”" aria-label="Add a HYB plan in one line" spellcheck="false">
            <button type="submit" class="hyb-quick-add">${icon('plus')}<span>Add plan</span></button>
          </div>
          <div class="hyb-quick-chips" id="hyb-studio-chips" aria-live="polite"></div>
        </form>

        <div class="hyb-studio-toolbar">
          <div class="segmented hyb-scopes" role="group" aria-label="Which plans">
            ${SCOPES.map(([id, label]) => `<button type="button" data-hyb-scope="${id}" class="${scope === id ? 'seg-active' : ''}" aria-pressed="${scope === id}">${label}</button>`).join('')}
          </div>
          <div class="hyb-filter-row">
            <div class="hyb-lane-picker hyb-lane-picker--filter" role="group" aria-label="Filter by lane">
              <button type="button" class="hyb-lane hyb-lane--all ${lane === 'all' ? 'is-active' : ''}" data-hyb-lane-filter="all" aria-pressed="${lane === 'all'}">${icon('overview')}<span>All</span></button>
              ${HYB_KINDS.map((kind) => `<button type="button" class="hyb-lane hyb-lane--${kind.id} ${lane === kind.id ? 'is-active' : ''}" data-hyb-lane-filter="${kind.id}" aria-pressed="${lane === kind.id}" title="${escapeHtml(kind.hint)}">${icon(kind.icon)}<span>${kind.label}</span></button>`).join('')}
            </div>
            <div class="hyb-filter-right">
              <div class="segmented" role="group" aria-label="Filter by energy">
                <button type="button" data-hyb-energy-filter="all" class="${energy === 'all' ? 'seg-active' : ''}" aria-pressed="${energy === 'all'}">Any</button>
                ${HYB_ENERGY.map((entry) => `<button type="button" data-hyb-energy-filter="${entry.id}" class="${energy === entry.id ? 'seg-active' : ''}" aria-pressed="${energy === entry.id}">${entry.label}</button>`).join('')}
              </div>
              <div class="toolbar-search hyb-search">
                ${icon('search')}
                <input class="input-field" id="hyb-studio-search" placeholder="Search plans and tags" value="${escapeHtml(query)}" aria-label="Search HYB plans">
              </div>
            </div>
          </div>
        </div>

        ${groups.length ? groups.map((group) => groupHtml(group, today)).join('') : emptyStudioHtml()}
      </div>

      <aside class="hyb-studio-side">
        <article class="card hyb-week-card">
          <div class="card-header"><h3>This week</h3>${icon('calendar')}</div>
          <div class="hyb-week-strip">
            ${stats.week
              .map(
                (day) => `
              <button type="button" class="hyb-week-day ${day.isToday ? 'is-today' : ''} ${day.count ? 'has-plans' : ''}" data-hyb-jump="${day.date}" title="${escapeHtml(`${formatKeyLabel(day.date)} · ${day.doneCount}/${day.count} done`)}">
                <span>${weekdayShort(weekdayOf(day.date)).slice(0, 1)}</span>
                <strong>${Number(day.date.slice(8))}</strong>
                <span class="hyb-week-load"><i style="width:${Math.min(100, day.count ? Math.round((day.doneCount / day.count) * 100) : 0)}%"></i></span>
                <small>${day.count || '·'}</small>
              </button>`,
              )
              .join('')}
          </div>
          <p class="form-hint" style="margin-top:14px">The bar under each day is how much of it you finished. Tap a day to see it.</p>
        </article>

        <article class="card">
          <div class="card-header"><h3>Where the plans live</h3>${icon('target')}</div>
          ${stats.byKind.length ? `<div class="hyb-balance">${stats.byKind.map((row) => balanceRowHtml(row, stats)).join('')}</div>` : `<p class="form-hint">No plans yet — the lanes fill up as you add them.</p>`}
        </article>

        ${stats.overdue ? `<article class="card hyb-attention">
          <div class="card-header"><h3>Still open from earlier</h3><span class="count-badge">${stats.overdue}</span></div>
          <p class="form-hint" style="margin-bottom:12px">Plans whose day has passed. Move them, finish them, or set them aside — no debt is recorded.</p>
          <div class="hyb-attention-actions">
            <button class="btn-ghost btn-small" data-hyb-scope="someday">${icon('inbox')}Show them</button>
            <button class="btn-ghost btn-small" data-hyb-tomorrow>${icon('arrow')}Move all to tomorrow</button>
          </div>
        </article>` : ''}

        <article class="card">
          <h3 class="section-title">One tap, onto the day</h3>
          <p class="form-hint" style="margin:10px 0 15px">Put today’s HYB plans on the real schedule, so the Forecast and the Focus Room can see them.</p>
          <div class="heading-actions">
            <button class="btn-ghost btn-small" data-hyb-schedule-day="${today}" ${stats.today.open ? '' : 'disabled'}>${icon('calendar')}Schedule today’s open plans</button>
            <button class="btn-ghost btn-small" data-hyb-finish-day="${today}" ${stats.today.open ? '' : 'disabled'}>${icon('check')}Finish the day</button>
          </div>
        </article>

        <article class="card">
          <div class="card-header"><h3>What HYB is for</h3>${icon('info')}</div>
          <p class="form-hint" style="line-height:1.8">A mission is a commitment you track to completion. A HYB plan is the hybrid layer underneath it: the revision block, the gym session, the mock test, the call you keep meaning to make. Plans can be promoted to missions, dropped onto the schedule, repeated daily, or simply left on the someday shelf until they are real.</p>
          <div class="hyb-shortcuts">
            <span><kbd class="kbd">H</kbd> open the deck</span>
            <span><kbd class="kbd">C</kbd> open the calendar</span>
            <span><kbd class="kbd">@</kbd> lane · <kbd class="kbd">~</kbd> energy · <kbd class="kbd">!</kbd> priority</span>
          </div>
        </article>
      </aside>
    </div>`

  bindCommon(section)
  bindStudio(section, today, stats)
  if (signatureProgressTimer) clearInterval(signatureProgressTimer)
  if (['monograph-2000', 'obsidian-2000'].includes(document.documentElement.dataset.edition)) {
    updateSignatureWindows(section)
    signatureProgressTimer = setInterval(() => updateSignatureWindows(section), 30000)
  }
}

function balanceRowHtml(row, stats) {
  const total = stats.byKind.reduce((sum, entry) => sum + entry.count, 0) || 1
  const share = Math.round((row.count / total) * 100)
  return `
    <div class="hyb-balance-row">
      <button type="button" class="hyb-balance-label" data-hyb-lane-filter="${row.id}" aria-pressed="${lane === row.id}">
        <span class="hyb-kind-chip hyb-kind-chip--${row.id}">${icon(row.icon)}${row.label}</span>
        <small>${row.count} plan${row.count === 1 ? '' : 's'} · ${formatDuration(row.minutes)}</small>
      </button>
      <span class="hyb-balance-track"><i class="hyb-balance-fill hyb-balance-fill--${row.id}" style="width:${share}%"></i></span>
      <strong>${share}%</strong>
    </div>`
}

function groupHtml(group, today) {
  return `
    <section class="hyb-group">
      <header class="hyb-group-head">
        <div>
          <h3>${escapeHtml(group.label)}</h3>
          <p>${escapeHtml(group.meta)}</p>
        </div>
        <div class="hyb-group-actions">
          ${group.date ? `<button class="btn-ghost btn-small" data-hyb-studio-new data-hyb-date="${group.date}">${icon('plus')}Plan</button>` : ''}
          ${group.date && group.items.some((item) => !item.done) ? `<button class="btn-ghost btn-small" data-hyb-finish-day="${group.date}">${icon('check')}Finish day</button>` : ''}
        </div>
      </header>
      <div class="hyb-group-body">${group.items.map((item) => studioRowHtml(item, today)).join('')}</div>
    </section>`
}

function studioRowHtml(item, today) {
  const plan = item.plan
  const kind = kindOf(plan.kind)
  const done = !!item.done
  const steps = plan.steps || []
  const stepsDone = steps.filter((step) => step.done).length
  const percent = steps.length ? Math.round((stepsDone / steps.length) * 100) : Number(plan.progress) || 0
  const signatureWindow = ['monograph-2000', 'obsidian-2000'].includes(document.documentElement.dataset.edition) && item.date === today && !!plan.startTime
  const goal = plan.goalId ? state.goals.find((entry) => entry.id === plan.goalId) : null
  const project = plan.projectId ? state.projects.find((entry) => entry.id === plan.projectId) : null
  const mission = plan.missionId ? state.tasks.find((entry) => entry.id === plan.missionId) : null
  return `
    <article class="hyb-card hyb-card--${kind.id} ${done ? 'is-done' : ''} ${item.skipped ? 'is-skipped' : ''} ${plan.status === 'dropped' ? 'is-aside' : ''}" data-hyb-card="${escapeHtml(plan.id)}" data-hyb-date="${escapeHtml(item.date || '')}" data-hyb-window-done="${done}">
      <span class="hyb-card-lane" aria-hidden="true"></span>
      <div class="hyb-card-top">
        <button type="button" class="hyb-check ${done ? 'checked' : ''}" data-hyb-toggle="${escapeHtml(plan.id)}" data-hyb-date="${escapeHtml(item.date || '')}" aria-pressed="${done}" aria-label="${done ? 'Reopen' : 'Finish'} ${escapeHtml(plan.title)}">${icon('check')}</button>
        <div class="hyb-card-title">
          <button type="button" data-hyb-edit="${escapeHtml(plan.id)}"><strong>${escapeHtml(plan.title)}</strong></button>
          <p class="hyb-card-meta">
            <span class="hyb-kind-chip hyb-kind-chip--${kind.id}">${icon(kind.icon)}${kind.label}</span>
            ${plan.startTime ? `<span>${icon('clock')}${timeLabel(plan.startTime, true)}</span>` : '<span>No time set</span>'}
            <span>${icon('focus')}${formatDuration(plan.minutes)}</span>
            <span class="hyb-energy hyb-energy--${plan.energy}">${energyOf(plan.energy).label}</span>
            ${plan.priority === 'high' ? `<span class="hyb-priority">${icon('flag')}High</span>` : ''}
            ${plan.repeat !== 'none' ? `<span>${icon('recover')}${repeatOf(plan.repeat).label}</span>` : ''}
            ${item.skipped ? '<span class="hyb-skipped">Skipped</span>' : ''}
            ${!item.date ? '<span class="hyb-skipped">No date</span>' : ''}
          </p>
        </div>
        <div class="hyb-card-side">
          ${item.date ? `<span class="hyb-card-date ${item.date === today ? 'is-today' : ''}">${escapeHtml(item.date === today ? 'Today' : formatKeyLabel(item.date))}</span>` : ''}
          <div class="hyb-card-actions">
            ${!done && item.date ? `<button type="button" class="icon-btn" data-hyb-schedule="${escapeHtml(plan.id)}" data-hyb-date="${escapeHtml(item.date)}" title="Put it on the schedule" aria-label="Put ${escapeHtml(plan.title)} on the schedule">${icon('calendar')}</button>` : ''}
            ${!done ? `<button type="button" class="icon-btn" data-hyb-tomorrow-one="${escapeHtml(plan.id)}" title="Move to tomorrow" aria-label="Move ${escapeHtml(plan.title)} to tomorrow">${icon('arrow')}</button>` : ''}
            <button type="button" class="icon-btn" data-hyb-duplicate="${escapeHtml(plan.id)}" title="Duplicate" aria-label="Duplicate ${escapeHtml(plan.title)}">${icon('projects')}</button>
            <button type="button" class="icon-btn" data-hyb-drop="${escapeHtml(plan.id)}" title="${plan.status === 'dropped' ? 'Bring it back' : 'Set aside'}" aria-label="${plan.status === 'dropped' ? 'Bring back' : 'Set aside'} ${escapeHtml(plan.title)}">${icon('close')}</button>
            <button type="button" class="icon-btn" data-hyb-edit="${escapeHtml(plan.id)}" title="Edit" aria-label="Edit ${escapeHtml(plan.title)}">${icon('edit')}</button>
          </div>
        </div>
      </div>
      ${signatureWindow ? `<div class="signature-hyb-window" data-signature-window="${escapeHtml(plan.id)}" data-window-start="${escapeHtml(plan.startTime)}" data-window-minutes="${Number(plan.minutes) || 0}" role="status"><div class="signature-hyb-window-head"><span class="signature-window-status">Loading schedule</span><span class="signature-window-clock"></span></div><span class="signature-window-track"><i></i></span></div>` : ''}
      ${plan.notes ? `<p class="hyb-card-notes">${escapeHtml(plan.notes)}</p>` : ''}
      ${steps.length ? `<div class="hyb-card-steps">
        ${steps
          .map(
            (step) =>
              `<button type="button" class="hyb-step-chip ${step.done ? 'is-done' : ''}" data-hyb-step-toggle="${escapeHtml(plan.id)}" data-hyb-step-id="${escapeHtml(step.id)}" aria-pressed="${step.done}">${icon(step.done ? 'check' : 'plus')}<span>${escapeHtml(step.title)}</span></button>`,
          )
          .join('')}
      </div>` : ''}
      <footer class="hyb-card-foot">
        <span class="hyb-card-progress"><span class="hyb-steps-track"><i style="width:${percent}%"></i></span><small>${steps.length ? `${stepsDone}/${steps.length} steps` : `${percent}% done`}</small></span>
        <span class="hyb-card-links">
          ${plan.tags.length ? plan.tags.map((tag) => `<span class="chip">#${escapeHtml(tag)}</span>`).join('') : ''}
          ${mission ? `<button type="button" class="chip chip-accent" data-hyb-open-mission="${escapeHtml(mission.id)}">${icon('link')}${escapeHtml(mission.title.slice(0, 28))}</button>` : ''}
          ${goal ? `<button type="button" class="chip" data-hyb-open-goal="${escapeHtml(goal.id)}">${icon('target')}${escapeHtml(goal.title.slice(0, 28))}</button>` : ''}
          ${project ? `<button type="button" class="chip" data-hyb-open-project="${escapeHtml(project.id)}">${icon('projects')}${escapeHtml(project.title.slice(0, 28))}</button>` : ''}
          ${!done && plan.repeat === 'none' && plan.date && plan.date < today ? `<button type="button" class="chip chip-warn" data-hyb-tomorrow-one="${escapeHtml(plan.id)}">${icon('recover')}Move to tomorrow</button>` : ''}
        </span>
      </footer>
    </article>`
}

function updateSignatureWindows(root) {
  if (!root?.isConnected) { if (signatureProgressTimer) clearInterval(signatureProgressTimer); signatureProgressTimer = null; return }
  const now = new Date()
  const current = now.getHours() * 60 + now.getMinutes()
  root.querySelectorAll('[data-signature-window]').forEach((node) => {
    const startParts = String(node.dataset.windowStart || '').split(':').map(Number)
    const start = startParts[0] * 60 + startParts[1]
    const duration = Math.max(1, Number(node.dataset.windowMinutes) || 1)
    const elapsed = current - start
    const pct = Math.max(0, Math.min(100, Math.round(elapsed / duration * 100)))
    const done = node.closest('[data-hyb-card]')?.dataset.hybWindowDone === 'true'
    const status = node.querySelector('.signature-window-status')
    const clock = node.querySelector('.signature-window-clock')
    const fill = node.querySelector('.signature-window-track i')
    if (fill) fill.style.width = `${done ? 100 : pct}%`
    if (clock) clock.textContent = `${timeLabel(node.dataset.windowStart, true)} – ${timeLabel(`${String(Math.floor((start + duration) / 60) % 24).padStart(2, '0')}:${String((start + duration) % 60).padStart(2, '0')}`, true)}`
    if (!status) return
    if (done) { status.textContent = 'Completed'; node.classList.add('is-window-complete') }
    else if (elapsed < 0) { const remaining = Math.abs(elapsed); status.textContent = `Starts in ${Math.floor(remaining / 60)}h ${remaining % 60}m`; node.classList.remove('is-window-complete') }
    else if (elapsed < duration) { status.textContent = 'In your planned window'; node.classList.remove('is-window-complete') }
    else { status.textContent = 'Planned window elapsed'; node.classList.remove('is-window-complete') }
  })
}

function emptyStudioHtml() {
  return `
    <div class="card empty-state hyb-empty-state">
      ${icon('bolt')}
      <p>${lane === 'all' && !query ? 'No plans in this view.' : 'Nothing matches those filters.'}</p>
      <p>${lane === 'all' && !query ? 'Add one above — a name and a day is enough to start.' : 'Try another lane, energy or search word.'}</p>
      <div class="heading-actions">
        <button class="btn-ghost" data-hyb-reset-filters>${icon('recover')}Clear filters</button>
        <button class="btn-primary" data-hyb-studio-new>${icon('plus')}New plan</button>
      </div>
    </div>`
}

/* ---------------------------------------------------------------- grouping */

function groupsFor(stats, today) {
  const plans = hybPlans().filter(matchesFilters)
  const weekStart = state.settings?.weekStart ?? 1
  const weekFirst = startOfWeek(today, weekStart)
  const monthPrefix = today.slice(0, 7)

  if (scope === 'today') {
    const items = plans.filter((plan) => occursOnDate(plan, today)).map((plan) => occurrenceOf(plan, today))
    return items.length ? [{ label: 'Today', meta: `${items.length} plan${items.length === 1 ? '' : 's'} · ${formatDuration(items.reduce((sum, item) => sum + item.minutes, 0))}`, date: today, items: sortItems(items) }] : []
  }

  if (scope === 'week') {
    return Array.from({ length: 7 }, (_, index) => addDays(weekFirst, index))
      .map((date) => ({ date, items: plans.filter((plan) => occursOnDate(plan, date)).map((plan) => occurrenceOf(plan, date)) }))
      .filter((group) => group.items.length)
      .map((group) => ({
        label: group.date === today ? 'Today' : formatKeyLabel(group.date, { year: group.date.slice(0, 4) !== today.slice(0, 4) }),
        meta: `${group.items.length} plan${group.items.length === 1 ? '' : 's'} · ${formatDuration(group.items.reduce((sum, item) => sum + item.minutes, 0))}`,
        date: group.date,
        items: sortItems(group.items),
      }))
  }

  if (scope === 'month') {
    const days = plans
      .flatMap((plan) => monthDatesFor(plan, today, monthPrefix))
      .filter((value, index, all) => all.indexOf(value) === index)
      .sort()
    return days
      .map((date) => ({ date, items: plans.filter((plan) => occursOnDate(plan, date)).map((plan) => occurrenceOf(plan, date)) }))
      .filter((group) => group.items.length)
      .map((group) => ({
        label: formatKeyLabel(group.date, { year: true }),
        meta: `${group.items.length} plan${group.items.length === 1 ? '' : 's'} · ${formatDuration(group.items.reduce((sum, item) => sum + item.minutes, 0))}`,
        date: group.date,
        items: sortItems(group.items),
      }))
  }

  if (scope === 'upcoming') {
    return stats.window
      .filter((day) => day.planned)
      .map((day) => ({
        date: day.date,
        items: day.occurrences.filter((item) => matchesFilters(item.plan)),
      }))
      .filter((group) => group.items.length)
      .map((group) => ({
        label: group.date === today ? 'Today' : relativeLabel(group.date, today),
        meta: `${group.items.filter((item) => item.done).length}/${group.items.length} done · ${formatDuration(group.items.reduce((sum, item) => sum + item.minutes, 0))}`,
        date: group.date,
        items: sortItems(group.items),
      }))
  }

  if (scope === 'someday') {
    const undated = plans.filter((plan) => !plan.date && plan.status !== 'dropped').map((plan) => ({ plan, date: null, done: false, skipped: false, minutes: plan.minutes }))
    const overdue = plans.filter((plan) => plan.repeat === 'none' && plan.date && plan.date < today && plan.status === 'planned').map((plan) => ({ plan, date: plan.date, done: false, skipped: false, minutes: plan.minutes }))
    const aside = plans.filter((plan) => plan.status === 'dropped').map((plan) => ({ plan, date: plan.date, done: false, skipped: false, minutes: plan.minutes }))
    const groups = []
    if (overdue.length) groups.push({ label: 'Still open from earlier', meta: `${overdue.length} plan${overdue.length === 1 ? '' : 's'} whose day has passed`, date: null, items: overdue.sort((a, b) => a.plan.date.localeCompare(b.plan.date)) })
    if (undated.length) groups.push({ label: 'Waiting for a day', meta: `${undated.length} idea${undated.length === 1 ? '' : 's'} with no date attached`, date: null, items: undated })
    if (aside.length) groups.push({ label: 'Set aside', meta: `${aside.length} plan${aside.length === 1 ? '' : 's'} you chose to leave`, date: null, items: aside })
    return groups
  }

  if (scope === 'done') {
    const finished = plans
      .filter((plan) => plan.status === 'done' || Object.values(plan.log || {}).some((value) => value === 'done'))
      .map((plan) => ({ plan, date: plan.date, done: true, skipped: false, minutes: plan.minutes }))
      .sort((a, b) => (b.plan.completedAt || b.plan.updatedAt || 0) - (a.plan.completedAt || a.plan.updatedAt || 0))
    return finished.length ? [{ label: 'Finished', meta: `${finished.length} plan${finished.length === 1 ? '' : 's'} closed out`, date: null, items: finished }] : []
  }

  // everything, grouped by date where one exists
  const dated = new Map()
  for (const plan of plans) {
    for (const date of allDatesFor(plan, today)) {
      if (!dated.has(date)) dated.set(date, [])
      dated.get(date).push(occurrenceOf(plan, date))
    }
  }
  const groups = [...dated.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, items]) => ({
      label: date === today ? 'Today' : relativeLabel(date, today),
      meta: `${items.length} plan${items.length === 1 ? '' : 's'} · ${formatDuration(items.reduce((sum, item) => sum + item.minutes, 0))}`,
      date,
      items: sortItems(items),
    }))
  const undated = plans.filter((plan) => !plan.date && plan.status !== 'dropped').map((plan) => ({ plan, date: null, done: false, skipped: false, minutes: plan.minutes }))
  if (undated.length) groups.push({ label: 'Someday', meta: `${undated.length} plan${undated.length === 1 ? '' : 's'} with no date`, date: null, items: undated })
  return groups
}

function matchesFilters(plan) {
  if (lane !== 'all' && plan.kind !== lane) return false
  if (energy !== 'all' && plan.energy !== energy) return false
  if (query) {
    const haystack = `${plan.title} ${plan.notes} ${plan.tags.join(' ')} ${kindOf(plan.kind).label}`.toLowerCase()
    if (!haystack.includes(query.toLowerCase())) return false
  }
  return true
}

function occursOnDate(plan, date) {
  if (!plan.date || plan.status === 'dropped') return false
  if (date < plan.date) return false
  if (plan.repeat === 'daily') return true
  if (plan.repeat === 'weekdays') {
    const day = weekdayOf(date)
    return day >= 1 && day <= 5
  }
  if (plan.repeat === 'weekly') return weekdayOf(date) === weekdayOf(plan.date)
  return plan.date === date
}

function occurrenceOf(plan, date) {
  const done = plan.repeat === 'none' ? plan.status === 'done' : plan.log?.[date] === 'done'
  return { plan, date, done, skipped: plan.repeat !== 'none' && plan.log?.[date] === 'skipped', minutes: plan.minutes }
}

function monthDatesFor(plan, today, monthPrefix) {
  if (!plan.date) return []
  if (plan.repeat === 'none') return plan.date.startsWith(monthPrefix) ? [plan.date] : []
  const dates = []
  for (let index = 0; index < 31; index++) {
    const date = addDays(`${monthPrefix}-01`, index)
    if (!date.startsWith(monthPrefix)) break
    if (date >= plan.date && occursOnDate(plan, date)) dates.push(date)
  }
  return dates
}

function allDatesFor(plan, today) {
  if (!plan.date) return []
  if (plan.repeat === 'none') return [plan.date]
  const dates = []
  for (let index = 0; index < 21; index++) {
    const date = addDays(today, index)
    if (occursOnDate(plan, date)) dates.push(date)
  }
  return dates
}

function relativeLabel(date, today) {
  if (date === today) return 'Today'
  if (date === addDays(today, 1)) return 'Tomorrow'
  if (date === addDays(today, -1)) return 'Yesterday'
  return formatKeyLabel(date, { year: date.slice(0, 4) !== today.slice(0, 4) })
}

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 }
function sortItems(items) {
  return [...items].sort(
    (a, b) =>
      Number(a.done) - Number(b.done) ||
      (PRIORITY_RANK[a.plan.priority] ?? 1) - (PRIORITY_RANK[b.plan.priority] ?? 1) ||
      (a.plan.startTime || '99:99').localeCompare(b.plan.startTime || '99:99') ||
      a.plan.title.localeCompare(b.plan.title),
  )
}

/* ------------------------------------------------------------------ bind */

function bindStudio(section, today, stats) {
  const input = qs(section, '#hyb-studio-input')
  const chips = qs(section, '#hyb-studio-chips')
  const form = qs(section, '#hyb-studio-quick')

  const repaintChips = () => {
    if (!chips) return
    const parsed = parseHybInput(String(input?.value || ''), { todayKey: today, categories: state.categories })
    chips.innerHTML = parsed.hasAnything
      ? [
          parsed.repeat !== 'none' ? `<span class="hyb-chip hyb-chip--repeat">${icon('recover')}${repeatOf(parsed.repeat).label}</span>` : '',
          parsed.date ? `<span class="hyb-chip hyb-chip--date">${icon('calendar')}${escapeHtml(relativeLabel(parsed.date, today))}</span>` : '',
          parsed.startTime ? `<span class="hyb-chip hyb-chip--time">${icon('clock')}${timeLabel(parsed.startTime, true)}</span>` : '',
          parsed.minutes ? `<span class="hyb-chip hyb-chip--duration">${icon('focus')}${formatDuration(parsed.minutes)}</span>` : '',
          parsed.kind ? `<span class="hyb-chip hyb-chip--lane">${icon(kindOf(parsed.kind).icon)}${kindOf(parsed.kind).label}</span>` : '',
          parsed.energy ? `<span class="hyb-chip hyb-chip--energy">${icon('bolt')}${energyOf(parsed.energy).label} energy</span>` : '',
          parsed.priority ? `<span class="hyb-chip hyb-chip--priority">${icon('flag')}${parsed.priority}</span>` : '',
          ...parsed.tags.map((tag) => `<span class="hyb-chip hyb-chip--tag">${icon('sparkle')}#${escapeHtml(tag)}</span>`),
        ]
          .filter(Boolean)
          .join('')
      : `<span class="hyb-chip-hint">${icon('info')}<span>Natural language works: <strong>Saturday 9am 3h @study ~deep !high</strong>. Undetected fields fall back to your defaults.</span></span>`
  }
  repaintChips()
  input?.addEventListener('input', repaintChips)

  form?.addEventListener('submit', (event) => {
    event.preventDefault()
    const parsed = parseHybInput(String(input.value || '').trim(), { todayKey: today, categories: state.categories })
    if (!parsed.title) {
      toast('Give the plan a name first.', 'info')
      input.focus()
      return
    }
    addHybPlan({
      title: parsed.title,
      date: parsed.date || today,
      startTime: parsed.startTime,
      minutes: parsed.minutes || state.settings?.hyb?.defaultMinutes || 60,
      kind: parsed.kind || state.settings?.hyb?.defaultKind || 'study',
      energy: parsed.energy || 'steady',
      priority: parsed.priority || 'medium',
      repeat: parsed.repeat || 'none',
      tags: parsed.tags,
    })
    input.value = ''
    if (scope === 'done' || scope === 'someday') scope = 'today'
    repaintChips()
    input.focus()
  })

  input?.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      if (form?.requestSubmit) form.requestSubmit()
      else form?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
    }
  })

  qsa(section, '[data-hyb-scope]').forEach((button) =>
    button.addEventListener('click', () => {
      scope = button.dataset.hybScope
      renderHyb()
    }),
  )

  qsa(section, '[data-hyb-lane-filter]').forEach((button) =>
    button.addEventListener('click', () => {
      const wanted = button.dataset.hybLaneFilter
      lane = lane === wanted ? 'all' : wanted
      renderHyb()
    }),
  )

  qsa(section, '[data-hyb-energy-filter]').forEach((button) =>
    button.addEventListener('click', () => {
      energy = button.dataset.hybEnergyFilter
      renderHyb()
    }),
  )

  qs(section, '#hyb-studio-search')?.addEventListener('input', (event) => {
    query = String(/** @type {any} */ (event.target).value || '')
    renderHyb()
    // the view was rebuilt: put the caret back where the user left it
    const again = qs(document.getElementById('view-hyb'), '#hyb-studio-search')
    if (again) {
      again.focus()
      const length = query.length
      if (typeof again.setSelectionRange === 'function') again.setSelectionRange(length, length)
    }
  })

  qs(section, '[data-hyb-reset-filters]')?.addEventListener('click', () => {
    lane = 'all'
    energy = 'all'
    query = ''
    renderHyb()
  })

  qsa(section, '[data-hyb-studio-new]').forEach((button) =>
    button.addEventListener('click', () => openHybPlanModal(null, { date: button.dataset.hybDate || today })),
  )

  qs(section, '[data-hyb-open-deck]')?.addEventListener('click', () => openHybDeck())

  qsa(section, '[data-hyb-toggle]').forEach((button) =>
    button.addEventListener('click', () => toggleHybPlanDay(button.dataset.hybToggle, button.dataset.hybDate || today)),
  )

  qsa(section, '[data-hyb-edit]').forEach((button) => button.addEventListener('click', () => openHybPlanModal(button.dataset.hybEdit)))

  qsa(section, '[data-hyb-schedule]').forEach((button) =>
    button.addEventListener('click', () => scheduleHybPlan(button.dataset.hybSchedule, { date: button.dataset.hybDate || today })),
  )

  qsa(section, '[data-hyb-duplicate]').forEach((button) => button.addEventListener('click', () => duplicateHybPlan(button.dataset.hybDuplicate)))

  qsa(section, '[data-hyb-drop]').forEach((button) => button.addEventListener('click', () => dropHybPlan(button.dataset.hybDrop)))

  qsa(section, '[data-hyb-tomorrow-one]').forEach((button) =>
    button.addEventListener('click', () => moveHybPlanDate(button.dataset.hybTomorrowOne, addDays(today, 1))),
  )

  qsa(section, '[data-hyb-step-toggle]').forEach((button) =>
    button.addEventListener('click', () => {
      const plan = getHybPlan(button.dataset.hybStepToggle)
      const step = plan?.steps?.find((entry) => entry.id === button.dataset.hybStepId)
      if (!plan || !step) return
      commit((s) => {
        const target = s.hyb.plans.find((entry) => entry.id === plan.id)
        const targetStep = target?.steps?.find((entry) => entry.id === step.id)
        if (!targetStep) return
        targetStep.done = !targetStep.done
        target.progress = target.steps.length ? Math.round((target.steps.filter((entry) => entry.done).length / target.steps.length) * 100) : 0
        target.updatedAt = Date.now()
      })
      toast(targetStepLabel(plan, step, !step.done), 'info')
    }),
  )

  qsa(section, '[data-hyb-finish-day]').forEach((button) => button.addEventListener('click', () => completeHybDay(button.dataset.hybFinishDay)))

  qs(section, '[data-hyb-schedule-day]')?.addEventListener('click', () => {
    const open = stats.today.occurrences.filter((item) => !item.done && !item.skipped && item.plan.startTime)
    const rest = stats.today.occurrences.filter((item) => !item.done && !item.skipped && !item.plan.startTime)
    if (!open.length && !rest.length) {
      toast('Nothing open to schedule today.', 'info')
      return
    }
    let placed = 0
    for (const item of [...open, ...rest]) {
      if (scheduleHybPlan(item.plan.id, { date: today, time: item.plan.startTime || undefined })) placed++
    }
    if (placed) toast(`${placed} plan${placed === 1 ? '' : 's'} added to today’s schedule`, 'success')
  })

  qs(section, '[data-hyb-tomorrow]')?.addEventListener('click', () => {
    const overdue = hybPlans().filter((plan) => plan.repeat === 'none' && plan.date && plan.date < today && plan.status === 'planned')
    if (!overdue.length) {
      toast('Nothing is waiting from earlier.', 'info')
      return
    }
    commit((s) => {
      for (const plan of overdue) {
        const target = s.hyb.plans.find((entry) => entry.id === plan.id)
        if (!target) continue
        target.date = addDays(today, 1)
        target.updatedAt = Date.now()
      }
    })
    toast(`${overdue.length} plan${overdue.length === 1 ? '' : 's'} moved to tomorrow`, 'success')
  })

  qsa(section, '[data-hyb-jump]').forEach((button) =>
    button.addEventListener('click', () => {
      const date = button.dataset.hybJump
      if (!isValidKey(date)) return
      scope = 'today'
      openHybDeck({ tab: 'today', date })
    }),
  )

  qsa(section, '[data-hyb-open-mission]').forEach((button) => button.addEventListener('click', () => window.CC.openTaskModal(button.dataset.hybOpenMission)))
  qsa(section, '[data-hyb-open-goal]').forEach((button) => button.addEventListener('click', () => window.CC.openGoalDetail(button.dataset.hybOpenGoal)))
  qsa(section, '[data-hyb-open-project]').forEach((button) => button.addEventListener('click', () => window.CC.openProjectDetail(button.dataset.hybOpenProject)))
}

function targetStepLabel(plan, step, done) {
  return done ? `Step done · ${step.title || plan.title}` : `Step reopened · ${step.title || plan.title}`
}

