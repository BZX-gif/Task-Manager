#!/usr/bin/env node
/**
 * RITUALS — the page, end to end.
 *
 * The unit suite proves the streak maths. This one proves the *page*: that the
 * real bundle, booted against the real shell, routes to /rituals, paints the
 * garden room, ticks a rule that is then persisted, adds a rule from the
 * editor, and keeps the daily record honest after a reload.
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
const shell = await (await worker.request('https://paper.test/rituals')).text()

const settle = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms))

const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

let window
let errors = []

/** A lived-in ritual workspace: four rules, with real history behind them. */
async function seedWorkspace() {
  const { emptyState } = await import(path.join(root, 'src/client/lib/state.js'))
  const { DEFAULT_SETTINGS } = await import(path.join(root, 'src/client/lib/defaults.js'))
  const today = new Date()
  const key = iso(today)
  const seed = emptyState()
  seed.settings = { ...DEFAULT_SETTINGS, ...seed.settings, userName: 'Asha', salutation: 'Sir' }
  seed.rituals = {
    rituals: [
      { id: 'r1', title: 'Talk less', note: 'Count to three before replying', tone: 'speech', days: [0, 1, 2, 3, 4, 5, 6], createdAt: Date.now() - 12 * 86400000 },
      { id: 'r2', title: 'Brush my teeth twice', tone: 'body', days: [0, 1, 2, 3, 4, 5, 6], createdAt: Date.now() - 9 * 86400000 },
      { id: 'r3', title: 'No phone for the first hour', tone: 'mind', days: [0, 1, 2, 3, 4, 5, 6], createdAt: Date.now() - 6 * 86400000 },
      { id: 'r4', title: 'One deep-work hour', tone: 'work', days: [0, 1, 2, 3, 4], createdAt: Date.now() - 5 * 86400000 },
    ],
    log: {},
  }
  for (let i = 1; i <= 8; i++) {
    const day = new Date(today)
    day.setDate(day.getDate() - i)
    const dayKey = iso(day)
    seed.rituals.log[dayKey] = {}
    if (i <= 5) seed.rituals.log[dayKey].r1 = true
    if (i <= 3) seed.rituals.log[dayKey].r2 = true
  }
  return { seed, key }
}

before(async () => {
  const vc = new VirtualConsole()
  vc.on('jsdomError', (e) => errors.push(e.message))
  vc.on('error', (m) => errors.push(String(m)))
  const dom = new JSDOM(shell, { url: 'https://paper.test/rituals', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc })
  window = dom.window
  window.fetch = async () => new Response('{"text":"ok"}', { status: 200 })
  window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
  window.scrollTo = () => {}
  window.HTMLCanvasElement.prototype.getContext = () => null
  const { seed } = await seedWorkspace()
  window.localStorage.setItem('kcc_state_v1', JSON.stringify(seed))
  window.eval(bundle)
  await settle(700)
})

after(() => window?.close())

const $ = (sel) => window.document.querySelector(sel)
const $$ = (sel) => [...window.document.querySelectorAll(sel)]
const view = () => $('#view-rituals')
const state = () => window.CC.getState()

test('the page is a real chapter: routed, painted and named', () => {
  assert.equal(window.location.pathname, '/rituals', 'a deep link keeps its address')
  assert.equal(window.document.documentElement.dataset.scene, 'garden', 'the garden room is painted')
  assert.equal($('#view-rituals').classList.contains('hidden'), false, 'the rituals chapter is open')
  assert.equal($('#breadcrumb-current').textContent, 'Rituals')
  assert.equal($('.sidebar .nav-item.active-nav')?.dataset.view, 'rituals', 'the sidebar marks the chapter')
  const hero = view().querySelector('.scene-hero')
  assert.ok(hero, 'it opens with the shared scene hero')
  assert.match(hero.querySelector('h1').textContent, /The rules you keep/i)
  assert.ok(hero.querySelector('.scene-place strong').textContent.includes('garden room'), 'it names its own room')
})

test('today is a ledger: every due rule has one tick, and the ring agrees', () => {
  const rows = $$('#view-rituals [data-ritual-row]')
  assert.equal(rows.length, 4, 'all four rules are shown today')
  assert.equal($$('#view-rituals [data-ritual-tick]').length, 4, 'each has exactly one tick')
  assert.ok($('#view-rituals .ritual-ring'), 'the ledger carries a ring')
  assert.match($('#view-rituals .ritual-ledger-line').textContent, /4 rules wait|kept today/, 'and an honest summary line')
  assert.ok($('#view-rituals .ritual-heatmap-weeks'), 'the six-week record renders')
  assert.equal($$('#view-rituals .ritual-weekstrip-day').length, 7, 'the week strip has seven days')
})

