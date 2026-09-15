/* -------------------------------------------------------------------------
   FOCUS MODE — fullscreen timer overlay
   -------------------------------------------------------------------------
   • 25 / 50 / 90 minute presets + custom, plus optional short breaks
   • pause / resume / stop / complete, live countdown + progress ring
   • the running session is persisted, so a refresh never destroys it
   • a beforeunload guard protects an in-progress session from accidental loss
   • completing a session updates focus analytics, the daily score and offers
     to tick off the linked task (it never silently marks work as done)
   ------------------------------------------------------------------------- */

import { BREAK_PRESETS, FOCUS_PRESETS } from '../lib/defaults.js'
import { formatClock, formatDuration } from '../lib/dates.js'
import {
  createSession,
  elapsedSeconds,
  finalizeSession,
  minutesByTask,
  pauseSession,
  plannedSeconds,
  progressRatio,
  reconcileStaleSession,
  remainingSeconds,
  resumeSession,
  sessionTotals,
  tickSession,
} from '../lib/focus.js'
import { closeModal, escapeHtml, el, openModal, toast } from '../core/dom.js'
import { commit, currentDayKey, rollSeriesForward, state, syncScoreHistory } from '../core/store.js'
import { uid } from '../lib/state.js'
import { emit } from '../core/bus.js'

let ticker = null
let ignoringUnload = false

/* ------------------------------------------------------------------ state */

export function activeSession() {
  return state.focus?.active || null
}

export function hasRunningSession() {
  const session = activeSession()
  return !!session && session.running
}

/**
 * @param {{ onTick?: () => void }} [options]
 */
export function initFocus({ onTick } = {}) {
  const now = Date.now()
  const { session, stale } = reconcileStaleSession(state.focus?.active, now)
  if (stale) {
    commit((s) => {
      s.focus.active = session
    }, { immediate: true, silent: true })
    toast('A focus session was left running for hours — it has been closed and credited for the time you actually focused.', 'info', { timeout: 7000 })
  }

  startTicker(onTick)
  window.addEventListener('beforeunload', guardUnload)
  emit('focus:tick')
  if (hasRunningSession()) renderFocusOverlay()
}

function startTicker(onTick) {
  if (ticker) clearInterval(ticker)
  ticker = setInterval(() => {
    const session = activeSession()
    if (!session) {
      emit('focus:tick')
      return
    }
    if (session.running) {
      const nowMs = Date.now()
      const before = elapsedSeconds(session, nowMs)
      commit((s) => {
        s.focus.active = tickSession(s.focus.active, nowMs)
      }, { silent: true })
      const after = elapsedSeconds(state.focus.active, nowMs)
      if (plannedSeconds(session) > 0 && Math.floor(before) < Math.floor(plannedSeconds(session)) && Math.floor(after) >= Math.floor(plannedSeconds(session))) {
        onFocusTimeReached()
      }
    }
    paintTimer()
    emit('focus:tick')
    if (typeof onTick === 'function') onTick()
    saveTick()
  }, 1000)
}

let lastSave = 0
function saveTick() {
  const nowMs = Date.now()
  if (nowMs - lastSave < 10000) return
  lastSave = nowMs
  // persist the accumulated seconds regularly (never on every single tick)
  commit(() => {}, { immediate: true, silent: true })
}

function guardUnload(event) {
  if (ignoringUnload || !hasRunningSession()) return undefined
  event.preventDefault()
  event.returnValue = 'A focus session is running. Leave and it will pause.'
  return event.returnValue
}

function onFocusTimeReached() {
  const session = activeSession()
  if (!session) return
  if (session.mode === 'break') {
    toast('Break finished — back to it! 💪', 'timer', { timeout: 8000 })
    return
  }
  playChime()
  notifyDesktop('Focus session complete', `${session.plannedMinutes} minutes of deep work done.`)
  toast('Focus time reached — complete the session to log it.', 'timer', { timeout: 9000, action: { label: 'Complete', onClick: () => completeFocus() } })
  renderFocusOverlay()
}

function playChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 660
    gain.gain.value = 0.05
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    setTimeout(() => {
      osc.stop()
      ctx.close()
    }, 420)
  } catch {
    /* audio is a bonus, never a requirement */
  }
}

