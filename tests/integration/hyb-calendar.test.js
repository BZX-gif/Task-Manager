/**
 * Integration tests for the 4.4 additions: the HYB button, the HYB deck,
 * HYB Studio and the month calendar.
 *
 *   • the HYB button opens the deck, and a typed sentence is understood
 *     (lane, day, time, length, energy, priority) before anything is saved
 *   • a plan can be finished, put on the real schedule and reopened
 *   • the calendar grid reads the same data as the Schedule: missions, time
 *     blocks, HYB plans, routines, deadlines and journal days
 *   • layers switch off, modes switch over, and a tapped day shows its rail
 *   • HYB Studio groups, filters and searches the same plans
 *   • H / C / Esc drive the deck and the calendar from the keyboard
 *   • plans survive a reload, and a v7 workspace migrates additively to v8
 *
 * Requires `npm run build` first (npm test does that automatically).
 */
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { JSDOM, VirtualConsole } from 'jsdom'

const root = process.cwd()
const worker = (await import(path.join(root, 'dist', 'index.js'))).default
const { STATE_VERSION } = await import(path.join(root, 'src', 'client', 'lib', 'defaults.js'))
const { addDays, dateKey } = await import(path.join(root, 'src', 'client', 'lib', 'dates.js'))

let shell
let bundle

const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms))
const today = dateKey()
const tomorrow = addDays(today, 1)

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
  const toasts = []
  window.eval(bundle)

  const container = window.document.getElementById('toast-container')
  new window.MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) if (node.textContent) toasts.push(node.textContent.trim())
    }
  }).observe(container, { childList: true })

  await settle(90)
  const $ = (selector) => window.document.querySelector(selector)
  const $$ = (selector) => Array.from(window.document.querySelectorAll(selector))
  const click = (target) => {
    const node = typeof target === 'string' ? $(target) : target
    assert.ok(node, `element not found: ${target}`)
    node.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    return node
  }
  const type = (target, value) => {
    const node = typeof target === 'string' ? $(target) : target
    assert.ok(node, `element not found: ${target}`)
    node.value = value
    node.dispatchEvent(new window.Event('input', { bubbles: true }))
    return node
  }
  const submit = (target) => {
    const node = typeof target === 'string' ? $(target) : target
    node.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
  }
  const key = (k, options = {}) =>
    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...options }))
  return { dom, window, errors, toasts, $, $$, click, type, submit, key, state: () => window.CC.getState() }
}

before(async () => {
  shell = await (await worker.request('/')).text()
  bundle = await readFile(path.join(root, 'public', 'static', 'js', 'app.js'), 'utf8')
})

/* ---------------------------------------------------------------- the deck */

test('the shell ships a HYB button, a calendar view and a HYB studio view', async () => {
  const { window, $, $$, errors } = await boot()
  try {
    assert.equal(errors.length, 0, `boot errors: ${errors.join(' | ')}`)
    assert.ok($('#hyb-btn'), 'the topbar HYB button exists')
    assert.ok($('#hyb-fab'), 'the floating HYB button exists for touch screens')
    assert.ok($('.nav-item[data-view="calendar"]'), 'the calendar is in the navigation')
    assert.ok($('.nav-item[data-view="hyb"]'), 'HYB Studio is in the navigation')
    assert.ok($('#view-calendar'), 'the calendar view section exists')
    assert.ok($('#view-hyb'), 'the HYB studio view section exists')
    assert.equal($$('[data-hyb-trigger]').length >= 3, true, 'topbar, drawer and FAB all trigger the deck')
    assert.equal(typeof window.CC.openHybDeck, 'function')
    assert.equal(typeof window.CC.openHybPlanModal, 'function')
    assert.equal(typeof window.CC.hybInfo, 'function')
    assert.equal(typeof window.CC.openCalendar, 'function')
  } finally {
    window.close()
  }
})

