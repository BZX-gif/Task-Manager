/* -------------------------------------------------------------------------
   HYB DECK — the special button's home
   -------------------------------------------------------------------------
   One button (`HYB`) opens a slide-in deck that answers three questions:
   what did I plan, what is on today, and what is next. It is the fastest way
   to add a plan — type a sentence, watch it being understood, press Enter —
   and the shortest path into the full HYB Studio, the calendar and a real
   time block on your schedule.

   The deck never invents data: everything it shows is read from
   `state.hyb.plans` through `lib/hyb.js`, and everything it writes goes
   through `core/hyb.js`. It repaints on `store:change`, so a plan finished in
   the Schedule or the Studio is instantly true here too.
   ------------------------------------------------------------------------- */

import { closeModal, confirmDialog, escapeHtml, openModal, qs, qsa, toast } from '../core/dom.js'
import { commit, currentDayKey, state } from '../core/store.js'
import { on } from '../core/bus.js'
import {
  addHybPlan,
  dropHybPlan,
  duplicateHybPlan,
  getHybPlan,
  hybDay,
  hybNext,
  hybPlans,
  hybPlanToMission,
  hybSummary,
  moveHybPlanDate,
  removeHybPlan,
  scheduleHybPlan,
  skipHybPlanDay,
  toggleHybPlanDay,
  updateHybPlan,
} from '../core/hyb.js'
import { addDays, formatDuration, formatKeyLabel, isValidKey, weekdayOf, weekdayShort } from '../lib/dates.js'
import { HYB_ENERGY, HYB_KINDS, HYB_REPEATS, energyOf, kindOf, parseHybInput, repeatOf } from '../lib/hyb.js'
import { goalOptions, projectOptions, taskOptions, timeLabel } from './common.js'
import { icon } from './icons.js'

let deckOpen = false
let deckTab = 'today'
let deckDate = null
let lastTrigger = null

export function isHybDeckOpen() {
  return deckOpen
}

/* ------------------------------------------------------------------ badge */

/** Keep every HYB trigger (topbar, dock, sidebar) honest about today. */
export function refreshHybTriggers() {
  const today = currentDayKey()
  const day = hybDay(today)
  const open = day.filter((item) => !item.done && !item.skipped)
  const next = hybNext({ todayKey: today })
  const minutes = open.reduce((sum, item) => sum + item.minutes, 0)
  const label = open.length
    ? `${open.length} open HYB plan${open.length === 1 ? '' : 's'} today · ${formatDuration(minutes)}`
    : day.length
      ? `Today’s HYB plans are finished · ${day.length} done`
      : 'No HYB plans today — add one'
  for (const node of qsa(document, '[data-hyb-count]')) {
    node.textContent = String(open.length)
    node.classList.toggle('hidden', !open.length)
  }
  for (const node of qsa(document, '[data-hyb-trigger]')) {
    node.classList.toggle('has-plans', open.length > 0)
    node.setAttribute('aria-label', `HYB · ${label}`)
    node.title = next ? `HYB — ${label}. Next: ${next.plan.title} (${next.reason.toLowerCase()}).` : `HYB — ${label}.`
  }
  document.getElementById('hyb-live-dot')?.classList.toggle('hidden', !next)
}

/* ------------------------------------------------------------------- deck */

export function openHybDeck({ tab = null, date = null, focusInput = true } = {}) {
  if (tab) deckTab = tab
  deckDate = isValidKey(date) ? date : null
  if (!deckOpen) {
    lastTrigger = /** @type {any} */ (document.activeElement)
    deckOpen = true
  }
  document.body.classList.add('hyb-deck-open')
  const root = document.getElementById('hyb-root')
  if (root) root.classList.remove('hidden')
  paintDeck()
  if (focusInput) setTimeout(() => qs(document.getElementById('hyb-root'), '#hyb-quick-input')?.focus(), 30)
}

export function closeHybDeck({ restoreFocus = true } = {}) {
  if (!deckOpen) return
  deckOpen = false
  document.body.classList.remove('hyb-deck-open')
  const root = document.getElementById('hyb-root')
  if (root) {
    root.classList.add('hidden')
    root.innerHTML = ''
  }
  if (restoreFocus && lastTrigger && document.contains(lastTrigger)) {
    try {
      lastTrigger.focus({ preventScroll: true })
    } catch {
      /* detached node — nothing to restore */
    }
  }
  lastTrigger = null
}

export function toggleHybDeck() {
  if (deckOpen) closeHybDeck()
  else openHybDeck()
}

