/**
 * Integration tests for the parts of the upgrade that guard user data and
 * background behaviour:
 *
 *   • a real v1 localStorage payload boots into v2 without losing anything
 *   • an active focus session survives a page reload
 *   • reminders fire once, respect protected time and stay silent when off
 *   • protected time is honoured by the recovery planner and the timetable warning
 *   • state changes are persisted (debounced) and survive a reload
 *
 * Requires `npm run build` first (npm test does that automatically).
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { JSDOM, VirtualConsole } from 'jsdom'

const root = process.cwd()
const worker = (await import(path.join(root, 'dist', 'index.js'))).default

let shell
let bundle

const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms))

function createWindow({ seed = null } = {}) {
  const virtualConsole = new VirtualConsole()
  const errors = []
  virtualConsole.on('jsdomError', (error) => errors.push(error.message))
  virtualConsole.on('error', (message) => errors.push(String(message)))

  const dom = new JSDOM(shell, { url: 'https://command-center.test/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole })
  const window = dom.window
  // jsdom ships no canvas backing store and no fetch — stub both so the app
  // behaves like it does in a real (canvas-capable) browser
  window.HTMLCanvasElement.prototype.getContext = () => null
  window.scrollTo = () => {}
  window.fetch = async () => new Response(JSON.stringify({ text: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } })
  if (seed !== null) window.localStorage.setItem('kcc_state_v1', typeof seed === 'string' ? seed : JSON.stringify(seed))
  return { dom, window, errors }
}

async function boot(options = {}) {
  const { dom, window, errors } = createWindow(options)
  const toasts = []
  window.eval(bundle)

  const container = window.document.getElementById('toast-container')
  new window.MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) if (node.textContent) toasts.push(node.textContent.trim())
    }
  }).observe(container, { childList: true })

  await settle(80)
  return { dom, window, errors, toasts, $: (selector) => window.document.querySelector(selector) }
}

before(async () => {
  shell = await (await worker.request('/')).text()
  bundle = await readFile(path.join(root, 'public', 'static', 'js', 'app.js'), 'utf8')
})

/* -------------------------------------------------------------- migration */

test('a legacy v1 payload boots into v2 with every record intact', async () => {
  const legacy = {
    categories: [{ id: 'upsc', name: 'UPSC Core', color: '#3b82f6' }],
    timetable: [{ time: '06:00', title: 'Deep study', duration: 120, cat: 'upsc' }],
    tasks: [
      { id: 't1', title: 'Revise Polity', date: '2026-09-10', priority: 'high', cat: 'upsc', done: true, createdAt: 1 },
      { id: 't2', title: 'Essay practice', date: '2026-09-12', priority: 'medium', cat: 'upsc', done: false, createdAt: 2 },
    ],
    completionLog: { '2026-09-10': { ttDone: [], taskDone: ['t1'] } },
    settings: { geminiApiKey: 'AQ.legacyBrowserKeyExposedInV1xxxxxxxxxx', theme: 'dark' },
    chatHistory: [{ role: 'user', text: 'hello' }],
  }
  const { window, errors, toasts, $ } = await boot({ seed: legacy })
  try {
    await settle(120)
    const state = window.CC.getState()

    assert.equal(state.version, 2)
    assert.equal(state.tasks.length >= 2, true, 'tasks preserved')
    assert.ok(state.tasks.some((t) => t.title === 'Revise Polity' && t.done === true))
    assert.equal(state.timetable.length, 1)
    assert.equal(state.timetable[0].title, 'Deep study')
    assert.ok(state.timetable[0].id, 'timetable blocks received ids')
    assert.equal(state.completionLog['2026-09-10'].taskDone.join(','), 't1')
    assert.equal(state.settings.geminiApiKey, undefined, 'the browser API key is gone')
    assert.ok(state.focus && Array.isArray(state.focus.sessions), 'new collections exist')
    assert.ok(state.top3 && state.dayPlans && state.reminders, 'new collections exist')

    const raw = JSON.parse(window.localStorage.getItem('kcc_state_v1'))
    assert.equal(raw.settings.geminiApiKey, undefined, 'the key is not persisted again')
    assert.ok(window.localStorage.getItem('kcc_backup_pre_v2'), 'pre-migration safety copy is stored')
    assert.ok(toasts.some((t) => /upgraded/i.test(t)), `migration toast shown (${toasts.join(' | ')})`)
    assert.equal($('#view-dashboard').innerHTML.length > 500, true)
    assert.deepEqual(errors, [])
  } finally {
    window.close()
  }
})