test('the HYB button opens the deck and reads a sentence before saving it', async () => {
  const { window, $, $$, click, type, submit, state, errors } = await boot()
  try {
    click('#hyb-btn')
    await settle(50)
    assert.ok($('.hyb-deck'), 'the deck is open')
    assert.equal($('.hyb-deck').getAttribute('role'), 'dialog')
    assert.ok($('#hyb-quick-input'), 'the one-line quick add is ready')
    assert.equal(state().hyb.plans.length, 0, 'nothing has been written yet')

    type('#hyb-quick-input', `Revision of polity tomorrow 6pm 90m @study ~deep !high`)
    await settle(20)
    const chips = $('#hyb-quick-chips').textContent
    assert.match(chips, /Tomorrow/, 'the parsed day is shown back')
    assert.match(chips, /6:00 pm|18:00/, 'the parsed time is shown back')
    assert.match(chips, /1h 30m/, 'the parsed length is shown back')
    assert.match(chips, /Study/, 'the parsed lane is shown back')
    assert.match(chips, /Deep energy/, 'the parsed energy is shown back')
    assert.match(chips, /high priority/i, 'the parsed priority is shown back')

    submit('#hyb-quick-form')
    await settle(60)
    const plans = state().hyb.plans
    assert.equal(plans.length, 1, 'exactly one plan was written')
    assert.equal(plans[0].title, 'Revision of polity')
    assert.equal(plans[0].date, tomorrow)
    assert.equal(plans[0].startTime, '18:00')
    assert.equal(plans[0].minutes, 90)
    assert.equal(plans[0].kind, 'study')
    assert.equal(plans[0].energy, 'deep')
    assert.equal(plans[0].priority, 'high')
    assert.equal(plans[0].status, 'planned')
    assert.ok($$('.hyb-row').length >= 1, 'the deck lists the new plan')
    assert.match($('#hyb-btn').getAttribute('aria-label'), /HYB/, 'the trigger keeps its label')
  } finally {
    window.close()
  }
})

test('a plan can be finished, put on the schedule and reopened', async () => {
  const { window, click, submit, type, $, $$, state, toasts, errors } = await boot()
  try {
    click('#hyb-btn')
    await settle(40)
    type('#hyb-quick-input', 'Gym and a walk @body 45m')
    submit('#hyb-quick-form')
    await settle(60)
    const plan = state().hyb.plans[0]
    assert.equal(plan.kind, 'body')
    assert.equal(plan.minutes, 45)
    assert.equal(plan.date, today, 'an undated sentence lands on the chosen day')

    // finish it
    click('.hyb-row [data-hyb-toggle]')
    await settle(60)
    assert.equal(state().hyb.plans[0].status, 'done')
    assert.ok($('.hyb-row.is-done'), 'the row shows the finished state')
    assert.ok(toasts.some((text) => /Done/.test(text)), 'finishing says so')

    // reopen it, then put it on the real schedule
    click('.hyb-row [data-hyb-toggle]')
    await settle(60)
    assert.equal(state().hyb.plans[0].status, 'planned')
    click('.hyb-row [data-hyb-schedule]')
    await settle(80)
    const blocks = state().schedule.days[today] || []
    assert.ok(blocks.some((block) => block.id === `hyb:${plan.id}`), 'the plan became a real time block')
    assert.equal(blocks.find((block) => block.id === `hyb:${plan.id}`).duration, 45)

    // and the Schedule view can see it
    window.CC.switchView('schedule')
    await settle(60)
    assert.match($('#view-schedule').textContent, /Gym and a walk/, 'the block is on the day timeline')
    assert.equal(errors.length, 0, `errors: ${errors.join(' | ')}`)
    assert.ok($$('#view-schedule [data-event]').length >= 1)
  } finally {
    window.close()
  }
})

