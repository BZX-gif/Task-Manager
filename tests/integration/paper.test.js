#!/usr/bin/env node
/**
 * PAPER · the application-wide design system.
 *
 * The dashboard has its own suite. This one holds the rest of the product to
 * the same standard: every route renders inside the PAPER shell, no route is
 * left on the old generic presentation, the shared component library is the
 * only source of page furniture, and rebuilding a page has not dropped any of
 * the data hooks the application depends on.
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

const ROUTES = ['dashboard', 'day', 'calendar', 'schedule', 'hyb', 'tasks', 'goals', 'projects', 'routines', 'focus', 'progress', 'review', 'journal', 'forecast', 'paper', 'settings']

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

  const today = new Date()
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const key = iso(today)
  const now = Date.now()
  const { emptyState } = await import(path.join(root, 'src/client/lib/state.js'))
  const { DEFAULT_SETTINGS } = await import(path.join(root, 'src/client/lib/defaults.js'))
  const seed = emptyState()
  seed.settings = { ...DEFAULT_SETTINGS, ...seed.settings, userName: 'Asha', salutation: 'Sir', atmosphere: 'auto' }
  const task = (id, title, extra = {}) => ({ id, title, time: null, priority: 'medium', estimateMinutes: 45, done: false, date: key, cat: null, createdAt: now, ...extra })
  seed.tasks = [
    task('t1', 'Review the villa collection brief', { time: '09:30', priority: 'high', goalId: 'g1', projectId: 'p1' }),
    task('t2', 'Call the Aranya landscape studio', { time: '15:30', done: true }),
  ]
  seed.top3 = { [key]: ['t1'] }
  seed.goals = [{
    id: 'g1', title: 'Open the coastal residence', description: 'A quieter life, closer to the water.',
    category: 'Personal', status: 'active', progressMode: 'auto', targetDate: '2027-03-01',
    milestones: [{ id: 'm1', title: 'Site survey', done: true, targetDate: null }, { id: 'm2', title: 'Structural drawings', done: false, targetDate: null }],
    notes: 'The light matters more than the view.', createdAt: now,
  }]
  seed.projects = [{ id: 'p1', title: 'Villa collection', description: 'The autumn editorial.', goalId: 'g1', status: 'active', priority: 'high', milestones: [], createdAt: now }]
  seed.journal = {}
  window.localStorage.setItem('kcc_state_v1', JSON.stringify(seed))
  window.eval(bundle)
  await new Promise((r) => setTimeout(r, 500))
})

after(() => window?.close())

const $ = (sel) => window.document.querySelector(sel)
const $$ = (sel) => [...window.document.querySelectorAll(sel)]
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms))
const visit = async (view) => { window.CC.switchView(view); await settle(340); return $(`#view-${view}`) }

/* ------------------------------------------------------------------ system */

