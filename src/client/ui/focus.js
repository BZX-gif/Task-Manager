/* -------------------------------------------------------------------------
   FOCUS MODE — the "Focus Mission" experience (fullscreen overlay)

   Enter the Zone → Work → Build Momentum → Finish the Mission → Celebrate.

   • 25 / 50 / 90 minute presets + custom (1–600), plus optional short breaks
   • pause / resume / complete / end / +5 min — identical session semantics
     as before (lib/focus.js is untouched; this file is presentation + flow)
   • a short "Focus Launch" briefing with a skippable 3-2-1 transition
   • phases (WARMING UP → BUILDING MOMENTUM → DEEP WORK → FINAL PUSH),
     transient milestones at 25/50/75/90%, a final-minute state and a
     completion ceremony — all derived from REAL timer numbers, never
     animation frames or fabricated metrics
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
import { MISSION_PHASES, finalMinuteStage, milestoneCrossed, missionPhase, momentumChain } from '../lib/mission.js'
import { closeModal, escapeHtml, el, openModal, toast } from '../core/dom.js'
import { commit, currentDayKey, rollSeriesForward, state, streak, syncScoreHistory, todayStats } from '../core/store.js'
import { uid } from '../lib/state.js'
import { emit } from '../core/bus.js'

let ticker = null
let ignoringUnload = false

/* ---------------------------------------------------- overlay UI stages */
// Explains *what* the overlay is showing beyond a plain session:
//   launchState  — "READY? … ENTER THE ZONE" briefing before the clock starts
//   pendingStop  — the "end this session?" dignity screen (no shaming)
//   ceremony     — the completion celebration + real post-session metrics
// None of these touch the session record; an in-flight session is untouched
// by stage changes and a reload always restores the plain session screen.
let launchState = null
let pendingStop = false
let ceremony = null
let launchTimers = []

/* live-tick presentation memory (never persisted) */
let lastPhaseKey = null
let lastFinalKey = null
let lastReached = false
let lastRatio = 0
let milestoneTimer = null
/** the picker's last chosen length, so "Change plan" never loses it */
let lastPickerMinutes = null

const PHASE_KEYS = MISSION_PHASES.map((p) => p.key).concat(['recharge'])
const LAUNCH_STEP_MS = 550

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

/* goal-reached detection: compare the elapsed time across ticks (the old
   commit-boundary comparison could never cross, which made the "time's up"
   chime + toast silently dead). Fires once per crossing, rearms on +5 min. */
let lastTickElapsed = 0
let lastTickSessionId = null