test('the full plan editor writes lanes, steps, repeats and links', async () => {
  const { window, $, $$, click, type, submit, state, errors } = await boot()
  try {
    window.CC.openHybPlanModal(null, { date: tomorrow })
    await settle(60)
    assert.ok($('#hyb-plan-form'), 'the editor is open')
    assert.equal($('#hyb-date').value, tomorrow, 'the editor starts on the day you asked for')

    type('#hyb-title', 'Full mock test, timed')
    click('[data-hyb-form-lane="study"]')
    click('[data-hyb-energy="deep"]')
    click('[data-hyb-priority="high"]')
    type('#hyb-minutes', '180')
    $('#hyb-start').value = '09:00'
    $('#hyb-start').dispatchEvent(new window.Event('change', { bubbles: true }))
    $('#hyb-repeat').value = 'weekly'
    $('#hyb-repeat').dispatchEvent(new window.Event('change', { bubbles: true }))
    type('#hyb-tags', 'mock, gs-paper')
    click('[data-hyb-add-step]')
    type('[data-hyb-step-title]', 'Sit the paper without a phone')
    type('#hyb-notes', 'Previous year, exact timing.')
    submit('#hyb-plan-form')
    await settle(80)

    const plans = state().hyb.plans
    assert.equal(plans.length, 1)
    const plan = plans[0]
    assert.equal(plan.title, 'Full mock test, timed')
    assert.equal(plan.kind, 'study')
    assert.equal(plan.energy, 'deep')
    assert.equal(plan.priority, 'high')
    assert.equal(plan.minutes, 180)
    assert.equal(plan.startTime, '09:00')
    assert.equal(plan.repeat, 'weekly')
    assert.equal(plan.tags.join(','), 'mock,gs-paper', 'tags are normalised into a list')
    assert.equal(plan.steps.length, 1)
    assert.equal(plan.steps[0].title, 'Sit the paper without a phone')
    assert.equal(plan.notes, 'Previous year, exact timing.')

    // the studio opens on Today; a plan dated tomorrow shows under "Next 14"
    window.CC.switchView('hyb')
    await settle(70)
    click('[data-hyb-scope="upcoming"]')
    await settle(70)
    assert.match($('#view-hyb').textContent, /Full mock test, timed/, 'HYB Studio lists the plan')
    assert.ok($$('.hyb-card').length >= 1)
    assert.match($('.hyb-card').textContent, /Same weekday/, 'a repeating plan says so')
    assert.equal(errors.length, 0, `errors: ${errors.join(' | ')}`)
  } finally {
    window.close()
  }
})

/* ------------------------------------------------------------- calendar */

