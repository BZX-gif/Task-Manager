/* -------------------------------------------------------------------------
   BRIEFING UI — the "Sir" experience
   -------------------------------------------------------------------------
   A calm, full-screen briefing that greets you by your chosen salutation,
   shows the one mission that needs you now, the shape of the day and your
   intention — plus the always-visible command strip under the top bar.

   Everything is derived from the briefing model (lib/briefing.js). Nothing
   here writes data except the intention you type and the "last shown" day.
   ------------------------------------------------------------------------- */

import { escapeHtml, isModalOpen, qs, qsa, toast } from '../core/dom.js'
import { commit, currentDayKey, state, streak, todayStats } from '../core/store.js'
import { scheduleFor } from '../lib/planner.js'
import { formatDuration } from '../lib/dates.js'
import {
  briefingSpeech,
  buildBriefing,
  intentionFor,
  markBriefingShown,
  shouldShowBriefing,
  withRelations,
  writeIntention,
} from '../lib/briefing.js'
import { icon, ring, timeLabel } from './common.js'

const AUTO_DELAY_MS = 1200
let autoTimer = null
let lastFocus = null
let current = null

export function isBriefingOpen() {
  return !!document.getElementById('briefing-overlay')
}

/** Read-only snapshot for other modules and tests. */
export function briefingInfo(now = new Date()) {
  return briefingFor(now)
}

function briefingFor(now = new Date()) {
  if (!state) return null
  const today = currentDayKey(now)
  return withRelations(
    buildBriefing(state, {
      now,
      todayKey: today,
      blocks: scheduleFor(state, today),
      stats: todayStats(now),
      streak: streak(now),
    }),
    state,
  )
}

/* ------------------------------------------------------- command strip */

/**
 * Keep the one-line "At your command" strip in sync with real data.
 * Cheap enough for store changes, minute ticks and view changes.
 */
export function refreshCommandStrip(now = new Date()) {
  const strip = document.getElementById('command-strip')
  if (!strip || !state) return null
  let briefing = null
  try {
    // The strip runs on every store change, so skip the (deliberately more
    // expensive) streak/score maths — it has no place in a one-line summary.
    briefing = withRelations(
      buildBriefing(state, { now, todayKey: currentDayKey(now), blocks: scheduleFor(state, currentDayKey(now)), stats: null, streak: null }),
      state,
    )
  } catch (error) {
    console.warn('[briefing] strip update skipped', error)
    return null
  }
  const setText = (selector, value) => {
    const node = strip.querySelector(selector)
    if (node && node.textContent !== value) node.textContent = value
  }
  const focus = briefing.focus
  setText('#command-strip-salute', `At your command, ${briefing.salutation}.`)
  setText('#command-strip-task', focus.kind === 'clear' ? 'Nothing pending — the day is yours' : focus.title)
  const meta = [
    focus.kind === 'clear' ? '' : focus.reason,
    focus.time ? timeLabel(focus.time, true) : '',
    focus.minutes ? formatDuration(focus.minutes) : '',
    focus.goalTitle || focus.projectTitle || '',
  ].filter(Boolean)
  setText('#command-strip-meta', meta.join(' · '))
  strip.dataset.kind = focus.kind
  return briefing
}

/* ------------------------------------------------------------ overlay */

function scoreCopy(counts) {
  if (counts.score == null) return { title: 'A fresh canvas.', body: 'Your real progress will appear here.' }
  if (counts.score >= 80) return { title: 'Finding your rhythm.', body: 'Built on the commitments you kept.' }
  if (counts.score >= 40) return { title: 'Progress, in motion.', body: 'One honest step at a time.' }
  return { title: 'One step at a time.', body: 'Today is not a verdict. It is a day.' }
}