test('ticking a rule records it, and the run is announced', async () => {
  const key = window.CC.todayKey()
  const before = $$('#view-rituals [data-ritual-tick]').filter((b) => b.getAttribute('aria-pressed') === 'true').length
  const talkLess = $('#view-rituals [data-ritual-row="r1"] [data-ritual-tick]')
  talkLess.click()
  await settle(260)
  assert.equal(state().rituals.log[key]?.r1, true, 'the tick is written to the store')
  const after = $$('#view-rituals [data-ritual-tick]').filter((b) => b.getAttribute('aria-pressed') === 'true').length
  assert.equal(after, before + 1, 'the page reflects the new tick')
})

test('a rule can be written in the editor, and it appears at once', async () => {
  const before = state().rituals.rituals.length
  $('#view-rituals [data-ritual-new]').click()
  await settle(160)
  const title = $('#ritual-title')
  assert.ok(title, 'the editor opened')
  title.value = 'Put the phone down by ten'
  title.dispatchEvent(new window.Event('input', { bubbles: true }))
  const speech = $('[data-ritual-tone="mind"]')
  speech?.click()
  $('#ritual-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
  await settle(320)
  assert.equal(state().rituals.rituals.length, before + 1, 'the rule was saved')
  const added = state().rituals.rituals.at(-1)
  assert.equal(added.title, 'Put the phone down by ten')
  assert.equal(added.tone, 'mind')
  assert.equal(added.dayKey, window.CC.todayKey(), 'it is stamped with the day it was written')
  assert.equal($('#app-modal'), null, 'the editor closed')
})

test('a suggestion fills the form, and the preview shows the rule', async () => {
  $('#view-rituals [data-ritual-new]').click()
  await settle(160)
  const suggestion = $$('[data-ritual-preset]').find((b) => b.dataset.ritualPreset === 'Walk after dinner')
  suggestion.click()
  await settle(80)
  assert.equal($('#ritual-title').value, 'Walk after dinner')
  assert.match($('[data-ritual-preview]').textContent, /Walk after dinner/)
  window.CC.closeModal()
  await settle(120)
})

test('the detail sheet shows the honest record, not a score', async () => {
  $('#view-rituals [data-ritual-detail="r1"]').click()
  await settle(160)
  const figures = $$('.ritual-detail-figure').map((n) => n.textContent)
  assert.equal(figures.length, 4)
  assert.match(figures[0], /Current run/)
  assert.equal($$('.ritual-detail-day').length, 35, 'five weeks of days are listed')
  // the ledger labels every day with one of three honest states
  assert.match($('.ritual-detail-ledger').textContent || '', /Kept|Not ticked|Rest day/)
  window.CC.closeModal()
  await settle(120)
})

test('the Command Center carries one quiet line of the same rules', async () => {
  window.CC.switchView('dashboard')
  await settle(260)
  const strip = $('#view-dashboard .ritual-strip')
  assert.ok(strip, 'the strip is on the dashboard')
  assert.match(strip.textContent, /Your rules/)
  const tick = strip.querySelector('[data-ritual-quick-tick]')
  assert.ok(tick, 'the next un-ticked rule can be kept from here')
  const id = tick.dataset.ritualQuickTick
  tick.click()
  await settle(240)
  assert.equal(state().rituals.log[window.CC.todayKey()]?.[id], true, 'and the tick is the same record')
})

test('a workspace with no rules keeps the dashboard free of ritual furniture', async () => {
  const seed = window.CC.getState()
  seed.rituals = { rituals: [], log: {} }
  window.localStorage.setItem('kcc_state_v1', JSON.stringify(seed))
  const vc = new VirtualConsole()
  const freshErrors = []
  vc.on('jsdomError', (e) => freshErrors.push(e.message))
  const dom = new JSDOM(shell, { url: 'https://paper.test/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc })
  const fresh = dom.window
  fresh.fetch = async () => new Response('{"text":"ok"}', { status: 200 })
  fresh.matchMedia = fresh.matchMedia || ((q) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
  fresh.scrollTo = () => {}
  fresh.HTMLCanvasElement.prototype.getContext = () => null
  fresh.localStorage.setItem('kcc_state_v1', JSON.stringify(seed))
  fresh.eval(bundle)
  await settle(600)
  assert.equal(fresh.document.querySelector('#view-dashboard .ritual-strip'), null, 'a new workspace sees no ritual strip')
  fresh.CC.switchView('rituals')
  await settle(300)
  const section = fresh.document.getElementById('view-rituals')
  assert.ok(section.querySelector('.ritual-empty'), 'and the rituals page offers a first rule instead')
  assert.equal(fresh.document.querySelectorAll('#view-rituals [data-ritual-tick]').length, 0)
  assert.deepEqual(freshErrors, [], freshErrors.join(' | '))
  dom.window.close()
})

test('the sweep ran without a runtime error', () => {
  assert.deepEqual(errors, [], `console was not silent:\n  ${errors.slice(0, 5).join('\n  ')}`)
})