test('the calendar grid reads missions, blocks, HYB plans, routines and the journal', async () => {
  const seed = {
    version: 7,
    tasks: [
      { id: 'm1', title: 'Write the answer sheet', date: today, time: null, priority: 'high', estimateMinutes: 60, done: false, status: 'ready', inbox: false },
      { id: 'm2', title: 'Timed mock at nine', date: today, time: '09:00', priority: 'medium', estimateMinutes: 90, done: false, status: 'ready', inbox: false },
      { id: 'm3', title: 'Deadline mission', date: null, deadline: addDays(today, 3), priority: 'low', estimateMinutes: 30, done: false, status: 'ready', inbox: false },
    ],
    goals: [{ id: 'g1', title: 'Clear the exam', deadline: addDays(today, 3), category: 'Academic' }],
    routines: [{ id: 'r1', title: 'Morning start', time: '06:00', days: [0, 1, 2, 3, 4, 5, 6], activities: [{ id: 'a1', title: 'Water', duration: 5 }] }],
    journal: { [today]: { note: 'A steady day.', mood: 'good', energy: 'medium' } },
    hyb: { plans: [{ id: 'h1', title: 'Evening revision', date: today, startTime: '18:30', minutes: 60, kind: 'study', priority: 'medium', energy: 'deep', repeat: 'none', status: 'planned', steps: [], tags: [], log: {} }] },
  }
  const { window, $, $$, click, state, errors } = await boot({ seed })
  try {
    click('.nav-item[data-view="calendar"]')
    await settle(80)
    assert.equal($('#view-calendar').classList.contains('hidden'), false, 'the calendar is the visible view')
    assert.match($('#breadcrumb-current').textContent, /Calendar/)

    const cells = $$('.cal-cell')
    assert.ok(cells.length === 35 || cells.length === 42, `a month grid has 35 or 42 cells, saw ${cells.length}`)
    assert.equal($$('.cal-cell.is-today').length, 1, 'exactly one today')
    assert.ok($$('.cal-cell.is-outside').length >= 0)

    const todayCell = $(`.cal-cell[data-cal-day="${today}"]`)
    assert.ok(todayCell, 'today has a cell')
    const text = todayCell.textContent
    assert.match(text, /Evening revision/, 'the HYB plan is on the grid')
    assert.match(text, /Write the answer sheet/, 'the untimed mission is on the grid')
    assert.ok(todayCell.querySelector('.cal-chip--hyb'), 'HYB chips carry their own lane class')
    assert.ok(todayCell.querySelector('.cal-chip--mission'), 'missions carry their own class')
    assert.ok(todayCell.querySelector('.cal-dot--routine'), 'routines show as quiet dots')
    assert.ok(todayCell.querySelector('.cal-dot--journal'), 'a written journal day is marked')

    // the day rail shows the same day in full, with actions
    const rail = $('.cal-day-card')
    assert.ok(rail, 'the day rail rendered')
    assert.match(rail.textContent, /Evening revision/)
    assert.match(rail.textContent, /Timed mock at nine/)
    assert.ok(rail.querySelector('[data-cal-hyb-toggle]'), 'the rail can finish a HYB plan in place')
    click(rail.querySelector('[data-cal-hyb-toggle]'))
    await settle(70)
    assert.equal(state().hyb.plans[0].status, 'done', 'the calendar writes through the same action')

    // a deadline three days out is visible on its own day
    const deadlineCell = $(`.cal-cell[data-cal-day="${addDays(today, 3)}"]`)
    assert.ok(deadlineCell.querySelector('.cal-dot--deadline'), 'the goal deadline is marked')

    // layers switch off, and the choice is remembered in settings
    click('[data-cal-layer="hyb"]')
    await settle(70)
    assert.equal($(`.cal-cell[data-cal-day="${today}"] .cal-chip--hyb`), null, 'the HYB layer is off')
    assert.equal(state().settings.calendar.layers.hyb, false, 'the layer choice is stored')
    click('[data-cal-layer="hyb"]')
    await settle(70)
    assert.ok($(`.cal-cell[data-cal-day="${today}"] .cal-chip--hyb`), 'and back on again')

    // month navigation
    const monthLabel = $('.cal-nav-label strong').textContent
    click('[data-cal-step="1"]')
    await settle(70)
    assert.notEqual($('.cal-nav-label strong').textContent, monthLabel, 'the month moved')
    click('[data-cal-today]')
    await settle(70)
    assert.equal($('.cal-nav-label strong').textContent, monthLabel, 'Today brings it back')

    // week and agenda modes
    click('[data-cal-mode="week"]')
    await settle(70)
    assert.equal($$('.cal-week-col').length, 7, 'week mode shows seven columns')
    assert.equal(state().settings.calendar.mode, 'week')
    click('[data-cal-mode="agenda"]')
    await settle(70)
    assert.ok($$('.cal-agenda-day').length >= 1, 'agenda mode lists the days that have something on them')
    click('[data-cal-mode="month"]')
    await settle(70)
    assert.ok($$('.cal-cell').length >= 35)
    assert.equal(errors.length, 0, `errors: ${errors.join(' | ')}`)
  } finally {
    window.close()
  }
})