function buttonsFor(focus, today) {
  if (focus.kind === 'clear') {
    return `<button class="btn-primary" data-briefing-plan>${icon('sun')}Plan my day</button>
      <button class="btn-ghost" data-briefing-new>${icon('plus')}Add a mission</button>`
  }
  const start = `<button class="btn-primary" data-briefing-start>${icon('play')}${state.focus?.active ? 'Resume focus' : focus.kind === 'scheduled' ? 'Start this block' : 'Begin mission'}</button>`
  const complete = focus.taskId
    ? `<button class="btn-ghost" data-briefing-complete>${icon('check')}Complete</button>`
    : focus.blockId
      ? `<button class="btn-ghost" data-briefing-complete-block="${escapeHtml(focus.blockId)}">${icon('check')}Complete block</button>`
      : ''
  const reschedule = focus.taskId ? `<button class="text-button" data-briefing-reschedule>${icon('calendar')}Reschedule</button>` : ''
  const open = focus.taskId ? `<button class="text-button" data-briefing-edit>${icon('edit')}Open mission</button>` : ''
  return `${start}${complete}${reschedule}${open}`
}

function briefingHtml(b, now) {
  const date = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const clock = now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: state.settings.timeFormat !== '24h',
  })
  const counts = b.counts
  const focus = b.focus
  const copy = scoreCopy(counts)
  const chips = []
  if (focus.time) chips.push(`<span>${icon('clock')}${timeLabel(focus.time, true)}</span>`)
  if (focus.minutes) chips.push(`<span>${icon('focus')}${formatDuration(focus.minutes)}</span>`)
  if (focus.priority === 'high') chips.push(`<span class="chip chip-accent">High priority</span>`)
  const relation = focus.goalTitle || focus.projectTitle
  if (relation) chips.push(`<span>${icon('target')}${escapeHtml(relation)}</span>`)

  const openLine = counts.open
    ? `${counts.open} mission${counts.open === 1 ? '' : 's'} left today`
    : counts.planned
      ? 'Everything planned today is done'
      : 'Nothing is scheduled yet'
  const overdueLine = counts.overdue
    ? ` · ${counts.overdue} from earlier still waiting`
    : ''
  const intentionLine = b.intention
    ? `<p class="briefing-intention-line">${icon('flag')}Today’s intention — <strong>${escapeHtml(b.intention)}</strong></p>`
    : `<p class="briefing-intention-line is-empty">${icon('flag')}One honest intention for today. Set it below.</p>`

  const statRows = [
    ['Missions', `${counts.done} / ${counts.planned}`, 'done today'],
    ['Top three', `${counts.top3Done} / ${counts.top3Total || 3}`, 'priorities'],
    ['Focused', formatDuration(counts.focusMinutes), `of ${formatDuration(counts.focusTarget)}`],
    ['From earlier', String(counts.overdue), counts.overdue ? 'still open' : 'nothing overdue'],
  ]
  if (counts.streak != null) statRows.push(['Streak', `${counts.streak} day${counts.streak === 1 ? '' : 's'}`, counts.bestStreak ? `best ${counts.bestStreak}` : 'showing up'])

  return `
  <div class="briefing-overlay" id="briefing-overlay" data-briefing-overlay>
    <div class="briefing-panel" role="dialog" aria-modal="true" aria-labelledby="briefing-salute" tabindex="-1">
      <div class="briefing-aurora" aria-hidden="true"><span></span><span></span><span></span></div>
      <header class="briefing-head">
        <div class="briefing-head-main">
          <p class="eyebrow">COMMAND BRIEFING <span class="briefing-dot" aria-hidden="true">·</span> ${escapeHtml(date)}</p>
          <h1 class="briefing-salute" id="briefing-salute">${escapeHtml(b.greeting)}</h1>
          <p class="briefing-lead">${escapeHtml(b.lead)} ${escapeHtml(openLine)}${escapeHtml(overdueLine)}.</p>
          ${intentionLine}
        </div>
        <div class="briefing-head-side">
          <p class="briefing-clock" aria-label="Current time">${escapeHtml(clock)}</p>
          <button class="icon-btn briefing-close" data-briefing-close aria-label="Close the briefing">${icon('close')}</button>
        </div>
      </header>

      <div class="briefing-grid">
        <section class="briefing-focus" data-focus-kind="${escapeHtml(focus.kind)}">
          <p class="eyebrow"><span class="status-dot"></span>${focus.kind === 'clear' ? 'NOTHING PENDING' : 'YOUR NEXT MOVE'}</p>
          <h2>${escapeHtml(focus.title)}</h2>
          <p class="briefing-reason">${escapeHtml(focus.reason)}</p>
          ${chips.length ? `<div class="briefing-chips">${chips.join('')}</div>` : ''}
          <div class="briefing-actions">${buttonsFor(focus, b.todayKey)}</div>
        </section>

        <aside class="briefing-stats" aria-label="The day at a glance">
          <div class="briefing-score">
            ${ring(counts.score ?? 0, 'of 100', counts.score == null)}
            <div>
              <strong>${escapeHtml(copy.title)}</strong>
              <p>${escapeHtml(copy.body)}</p>
            </div>
          </div>
          <div class="briefing-stat-rows">${statRows
            .map(
              ([label, value, detail]) =>
                `<div class="briefing-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></div>`,
            )
            .join('')}</div>
        </aside>
      </div>

      <div class="briefing-lower">
        <section class="briefing-agenda" aria-label="Coming up">
          <div class="briefing-section-head"><h3>Coming up</h3>${icon('calendar')}</div>
          ${
            b.nextUp.length
              ? `<div class="briefing-agenda-list">${b.nextUp
                  .map(
                    (item) =>
                      `<div class="briefing-agenda-row"><span class="briefing-agenda-time">${escapeHtml(timeLabel(item.time, true))}</span><span class="briefing-agenda-dot" aria-hidden="true"></span><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(formatDuration(item.duration))}${item.priority === 'high' ? ' · high priority' : ''}</small></div></div>`,
                  )
                  .join('')}</div>`
              : `<p class="briefing-empty">${icon('leaf')}Nothing else is scheduled. Room to breathe — or to choose one more meaningful thing.</p>`
          }
          ${b.tomorrow ? `<p class="briefing-tomorrow">${icon('sun')}<span><strong>Tomorrow begins with</strong> ${escapeHtml(b.tomorrow.title)}${b.tomorrow.time ? ` · ${escapeHtml(timeLabel(b.tomorrow.time, true))}` : ''}</span></p>` : ''}
          ${counts.inbox ? `<p class="briefing-inbox">${icon('inbox')}${counts.inbox} captured thought${counts.inbox === 1 ? '' : 's'} waiting in your inbox.</p>` : ''}
        </section>

        <section class="briefing-intention" aria-label="Today's intention">
          <div class="briefing-section-head"><h3>Today’s intention</h3>${icon('flag')}</div>
          <form data-briefing-intention-form>
            <label class="sr-only" for="briefing-intention-input">Today’s intention</label>
            <input class="input-field" id="briefing-intention-input" data-briefing-intention maxlength="200" autocomplete="off" placeholder="One sentence that would make today feel well spent…" value="${escapeHtml(b.intention)}">
            <button class="btn-primary btn-small" type="submit">${icon('check')}Save</button>
          </form>
          <p class="form-hint">Private to this device. It appears in your briefing and spoken summary.</p>
          <div class="briefing-intention-actions">
            <button class="text-button" data-briefing-speak>${icon('bell')}Hear the briefing</button>
            <button class="text-button" data-briefing-priorities>${icon('target')}My three priorities</button>
          </div>
        </section>
      </div>

      <footer class="briefing-foot">
        <p>${icon('shield')}Private to this device · nothing leaves your browser</p>
        <div class="briefing-foot-actions">
          ${counts.overdue ? `<button class="btn-ghost btn-small" data-briefing-recover>${icon('recover')}Recover my day</button>` : ''}
          <button class="btn-ghost btn-small" data-briefing-focus>${icon('focus')}Focus room</button>
          <button class="btn-ghost btn-small" data-briefing-day>${icon('sun')}My Day</button>
          <button class="btn-secondary btn-small" data-briefing-close>Return to my desk</button>
        </div>
      </footer>
    </div>
  </div>`
}

function paint(b, now = new Date()) {
  const root = document.getElementById('briefing-root')
  if (!root) return
  root.innerHTML = briefingHtml(b, now)
  current = b
  bind()
  const panel = /** @type {any} */ (root.querySelector('.briefing-panel'))
  panel?.focus?.({ preventScroll: true })
}

function refreshOpen() {
  if (!isBriefingOpen()) return
  const b = briefingFor(new Date())
  if (b) paint(b)
}

export function openBriefing({ auto = false } = {}) {
  if (!state) return null
  if (isBriefingOpen()) {
    refreshOpen()
    return current
  }
  const now = new Date()
  const today = currentDayKey(now)
  const briefing = briefingFor(now)
  if (!briefing) return null
  lastFocus = document.activeElement
  document.body.classList.add('briefing-open')
  paint(briefing, now)
  // Once per day (or on every load when the user prefers that), never more.
  try {
    commit((s) => markBriefingShown(s, today), { silent: true, immediate: true })
  } catch (error) {
    console.warn('[briefing] could not record the briefing day', error)
  }
  if (auto && state.settings.briefingSpeak) setTimeout(() => speakBriefing(briefing, { notify: false }), 500)
  return briefing
}

export function closeBriefing({ restoreFocus = true } = {}) {
  const root = document.getElementById('briefing-root')
  if (root) root.innerHTML = ''
  document.body.classList.remove('briefing-open')
  current = null
  try {
    window.speechSynthesis?.cancel?.()
  } catch {
    /* speech is optional */
  }
  const previous = /** @type {any} */ (lastFocus)
  lastFocus = null
  if (restoreFocus && previous && typeof previous.focus === 'function' && document.contains(previous)) {
    try {
      previous.focus({ preventScroll: true })
    } catch {
      previous.focus()
    }
  }
}

/** Save the intention (mutates via commit so it survives reloads). */
export function saveBriefingIntention(value) {
  if (!state) return ''
  const day = currentDayKey()
  let saved = ''
  commit((s) => {
    saved = writeIntention(s, day, value)
  }, { immediate: true })
  toast(saved ? 'Intention set. A quiet promise to yourself.' : 'Intention cleared.', 'info')
  const line = document.querySelector('.briefing-intention-line')
  if (line) {
    line.classList.toggle('is-empty', !saved)
    line.innerHTML = saved
      ? `${icon('flag')}Today’s intention — <strong>${escapeHtml(saved)}</strong>`
      : `${icon('flag')}One honest intention for today. Set it below.`
  }
  refreshCommandStrip()
  return saved
}

/* --------------------------------------------------------------- speech */

export function speakBriefing(briefing = null, { notify = true } = {}) {
  const data = briefing || current || briefingFor(new Date())
  if (!data) return false
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null
  const Utterance = typeof window !== 'undefined' ? window.SpeechSynthesisUtterance : null
  if (!synth || typeof Utterance !== 'function' || typeof synth.speak !== 'function') {
    if (notify) toast('This browser can’t speak the briefing. Everything is still on screen.', 'info')
    return false
  }
  try {
    synth.cancel()
    const utterance = new Utterance(briefingSpeech(data))
    utterance.rate = 1
    utterance.pitch = 1
    synth.speak(utterance)
    if (notify) toast('Reading your briefing aloud.', 'info')
    return true
  } catch {
    if (notify) toast('The briefing could not be read aloud — the text stays right here.', 'info')
    return false
  }
}

/* --------------------------------------------------------------- events */

function bind() {
  const root = document.getElementById('briefing-root')
  if (!root) return
  const overlay = qs(root, '[data-briefing-overlay]')
  overlay?.addEventListener('mousedown', (event) => {
    if (event.target === overlay) closeBriefing()
  })
  qsa(root, '[data-briefing-close]').forEach((b) => b.addEventListener('click', () => closeBriefing()))
  qs(root, '[data-briefing-start]')?.addEventListener('click', () => {
    const taskId = current?.focus?.taskId
    closeBriefing({ restoreFocus: false })
    if (taskId) window.CC.openFocusMode(taskId)
    else window.CC.openFocusRoom()
  })
  qs(root, '[data-briefing-complete]')?.addEventListener('click', () => {
    if (current?.focus?.taskId) window.CC.toggleMission(current.focus.taskId)
    refreshOpen()
  })
  qs(root, '[data-briefing-complete-block]')?.addEventListener('click', (event) => {
    const id = /** @type {any} */ (event.currentTarget).dataset.briefingCompleteBlock
    if (id) window.CC.toggleScheduleItem(id, current?.todayKey)
    refreshOpen()
  })
  qs(root, '[data-briefing-reschedule]')?.addEventListener('click', () => {
    const id = current?.focus?.taskId
    if (!id) return
    closeBriefing({ restoreFocus: false })
    window.CC.openRescheduleModal(id)
  })
  qs(root, '[data-briefing-edit]')?.addEventListener('click', () => {
    const id = current?.focus?.taskId
    if (!id) return
    closeBriefing({ restoreFocus: false })
    window.CC.openTaskModal(id)
  })
  qs(root, '[data-briefing-recover]')?.addEventListener('click', () => {
    closeBriefing({ restoreFocus: false })
    window.CC.openRecoveryModal()
  })
  qs(root, '[data-briefing-plan]')?.addEventListener('click', () => {
    closeBriefing({ restoreFocus: false })
    window.CC.openDayPlanner()
  })
  qs(root, '[data-briefing-new]')?.addEventListener('click', () => {
    closeBriefing({ restoreFocus: false })
    window.CC.openTaskModal()
  })
  qs(root, '[data-briefing-focus]')?.addEventListener('click', () => {
    closeBriefing({ restoreFocus: false })
    window.CC.openFocusRoom()
  })
  qs(root, '[data-briefing-day]')?.addEventListener('click', () => {
    closeBriefing({ restoreFocus: false })
    window.CC.switchView('day')
  })
  qs(root, '[data-briefing-priorities]')?.addEventListener('click', () => {
    closeBriefing({ restoreFocus: false })
    window.CC.switchView('day')
  })
  qs(root, '[data-briefing-speak]')?.addEventListener('click', () => speakBriefing(current, { notify: true }))
  qs(root, '[data-briefing-intention-form]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    const input = /** @type {any} */ (qs(root, '[data-briefing-intention]'))
    if (input) saveBriefingIntention(input.value)
  })

  // Focus stays inside the briefing while it is open.
  const panel = qs(root, '.briefing-panel')
  panel?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeBriefing()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = qsa(panel, 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])').filter(
      (node) => !node.closest('.hidden, [hidden]'),
    )
    if (!focusable.length) return
    const first = /** @type {any} */ (focusable[0])
    const last = /** @type {any} */ (focusable[focusable.length - 1])
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  })
}

/* ----------------------------------------------------------- lifecycle */

/**
 * Wire the strip, then greet once the app has painted. We never steal focus
 * from someone already typing, an open dialog or a running focus session.
 */
export function initBriefing() {
  refreshCommandStrip()
  if (autoTimer) clearTimeout(autoTimer)
  autoTimer = null
  if (!state || !shouldShowBriefing(state, currentDayKey())) return
  const params = new URLSearchParams(location.search)
  if (params.get('action')) return
  autoTimer = setTimeout(() => {
    autoTimer = null
    if (!state || document.visibilityState === 'hidden') return
    // The user may have opened (and closed) the briefing in the meantime.
    if (!shouldShowBriefing(state, currentDayKey())) return
    if (isModalOpen() || isBriefingOpen() || document.querySelector('.focus-overlay')) return
    const active = document.activeElement
    const typing =
      active instanceof HTMLElement &&
      (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable)
    if (typing) return
    openBriefing({ auto: true })
  }, AUTO_DELAY_MS)
}

export function intentionForToday() {
  return state ? intentionFor(state, currentDayKey()) : ''
}