function paintDeck() {
  const root = document.getElementById('hyb-root')
  if (!root || !deckOpen) return
  const today = currentDayKey()
  const stats = hybSummary({ todayKey: today })
  const anchor = deckDate || today
  root.innerHTML = `
    <div class="hyb-scrim" data-hyb-close aria-hidden="true"></div>
    <aside class="hyb-deck" role="dialog" aria-modal="true" aria-labelledby="hyb-deck-title">
      <header class="hyb-deck-head">
        <div class="hyb-lockup">
          <span class="hyb-mark" aria-hidden="true">HYB</span>
          <div class="hyb-lockup-copy">
            <strong id="hyb-deck-title">Hybrid plans</strong>
            <small>${escapeHtml(deckSubtitle(stats))}</small>
          </div>
        </div>
        <div class="hyb-deck-head-actions">
          <button class="icon-btn" data-hyb-goto="calendar" aria-label="Open the calendar" title="Calendar">${icon('calendar')}</button>
          <button class="icon-btn" data-hyb-goto="hyb" aria-label="Open HYB Studio" title="HYB Studio">${icon('board')}</button>
          <button class="icon-btn" data-hyb-close aria-label="Close the HYB deck">${icon('close')}</button>
        </div>
      </header>

      <div class="hyb-deck-body">
        ${quickAddHtml(today)}
        <div class="hyb-deck-tabs" role="tablist" aria-label="HYB plans">
          ${[
            ['today', 'Today', stats.today.count],
            ['week', 'Next 7', stats.windowPlanned],
            ['someday', 'Someday', stats.undated + stats.overdue],
            ['done', 'Finished', stats.today.doneCount],
          ]
            .map(
              ([id, label, count]) =>
                `<button type="button" role="tab" aria-selected="${deckTab === id}" class="hyb-tab ${deckTab === id ? 'is-active' : ''}" data-hyb-tab="${id}">${label}${count ? `<span class="hyb-tab-count">${count}</span>` : ''}</button>`,
            )
            .join('')}
        </div>
        <div class="hyb-deck-list" role="tabpanel">${deckListHtml(stats, today, anchor)}</div>
      </div>

      <footer class="hyb-deck-foot">
        <span class="hyb-foot-hint"><kbd class="kbd">H</kbd> anywhere · <kbd class="kbd">⌘</kbd>+<kbd class="kbd">↵</kbd> to add</span>
        <div class="hyb-foot-actions">
          <button class="btn btn-secondary btn-small" data-hyb-goto="hyb">${icon('board')}HYB Studio</button>
          <button class="btn-primary btn-small" data-hyb-new>${icon('plus')}Full plan</button>
        </div>
      </footer>
    </aside>`
  bindDeck(root, today)
  refreshHybTriggers()
}

function deckSubtitle(stats) {
  if (!stats.total) return 'Nothing planned yet — one line below is enough'
  const bits = []
  if (stats.today.count) bits.push(`${stats.today.doneCount}/${stats.today.count} done today`)
  if (stats.today.minutes) bits.push(`${formatDuration(stats.today.minutes)} planned`)
  if (stats.overdue) bits.push(`${stats.overdue} still open from earlier`)
  if (!bits.length) bits.push(`${stats.total} plan${stats.total === 1 ? '' : 's'} kept`)
  return bits.join(' · ')
}

/* -------------------------------------------------------------- quick add */

function quickAddHtml(today) {
  const defaults = state.settings?.hyb || {}
  return `
    <form class="hyb-quick" id="hyb-quick-form" autocomplete="off">
      <div class="hyb-quick-field">
        <span class="hyb-quick-icon" aria-hidden="true">${icon('bolt')}</span>
        <input id="hyb-quick-input" class="hyb-quick-input" placeholder="Add a plan… “Revision tomorrow 6pm 90m @study ~deep !high”" aria-label="Add a HYB plan in one line" spellcheck="false">
        <button type="submit" class="hyb-quick-add" aria-label="Add plan">${icon('plus')}<span>Add</span></button>
      </div>
      <div class="hyb-quick-chips" id="hyb-quick-chips" aria-live="polite"></div>
      <div class="hyb-quick-controls">
        <div class="hyb-lane-picker" role="group" aria-label="Plan lane">
          ${HYB_KINDS.map(
            (kind) =>
              `<button type="button" class="hyb-lane hyb-lane--${kind.id}" data-hyb-lane="${kind.id}" aria-pressed="false" title="${escapeHtml(kind.hint)}">${icon(kind.icon)}<span>${kind.label}</span></button>`,
          ).join('')}
        </div>
        <div class="hyb-quick-meta">
          <label class="hyb-mini-field"><span>Date</span><input type="date" class="input-field" id="hyb-quick-date" value="${today}"></label>
          <label class="hyb-mini-field"><span>Start</span><input type="time" class="input-field" id="hyb-quick-time" value=""></label>
          <label class="hyb-mini-field"><span>Minutes</span><input type="number" min="5" max="1440" step="5" class="input-field" id="hyb-quick-minutes" value="${defaults.defaultMinutes || 60}"></label>
          <button type="button" class="text-button" data-hyb-new>${icon('edit')}More detail</button>
        </div>
      </div>
    </form>`
}

function quickChipsHtml(parsed, today) {
  const chips = []
  if (parsed.repeat && parsed.repeat !== 'none') chips.push({ tone: 'repeat', icon: 'recover', text: repeatOf(parsed.repeat).label })
  if (parsed.date) chips.push({ tone: 'date', icon: 'calendar', text: relativeDayLabel(parsed.date, today) })
  if (parsed.startTime) chips.push({ tone: 'time', icon: 'clock', text: timeLabel(parsed.startTime, true) })
  if (parsed.minutes) chips.push({ tone: 'duration', icon: 'focus', text: formatDuration(parsed.minutes) })
  if (parsed.kind) chips.push({ tone: 'lane', icon: kindOf(parsed.kind).icon, text: kindOf(parsed.kind).label })
  if (parsed.energy) chips.push({ tone: 'energy', icon: 'bolt', text: `${energyOf(parsed.energy).label} energy` })
  if (parsed.priority) chips.push({ tone: 'priority', icon: 'flag', text: `${parsed.priority} priority` })
  for (const tag of parsed.tags.slice(0, 3)) chips.push({ tone: 'tag', icon: 'sparkle', text: `#${tag}` })
  if (!chips.length) {
    return `<span class="hyb-chip-hint">${icon('info')}<span>Type naturally — <strong>tomorrow 6pm</strong>, <strong>90m</strong>, <strong>@study</strong>, <strong>~deep</strong>, <strong>!high</strong>, <strong>every weekday</strong>.</span></span>`
  }
  return chips.map((chip) => `<span class="hyb-chip hyb-chip--${chip.tone}">${icon(chip.icon)}${escapeHtml(chip.text)}</span>`).join('')
}

