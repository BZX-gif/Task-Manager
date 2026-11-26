#!/usr/bin/env node
/**
 * The eight worlds, end to end.
 *
 * A scene is not just a CSS class: navigating must change the photograph, the
 * editorial opening and the active navigation item together; every chapter
 * must keep its own working markup; and the shell must be identical on every
 * route. Requires `npm run build` first (npm test does that automatically).
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

let window
let errors = []
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms))

before(async () => {
  const vc = new VirtualConsole()
  vc.on('jsdomError', (e) => errors.push(e.message))
  vc.on('error', (m) => errors.push(String(m)))
  const dom = new JSDOM(shell, { url: 'https://paper.test/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc })
  window = dom.window
  window.fetch = async () => new Response('{"text":"ok"}', { status: 200 })
  window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
  window.scrollTo = () => {}
  window.HTMLCanvasElement.prototype.getContext = () => null

  const today = new Date()
  const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const { emptyState } = await import(path.join(root, 'src/client/lib/state.js'))
  const { DEFAULT_SETTINGS } = await import(path.join(root, 'src/client/lib/defaults.js'))
  const seed = emptyState()
  seed.settings = { ...DEFAULT_SETTINGS, ...seed.settings, userName: 'Asha', salutation: 'Sir', atmosphere: 'auto' }
  seed.tasks = [
    { id: 'w1', title: 'Review the coastal brief', date: key, time: '09:30', priority: 'high', estimateMinutes: 60, done: false, createdAt: Date.now() },
    { id: 'w2', title: 'Prepare the site notes', date: key, priority: 'medium', estimateMinutes: 30, done: true, createdAt: Date.now() },
  ]
  seed.top3 = { [key]: ['w1'] }
  window.localStorage.setItem('kcc_state_v1', JSON.stringify(seed))
  window.eval(bundle)
  await settle(500)
})

after(() => window?.close())

const $ = (sel) => window.document.querySelector(sel)
const $$ = (sel) => [...window.document.querySelectorAll(sel)]
const visit = async (route) => { window.CC.switchView(route); await settle(220); return $(`#view-${route}`) }

test('the shell carries the PAPER identity and the same glass navigation everywhere', () => {
  const navSignature = $$('.sidebar .nav-item[data-view]').map((n) => n.dataset.view).join('|')
  assert.match($('.brand-name').textContent, /paper/i)
  for (const route of ['day', 'missions', 'goals', 'projects', 'calendar', 'focus', 'paper']) {
    window.CC.switchView(route)
    assert.equal($$('.sidebar').length, 1, `${route} keeps one sidebar`)
    assert.equal($$('.topbar').length, 1, `${route} keeps one top bar`)
    assert.equal($$('.sidebar .nav-item[data-view]').map((n) => n.dataset.view).join('|'), navSignature, `${route} keeps the same navigation structure`)
    assert.equal($$('.sidebar .nav-item.active-nav').length, 1, `${route} marks one chapter`)
  }
})

test('each named section paints its own photograph and one active layer', async () => {
  const rooms = {
    day: ['day', 'penthouse-sunrise-sm.webp'],
    tasks: ['missions', 'mountain-workspace-sm.webp'],
    goals: ['goals', 'coastal-villa-sm.webp'],
    projects: ['projects', 'creative-studio-sm.webp'],
    calendar: ['terrace', 'resort-terrace-sm.webp'],
    focus: ['study', 'private-study-night-sm.webp'],
    paper: ['lounge', 'hotel-lounge-morning-sm.webp'],
    rituals: ['garden', 'discipline-garden-sm.webp'],
  }
  const seen = new Set()
  for (const [route, [scene, asset]] of Object.entries(rooms)) {
    await visit(route)
    assert.equal(window.document.documentElement.dataset.scene, scene, `${route} selects ${scene}`)
    const active = $$('#scene .scene-layer.is-active')
    assert.equal(active.length, 1, `${route} has exactly one active photograph`)
    assert.equal(active[0].dataset.sceneLayer, scene)
    assert.match(active[0].getAttribute('style'), new RegExp(asset), `${route} uses its own original file`)
    seen.add(asset)
  }
  assert.equal(seen.size, 8, 'eight different photographs were activated')
})

test('the navigation rail shows the same world in its own glass frame', async () => {
  const rooms = {
    day: ['My Day', 'penthouse-sunrise-sm.webp'],
    tasks: ['Missions', 'mountain-workspace-sm.webp'],
    goals: ['Goals', 'coastal-villa-sm.webp'],
    projects: ['Projects', 'creative-studio-sm.webp'],
    calendar: ['Calendar & Schedule', 'resort-terrace-sm.webp'],
    focus: ['Focus', 'private-study-night-sm.webp'],
    paper: ['Daily Briefing', 'hotel-lounge-morning-sm.webp'],
    rituals: ['Rituals', 'discipline-garden-sm.webp'],
  }
  for (const [route, [name, asset]] of Object.entries(rooms)) {
    await visit(route)
    for (const card of $$('[data-sidebar-room]')) {
      assert.equal(card.querySelector('[data-sidebar-room-name]').textContent, name, `${route} is named in the navigation`)
      assert.match(card.querySelector('[data-sidebar-room-photo]').getAttribute('style'), new RegExp(asset), `${route} is pictured in the navigation`)
      assert.match(card.querySelector('[data-sidebar-room-place]').textContent, /.{12,}/)
    }
  }
  await visit('dashboard')
  const card = $('.sidebar [data-sidebar-room]')
  assert.equal(card.dataset.room, 'villa')
  assert.match(card.querySelector('[data-sidebar-room-name]').textContent, /Command Center/)
  assert.match(card.querySelector('[data-sidebar-room-photo]').getAttribute('style'), /atmosphere-(morning|afternoon|night)-sm\.webp/, 'the villa preview follows the selected hour')
})

test('every chapter has its own editorial opening with figures from real data', async () => {
  for (const route of ['day', 'tasks', 'goals', 'projects', 'calendar', 'focus', 'paper', 'journal', 'rituals']) {
    const section = await visit(route)
    const hero = section.querySelector('.scene-hero')
    assert.ok(hero, `${route} opens with a scene hero`)
    assert.ok(hero.querySelector('.eyebrow'), `${route} has a chapter mark`)
    assert.ok(hero.querySelector('h1')?.textContent.trim(), `${route} has a large title`)
    assert.ok(hero.querySelector('.scene-welcome p')?.textContent.trim().length > 20, `${route} has its own welcome line`)
    assert.ok(hero.querySelector('.scene-place strong'), `${route} names its room`)
    const facts = [...hero.querySelectorAll('.scene-facts dd')].map((n) => n.textContent.trim())
    assert.ok(facts.length >= 2, `${route} shows real figures`)
    for (const fact of facts) assert.ok(/^[\d—–/]/u.test(fact) || /[A-Za-z]/.test(fact), `${route} renders a readable figure`)
  }
})

test('an environment change never takes a working feature with it', async () => {
  const tasks = await visit('tasks')
  assert.ok(tasks.querySelector('[data-task-list]'), 'mission rows still render')
  assert.ok(tasks.querySelector('[data-task-search]'), 'mission search still renders')
  const calendar = await visit('calendar')
  assert.ok(calendar.querySelector('.cal-month, .cal-week, .cal-agenda'), 'the calendar grid still renders')
  await calendar.querySelector('[data-cal-mode="agenda"]')?.click()
  await settle()
  assert.ok($('#view-calendar .cal-agenda'), 'and the agenda mode still works')
  const focus = await visit('focus')
  assert.ok(focus.querySelector('[data-room-mode]'), 'the focus timer is still working')
  const goals = await visit('goals')
  assert.ok(goals.querySelector('[data-goal-filter]'), 'goals still have their filters')
  const projects = await visit('projects')
  assert.ok(projects.querySelector('[data-project-search]'), 'projects still have their search')
  const paper = await visit('paper')
  assert.ok(paper.querySelector('#paper-form'), 'PAPER still has its composer')
})

test('the villa and its time-of-day selector survive untouched', async () => {
  await visit('dashboard')
  assert.equal(window.document.documentElement.dataset.scene, 'villa')
  assert.ok($('#view-dashboard .atmo-hero'), 'the villa hero is still there')
  assert.ok($('.atmo-switch[role="radiogroup"]'), 'the manual atmosphere selector is still there')
  assert.equal($$('#atmosphere .atmo-layer').length, 3, 'three villa photographs remain')
  assert.equal($$('#scene .scene-layer.is-active').length, 0, 'the scene layer yields to the villa')
})

test('no route logs an error while moving between rooms', () => {
  assert.deepEqual(errors, [], `console was not silent:\n  ${errors.slice(0, 5).join('\n  ')}`)
})
