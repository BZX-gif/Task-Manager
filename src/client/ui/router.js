/* -------------------------------------------------------------------------
   ROUTER — view switching + resilient re-rendering
   ------------------------------------------------------------------------- */

import { el, qsa } from '../core/dom.js'
import { emit, on } from '../core/bus.js'
import { renderDashboard } from '../views/dashboard.js'
import { renderTimetable } from '../views/timetable.js'
import { renderTasks } from '../views/tasks.js'
import { renderProgress } from '../views/progress.js'
import { renderProfile } from '../views/profile.js'
import { renderAssistant } from '../views/assistant.js'
import { renderSettings } from '../views/settings.js'

export const VIEWS = ['dashboard', 'timetable', 'tasks', 'progress', 'profile', 'assistant', 'settings']

const RENDERERS = {
  dashboard: renderDashboard,
  timetable: renderTimetable,
  tasks: renderTasks,
  progress: renderProgress,
  profile: renderProfile,
  assistant: renderAssistant,
  settings: renderSettings,
}

let currentView = 'dashboard'
let refreshTimer = null

export function getCurrentView() {
  return currentView
}

export function switchView(view) {
  if (!VIEWS.includes(view)) return
  currentView = view
  for (const name of VIEWS) {
    const section = el(`view-${name}`)
    if (section) section.classList.toggle('hidden', name !== view)
  }
  qsa(document, '.nav-item').forEach((btn) => {
    const active = btn.dataset.view === view
    btn.classList.toggle('active-nav', active)
    btn.setAttribute('aria-current', active ? 'page' : 'false')
  })
  qsa(document, '.nav-pill').forEach((btn) => btn.classList.toggle('active-pill', btn.dataset.view === view))
  const nav = el('mobile-nav')
  if (nav) nav.classList.add('hidden')
  renderCurrentView()
  try {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  } catch {
    /* jsdom / older browsers */
  }
  emit('view:changed', { view })
}

export function renderCurrentView() {
  const renderer = RENDERERS[currentView]
  if (!renderer) return
  try {
    renderer()
  } catch (error) {
    console.error(`[router] ${currentView} failed to render`, error)
    const section = el(`view-${currentView}`)
    if (section) {
      section.innerHTML = `
        <div class="glass-card p-6 text-center">
          <i class="fa-solid fa-triangle-exclamation text-accent-4 text-2xl mb-3"></i>
          <p class="text-slate-300 font-semibold mb-1">This view could not be rendered</p>
          <p class="text-[13px] text-slate-500">Your data is safe. Reload the page — if it keeps happening, export a backup from Settings.</p>
        </div>`
    }
  }
}

/** Coalesced refresh — safe to call from timers and event handlers. */
export function refreshCurrentView(delay = 0) {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    renderCurrentView()
  }, delay)
}

export function initRouter() {
  qsa(document, '[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view
      if (view === 'focus') {
        // Focus Mode is an overlay, not a tab
        window.CC?.openFocusMode(undefined)
        const nav = el('mobile-nav')
        if (nav) nav.classList.add('hidden')
        return
      }
      switchView(view)
    })
  })
  on('store:change', () => refreshCurrentView())
}
