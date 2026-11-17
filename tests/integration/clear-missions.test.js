/**
 * Integration tests for the surgical mission clear.
 *
 * The user's ask, in their words: "delete all the mission data, only mission
 * data, so I can add new missions — do not delete any other data." These tests
 * run the real bundle in a real DOM with a real workspace and check the whole
 * journey:
 *
 *   • Settings offers the missions-only clear next to the full reset, and says
 *     honestly what it will remove and what it will keep
 *   • confirming empties the missions list, and goals, projects, routines and
 *     their history, the journal, HYB plans, focus sessions, study plans,
 *     timetables, day-plan snapshots, plain time blocks, protected time, score
 *     history, reviews, the assistant history and every preference are still
 *     exactly what they were — in memory and in localStorage
 *   • a safety copy is written first, and the toast's Undo puts everything back
 *   • cancelling changes nothing at all
 *   • the command palette can do it too
 *   • after the clear, a brand new mission can be added immediately
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
const { dateKey } = await import(path.join(root, 'src', 'client', 'lib', 'dates.js'))
const { MISSION_CLEAR_BACKUP_KEY } = await import(path.join(root, 'src', 'client', 'lib', 'clear-missions.js'))

let shell
let bundle

/** Store writes are debounced 350 ms, so anything persisted needs room. */
const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms))
const today = dateKey()

const MISSION_IDS = ['m1', 'm2', 'm3']

/** A lived-in workspace: three missions and a full life around them. */
function seedState() {
  return {
    version: STATE_VERSION,
    tasks: [
      { id: 'm1', title: 'Finish the mock test', date: today, priority: 'high', done: false, status: 'ready' },
      { id: 'm2', title: 'Read chapter 4', date: today, done: true, status: 'completed', completedAt: 42 },
      { id: 'm3', title: 'Someday: learn typing', inbox: true },
    ],
    goals: [{ id: 'g1', title: 'Clear the exam', why: 'For me' }],
    projects: [{ id: 'p1', title: 'Answer writing', goalId: 'g1' }],
    routines: [{ id: 'r1', title: 'Morning walk', time: '06:30', duration: 30, days: [1, 2, 3, 4, 5] }],
    routineHistory: { [today]: { r1: [] } },
    journal: { [today]: { note: 'Steady day.', win: 'Two missions done', nextStep: 'Revise polity', updatedAt: 10 } },
    hyb: { plans: [{ id: 'h1', title: 'GS sprint', kind: 'oneoff', date: today, startTime: '14:00', minutes: 50 }] },
    focus: {
      active: null,
      sessions: [{ id: 'f1', taskId: 'm1', mode: 'focus', plannedMinutes: 25, focusedSeconds: 1500, startedAt: 1, endedAt: 2, taskTitle: 'Finish the mock test' }],
    },
    timetables: { ssc_cgl_2027: [{ id: 'tt1', time: '08:00', title: 'Quant', duration: 60 }] },
    dayPlans: { ssc_cgl_2027: { [today]: [{ id: 'tt1', time: '08:00', title: 'Quant', duration: 60, cat: null }] } },
    top3: { [today]: ['m1', 'm2'] },
    completionLog: { [today]: { ttDone: ['tt1'], taskDone: ['m1', 'm2'] } },
    scoreHistory: { [today]: { score: 7, focusedMinutes: 25, top3Done: 2, top3Total: 3, computedAt: 11 } },
    reviews: { [today]: { intention: 'Keep it simple.', reflection: 'Good week.', updatedAt: 12 } },
    chatHistory: [{ role: 'user', text: 'Plan my day', ts: 13 }],
    schedule: {
      days: {
        [today]: [
          { id: 'b1', taskId: 'm1', title: 'Finish the mock test', time: '09:00', duration: 60, kind: 'mission' },
          { id: 'b2', title: 'Deep work', time: '11:00', duration: 90, kind: 'break' },
        ],
      },
      history: [],
    },
    reminders: { sent: { 'task:m1': 100, [`top3:${today}`]: 101, 'routine:r1': 102 } },
    settings: {
      protectedTime: [{ id: 'pt1', label: 'Sleep', start: '23:00', end: '06:00', days: [] }],
      theme: 'dark',
    },
    // suppress the daily briefing and onboarding so clicks land on the page
    briefing: { lastShownDay: today, intentions: { [today]: 'One thing at a time.' } },
    onboarding: { seen: true },
  }
}

const missionIds = (state) => state.tasks.map((t) => t.id).join(',')
const blockIds = (state, day) => (state.schedule.days[day] || []).map((b) => b.id).join(',')

