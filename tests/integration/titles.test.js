/**
 * Integration coverage for the private title system (DISCIPLINE MONSTER):
 *
 *   • the title is derived from the app's *existing* data at boot
 *   • 10 consecutive Perfect Days unlock it, shows the ceremony exactly once
 *     and the Profile then reports it as unlocked with a local date
 *   • a reload (same localStorage) never replays the ceremony or duplicates
 *     the unlock
 *   • locked progress is rendered honestly (7 / 10 · 3 DAYS TO GO)
 *   • nothing about titles is public: the Worker never serves title data
 *   • the existing Focus Mission, tasks and timetable keep working
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

const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms))

/* ------------------------------------------------------------ fixtures */

const TIMETABLE = [
  { id: 'b1', time: '09:00', title: 'Deep work block', duration: 120, cat: 'upsc' },
  { id: 'b2', time: '14:00', title: 'Revision block', duration: 60, cat: 'upsc' },
]

function localKey(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function shiftDays(date, days) {
  const copy = new Date(date.getTime())
  copy.setDate(copy.getDate() + days)
  return copy
}

/**
 * A real payload (schema v2) with `count` perfect days ending yesterday —
 * built only from the structures the app already stores.
 */
function seededPayload(count, { today = new Date() } = {}) {
  const dayPlans = {}
  const completionLog = {}
  const tasks = []
  for (let i = 1; i <= count; i++) {
    const key = localKey(shiftDays(today, -i))
    dayPlans[key] = TIMETABLE.map((block) => ({ ...block }))
    completionLog[key] = { ttDone: TIMETABLE.map((block) => block.id), taskDone: [] }
    tasks.push(
      {
        id: `${key}-task-a`,
        title: 'Hardest subject first',
        date: key,
        priority: 'high',
        cat: 'upsc',
        notes: '',
        estimateMinutes: 60,
        done: true,
        completedAt: Date.now() - i * 86400000,
        inbox: false,
        createdAt: Date.now() - i * 86400000,
        recurrence: null,
        seriesId: null,
        occurrenceDate: null,
      },
      {
        id: `${key}-task-b`,
        title: 'Current affairs',
        date: key,
        priority: 'medium',
        cat: 'ssc',
        notes: '',
        estimateMinutes: 30,
        done: true,
        completedAt: Date.now() - i * 86400000,
        inbox: false,
        createdAt: Date.now() - i * 86400000,
        recurrence: null,
        seriesId: null,
        occurrenceDate: null,
      },
    )
  }
  return {
    version: 2,
    timetable: TIMETABLE.map((block) => ({ ...block })),
    tasks,
    top3: {},
    completionLog,
    dayPlans,
    focus: { active: null, sessions: [] },
    scoreHistory: {},
    chatHistory: [],
    reminders: { sent: {} },
    meta: { createdAt: Date.now() - 30 * 86400000, updatedAt: Date.now() },
  }
}

/* ------------------------------------------------------------- harness */

async function boot({ seed = null, storage = null } = {}) {
  const virtualConsole = new VirtualConsole()
  const errors = []
  virtualConsole.on('jsdomError', (error) => errors.push(error.message))
  virtualConsole.on('error', (message) => errors.push(String(message)))

  const dom = new JSDOM(shell, { url: 'https://command-center.test/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole })
  const window = dom.window
  window.HTMLCanvasElement.prototype.getContext = () => null
  window.scrollTo = () => {}
  window.fetch = async () => Response_ok()
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
  window.confirm = () => true
  if (seed !== null) window.localStorage.setItem('kcc_state_v1', typeof seed === 'string' ? seed : JSON.stringify(seed))
  if (storage && typeof storage === 'string') window.localStorage.setItem('kcc_state_v1', storage)

  window.eval(bundle)
  await settle(120)
  const $ = (selector) => window.document.querySelector(selector)
  const $$ = (selector) => Array.from(window.document.querySelectorAll(selector))
  const click = (selectorOrElement) => {
    const element = typeof selectorOrElement === 'string' ? $(selectorOrElement) : selectorOrElement
    assert.ok(element, `element not found: ${typeof selectorOrElement === 'string' ? selectorOrElement : '[element]'}`)
    element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
  }
  return { dom, window, errors, $, $$, click, state: () => window.CC.getState() }
}

function Response_ok() {
  return new Response(JSON.stringify({ text: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } })
}

before(async () => {
  shell = await (await worker.request('/')).text()
  bundle = await readFile(path.join(root, 'public', 'static', 'js', 'app.js'), 'utf8')
})

/* ----------------------------------------------------------- the tests */

test('the shell is static: it never carries my title data', async () => {
  assert.doesNotMatch(shell, /DISCIPLINE MONSTER/i, 'the server-rendered shell knows nothing about my achievements')
  const health = await worker.request('/api/health')
  const payload = await health.text()
  assert.doesNotMatch(payload, /discipline|title|achievement/i, 'no achievement data is served from the Worker')
})

test('10 consecutive Perfect Days unlock the title and celebrate exactly once', async () => {
  const { window, errors, $, click, state } = await boot({ seed: seededPayload(10) })
  try {
    const titles = window.CC.titlesInfo()
    assert.equal(titles.length, 1)
    assert.equal(titles[0].id, 'discipline-monster')
    assert.equal(titles[0].unlocked, true, 'ten banked perfect days earn the title')
    assert.equal(titles[0].progressLabel, '10 / 10 PERFECT DAYS')
    assert.equal(Object.keys(state().achievements.unlocked).length, 1, 'exactly one unlock is recorded')

    // the ceremony is on screen, styled as the premium unlock dialog
    const modal = $('[data-modal-box]')
    assert.ok(modal, 'the unlock ceremony appeared')
    assert.ok(modal.classList.contains('modal-unlock'), 'it uses the dedicated unlock styling')
    assert.match(modal.textContent, /TITLE UNLOCKED/)
    assert.match(modal.textContent, /DISCIPLINE MONSTER/)
    assert.match(modal.textContent, /10 DAY PERFECT RUN/)
    assert.match(modal.textContent, /10 PERFECT DAYS COMPLETED/)
    assert.match($('.unlock-card').textContent, /You showed up\. You finished\. You stayed consistent\./)

    // it is already stamped as seen, so a refresh cannot replay it
    const stored = JSON.parse(window.localStorage.getItem('kcc_state_v1'))
    assert.equal(stored.achievements.unlocked['discipline-monster'].seen, true, 'the ceremony is marked as seen immediately')
    assert.equal(typeof stored.achievements.unlocked['discipline-monster'].dateKey, 'string')

    // VIEW TITLE takes me to the Profile
    click('[data-view-title]')
    await settle()
    assert.equal($('[data-modal-box]'), null, 'the ceremony closed')
    assert.equal($('#view-profile').classList.contains('hidden'), false, 'the Profile view is shown')
    assert.deepEqual(errors, [])
  } finally {
    window.close()
  }
})

test('a reload never re-celebrates or duplicates the unlock', async () => {
  const first = await boot({ seed: seededPayload(10) })
  const stored = first.window.localStorage.getItem('kcc_state_v1')
  assert.ok(stored, 'the first visit persisted its state')
  first.window.close()

  const second = await boot({ storage: stored })
  try {
    assert.equal(second.$('[data-modal-box]'), null, 'no second ceremony after a refresh')
    assert.equal(second.$('.modal-unlock'), null)
    const state = second.state()
    assert.equal(Object.keys(state.achievements.unlocked).length, 1)
    assert.equal(second.window.CC.titlesInfo()[0].unlocked, true)
    assert.deepEqual(second.errors, [])
  } finally {
    second.window.close()
  }
})

test('locked progress is honest: 7 / 10 and 3 days to go on the Profile', async () => {
  const { window, errors, $, click, state } = await boot({ seed: seededPayload(7) })
  try {
    assert.equal($('[data-modal-box]'), null, 'no ceremony before ten days')
    const title = window.CC.titlesInfo()[0]
    assert.equal(title.unlocked, false)
    assert.equal(title.value, 7)
    assert.equal(title.percent, 70)
    assert.equal(title.remainingLabel, '3 DAYS TO GO')
    assert.equal(Object.keys(state().achievements.unlocked).length, 0, 'nothing is stamped early')

    // the dashboard carries the small progression strip
    const strip = $('#view-dashboard [data-open-title]')
    assert.ok(strip, 'the dashboard strip exists')
    assert.match(strip.textContent, /DISCIPLINE MONSTER/)
    assert.match(strip.textContent, /CURRENT STREAK/)
    assert.match(strip.textContent, /7/)
    assert.match(strip.textContent, /3 DAYS TO GO/)

    click('#view-dashboard [data-open-title]')
    await settle()
    assert.equal($('#view-profile').classList.contains('hidden'), false, 'the strip opens the Profile')

    const profile = $('#view-profile').textContent
    assert.match(profile, /MY TITLES/)
    assert.match(profile, /DISCIPLINE MONSTER/)
    assert.match(profile, /10 DAY PERFECT RUN/)
    assert.match(profile, /LOCKED/)
    assert.match(profile, /7 \/ 10 PERFECT DAYS/)
    assert.match(profile, /3 DAYS TO GO/)
    assert.match(profile, /LOCKED TITLES/)
    assert.match(profile, /FOCUS BEAST/, 'future titles are shown as coming soon')
    assert.doesNotMatch(profile, /(Share|Publish|Leaderboard|Public profile|Invite)/i, 'no social surface exists')

    // the tick strip has one cell per required day, seven of them lit
    const ticks = Array.from(window.document.querySelectorAll('#view-profile .title-tick'))
    assert.equal(ticks.length, 10)
    assert.equal(ticks.filter((tick) => tick.classList.contains('is-on')).length, 7)
    assert.equal(window.localStorage.getItem('kcc_title_share') === null, true, 'nothing is published or shared')
    assert.deepEqual(errors, [])
  } finally {
    window.close()
  }
})

test('an unlocked Profile shows the earned title with its unlock date', async () => {
  const { window, errors, $ } = await boot({ seed: seededPayload(12) })
  try {
    window.CC.switchView('profile')
    await settle()
    const card = $('#view-profile [data-title="discipline-monster"]')
    assert.ok(card, 'the title card rendered')
    assert.ok(card.classList.contains('is-unlocked'))
    assert.match(card.textContent, /UNLOCKED/)
    assert.match(card.textContent, /12 consecutive Perfect Days/)
    assert.doesNotMatch(card.textContent, /DAYS TO GO/, 'an earned title shows no countdown')
    const expectedDate = new Date().toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' })
    assert.ok(card.textContent.includes(expectedDate), `the local unlock date is shown (${expectedDate})`)
    assert.deepEqual(errors, [])
  } finally {
    window.close()
  }
})

test('the existing Focus Mission, tasks and timetable still work', async () => {
  const { window, errors, $, click, state } = await boot({ seed: null })
  try {
    // tasks: quick capture via the CC API + the modal form
    click('#quick-add-btn')
    await settle()
    const input = $('[data-modal-box] #capture-title')
    assert.ok(input, 'quick capture opened')
    input.value = 'Revise Modern History'
    $('[data-modal-box] form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    await settle()
    assert.ok(
      state().tasks.some((task) => task.title === 'Revise Modern History'),
      'the task was created',
    )

    // timetable: a block can still be ticked
    window.CC.switchView('timetable')
    await settle()
    window.document.querySelector('#view-timetable [data-block-toggle]').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    await settle()
    const today = window.CC.todayKey()
    assert.equal(state().completionLog[today].ttDone.length, 1, 'the block is marked complete')

    // focus mission: task → Focus Launch briefing → Focus Core → minimise
    const target = state().tasks.find((task) => task.title === 'Revise Modern History')
    window.CC.switchView('dashboard')
    window.CC.openFocusMode(target.id)
    await settle()
    const overlay = $('.focus-overlay')
    assert.ok(overlay, 'the focus overlay opened')
    assert.match(overlay.textContent, /Focus Mode/)
    click('#focus-launch-enter')
    await settle()
    assert.ok($('.focus-clock'), 'the Focus Core is running')
    assert.match($('#focus-phase').textContent, /WARMING UP/, 'the mission phases are intact')
    assert.ok(state().focus.active, 'the session is persisted')
    click('.focus-exit')
    await settle()
    assert.deepEqual(errors, [])
  } finally {
    window.close()
  }
})

test('nothing in the client talks to a network service about titles', async () => {
  const sources = [bundle]
  for (const source of sources) {
    assert.doesNotMatch(source, /supabase|firebase|firestore|leaderboard|share\(/i, 'no backend or social SDK is bundled')
  }
  // the title system stores everything under the app's existing local key
  const { window } = await boot({ seed: seededPayload(2) })
  try {
    const keys = Object.keys(window.localStorage)
    assert.deepEqual(keys, ['kcc_state_v1'], 'only the existing single local key is used')
    const stored = JSON.parse(window.localStorage.getItem('kcc_state_v1'))
    assert.ok(stored.achievements && stored.achievements.days, 'the history lives inside the existing state payload')
  } finally {
    window.close()
  }
})

after(() => {
  /* windows are closed per test */
})
