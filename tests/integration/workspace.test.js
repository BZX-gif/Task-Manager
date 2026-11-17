/**
 * Integration tests for the 4.3 workspace additions:
 *
 *   • quick capture understands a natural-language sentence and shows it back
 *   • the parsed fields are what actually gets saved (date, time, estimate,
 *     priority, category, repetition)
 *   • the journal writes, edits and lists a real entry
 *   • the forecast renders two weeks and counts a scheduled mission
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

const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms))
const addDays = (key, days) => {
  const date = new Date(`${key}T12:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

async function boot() {
  const virtualConsole = new VirtualConsole()
  const errors = []
  virtualConsole.on('jsdomError', (error) => errors.push(error.message))
  virtualConsole.on('error', (message) => errors.push(String(message)))

  const dom = new JSDOM(shell, { url: 'https://command-center.test/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole })
  const window = dom.window
  window.HTMLCanvasElement.prototype.getContext = () => null
  window.scrollTo = () => {}
  window.fetch = async () => new Response(JSON.stringify({ text: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } })

  const toasts = []
  window.eval(bundle)
  const container = window.document.getElementById('toast-container')
  new window.MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) if (node.textContent) toasts.push(node.textContent.trim())
    }
  }).observe(container, { childList: true })

  await settle(90)
  return { dom, window, errors, toasts, document: window.document, $: (selector) => window.document.querySelector(selector) }
}

const type = (window, node, value) => {
  node.value = value
  node.dispatchEvent(new window.Event('input', { bubbles: true }))
}

before(async () => {
  shell = await (await worker.request('/')).text()
  bundle = await readFile(path.join(root, 'public', 'static', 'js', 'app.js'), 'utf8')
})

test('quick capture reads a natural sentence and saves exactly what it shows', async () => {
  const { window, errors, toasts, $ } = await boot()
  try {
    const today = window.CC.todayKey()
    const previewName = addDays(today, 1)
    window.CC.openQuickCapture()
    await settle(30)

    const titleInput = $('#capture-title')
    assert.ok(titleInput, 'quick capture opened')
    type(window, titleInput, 'Pay electricity bill tomorrow at 6pm for 45m !high #work')

    const preview = $('#capture-preview')
    assert.match(preview.textContent, /Tomorrow/)
    assert.match(preview.textContent, /6:00 pm/)
    assert.match(preview.textContent, /45m/)
    assert.match(preview.textContent, /High priority/)
    assert.match(preview.textContent, /Work/)
    assert.equal(preview.dataset.count, '5')

    // the pickers mirror the sentence, so nothing is saved invisibly
    assert.equal($('#capture-priority').value, 'high')
    assert.equal($('#capture-cat').value, 'work')
    assert.equal($('[data-date="' + previewName + '"]')?.classList.contains('preset-active'), true, 'tomorrow is selected')

    $('#capture-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    await settle(80)

    const task = window.CC.getState().tasks.at(-1)
    assert.equal(task.title, 'Pay electricity bill')
    assert.equal(task.date, previewName)
    assert.equal(task.time, '18:00')
    assert.equal(task.estimateMinutes, 45)
    assert.equal(task.priority, 'high')
    assert.equal(task.cat, 'work')
    assert.equal(task.recurrence, null)
    assert.ok(toasts.some((text) => /Mission added/.test(text)))
    assert.deepEqual(errors, [])
  } finally {
    window.close()
  }
})

test('quick capture turns repetition into a real series and Ctrl+Enter saves', async () => {
  const { window, errors, $ } = await boot()
  try {
    window.CC.openQuickCapture()
    await settle(30)
    const titleInput = $('#capture-title')
    type(window, titleInput, 'Deep work every weekday 9:00 90m #learning')
    assert.match($('#capture-preview').textContent, /Weekdays/)
    assert.equal($('#capture-repeat')?.checked, true, 'keeping the repetition is on by default')

    titleInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
    await settle(80)

    const task = window.CC.getState().tasks.at(-1)
    assert.equal(task.title, 'Deep work')
    assert.equal(task.estimateMinutes, 90)
    assert.equal(task.time, '09:00')
    assert.equal(task.cat, 'learning')
    assert.equal(task.recurrence.freq, 'weekdays')
    assert.equal(task.recurrence.weekdays.join(','), '1,2,3,4,5')
    assert.equal(task.seriesId, task.id, 'a repeating mission owns its series')
    assert.equal(task.occurrenceDate, window.CC.todayKey())
    assert.deepEqual(errors, [])
  } finally {
    window.close()
  }
})

test('the journal saves today, then yesterday shows up in the timeline', async () => {
  const { window, errors, toasts, $ } = await boot()
  try {
    const today = window.CC.todayKey()
    const yesterday = addDays(today, -1)
    window.CC.switchView('journal')
    await settle(40)
    assert.ok($('#view-journal .journal-compose'), 'journal view rendered')

    type(window, $('#journal-note'), 'Held the morning block and finally finished the draft.')
    $('#journal-win').value = 'Finished the draft'
    $('#journal-next').value = 'Send it before lunch'
    $('#view-journal [data-journal-mood="good"]').click()
    $('#journal-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    await settle(60)

    const saved = window.CC.getState().journal[today]
    assert.ok(saved, 'today has an entry')
    assert.match(saved.note, /Held the morning block/)
    assert.equal(saved.win, 'Finished the draft')
    assert.equal(saved.nextStep, 'Send it before lunch')
    assert.equal(saved.mood, 'good')
    assert.ok(toasts.some((text) => /Entry saved/.test(text)))

    $('#view-journal [data-journal-day="' + yesterday + '"]').click()
    await settle(30)
    type(window, $('#journal-note'), 'A slower day, but I showed up.')
    $('#view-journal [data-journal-energy="low"]').click()
    $('#journal-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    await settle(60)

    assert.ok(window.CC.getState().journal[yesterday], 'yesterday has an entry')
    $('#view-journal [data-journal-day="' + today + '"]').click()
    await settle(30)
    assert.match($('#view-journal .journal-timeline').textContent, /A slower day/)
    assert.match($('#view-journal .journal-metrics').textContent, /Entries/)
    assert.deepEqual(errors, [])
  } finally {
    window.close()
  }
})

test('the forecast renders two weeks and counts a scheduled mission', async () => {
  const { window, errors, $ } = await boot()
  try {
    const today = window.CC.todayKey()
    const tomorrow = addDays(today, 1)

    window.CC.openQuickCapture()
    await settle(25)
    type(window, $('#capture-title'), 'Draft the proposal tomorrow 3pm 90m !high #work')
    $('#capture-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    await settle(60)

    window.CC.switchView('forecast')
    await settle(50)

    const view = $('#view-forecast')
    assert.ok(view.querySelector('.forecast-advice'), 'advice banner rendered')
    assert.equal(view.querySelectorAll('.forecast-day').length, 14)
    assert.ok(view.querySelector('#forecastChart'), 'chart canvas present')
    assert.match(view.querySelector('.forecast-metrics').textContent, /Committed time/)
    const tomorrowCard = view.querySelector('[data-forecast-day="' + tomorrow + '"]')
    assert.ok(tomorrowCard, 'tomorrow has a card')
    assert.match(tomorrowCard.textContent, /1h 30m/)

    // the horizon switch re-renders with 30 days
    view.querySelector('[data-forecast-horizon="30"]').click()
    await settle(30)
    assert.equal($('#view-forecast').querySelectorAll('.forecast-day').length, 30)
    assert.deepEqual(errors, [])
  } finally {
    window.close()
  }
})

test('the shortcut sheet opens on ? and documents the new keys', async () => {
  const { window, errors, $ } = await boot()
  try {
    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: '?', bubbles: true }))
    await settle(40)
    const sheet = $('.shortcut-sheet')
    assert.ok(sheet, 'shortcut sheet opened')
    assert.match(sheet.textContent, /Journal/)
    assert.match(sheet.textContent, /Forecast/)
    assert.match(sheet.textContent, /Quick capture/)
    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    assert.equal($('#modal-root .shortcut-sheet'), null, 'Escape closes it')
    assert.equal($('#modal-root [data-modal-backdrop]'), null)
    assert.deepEqual(errors, [])
  } finally {
    window.close()
  }
})

test('version 4.3 is visible in the shell and the client', async () => {
  const { window, $ } = await boot()
  try {
    assert.equal(window.CC.version, '5.0')
    assert.equal($('#app-version').textContent, 'v5.0')
    const state = window.CC.getState()
    assert.equal(state.version, 8, 'schema v8 carries the journal and the ledger')
    assert.equal(Object.keys(state.journal).length, 0)
  } finally {
    window.close()
  }
})
