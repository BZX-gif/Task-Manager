/* -------------------------------------------------------------------------
   BOOTSTRAP — wires the app together and exposes the small CC API that the
   inline handlers in the views use (safe: only ids and known names travel).
   ------------------------------------------------------------------------- */

import { closeModal, isModalOpen, toast } from './core/dom.js'
import { on } from './core/bus.js'
import {
  announceStatus,
  commit,
  currentDayKey,
  ensureRecurringOccurrences,
  initStore,
  perfectDayRun,
  state,
  streak,
  syncAchievementsNow,
  syncScoreHistory,
  titleStates,
} from './core/store.js'
import { addToTop3 } from './lib/top3.js'
import { initRouter, refreshCurrentView, switchView } from './ui/router.js'
import { footerVersion, refreshFocusChip, refreshStreakWidget, renderQuoteInline, startChromeTimers, toggleMobileNav } from './ui/chrome.js'
import { dayStatus } from './ui/status.js'
import { completeFocus, hasRunningSession, initFocus, openFocusMode, pauseFocus, resumeFocus, stopFocus } from './ui/focus.js'
import { handleChatKey, sendMessage } from './views/assistant.js'
import { openQuickCapture, isQuickCaptureOpen, closeQuickCapture } from './ui/quickcapture.js'
import { checkReminders, startReminderRunner } from './ui/reminders-runner.js'
import { initPwa } from './ui/pwa.js'
import { checkTitleUnlock } from './ui/titles.js'
import { openTaskModal } from './views/tasks.js'
import { openWeeklyReview } from './views/review.js'
import { openRecoveryModal } from './views/recovery.js'

const APP_VERSION = '2.1'

/** the local day the app booted with — used to detect a live day rollover */
let bootDayKey = null

function refreshAll() {
  refreshStreakWidget()
  refreshFocusChip()
  refreshCurrentView()
}

/** Close out finished days + surface a brand-new title (day rollover safe). */
function refreshDayState() {
  const today = currentDayKey()
  const result = syncAchievementsNow()
  checkTitleUnlock()
  // the local day changed while the app stayed open: re-render the views so
  // "today" is really today (chores only, never on every tick)
  if (bootDayKey !== today) {
    bootDayKey = today
    refreshAll()
  }
  return result
}

function streakInfo() {
  const result = streak()
  const recent = result.recent.map((day) => ({ ...day, status: dayStatus(state, day.dateKey).status }))
  return { ...result, recent }
}

/* ------------------------------------------------------------------ API */

window.CC = {
  version: APP_VERSION,
  // views & modals
  switchView,
  refreshAll,
  refreshCurrentView,
  openTaskModal,
  openQuickCapture,
  closeQuickCapture,
  openWeeklyReview,
  openRecoveryModal,
  closeModal,
  // focus
  openFocusMode,
  pauseFocus,
  resumeFocus,
  stopFocus,
  completeFocus,
  hasRunningSession,
  // data helpers
  addTaskToTop3(taskId) {
    /** @type {any} */
    let result = { ok: false, reason: 'Task not found.' }
    commit((s) => {
      result = addToTop3(s, currentDayKey(), taskId)
    })
    refreshAll()
    return result
  },
  streakInfo,
  /** my private titles (DISCIPLINE MONSTER → …), computed from local data only */
  titlesInfo: () => titleStates(),
  perfectRun: () => perfectDayRun(),
  todayKey: currentDayKey,
  /**
   * Read-only access to the current state — used by the automated smoke test
   * and handy when debugging in DevTools. Mutate through the UI (or CC methods)
   * so every change goes through the store's save/notify pipeline.
   */
  getState: () => state,
  // assistant
  askAI: (text) => {
    switchView('assistant')
    const input = /** @type {any} */ (document.getElementById('chat-input'))
    if (input) input.value = text
    setTimeout(() => sendMessage(), 60)
  },
  handleChatKey,
  // misc
  toggleMobileNav,
  checkReminders: () => checkReminders(),
  refreshQuoteInline: renderQuoteInline,
}

/* -------------------------------------------------------------- keyboard */

function bindKeyboard() {
  document.addEventListener('keydown', (event) => {
    const target = event.target
    const typing = target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)

    // Ctrl/⌘ + K — quick capture anywhere
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      if (isQuickCaptureOpen()) closeQuickCapture()
      else openQuickCapture()
      return
    }

    // Esc closes the topmost modal (focus overlay handles its own Esc)
    if (event.key === 'Escape' && isModalOpen()) {
      closeModal()
      return
    }

    // Focus mode shortcut: F when not typing
    if (!typing && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      openFocusMode(undefined)
      return
    }

    // 1–7 switch views when not typing (7 = Profile)
    if (!typing && !event.ctrlKey && !event.metaKey && /^[1-7]$/.test(event.key)) {
      const views = ['dashboard', 'timetable', 'tasks', 'progress', 'assistant', 'settings', 'profile']
      switchView(views[Number(event.key) - 1])
    }
  })
}

/* ------------------------------------------------------------------ boot */

function boot() {
  initStore()
  bootDayKey = currentDayKey()
  startChromeTimers()
  initRouter()
  initFocus()
  initPwa()
  bindKeyboard()

  document.getElementById('quick-add-btn')?.addEventListener('click', () => openQuickCapture())
  document.getElementById('mobile-menu-btn')?.addEventListener('click', () => toggleMobileNav())
  document.getElementById('streak-mini')?.addEventListener('click', () => switchView('progress'))
  document.getElementById('focus-mini-start')?.addEventListener('click', () => openFocusMode())
  document.getElementById('active-timer-chip')?.addEventListener('click', () => openFocusMode())

  on('focus:tick', () => refreshFocusChip())
  on('store:change', () => {
    refreshStreakWidget()
    refreshFocusChip()
    // fires only on the locked → unlocked transition (a reload never replays it)
    checkTitleUnlock()
  })

  // write before the tab goes away so nothing is lost
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshDayState()
      return
    }
    syncScoreHistory(currentDayKey())
    commit(() => {}, { immediate: true, silent: true })
  })
  window.addEventListener('pagehide', () => {
    syncScoreHistory(currentDayKey())
    commit(() => {}, { immediate: true, silent: true })
  })

  refreshAll()
  switchView('dashboard')
  startReminderRunner()
  checkTitleUnlock()
  announceStatus()
  footerVersion(APP_VERSION)

  // housekeeping: refresh the "right now" pieces every minute + top up the
  // recurring-task horizon hourly (covers an app left open across midnight)
  setInterval(() => {
    if (document.visibilityState !== 'visible') return
    refreshDayState()
    refreshCurrentView()
  }, 60_000)
  setInterval(ensureRecurringOccurrences, 60 * 60 * 1000)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot)
} else {
  boot()
}

export { refreshAll, streakInfo }