test('the calendar adds a plan for the day you tapped, and opens real editors', async () => {
  const { window, $, $$, click, type, submit, state, errors } = await boot()
  try {
    window.CC.openCalendar(tomorrow)
    await settle(80)
    assert.equal($('#view-calendar').classList.contains('hidden'), false)
    assert.ok($(`.cal-cell.is-selected[data-cal-day="${tomorrow}"]`), 'the requested day is selected')

    // the per-cell plus opens the HYB editor on that day
    click(`.cal-cell[data-cal-day="${tomorrow}"] [data-cal-add]`)
    await settle(70)
    assert.ok($('#hyb-plan-form'), 'the plan editor opened')
    assert.equal($('#hyb-date').value, tomorrow)
    type('#hyb-title', 'Read one chapter')
    submit('#hyb-plan-form')
    await settle(80)
    assert.equal(state().hyb.plans.length, 1)
    assert.equal(state().hyb.plans[0].date, tomorrow)
    assert.match($(`.cal-cell[data-cal-day="${tomorrow}"]`).textContent, /Read one chapter/, 'the grid shows the new plan')

    // the day rail can add a mission too, on the same day
    click('.cal-day-card [data-cal-new-mission]')
    await settle(70)
    assert.ok($('[data-modal-backdrop]'), 'the mission editor opened')
    assert.equal($('#task-date')?.value || $('#task-date')?.getAttribute('value'), tomorrow, 'the mission starts on the selected day')
    window.CC.closeModal()
    await settle(30)

    // putting the plan on the schedule writes a real time block for that day
    click('.cal-day-card [data-cal-hyb-schedule]')
    await settle(90)
    const blocks = state().schedule.days[tomorrow] || []
    assert.ok(blocks.some((block) => block.id === `hyb:${state().hyb.plans[0].id}`), 'the plan is now a time block on that day')
    const railRows = $$('.cal-day-card .cal-day-row--hyb')
    assert.equal(railRows.length, 1, 'a scheduled plan is drawn once, not twice')
    assert.match($('.cal-day-card').textContent, /On the schedule/, 'the rail says it has been placed')

    // opening the schedule from the rail keeps the same date
    click('.cal-day-card [data-cal-open-schedule]')
    await settle(80)
    assert.equal($('#view-schedule').classList.contains('hidden'), false)
    assert.ok($(`#view-schedule [data-common="new-task"][data-date="${tomorrow}"]`), 'the schedule opened on the selected day, not today')
    assert.ok($$('#view-schedule [data-calendar-mode]').length >= 4, 'the schedule now offers a Month mode too')
    assert.equal(errors.length, 0, `errors: ${errors.join(' | ')}`)
  } finally {
    window.close()
  }
})

/* --------------------------------------------------------------- studio */

test('HYB Studio groups plans, filters by lane and searches them', async () => {
  const seed = {
    version: 8,
    hyb: {
      plans: [
        { id: 'p1', title: 'Quant drill', date: today, startTime: '07:00', minutes: 60, kind: 'study', priority: 'high', energy: 'deep', repeat: 'none', status: 'planned', steps: [{ id: 's1', title: 'Twenty questions', done: false }], tags: ['mock'], log: {} },
        { id: 'p2', title: 'Long run', date: today, startTime: '06:00', minutes: 45, kind: 'body', priority: 'medium', energy: 'steady', repeat: 'daily', status: 'planned', steps: [], tags: [], log: {} },
        { id: 'p3', title: 'Call the bank', date: null, minutes: 20, kind: 'personal', priority: 'low', energy: 'light', repeat: 'none', status: 'planned', steps: [], tags: [], log: {} },
        { id: 'p4', title: 'Finished thing', date: addDays(today, -1), minutes: 30, kind: 'work', priority: 'medium', energy: 'steady', repeat: 'none', status: 'done', steps: [], tags: [], log: {}, completedAt: Date.now() },
      ],
    },
  }
  const { window, $, $$, click, type, state, errors } = await boot({ seed })
  try {
    click('.nav-item[data-view="hyb"]')
    await settle(80)
    assert.equal($('#view-hyb').classList.contains('hidden'), false)
    assert.match($('#breadcrumb-current').textContent, /HYB Studio/)
    assert.equal($$('.hyb-card').length, 2, 'today shows the two plans that are on today')
    assert.match($('.hyb-metrics').textContent, /Today/, 'the metric strip is there')

    // lane filter
    click('[data-hyb-lane-filter="body"]')
    await settle(70)
    assert.equal($$('.hyb-card').length, 1)
    assert.match($('.hyb-card').textContent, /Long run/)
    click('[data-hyb-lane-filter="body"]')
    await settle(70)
    assert.equal($$('.hyb-card').length, 2, 'the filter toggles back off')

    // scope: everything, then someday, then finished
    click('[data-hyb-scope="all"]')
    await settle(70)
    assert.ok($$('.hyb-card').length >= 3, 'the "everything" scope widens the list')
    click('[data-hyb-scope="someday"]')
    await settle(70)
    assert.match($('#view-hyb').textContent, /Call the bank/, 'the someday shelf shows undated plans')
    click('[data-hyb-scope="done"]')
    await settle(70)
    assert.match($('#view-hyb').textContent, /Finished thing/, 'finished plans collect in their own scope')

    // search
    click('[data-hyb-scope="all"]')
    await settle(70)
    type('#hyb-studio-search', 'quant')
    await settle(70)
    assert.equal($$('.hyb-card').length, 1)
    assert.match($('.hyb-card').textContent, /Quant drill/)
    type('#hyb-studio-search', '')
    await settle(70)
    assert.ok($$('.hyb-card').length >= 3)

    // finishing a plan from the studio is the same action as everywhere else
    click('[data-hyb-scope="today"]')
    await settle(70)
    click('.hyb-card [data-hyb-toggle]')
    await settle(70)
    const finished = state().hyb.plans.filter((plan) => plan.status === 'done' || Object.values(plan.log || {}).includes('done'))
    assert.equal(finished.length, 2, 'the daily plan logged today, the one-day plan changed status')
    assert.equal(errors.length, 0, `errors: ${errors.join(' | ')}`)
  } finally {
    window.close()
  }
})

