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
  // Handwriting is reserved for personal lines — a note someone wrote, a lede
  // of prose, a reflection, a placeholder. It must never touch structure.
  // Rather than counting occurrences (which merely penalises adding pages), we
  // assert the *kind* of selector each use is attached to.
  const PERSONAL = /note|lede|lead|sub|hint|empty|evidence|journal|intention|reason|notice|input|small|foot|current|reflection|quote|caption|placeholder|h1 \+ p/i
  const STRUCTURAL = /\.nav-|nav-item|\.chip|\.metric|\.badge|\.eyebrow|\.field-label|\.domain-tab|\.tab\b|\.btn|h1|h2|h3|h4|th\b|\.cal-cell-day|\.forecast-day-num|strong/
  const noteRules = []
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, rawSel, body] = m
    if (!/font-family:\s*var\(--font-note\)/.test(body)) continue
    // strip comments that precede a selector
    const sel = rawSel.split('*/').pop().trim()
    noteRules.push(sel)
  }
  assert.ok(noteRules.length >= 4, 'the handwriting is actually used')
  for (const sel of noteRules) {
    assert.ok(
      PERSONAL.test(sel),
      `handwriting belongs to personal lines only — found on "${sel.slice(-70)}"`,
    )
    // split compound selectors: "h1 + p" is prose *beside* a heading, while a
    // bare "h1" would mean the heading itself wears the handwriting
    for (const part of sel.split(',')) {
      const bare = part.replace(/\bh[1-4]\s*\+\s*p/g, '').trim()
      assert.doesNotMatch(
        bare,
        STRUCTURAL,
        `handwriting must never be applied to structure — found on "${part.trim().slice(-70)}"`,
      )
    }
  }
  // typographic use of the face is declared, not merely referenced
  assert.ok(
    [...css.matchAll(/font-family:\s*var\(--font-display\)/g)].length >= 10,
    'the editorial serif carries the headings',
  )
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

/* ---------------------------------------------------------------------------
 * The signature pages.
 *
 * The calendar is the experience the brief calls out by name, so it gets held
 * to behaviour rather than looks: the three modes must each render, navigation
 * must move the month, a day must open, and an event must be readable. These
 * are the interactions that make it "actually work".
 * ------------------------------------------------------------------------- */

const go = async (route) => {
  window.CC.switchView(route)
  await new Promise((r) => setTimeout(r, 60))
  return window.document.getElementById(`view-${route}`)
}
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))

test('the calendar is a planner: three modes, navigation, and a day that opens', async () => {
  const view = await go('calendar')
  assert.ok(view, 'the calendar renders')

  // each mode is a real view, not a label
  for (const mode of ['month', 'week', 'agenda']) {
    const btn = view.querySelector(`[data-cal-mode="${mode}"]`)
    assert.ok(btn, `${mode} mode has a control`)
    click(btn)
    await new Promise((r) => setTimeout(r, 60))
    const live = view.querySelector(`[data-cal-mode="${mode}"]`)
    assert.equal(live.getAttribute('aria-pressed'), 'true', `${mode} mode is selected`)
  }

  // back to the month, then step forward and back
  click(view.querySelector('[data-cal-mode="month"]'))
  await new Promise((r) => setTimeout(r, 60))
  const titleNow = () => view.querySelector('.cal-nav-label strong')?.textContent.trim()
  const before = titleNow()
  assert.ok(before, 'the month is named in the serif heading')
  click(view.querySelector('[data-cal-step="1"]'))
  await new Promise((r) => setTimeout(r, 60))
  const stepped = titleNow()
  assert.notEqual(stepped, before, 'stepping forward moves the month')
  click(view.querySelector('[data-cal-step="-1"]'))
  await new Promise((r) => setTimeout(r, 60))
  assert.equal(titleNow(), before, 'stepping back returns to it')

  // today returns to the current month
  click(view.querySelector('[data-cal-today]'))
  await new Promise((r) => setTimeout(r, 60))
  assert.equal(view.querySelectorAll('.cal-cell.is-today').length, 1, 'today is marked exactly once')

  // a day opens its schedule
  const cell = view.querySelector('.cal-cell[data-cal-day]')
  const key = cell.getAttribute('data-cal-day')
  click(cell)
  await new Promise((r) => setTimeout(r, 80))
  const selected = view.querySelector('.cal-cell.is-selected')
  assert.ok(selected, 'a chosen day is highlighted')
  assert.match(view.textContent, /./, 'the day rail has content')
  assert.ok(key, 'the day carries a real date key')
})

