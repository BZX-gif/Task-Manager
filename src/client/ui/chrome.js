/* -------------------------------------------------------------------------
   CHROME — header, sidebar widgets, live clock, greeting, streak + focus chips
   ------------------------------------------------------------------------- */

import { MOTIVATIONAL_QUOTES } from '../lib/defaults.js'
import { formatClock, formatDuration } from '../lib/dates.js'
import { escapeHtml, el } from '../core/dom.js'
import { currentDayKey, state, streak } from '../core/store.js'
import { elapsedSeconds, remainingSeconds, sessionTotals } from '../lib/focus.js'
import { STATUS_STYLES, dayStatus } from './status.js'

let clockTimer = null
let quoteTimer = null

export function userName() {
  return state.settings.userName || 'Kulshresth'
}

export function greeting(now = new Date()) {
  const hour = now.getHours()
  let phrase
  if (hour < 5) phrase = 'Burning the midnight oil'
  else if (hour < 12) phrase = 'Good morning'
  else if (hour < 17) phrase = 'Good afternoon'
  else if (hour < 21) phrase = 'Good evening'
  else phrase = 'Good night'
  return `${phrase}, ${userName()} 👋`
}

export function updateClockAndGreeting() {
  const greetingEl = el('greeting-text')
  if (greetingEl) greetingEl.textContent = greeting()
  const clockEl = el('live-clock')
  if (clockEl) {
    const now = new Date()
    clockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }
}

export function rotateQuote(force = false) {
  const quoteEl = el('quote-text')
  if (!quoteEl) return
  const index = Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)
  if (!force && quoteEl.dataset.index === String(index)) return rotateQuote(force)
  quoteEl.dataset.index = String(index)
  quoteEl.style.transition = 'opacity .25s ease'
  quoteEl.style.opacity = '0'
  setTimeout(() => {
    quoteEl.textContent = `“${MOTIVATIONAL_QUOTES[index]}”`
    quoteEl.style.opacity = '1'
  }, 200)
}

export function startChromeTimers() {
  updateClockAndGreeting()
  if (clockTimer) clearInterval(clockTimer)
  clockTimer = setInterval(updateClockAndGreeting, 1000)
  rotateQuote(true)
  if (quoteTimer) clearInterval(quoteTimer)
  quoteTimer = setInterval(() => rotateQuote(), 20000)
}

/** Sidebar streak card + 7-day consistency dots. */
export function refreshStreakWidget() {
  const countEl = el('streak-count')
  if (!countEl) return
  const today = currentDayKey()
  const result = /** @type {any} */ (streak())
  /** streak days arrive from the pure engine — attach the status the UI colours by */
  const recent = result.recent.map((day) => ({ ...day, status: dayStatus(state, day.dateKey).status }))
  countEl.textContent = String(result.current)
  const subEl = el('streak-sub')
  if (subEl) {
    const todayStatus = dayStatus(state, today)
    subEl.textContent = result.current === 1 ? 'day in a row' : `days in a row · best ${result.best}`
    subEl.title = todayStatus.reasons.length ? `Today counts: ${todayStatus.reasons.join(' + ')}` : `Today counts when: ${todayStatus.ruleText.join(', ')}`
  }
  const dots = el('streak-dots')
  if (dots) {
    dots.innerHTML = recent
      .map((day) => {
        const style = STATUS_STYLES[day.status]
        return `<span class="streak-dot ${day.isToday ? 'is-today' : ''}" style="background:${style.dot}" title="${day.dateKey} · ${style.label}${day.score ? ` · score ${day.score}` : ''}"></span>`
      })
      .join('')
  }
}

/** Header chip showing the running focus session. */
export function refreshFocusChip() {
  const chip = el('active-timer-chip')
  const text = el('active-timer-chip-text')
  const sessions = state.focus?.sessions || []
  const totals = sessionTotals(sessions, currentDayKey())
  const mini = el('focus-mini-time')
  if (mini) mini.textContent = formatDuration(totals.focusedMinutes)

  const session = state.focus?.active
  if (!chip || !text) return
  if (!session) {
    chip.classList.add('hidden')
    chip.classList.remove('flex')
    return
  }
  const nowMs = Date.now()
  text.textContent = session.running ? formatClock(remainingSeconds(session, nowMs)) : 'Paused'
  chip.classList.remove('hidden')
  chip.classList.add('flex')
  chip.title = session.mode === 'break'
    ? `Break · ${Math.round(elapsedSeconds(session, nowMs) / 60)} min in`
    : `Focus session · ${session.plannedMinutes} min planned · click to open`
}

export function renderQuoteInline() {
  const target = el('dash-quote')
  if (target) target.textContent = `“${MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)]}”`
}

export function setMobileNav(open) {
  const nav = el('mobile-nav')
  const button = el('mobile-menu-btn')
  if (!nav) return
  nav.classList.toggle('hidden', !open)
  if (button) button.setAttribute('aria-expanded', String(open))
}

export function toggleMobileNav() {
  const nav = el('mobile-nav')
  if (!nav) return
  setMobileNav(nav.classList.contains('hidden'))
}

export function footerVersion(version) {
  const footer = document.querySelector('footer')
  if (footer && version) footer.innerHTML = `Built for ${escapeHtml(userName())} · Data stored 100% locally in your browser · v${escapeHtml(version)}`
}