/** Everything that must survive, as one comparable JSON string. */
function keptFingerprint(state) {
  return JSON.stringify({
    goals: state.goals,
    projects: state.projects,
    routines: state.routines,
    routineHistory: state.routineHistory,
    journal: state.journal,
    hyb: state.hyb,
    focus: state.focus,
    categories: state.categories,
    timetables: state.timetables,
    dayPlans: state.dayPlans,
    completionLog: Object.fromEntries(Object.entries(state.completionLog).map(([day, log]) => [day, log.ttDone])),
    scoreHistory: state.scoreHistory,
    reviews: state.reviews,
    chatHistory: state.chatHistory,
    protectedTime: state.settings.protectedTime,
    theme: state.settings.theme,
    missions: state.missions,
    briefing: state.briefing,
    version: state.version,
    plainBlocks: Object.fromEntries(
      Object.entries(state.schedule.days).map(([day, blocks]) => [day, blocks.filter((b) => !b.taskId).map((b) => b.id)]),
    ),
    reminderKeys: Object.keys(state.reminders.sent).filter((k) => !k.startsWith('task:') && !k.startsWith('top3:')).sort(),
  })
}

function createWindow(seed) {
  const virtualConsole = new VirtualConsole()
  const errors = []
  virtualConsole.on('jsdomError', (error) => errors.push(error.message))
  virtualConsole.on('error', (message) => errors.push(String(message)))

  const dom = new JSDOM(shell, { url: 'https://command-center.test/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole })
  const window = dom.window
  window.HTMLCanvasElement.prototype.getContext = () => null
  window.scrollTo = () => {}
  window.fetch = async () => new Response(JSON.stringify({ text: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } })
  if (seed !== null) window.localStorage.setItem('kcc_state_v1', JSON.stringify(seed))
  return { dom, window, errors }
}

async function boot({ seed = seedState(), view = null } = {}) {
  const { dom, window, errors } = createWindow(seed)
  const toasts = []
  window.eval(bundle)

  const container = window.document.getElementById('toast-container')
  new window.MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) if (node.textContent) toasts.push(node.textContent.trim())
    }
  }).observe(container, { childList: true })

  await settle(120)
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
    assert.ok(node, `element not found: ${target}`)
    node.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
  }
  const stored = () => JSON.parse(window.localStorage.getItem('kcc_state_v1'))
  const state = () => window.CC.getState()
  if (view) {
    window.CC.switchView(view)
    await settle(80)
  }
  return { dom, window, errors, toasts, $, $$, click, type, submit, stored, state }
}

before(async () => {
  shell = await (await worker.request('/')).text()
  bundle = await readFile(path.join(root, 'public', 'static', 'js', 'app.js'), 'utf8')
})

/* ------------------------------------------------------- the entry points */

test('Settings offers a missions-only clear beside the full reset', async () => {
  const { window, $, errors, state } = await boot({ view: 'settings' })
  try {
    assert.equal(errors.length, 0, `boot errors: ${errors.join(' | ')}`)
    assert.equal(typeof window.CC.clearAllMissions, 'function')
    assert.equal(typeof window.CC.confirmClearMissions, 'function')

    const button = $('[data-action="clear-missions"]')
    assert.ok(button, 'the button exists')
    assert.match(button.textContent, /Clear all missions/)

    const zone = button.closest('.danger-zone')
    assert.ok(zone.classList.contains('mission-clear-zone'), 'it has its own, gentler styling')
    assert.match(zone.textContent, /A fresh missions list/)
    // honest copy: the real numbers, and the promise about what stays
    assert.match(zone.textContent, /3 missions right now \(2 open, 1 done, 1 in the inbox\)/)
    assert.match(zone.textContent, /Kept exactly as they are: 1 goal, 1 project, 1 routine, 1 journal day, 1 HYB plan, 1 focus session/)
    assert.match(zone.textContent, /1 plain time block, 1 study-plan block/)
    assert.match(zone.textContent, /safety copy/)

    assert.ok($('[data-action="reset"]'), 'the full reset is still there, separately')
    assert.match($('[data-action="reset"]').textContent, /Reset workspace/)
    assert.equal(state().tasks.length, 3, 'nothing was cleared by looking at it')
  } finally {
    window.close()
  }
})

test('the command palette can clear missions too', async () => {
  const { window, $, $$, type, errors } = await boot()
  try {
    assert.equal(errors.length, 0, `boot errors: ${errors.join(' | ')}`)
    window.CC.openCommandPalette()
    await settle(60)
    type('#palette-query', 'clear all missions')
    await settle(60)
    const titles = $$('#palette-results [role="option"], #palette-results button, #palette-results li').map((n) => n.textContent)
    assert.ok(titles.some((t) => /Clear all missions/.test(t)), `palette results: ${titles.join(' | ')}`)
    assert.ok(titles.some((t) => /Empty the missions list only/.test(t)), 'the palette says it is missions only')
  } finally {
    window.close()
  }
})

/* ---------------------------------------------------------- the clear itself */