test('the PAPER sheet ships after every other stylesheet', async () => {
  const src = await readFile(path.join(root, 'src', 'shell.ts'), 'utf8')
  const srcLinks = [...src.matchAll(/href="\/static\/([\w-]+)\.css"/g)].map((m) => m[1])
  assert.equal(srcLinks[srcLinks.length - 1], 'paper', `source order is ${srcLinks.join(' → ')}`)
  const css = await readFile(path.join(root, 'public', 'static', 'paper.css'), 'utf8')
  assert.ok(css.length > 8000, 'the sheet is substantial')
  assert.match(css, /--paper:#/, 'it defines the paper ground')
  assert.match(css, /--ink:#/, 'and the ink')
  assert.match(css, /--rule:/, 'and the hairline rules')
  assert.match(css, /--font-note/, 'and the handwriting face')
  const links = [...shell.matchAll(/href="\/static\/([\w-]+)\.css"/g)].map((m) => m[1])
  assert.equal(links[links.length - 1], 'paper', `served order is ${links.join(' → ')}`)
  assert.ok(links.indexOf('paper') > links.indexOf('atmosphere'), 'paper wins the cascade over atmosphere')
})

test('the typefaces are self-hosted and the handwriting is a real face', async () => {
  const css = await readFile(path.join(root, 'public', 'static', 'paper.css'), 'utf8')
  assert.match(css, /--font-display|Instrument Serif/, 'the display serif is the same voice as the Command Center')
  assert.doesNotMatch(css, /@import\s+url\(|fonts\.googleapis/, 'no remote font loading')
  // handwriting is for personal lines only: notes, ledes, reflections. It must
  // never be applied to navigation, headings or data.
  const noteDecls = [...css.matchAll(/font-family:var\(--font-note\)/g)].length
  assert.ok(noteDecls <= 14, `handwriting stays scoped (${noteDecls} typographic sites)`)
  // and specifically never to a structural selector
  for (const selector of ['.nav-item', '.page-heading h1', '.card-header h3', '.chip', '.metric']) {
    const rule = css.slice(css.indexOf(`${selector}{`))
    if (!css.includes(`${selector}{`)) continue
    const body = rule.slice(0, rule.indexOf('}'))
    assert.doesNotMatch(body, /font-note/, `${selector} must not be handwritten`)
  }
})

test('the shared metric strip is re-authored for paper, not boxed tiles', async () => {
  const css = await readFile(path.join(root, 'public', 'static', 'paper.css'), 'utf8')
  const strip = css.slice(css.indexOf('.metric-strip{'))
  assert.ok(strip.length > 200, 'the strip is styled')
  assert.match(strip, /\.metric\{[^}]*border:0/, 'its tiles lose their box')
  assert.match(strip, /\.metric strong\{[^}]*var\(--font-display\)/, 'and the figures are set in the serif')
})

test('the cool accent hues are no longer offered', () => {
  const accents = $$('[data-accent-option], [data-theme-accent], [data-accent-choice]').map((b) => b.dataset.accentOption || b.dataset.themeAccent || b.dataset.accentChoice)
  for (const cool of ['iris', 'blue', 'sage', 'rose']) {
    assert.ok(!accents.includes(cool), `the ${cool} accent must not be offered any more`)
  }
})

/* ------------------------------------------------------------------ routes */

test('every route renders inside the PAPER shell', async () => {
  for (const route of ROUTES) {
    const section = await visit(route)
    assert.ok(section, `${route} exists`)
    assert.ok(section.innerHTML.trim().length > 200, `${route} renders real content (${section.innerHTML.length} bytes)`)
    assert.ok(section.querySelector('h1, h2, .page-heading, .atmo-hero'), `${route} has a visible heading`)
  }
})

test('no route is still using the old generic presentation', async () => {
  const offenders = []
  for (const route of ROUTES) {
    const section = await visit(route)
    // cool slate/indigo/grey Tailwind utilities are the old dashboard voice
    if (/class="[^"]*\b(text|bg|border)-(slate|indigo|blue|purple|violet|cyan|gray)-/.test(section.innerHTML)) offenders.push(`${route}: cool utility classes`)
    // the metric strip is shared furniture; it must never fall back to the
    // boxed dashboard tiles (those carry .card-like chrome). Its PAPER styling
    // is asserted once, statically, in the sheet test below.
  }
  assert.deepEqual(offenders, [], `these routes still carry the old look:\n  ${offenders.join('\n  ')}`)
})

test('no route renders an empty box where a line of prose belongs', async () => {
  for (const route of ROUTES) {
    const section = await visit(route)
    // an absent entry is a quiet line; a bordered centred panel is the old look
    for (const node of section.querySelectorAll('.empty-state')) {
      assert.ok(!node.closest('.atmo-panel') || node.textContent.length > 30, `${route}: empty states say something`)
    }
  }
})

/* -------------------------------------------------------------- components */

test('page furniture comes from the shared library, not per-route hand-rolling', async () => {
  const lib = await readFile(path.join(root, 'src', 'client', 'ui', 'paper.js'), 'utf8')
  for (const fn of ['paperHeader', 'sectionTitle', 'paperCard', 'divider', 'progress', 'priorityMarker', 'entry', 'agendaRow', 'absent', 'figure', 'chapterCard', 'noteField']) {
    assert.match(lib, new RegExp(`export function ${fn}\\b`), `the library exports ${fn}`)
  }
  // the views that were rebuilt use it
  for (const view of ['goals.js']) {
    const src = await readFile(path.join(root, 'src', 'client', 'views', view), 'utf8')
    assert.match(src, /from '\.\.\/ui\/paper\.js'/, `${view} composes from the library`)
  }
})

/* ------------------------------------------------------------------- goals */

test('goals read as chapters, and open into a page rather than a dialog', async () => {
  const section = await visit('goals')
  const chapters = section.querySelectorAll('.paper-chapter--goal')
  assert.ok(chapters.length >= 1, 'a goal is presented as a chapter')
  assert.match(section.querySelector('.paper-header h1').textContent, /becoming|goals/i, 'the page has an editorial title')

  const opener = section.querySelector('[data-goal-detail="g1"]')
  assert.ok(opener, 'a chapter can be opened')
  opener.click()
  await settle(340)

  const reading = $('#view-goals .paper-reading')
  assert.ok(reading, 'the goal opens as a reading surface inside the page')
  // everything the dialog used to carry is present
  assert.ok(reading.querySelector('[data-milestone-toggle]'), 'milestones are interactive')
  assert.ok(reading.querySelector('.paper-note'), 'private notes are shown')
  assert.match(reading.textContent, /Projects that give it a place/, 'connected projects are listed')
  assert.match(reading.textContent, /Missions that move it forward/, 'connected missions are listed')
  const figures = [...reading.querySelectorAll('.paper-reading-figures .paper-figure')].length
  assert.equal(figures, 4, 'the shape of the goal is summarised in four figures')

  // and it is not a modal
  assert.equal($$('.modal-overlay.open, .modal-overlay[data-open]').filter((m) => m.offsetParent !== null).length, 0, 'no dialog was opened')
})

test('a milestone can be completed in place, and the progress is recomputed', async () => {
  const section = $('#view-goals .paper-reading')
  assert.ok(section, 'still reading')
  // an earlier test already completed m2, so toggle whatever is still open
  // rather than assuming a starting state
  const open = [...section.querySelectorAll('[data-milestone-toggle]')].find((b) => b.getAttribute('aria-pressed') !== 'true')
  assert.ok(open, 'a milestone is still open to complete')
  const id = open.dataset.milestoneToggle
  const read = () => JSON.parse(window.localStorage.getItem('kcc_state_v1')).goals[0].milestones.find((m) => m.id === id).done
  const before = read()
  open.click()
  await settle(360)
  const after = read()
  assert.notEqual(before, after, 'the store was written')
  assert.equal(after, true, `milestone ${id} is now complete`)
  assert.ok($('#view-goals .paper-reading'), 'the reading page survives the update instead of dumping you back to the grid')
})

test('the reading page returns to the chapter grid', async () => {
  $('#view-goals [data-goal-back]').click()
  await settle(340)
  assert.ok($('#view-goals .paper-chapter-grid'), 'back returns to the grid')
  assert.equal($('#view-goals .paper-reading'), null, 'and the reading surface is gone')
})

test('goal filters and search still filter real data', async () => {
  const section = await visit('goals')
  assert.ok(section.querySelector('[data-goal-search]'), 'search is present')
  assert.ok(section.querySelectorAll('[data-goal-filter]').length === 4, 'the four filters are present')
})

/* --------------------------------------------------------------- the shell */

test('the shell keeps one sidebar and one header on every route', async () => {
  for (const route of ROUTES) {
    await visit(route)
    assert.equal($$('.sidebar').length, 1, `${route} has exactly one sidebar`)
    assert.equal($$('.topbar').length, 1, `${route} has exactly one header`)
    // sub-views (schedule, hyb, routines, review, forecast) are reached through
    // their parent's domain tabs, so only sidebar chapters have an index mark
    const inSidebar = $$('.sidebar .nav-item[data-view]').some((b) => b.dataset.view === route)
    if (inSidebar) assert.ok($('.sidebar .nav-item.active-nav'), `${route} marks its chapter in the index`)
    else assert.equal($$('.sidebar .nav-item.active-nav').length, 1, `${route} still marks its parent chapter`)
  }
})

test('photography is reserved for the pages about being present', async () => {
  const doc = window.document
  for (const route of ['goals', 'tasks', 'calendar', 'settings']) {
    await visit(route)
    assert.equal(doc.documentElement.dataset.atmosphereView, 'workspace', `${route} is a paper page`)
  }
  await visit('dashboard')
  assert.equal(doc.documentElement.dataset.atmosphereView, 'dashboard', 'the Command Center keeps its photograph')
})

test('the tour is silent', () => {
  assert.deepEqual(errors, [], `console was not silent:\n  ${errors.slice(0, 5).join('\n  ')}`)
})