export function notifyDesktop(title, body) {
  try {
    if (state.settings?.reminders?.desktopNotifications && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/icons/icon-192.png', tag: 'command-center-focus' })
    }
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------- session ops */

/**
 * @param {string|null} [taskId]
 * @param {number|null} [minutes]
 * @param {'focus'|'break'|string} [mode]
 */
export function startFocus(taskId = null, minutes = null, mode = 'focus') {
  const planned = Math.max(1, Math.round(minutes || state.settings.focus.defaultMinutes || 25))
  const session = createSession({ id: uid(), taskId, plannedMinutes: planned, mode: mode === 'break' ? 'break' : 'focus', now: Date.now() })
  commit((s) => {
    s.focus.active = session
  }, { immediate: true })
  renderFocusOverlay()
  const label = mode === 'break' ? 'Break' : 'Focus'
  toast(`${label} started · ${planned} min`, 'success')
  if (mode === 'focus') requestNotificationPermissionQuietly()
}

function requestNotificationPermissionQuietly() {
  try {
    if (state.settings?.reminders?.desktopNotifications && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  } catch {
    /* ignore */
  }
}

export function pauseFocus() {
  if (!activeSession()) return
  commit((s) => {
    s.focus.active = pauseSession(s.focus.active, Date.now())
  }, { immediate: true })
  renderFocusOverlay()
}

export function resumeFocus() {
  if (!activeSession()) return
  commit((s) => {
    s.focus.active = resumeSession(s.focus.active, Date.now())
  }, { immediate: true })
  renderFocusOverlay()
}

export function addFocusMinutes(minutes) {
  const session = activeSession()
  if (!session) return
  const delta = session.plannedMinutes + minutes
  if (delta < 1 || delta > 600) return
  commit((s) => {
    s.focus.active.plannedMinutes = delta
  }, { immediate: true })
  renderFocusOverlay()
}

/** Stop and keep whatever time was focused. */
export function stopFocus({ quiet = false } = {}) {
  const session = activeSession()
  if (!session) return
  const record = finalizeSession(session, Date.now(), 'stopped')
  commit((s) => {
    if (record.focusedSeconds >= 60) s.focus.sessions.push({ ...record, categoryId: categoryForTask(record.taskId) })
    s.focus.active = null
  }, { immediate: true })
  syncScoreHistory(currentDayKey())
  if (!quiet) {
    toast(`Session stopped · ${formatDuration(Math.round(record.focusedSeconds / 60))} focused`, 'info')
  }
  closeFocusOverlay()
}

/** Finish the session deliberately (credits all focused time, prompts for the task). */
export function completeFocus() {
  const session = activeSession()
  if (!session) return
  const record = finalizeSession(session, Date.now(), 'completed')
  const minutes = Math.round(record.focusedSeconds / 60)
  commit((s) => {
    if (record.focusedSeconds >= 30) s.focus.sessions.push({ ...record, categoryId: categoryForTask(record.taskId) })
    s.focus.active = null
  }, { immediate: true })
  syncScoreHistory(currentDayKey())
  closeFocusOverlay()
  playChime()
  const task = record.taskId ? state.tasks.find((t) => t.id === record.taskId) : null
  if (task && !task.done) {
    toast(`Session complete · ${formatDuration(minutes)} on “${task.title}”`, 'success', {
      timeout: 12000,
      action: {
        label: 'Mark task done',
        onClick: () => {
          commit((s) => {
            const target = s.tasks.find((t) => t.id === task.id)
            if (target) {
              target.done = true
              target.completedAt = Date.now()
              rollSeriesForward(target)
            }
          })
          toast('Task completed 🎉', 'success')
        },
      },
    })
  } else {
    toast(`Session complete · ${formatDuration(minutes)} focused`, 'success')
  }
}

function categoryForTask(taskId) {
  if (!taskId) return null
  return state.tasks.find((t) => t.id === taskId)?.cat || null
}

/* ---------------------------------------------------------------- overlay */

export function closeFocusOverlay() {
  const root = el('focus-root')
  if (root) root.innerHTML = ''
}

/**
 * @param {string|null} [taskId] task to link (starts immediately when given)
 */
export function openFocusMode(taskId = null) {
  if (activeSession()) {
    // a session is already running: bring it back on screen
    renderFocusOverlay()
    return
  }
  if (taskId) {
    // opened from a task → start straight away with the default preset
    startFocus(taskId, state.settings.focus.defaultMinutes)
    return
  }
  // opened from the nav/sidebar → let the user pick target + length first
  renderFocusOverlay({ forcePicker: true })
}

export function renderFocusOverlay({ forcePicker = false } = {}) {
  const root = el('focus-root')
  if (!root) return
  const session = activeSession()
  if (!session) {
    root.innerHTML = forcePicker ? setupHtml() : ''
    if (forcePicker) bindSetup(root)
    return
  }
  root.innerHTML = sessionHtml(session)
  bindSession(root, session)
  paintTimer()
}

function setupHtml() {
  const tasks = state.tasks.filter((t) => !t.done && (!t.date || t.date === currentDayKey())).slice(0, 40)
  const defaultMinutes = state.settings.focus.defaultMinutes || 25
  return overlayShell(`
    <p class="text-[11px] uppercase tracking-[0.2em] text-slate-500 font-bold mb-2">Focus Mode</p>
    <h2 class="font-display text-2xl sm:text-3xl font-extrabold text-white mb-1">Pick a target and start</h2>
    <p class="text-[13px] text-slate-400 mb-6">One task. One timer. No tab switching.</p>
    <div class="flex flex-wrap gap-2 justify-center mb-5" id="focus-presets">
      ${FOCUS_PRESETS.map((m) => `<button class="preset-btn ${m === defaultMinutes ? 'preset-active' : ''}" data-minutes="${m}">${m} min</button>`).join('')}
      <button class="preset-btn" data-custom>Custom…</button>
    </div>
    <label class="field-label text-left" for="focus-task">Task (optional)</label>
    <select class="input-field mb-5" id="focus-task">
      <option value="">No specific task</option>
      ${tasks.map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.title)}</option>`).join('')}
    </select>
    <div class="flex flex-col sm:flex-row gap-3 justify-center">
      <button class="btn-primary" id="focus-start"><i class="fa-solid fa-play mr-2"></i>Start focus session</button>
      <button class="btn-ghost" data-focus-close>Cancel</button>
    </div>
    <p class="text-[11.5px] text-slate-500 mt-5">Tip: press <kbd class="kbd">Esc</kbd> to minimise — the timer keeps running.</p>
  `)
}

function sessionHtml(session) {
  const isBreak = session.mode === 'break'
  const tasks = state.tasks.filter((t) => !t.done && (!t.date || t.date === currentDayKey())).slice(0, 40)
  const linked = session.taskId ? state.tasks.find((t) => t.id === session.taskId) : null
  const totals = sessionTotals(state.focus.sessions, currentDayKey())
  return overlayShell(`
    <p class="text-[11px] uppercase tracking-[0.2em] font-bold mb-1 ${isBreak ? 'text-accent-3' : 'text-accent-2'}">${isBreak ? 'Break time' : 'Focus Mode'}</p>
    <h2 class="font-display text-lg sm:text-xl font-bold text-white mb-6 truncate max-w-[80vw]">${escapeHtml(linked ? linked.title : isBreak ? 'Step away from the desk' : 'Deep work')}</h2>
    <div class="focus-ring-wrap">
      <svg class="focus-ring" viewBox="0 0 200 200" aria-hidden="true">
        <circle class="focus-ring-track" cx="100" cy="100" r="92" />
        <circle class="focus-ring-progress ${isBreak ? 'is-break' : ''}" cx="100" cy="100" r="92" id="focus-ring-progress" />
      </svg>
      <div class="focus-readout">
        <p id="focus-time" class="font-display font-extrabold text-white text-4xl sm:text-5xl tabular-nums" aria-live="off">--:--</p>
        <p id="focus-state" class="text-[12px] uppercase tracking-wider text-slate-400 mt-1">${session.running ? 'Running' : 'Paused'}</p>
        <p class="text-[12px] text-slate-500 mt-1">of ${session.plannedMinutes} min${linked ? ` · ${minutesByTask(state.focus.sessions, linked.id)} min logged before` : ''}</p>
      </div>
    </div>
    <div class="flex flex-wrap gap-2.5 justify-center mt-7">
      ${session.running
        ? '<button class="btn-ghost" data-focus-pause><i class="fa-solid fa-pause mr-2"></i>Pause</button>'
        : '<button class="btn-primary" data-focus-resume><i class="fa-solid fa-play mr-2"></i>Resume</button>'}
      <button class="btn-primary" data-focus-complete><i class="fa-solid fa-flag-checkered mr-2"></i>Complete</button>
      <button class="btn-ghost" data-focus-stop><i class="fa-solid fa-stop mr-2"></i>Stop</button>
      <button class="btn-ghost" data-focus-close><i class="fa-solid fa-compress mr-2"></i>Minimise</button>
    </div>
    <div class="flex flex-wrap gap-2 justify-center mt-4 text-[12px] text-slate-500">
      <button class="nav-pill" data-focus-plus="5">+5 min</button>
      <button class="nav-pill ${isBreak ? 'preset-active' : ''}" data-focus-break="${BREAK_PRESETS[0]}">5 min break</button>
      ${!isBreak ? `<button class="nav-pill" data-focus-switch-task>${linked ? 'Change task' : 'Link a task'}</button>` : ''}
    </div>
    ${!isBreak ? `
      <div class="${linked ? 'hidden ' : ''}mt-4 w-full" data-focus-task-picker>
        <label class="field-label text-left" for="focus-task-switch">Link this session to a task</label>
        <select class="input-field" id="focus-task-switch">
          <option value="">No specific task</option>
          ${tasks.map((t) => `<option value="${escapeHtml(t.id)}" ${t.id === session.taskId ? 'selected' : ''}>${escapeHtml(t.title)}</option>`).join('')}
        </select>
      </div>` : ''}
    <p class="text-[11.5px] text-slate-500 mt-5" id="focus-today-summary">
      Today: ${formatDuration(totals.focusedMinutes)} focused · ${totals.completedSessions}/${totals.sessions} sessions completed
    </p>
  `)
}

function overlayShell(inner) {
  return `
    <div class="focus-overlay" role="dialog" aria-modal="true" aria-label="Focus mode">
      <button class="focus-exit" data-focus-close aria-label="Minimise focus mode"><i class="fa-solid fa-compress"></i></button>
      <div class="focus-panel">${inner}</div>
    </div>`
}

function bindSetup(root) {
  let minutes = state.settings.focus.defaultMinutes || 25
  root.querySelectorAll('#focus-presets [data-minutes]').forEach((btn) => {
    btn.addEventListener('click', () => {
      minutes = Number(btn.dataset.minutes)
      root.querySelectorAll('#focus-presets .preset-btn').forEach((b) => b.classList.remove('preset-active'))
      btn.classList.add('preset-active')
    })
  })
  root.querySelector('[data-custom]')?.addEventListener('click', () => {
    // inline input instead of window.prompt: keyboard accessible + styled
    const custom = root.querySelector('[data-custom]')
    const existing = root.querySelector('#focus-custom-minutes')
    if (existing) {
      existing.focus()
      existing.select()
      return
    }
    const input = document.createElement('input')
    input.type = 'number'
    input.id = 'focus-custom-minutes'
    input.min = '1'
    input.max = '600'
    input.value = String(minutes)
    input.className = 'input-field !w-24 !py-1.5 text-center'
    input.setAttribute('aria-label', 'Custom minutes')
    custom.after(input)
    input.focus()
    input.select()
    const commit2 = () => {
      const value = Number(input.value)
      if (Number.isFinite(value) && value >= 1 && value <= 600) {
        minutes = Math.round(value)
        root.querySelectorAll('#focus-presets .preset-btn').forEach((b) => b.classList.remove('preset-active'))
        custom.textContent = `${minutes} min`
        custom.classList.add('preset-active')
        input.remove()
        custom.focus()
      } else {
        toast('Pick a length between 1 and 600 minutes.', 'error')
        input.select()
      }
    }
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        commit2()
      }
      if (event.key === 'Escape') {
        event.stopPropagation()
        input.remove()
        custom.focus()
      }
    })
    input.addEventListener('blur', () => {
      if (root.contains(input)) commit2()
    })
  })
  root.querySelector('#focus-start')?.addEventListener('click', () => {
    const taskId = root.querySelector('#focus-task')?.value || null
    startFocus(taskId, minutes)
  })
  root.querySelectorAll('[data-focus-close]').forEach((btn) => btn.addEventListener('click', closeFocusOverlay))
}

function bindSession(root, session) {
  root.querySelectorAll('[data-focus-close]').forEach((btn) => btn.addEventListener('click', closeFocusOverlay))
  root.querySelector('[data-focus-pause]')?.addEventListener('click', pauseFocus)
  root.querySelector('[data-focus-resume]')?.addEventListener('click', resumeFocus)
  root.querySelector('[data-focus-complete]')?.addEventListener('click', completeFocus)
  root.querySelector('[data-focus-stop]')?.addEventListener('click', () => stopFocus())
  root.querySelector('[data-focus-plus]')?.addEventListener('click', () => addFocusMinutes(5))
  root.querySelector('[data-focus-break]')?.addEventListener('click', (event) => {
    const minutes = Number(event.currentTarget.dataset.focusBreak) || 5
    commit((s) => {
      s.focus.active = finalizeSession(s.focus.active, Date.now(), 'completed')
      if (s.focus.active.focusedSeconds >= 60 && session.mode !== 'break') s.focus.sessions.push({ ...s.focus.active, categoryId: categoryForTask(s.focus.active.taskId) })
      s.focus.active = createSession({ id: uid(), taskId: null, plannedMinutes: minutes, mode: 'break', now: Date.now() })
    }, { immediate: true })
    syncScoreHistory(currentDayKey())
    renderFocusOverlay()
    toast(`Break started · ${minutes} min`, 'info')
  })
  root.querySelector('[data-focus-switch-task]')?.addEventListener('click', () => {
    const picker = root.querySelector('[data-focus-task-picker]')
    if (picker) picker.classList.toggle('hidden')
  })
  root.querySelector('#focus-task-switch')?.addEventListener('change', (event) => {
    const taskId = event.target.value || null
    commit((s) => {
      if (s.focus.active) s.focus.active.taskId = taskId
    }, { immediate: true })
    renderFocusOverlay()
  })
  root.querySelector('.focus-overlay')?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeFocusOverlay()
    if (event.key === ' ' && event.target === root.querySelector('.focus-overlay')) {
      event.preventDefault()
      session.running ? pauseFocus() : resumeFocus()
    }
  })
}

/** Live numbers only — called every second. */
export function paintTimer() {
  const session = activeSession()
  const timeEl = el('focus-time')
  if (!session || !timeEl) return
  const nowMs = Date.now()
  const remaining = remainingSeconds(session, nowMs)
  timeEl.textContent = formatClock(remaining)
  const ring = el('focus-ring-progress')
  if (ring) {
    const ratio = progressRatio(session, nowMs)
    const circumference = 2 * Math.PI * 92
    ring.style.strokeDasharray = String(circumference)
    ring.style.strokeDashoffset = String(circumference * (1 - ratio))
  }
  const stateEl = el('focus-state')
  if (stateEl) stateEl.textContent = session.running ? (remaining === 0 ? 'Goal reached' : 'Running') : 'Paused'
}

/** Small modal used from the "Focus" task action to choose a duration. */
export function openFocusPickerForTask(taskId) {
  const task = state.tasks.find((t) => t.id === taskId)
  if (!task) {
    openFocusMode(undefined)
    return
  }
  const estimate = task.estimateMinutes || state.settings.focus.defaultMinutes || 25
  const presets = [...new Set([...FOCUS_PRESETS, estimate])].filter((m) => m > 0).sort((a, b) => a - b)
  openModal({
    title: `Focus on “${escapeHtml(task.title)}”`,
    body: `
      <p class="text-[13px] text-slate-400 mb-4">Pick a block length. The timer keeps running even if you minimise it.</p>
      <div class="flex flex-wrap gap-2">
        ${presets.map((m) => `<button class="preset-btn" data-start-min="${m}">${m} min</button>`).join('')}
      </div>`,
    onMount: (box) => {
      box.querySelectorAll('[data-start-min]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const minutes = Number(btn.dataset.startMin)
          closeModal()
          startFocus(taskId, minutes)
        })
      })
    },
  })
}

export { ignoringUnload }