test('confirming empties the missions list and keeps every other byte', async () => {
  const { window, $, click, toasts, errors, state, stored } = await boot({ view: 'settings' })
  try {
    assert.equal(errors.length, 0, `boot errors: ${errors.join(' | ')}`)
    const before = keptFingerprint(state())
    assert.equal(window.localStorage.getItem(MISSION_CLEAR_BACKUP_KEY), null, 'no safety copy yet')

    click('[data-action="clear-missions"]')
    await settle(80)

    // the question shows real numbers and the promise
    const dialog = $('[data-modal-backdrop]')
    assert.ok(dialog, 'a confirmation dialog opened')
    assert.match(dialog.textContent, /Clear every mission\?/)
    assert.match(dialog.textContent, /3 missions \(2 open · 1 done · 1 in the inbox\)/)
    assert.match(dialog.textContent, /1 scheduled block placed by a mission/)
    assert.match(dialog.textContent, /2 Top 3 picks/)
    assert.match(dialog.textContent, /2 completion marks/)
    assert.match(dialog.textContent, /Kept: 1 goal · 1 project · 1 routine · 1 journal day · 1 HYB plan/)
    assert.equal($('[data-confirm]').textContent.trim(), 'Clear 3 missions')
    assert.ok($('[data-confirm]').classList.contains('btn-danger'), 'the confirm button reads as destructive')
    assert.equal(state().tasks.length, 3, 'asking changed nothing')

    click('[data-confirm]')
    await settle(500)

    // --- the missions are gone
    // (state() is a window-realm object, so everything is compared as text)
    assert.equal(state().tasks.length, 0)
    assert.equal(Object.keys(state().top3).length, 0)
    assert.equal(blockIds(state(), today), 'b2', 'only the mission-placed block went')
    assert.equal(JSON.stringify(state().completionLog[today]), JSON.stringify({ ttDone: ['tt1'], taskDone: [] }))
    assert.equal(Object.keys(state().reminders.sent).sort().join(','), 'routine:r1')

    // --- everything else is byte-for-byte what it was
    assert.equal(keptFingerprint(state()), before)

    // --- and the user was told the truth, with an Undo attached
    assert.match(toasts.join(' | '), /Missions cleared · 3 removed/)

    // --- and it is persisted, not just in memory
    const saved = stored()
    assert.deepEqual(saved.tasks, [])
    assert.equal(saved.goals.length, 1)
    assert.equal(saved.routines.length, 1)
    assert.equal(saved.journal[today].note, 'Steady day.')
    assert.equal(saved.hyb.plans.length, 1)
    assert.equal(saved.focus.sessions.length, 1)
    assert.equal(saved.timetables.ssc_cgl_2027.length, 1)
    assert.equal(keptFingerprint(saved), before)

    // --- a safety copy was written first, and it still holds the missions
    const copy = JSON.parse(window.localStorage.getItem(MISSION_CLEAR_BACKUP_KEY))
    assert.deepEqual(copy.tasks.map((t) => t.id), MISSION_IDS)
    assert.equal(copy.schedule.days[today].length, 2, 'the copy still has the whole schedule')
    assert.equal(copy.goals.length, 1)

  } finally {
    window.close()
  }
})

test('the toast reports what was removed and offers Undo', async () => {
  const { window, $, click, toasts, errors, state, stored } = await boot({ view: 'settings' })
  try {
    assert.equal(errors.length, 0, `boot errors: ${errors.join(' | ')}`)
    const before = keptFingerprint(state())
    // Array.from keeps the list in this realm, so it can be compared with deepEqual
    const ids = Array.from(state().tasks, (t) => t.id)

    click('[data-action="clear-missions"]')
    await settle(60)
    click('[data-confirm]')
    await settle(500)

    const message = toasts.join(' | ')
    assert.match(message, /Missions cleared · 3 removed/, `toasts: ${message}`)
    assert.match(message, /untouched/)

    const undo = $('.toast-action')
    assert.ok(undo, 'the toast carries an Undo')
    assert.equal(undo.textContent.trim(), 'Undo')

    // it landed where new missions can be added straight away
    assert.equal(window.document.querySelector('.nav-item[data-view="tasks"]')?.getAttribute('aria-current'), 'page')

    click(undo)
    await settle(500)

    assert.equal(missionIds(state()), ids.join(','), 'every mission is back')
    assert.equal(state().tasks[0].title, 'Finish the mock test')
    assert.equal(JSON.stringify(state().top3[today]), JSON.stringify(['m1', 'm2']))
    assert.equal(blockIds(state(), today), 'b1,b2', 'the mission block is back on the schedule')
    assert.equal(JSON.stringify(state().completionLog[today]), JSON.stringify({ ttDone: ['tt1'], taskDone: ['m1', 'm2'] }))
    assert.equal(keptFingerprint(state()), before, 'and nothing else moved either')
    assert.deepEqual(stored().tasks.map((t) => t.id), ids, 'the restore reached storage')
    assert.equal(keptFingerprint(stored()), before, 'storage agrees, byte for byte')
    assert.match(toasts.join(' | '), /Missions restored/)
  } finally {
    window.close()
  }
})