function relativeDayLabel(key, today) {
  if (!key) return 'Someday'
  if (key === today) return 'Today'
  if (key === addDays(today, 1)) return 'Tomorrow'
  if (key === addDays(today, -1)) return 'Yesterday'
  return formatKeyLabel(key)
}

/* ------------------------------------------------------------------- list */

function deckListHtml(stats, today, anchor) {
  if (deckTab === 'today') {
    const list = hybDay(anchor)
    if (!list.length) {
      return emptyDeck(
        anchor === today ? 'No HYB plans today.' : `Nothing planned for ${formatKeyLabel(anchor)}.`,
        'One line above is enough. A plan with a day attached is worth three intentions.',
        `<button class="btn-primary btn-small" data-hyb-new data-hyb-date="${anchor}">${icon('plus')}Add a plan for this day</button>`,
      )
    }
    const plannedMinutes = list.reduce((sum, item) => sum + item.minutes, 0)
    const openCount = list.filter((item) => !item.done && !item.skipped).length
    return `
      <div class="hyb-day-head">
        <div>
          <strong>${escapeHtml(anchor === today ? 'Today' : formatKeyLabel(anchor, { year: true }))}</strong>
          <small>${list.length - openCount}/${list.length} finished · ${formatDuration(plannedMinutes)} planned</small>
        </div>
        ${openCount ? `<button class="text-button" data-hyb-clear-day="${anchor}">${icon('check')}Finish the day</button>` : `<span class="chip chip-good">${icon('check')}Clear</span>`}
      </div>
      ${list.map((item) => rowHtml(item, anchor)).join('')}`
  }

  if (deckTab === 'week') {
    const days = stats.window.filter((day) => day.planned)
    if (!days.length) {
      return emptyDeck('The next seven days are open.', 'Nothing is planned ahead. That is allowed — but a plan is cheaper than a worry.', `<button class="btn-primary btn-small" data-hyb-new>${icon('plus')}Plan something</button>`)
    }
    return days
      .map(
        (day) => `
        <div class="hyb-day-group">
          <button type="button" class="hyb-day-head is-clickable" data-hyb-open-day="${day.date}">
            <div>
              <strong>${escapeHtml(relativeDayLabel(day.date, today))}</strong>
              <small>${weekdayShort(weekdayOf(day.date))} · ${day.done}/${day.planned} done · ${formatDuration(day.minutes)}</small>
            </div>
            ${icon('chevron')}
          </button>
          ${day.occurrences.map((item) => rowHtml(item, day.date)).join('')}
        </div>`,
      )
      .join('')
  }

  if (deckTab === 'someday') {
    const someday = hybPlans().filter((plan) => !plan.date && plan.status !== 'dropped')
    const overdue = hybPlans().filter((plan) => plan.repeat === 'none' && plan.date && plan.date < today && plan.status === 'planned')
    const aside = hybPlans().filter((plan) => plan.status === 'dropped')
    if (!someday.length && !overdue.length && !aside.length) {
      return emptyDeck('Nothing floating.', 'Every plan has a day. Ideas without a date wait here until you choose one.', '')
    }
    return `
      ${overdue.length ? `<div class="hyb-group-label">Still open from earlier</div>${overdue.map((plan) => rowHtml({ plan, date: plan.date, done: false, skipped: false, minutes: plan.minutes }, plan.date)).join('')}` : ''}
      ${someday.length ? `<div class="hyb-group-label">No date yet</div>${someday.map((plan) => rowHtml({ plan, date: null, done: false, skipped: false, minutes: plan.minutes }, null)).join('')}` : ''}
      ${aside.length ? `<div class="hyb-group-label">Set aside</div>${aside.map((plan) => rowHtml({ plan, date: plan.date, done: false, skipped: false, minutes: plan.minutes }, plan.date)).join('')}` : ''}`
  }

  const finished = hybPlans()
    .filter((plan) => plan.status === 'done' || Object.values(plan.log || {}).includes('done'))
    .sort((a, b) => (b.completedAt || b.updatedAt || 0) - (a.completedAt || a.updatedAt || 0))
    .slice(0, 40)
  if (!finished.length) return emptyDeck('Nothing finished yet.', 'Finished plans collect here — proof, not pressure.', '')
  return finished.map((plan) => rowHtml({ plan, date: plan.date || today, done: true, skipped: false, minutes: plan.minutes }, plan.date || today)).join('')
}

function emptyDeck(title, body, action) {
  return `<div class="hyb-empty">${icon('bolt')}<p>${escapeHtml(title)}</p><p>${escapeHtml(body)}</p>${action || ''}</div>`
}