function startTicker(onTick) {
  if (ticker) clearInterval(ticker)
  ticker = setInterval(() => {
    const session = activeSession()
    if (!session) {
      lastTickSessionId = null
      lastTickElapsed = 0
      emit('focus:tick')
      return
    }
    if (session.running) {
      const nowMs = Date.now()
      commit((s) => {
        s.focus.active = tickSession(s.focus.active, nowMs)
      }, { silent: true })
      const next = state.focus.active || session
      const planned = plannedSeconds(next)
      const elapsed = elapsedSeconds(next, nowMs)
      const previous = lastTickSessionId === next.id ? lastTickElapsed : 0
      if (planned > 0 && Math.floor(previous) < Math.floor(planned) && Math.floor(elapsed) >= Math.floor(planned)) {
        onFocusTimeReached()
      }
      lastTickElapsed = elapsed
      lastTickSessionId = next.id
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
  pendingStop = false
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
  resetPresentationMemory()
  launchState = null
  ceremony = null
  pendingStop = false
  lastPickerMinutes = null // the picker's memory is consumed by the launch
  commit((s) => {
    s.focus.active = session
  }, { immediate: true })
  renderFocusOverlay()
  const label = mode === 'break' ? 'Break' : 'Mission'
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
  announce('Paused')
  renderFocusOverlay()
}

export function resumeFocus() {
  if (!activeSession()) return
  commit((s) => {
    s.focus.active = resumeSession(s.focus.active, Date.now())
  }, { immediate: true })
  announce('Session resumed')
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

/**
 * Finish the session deliberately: credits all focused time, applies the
 * Settings → Focus rule for the linked task and shows the completion
 * ceremony with the real numbers that just changed.
 */
export function completeFocus() {
  const session = activeSession()
  if (!session) return
  const before = todayStats()
  const record = finalizeSession(session, Date.now(), 'completed')
  const minutes = Math.round(record.focusedSeconds / 60)
  commit((s) => {
    if (record.focusedSeconds >= 30) s.focus.sessions.push({ ...record, categoryId: categoryForTask(record.taskId) })
    s.focus.active = null
  }, { immediate: true })
  syncScoreHistory(currentDayKey())
  pendingStop = false
  playChime()

  const linkedTask = record.taskId ? state.tasks.find((t) => t.id === record.taskId) : null
  const task = linkedTask && !linkedTask.done ? linkedTask : null
  let taskMarked = false
  if (task && state.settings.focus.autoCompleteTask) {
    // finishing a focus session on a task finishes the task (Settings → Focus)
    commit((s) => {
      const target = s.tasks.find((t) => t.id === task.id)
      if (target) {
        target.done = true
        target.completedAt = Date.now()
        rollSeriesForward(target)
      }
    })
    taskMarked = true
  }

  if (record.mode === 'break') {
    // breaks end quietly: no ceremony, just back to work
    closeFocusOverlay()
    toast(`Break complete · ${formatDuration(minutes)} rested`, 'success')
    return
  }

  const after = todayStats()
  ceremony = {
    record,
    minutes,
    logged: record.focusedSeconds >= 30,
    task: task ? { id: task.id, title: task.title } : null,
    taskMarked,
    linkedTitle: linkedTask ? linkedTask.title : null,
    scoreDelta: Math.round(after.score - before.score),
    scoreAfter: Math.round(after.score),
    focusedToday: after.focusedMinutes,
    top3: after.top3Total > 0 ? { done: after.top3Done, total: after.top3Total } : null,
    streak: streak().current,
  }
  renderFocusOverlay()

  if (task && taskMarked) {
    toast(`Session complete · ${formatDuration(minutes)} on “${task.title}” — task done 🎉`, 'success')
  } else if (task) {
    toast(`Session complete · ${formatDuration(minutes)} on “${task.title}”`, 'success', { timeout: 9000 })
  } else {
    toast(`Session complete · ${formatDuration(minutes)} focused`, 'success')
  }
}

/** Mark-the-task-done from inside the ceremony (when the setting is off). */
function markCeremonyTaskDone() {
  if (!ceremony || !ceremony.task) return
  const taskId = ceremony.task.id
  commit((s) => {
    const target = s.tasks.find((t) => t.id === taskId)
    if (target) {
      target.done = true
      target.completedAt = Date.now()
      rollSeriesForward(target)
    }
  })
  ceremony.taskMarked = true
  syncScoreHistory(currentDayKey())
  renderFocusOverlay()
  toast('Task completed 🎉', 'success')
}

function categoryForTask(taskId) {
  if (!taskId) return null
  return state.tasks.find((t) => t.id === taskId)?.cat || null
}

/* ------------------------------------------------------------ Focus Launch */

/**
 * The briefing shown between "start" and the running timer. It never delays
 * the workflow: ENTER THE ZONE skips it, the 3-2-1 auto-enters in ~1.7s and
 * Esc/“Change plan” backs out without creating any session.
 */
function beginLaunch({ taskId = null, minutes, from = 'picker' }) {
  cancelLaunchTimers()
  ceremony = null
  pendingStop = false
  launchState = {
    taskId: taskId || null,
    minutes: Math.max(1, Math.round(minutes || state.settings.focus.defaultMinutes || 25)),
    from,
  }
  renderFocusOverlay()
  launchTimers = [
    setTimeout(() => paintLaunchCount('2'), LAUNCH_STEP_MS),
    setTimeout(() => paintLaunchCount('1'), LAUNCH_STEP_MS * 2),
    setTimeout(() => enterZoneNow(), LAUNCH_STEP_MS * 3),
  ]
}

function paintLaunchCount(text) {
  const node = el('focus-launch-count')
  if (!node || !launchState) return
  node.textContent = text
  node.classList.remove('fz-count-tick')
  void node.offsetWidth // restart the tiny step animation
  node.classList.add('fz-count-tick')
}

/** Skip the countdown — the session starts exactly now (honest startedAt). */
function enterZoneNow() {
  if (!launchState) return
  const { taskId, minutes } = launchState
  cancelLaunchTimers()
  launchState = null
  startFocus(taskId, minutes)
}

function cancelLaunchTimers() {
  for (const id of launchTimers) clearTimeout(id)
  launchTimers = []
}

/** Back out of the briefing without creating a session. */
function cancelLaunch() {
  cancelLaunchTimers()
  const from = launchState?.from
  launchState = null
  if (from === 'picker') renderFocusOverlay({ forcePicker: true })
  else closeFocusOverlay()
}

/* ---------------------------------------------------------------- overlay */

export function closeFocusOverlay() {
  cancelLaunchTimers()
  launchState = null
  ceremony = null
  pendingStop = false
  lastPickerMinutes = null
  resetPresentationMemory()
  const root = el('focus-root')
  if (root) root.innerHTML = ''
}

function resetPresentationMemory() {
  lastPhaseKey = null
  lastFinalKey = null
  lastReached = false
  lastRatio = 0
  if (milestoneTimer) clearTimeout(milestoneTimer)
  milestoneTimer = null
}

/**
 * @param {string|null} [taskId] task to link (goes through the Focus Launch)
 */
export function openFocusMode(taskId = null) {
  if (launchState || ceremony || pendingStop) {
    // mid-briefing / mid-ceremony / mid-confirm: keep the current stage
    return
  }
  if (activeSession()) {
    // a session is already running: bring it back on screen
    renderFocusOverlay()
    return
  }
  if (taskId) {
    // opened from a task → brief the mission and launch it
    beginLaunch({ taskId, minutes: state.settings.focus.defaultMinutes, from: 'task' })
    return
  }
  // opened from the nav/sidebar → brief first, target + length second
  renderFocusOverlay({ forcePicker: true })
}

export function renderFocusOverlay({ forcePicker = false } = {}) {
  const root = el('focus-root')
  if (!root) return
  // re-seed the live-tick memory so re-opening never replays old milestones
  const session = activeSession()
  if (session) {
    lastRatio = progressRatio(session, Date.now())
    lastPhaseKey = missionPhase(lastRatio, session.mode).key // transitions announce themselves, re-renders don't
  }
  lastFinalKey = null

  if (launchState) {
    root.innerHTML = launchHtml(launchState)
    bindLaunch(root)
  } else if (ceremony) {
    root.innerHTML = ceremonyHtml(ceremony)
    bindCeremony(root)
  } else if (!session) {
    root.innerHTML = forcePicker ? setupHtml() : ''
    if (forcePicker) bindSetup(root)
  } else {
    root.innerHTML = sessionHtml(session)
    bindSession(root, session)
    paintTimer()
  }
  focusOverlayChrome(root)
}

function focusOverlayChrome(root) {
  const overlay = root.querySelector('.focus-overlay')
  if (overlay && typeof overlay.focus === 'function' && root.contains(overlay)) {
    // give the dialog keyboard ownership so Space / Esc / + work everywhere
    overlay.focus({ preventScroll: true })
  }
}

/* -------------------------------------------------------------- templates */

function overlayShell(inner, { extraClass = '' } = {}) {
  return `
    <div class="focus-overlay ${extraClass}" role="dialog" aria-modal="true" aria-label="Focus mode — focus mission" tabindex="-1">
      <div class="focus-ambient" aria-hidden="true">
        <span class="fz-orb fz-orb-1"></span>
        <span class="fz-orb fz-orb-2"></span>
        <span class="fz-orb fz-orb-3"></span>
        <span class="focus-vignette"></span>
      </div>
      <button class="focus-exit" data-focus-close aria-label="Minimise focus mode"><i class="fa-solid fa-compress"></i></button>
      <div class="focus-panel">${inner}</div>
    </div>`
}

function setupHtml() {
  const tasks = state.tasks.filter((t) => !t.done && (!t.date || t.date === currentDayKey())).slice(0, 40)
  const defaultMinutes = state.settings.focus.defaultMinutes || 25
  return overlayShell(`
    <p class="focus-eyebrow">Focus Mode</p>
    <h2 class="font-display text-2xl sm:text-3xl font-extrabold text-white mt-3 mb-1">Choose your mission</h2>
    <p class="text-[13px] text-slate-400 mb-6">One task. One timer. No tab switching.</p>
    <div class="flex flex-wrap gap-2 justify-center mb-5" id="focus-presets">
      ${FOCUS_PRESETS.map((m) => `<button class="preset-btn ${m === defaultMinutes ? 'preset-active' : ''}" data-minutes="${m}">${m} min</button>`).join('')}
      <button class="preset-btn" data-custom>Custom…</button>
    </div>
    <label class="field-label text-left" for="focus-task">Mission — link a task (optional)</label>
    <select class="input-field mb-6" id="focus-task">
      <option value="">No specific task — deep work</option>
      ${tasks.map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.title)}</option>`).join('')}
    </select>
    <div class="flex flex-col sm:flex-row gap-3 justify-center">
      <button class="btn-primary focus-enter" id="focus-start"><i class="fa-solid fa-play mr-2"></i>Launch mission</button>
      <button class="btn-ghost" data-focus-close>Cancel</button>
    </div>
    <p class="text-[11.5px] text-slate-500 mt-5">Tip: press <kbd class="kbd">Esc</kbd> to minimise — the timer keeps running.</p>
  `)
}

function launchHtml(launch) {
  const linked = launch.taskId ? state.tasks.find((t) => t.id === launch.taskId) : null
  return overlayShell(`
    <p class="focus-eyebrow">Focus Mode · Focus Launch</p>
    <h2 class="focus-ready mt-5">READY?</h2>
    <p class="focus-launch-task">${escapeHtml(linked ? linked.title : 'Deep Work')}</p>
    <p class="focus-launch-minutes">${launch.minutes} ${launch.minutes === 1 ? 'MINUTE' : 'MINUTES'}</p>
    <p class="focus-launch-sub">Everything else can wait.</p>
    <div class="fz-count font-display" id="focus-launch-count" aria-hidden="true">3</div>
    <div class="flex flex-col sm:flex-row gap-3 justify-center mt-2">
      <button class="btn-primary focus-enter" id="focus-launch-enter"><i class="fa-solid fa-bolt mr-2"></i>Enter the zone</button>
      <button class="btn-ghost" data-focus-launch-back>Change plan</button>
    </div>
    <p class="text-[11.5px] text-slate-500 mt-4">Starts on its own — press <kbd class="kbd">Enter</kbd> to skip the countdown.</p>
    ${announceRegion()}
  `, { extraClass: 'focus-launch' })
}

function sessionHtml(session) {
  if (pendingStop) return stopConfirmHtml(session)

  const isBreak = session.mode === 'break'
  const tasks = state.tasks.filter((t) => !t.done && (!t.date || t.date === currentDayKey())).slice(0, 40)
  const linked = session.taskId ? state.tasks.find((t) => t.id === session.taskId) : null
  const totals = sessionTotals(state.focus.sessions, currentDayKey())
  const before = linked ? minutesByTask(state.focus.sessions, linked.id) : 0
  const chain = momentumChain(state.focus.sessions, currentDayKey(), { includeCurrent: !isBreak })
  return overlayShell(`
    <p class="focus-eyebrow">${isBreak ? 'Focus Mode · Break' : 'Focus Mode'}</p>
    <div class="focus-phase-chip" id="focus-phase-chip">
      <span class="focus-phase-dot" aria-hidden="true"></span>
      <span id="focus-phase">${missionPhase(progressRatio(session, Date.now()), session.mode).label}</span>
      <span class="focus-phase-sep" aria-hidden="true">·</span>
      <span id="focus-percent" class="tabular-nums">0%</span>
    </div>
    <div class="focus-clock-wrap">
      <p id="focus-time" class="focus-clock font-display tabular-nums" aria-live="off">--:--</p>
    </div>
    <div class="focus-energy" id="focus-energy" role="progressbar" aria-label="Session progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
      <span class="focus-energy-track"></span>
      <span class="focus-energy-fill ${isBreak ? 'is-break' : ''}" id="focus-energy-fill"></span>
      ${[25, 50, 75, 90].map((pct) => `<span class="fz-tick" data-tick="${pct}" style="left:${pct}%" aria-hidden="true"></span>`).join('')}
    </div>
    <p class="focus-final-hint" id="focus-final-hint" aria-hidden="true"></p>
    <div class="focus-milestone" id="focus-milestone" aria-hidden="true"></div>

    <p class="focus-mission-label">${isBreak ? 'Recovery' : 'Mission'}</p>
    <h2 class="focus-mission-title">${escapeHtml(linked ? linked.title : isBreak ? 'Step away from the desk' : 'Deep Work')}</h2>
    <p class="focus-meta"><span id="focus-elapsed" class="tabular-nums">Focused 0:00 of ${formatClock(plannedSeconds(session))}</span><span class="focus-meta-sep" aria-hidden="true">·</span><span id="focus-state">${session.running ? 'Running' : 'Paused'}</span></p>
    ${!isBreak && linked && before > 0 ? `<p class="focus-logged">${before} min logged on this task before</p>` : ''}

    <div class="focus-controls">
      ${session.running
        ? '<button class="btn-primary focus-primary" data-focus-pause><i class="fa-solid fa-pause mr-2"></i>Pause</button>'
        : '<button class="btn-primary focus-primary" data-focus-resume><i class="fa-solid fa-play mr-2"></i>Resume</button>'}
      <button class="btn-ghost" data-focus-plus="5">+5 min</button>
      <button class="btn-ghost focus-complete-btn" data-focus-complete><i class="fa-solid fa-flag-checkered mr-2"></i>Complete</button>
      <button class="btn-ghost focus-end-btn" data-focus-stop><i class="fa-solid fa-stop mr-2"></i>End</button>
      <button class="btn-ghost" data-focus-close><i class="fa-solid fa-compress mr-2"></i>Minimise</button>
    </div>
    <div class="focus-secondary">
      <button class="nav-pill ${isBreak ? 'preset-active' : ''}" data-focus-break="${BREAK_PRESETS[0]}">5 min break</button>
      ${!isBreak ? `<button class="nav-pill" data-focus-switch-task>${linked ? 'Change task' : 'Link a task'}</button>` : ''}
    </div>
    ${!isBreak ? `
      <div class="${linked ? 'hidden ' : ''}mt-4 w-full" data-focus-task-picker>
        <label class="field-label text-left" for="focus-task-switch">Link this mission to a task</label>
        <select class="input-field" id="focus-task-switch">
          <option value="">No specific task — deep work</option>
          ${tasks.map((t) => `<option value="${escapeHtml(t.id)}" ${t.id === session.taskId ? 'selected' : ''}>${escapeHtml(t.title)}</option>`).join('')}
        </select>
      </div>` : ''}
    ${!isBreak && chain.nodes.length ? `
      <div class="focus-momentum">
        <p class="focus-momentum-label">Today’s momentum</p>
        <div class="focus-momentum-chain" role="img" aria-label="${chain.nodes.filter((n) => n.kind === 'done').length} sessions completed today, current session in progress">
          ${chain.overflow ? `<span class="fz-overflow">+${chain.overflow} earlier</span>` : ''}
          ${chain.nodes.map((node, i) => `${i ? '<span class="fz-link" aria-hidden="true"></span>' : ''}<span class="fz-node ${node.kind}" title="${node.kind === 'current' ? 'This session' : node.kind === 'done' ? 'Session completed' : 'Session stopped'}"></span>`).join('')}
        </div>
      </div>` : ''}
    <p id="focus-today-summary">Today: ${formatDuration(totals.focusedMinutes)} focused · ${totals.completedSessions}/${totals.sessions} sessions completed</p>
    <p class="focus-keys"><kbd class="kbd">Space</kbd> pause <span aria-hidden="true">·</span> <kbd class="kbd">+</kbd> add 5 min <span aria-hidden="true">·</span> <kbd class="kbd">Esc</kbd> minimise</p>
    ${announceRegion()}
  `)
}

function stopConfirmHtml(session) {
  const isBreak = session.mode === 'break'
  const linked = session.taskId ? state.tasks.find((t) => t.id === session.taskId) : null
  const focused = elapsedSeconds(session, Date.now())
  const ratio = progressRatio(session, Date.now())
  return overlayShell(`
    <p class="focus-eyebrow">Focus Mode${isBreak ? ' · Break' : ''}</p>
    <h2 class="font-display text-2xl sm:text-3xl font-extrabold text-white mt-6 mb-1">End this session?</h2>
    <p class="focus-mission-title mt-2">${escapeHtml(linked ? linked.title : isBreak ? 'Break — step away from the desk' : 'Deep Work')}</p>
    <p class="focus-ended-time font-display tabular-nums mt-6">${formatClock(focused)}</p>
    <p class="text-[12px] uppercase tracking-[0.24em] text-slate-500 font-bold mt-1">${isBreak ? 'of rest so far' : 'focused so far'}</p>
    <div class="focus-energy mt-5" aria-hidden="true">
      <span class="focus-energy-track"></span>
      <span class="focus-energy-fill" style="width:${(ratio * 100).toFixed(1)}%"></span>
    </div>
    <p class="fz-quote mt-5">That is still real work.</p>
    ${focused < 60 ? '<p class="text-[11.5px] text-slate-500 mt-1">Sessions under a minute aren’t logged, so analytics stay meaningful.</p>' : ''}
    <div class="focus-controls mt-6">
      <button class="btn-primary focus-primary" data-focus-resume-session><i class="fa-solid fa-play mr-2"></i>Keep focusing</button>
      <button class="btn-ghost focus-end-btn" data-focus-end-now><i class="fa-solid fa-stop mr-2"></i>End session</button>
    </div>
    ${announceRegion()}
  `, { extraClass: 'focus-ended' })
}

function ceremonyHtml(c) {
  const title = c.task ? c.task.title : c.linkedTitle
  return overlayShell(`
    <div class="focus-ceremony">
      <span class="fz-burst" aria-hidden="true"></span>
      <p class="fz-complete-eyebrow"><span aria-hidden="true">✦</span> SESSION COMPLETE <span aria-hidden="true">✦</span></p>
      <p class="focus-clock font-display tabular-nums mt-5">${formatClock(c.record.focusedSeconds)}</p>
      <p class="text-[11px] uppercase tracking-[0.3em] text-slate-400 font-bold mt-2">Focus Session</p>
      <div class="focus-energy mt-4" aria-hidden="true">
        <span class="focus-energy-track"></span>
        <span class="focus-energy-fill fz-energy-full"></span>
      </div>
      ${c.logged ? `<p class="fz-reward font-display">+${c.minutes} FOCUS ${c.minutes === 1 ? 'MINUTE' : 'MINUTES'}</p>` : ''}
      <div class="fz-stat-chips">
        <span class="fz-chip"><i class="fa-solid fa-stopwatch text-accent-2 mr-1.5"></i>Today · <strong>${formatDuration(c.focusedToday)}</strong> focused</span>
        <span class="fz-chip"><i class="fa-solid fa-gauge-high text-accent mr-1.5"></i>Score <strong>${c.scoreAfter}/100</strong>${c.scoreDelta > 0 ? ` <span class="fz-chip-pos">+${c.scoreDelta}</span>` : ''}</span>
        ${c.top3 ? `<span class="fz-chip"><i class="fa-solid fa-list-ol text-accent-2 mr-1.5"></i>Top 3 · <strong>${c.top3.done}/${c.top3.total}</strong></span>` : ''}
        ${c.streak > 0 ? `<span class="fz-chip"><i class="fa-solid fa-fire text-accent-4 mr-1.5"></i><strong>${c.streak}</strong> day streak</span>` : ''}
      </div>
      ${c.task && c.taskMarked ? `<p class="fz-taskline mt-4"><i class="fa-solid fa-circle-check text-accent-3 mr-1.5"></i>“${escapeHtml(c.task.title)}” marked done</p>` : ''}
      ${c.task && !c.taskMarked ? `
        <div class="mt-4 flex flex-col items-center gap-1.5">
          <p class="text-[13px] text-slate-400">Mission target: “${escapeHtml(c.task.title)}”</p>
          <button class="btn-ghost" data-ceremony-task><i class="fa-solid fa-check mr-2"></i>Mark task done</button>
        </div>` : ''}
      ${!c.task && title ? `<p class="fz-taskline mt-4">“${escapeHtml(title)}” is already done — nicely finished anyway.</p>` : ''}
      ${!c.logged ? '<p class="text-[11.5px] text-slate-500 mt-4">Sessions under a minute aren’t logged, so analytics stay meaningful.</p>' : ''}
      <p class="fz-quote mt-4">“You finished what you started.”</p>
      <div class="focus-controls mt-6">
        <button class="btn-primary focus-primary" data-focus-close>DONE</button>
        <button class="btn-ghost" data-ceremony-again><i class="fa-solid fa-rotate-right mr-2"></i>Start another mission</button>
      </div>
    </div>
    ${announceRegion('Session complete. Well done.')}
  `, { extraClass: 'focus-celebration' })
}

function announceRegion(text = '') {
  return `<p class="sr-only" role="status" aria-live="polite" aria-atomic="true" id="focus-announce">${escapeHtml(text)}</p>`
}

/** Screen-reader announcements for the moments that actually matter. */
function announce(text) {
  const node = el('focus-announce')
  if (node) node.textContent = text
}

/* ---------------------------------------------------------------- bindings */

function bindSetup(root) {
  const defaultMinutes = state.settings.focus.defaultMinutes || 25
  let minutes = lastPickerMinutes || defaultMinutes
  const applySelection = () => {
    root.querySelectorAll('#focus-presets .preset-btn').forEach((b) => b.classList.remove('preset-active'))
    const presetBtn = root.querySelector(`#focus-presets [data-minutes="${minutes}"]`)
    if (presetBtn) {
      presetBtn.classList.add('preset-active')
      const custom = root.querySelector('[data-custom]')
      if (custom) custom.textContent = 'Custom…'
      return
    }
    // a custom length survives "Change plan" on the custom button itself
    const custom = root.querySelector('[data-custom]')
    if (custom) {
      custom.textContent = `${minutes} min`
      custom.classList.add('preset-active')
    }
  }
  applySelection()
  root.querySelectorAll('#focus-presets [data-minutes]').forEach((btn) => {
    btn.addEventListener('click', () => {
      minutes = Number(btn.dataset.minutes)
      lastPickerMinutes = minutes
      applySelection()
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
        lastPickerMinutes = minutes
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
    beginLaunch({ taskId, minutes, from: 'picker' })
  })
  root.querySelectorAll('[data-focus-close]').forEach((btn) => btn.addEventListener('click', closeFocusOverlay))
}

function bindLaunch(root) {
  root.querySelector('#focus-launch-enter')?.addEventListener('click', enterZoneNow)
  root.querySelector('[data-focus-launch-back]')?.addEventListener('click', cancelLaunch)
  root.querySelectorAll('[data-focus-close]').forEach((btn) => btn.addEventListener('click', closeFocusOverlay))
  root.querySelector('.focus-overlay')?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      cancelLaunch()
      return
    }
    const target = /** @type {any} */ (event.target)
    const onButton = target && typeof target.closest === 'function' && target.closest('button')
    if ((event.key === 'Enter' || event.key === ' ') && !onButton) {
      event.preventDefault()
      enterZoneNow()
    }
  })
  const taskTitle = launchState?.taskId ? state.tasks.find((t) => t.id === launchState.taskId)?.title : null
  announce(`Ready. ${taskTitle || 'Deep work'}, ${launchState?.minutes} minutes. Enter the zone.`)
}

function bindCeremony(root) {
  root.querySelectorAll('[data-focus-close]').forEach((btn) => btn.addEventListener('click', closeFocusOverlay))
  root.querySelector('[data-ceremony-task]')?.addEventListener('click', markCeremonyTaskDone)
  root.querySelector('[data-ceremony-again]')?.addEventListener('click', () => {
    ceremony = null
    renderFocusOverlay({ forcePicker: true })
  })
  root.querySelector('.focus-overlay')?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeFocusOverlay()
    const target = /** @type {any} */ (event.target)
    const onButton = target && typeof target.closest === 'function' && target.closest('button')
    if (event.key === 'Enter' && !onButton) closeFocusOverlay()
  })
}

