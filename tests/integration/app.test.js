#!/usr/bin/env node
/**
 * End-to-end smoke test.
 *
 *  1. imports the built Worker (`dist/index.js`) and checks the routes + assets
 *  2. boots the real client bundle inside jsdom against the real shell HTML
 *  3. drives the UI: dashboard → Top 3 → focus session → tasks → timetable →
 *     progress → weekly review → recovery → assistant error path → settings
 *
 * Requires `npm run build` first (npm test does that automatically).
 * Deliberately dependency-light (jsdom + node:test only) and fails loudly.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { JSDOM, VirtualConsole } from 'jsdom'

const root = process.cwd()
const worker = (await import(path.join(root, 'dist', 'index.js'))).default

let dom
let window
let errors = []
let toasts = []

before(async () => {
  const shell = await (await worker.request('/')).text()
  const bundle = await readFile(path.join(root, 'public', 'static', 'js', 'app.js'), 'utf8')
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', (error) => errors.push(`jsdomError: ${error.message}`))
  virtualConsole.on('error', (message) => errors.push(`console.error: ${message}`))

  dom = new JSDOM(shell, {
    url: 'https://command-center.test/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole,
  })
  window = dom.window
  // jsdom has no fetch/Response implementation — use Node's undici globals,
  // which the app consumes as plain objects (status/ok/json).
  window.fetch = async () => new Response(JSON.stringify({ text: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } })
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
  window.scrollTo = () => {}
  window.HTMLCanvasElement.prototype.getContext = () => null
  window.addEventListener('error', (event) => errors.push(`window error: ${event.message}`))

  // run the bundle
  window.eval(bundle)

  // observe toasts
  const container = window.document.getElementById('toast-container')
  new window.MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.textContent) toasts.push(node.textContent.trim())
      }
    }
  }).observe(container, { childList: true })
})

after(() => {
  dom?.window?.close()
})

const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms))
const $ = (selector) => window.document.querySelector(selector)
const $$ = (selector) => Array.from(window.document.querySelectorAll(selector))
const click = (elementOrSelector) => {
  const element = typeof elementOrSelector === 'string' ? $(elementOrSelector) : elementOrSelector
  assert.ok(element, `element not found: ${elementOrSelector}`)
  element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
}
const state = () => window.CC.getState()
const persisted = () => JSON.parse(window.localStorage.getItem('kcc_state_v1') || 'null')

test('worker serves the shell, static assets and the ai endpoint', async () => {
  const page = await worker.request('/')
  assert.equal(page.status, 200)
  const html = await page.text()
  assert.match(html, /Command Center/)
  assert.match(html, /\/static\/js\/app\.js/)
  assert.match(html, /\/static\/tailwind\.css/)
  assert.doesNotMatch(html, /cdn\.tailwindcss\.com/, 'Tailwind CDN must be gone')
  assert.match(html, /manifest\.webmanifest/)

  // static assets are served by Cloudflare's asset layer (before the worker),
  // so verify they are present in the build output the worker deploys with
  const shellAssets = ['static/js/app.js', 'static/tailwind.css', 'static/style.css', 'static/studio.css', 'static/favicon.svg', 'manifest.webmanifest', 'icons/apple-touch-icon.png']
  const optionalAssets = ['sw.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png']
  for (const asset of [...shellAssets, ...optionalAssets]) {
    const content = await readFile(path.join(root, 'dist', asset)).catch(() => null)
    assert.ok(content && content.length > 0, `${asset} should exist in dist/`)
  }
  for (const asset of shellAssets) {
    assert.ok(html.includes(`/${asset}`), `shell should reference /${asset}`)
  }
  const manifest = JSON.parse(await readFile(path.join(root, 'dist', 'manifest.webmanifest'), 'utf8'))
  assert.equal(manifest.display, 'standalone')
  for (const icon of manifest.icons) {
    await readFile(path.join(root, 'dist', icon.src), 'utf8').catch(() => assert.fail(`manifest icon ${icon.src} missing`))
  }
  assert.match(html, /theme-color/, 'theme colour for the installed app')
  assert.match(html, /apple-mobile-web-app-capable/)
  assert.doesNotMatch(html, /fonts\.googleapis\.com|fontawesome|@fontsource/, 'no remote font or icon-font requests')
  const sw = await readFile(path.join(root, 'dist', 'sw.js'), 'utf8')
  assert.match(sw, /cc-shell-/, 'service worker versions its caches')
  assert.match(sw, /\/api\//, 'service worker never caches API calls')

  const health = await worker.request('/api/health')
  assert.equal(health.status, 200)
  assert.equal((await health.json()).ok, true)

  const ai = await worker.request('/api/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ system: 'x', context: 'y', messages: [{ role: 'user', content: 'hi' }] }),
  })
  assert.ok([500, 502].includes(ai.status), 'without a secret the endpoint reports a friendly error')
  const aiBody = await ai.json()
  assert.match(aiBody.error.message, /GEMINI_API_KEY/)
  assert.ok(!JSON.stringify(aiBody).includes('at '), 'no stack traces leaked')
})

test('the app boots and renders the dashboard', async () => {
  await settle(60)
  assert.equal(errors.length, 0, `boot errors: ${errors.join(' | ')}`)
  assert.ok($('#view-dashboard').innerHTML.length > 500, 'dashboard rendered content')
  assert.match(window.document.getElementById('greeting-text').textContent, /Good morning|Good afternoon|Good evening|A quiet moment|Time to wind down/)
  const fresh = state()
  assert.equal(fresh.timetables.ssc_cgl_2027.length, 0, 'a fresh workspace has no invented commitments')
  assert.equal(fresh.tasks.length, 0)
  assert.equal(fresh.version, 6)
})

test('the overview keeps its metrics and actions usable across refreshes', async () => {
  assert.equal($$('.metric-strip .metric').length, 4)
  assert.ok($('.command-card'), 'today command card exists')
  assert.ok($('.score-card'), 'daily score card exists')
  window.CC.refreshCurrentView()
  await settle()
  assert.equal($$('.metric-strip .metric').length, 4, 'metrics survive refresh')
  click('.quick-actions-card [data-common="new-task"]')
  await settle()
  assert.ok($('[data-modal-box]'), 'quick action opens mission creation')
  window.CC.closeModal()
  await settle()
})

test('overview shortcuts and mobile dock navigate to the right workspace', () => {
  click('.up-next-card [data-common="schedule"]')
  assert.equal($('#view-schedule').classList.contains('hidden'), false)
  assert.equal($('.nav-item[data-view="schedule"]').getAttribute('aria-current'), 'page')
  click('#mobile-dock [data-view="tasks"]')
  assert.equal($('#view-tasks').classList.contains('hidden'), false)
  assert.equal($('#mobile-dock [data-view="tasks"]').getAttribute('aria-current'), 'page')
  assert.equal($('#mobile-dock [data-view="focus"]').hasAttribute('aria-current'), false)
  click('#mobile-dock [data-view="dashboard"]')
  assert.equal($('#view-dashboard').classList.contains('hidden'), false)
})

test('the original PWA identity is included in the offline shell', async () => {
  const sw = await readFile(path.join(root, 'dist', 'sw.js'), 'utf8')
  for (const icon of ['icons/icon-192.png', 'icons/icon-512.png', 'static/favicon.svg', 'manifest.webmanifest']) {
    const image = await readFile(path.join(root, 'dist', icon))
    assert.ok(image.length > 0, `${icon} is bundled`)
    assert.ok(sw.includes(icon), `${icon} is precached`)
  }
  assert.doesNotMatch(sw, /hero-atmosphere|daylight-studio|fontawesome|fonts\.css/, 'removed artwork/font dependencies are not precached')
})

test('the overview shows the current day and opens the schedule', () => {
  assert.ok($('.date-block .date-day').textContent.trim().length > 0)
  assert.ok($('.command-card h2').textContent.trim().length > 0)
  click('.up-next-card [data-common="schedule"]')
  assert.equal($('#view-schedule').classList.contains('hidden'), false)
  window.CC.switchView('dashboard')
})

test('the design system is bundled for offline use without remote fonts', async () => {
  const css = await readFile(path.join(root, 'dist', 'static', 'style.css'), 'utf8')
  const studio = await readFile(path.join(root, 'dist', 'static', 'studio.css'), 'utf8')
  const sw = await readFile(path.join(root, 'dist', 'sw.js'), 'utf8')
  assert.ok(css.length > 0 && studio.length > 0)
  assert.match(sw, /static\/style\.css/)
  assert.match(sw, /studio\.css/)
  assert.doesNotMatch(css + studio, /@import|url\(['"]?https?:|daylight-studio\.jpg/, 'styles are local and original')
})

test('mobile navigation closes with its accessibility state in sync', () => {
  click('#mobile-menu-btn')
  assert.equal($('#mobile-menu-btn').getAttribute('aria-expanded'), 'true')
  click('#mobile-nav [data-view="tasks"]')
  assert.equal($('#mobile-menu-btn').getAttribute('aria-expanded'), 'false')
  assert.ok($('#mobile-nav').classList.contains('hidden'))
  window.CC.switchView('dashboard')
})

test('task search offers a clear empty state without breaking inbox actions', async () => {
  window.CC.switchView('tasks')
  const search = $('[data-task-search]')
  search.value = 'a task that does not exist'
  search.dispatchEvent(new window.Event('input', { bubbles: true }))
  assert.match($('[data-task-list]').textContent, /No matching missions/)
  assert.match($('[data-task-count]').textContent, /0 missions/)
  search.value = ''
  search.dispatchEvent(new window.Event('input', { bubbles: true }))
  click('[data-f="inbox"]')
  click('[data-task-list] [data-action="quick-capture-inbox"]')
  assert.ok($('#capture-form'), 'empty inbox action opens quick capture')
  assert.equal($('[data-modal-box] [data-capture-dates] .preset-active').dataset.date, 'inbox')
  window.CC.closeModal()
  click('[data-f="today"]')
  window.CC.switchView('dashboard')
})

test('assistant drafts survive a refresh without stealing focus', async () => {
  window.CC.switchView('assistant')
  const input = $('#chat-input')
  input.value = 'A thought I am still writing'
  $('#chat-send-btn').focus()
  window.CC.refreshCurrentView()
  await settle()
  assert.equal($('#chat-input').value, 'A thought I am still writing')
  assert.notEqual(window.document.activeElement, $('#chat-input'))
  window.CC.switchView('dashboard')
})

test('quick capture starts with the right inbox state and traps tab focus', () => {
  window.CC.openQuickCapture({ inbox: true })
  const box = $('[data-modal-box]')
  assert.equal(box.querySelectorAll('[data-capture-dates] .preset-active').length, 1)
  assert.equal(box.querySelector('[data-capture-dates] .preset-active').dataset.date, 'inbox')
  const close = box.querySelector('[data-modal-close]')
  close.focus()
  close.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
  assert.equal(window.document.activeElement.textContent.trim(), 'Add mission')
  window.CC.closeModal()
})

test('keyboard shortcuts do not fire while interacting with a select', async () => {
  window.CC.openTaskModal()
  await settle()
  const select = $('#task-priority')
  select.focus()
  const key = new window.KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true })
  select.dispatchEvent(key)
  assert.equal(key.defaultPrevented, false)
  assert.equal(window.CC.hasRunningSession(), false)
  window.CC.closeModal()
  await settle()
})

test('the daily score card explains its own formula', async () => {
  const scoreCard = $('.score-card')
  assert.ok(scoreCard, 'score card exists')
  assert.match(scoreCard.textContent, /Daily execution score/)
  assert.match(scoreCard.querySelector('.score-ring').getAttribute('aria-label'), /of 100|No score/)
  assert.equal($$('.score-component').length, 4, 'four transparent components')
  assert.match(scoreCard.innerHTML, /Missions.*Priorities.*Focus.*Adherence/s)
  click('[data-score-info]')
  await settle()
  assert.match($('[data-modal-box]').textContent, /nothing hidden|weights|components/i)
  window.CC.closeModal()
  await settle()
})

test('Top 3 can be filled, toggled and limited to three', async () => {
  // create three tasks through quick capture
  for (const title of ['Polity PYQs', 'Geography map practice', 'Current affairs']) {
    window.CC.openQuickCapture()
    await settle()
    const input = $('[data-modal-box] #capture-title')
    input.value = title
    $('[data-modal-box] form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    await settle()
  }
  const tasks = state().tasks.filter((t) => !t.done && t.date)
  assert.ok(tasks.length >= 3, 'tasks were created')

  for (const task of tasks.slice(0, 3)) {
    const result = window.CC.addTaskToTop3(task.id)
    assert.equal(result.ok, true, `added ${task.title}`)
  }
  await settle()
  const top3 = state().top3[window.CC.todayKey()]
  assert.equal(top3.length, 3)
  const fourth = window.CC.addTaskToTop3(tasks[3]?.id || 'nope')
  assert.equal(fourth.ok, false)

  const rows = $$('.priority-card .priority-row')
  assert.equal(rows.length, 3, 'three priority rows rendered')
  click($('.priority-card .priority-row .task-check'))
  await settle()
  assert.match($('#view-dashboard').innerHTML, /1\/3 done|1\/3/, 'completion is tracked')
})

test('today command recommends real work and can start a focus session', async () => {
  const title = $('.command-card h2').textContent.trim()
  assert.ok(title.length > 0)
  assert.ok($('[data-command-start]'), 'there is an actionable item')

  click('[data-command-start]')
  await settle()
  if ($('#view-focus') && !$('#view-focus').classList.contains('hidden') && !$('[data-focus-pause]')) {
    click('[data-room-start]')
    await settle()
  }
  const enter = $('#focus-launch-enter')
  if (enter) {
    click(enter)
    await settle()
  }
  assert.ok($('.focus-overlay'), 'focus overlay opened')
  assert.ok($('.focus-clock'), 'the Focus Core is on screen')
  assert.match($('#focus-phase').textContent, /WARMING UP/, 'a fresh mission starts in the warm-up phase')
})

test('focus session: pause, resume, link a task and complete into analytics', async () => {
  click('[data-focus-pause]')
  await settle()
  assert.ok(state().focus.active.running === false, 'paused state persisted')
  click('[data-focus-resume]')
  await settle()
  assert.equal(state().focus.active.running, true)

  // pretend 15 minutes of genuine focus have passed, then finish the session
  const live = state()
  const active = { ...live.focus.active }
  live.settings.focus.autoCompleteTask = true
  live.focus.active.accumulatedSeconds = 900
  live.focus.active.plannedMinutes = 15
  live.focus.active.lastTickAt = Date.now()
  window.CC.completeFocus()
  await settle()
  assert.equal(state().focus.active, null, 'session finished')
  assert.match($('.focus-celebration')?.textContent || '', /SESSION COMPLETE/, 'completion ends in the ceremony')
  const sessions = state().focus.sessions
  assert.equal(sessions.length, 1)
  assert.equal(sessions[0].focusedSeconds, 900)
  assert.equal(sessions[0].status, 'completed')
  assert.equal(sessions[0].taskId, active.taskId, 'session kept its task link')
  if (active.taskId) {
    const linked = state().tasks.find((t) => t.id === active.taskId)
    assert.equal(linked.done, true, 'finishing a session completes its task (Settings → Focus)')
    assert.ok(linked.completedAt, 'completion is timestamped')
  }
})

test('focus minutes flow into the daily score and progress view', async () => {
  window.CC.switchView('progress')
  await settle()
  const progress = $('#view-progress').textContent
  assert.match(progress, /See how far you’ve come/)
  assert.match(progress, /Focused time/)
  assert.match(progress, /15m/, 'the 15 focused minutes are shown')
  assert.match(progress, /Where your attention went/)
  assert.ok($('#analytics-heatmap').children.length > 0, 'heatmap rendered')
})

test('schedule blocks toggle and update adherence', async () => {
  window.CC.switchView('schedule')
  await settle()
  click('[data-add-block]')
  await settle()
  $('#block-name').value = 'Integration block'
  $('#block-start').value = '12:00'
  $('#block-length').value = '30'
  $('#schedule-block-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
  await settle()
  const firstCheck = $('[data-block-toggle]')
  assert.ok(firstCheck, 'a schedule block exists')
  click(firstCheck)
  await settle()
  const log = state().completionLog[window.CC.todayKey()]
  assert.equal(log.ttDone.length, 1, 'block marked complete')
  click($('[data-block-toggle]'))
  await settle()
  assert.equal(state().completionLog[window.CC.todayKey()].ttDone.length, 0, 'and unmarked again')
})

test('recurring tasks generate occurrences exactly once', async () => {
  window.CC.switchView('tasks')
  await settle()
  click('[data-action="new-task"]')
  await settle()
  const box = '[data-modal-box]'
  $(`${box} #task-title`).value = 'Current Affairs'
  $(`${box} #task-repeat`).value = 'daily'
  $(`${box} #task-date`).value = window.CC.todayKey()
  $(`${box} form`).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
  await settle()
  const templates = state().tasks.filter((t) => t.recurrence && t.id === t.seriesId)
  assert.equal(templates.length, 1, 'exactly one repeating template')
  const template = templates[0]
  assert.equal(template.done, false)
  const occurrences = state().tasks.filter((t) => t.seriesId === template.id)
  assert.ok(occurrences.length >= 3, `upcoming occurrences generated (${occurrences.length})`)
  assert.ok(occurrences.some((t) => t.date > window.CC.todayKey()), 'the series reaches into the future')

  // completing one rolls the series forward without duplicating
  const occurrence = occurrences[0]
  window.CC.switchView('tasks')
  await settle()
  click(`[data-task-toggle="${occurrence.id}"]`)
  await settle()
  const after = state().tasks.filter((t) => t.seriesId === template.id)
  const keys = after.map((t) => `${t.seriesId}|${t.occurrenceDate || t.date}`)
  assert.equal(new Set(keys).size, keys.length, 'no duplicate occurrences')
})

test('weekly review renders real numbers and recommendations', async () => {
  window.CC.openWeeklyReview()
  await settle()
  const review = $('#view-review').textContent
  assert.match(review, /Your weekly review/i)
  assert.match(review, /Focused time/)
  assert.match(review, /Plan follow-through/)
  assert.match(review, /A few things worth noticing/)
  assert.match(review, /strongest day|No activity|Nothing critical|showed up/)
  window.CC.switchView('dashboard')
  await settle()
})

test('recover my day proposes a plan without touching the timetable', async () => {
  const today = window.CC.todayKey()
  const before = JSON.stringify(state().schedule.days[today] || [])
  window.CC.openRecoveryModal({ nowMinutes: 14 * 60 })
  await settle()
  const modal = $('[data-modal-box]')
  assert.match(modal.textContent, /Recover my day|fresh way forward/i)
  assert.match(modal.textContent, /(Mission|Start|Minutes)/)
  assert.equal(JSON.stringify(state().schedule.days[today] || []), before, 'nothing applied until the user confirms')
  const apply = $('[data-apply]')
  if (apply && !apply.disabled) {
    click(apply)
    await settle()
    assert.notEqual(JSON.stringify(state().schedule.days[today] || []), before, 'applying reschedules missed blocks')
  }
  window.CC.closeModal()
})

test('assistant sends the compact context and shows friendly errors', async () => {
  let captured = null
  window.fetch = async (url, options) => {
    captured = { url, body: JSON.parse(options.body) }
    return new Response(JSON.stringify({ error: { message: 'upstream failure' } }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    })
  }
  window.CC.switchView('assistant')
  await settle()
  assert.match($('#view-assistant').textContent, /key stays server-side/)
  assert.equal($$('#view-assistant [data-command]').length, 7, 'all AI commands available')

  window.CC.askAI('Plan my day')
  await settle(120)
  assert.ok(captured, 'the request was made')
  assert.equal(captured.url, '/api/ai')
  assert.ok(captured.body.context.length < 2600, 'context is small')
  assert.ok(!/geminiApiKey/.test(JSON.stringify(captured.body)), 'no browser API key sent')
  assert.match($('#view-assistant').textContent, /having trouble right now/, 'friendly error shown')
  assert.ok(state().chatHistory.some((m) => m.error), 'error recorded in the transcript')
})

test('settings: export → import round-trip and validation', async () => {
  window.CC.switchView('settings')
  await settle()
  const settings = $('#view-settings').textContent
  assert.match(settings, /Assistant/)
  assert.match(settings, /Protected time/)
  assert.match(settings, /Reminders/)
  assert.match(settings, /Export/)

  const backupModule = await import(path.join(root, 'src', 'client', 'lib', 'backup.js'))
  const payload = backupModule.buildExport(state())
  const result = backupModule.validateImport(payload)
  assert.equal(result.ok, true)
  assert.equal(result.state.tasks.length, state().tasks.length)
  const bad = backupModule.validateImport({ hello: 'world' })
  assert.equal(bad.ok, false)

  // import through the UI
  const file = new window.File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' })
  Object.defineProperty(file, 'text', { value: async () => JSON.stringify(payload) })
  const input = $('[data-import]')
  Object.defineProperty(input, 'files', { value: [file] })
  input.dispatchEvent(new window.Event('change', { bubbles: true }))
  await settle(80)
  click('[data-confirm]')
  await settle(80)
  assert.ok(toasts.some((t) => /restored|imported/i.test(t)), `import toast seen (${toasts.join(' | ')})`)
})

test('quick capture works from the keyboard shortcut and files to the inbox', async () => {
  window.CC.switchView('tasks')
  await settle()
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
  await settle()
  assert.ok($('[data-modal-box]'), 'quick capture opened with Ctrl+K')
  $('[data-modal-box] #capture-title').value = 'Revise Fundamental Rights'
  click('[data-modal-box] [data-date="inbox"]')
  $('[data-modal-box] form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
  await settle()
  const captured = state().tasks.find((t) => t.title === 'Revise Fundamental Rights')
  assert.ok(captured)
  assert.equal(captured.inbox, true)
  assert.equal(captured.date, null)
})

test('no uncaught errors were logged during the whole run', () => {
  assert.deepEqual(errors, [], `expected a clean console, got: ${errors.join(' | ')}`)
})
