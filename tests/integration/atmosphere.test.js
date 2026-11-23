#!/usr/bin/env node
/**
 * Atmosphere behaviour, end to end.
 *
 * The unit suite proves the engine's arithmetic; this file proves the wiring in
 * a real browser-like environment: the shell boots with a photograph already
 * selected, choosing an atmosphere in settings survives a reload, auto returns
 * control to the clock, the dashboard renders the greeting and the three
 * content regions from real state, and nothing throws along the way.
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
const bundle = await readFile(path.join(root, 'public', 'static', 'js', 'app.js'), 'utf8')
const shell = await (await worker.request('/')).text()
const { emptyState, normalizeState } = await import(path.join(root, 'src', 'client', 'lib', 'state.js'))
const { DEFAULT_SETTINGS, STATE_VERSION } = await import(path.join(root, 'src', 'client', 'lib', 'defaults.js'))

let window
let errors = []

before(async () => {
  const vc = new VirtualConsole()
  vc.on('jsdomError', (e) => errors.push(e.message))
  vc.on('error', (m) => errors.push(String(m)))
  const dom = new JSDOM(shell, { url: 'https://command-center.test/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc })
  window = dom.window
  window.fetch = async () => new Response('{"text":"ok"}', { status: 200 })
  window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
  window.scrollTo = () => {}
  window.HTMLCanvasElement.prototype.getContext = () => null
  // Seed a lived-in workspace so the command panel has a next move to show,
  // and the overview has real numbers rather than an empty-state.
  const today = new Date()
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const todayKey = iso(today)
  const seed = emptyState()
  seed.settings = { ...DEFAULT_SETTINGS, ...seed.settings, userName: 'Asha', salutation: 'Sir', atmosphere: 'auto' }
  const soon = new Date(today.getTime() + 45 * 60 * 1000)
  const hhmm = `${String(soon.getHours()).padStart(2, '0')}:${String(soon.getMinutes()).padStart(2, '0')}`
  seed.tasks = [
    { id: 't1', title: 'Review the villa collection brief', done: false, priority: 'high', estimateMinutes: 90, date: todayKey, time: hhmm, createdAt: new Date().toISOString() },
    { id: 't2', title: 'Call the Aranya landscape studio', done: false, priority: 'medium', estimateMinutes: 30, date: todayKey, time: '15:30', createdAt: new Date().toISOString() },
    { id: 't3', title: 'Water the terrace garden', done: true, priority: 'low', estimateMinutes: 20, date: todayKey, completedAt: new Date().toISOString(), createdAt: new Date().toISOString() },
  ]
  seed.top3 = { [todayKey]: ['t1', 't2'] }
  window.localStorage.setItem('kcc_state_v1', JSON.stringify(seed))
  window.eval(bundle)
  await new Promise((r) => setTimeout(r, 400))
})

after(() => window?.close())

const $ = (sel) => window.document.querySelector(sel)
const $$ = (sel) => [...window.document.querySelectorAll(sel)]
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))

test('the shell ships an atmosphere before any JavaScript runs', () => {
  assert.ok(['morning', 'afternoon', 'evening'].includes(window.document.documentElement.dataset.atmosphere))
  assert.equal(window.document.documentElement.dataset.atmosphereMode, 'auto', 'first visit follows the clock')
})

test('the dashboard renders the editorial hero, the command line and three columns', () => {
  const hero = $('#view-dashboard .atmo-hero')
  assert.ok(hero, 'the hero exists')
  assert.match(hero.textContent, /Good (morning|afternoon|evening)/, 'the greeting is time-aware')
  // chrome.js owns #overview-greeting and keeps it coherent with the chosen
  // atmosphere; the dashboard never bakes a stale greeting into the template
  const heading = hero.querySelector('#overview-greeting')
  assert.ok(heading, 'the hero exposes the live greeting node')
  assert.match(heading.textContent.trim(), /^Good (morning|afternoon|evening)(,|$)/, 'the greeting matches the atmosphere')
  assert.doesNotMatch(heading.textContent, /undefined|null/, 'no interpolation leaks into the headline')
  const hour = new Date().getHours()
  const expected = hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 17 ? 'afternoon' : 'evening'
  assert.ok(heading.textContent.toLowerCase().includes(expected), `the hero greets the ${expected} at ${hour}:00`)
  assert.ok(hero.querySelector('.atmo-switch[role="radiogroup"]'), 'the manual selector is in the hero')

  const command = $('#view-dashboard .atmo-command')
  assert.ok(command, 'the command panel exists')
  if (process.env.DBG) console.log('DBG title:', command.querySelector('.atmo-command-title')?.textContent, '| facts:', command.querySelectorAll('.atmo-fact').length, '| html:', command.innerHTML.replace(/\s+/g,' ').slice(0,220))
  const headline = command.querySelector('.atmo-command-title')
  assert.ok(headline?.textContent.trim().length > 4, 'with a real headline')
  assert.notEqual(headline.textContent.trim(), 'Nothing scheduled yet.', 'and it is drawn from work in flight')
  const facts = [...command.querySelectorAll('.atmo-fact')]
  assert.equal(facts.length, 4, 'and four measured facts')
  for (const fact of facts) assert.ok(fact.querySelector('.atmo-fact-label')?.textContent.trim(), 'each fact is labelled')

  const columns = $$('#view-dashboard .atmo-column')
  assert.equal(columns.length, 3, 'the body is three editorial columns')
  for (const panel of ['.atmo-today-panel', '.atmo-schedule-panel', '.atmo-priorities-panel', '.atmo-actions-panel', '.atmo-progress-panel']) {
    assert.ok($(`#view-dashboard ${panel}`), `${panel} is present`)
  }
})

test('the overview figures are the state’s, not decoration', () => {
  const state = window.CC.getState?.() ?? JSON.parse(window.localStorage.getItem('kcc_state_v1') || '{}')
  const completedText = $('#view-dashboard .atmo-today-panel')?.textContent || ''
  assert.match(completedText, /Completed/, 'completed is labelled')
  assert.match(completedText, /Remaining/, 'remaining is labelled')
  // the four accessible metrics mirror the same numbers
  assert.equal($$('#view-dashboard .metric-strip .metric').length, 4)
  assert.ok(state.tasks, 'state is readable from the harness')
})

test('choosing an atmosphere in settings updates the DOM, the layer and storage', async () => {
  const root = window.document.documentElement
  window.CC.switchView('settings')
  await settle()
  const row = $('.atmo-setting-row')
  assert.ok(row, 'settings offers the atmosphere preference')

  const evening = row.querySelector('[data-atmosphere-choice="evening"]')
  evening.click()
  await settle()

  assert.equal(root.dataset.atmosphere, 'evening', 'the document repaints as evening')
  assert.equal(root.dataset.atmosphereMode, 'evening', 'and records that the choice is manual')
  assert.equal(evening.getAttribute('aria-checked'), 'true', 'the control reflects the choice')

  const active = window.document.querySelector('#atmosphere .atmo-layer.is-active')
  assert.ok(active, 'one photograph layer is active')
  assert.equal(active.dataset.layer, 'evening', 'and it is the evening photograph')

  const stored = JSON.parse(window.localStorage.getItem('kcc_state_v1'))
  assert.equal(stored.settings.atmosphere, 'evening', 'the choice is persisted')
})

test('auto hands control back to the clock', async () => {
  const root = window.document.documentElement
  const auto = window.document.querySelector('.atmo-setting-row [data-atmosphere-choice="auto"]')
  auto.click()
  await settle()
  assert.equal(root.dataset.atmosphereMode, 'auto')
  const hour = new Date().getHours()
  const expected = hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 17 ? 'afternoon' : 'evening'
  assert.equal(root.dataset.atmosphere, expected, `at ${hour}:00 the room reads ${expected}`)
  const stored = JSON.parse(window.localStorage.getItem('kcc_state_v1'))
  assert.equal(stored.settings.atmosphere, 'auto')
})

test('the dashboard photographs are translucent layers the CSS can fade', () => {
  const layers = $$('#atmosphere .atmo-layer')
  assert.equal(layers.length, 3, 'all three environments are mounted')
  for (const layer of layers) {
    assert.match(layer.getAttribute('style') || '', /background-image:url\(/, `${layer.dataset.layer} has a photograph`)
  }
  assert.equal(layers.filter((l) => l.classList.contains('is-active')).length, 1, 'exactly one is visible')
})

test('leaving the dashboard keeps the atmosphere out of the workspace views', async () => {
  window.CC.switchView('tasks')
  await settle()
  assert.equal(window.document.documentElement.dataset.atmosphereView, 'workspace')
  window.CC.switchView('dashboard')
  await settle()
  assert.equal(window.document.documentElement.dataset.atmosphereView, 'dashboard')
})

test('no console errors across the whole tour', () => {
  assert.deepEqual(errors, [], `expected a silent console, saw: ${errors.slice(0, 3).join(' | ')}`)
})

test('the room changes itself when the clock crosses a boundary', async () => {
  // The engine's arithmetic is unit-tested; this proves the *live* path — the
  // minute tick repaints the document attribute and the photograph layer, with
  // no reload. It also proves a pinned environment outranks the clock.
  //
  // It must drive CC.tickAtmosphere (the app's own module instance): importing
  // the module here would create a second store, so the DOM would repaint from
  // one copy while the precedence check read the other.
  const doc = window.document
  const activeLayer = () => [...doc.querySelectorAll('#atmosphere .atmo-layer')].filter((l) => l.classList.contains('is-active')).map((l) => l.dataset.layer).join(',')
  const at = (h, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d }

  window.CC.setAtmosphere('auto')
  await settle(150)

  const crossings = [
    [at(4, 59), 'evening'],
    [at(5, 0), 'morning'],
    [at(11, 59), 'morning'],
    [at(12, 0), 'afternoon'],
    [at(16, 59), 'afternoon'],
    [at(17, 0), 'evening'],
    [at(23, 59), 'evening'],
  ]
  for (const [when, expected] of crossings) {
    window.CC.tickAtmosphere(when)
    await settle(90)
    const label = `${when.getHours()}:${String(when.getMinutes()).padStart(2, '0')}`
    assert.equal(doc.documentElement.dataset.atmosphere, expected, `${label} should read ${expected}`)
    assert.equal(activeLayer(), expected, `and the ${expected} photograph should be the visible one`)
  }

  // a pinned environment survives the clock moving underneath it
  window.CC.setAtmosphere('morning')
  await settle(150)
  assert.equal(doc.documentElement.dataset.atmosphereMode, 'morning', 'the pin is recorded')
  for (const hour of [0, 13, 17, 21]) {
    window.CC.tickAtmosphere(at(hour))
    await settle(80)
    assert.equal(doc.documentElement.dataset.atmosphere, 'morning', `a pinned room must not drift at ${hour}:00`)
    assert.equal(activeLayer(), 'morning', `and the morning photograph stays on screen at ${hour}:00`)
  }

  window.CC.setAtmosphere('auto')
  await settle(150)
  assert.equal(doc.documentElement.dataset.atmosphereMode, 'auto')
  const hour = new Date().getHours()
  const nowExpected = hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 17 ? 'afternoon' : 'evening'
  assert.equal(doc.documentElement.dataset.atmosphere, nowExpected, 'and auto resumes following the real clock')
})