function bindSession(root, session) {
  root.querySelectorAll('[data-focus-close]').forEach((btn) => btn.addEventListener('click', closeFocusOverlay))
  root.querySelector('[data-focus-pause]')?.addEventListener('click', pauseFocus)
  root.querySelector('[data-focus-resume]')?.addEventListener('click', resumeFocus)
  root.querySelector('[data-focus-complete]')?.addEventListener('click', completeFocus)
  root.querySelector('[data-focus-stop]')?.addEventListener('click', () => {
    const live = activeSession()
    if (live && remainingSeconds(live, Date.now()) > 0) {
      // ending early deserves a dignity screen, never a shame screen
      pendingStop = true
      renderFocusOverlay()
      announce('Session not finished yet. End it, or keep focusing — the focused time is real either way.')
    } else {
      stopFocus()
    }
  })
  root.querySelector('[data-focus-resume-session]')?.addEventListener('click', () => {
    pendingStop = false
    renderFocusOverlay()
  })
  root.querySelector('[data-focus-end-now]')?.addEventListener('click', () => {
    pendingStop = false
    stopFocus()
  })
  root.querySelector('[data-focus-plus]')?.addEventListener('click', () => addFocusMinutes(5))
  root.querySelector('[data-focus-break]')?.addEventListener('click', (event) => {
    const minutes = Number(event.currentTarget.dataset.focusBreak) || 5
    commit((s) => {
      s.focus.active = finalizeSession(s.focus.active, Date.now(), 'completed')
      if (s.focus.active.focusedSeconds >= 60 && session.mode !== 'break') s.focus.sessions.push({ ...s.focus.active, categoryId: categoryForTask(s.focus.active.taskId) })
      s.focus.active = createSession({ id: uid(), taskId: null, plannedMinutes: minutes, mode: 'break', now: Date.now() })
    }, { immediate: true })
    syncScoreHistory(currentDayKey())
    resetPresentationMemory()
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
    if (event.key === 'Escape') {
      closeFocusOverlay()
      return
    }
    const target = /** @type {any} */ (event.target)
    const interactive = target && typeof target.closest === 'function' && target.closest('button, input, select, textarea, a[href], [contenteditable]')
    if (interactive) return
    if (event.key === ' ') {
      event.preventDefault()
      const live = activeSession()
      if (live) (live.running ? pauseFocus : resumeFocus)()
      return
    }
    if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      addFocusMinutes(5)
    }
  })
}