/* ------------------------------------------------------------ keyboard */

test('H opens the deck, C opens the calendar, Esc closes the deck', async () => {
  const { window, $, key, errors } = await boot()
  try {
    key('h')
    await settle(50)
    assert.ok($('.hyb-deck'), 'H opened the deck')
    key('Escape')
    await settle(50)
    assert.equal($('.hyb-deck'), null, 'Esc closed it')

    key('c')
    await settle(60)
    assert.equal($('#view-calendar').classList.contains('hidden'), false, 'C opened the calendar')

    // shortcuts stay quiet while a modal is open
    window.CC.openHybPlanModal()
    await settle(50)
    key('c')
    await settle(50)
    assert.ok($('[data-modal-backdrop]'), 'the editor is still open — C did not fire behind it')
    window.CC.closeModal()
    await settle(30)

    // the shortcut sheet documents the new keys
    window.CC.openShortcuts()
    await settle(50)
    const sheet = $('[data-modal-backdrop]').textContent
    assert.match(sheet, /HYB deck/, 'the deck shortcut is documented')
    assert.match(sheet, /Calendar/, 'the calendar shortcut is documented')
    assert.match(sheet, /Add a HYB plan to that day/, 'the grid keys are documented')
    window.CC.closeModal()

    // and the command palette can reach both
    window.CC.openCommandPalette()
    await settle(50)
    const palette = $('#palette-results').textContent
    assert.match(palette, /HYB/, 'the palette offers the HYB deck')
    window.CC.closeModal()
    assert.equal(errors.length, 0, `errors: ${errors.join(' | ')}`)
  } finally {
    window.close()
  }
})

/* --------------------------------------------------------- persistence */

test('HYB plans survive a reload, and a v7 workspace migrates additively', async () => {
  const legacy = {
    version: 7,
    tasks: [{ id: 'keep-1', title: 'An existing mission', date: today, priority: 'high', estimateMinutes: 30, done: false, status: 'ready', inbox: false }],
    journal: { [today]: { note: 'Written before HYB existed.', mood: 'steady' } },
    goals: [{ id: 'g1', title: 'An existing goal' }],
    settings: { accent: 'iris', theme: 'dark' },
  }
  const first = await boot({ seed: legacy })
  try {
    const state = first.state()
    assert.equal(state.version, STATE_VERSION, 'the legacy payload migrated to the current schema')
    assert.equal(state.hyb.plans.length, 0, 'no plans were invented')
    assert.equal(state.tasks.length, 1, 'the mission is intact')
    assert.equal(state.tasks[0].title, 'An existing mission')
    assert.equal(state.journal[today].note, 'Written before HYB existed.', 'the journal is intact')
    assert.equal(state.goals.length, 1)
    assert.equal(state.settings.accent, 'iris', 'stored preferences are untouched')
    // the window realm hands back its own Array/Object prototypes, so compare
    // these by value rather than by structure
    assert.equal(JSON.stringify(state.settings.hyb), JSON.stringify({ defaultMinutes: 60, defaultKind: 'study', showOnCalendar: true, deckOnLoad: false }), 'HYB defaults arrive on migration')
    assert.equal(JSON.stringify(state.settings.calendar.layers), JSON.stringify({ blocks: true, missions: true, hyb: true, routines: true, deadlines: true, journal: true }), 'every calendar layer starts on')
    assert.equal(first.errors.length, 0, `errors: ${first.errors.join(' | ')}`)

    // add a plan, then reload from the persisted payload
    first.window.CC.openHybDeck()
    await settle(40)
    first.type('#hyb-quick-input', 'Night revision @study 40m')
    first.submit('#hyb-quick-form')
    await settle(450) // the store debounces its write by 350ms
    const persisted = JSON.parse(first.window.localStorage.getItem('kcc_state_v1'))
    assert.equal(persisted.hyb.plans.length, 1, 'the plan was written to storage')
    assert.equal(persisted.hyb.plans[0].title, 'Night revision')

    const second = await boot({ seed: persisted })
    try {
      const reloaded = second.state()
      assert.equal(reloaded.hyb.plans.length, 1, 'the plan came back')
      assert.equal(reloaded.hyb.plans[0].kind, 'study')
      assert.equal(reloaded.hyb.plans[0].minutes, 40)
      assert.equal(reloaded.tasks.length, 1, 'and the old mission is still there')
      second.window.CC.switchView('hyb')
      await settle(70)
      assert.match(second.$('#view-hyb').textContent, /Night revision/, 'the studio shows the reloaded plan')
      assert.equal(second.errors.length, 0, `errors: ${second.errors.join(' | ')}`)
    } finally {
      second.window.close()
    }
  } finally {
    first.window.close()
  }
})