function rowHtml(item, dayKey) {
  const plan = item.plan
  const kind = kindOf(plan.kind)
  const done = !!item.done
  const steps = plan.steps || []
  const stepsDone = steps.filter((step) => step.done).length
  const percent = steps.length ? Math.round((stepsDone / steps.length) * 100) : Number(plan.progress) || 0
  return `
    <article class="hyb-row hyb-row--${kind.id} ${done ? 'is-done' : ''} ${item.skipped ? 'is-skipped' : ''} ${plan.status === 'dropped' ? 'is-aside' : ''} ${plan.priority === 'high' && !done ? 'is-urgent' : ''}" data-hyb-row="${escapeHtml(plan.id)}">
      <span class="hyb-row-lane" aria-hidden="true"></span>
      <button type="button" class="hyb-check ${done ? 'checked' : ''}" data-hyb-toggle="${escapeHtml(plan.id)}" data-hyb-date="${escapeHtml(item.date || '')}" aria-pressed="${done}" aria-label="${done ? 'Reopen' : 'Finish'} ${escapeHtml(plan.title)}">${icon('check')}</button>
      <div class="hyb-row-main">
        <button type="button" class="hyb-row-title" data-hyb-edit="${escapeHtml(plan.id)}" title="Open this plan">${escapeHtml(plan.title)}</button>
        <p class="hyb-row-meta">
          <span class="hyb-kind-chip hyb-kind-chip--${kind.id}">${icon(kind.icon)}${kind.label}</span>
          <span>${escapeHtml(relativeDayLabel(item.date, currentDayKey()))}</span>
          ${plan.startTime ? `<span>${icon('clock')}${timeLabel(plan.startTime, true)}</span>` : ''}
          <span>${formatDuration(plan.minutes)}</span>
          <span>${energyOf(plan.energy).label}</span>
          ${plan.repeat !== 'none' ? `<span class="hyb-repeat">${icon('recover')}${repeatOf(plan.repeat).label}</span>` : ''}
          ${item.skipped ? '<span class="hyb-skipped">Skipped</span>' : ''}
          ${plan.missionId ? `<span class="hyb-linked" title="Connected to a mission">${icon('link')}</span>` : ''}
        </p>
        ${steps.length || percent ? `<div class="hyb-steps"><span class="hyb-steps-track"><i style="width:${percent}%"></i></span><small>${steps.length ? `${stepsDone}/${steps.length} steps` : `${percent}%`}</small></div>` : ''}
        ${plan.notes ? `<p class="hyb-row-notes">${escapeHtml(plan.notes.slice(0, 120))}${plan.notes.length > 120 ? '…' : ''}</p>` : ''}
      </div>
      <div class="hyb-row-actions">
        ${!done && item.date ? `<button type="button" class="icon-btn" data-hyb-schedule="${escapeHtml(plan.id)}" data-hyb-date="${escapeHtml(item.date || dayKey || '')}" aria-label="Put ${escapeHtml(plan.title)} on the schedule" title="Put it on the schedule">${icon('calendar')}</button>` : ''}
        ${!done ? `<button type="button" class="icon-btn" data-hyb-skip="${escapeHtml(plan.id)}" data-hyb-date="${escapeHtml(item.date || dayKey || '')}" aria-label="Move this plan on" title="Not today">${icon('close')}</button>` : ''}
        <button type="button" class="icon-btn" data-hyb-edit="${escapeHtml(plan.id)}" aria-label="Edit ${escapeHtml(plan.title)}" title="Edit plan">${icon('edit')}</button>
      </div>
    </article>`
}

/* ------------------------------------------------------------------ bind */