/* ----------------------------------------------------------- live painting */

/** Live numbers only — called every second; never re-renders the overlay. */
export function paintTimer() {
  const session = activeSession()
  const timeEl = el('focus-time')
  if (!session || !timeEl) return
  const nowMs = Date.now()
  const remaining = remainingSeconds(session, nowMs)
  const ratio = progressRatio(session, nowMs)
  const pct = Math.floor(ratio * 100)
  const isBreak = session.mode === 'break'
  const overlay = document.querySelector('.focus-overlay')

  timeEl.textContent = formatClock(remaining)

  const phase = missionPhase(ratio, session.mode)
  // class + label always stay in sync (cheap); the announcement fires once,
  // only on genuine phase transitions (re-renders re-seed lastPhaseKey)
  if (overlay) {
    for (const key of PHASE_KEYS) overlay.classList.remove(`phase-${key}`)
    overlay.classList.add(`phase-${phase.key}`)
  }
  const label = el('focus-phase')
  if (label) label.textContent = phase.label
  if (phase.key !== lastPhaseKey) {
    lastPhaseKey = phase.key
    announce(`Phase: ${phase.label.toLowerCase()}`)
  }

  const percentEl = el('focus-percent')
  if (percentEl) percentEl.textContent = `${pct}%`

  const energy = el('focus-energy')
  if (energy) energy.setAttribute('aria-valuenow', String(pct))
  const fill = el('focus-energy-fill')
  if (fill) fill.style.width = `${(ratio * 100).toFixed(2)}%`
  for (const tick of document.querySelectorAll('.fz-tick[data-tick]')) {
    tick.classList.toggle('is-passed', pct >= Number(tick.getAttribute('data-tick')))
  }

  const elapsedEl = el('focus-elapsed')
  if (elapsedEl) {
    const verb = isBreak ? 'Break' : 'Focused'
    elapsedEl.textContent = `${verb} ${formatClock(elapsedSeconds(session, nowMs))} of ${formatClock(plannedSeconds(session))}`
  }

  const stateEl = el('focus-state')
  if (stateEl) stateEl.textContent = session.running ? (remaining === 0 ? 'Goal reached' : 'Running') : 'Paused'

  const panel = document.querySelector('.focus-panel')
  if (panel) panel.classList.toggle('is-paused', !session.running)

  applyFinalMinute(overlay, session, remaining)
  applyGoalReached(overlay, session, remaining)

  if (!isBreak && session.running) {
    const crossed = milestoneCrossed(lastRatio, ratio)
    if (crossed) showMilestone(overlay, crossed)
  }
  lastRatio = ratio
}