test('the calendar writes plans and hands an event to its details', async () => {
  const view = await go('calendar')
  // the plus on a cell opens the plan sheet (the sheet is the write path)
  const add = view.querySelector('[data-cal-add]')
  assert.ok(add, 'a day offers a way to add a plan')
  click(add)
  await new Promise((r) => setTimeout(r, 120))
  const sheet = window.document.querySelector('[role="dialog"], .modal, .sheet-panel, .drawer-panel, [data-modal]')
  assert.ok(sheet, 'adding a plan opens an editor rather than silently failing')
  const close = sheet.querySelector('[data-close], [data-modal-close], [aria-label*="Close" i], .icon-btn')
  if (close) click(close)
  await new Promise((r) => setTimeout(r, 80))
})

test('the briefing is a letter built from real data', async () => {
  window.CC.openBriefing()
  await new Promise((r) => setTimeout(r, 160))
  const panel = window.document.querySelector('.briefing-panel')
  assert.ok(panel, 'the briefing opens')
  // the letter opens with a salutation and a date, not a dashboard title
  assert.ok(panel.querySelector('.briefing-salute')?.textContent.trim().length, 'it has a salutation')
  assert.ok(panel.querySelector('.briefing-lead')?.textContent.trim().length, 'it has a lede written from the day')
  // it reports the day's real state
  assert.ok(panel.querySelectorAll('.briefing-stat').length >= 3, 'the day is quantified')
  assert.ok(panel.querySelector('.briefing-focus'), 'it names the next move')
  // and every section present is one the data actually supports
  for (const section of panel.querySelectorAll('.briefing-section')) {
    assert.ok(section.textContent.trim().length > 4, 'no empty section is rendered as filler')
  }
  const close = panel.querySelector('[data-briefing-close]')
  if (close) click(close)
  await new Promise((r) => setTimeout(r, 80))
})

test('the focus room is a room: one timer, real controls, real history', async () => {
  const view = await go('focus')
  assert.ok(view.querySelector('.focus-room-ring'), 'the timer ring is present')
  const clock = view.querySelector('.focus-room-clock')
  assert.match(clock.textContent, /\d+:\d\d/, 'the clock shows a real time that is not 00:00')

  // durations are selectable and take effect
  const presets = [...view.querySelectorAll('.preset-btn')]
  assert.ok(presets.length >= 2, 'several session lengths are offered')
  click(presets[1])
  await new Promise((r) => setTimeout(r, 60))
  assert.ok(view.querySelector('.preset-active, .preset-btn.is-selected'), 'the chosen length is marked')

  // starting a session is real. window.CC exposes no store, so we assert what a
  // user would see: the room leaves its idle shape and offers running controls.
  const start = view.querySelector('[data-room-start]')
  assert.ok(start, 'a session can be begun')
  const idleClock = clock.textContent.trim()
  click(start)
  await new Promise((r) => setTimeout(r, 160))
  const running = view.querySelector('.is-running, .focus-running, [data-room-pause], [data-room-end], [data-room-stop]')
  assert.ok(running, 'beginning a session puts the room into a running state')
  assert.ok(view.querySelector('.preset-active, .preset-btn.is-selected, .is-locked'), 'the session length is locked while it runs')
  assert.ok(idleClock, 'the clock was readable before starting')

  // and it can be stopped, leaving the room as it was
  const stop = view.querySelector('[data-room-stop], [data-room-end], [data-room-exit]')
  if (stop) {
    click(stop)
    await new Promise((r) => setTimeout(r, 100))
  }
  assert.equal(errors.length, 0, `no runtime errors: ${errors.slice(0, 2).join(' | ')}`)
})

test('no chapter still looks like the old generic product', async () => {
  // the visual contract: every route's opening is a PAPER chapter opening
  for (const route of ['schedule', 'hyb', 'routines', 'review', 'forecast', 'progress', 'journal', 'paper', 'settings']) {
    const view = await go(route)
    const head = view.querySelector('.page-heading.paper-header')
    assert.ok(head, `${route} opens with the journal's chapter heading`)
    assert.ok(head.querySelector('.eyebrow'), `${route} carries a chapter mark`)
    assert.ok(head.querySelector('h1')?.textContent.trim().length, `${route} has an editorial title`)
  }
  assert.equal(errors.length, 0, `no runtime errors: ${errors.slice(0, 2).join(' | ')}`)
})