test('an unreadable payload is rescued, reported and never silently dropped', async () => {
  const { window, errors, toasts, $ } = await boot({ seed: '{not json' })
  try {
    assert.ok(window.CC.getState().timetable.length > 0, 'falls back to defaults')
    assert.equal(window.localStorage.getItem('kcc_backup_unreadable'), '{not json', 'a copy is parked under a rescue key')
    assert.ok(toasts.some((t) => /could not be read/i.test(t)), `the user is told (${toasts.join(' | ')})`)
    assert.equal($('#view-dashboard').innerHTML.length > 100, true)
    assert.deepEqual(errors, [])
  } finally {
    window.close()
  }
})

/* ------------------------------------------------------------ persistence */

test('a running focus session survives a reload', async () => {
  const { window } = await boot()
  let reloaded = null
  try {
    window.CC.openFocusMode()
    await settle()
    window.document.querySelector('#focus-start')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await settle(120)
    const active = window.CC.getState().focus.active
    assert.ok(active, 'session running')
    assert.equal(active.running, true)

    const persisted = JSON.parse(window.localStorage.getItem('kcc_state_v1'))
    assert.ok(persisted.focus.active, 'active session written to storage immediately')

    // simulate the user coming back after a refresh
    reloaded = await boot({ seed: persisted })
    await settle(120)
    const restored = reloaded.window.CC.getState().focus.active
    assert.ok(restored, 'session restored after reload')
    assert.equal(restored.plannedMinutes, active.plannedMinutes)
    assert.equal(restored.running, true)
    assert.ok(reloaded.$('.focus-overlay'), 'the focus overlay is put back on screen')
  } finally {
    window.close()
    reloaded?.window.close()
  }
})

test('changes are persisted and visible after a restart', async () => {
  const { window } = await boot()
  let second = null
  try {
    window.CC.addTaskToTop3(
      (() => {
        window.CC.openQuickCapture()
        const box = window.document.querySelector('[data-modal-box]')
        box.querySelector('#capture-title').value = 'Persistence check'
        box.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
        return window.CC.getState().tasks.find((t) => t.title === 'Persistence check').id
      })(),
    )
    await settle(500) // debounced save
    const stored = JSON.parse(window.localStorage.getItem('kcc_state_v1'))
    assert.ok(stored.tasks.some((t) => t.title === 'Persistence check'), 'task written to localStorage')
    assert.equal(stored.top3[window.CC.todayKey()].length, 1, 'priority written to localStorage')

    second = await boot({ seed: stored })
    await settle(100)
    const tasks = second.window.CC.getState().tasks
    assert.ok(tasks.some((t) => t.title === 'Persistence check'))
    assert.match(second.$('[data-card="top3"]').textContent, /Persistence check/)
  } finally {
    window.close()
    second?.window.close()
  }
})

/* -------------------------------------------------------------- reminders */

test('reminders fire once, and only for what is due', async () => {
  const { window, toasts } = await boot()
  try {
    const state = window.CC.getState()
    const today = window.CC.todayKey()
    const soon = new Date(Date.now() + 5 * 60_000)
    const time = `${String(soon.getHours()).padStart(2, '0')}:${String(soon.getMinutes()).padStart(2, '0')}`
    state.settings.reminders = { ...state.settings.reminders, enabled: true, beforeMinutes: 10, top3NudgeAt: '' }
    state.timetable = [
      { id: 'soon', time, title: 'Geography revision', duration: 60, cat: 'upsc' },
      { id: 'later', time: '23:45', title: 'Late block', duration: 10, cat: 'upsc' },
    ]
    state.tasks = [
      { id: 'task1', title: 'Timed task', date: today, time, priority: 'high', estimateMinutes: 30, done: false, inbox: false, createdAt: 1 },
    ]

    const first = window.CC.checkReminders()
    assert.ok(first.length >= 1, 'something was due')
    assert.ok(first.length <= 2, 'never spams')
    await settle(40)
    assert.ok(toasts.some((t) => /Geography revision/.test(t)), `reminder toast shown (${toasts.join(' | ')})`)
    assert.ok(toasts.some((t) => /Timed task/.test(t)), 'timed task reminder shown')

    const second = window.CC.checkReminders()
    assert.equal(second.length, 0, 'the same reminder is never repeated')

    state.settings.reminders.enabled = false
    const off = window.CC.checkReminders()
    assert.equal(off.length, 0, 'disabled reminders stay quiet')
  } finally {
    window.close()
  }
})