function bindDeck(root, today) {
  const form = qs(root, '#hyb-quick-form')
  const input = qs(root, '#hyb-quick-input')
  const chips = qs(root, '#hyb-quick-chips')
  const dateField = qs(root, '#hyb-quick-date')
  const timeField = qs(root, '#hyb-quick-time')
  const minutesField = qs(root, '#hyb-quick-minutes')
  let lane = null

  const repaintChips = () => {
    if (!chips) return
    const parsed = parseHybInput(String(input?.value || ''), { todayKey: today, categories: state.categories })
    chips.innerHTML = quickChipsHtml(
      {
        ...parsed,
        date: parsed.date || (isValidKey(dateField?.value) ? dateField.value : null),
        startTime: parsed.startTime || timeField?.value || null,
        minutes: parsed.minutes || Number(minutesField?.value) || null,
        kind: parsed.kind || lane,
      },
      today,
    )
  }

  input?.addEventListener('input', repaintChips)
  for (const field of [dateField, timeField, minutesField]) field?.addEventListener('change', repaintChips)

  qsa(root, '[data-hyb-lane]').forEach((button) =>
    button.addEventListener('click', () => {
      const wanted = button.dataset.hybLane
      lane = lane === wanted ? null : wanted
      qsa(root, '[data-hyb-lane]').forEach((other) => {
        const active = other.dataset.hybLane === lane
        other.classList.toggle('is-active', active)
        other.setAttribute('aria-pressed', String(active))
      })
      repaintChips()
    }),
  )

  form?.addEventListener('submit', (event) => {
    event.preventDefault()
    const text = String(input?.value || '').trim()
    const parsed = parseHybInput(text, { todayKey: today, categories: state.categories })
    const fallbackDate = isValidKey(dateField?.value) ? dateField.value : today
    if (!parsed.title && !lane) {
      toast('Give the plan a name first.', 'info')
      input?.focus()
      return
    }
    // Set the deck's position first: the commit repaints the deck for us.
    deckTab = 'today'
    deckDate = parsed.date || fallbackDate
    addHybPlan({
      title: parsed.title || 'Untitled plan',
      date: parsed.date || fallbackDate,
      startTime: parsed.startTime || timeField?.value || null,
      minutes: parsed.minutes || Number(minutesField?.value) || state.settings?.hyb?.defaultMinutes || 60,
      kind: parsed.kind || lane || state.settings?.hyb?.defaultKind || 'study',
      energy: parsed.energy || 'steady',
      priority: parsed.priority || 'medium',
      repeat: parsed.repeat || 'none',
      tags: parsed.tags,
    })
    lane = null
    const nextInput = qs(document.getElementById('hyb-root'), '#hyb-quick-input')
    const nextTime = qs(document.getElementById('hyb-root'), '#hyb-quick-time')
    if (nextTime) nextTime.value = ''
    nextInput?.focus()
  })

  input?.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      if (form?.requestSubmit) form.requestSubmit()
      else form?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
    }
  })

  qsa(root, '[data-hyb-tab]').forEach((button) =>
    button.addEventListener('click', () => {
      deckTab = button.dataset.hybTab
      if (deckTab !== 'today') deckDate = null
      paintDeck()
    }),
  )

  qsa(root, '[data-hyb-toggle]').forEach((button) =>
    button.addEventListener('click', () => toggleHybPlanDay(button.dataset.hybToggle, button.dataset.hybDate || today)),
  )

  qsa(root, '[data-hyb-skip]').forEach((button) =>
    button.addEventListener('click', () => {
      const plan = getHybPlan(button.dataset.hybSkip)
      if (!plan) return
      if (plan.repeat === 'none') moveHybPlanDate(plan.id, addDays(button.dataset.hybDate || today, 1))
      else skipHybPlanDay(plan.id, button.dataset.hybDate || today)
    }),
  )

  qsa(root, '[data-hyb-schedule]').forEach((button) =>
    button.addEventListener('click', () => scheduleHybPlan(button.dataset.hybSchedule, { date: button.dataset.hybDate || today })),
  )

  qsa(root, '[data-hyb-edit]').forEach((button) => button.addEventListener('click', () => openHybPlanModal(button.dataset.hybEdit)))

  qsa(root, '[data-hyb-new]').forEach((button) =>
    button.addEventListener('click', () => openHybPlanModal(null, { date: button.dataset.hybDate || deckDate || today })),
  )

  qsa(root, '[data-hyb-open-day]').forEach((button) =>
    button.addEventListener('click', () => {
      deckTab = 'today'
      deckDate = button.dataset.hybOpenDay
      paintDeck()
    }),
  )

  qsa(root, '[data-hyb-clear-day]').forEach((button) =>
    button.addEventListener('click', async () => {
      const day = button.dataset.hybClearDay
      const open = hybDay(day).filter((item) => !item.done && !item.skipped)
      if (!open.length) return
      const ok = await confirmDialog({
        title: 'Finish the whole day?',
        message: `${open.length} HYB plan${open.length === 1 ? '' : 's'} will be marked done for ${formatKeyLabel(day)}. Any of them can be reopened.`,
        confirmText: 'Mark them done',
      })
      if (!ok) return
      commit((s) => {
        for (const item of open) {
          const target = s.hyb?.plans?.find((plan) => plan.id === item.plan.id)
          if (!target) continue
          target.updatedAt = Date.now()
          if (target.repeat === 'none') {
            target.status = 'done'
            target.completedAt = Date.now()
          } else target.log = { ...(target.log || {}), [day]: 'done' }
        }
      })
      toast('Day finished. Well done.', 'success')
    }),
  )

  qsa(root, '[data-hyb-goto]').forEach((button) =>
    button.addEventListener('click', () => {
      const view = button.dataset.hybGoto
      closeHybDeck({ restoreFocus: false })
      window.CC.switchView(view)
    }),
  )

  qsa(root, '[data-hyb-close]').forEach((button) => button.addEventListener('click', () => closeHybDeck()))

  repaintChips()
}

/* ------------------------------------------------------- the plan editor */

/**
 * The full plan editor: lane, day, length, energy, repeat, tags, steps, notes
 * and the links to missions/goals/projects. It is also the place a plan leaves
 * HYB — onto the schedule, into missions, set aside, or deleted.
 */
