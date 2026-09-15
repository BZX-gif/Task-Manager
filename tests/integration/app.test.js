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
  const shellAssets = ['static/js/app.js', 'static/tailwind.css', 'static/style.css', 'static/favicon.svg', 'manifest.webmanifest', 'icons/apple-touch-icon.png']
  const optionalAssets = ['sw.js', 'static/vendor/fontawesome/css/all.min.css', 'icons/apple-touch-icon.png', 'static/fonts.css', 'static/fonts/sora-latin-700.woff2']
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
  assert.doesNotMatch(html, /fonts\.googleapis\.com/, 'fonts are self-hosted')
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
  assert.match(window.document.getElementById('greeting-text').textContent, /Kulshresth/)
  const seeded = state()
  assert.ok(seeded.timetable.length >= 10, 'the default timetable is present')
  assert.equal(seeded.version, 2)
})

test('the daily score card explains its own formula', async () => {
  const scoreCard = $('[data-card="score"]')
  assert.ok(scoreCard, 'score card exists')
  assert.match(scoreCard.textContent, /Today's Score/)
  assert.match(scoreCard.textContent, /\/100/)
  assert.equal($$('[data-score-parts] .score-part').length, 4, 'four transparent components')
  assert.match(scoreCard.innerHTML, /Tasks .*Top 3 .*Focus .*Schedule/s)
})

test('Top 3 can be filled, toggled and limited to three', async () => {
  // create three tasks through quick capture
  for (const title of ['Polity PYQs', 'Geography map practice', 'Current affairs']) {
    click('#quick-add-btn')
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

  const rows = $$('.top3-row')
  assert.equal(rows.length, 3, 'three priority rows rendered')
  click($('.top3-row .task-check'))
  await settle()
  assert.match($('#view-dashboard').innerHTML, /1\/3 done|1\/3/, 'completion is tracked')
})

test('"Do this now" recommends a real task and can start a focus session', async () => {
  const title = $('[data-next-title]').textContent.trim()
  assert.ok(title.length > 0)
  assert.notEqual(title, 'Everything planned is done', 'there is an actionable item')

  click('[data-next-start]')
  await settle()
  const isPicker = !!$('[data-modal-box]')
  if (isPicker) {
    click($('[data-modal-box] [data-start-min]'))
    await settle()
  }
  assert.ok($('.focus-overlay'), 'focus overlay opened')
  assert.match($('.focus-overlay').textContent, /Focus Mode/)
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
  live.focus.active.accumulatedSeconds = 900
  live.focus.active.plannedMinutes = 15
  live.focus.active.lastTickAt = Date.now()
  window.CC.completeFocus()
  await settle()
  assert.equal(state().focus.active, null, 'session finished')
  const sessions = state().focus.sessions
  assert.equal(sessions.length, 1)
  assert.equal(sessions[0].focusedSeconds, 900)
  assert.equal(sessions[0].status, 'completed')
  assert.equal(sessions[0].taskId, active.taskId, 'session kept its task link')
})

test('focus minutes flow into the daily score and progress view', async () => {
  window.CC.switchView('progress')
  await settle()
  const progress = $('#view-progress').textContent
  assert.match(progress, /Progress Analytics/)
  assert.match(progress, /Focused time/)
  assert.match(progress, /15m/, 'the 15 focused minutes are shown')
  assert.match(progress, /Category breakdown/)
  assert.ok($('#progress-heatmap').children.length > 0, 'heatmap rendered')
})

test('timetable blocks toggle and update adherence', async () => {
  window.CC.switchView('timetable')
  await settle()
  const firstCheck = $('.tt-row .task-check')
  assert.ok(firstCheck, 'a timetable row exists')
  click(firstCheck)
  await settle()
  const log = state().completionLog[window.CC.todayKey()]
  assert.equal(log.ttDone.length, 1, 'block marked complete')
  click($('.tt-row .task-check'))
  await settle()
  assert.equal(state().completionLog[window.CC.todayKey()].ttDone.length, 0, 'and unmarked again')
})

test('recurring tasks generate occurrences exactly once', async () => {
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

test('weekly review modal renders real numbers and recommendations', async () => {
  window.CC.switchView('dashboard')
  await settle()
  window.CC.openWeeklyReview()
  await settle()
  const modal = $('[data-modal-box]').textContent
  assert.match(modal, /Weekly Review/)
  assert.match(modal, /Focused/)
  assert.match(modal, /Completion/)
  assert.match(modal, /Recommendations/)
  assert.match(modal, /Best day|Not enough data/)
  window.CC.closeModal()
  await settle()
  assert.equal($('[data-modal-box]'), null, 'modal closed')
})

test('recover my day proposes a plan without touching the timetable', async () => {
  const before = JSON.stringify(state().timetable)
  window.CC.openRecoveryModal({ nowMinutes: 14 * 60 })
  await settle()
  const modal = $('[data-modal-box]')
  assert.match(modal.textContent, /Recover My Day/)
  assert.match(modal.textContent, /(Missed|Free time left)/)
  assert.equal(JSON.stringify(state().timetable), before, 'nothing applied until the user confirms')
  const apply = $('[data-apply]')
  if (apply && !apply.disabled) {
    click(apply)
    await settle()
    assert.notEqual(JSON.stringify(state().timetable), before, 'applying reschedules missed blocks')
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
  assert.match(settings, /Gemini Assistant/)
  assert.match(settings, /Protected Time/)
  assert.match(settings, /Reminders/)
  assert.match(settings, /Export JSON/)

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
  assert.ok(toasts.some((t) => /imported/i.test(t)), `import toast seen (${toasts.join(' | ')})`)
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
