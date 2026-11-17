/**
 * Integration tests for Command 5.0:
 *
 *   • the closing ritual carries work, sets tomorrow’s three and writes the
 *     journal entry only after confirmation
 *   • deleting a mission is reversible from Recently deleted
 *   • the command palette searches missions, notes and journal entries with
 *     grouped, highlighted results
 *   • a calendar export produces a real .ics and a day sheet prints
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

let shell
let bundle

const settle = (ms = 70) => new Promise((resolve) => setTimeout(resolve, ms))

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
  window.URL.createObjectURL = () => 'blob:command-test'
  window.URL.revokeObjectURL = () => {}
  window.HTMLAnchorElement.prototype.click = function noop() {}

  const toasts = []
  window.eval(bundle)
  const container = window.document.getElementById('toast-container')
  new window.MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) if (node.textContent) toasts.push(node.textContent.trim())
    }
  }).observe(container, { childList: true })

  await settle(90)
  return { dom, window, errors, toasts, document: window.document, $: (selector) => window.document.querySelector(selector), $$: (selector) => [...window.document.querySelectorAll(selector)] }
}

const type = (window, node, value) => {
  node.value = value
  node.dispatchEvent(new window.Event('input', { bubbles: true }))
}

async function createMission(window, $, title, extra = {}) {
  window.CC.openTaskModal()
  await settle(30)
  type(window, $('#task-title'), title)
  for (const [selector, value] of Object.entries(extra)) {
    const node = $(selector)
    if (!node) continue
    if (node.type === 'checkbox') node.checked = value
    else node.value = value
  }
  $('#task-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
  await settle(80)
  return window.CC.getState().tasks.find((task) => task.title === title)
}

before(async () => {
  shell = await (await worker.request('/')).text()
  bundle = await readFile(path.join(root, 'public', 'static', 'js', 'app.js'), 'utf8')
})

test('the closing ritual carries work, sets tomorrow’s three and writes the journal', async () => {
  const { window, errors, toasts, $ } = await boot()
  try {
    const today = window.CC.todayKey()
    const first = await createMission(window, $, 'Finish the board memo')
    const second = await createMission(window, $, 'Call the architect')
    assert.ok(first && second, 'both missions were created')

    window.CC.openShutdown()
    await settle(40)
    assert.ok($('#ritual-note'), 'the closing screen opened')
    assert.match($('.ritual-hero h4').textContent, /./)

    const carry = $(`[data-carry="${first.id}"]`)
    assert.equal(carry.checked, true, 'open work is suggested for tomorrow by default')
    $(`[data-priority="${first.id}"]`).click()
    $(`[data-priority="${second.id}"]`).click()
    assert.equal($('[data-priority-count]').textContent.trim(), '2 / 3 chosen')

    type(window, $('#ritual-note'), 'The memo needed one more hour. It can wait.')
    type(window, $('#ritual-win'), 'A clear conversation with the team.')
    $('[data-ritual-mood="good"]').click()

    $('#modal-root [data-close-day]').click()
    await settle(100)

    const state = window.CC.getState()
    const tomorrow = state.tasks.filter((task) => task.date !== today && !task.inbox)
    assert.equal(tomorrow.length, 2, 'carried work moved to tomorrow')
    assert.ok(state.shutdowns[today]?.closed, 'the day is recorded as closed')
    assert.equal([...state.top3[state.shutdowns[today].tomorrow]].sort().join(','), [first.id, second.id].sort().join(','))
    assert.equal(state.journal[today].note, 'The memo needed one more hour. It can wait.')
    assert.equal(state.journal[today].win, 'A clear conversation with the team.')
    assert.equal(state.journal[today].mood, 'good')
    assert.ok(toasts.some((text) => /Day closed/.test(text)))
    assert.equal($('#ritual-chip')?.classList.contains('is-closed'), true)

    // Reopening keeps the note and reopens the ritual.
    $('#ritual-chip').click()
    await settle(40)
    $('[data-reopen-day]').click()
    await settle(80)
    assert.equal(window.CC.getState().shutdowns[today], undefined)
    assert.equal(window.CC.getState().journal[today].note, 'The memo needed one more hour. It can wait.')
    assert.deepEqual(errors, [])
  } finally {
    window.close()
  }
})

test('deleting a mission is reversible from Recently deleted', async () => {
  const { window, errors, $, $$ } = await boot()
  try {
    const mission = await createMission(window, $, 'Send the invoice')
    window.CC.trashMission(mission.id)
    await settle(80)
    assert.equal(window.CC.getState().tasks.some((task) => task.id === mission.id), false)
    assert.equal(window.CC.getState().trash.length, 1)

    window.CC.openTrashManager()
    await settle(40)
    assert.match($('.trash-row strong').textContent, /Send the invoice/)
    $('[data-trash-restore]').click()
    await settle(80)
    assert.ok(window.CC.getState().tasks.some((task) => task.id === mission.id), 'the mission is back')
    assert.equal(window.CC.getState().trash.length, 0)
    assert.deepEqual(errors, [])
  } finally {
    window.close()
  }
})

test('the palette searches missions, notes and journal entries with grouped results', async () => {
  const { window, errors, $, $$ } = await boot()
  try {
    await createMission(window, $, 'Draft the investor update')
    await createMission(window, $, 'Book the flights')
    const state = window.CC.getState()
    state.journal[window.CC.todayKey()] = { note: 'The investor update finally tells the truth about retention.', win: '', nextStep: '', mood: null, energy: null, updatedAt: Date.now() }

    window.CC.openCommandPalette()
    await settle(30)
    type(window, $('#palette-query'), 'investor')
    await settle(30)

    const labels = $$('.palette-group-label').map((node) => node.textContent.replace(/\d+$/, '').trim())
    assert.ok(labels.some((label) => /Missions/.test(label)), 'mission results are grouped')
    assert.ok(labels.some((label) => /Journal/.test(label)), 'journal results are grouped')
    assert.ok($('.palette-result mark'), 'the match is highlighted')
    assert.match($('.palette-result mark').textContent.toLowerCase(), /investor/)

    $('#palette-query').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle(60)
    assert.ok($('#task-title'), 'Enter opened the matching mission')
    assert.match($('#task-title').value, /investor/i)

    // Clicking a result after typing works too (results are re-rendered).
    window.CC.closeModal()
    window.CC.openCommandPalette()
    await settle(30)
    type(window, $('#palette-query'), 'flights')
    await settle(40)
    const target = $$('.palette-result').find((node) => /Book the flights/.test(node.textContent))
    assert.ok(target, 'the second mission is found by clicking')
    target.click()
    await settle(60)
    assert.match($('#task-title').value, /Book the flights/)
    assert.deepEqual(errors, [])
  } finally {
    window.close()
  }
})

test('the day sheet and calendar export use real commitments', async () => {
  const { window, errors, toasts, $ } = await boot()
  try {
    const today = window.CC.todayKey()
    await createMission(window, $, 'Deep work block', { '#task-time': '09:00', '#task-estimate': '90' })
    window.CC.openPrintSheet(today)
    await settle(50)
    assert.ok($('#print-sheet'), 'the sheet rendered')
    assert.match($('#print-sheet').textContent, /Deep work block/)
    assert.match($('#print-sheet').textContent, /Today’s three|The shape of the day/)

    window.CC.closeModal()
    const result = window.CC.exportCalendar({ from: today, days: 1 })
    assert.equal(result.ok, true)
    assert.ok(result.events >= 1)
    assert.match(result.filename, /\.ics$/)
    await settle(80)
    assert.ok(toasts.some((text) => /exported/.test(text)))
    assert.deepEqual(errors, [])
  } finally {
    window.close()
  }
})