test('cancelling the dialog changes nothing at all', async () => {
  const { window, $, click, errors, state, stored } = await boot({ view: 'settings' })
  try {
    assert.equal(errors.length, 0, `boot errors: ${errors.join(' | ')}`)
    const snapshot = JSON.stringify(state())

    click('[data-action="clear-missions"]')
    await settle(60)
    assert.ok($('[data-modal-backdrop]'), 'the question is on screen')
    click('[data-cancel]')
    await settle(500)

    assert.equal($('[data-modal-backdrop]'), null, 'the dialog closed')
    assert.equal(state().tasks.length, 3)
    assert.equal(JSON.stringify(state()), snapshot)
    assert.equal(window.localStorage.getItem(MISSION_CLEAR_BACKUP_KEY), null, 'no safety copy is written for a cancelled clear')
    assert.equal(stored().tasks.length, 3)
  } finally {
    window.close()
  }
})

test('after the clear a brand new mission can be added immediately', async () => {
  const { window, $, click, type, submit, errors, state, stored } = await boot({ view: 'settings' })
  try {
    assert.equal(errors.length, 0, `boot errors: ${errors.join(' | ')}`)
    click('[data-action="clear-missions"]')
    await settle(60)
    click('[data-confirm]')
    await settle(500)
    assert.equal(state().tasks.length, 0)

    // the missions list is empty and inviting
    assert.match($('#view-tasks').textContent, /Your missions\./)
    assert.match($('#view-tasks').textContent, /A little room for what matters\./)

    click('#view-tasks [data-action="new-task"]')
    await settle(80)
    type('#task-title', 'Start the new syllabus')
    submit('#task-form')
    await settle(500)

    assert.equal(state().tasks.length, 1, 'exactly one mission, the new one')
    assert.equal(state().tasks[0].title, 'Start the new syllabus')
    assert.equal(stored().tasks.length, 1)
    // and the rest of the workspace is still around it
    assert.equal(state().goals.length, 1)
    assert.equal(state().routines.length, 1)
    assert.equal(state().hyb.plans.length, 1)
    assert.equal(state().timetables.ssc_cgl_2027.length, 1)
  } finally {
    window.close()
  }
})

/* ------------------------------------------------------------- the edges */

test('a workspace with no missions says so instead of pretending', async () => {
  const seed = seedState()
  seed.tasks = []
  seed.top3 = {}
  seed.completionLog = {}
  seed.schedule.days = {}
  const { window, $, click, toasts, errors, state } = await boot({ seed, view: 'settings' })
  try {
    assert.equal(errors.length, 0, `boot errors: ${errors.join(' | ')}`)
    assert.match($('.mission-clear-zone').textContent, /already empty/)

    const result = await window.CC.confirmClearMissions()
    await settle(80)
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'empty')
    assert.equal($('[data-modal-backdrop]'), null, 'no dialog for nothing')
    assert.match(toasts.join(' | '), /no missions to clear/i)
    assert.equal(state().goals.length, 1, 'still nothing else touched')
  } finally {
    window.close()
  }
})

test('clearing twice is harmless', async () => {
  const { window, click, errors, state, stored } = await boot({ view: 'settings' })
  try {
    assert.equal(errors.length, 0, `boot errors: ${errors.join(' | ')}`)
    const asked = window.CC.confirmClearMissions()
    await settle(60)
    click('[data-confirm]')
    const first = await asked
    await settle(500)
    assert.equal(first.ok, true)
    assert.equal(first.plan.missions, 3)
    assert.match(first.describe, /^Removed: 3 missions/)
    assert.equal(state().tasks.length, 0)

    const second = await window.CC.confirmClearMissions()
    await settle(500)
    assert.equal(second.ok, false)
    assert.equal(second.reason, 'empty')
    assert.equal(state().tasks.length, 0)
    assert.equal(stored().goals.length, 1)
  } finally {
    window.close()
  }
})

test('a workspace with no stored data at all still boots and clears safely', async () => {
  const { window, $, click, errors, state } = await boot({ seed: null, view: 'settings' })
  try {
    assert.equal(errors.length, 0, `boot errors: ${errors.join(' | ')}`)
    assert.ok($('.mission-clear-zone'), 'the zone is rendered for a brand new workspace')
    assert.match($('.mission-clear-zone').textContent, /already empty/)
    assert.equal(state().tasks.length, 0)
    assert.equal(state().version, STATE_VERSION)

    const result = await window.CC.confirmClearMissions()
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'empty')
  } finally {
    window.close()
  }
})