export function openHybPlanModal(id = null, { date = null, kind = null } = {}) {
  const existing = id ? getHybPlan(id) : null
  const today = currentDayKey()
  const defaults = state.settings?.hyb || {}
  const plan = existing || {
    title: '',
    notes: '',
    date: isValidKey(date) ? date : today,
    startTime: null,
    minutes: defaults.defaultMinutes || 60,
    kind: kind || defaults.defaultKind || 'study',
    priority: 'medium',
    energy: 'steady',
    repeat: 'none',
    tags: [],
    steps: [],
    status: 'planned',
    log: {},
    missionId: null,
    goalId: null,
    projectId: null,
  }

  openModal({
    id: 'hyb-plan-modal',
    title: existing ? 'Edit this HYB plan' : 'A new HYB plan',
    size: 'modal-wide',
    body: `
      <form id="hyb-plan-form" class="hyb-form">
        <p class="hyb-form-intro">${icon('bolt')}<span>A plan is one honest intention: a lane, a day, a length of time and how hard it will be. Nothing else is required.</span></p>
        <div>
          <label class="field-label" for="hyb-title">What is the plan?</label>
          <input class="input-field hyb-title-input" id="hyb-title" maxlength="160" placeholder="Two hours of revision, phone in the other room" value="${escapeHtml(plan.title)}" required>
        </div>
        <div>
          <p class="field-label">Lane</p>
          <div class="hyb-lane-picker hyb-lane-picker--form" role="group" aria-label="Plan lane">
            ${HYB_KINDS.map(
              (entry) =>
                `<button type="button" class="hyb-lane hyb-lane--${entry.id} ${plan.kind === entry.id ? 'is-active' : ''}" data-hyb-form-lane="${entry.id}" aria-pressed="${plan.kind === entry.id}" title="${escapeHtml(entry.hint)}">${icon(entry.icon)}<span>${entry.label}</span></button>`,
            ).join('')}
          </div>
        </div>
        <div class="form-grid hyb-form-grid">
          <div>
            <label class="field-label" for="hyb-date">Day</label>
            <input class="input-field" id="hyb-date" type="date" value="${escapeHtml(plan.date || '')}">
            <div class="hyb-presets">
              ${[
                ['', 'Someday'],
                [today, 'Today'],
                [addDays(today, 1), 'Tomorrow'],
                [addDays(today, 7), 'Next week'],
              ]
                .map(([value, label]) => `<button type="button" class="preset-btn ${String(plan.date || '') === value ? 'preset-active' : ''}" data-hyb-date-preset="${value}">${label}</button>`)
                .join('')}
            </div>
          </div>
          <div>
            <label class="field-label" for="hyb-start">Starts at</label>
            <input class="input-field" id="hyb-start" type="time" value="${escapeHtml(plan.startTime || '')}">
            <p class="form-hint" style="margin-top:6px">Optional — a plan without a time still counts.</p>
          </div>
          <div>
            <label class="field-label" for="hyb-minutes">Minutes</label>
            <input class="input-field" id="hyb-minutes" type="number" min="5" max="1440" step="5" value="${Number(plan.minutes) || 60}">
            <div class="hyb-presets">
              ${[30, 60, 90, 120].map((value) => `<button type="button" class="preset-btn ${Number(plan.minutes) === value ? 'preset-active' : ''}" data-hyb-minutes-preset="${value}">${value}m</button>`).join('')}
            </div>
          </div>
          <div>
            <label class="field-label" for="hyb-repeat">Repeats</label>
            <select class="input-field" id="hyb-repeat">
              ${HYB_REPEATS.map((entry) => `<option value="${entry.id}" ${plan.repeat === entry.id ? 'selected' : ''}>${entry.label}</option>`).join('')}
            </select>
            <p class="form-hint" style="margin-top:6px">A repeating plan is finished day by day, never all at once.</p>
          </div>
        </div>
        <div class="form-grid hyb-form-grid">
          <div>
            <p class="field-label">How hard is it?</p>
            <div class="segmented hyb-energy" role="group" aria-label="Energy">
              ${HYB_ENERGY.map((entry) => `<button type="button" data-hyb-energy="${entry.id}" class="${plan.energy === entry.id ? 'seg-active' : ''}" aria-pressed="${plan.energy === entry.id}" title="${escapeHtml(entry.hint)}">${entry.label}</button>`).join('')}
            </div>
          </div>
          <div>
            <p class="field-label">Priority</p>
            <div class="segmented" role="group" aria-label="Priority">
              ${['high', 'medium', 'low'].map((value) => `<button type="button" data-hyb-priority="${value}" class="${plan.priority === value ? 'seg-active' : ''}" aria-pressed="${plan.priority === value}">${value[0].toUpperCase()}${value.slice(1)}</button>`).join('')}
            </div>
          </div>
        </div>
        <div class="form-grid hyb-form-grid">
          <div>
            <label class="field-label" for="hyb-tags">Tags</label>
            <input class="input-field" id="hyb-tags" placeholder="mock, maths, gym" value="${escapeHtml((plan.tags || []).join(', '))}">
            <p class="form-hint" style="margin-top:6px">Comma separated. Tags are for you — they never affect your score.</p>
          </div>
          <div>
            <label class="field-label" for="hyb-mission">Connected mission</label>
            <select class="input-field" id="hyb-mission">${taskOptions(plan.missionId || '')}</select>
          </div>
          <div>
            <label class="field-label" for="hyb-goal">Connected goal</label>
            <select class="input-field" id="hyb-goal">${goalOptions(plan.goalId || '')}</select>
          </div>
          <div>
            <label class="field-label" for="hyb-project">Connected project</label>
            <select class="input-field" id="hyb-project">${projectOptions(plan.projectId || '', plan.goalId || '')}</select>
          </div>
        </div>
        <div>
          <div class="section-heading"><h4>Steps</h4><button type="button" class="text-button" data-hyb-add-step>${icon('plus')}Add a step</button></div>
          <div class="hyb-steps-editor" id="hyb-steps-editor"></div>
        </div>
        <div>
          <label class="field-label" for="hyb-notes">Notes</label>
          <textarea class="input-field" id="hyb-notes" rows="3" maxlength="4000" placeholder="Page numbers, the link, what good looks like…">${escapeHtml(plan.notes || '')}</textarea>
        </div>
        ${existing ? `<div class="hyb-form-status">${statusChipsHtml(existing)}</div>` : ''}
        <div class="form-footer hyb-form-footer">
          ${existing ? `<button type="button" class="btn-danger btn-small" data-hyb-delete>${icon('trash')}Delete</button>` : ''}
          ${existing ? `<button type="button" class="btn-ghost btn-small" data-hyb-duplicate>${icon('projects')}Duplicate</button>` : ''}
          ${existing ? `<button type="button" class="btn-ghost btn-small" data-hyb-drop>${icon('close')}${existing.status === 'dropped' ? 'Bring it back' : 'Set aside'}</button>` : ''}
          ${existing ? `<button type="button" class="btn-ghost btn-small" data-hyb-to-mission>${icon('missions')}Make it a mission</button>` : ''}
          <span class="hyb-footer-space"></span>
          <button type="button" class="btn-ghost" data-modal-close>Cancel</button>
          <button type="submit" class="btn-primary">${icon('bolt')}${existing ? 'Save plan' : 'Add plan'}</button>
        </div>
      </form>`,
    onMount: (box) => bindPlanForm(box, existing),
  })
}