/** 60s → 10s → 3s: quiet escalation, never a loud countdown. */
function applyFinalMinute(overlay, session, remaining) {
  if (session.mode === 'break') return
  const stage = finalMinuteStage(remaining)
  if (overlay) {
    overlay.classList.toggle('focus-final', !!stage)
    overlay.classList.toggle('focus-final-almost', stage?.key === 'almost' || stage?.key === 'count')
  }
  const hint = el('focus-final-hint')
  if (hint) hint.textContent = stage?.hint || ''
  if ((stage?.key || null) !== lastFinalKey) {
    if (stage?.key === 'final') announce('Final minute — finish strong')
    if (stage?.key === 'almost') announce('Almost there')
    lastFinalKey = stage?.key || null
  }
}

/** Planned time reached: invite the completion, never auto-finish. */
function applyGoalReached(overlay, session, remaining) {
  if (session.mode === 'break') return
  const reached = remaining <= 0
  if (overlay) overlay.classList.toggle('mission-ready', reached)
  if (reached && !lastReached) announce('Planned time reached — complete the mission to log it')
  lastReached = reached
}

/** Transient, lightweight milestone chip — no modals, no spam. */
function showMilestone(overlay, milestone) {
  const chip = el('focus-milestone')
  if (chip) {
    chip.innerHTML = `<span class="fz-milestone-chip"><i class="fa-solid fa-bolt" aria-hidden="true"></i>${escapeHtml(milestone.text)}</span>`
    chip.classList.remove('is-visible')
    void chip.offsetWidth
    chip.classList.add('is-visible')
    if (milestoneTimer) clearTimeout(milestoneTimer)
    milestoneTimer = setTimeout(() => {
      chip.classList.remove('is-visible')
      milestoneTimer = null
    }, 4200)
  }
  if (overlay) {
    overlay.classList.add('focus-milestone-pulse')
    setTimeout(() => overlay.classList.remove('focus-milestone-pulse'), 900)
  }
  announce(milestone.text)
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
          beginLaunch({ taskId, minutes, from: 'task' })
        })
      })
    },
  })
}

export { ignoringUnload }
