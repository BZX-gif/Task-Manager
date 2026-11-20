/* -------------------------------------------------------------------------
   ONBOARDING — the first five minutes.

   The product had an `onboarding.seen` flag that nothing ever read, so a new
   workspace opened on four empty cards. Empty states are honest but they do
   not explain a system; a new person needs to know what this is, in what
   order to use it, and what it will do for them.

   The flow is deliberately short: a welcome that names the promise, then one
   question that proves the whole thing works (type a real plan, watch it be
   understood), then three concrete next steps. Nothing here writes data the
   person did not type — and everything can be skipped in one tap.
   ------------------------------------------------------------------------- */
import { state } from '../core/store.js'
import { parseQuickCapture } from '../lib/quickparse.js'
import { formatDuration } from '../lib/dates.js'
import { timeLabel } from './common.js'

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
import { el, escapeHtml } from '../core/dom.js'
import { icon } from './icons.js'

const STEPS = ['welcome', 'firstplan', 'done']
let step = 0
let lastFocus = null

/** The product's honest one-liner — no feature list, no adjectives. */
const PROMISE = {
  title: 'A quieter place to run your day.',
  body: 'Think of it as one desk instead of six apps: your missions, the hours they need, the goals they serve, and the focus to actually finish them.',
  points: [
    ['missions', 'Capture the work', 'One inbox for everything you owe yourself or someone else.'],
    ['calendar', 'Give it hours', 'Drag a mission into the day and it becomes a block you can keep.'],
    ['focus', 'Finish it', 'A focus room that protects one thing at a time, and records it.'],
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
    <p class="eyebrow">Welcome to Command</p>
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
      <button class="btn-primary" data-onboarding-next>Show me ${icon('arrow')}</button>
      <button class="text-button" data-onboarding-skip>I'll explore on my own</button>
    </div>
  </div>`
}

function planStep() {
  return `<div class="onboarding-step is-active">
    <p class="eyebrow">Step two of three</p>
    <h2 id="onboarding-title">Type a plan the way you'd say it.</h2>
    <p class="onboarding-lede">No forms. Write it naturally and Command picks out the day, the time, the length and the kind of work.</p>
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
      <button class="btn-primary" data-onboarding-finish>Start using Command ${icon('arrow')}</button>
      <button class="text-button" data-onboarding-skip>Maybe later</button>
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
      <li><kbd>F</kbd><span><strong>Protect your attention</strong><span>The Focus Room hides everything but one thing.</span></span></li>
    </ul>
    <p class="onboarding-privacy">${icon('info')}Press <kbd>?</kbd> whenever you want the full list of shortcuts.</p>
    <div class="onboarding-actions">
      <button class="btn-primary" data-onboarding-close>Begin ${icon('arrow')}</button>
    </div>
  </div>`
}

const RENDERERS = { welcome: welcomeStep, firstplan: planStep, done: doneStep }

function paint() {
  const host = document.querySelector('[data-onboarding-body]')
  if (!(host instanceof HTMLElement)) return
  host.innerHTML = RENDERERS[STEPS[step]] ? RENDERERS[STEPS[step]]() : ''
  host.querySelector('.onboarding-step')?.classList.add('is-entering')
  // focus the first meaningful control so the keyboard flow starts inside
  const focusTarget = host.querySelector('textarea, .btn-primary')
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
    ? `<p class="onboarding-preview-label">${icon('sparkle')}Here's what Command heard</p>
       <div class="onboarding-chips">${chips.map(([symbol, label]) => `<span class="onboarding-chip">${icon(symbol)}${escapeHtml(String(label))}</span>`).join('')}</div>`
    : `<p class="onboarding-preview-label is-quiet">${icon('info')}Keep writing — day, time and length are picked up as you type.</p>`
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
    if (target.closest('[data-onboarding-skip]')) { finish(); return }
    if (target.closest('[data-onboarding-next]')) { step = 1; paint(); bindStep(); return }
    if (target.closest('[data-onboarding-finish]')) { step = 2; paint(); bindStep(); return }
    if (target.closest('[data-onboarding-close]')) { finish(); return }
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
    const focusables = Array.from(layer.querySelectorAll('button, textarea, input, [tabindex]:not([tabindex="-1"])'))
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
  const hasWork = Number(state.tasks?.length || 0) + Number(state.hybPlans?.length || 0) + Number(state.sessions?.length || 0) > 0
  return !hasWork
}