function statusChipsHtml(plan) {
  const chips = [
    `<span class="chip ${plan.status === 'done' ? 'chip-good' : plan.status === 'dropped' ? 'chip-warn' : ''}">${icon(plan.status === 'done' ? 'check' : plan.status === 'dropped' ? 'close' : 'clock')}${plan.status === 'done' ? 'Finished' : plan.status === 'dropped' ? 'Set aside' : 'Planned'}</span>`,
  ]
  if (plan.repeat !== 'none') {
    const doneDays = Object.values(plan.log || {}).filter((value) => value === 'done').length
    chips.push(`<span class="chip">${icon('recover')}${repeatOf(plan.repeat).label} · ${doneDays} day${doneDays === 1 ? '' : 's'} done</span>`)
  }
  if (plan.missionId) chips.push(`<span class="chip chip-accent">${icon('link')}Linked to a mission</span>`)
  chips.push(`<span class="chip">${icon('calendar')}Added ${formatKeyLabel(new Date(plan.createdAt || Date.now()).toISOString().slice(0, 10), { year: false })}</span>`)
  return chips.join('')
}

function bindPlanForm(box, existing) {
  const form = qs(box, '#hyb-plan-form')
  const draft = {
    kind: existing?.kind || state.settings?.hyb?.defaultKind || 'study',
    energy: existing?.energy || 'steady',
    priority: existing?.priority || 'medium',
    steps: (existing?.steps || []).map((step) => ({ ...step })),
  }

  const stepsEditor = qs(box, '#hyb-steps-editor')
  const repaintSteps = () => {
    if (!stepsEditor) return
    stepsEditor.innerHTML = stepsHtml(draft.steps)
    bindStepRows()
  }
  const bindStepRows = () => {
    qsa(stepsEditor, '[data-hyb-step]').forEach((row) => {
      const stepId = row.dataset.hybStep
      qs(row, '[data-hyb-step-done]')?.addEventListener('change', (event) => {
        const step = draft.steps.find((entry) => entry.id === stepId)
        if (step) step.done = /** @type {any} */ (event.target).checked === true
      })
      qs(row, '[data-hyb-step-title]')?.addEventListener('input', (event) => {
        const step = draft.steps.find((entry) => entry.id === stepId)
        if (step) step.title = String(/** @type {any} */ (event.target).value).slice(0, 160)
      })
      qs(row, '[data-hyb-step-remove]')?.addEventListener('click', () => {
        draft.steps = draft.steps.filter((entry) => entry.id !== stepId)
        repaintSteps()
      })
    })
  }
  repaintSteps()

  qs(box, '[data-hyb-add-step]')?.addEventListener('click', () => {
    if (draft.steps.length >= 30) {
      toast('Thirty steps is plenty for one plan.', 'info')
      return
    }
    draft.steps.push({ id: `step-${Date.now().toString(36)}-${draft.steps.length}`, title: '', done: false })
    repaintSteps()
    const inputs = qsa(stepsEditor, '[data-hyb-step-title]')
    inputs[inputs.length - 1]?.focus()
  })

  const exclusive = (selector, attr, value) => {
    qsa(box, selector).forEach((other) => {
      const active = other.dataset[attr] === value
      other.classList.toggle(other.classList.contains('hyb-lane') ? 'is-active' : 'seg-active', active)
      other.setAttribute('aria-pressed', String(active))
    })
  }

  qsa(box, '[data-hyb-form-lane]').forEach((button) =>
    button.addEventListener('click', () => {
      draft.kind = button.dataset.hybFormLane
      exclusive('[data-hyb-form-lane]', 'hybFormLane', draft.kind)
    }),
  )
  qsa(box, '[data-hyb-energy]').forEach((button) =>
    button.addEventListener('click', () => {
      draft.energy = button.dataset.hybEnergy
      exclusive('[data-hyb-energy]', 'hybEnergy', draft.energy)
    }),
  )
  qsa(box, '[data-hyb-priority]').forEach((button) =>
    button.addEventListener('click', () => {
      draft.priority = button.dataset.hybPriority
      exclusive('[data-hyb-priority]', 'hybPriority', draft.priority)
    }),
  )

  qsa(box, '[data-hyb-date-preset]').forEach((button) =>
    button.addEventListener('click', () => {
      const field = qs(box, '#hyb-date')
      if (field) field.value = button.dataset.hybDatePreset
      qsa(box, '[data-hyb-date-preset]').forEach((other) => other.classList.toggle('preset-active', other === button))
    }),
  )

  qsa(box, '[data-hyb-minutes-preset]').forEach((button) =>
    button.addEventListener('click', () => {
      const field = qs(box, '#hyb-minutes')
      if (field) field.value = button.dataset.hybMinutesPreset
      qsa(box, '[data-hyb-minutes-preset]').forEach((other) => other.classList.toggle('preset-active', other === button))
    }),
  )

  const readForm = () => {
    const dateValue = String(qs(box, '#hyb-date')?.value || '')
    const tags = String(qs(box, '#hyb-tags')?.value || '')
      .split(',')
      .map((tag) =>
        tag
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, ''),
      )
      .filter(Boolean)
      .slice(0, 8)
    return {
      title: String(qs(box, '#hyb-title')?.value || '').trim(),
      notes: String(qs(box, '#hyb-notes')?.value || ''),
      date: isValidKey(dateValue) ? dateValue : null,
      startTime: String(qs(box, '#hyb-start')?.value || '') || null,
      minutes: Number(qs(box, '#hyb-minutes')?.value) || state.settings?.hyb?.defaultMinutes || 60,
      repeat: String(qs(box, '#hyb-repeat')?.value || 'none'),
      kind: draft.kind,
      energy: draft.energy,
      priority: draft.priority,
      tags,
      steps: draft.steps.filter((step) => String(step.title || '').trim()).map((step) => ({ ...step, title: String(step.title).trim() })),
      missionId: String(qs(box, '#hyb-mission')?.value || '') || null,
      goalId: String(qs(box, '#hyb-goal')?.value || '') || null,
      projectId: String(qs(box, '#hyb-project')?.value || '') || null,
    }
  }

  form?.addEventListener('submit', (event) => {
    event.preventDefault()
    const values = readForm()
    if (!values.title) {
      toast('A plan needs a name.', 'error')
      qs(box, '#hyb-title')?.focus()
      return
    }
    if (existing) updateHybPlan(existing.id, values, { message: `Plan saved · ${values.title}` })
    else addHybPlan(values)
    closeModal()
  })

  qs(box, '[data-hyb-delete]')?.addEventListener('click', async () => {
    if (!existing) return
    const ok = await confirmDialog({
      title: 'Delete this plan?',
      message: `“${existing.title}” will be removed from your HYB plans. Missions, focus history and the schedule are untouched.`,
      confirmText: 'Delete plan',
      danger: true,
    })
    if (!ok) return
    removeHybPlan(existing.id)
    closeModal()
  })

  qs(box, '[data-hyb-duplicate]')?.addEventListener('click', () => {
    if (!existing) return
    duplicateHybPlan(existing.id)
    closeModal()
  })

  qs(box, '[data-hyb-drop]')?.addEventListener('click', () => {
    if (!existing) return
    dropHybPlan(existing.id)
    closeModal()
  })

  qs(box, '[data-hyb-to-mission]')?.addEventListener('click', async () => {
    if (!existing) return
    const values = readForm()
    if (!values.title) {
      toast('A plan needs a name before it becomes a mission.', 'error')
      return
    }
    updateHybPlan(existing.id, values, { message: '' })
    const ok = await confirmDialog({
      title: 'Make this a mission?',
      message: `A mission called “${values.title}” will be created${values.repeat !== 'none' ? ` and repeat ${repeatOf(values.repeat).label.toLowerCase()}` : ''}, on ${values.date ? formatKeyLabel(values.date) : 'today'}. The HYB plan stays in your list and keeps the link.`,
      confirmText: 'Create the mission',
    })
    if (!ok) return
    const missionId = hybPlanToMission(existing.id, { date: values.date })
    if (missionId) closeModal()
  })
}