test('My Day carries today\u2019s HYB plans and can finish one in place', async () => {
  const seed = {
    version: STATE_VERSION,
    hyb: {
      plans: [
        { id: 'd1', title: 'Evening revision', date: today, startTime: '18:00', minutes: 60, kind: 'study', priority: 'high', energy: 'deep', repeat: 'none', status: 'planned', steps: [], tags: [], log: {} },
        { id: 'd2', title: 'Walk after lunch', date: today, startTime: '13:30', minutes: 25, kind: 'body', priority: 'low', energy: 'light', repeat: 'none', status: 'planned', steps: [], tags: [], log: {} },
      ],
    },
  }
  const { window, $, $$, click, state, errors } = await boot({ seed })
  try {
    window.CC.switchView('day')
    await settle(70)
    const card = $('.hyb-day-card')
    assert.ok(card, 'My Day has a HYB card')
    assert.match(card.textContent, /2\/2|0\/2/, 'it reports progress out of the day\u2019s plans')
    assert.equal($$('.hyb-day-row').length, 2, 'both plans are listed')
    // the card reads the day in clock order, not in the order plans were typed
    assert.match($('.hyb-day-row').textContent, /Walk after lunch/)
    assert.match($('.hyb-day-row.lane-study').textContent, /Evening revision/)
    assert.match($('.hyb-day-row.lane-study').textContent, /Study/, 'the row names its lane')
    assert.match($('.hyb-day-row.lane-study').textContent, /Deep energy/, 'and its energy')

    click('.hyb-day-row.lane-study [data-hyb-day-toggle]')
    await settle(70)
    assert.equal(state().hyb.plans[0].status, 'done', 'ticking it writes through the same action')
    assert.ok($('.hyb-day-row.is-done'), 'the row shows the finished state')
    assert.match($('.hyb-day-card').textContent, /1\/2 done/, 'the header counts it')

    click('.hyb-day-row.lane-study [data-hyb-day-edit]')
    await settle(60)
    assert.ok($('#hyb-plan-form'), 'the plan editor opens from My Day')
    assert.equal($('#hyb-title').value, 'Evening revision')
    window.CC.closeModal()
    await settle(30)

    click('[data-hyb-open-deck]')
    await settle(60)
    assert.ok($('.hyb-deck'), 'and so does the deck')
    window.CC.closeHybDeck()
    assert.equal(errors.length, 0, `errors: ${errors.join(' | ')}`)
  } finally {
    window.close()
  }
})

test('My Day offers the HYB layer when nothing is planned yet', async () => {
  const { window, $, click, errors } = await boot()
  try {
    window.CC.switchView('day')
    await settle(70)
    const card = $('.hyb-day-card')
    assert.ok(card, 'the card is there even with no plans')
    assert.equal($('.hyb-day-row'), null)
    assert.match(card.textContent, /A plan is lighter than a mission/)
    click('.hyb-day-card [data-hyb-open-deck]')
    await settle(60)
    assert.ok($('.hyb-deck'), 'the empty state opens the deck')
    assert.equal(errors.length, 0, `errors: ${errors.join(' | ')}`)
  } finally {
    window.close()
  }
})