/* --------------------------------------------------------- protected time */

test('protected time blocks are honoured by the recovery planner', async () => {
  const { window } = await boot()
  try {
    const state = window.CC.getState()
    state.settings.protectedTime = [{ id: 'sleep', label: 'Sleep', start: '23:00', end: '06:00', days: [] }]
    state.settings.dayEnd = '23:30'
    const today = window.CC.todayKey()
    state.timetable = [
      { id: 'b1', time: '08:00', title: 'Missed block 1', duration: 60, cat: 'upsc' },
      { id: 'b2', time: '09:00', title: 'Missed block 2', duration: 60, cat: 'upsc' },
    ]
    state.completionLog[today] = { ttDone: [], taskDone: [] }

    window.CC.openRecoveryModal({ nowMinutes: 22 * 60 + 30 })
    await settle(60)
    const modal = window.document.querySelector('[data-modal-box]').textContent
    assert.match(modal, /Recover My Day/)
    assert.match(modal, /protected/i, 'protected windows are explained')
    // 22:30 start with a 23:00 protected window leaves under 20 minutes of room
    assert.match(modal, /could not be rescheduled|could not reschedule/i)
    window.CC.closeModal()

    // timetable conflict warning
    state.timetable.push({ id: 'late', time: '23:15', title: 'Late night block', duration: 30, cat: 'upsc' })
    window.CC.switchView('timetable')
    await settle(60)
    const view = window.document.querySelector('#view-timetable').textContent
    assert.match(view, /protected time/i, 'overlap warning is shown')
    assert.match(view, /Sleep/)
  } finally {
    window.close()
  }
})

/* ------------------------------------------------------------ navigation */

test('focus entry points and mobile navigation work', async () => {
  const { window, $, errors } = await boot()
  try {
    // sidebar "Start Focus" opens the picker overlay
    $('#focus-mini-start').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await settle()
    assert.ok($('.focus-overlay'), 'sidebar button opens focus mode')
    assert.ok($('#focus-start'), 'the picker asks for target + length first')
    window.document.querySelector('.focus-exit').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await settle()
    assert.equal($('.focus-overlay'), null, 'minimise closes the overlay')

    // custom length is an inline field, not window.prompt
    $('#focus-mini-start').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await settle()
    $('[data-custom]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await settle()
    const custom = $('#focus-custom-minutes')
    assert.ok(custom, 'custom minutes field appears')
    custom.value = '45'
    custom.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    assert.equal($('[data-custom]').textContent.trim(), '45 min')

    // header chip appears only while a session runs
    $('#focus-start').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await settle(120)
    assert.equal($('#active-timer-chip').classList.contains('hidden'), false, 'timer chip visible while running')
    $('#active-timer-chip').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await settle()
    assert.ok($('.focus-overlay'), 'chip reopens the session')
    // stopping immediately logs nothing (no junk sessions in analytics)
    window.CC.stopFocus({ quiet: true })
    await settle(60)
    assert.equal(window.CC.getState().focus.active, null, 'stop clears the session')
    assert.equal(window.CC.getState().focus.sessions.length, 0, 'a sub-minute session is discarded')

    // …but a real one is recorded with the chosen length
    window.CC.openFocusMode()
    await settle()
    $('#focus-start').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await settle(120)
    window.CC.getState().focus.active.accumulatedSeconds = 300
    window.CC.stopFocus({ quiet: true })
    await settle(80)
    const recorded = window.CC.getState().focus.sessions
    assert.equal(recorded.length, 1, 'a real session is recorded')
    assert.equal(recorded[0].focusedSeconds, 300)
    assert.equal(recorded[0].status, 'stopped')
    assert.equal(recorded[0].plannedMinutes, 25, 'the default length applies when the picker is skipped')
    assert.equal($('#active-timer-chip').classList.contains('hidden'), true, 'chip hides again when idle')

    // mobile nav toggle
    $('#mobile-menu-btn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await settle()
    assert.equal($('#mobile-nav').classList.contains('hidden'), false, 'mobile nav opens')
    assert.deepEqual(errors, [])
  } finally {
    window.close()
  }
})

after(() => {
  /* nothing global to clean up: each test closes its own DOM */
})
