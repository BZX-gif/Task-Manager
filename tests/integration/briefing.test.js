#!/usr/bin/env node
/**
 * The "Sir" briefing, end to end: the real Worker shell, the real client
 * bundle and real localStorage in jsdom. Covers the command strip, the
 * overlay, intention saving, completing work from the briefing, the keyboard
 * shortcut, the settings preview and the once-a-day auto-opening rule.
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

const settle = (ms = 70) => new Promise((resolve) => setTimeout(resolve, ms))

function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function seedState({ lastShownDay = null, salutation = 'Sir', briefingMode = 'daily' } = {}) {
  const today = dayKey()
  return {
    version: 6,
    tasks: [
      {
        id: 't1',
        title: 'Finish the strategy brief',
        date: today,
        time: null,
        priority: 'high',
        cat: 'work',
        estimateMinutes: 45,
        done: false,
        status: 'ready',
        inbox: false,
        createdAt: 1,
        subtasks: [],
        history: [],
      },
      {
        id: 't2',
        title: 'A captured thought',
        date: null,
        priority: 'medium',
        estimateMinutes: 15,
        done: false,
        status: 'ready',
        inbox: true,
        createdAt: 2,
        subtasks: [],
        history: [],
      },
    ],
    top3: { [today]: ['t1'] },
    settings: {
      salutation,
      briefingMode,
      theme: 'dark',
      accent: 'ember',
      timeFormat: '12h',
      focus: { defaultMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4, targetMinutes: 180 },
    },
    briefing: { lastShownDay, intentions: {} },
    focus: { active: null, sessions: [] },
    completionLog: {},
    schedule: { days: {}, history: [] },
    timetables: {},
    goals: [],
    projects: [],
    routines: [],
    reviews: {},
    reminders: { sent: {} },
    scoreHistory: {},
    chatHistory: [],
    dayPlans: {},
  }
}

function createWindow({ seed = null } = {}) {
  const virtualConsole = new VirtualConsole()
  const errors = []
  virtualConsole.on('jsdomError', (error) => errors.push(error.message))
  virtualConsole.on('error', (message) => errors.push(String(message)))
  const dom = new JSDOM(shell, { url: 'https://command-center.test/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole })
  const window = dom.window
  window.HTMLCanvasElement.prototype.getContext = () => null
  window.scrollTo = () => {}
  window.fetch = async () => new Response(JSON.stringify({ text: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } })
  if (seed !== null) window.localStorage.setItem('kcc_state_v1', typeof seed === 'string' ? seed : JSON.stringify(seed))
  return { dom, window, errors }
}

async function boot(options = {}) {
  const { dom, window, errors } = createWindow(options)
  window.eval(bundle)
  await settle(140)
  return { dom, window, errors, $: (selector) => window.document.querySelector(selector) }
}

before(async () => {
  shell = await (await worker.request('/')).text()
  bundle = await readFile(path.join(root, 'public', 'static', 'js', 'app.js'), 'utf8')
})

after(() => {
  for (const window of open) window.close()
})
const open = []

test('the app greets Sir and names the current mission in the command strip', async () => {
  const { window, errors, $ } = await boot({ seed: seedState() })
  open.push(window)
  try {
    assert.match(shell, /command-strip/, 'the shell ships the strip')
    assert.match(shell, /briefing-root/, 'the shell ships the briefing layer')
    assert.equal($('#command-strip-salute').textContent, 'At your command, Sir.')
    assert.equal($('#command-strip-task').textContent, 'Finish the strategy brief')
    assert.match($('#command-strip-meta').textContent, /priorit/i)

    const greeting = $('#overview-greeting').textContent.trim()
    assert.match(greeting, /Good morning|Good afternoon|Good evening|A quiet moment|Time to wind down/)
    assert.match(greeting, /Sir\.$/)
    assert.match($('#greeting-text').textContent, /Sir\.$/, 'the mobile greeting agrees')

    assert.equal($('#briefing-overlay'), null, 'nothing opens during the first paint')
    assert.deepEqual(errors, [])
  } finally {
    window.close()
  }
})

test('the briefing reads the real day, saves an intention and completes a mission', async () => {
  const { window, errors, $ } = await boot({ seed: seedState() })
  open.push(window)
  const today = window.CC.todayKey()
  const click = (selector) => {
    const element = $(selector)
    assert.ok(element, `element not found: ${selector}`)
    element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
  }
  let closed = false
  try {
    window.CC.openBriefing()
    await settle()
    const overlay = $('#briefing-overlay')
    assert.ok(overlay, 'the briefing opens')
    assert.match(overlay.textContent, /COMMAND BRIEFING/)
    assert.match($('.briefing-salute').textContent, /Sir\.$/)
    assert.match(overlay.textContent, /Finish the strategy brief/)
    assert.match(overlay.textContent, /Three priorities|three priorities|priorities/i)
    assert.ok($('[data-briefing-start]'), 'a real action is offered')
    assert.ok($('[data-briefing-complete]'), 'the mission can be completed from here')
    assert.equal(window.CC.getState().briefing.lastShownDay, today, 'the day is recorded once it is shown')
    assert.ok(window.document.body.classList.contains('briefing-open'))

    // intention — persisted immediately and reflected in place
    const input = $('#briefing-intention-input')
    input.value = 'Write the opening paragraph before lunch.'
    $('#briefing-intention-input').closest('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    await settle()
    assert.equal(window.CC.getState().briefing.intentions[today], 'Write the opening paragraph before lunch.')
    assert.match($('.briefing-intention-line').textContent, /Write the opening paragraph/)
    assert.match(JSON.parse(window.localStorage.getItem('kcc_state_v1')).briefing.intentions[today], /opening paragraph/)

    // complete the mission from the briefing; the briefing stays and refreshes
    click('[data-briefing-complete]')
    await settle()
    const task = window.CC.getState().tasks.find((item) => item.id === 't1')
    assert.equal(task.done, true, 'the mission is genuinely completed')
    assert.ok($('#briefing-overlay'), 'the briefing stays open to show the next move')
    assert.notEqual($('#command-strip-task').textContent, 'Finish the strategy brief', 'the strip moves on')

    // close with the footer button, then reopen with the keyboard shortcut
    window.CC.closeBriefing()
    await settle(30)
    assert.equal($('#briefing-overlay'), null)
    assert.equal(window.document.body.classList.contains('briefing-open'), false)
    closed = true

    const key = new window.KeyboardEvent('keydown', { key: 'b', bubbles: true, cancelable: true })
    window.document.body.dispatchEvent(key)
    await settle()
    assert.ok($('#briefing-overlay'), 'B opens the briefing')
    assert.equal(key.defaultPrevented, true)
    const escape = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    $('#briefing-overlay').querySelector('.briefing-panel').dispatchEvent(escape)
    await settle(30)
    assert.equal($('#briefing-overlay'), null, 'Escape closes the briefing')
    assert.deepEqual(errors, [])
  } finally {
    if (!closed) window.CC.closeBriefing({ restoreFocus: false })
    window.close()
  }
})

test('the briefing offers recovery when earlier work is still open', async () => {
  const seed = seedState({ briefingMode: 'off' })
  seed.tasks.push({
    id: 'old',
    title: 'Slipped from Friday',
    date: '2020-01-01',
    priority: 'medium',
    estimateMinutes: 30,
    done: false,
    status: 'ready',
    inbox: false,
    createdAt: 3,
    subtasks: [],
    history: [],
  })
  const { window, errors, $ } = await boot({ seed })
  open.push(window)
  try {
    window.CC.openBriefing()
    await settle()
    assert.match($('#briefing-overlay').textContent, /From earlier/)
    const recover = $('[data-briefing-recover]')
    assert.ok(recover, 'recovery is offered from the briefing')
    recover.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    await settle()
    assert.equal($('#briefing-overlay'), null, 'the briefing steps aside')
    assert.ok($('[data-modal-box]'), 'the recovery planner opens')
    assert.match($('[data-modal-box]').textContent, /Recover my day|fresh way forward/i)
    window.CC.closeModal()
    assert.deepEqual(errors, [])
  } finally {
    window.CC?.closeBriefing({ restoreFocus: false })
    window.close()
  }
})

test('settings can change the salutation and preview the briefing', async () => {
  const { window, errors, $ } = await boot({ seed: seedState({ briefingMode: 'off' }) })
  open.push(window)
  try {
    window.CC.switchView('settings')
    await settle()
    assert.ok($('#settings-briefing'), 'the briefing section exists')
    assert.match($('#settings-briefing').textContent, /How your day opens/)
    const salutation = $('[data-setting="salutation"]')
    assert.equal(salutation.value, 'Sir')
    salutation.value = 'Chief'
    salutation.dispatchEvent(new window.Event('change', { bubbles: true }))
    await settle()
    assert.equal(window.CC.getState().settings.salutation, 'Chief')

    window.CC.switchView('dashboard')
    await settle()
    assert.match($('#overview-greeting').textContent, /Chief\.$/)
    assert.equal($('#command-strip-salute').textContent, 'At your command, Chief.')

    window.CC.switchView('settings')
    await settle()
    $('[data-preview-briefing]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await settle()
    assert.ok($('#briefing-overlay'), 'the preview opens the real briefing')
    assert.match($('.briefing-salute').textContent, /Chief\.$/)
    assert.deepEqual(errors, [])
  } finally {
    window.CC?.closeBriefing({ restoreFocus: false })
    window.close()
  }
})

test('the briefing opens itself once a day, and not again after being seen', async () => {
  const first = await boot({ seed: seedState() })
  open.push(first.window)
  let second = null
  try {
    assert.equal(first.$('#briefing-overlay'), null, 'not instantly — the dashboard paints first')
    await settle(1400)
    assert.ok(first.$('#briefing-overlay'), 'the briefing greets the day once the app is ready')
    assert.match(first.$('.briefing-salute').textContent, /Sir\.$/)

    const stored = JSON.parse(first.window.localStorage.getItem('kcc_state_v1'))
    assert.equal(stored.briefing.lastShownDay, dayKey(), 'the greeting is recorded in real storage')

    first.window.CC.closeBriefing({ restoreFocus: false })
    first.window.close()

    second = await boot({ seed: stored })
    open.push(second.window)
    await settle(1400)
    assert.equal(second.$('#briefing-overlay'), null, 'it does not greet twice in one day')
    assert.equal(second.$('#command-strip-task').textContent, 'Finish the strategy brief', 'the strip still works')
    assert.deepEqual(second.errors, [])
  } finally {
    second?.window.close()
    first.window.close()
  }
})