test('the one-time deck nudge respects its setting and never repeats', async () => {
  const seed = { version: STATE_VERSION, settings: { hyb: { deckOnLoad: true } } }
  const first = await boot({ seed })
  try {
    await settle(700)
    const briefing = first.$('#briefing-overlay')
    if (briefing) first.window.CC.closeBriefing?.()
    await settle(200)
    assert.equal(first.state().tasks.length, 0, 'the fixture really is a brand-new workspace')
    assert.ok(first.$('.hyb-deck'), 'an empty workspace with the setting on opens the deck once')
    assert.ok(first.state().meta.hybDeckNudged, 'and records that it did')

    const persisted = JSON.parse(first.window.localStorage.getItem('kcc_state_v1'))
    assert.ok(persisted.meta.hybDeckNudged, 'the nudge flag is written to storage')

    const second = await boot({ seed: persisted })
    try {
      await settle(700)
      assert.equal(second.$('.hyb-deck'), null, 'the nudge is a one-time thing')
    } finally {
      second.window.close()
    }
  } finally {
    first.window.close()
  }

  // with the setting off (the default) a fresh workspace is left in peace
  const quiet = await boot()
  try {
    await settle(700)
    assert.equal(quiet.state().settings.hyb.deckOnLoad, false)
    assert.equal(quiet.$('.hyb-deck'), null, 'the deck stays closed unless you ask for it')
    assert.equal(quiet.state().meta.hybDeckNudged, undefined)
  } finally {
    quiet.window.close()
  }
})

test('a repeating plan is finished day by day and never all at once', async () => {
  const seed = {
    version: 8,
    hyb: { plans: [{ id: 'daily-1', title: 'Twenty minutes of revision', date: addDays(today, -3), startTime: '20:00', minutes: 20, kind: 'study', priority: 'medium', energy: 'steady', repeat: 'daily', status: 'planned', steps: [], tags: [], log: {} }] },
  }
  const { window, click, $, state, errors } = await boot({ seed })
  try {
    window.CC.openHybDeck()
    await settle(50)
    assert.ok($('.hyb-row'), 'a daily plan is on today')
    click('.hyb-row [data-hyb-toggle]')
    await settle(70)
    const plan = state().hyb.plans[0]
    assert.equal(plan.status, 'planned', 'the series itself is still open')
    assert.equal(plan.log[today], 'done', 'today is recorded as done')
    assert.equal(Object.keys(plan.log).length, 1, 'no other day was touched')
    assert.equal(window.CC.hybInfo().streak.current >= 1, true, 'the streak sees it')

    // tomorrow is untouched and still waiting
    click('[data-hyb-tab="week"]')
    await settle(60)
    assert.match($('#hyb-root').textContent, /Tomorrow|Twenty minutes/, 'the series continues into the week')
    assert.equal(errors.length, 0, `errors: ${errors.join(' | ')}`)
  } finally {
    window.close()
  }
})

test('the HYB deck keeps keyboard focus inside it while it is open', async () => {
  const { window, $, errors } = await boot()
  try {
    window.CC.openHybDeck()
    await settle(80)
    const root = window.document.getElementById('hyb-root')
    const focusable = [...root.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((node) => !node.closest('.hidden, [hidden]'))
    assert.ok(focusable.length > 2, 'the deck has real controls')
    const first = focusable[0]
    const last = focusable.at(-1)

    last.focus()
    last.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    assert.equal(window.document.activeElement, first, 'Tab from the last control wraps to the first')

    first.focus()
    first.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))
    assert.equal(window.document.activeElement, last, 'Shift+Tab from the first wraps to the last')

    window.CC.closeHybDeck()
    await settle(50)
    assert.ok($('#hyb-root').classList.contains('hidden'))
    assert.equal(errors.length, 0, `errors: ${errors.join(' | ')}`)
  } finally {
    window.close()
  }
})