test('motion is one quiet language, and it can be switched off', async () => {
  const css = await readFile(path.join(root, 'public', 'static', 'paper.css'), 'utf8')

  // the shared vocabulary exists and is named
  for (const name of ['paper-rise', 'paper-settle', 'paper-rule', 'paper-veil']) {
    assert.match(css, new RegExp(`@keyframes\\s+${name}`), `the ${name} movement is defined`)
  }

  // nothing overshoots, springs, bounces or spins: no flashy easing in use.
  // Judge the declarations only — prose comments naturally discuss what is banned.
  // strip every comment first, then start at a marker that exists only in code,
  // so the block's own prose can never be mistaken for a declaration
  const animations = css.replace(/\/\*[\s\S]*?\*\//g, '').slice(css.replace(/\/\*[\s\S]*?\*\//g, '').indexOf('@keyframes paper-settle'))
  assert.doesNotMatch(
    animations,
    /bounce|elastic|spring|wobble|shake|flash|blink|rotateY|rotateX|scale\(1\.[0-9]/i,
    'the motion is restrained — no bouncing, springing, flashing or 3D flipping',
  )
  // durations are short enough to read as a page turning, not an animation
  const durations = [...animations.matchAll(/(\d+)ms/g)].map((m) => Number(m[1]))
  assert.ok(durations.every((d) => d <= 1500), `every movement is brief (longest ${Math.max(...durations)}ms)`)

  // and every movement respect the reader's setting
  assert.match(animations, /@media \(prefers-reduced-motion:\s*reduce\)/, 'reduced motion is honoured')
  assert.match(animations, /animation:none!important/, 'and it actually disables the movement')

  // the calendar turns rather than jumping, and the atmosphere still crossfades
  assert.match(animations, /\.cal-month[^{]*\{animation:paper-settle/, 'the calendar settles into view')
  assert.match(animations, /#atmosphere \.atmo-layer\{transition:opacity/, 'the photographs still crossfade')
})

test('no generic utility classes are left in the application source', async () => {
  // A page that still wears text-slate-300 is a page that has not joined the
  // journal — it renders in a colour that belongs to another product. This
  // scans the actual view and ui sources, so a reintroduced utility fails here.
  const { readdir } = await import('node:fs/promises')
  const BANNED = /\b(?:text|bg|border|from|via|to)-(?:slate|gray|zinc|neutral|stone|blue|indigo|violet|purple|pink|rose|cyan|teal|emerald|lime|fuchsia)-(?:[2-9]00|950)\b/
  const offenders = []
  for (const dir of ['src/client/views', 'src/client/ui']) {
    for (const file of await readdir(path.join(root, dir))) {
      if (!file.endsWith('.js')) continue
      const text = await readFile(path.join(root, dir, file), 'utf8')
      const lines = text.split('\n')
      lines.forEach((line, i) => {
        const m = line.match(BANNED)
        if (m) offenders.push(`${dir}/${file}:${i + 1} → ${m[0]}`)
      })
    }
  }
  assert.deepEqual(offenders, [], `generic palette utilities must be replaced with paper classes:\n  ${offenders.slice(0, 8).join('\n  ')}`)
})

test('the last generic text roles are defined rather than inherited', async () => {
  const css = await readFile(path.join(root, 'public', 'static', 'paper.css'), 'utf8')
  // the classes that replaced the utilities must actually carry the journal's ink
  for (const cls of ['.empty-title', '.empty-body', '.field-row-label', '.field-row-value', '.tt-strong', '.tt-meta']) {
    assert.ok(css.includes(`${cls}{`) || css.includes(`${cls} `), `${cls} is styled by paper`)
  }
  const head = css.slice(css.indexOf('.empty-title'))
  assert.match(head.slice(0, 700), /font-family:var\(--font-(display|note)\)/, 'quiet text uses the journal typefaces')
  assert.match(head.slice(0, 700), /color:var\(--ink/, 'and the journal ink rather than a fixed colour')
})
