/* -------------------------------------------------------------------------
   ONBOARDING — the first five minutes, progressively.

   COMMAND 2.0 asks only what it needs to become useful, and nothing it asks
   is mandatory:

     welcome   what this is, honestly
     identity  who the briefing speaks to (optional)
     setup     working hours and planning shape (optional)
     firstplan prove the whole system in one line (the promise)
     paper     how the intelligence engine uses workspace information
     done      the three shortcuts worth knowing

   Every step can be skipped; the workspace starts empty and clean. Nothing
   here writes data the person did not type.
   ------------------------------------------------------------------------- */
import { state, commit } from '../core/store.js'
import { parseQuickCapture } from '../lib/quickparse.js'
import { formatDuration } from '../lib/dates.js'
import { timeLabel } from './common.js'
import { el, escapeHtml } from '../core/dom.js'
import { icon } from './icons.js'

const STEPS = ['welcome', 'identity', 'setup', 'firstplan', 'paper', 'done']
let step = 0
let lastFocus = null

/* The parser returns machine values (`2026-11-21`, `18:00`) and the preview
 * showed them raw, which made the product look like a database. The chip
 * should read the way a person would say it back. */
function friendlyDate(value) {
  const raw = String(value || '')
  const day = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T12:00:00`) : null
  if (!day || Number.isNaN(day.getTime())) return raw
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  const diff = Math.round((day.getTime() - today.getTime()) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  if (diff > 1 && diff < 7) return day.toLocaleDateString('en-GB', { weekday: 'long' })
  return day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

/** The product's honest one-liner — no feature list, no adjectives. */
const PROMISE = {
  title: 'A quieter place to run your life.',
  body: 'COMMAND is one desk instead of six apps: your missions, the hours they need, the goals they serve — and PAPER, a built-in chief of staff that reads your actual workspace and tells you what matters, with its reasons shown.',
  points: [
    ['missions', 'Capture the work', 'One inbox for everything you owe yourself or someone else.'],
    ['calendar', 'Give it hours', 'Plans, deadlines and focus time in one schedule you control.'],
    ['sparkles', 'Let PAPER think', 'Briefings, priorities and honest alerts — from your data, on your device.'],
  ],
}

const EXAMPLES = [
  { text: 'Revision tomorrow 6pm 90m @study', why: 'a dated study block' },
  { text: 'Gym every weekday 7am 45m @body', why: 'a repeating routine' },
  { text: 'Mock test Saturday 10am 2h', why: 'a fixed commitment' },
]

function overlayHtml() {
  return `<div class="onboarding-overlay" data-onboarding-overlay>
    <section class="onboarding" role="dialog" aria-modal="true" aria-labelledby="onboarding-title" data-onboarding>
      <header class="onboarding-head">
        <span class="onboarding-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        <button class="text-button onboarding-skip" data-onboarding-skip>Skip for now</button>
      </header>
      <div class="onboarding-body" data-onboarding-body></div>
    </section>
  </div>`
}

function welcomeStep() {
  return `<div class="onboarding-step is-active">
    <p class="eyebrow">Welcome to COMMAND</p>
    <h2 id="onboarding-title">${escapeHtml(PROMISE.title)}</h2>
    <p class="onboarding-lede">${escapeHtml(PROMISE.body)}</p>
    <ul class="onboarding-points">
      ${PROMISE.points.map(([symbol, title, copy], i) => `<li>
        <span class="onboarding-point-icon">${icon(symbol)}</span>
        <span class="onboarding-point-copy"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(copy)}</span></span>
        <span class="onboarding-point-index">0${i + 1}</span>
      </li>`).join('')}
    </ul>
    <p class="onboarding-privacy">${icon('shield')}Everything stays in this browser. No account, no server, no analytics.</p>
    <div class="onboarding-actions">
      <button class="btn-primary" data-onboarding-next>Set up my workspace ${icon('arrow')}</button>
      <button class="text-button" data-onboarding-skip>I'll explore on my own</button>
    </div>
  </div>`
}

function identityStep() {
  const name = state?.settings?.userName || ''
  const salute = state?.settings?.salutation || 'Sir'
  return `<div class="onboarding-step is-active">
    <p class="eyebrow">Optional · step 2 of 6</p>
    <h2 id="onboarding-title">Who is this workspace for?</h2>
    <p class="onboarding-lede">The briefing addresses you by name. PAPER uses it in exactly one place — how it speaks to you — and nowhere else.</p>
    <label class="onboarding-field">
      <span class="field-label">Your name</span>
      <input class="input-field" data-onboarding-name maxlength="60" placeholder="Optional" value="${escapeHtml(name)}">
    </label>
    <label class="onboarding-field">
      <span class="field-label">How should the briefing address you?</span>
      <input class="input-field" data-onboarding-salutation maxlength="40" placeholder="Sir" value="${escapeHtml(salute)}">
    </label>
    <div class="onboarding-actions">
      <button class="btn-primary" data-onboarding-next>Continue ${icon('arrow')}</button>
      <button class="text-button" data-onboarding-skip>Skip for now</button>
    </div>
  </div>`
}

function setupStep() {
  const hours = state?.settings?.workingHours || { start: '09:00', end: '18:00' }
  return `<div class="onboarding-step is-active">
    <p class="eyebrow">Optional · step 3 of 6</p>
    <h2 id="onboarding-title">Shape your working day.</h2>
    <p class="onboarding-lede">PAPER's time intelligence plans against these hours — never against a fantasy of unlimited time. You can change them any time in Settings.</p>
    <div class="onboarding-grid">
      <label class="onboarding-field">
        <span class="field-label">Working hours start</span>
        <input class="input-field" type="time" data-onboarding-hours-start value="${escapeHtml(hours.start)}">
      </label>
      <label class="onboarding-field">
        <span class="field-label">Working hours end</span>
        <input class="input-field" type="time" data-onboarding-hours-end value="${escapeHtml(hours.end)}">
      </label>
      <label class="onboarding-field">
        <span class="field-label">Week starts on</span>
        <select class="input-field" data-onboarding-week-start>
          <option value="1" ${state?.settings?.weekStart === 0 ? '' : 'selected'}>Monday</option>
          <option value="0" ${state?.settings?.weekStart === 0 ? 'selected' : ''}>Sunday</option>
        </select>
      </label>
    </div>
    <div class="onboarding-actions">
      <button class="btn-primary" data-onboarding-next>Continue ${icon('arrow')}</button>
      <button class="text-button" data-onboarding-skip>Skip for now</button>
    </div>
  </div>`
}

function planStep() {
  return `<div class="onboarding-step is-active">
    <p class="eyebrow">Step 4 of 6</p>
    <h2 id="onboarding-title">Type a plan the way you'd say it.</h2>
    <p class="onboarding-lede">No forms. Write it naturally and COMMAND picks out the day, the time, the length and the kind of work.</p>
    <label class="onboarding-field">
      <span class="sr-only">Try a plan</span>
      <textarea class="input-field" rows="2" data-onboarding-input placeholder="e.g. Revision tomorrow 6pm 90m @study"></textarea>
    </label>
    <div class="onboarding-preview" data-onboarding-preview aria-live="polite"></div>
    <div class="onboarding-examples">
      <p class="onboarding-examples-label">Or try one of these</p>
      ${EXAMPLES.map((example) => `<button type="button" class="onboarding-example" data-onboarding-example="${escapeHtml(example.text)}">
        <span>${escapeHtml(example.text)}</span><small>${escapeHtml(example.why)}</small>
      </button>`).join('')}
    </div>
    <div class="onboarding-actions">
      <button class="btn-primary" data-onboarding-next>Continue ${icon('arrow')}</button>
      <button class="text-button" data-onboarding-skip>Maybe later</button>
    </div>
  </div>`
}

function paperStep() {
  return `<div class="onboarding-step is-active">
    <p class="eyebrow">Step 5 of 6 · PAPER</p>
    <h2 id="onboarding-title">Meet PAPER, your chief of staff.</h2>
    <p class="onboarding-lede">PAPER is built into COMMAND. It reads only what your workspace records — missions, schedule, goals, focus, history — and reasons over it with deterministic rules you can inspect.</p>
    <ul class="onboarding-points">
      <li><span class="onboarding-point-icon">${icon('check')}</span><span class="onboarding-point-copy"><strong>Every statement is labelled</strong><span>Fact, calculation, inference, recommendation — or missing information.</span></span><span class="onboarding-point-index">01</span></li>
      <li><span class="onboarding-point-icon">${icon('shield')}</span><span class="onboarding-point-copy"><strong>Nothing leaves this device</strong><span>No external model is required. Your data stays yours.</span></span><span class="onboarding-point-index">02</span></li>
      <li><span class="onboarding-point-icon">${icon('edit')}</span><span class="onboarding-point-copy"><strong>You stay in control</strong><span>PAPER prepares changes; nothing happens until you confirm.</span></span><span class="onboarding-point-index">03</span></li>
    </ul>
    <p class="onboarding-privacy">${icon('info')}As your workspace fills in, PAPER's briefings and recommendations get sharper. It will say so when there is not enough data to judge.</p>
    <div class="onboarding-actions">
      <button class="btn-primary" data-onboarding-next>Continue ${icon('arrow')}</button>
      <button class="text-button" data-onboarding-skip>Skip for now</button>
    </div>
  </div>`
}

function doneStep() {
  return `<div class="onboarding-step is-active">
    <p class="eyebrow">You're set</p>
    <h2 id="onboarding-title">Three things worth knowing.</h2>
    <ul class="onboarding-shortcuts">
      <li><kbd>⌘K</kbd><span><strong>Search anything</strong><span>Missions, plans, actions — one field.</span></span></li>
      <li><kbd>N</kbd><span><strong>Capture a thought</strong><span>It lands in the inbox; sort it later.</span></span></li>
      <li><kbd>P</kbd><span><strong>Ask PAPER</strong><span>Briefings, priorities and honest answers from your data.</span></span></li>
    </ul>
    <p class="onboarding-privacy">${icon('info')}Press <kbd>?</kbd> whenever you want the full list of shortcuts.</p>
    <div class="onboarding-actions">
      <button class="btn-primary" data-onboarding-close>Begin ${icon('arrow')}</button>
    </div>
  </div>`
}

const RENDERERS = { welcome: welcomeStep, identity: identityStep, setup: setupStep, firstplan: planStep, paper: paperStep, done: doneStep }

function paint() {
  const host = document.querySelector('[data-onboarding-body]')
  if (!(host instanceof HTMLElement)) return
  host.innerHTML = RENDERERS[STEPS[step]] ? RENDERERS[STEPS[step]]() : ''
  host.querySelector('.onboarding-step')?.classList.add('is-entering')
  // focus the first meaningful control so the keyboard flow starts inside
  const focusTarget = host.querySelector('textarea, input, .btn-primary')
  if (focusTarget instanceof HTMLElement) requestAnimationFrame(() => focusTarget.focus({ preventScroll: true }))
}

/** A tiny preview so the "it understood me" moment is visible, not promised. */
function renderPreview(value) {
  const host = document.querySelector('[data-onboarding-preview]')
  if (!(host instanceof HTMLElement)) return
  const text = String(value || '').trim()
  if (!text) { host.innerHTML = ''; host.dataset.state = 'empty'; return }
  let parsed = null
  // The same parser the quick-capture field uses, so the promise here is the
  // promise there — not a demo that behaves differently from the product.
  try { parsed = parseQuickCapture(text) } catch { parsed = null }
  const chips = []
  const dateLabel = parsed?.date
  if (dateLabel) chips.push(['calendar', friendlyDate(dateLabel)])
  if (parsed?.time) chips.push(['clock', timeLabel(parsed.time, true)])
  if (parsed?.estimateMinutes) chips.push(['focus', formatDuration(parsed.estimateMinutes)])
  if (parsed?.recurrence) chips.push(['bolt', 'repeats'])
  if (parsed?.categoryId) chips.push(['board', parsed.categoryId])
  if (parsed?.title) chips.push(['check', parsed.title])
  host.dataset.state = chips.length ? 'ready' : 'waiting'
  host.innerHTML = chips.length
    ? `<p class="onboarding-preview-label">${icon('sparkle')}Here's what COMMAND heard</p>
       <div class="onboarding-chips">${chips.map(([symbol, label]) => `<span class="onboarding-chip">${icon(symbol)}${escapeHtml(String(label))}</span>`).join('')}</div>`
    : `<p class="onboarding-preview-label is-quiet">${icon('info')}Keep writing — day, time and length are picked up as you type.</p>`
}

/** Persist only what the person actually typed — never invented defaults. */
function saveStepInputs() {
  const name = /** @type {any} */ (document.querySelector('[data-onboarding-name]'))
  const salute = /** @type {any} */ (document.querySelector('[data-onboarding-salutation]'))
  const hoursStart = /** @type {any} */ (document.querySelector('[data-onboarding-hours-start]'))
  const hoursEnd = /** @type {any} */ (document.querySelector('[data-onboarding-hours-end]'))
  const weekStart = /** @type {any} */ (document.querySelector('[data-onboarding-week-start]'))
  if (name || salute || hoursStart) {
    commit((s) => {
      if (name && name.value.trim()) s.settings.userName = name.value.trim().slice(0, 60)
      if (salute && salute.value.trim()) s.settings.salutation = salute.value.trim().slice(0, 40)
      if (hoursStart && hoursEnd && hoursStart.value && hoursEnd.value && hoursStart.value !== hoursEnd.value) {
        s.settings.workingHours = { start: hoursStart.value, end: hoursEnd.value }
      }
      if (weekStart) s.settings.weekStart = weekStart.value === '0' ? 0 : 1
    }, { silent: true })
  }
}

function finish() {
  try { window.CC?.completeOnboarding?.() } catch { /* the flow must never trap anyone */ }
  close()
}

export function closeOnboarding() {
  const layer = document.querySelector('[data-onboarding-overlay]')
  if (!layer) return
  layer.classList.add('is-leaving')
  setTimeout(() => layer.remove(), 200)
  document.documentElement.classList.remove('onboarding-open')
  const restore = lastFocus
  lastFocus = null
  if (restore && typeof restore.focus === 'function') setTimeout(() => restore.focus({ preventScroll: true }), 0)
}

export function isOnboardingOpen() {
  return !!document.querySelector('[data-onboarding-overlay]')
}

export function openOnboarding() {
  if (isOnboardingOpen()) return
  const root = el('modal-root') || document.body
  lastFocus = document.activeElement
  step = 0
  root.insertAdjacentHTML('beforeend', overlayHtml())
  document.documentElement.classList.add('onboarding-open')

  const layer = document.querySelector('[data-onboarding-overlay]')
  if (!layer) return

  layer.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null
    if (!target) return
    if (target === layer) { closeOnboarding(); return }
    if (target.closest('[data-onboarding-skip]')) { saveStepInputs(); finish(); return }
    if (target.closest('[data-onboarding-next]')) {
      saveStepInputs()
      step = Math.min(step + 1, STEPS.length - 1)
      paint()
      bindStep()
      return
    }
    if (target.closest('[data-onboarding-finish]') || target.closest('[data-onboarding-close]')) { saveStepInputs(); finish(); return }
    const example = target.closest('[data-onboarding-example]')
    if (example instanceof HTMLElement) {
      const box = document.querySelector('[data-onboarding-input]')
      if (box instanceof HTMLTextAreaElement) {
        box.value = example.dataset.onboardingExample || ''
        renderPreview(box.value)
        box.focus()
      }
    }
  })

  // Escape leaves without a fuss; Tab is contained inside the panel.
  layer.addEventListener('keydown', (event) => {
    if (!(event instanceof KeyboardEvent)) return
    if (event.key === 'Escape') { event.stopPropagation(); closeOnboarding(); return }
    if (event.key !== 'Tab') return
    const focusables = Array.from(layer.querySelectorAll('button, textarea, input, select, [tabindex]:not([tabindex="-1"])'))
      .filter((node) => node instanceof HTMLElement && !node.closest('.hidden,[hidden]') && !(node instanceof HTMLButtonElement && node.disabled))
    if (!focusables.length) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (!(first instanceof HTMLElement) || !(last instanceof HTMLElement)) return
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  })

  paint()
  bindStep()
}

function bindStep() {
  const input = document.querySelector('[data-onboarding-input]')
  if (input instanceof HTMLTextAreaElement && !input.dataset.bound) {
    input.dataset.bound = '1'
    input.addEventListener('input', () => renderPreview(input.value))
  }
}

/** True when this workspace has nothing in it yet. */
export function needsOnboarding() {
  if (!state) return false
  if (state.onboarding?.seen) return false
  const hasWork = Number(state.tasks?.length || 0) + Number(state.hyb?.plans?.length || 0) + Number(state.focus?.sessions?.length || 0) + Number(state.goals?.length || 0) > 0
  return !hasWork
}