function stepsHtml(steps) {
  if (!steps.length) return '<p class="form-hint hyb-steps-empty">No steps yet. A plan with three steps is easier to start than a plan with good intentions.</p>'
  return steps
    .map(
      (step) => `
      <div class="hyb-step-row" data-hyb-step="${escapeHtml(step.id)}">
        <input type="checkbox" data-hyb-step-done ${step.done ? 'checked' : ''} aria-label="Step finished">
        <input class="input-field" data-hyb-step-title value="${escapeHtml(step.title)}" maxlength="160" aria-label="Step title" placeholder="One concrete step">
        <button type="button" class="icon-btn" data-hyb-step-remove aria-label="Remove step">${icon('close')}</button>
      </div>`,
    )
    .join('')
}

/* -------------------------------------------------------- chrome wiring */

/** Wire every HYB trigger in the shell once, at boot. */
export function initHyb() {
  qsa(document, '[data-hyb-trigger]').forEach((button) => {
    if (button.dataset.hybBound === 'true') return
    button.dataset.hybBound = 'true'
    button.addEventListener('click', (event) => {
      event.preventDefault()
      // the deck replaces the mobile drawer rather than stacking on top of it
      window.CC.closeMobileNav?.()
      if (button.dataset.hybTrigger === 'studio') {
        closeHybDeck({ restoreFocus: false })
        window.CC.switchView('hyb')
        return
      }
      toggleHybDeck()
    })
  })
  on('store:change', () => {
    refreshHybTriggers()
    if (deckOpen && !document.querySelector('[data-modal-backdrop]')) paintDeck()
  })
  refreshHybTriggers()
  nudgeOnce()
}

/**
 * The one-time nudge the setting promises: on a brand-new workspace with
 * nothing planned and no missions yet, open the deck once so the HYB button is
 * not a mystery. It records itself in `state.meta`, so it never repeats — and
 * an existing workspace is never interrupted.
 */
function nudgeOnce() {
  const settings = state.settings?.hyb
  if (!settings?.deckOnLoad || state.meta?.hybDeckNudged) return
  if ((state.hyb?.plans || []).length || (state.tasks || []).length) return
  // never talk over the morning briefing or an open dialog
  if (document.querySelector('[data-modal-backdrop]') || document.getElementById('briefing-overlay')) return
  commit((next) => {
    next.meta = { ...(next.meta || {}), hybDeckNudged: Date.now() }
  }, { silent: true, immediate: true })
  setTimeout(() => {
    if (deckOpen || document.querySelector('[data-modal-backdrop]') || document.getElementById('briefing-overlay')) return
    openHybDeck({ focusInput: true })
  }, 500)
}
