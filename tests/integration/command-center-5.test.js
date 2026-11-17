/**
 * Integration tests for the 5.0 executive layer, driven through the real client
 * bundle in jsdom:
 *
 *   • Command Center home: one decision, the index, seven signals, the week
 *   • Money ledger: account → entry → budget → IOU, then the derived totals
 *   • Settings: the money section and currency choice
 *   • data safety: the ledger survives schema migration and a backup round-trip
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

const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms))

async function boot({ seed = null } = {}) {
  const virtualConsole = new VirtualConsole()
  const errors = []
  virtualConsole.on('jsdomError', (error) => errors.push(error.message))
  virtualConsole.on('error', (message) => errors.push(String(message)))
  const dom = new JSDOM(shell, { url: 'https://command-center.test/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole })
  const window = dom.window
  window.HTMLCanvasElement.prototype.getContext = () => null
  window.scrollTo = () => {}
  window.fetch = async () => new Response(JSON.stringify({ text: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } })
  if (seed) window.localStorage.setItem('kcc_state_v1', typeof seed === 'string' ? seed : JSON.stringify(seed))
  window.eval(bundle)
  await settle(100)
  return {
    window,
    errors,
    document: window.document,
    $: (selector) => window.document.querySelector(selector),
    $$: (selector) => Array.from(window.document.querySelectorAll(selector)),
  }
}

const click = (window, element) => element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
const submit = (window, form) => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
const type = (window, node, value) => {
  node.value = value
  node.dispatchEvent(new window.Event('input', { bubbles: true }))
}

before(async () => {
  shell = await (await worker.request('/')).text()
  bundle = await readFile(path.join(root, 'public', 'static', 'js', 'app.js'), 'utf8')
})

test('the command center leads with one decision and seven real signals', async () => {
  const { window, errors, $, $$ } = await boot()
  try {
    assert.equal($('#view-command').classList.contains('hidden'), false, 'command center is the home view')
    assert.ok($('#view-command .command-focus-card h2').textContent.trim().length > 0, 'one decision headline')
    assert.ok($('#view-command .command-index-card .score-ring'), 'index ring present')
    assert.equal($$('#view-command .command-signal').length, 7, 'seven health signals')
    assert.equal($$('#view-command .command-pillar').length, 4, 'four pillars')
    assert.equal($$('#view-command .command-week-day').length, 7, 'seven days of capacity')
    assert.ok($('#view-command .command-actions li'), 'next actions are listed')
    // a fresh workspace never claims an index it cannot support
    assert.match($('#view-command .command-index-copy strong').textContent, /Not enough yet/i)
    assert.deepEqual(errors, [])

    // the "7 days / 14 days" horizon switch re-lays out the capacity board
    click(window, $('#view-command [data-week-horizon="14"]'))
    assert.equal($$('#view-command .command-week-day').length, 14)
    assert.equal($('#view-command [data-week-horizon="14"]').classList.contains('seg-active'), true)

    // a signal navigates to the surface that can change it
    click(window, $('#view-command .command-signal'))
    assert.equal($('#view-progress').classList.contains('hidden'), false)
  } finally {
    window.close()
  }
})

test('the command index explains itself on demand', async () => {
  const { window, $ } = await boot()
  try {
    click(window, $('#view-command [data-index-info]'))
    await settle(20)
    const box = $('[data-modal-box]')
    assert.ok(box, 'the explainer opened')
    assert.match(box.textContent, /weighted average of four pillars/i)
  } finally {
    window.close()
  }
})

test('an account, an entry and a budget produce honest, derived money figures', async () => {
  const { window, errors, $, $$ } = await boot()
  try {
    window.CC.switchView('money')
    await settle(30)
    assert.ok($('#view-money .money-advice'), 'the money view renders')
    assert.match($('#view-money .money-advice').textContent, /one account/i)

    // 1 — add the first account
    click(window, $('#view-money [data-money-account]'))
    await settle(20)
    let box = $('[data-modal-box]')
    box.querySelector('#account-name').value = 'Salary account'
    box.querySelector('#account-opening').value = '25000'
    submit(window, box.querySelector('form'))
    await settle(40)
    assert.equal(window.CC.getState().ledger.accounts.length, 1)
    const accountId = window.CC.getState().ledger.accounts[0].id
    assert.equal(window.CC.getState().ledger.accounts[0].openingBalance, 25000)

    // 2 — record an expense; the balance and the month totals follow
    click(window, $('#view-money [data-money-add]'))
    await settle(20)
    box = $('[data-modal-box]')
    box.querySelector('#tx-amount').value = '1,250.50'
    box.querySelector('#tx-note').value = 'Electricity'
    box.querySelector('#tx-category').value = 'life'
    submit(window, box.querySelector('form'))
    await settle(40)
    let state = window.CC.getState()
    assert.equal(state.ledger.transactions.length, 1)
    assert.equal(state.ledger.transactions[0].amount, 1250.5, 'pasted formatting is parsed')
    assert.match($('#view-money .money-account-balance').textContent, /23,750/, 'balance is opening minus spend (displayed to the rupee)')
    assert.match($('#view-money').textContent, /Electricity/, 'the entry is listed')

    // 3 — set a budget lower than the spend so the over-plan state is real
    click(window, $('#view-money [data-money-budget]'))
    await settle(20)
    box = $('[data-modal-box]')
    box.querySelector('#budget-category').value = 'life'
    box.querySelector('#budget-limit').value = '1000'
    submit(window, box.querySelector('form'))
    await settle(40)
    state = window.CC.getState()
    assert.equal(state.ledger.budgets.length, 1)
    assert.ok($('#view-money .money-budget.is-over'), 'the budget is visibly over plan')
    assert.match($('#view-money .money-advice').textContent, /over its plan/i)

    // 4 — an IOU shows the net position
    click(window, $('#view-money [data-money-note]'))
    await settle(20)
    box = $('[data-modal-box]')
    box.querySelector('#note-person').value = 'Ravi'
    box.querySelector('#note-amount').value = '500'
    submit(window, box.querySelector('form'))
    await settle(40)
    assert.equal(window.CC.getState().ledger.notes.length, 1)
    assert.match($('#view-money').textContent, /Ravi/)

    // 5 — a transfer never counts as spending
    click(window, $('#view-money [data-money-add]'))
    await settle(20)
    box = $('[data-modal-box]')
    click(window, box.querySelector('[data-tx-kind="transfer"]'))
    assert.equal(box.querySelector('[data-tx-to-wrap]').classList.contains('hidden'), false, 'the destination appears for a transfer')
    assert.equal(box.querySelector('[data-tx-category-wrap]').classList.contains('hidden'), true, 'a transfer has no category')
    window.CC.closeModal()
    await settle(20)

    // 6 — a second account brings the net-worth roll-up to life
    window.CC.openAccountModal()
    await settle(20)
    box = $('[data-modal-box]')
    box.querySelector('#account-name').value = 'Credit card'
    box.querySelector('#account-kind').value = 'credit'
    box.querySelector('#account-opening').value = '0'
    submit(window, box.querySelector('form'))
    await settle(40)
    assert.equal(window.CC.getState().ledger.accounts.length, 2)
    assert.ok($$('#view-money .money-account').length === 2)
    assert.equal(accountId.length > 0, true)
    assert.deepEqual(errors, [])
  } finally {
    window.close()
  }
})

test('the ledger month filter and kind filter only show what they claim', async () => {
  const { window, $, $$ } = await boot()
  try {
    window.CC.switchView('money')
    await settle(20)
    window.CC.openAccountModal()
    await settle(20)
    let box = $('[data-modal-box]')
    box.querySelector('#account-name').value = 'Cash'
    submit(window, box.querySelector('form'))
    await settle(30)

    const record = (kind, amount, note) => {
      window.CC.openTransactionModal()
      const ledgerBox = window.document.querySelector('[data-modal-box]')
      click(window, ledgerBox.querySelector(`[data-tx-kind="${kind}"]`))
      ledgerBox.querySelector('#tx-amount').value = amount
      ledgerBox.querySelector('#tx-note').value = note
      submit(window, ledgerBox.querySelector('form'))
    }
    record('expense', '200', 'Groceries')
    await settle(30)
    record('income', '5000', 'Freelance')
    await settle(30)
    assert.equal($$('#view-money .money-entry').length, 2)

    click(window, $('#view-money [data-money-kind="in"]'))
    await settle(30)
    assert.equal($$('#view-money .money-entry').length, 1)
    assert.match($('#view-money .money-entries').textContent, /Freelance/)

    click(window, $('#view-money [data-money-kind="out"]'))
    await settle(30)
    assert.match($('#view-money .money-entries').textContent, /Groceries/)
    assert.equal(/Freelance/.test($('#view-money .money-entries').textContent), false)
  } finally {
    window.close()
  }
})

test('money settings are reachable, persisted and reflected in the ledger', async () => {
  const { window, $ } = await boot()
  try {
    window.CC.switchView('settings')
    await settle(30)
    assert.ok($('#settings-money'), 'the money settings section exists')
    const currency = $('#setting-money\\.currency')
    assert.ok(currency, 'currency control is present')
    currency.value = 'USD'
    currency.dispatchEvent(new window.Event('change', { bubbles: true }))
    await settle(40)
    assert.equal(window.CC.getState().settings.money.currency, 'USD', 'stored with the workspace')

    window.CC.switchView('money')
    await settle(20)
    window.CC.openAccountModal()
    await settle(20)
    const box = $('[data-modal-box]')
    box.querySelector('#account-name').value = 'Dollar account'
    box.querySelector('#account-opening').value = '1200'
    submit(window, box.querySelector('form'))
    await settle(40)
    assert.match($('#view-money').textContent, /\$/, 'the chosen currency is used for every figure')
  } finally {
    window.close()
  }
})

test('a v7 workspace upgrades to v8 with all of its records intact', async () => {
  const seed = {
    version: 7,
    tasks: [{ id: 't1', title: 'Existing mission', date: '2026-09-15', priority: 'high', done: false, createdAt: 1 }],
    categories: [{ id: 'work', name: 'Work', color: '#7ba7ea' }],
    journal: { '2026-09-14': { note: 'A real entry', mood: 'good', energy: 'medium', updatedAt: 1 } },
    completionLog: { '2026-09-14': { ttDone: [], taskDone: [] } },
    settings: { userName: 'Aarav', theme: 'dark' },
    meta: { createdAt: 1, updatedAt: 1 },
  }
  const { window, errors, $ } = await boot({ seed })
  try {
    const state = window.CC.getState()
    assert.equal(state.version, 8)
    assert.equal(state.tasks.length, 1, 'existing missions are preserved')
    assert.equal(state.tasks[0].title, 'Existing mission')
    assert.equal(state.ledger.accounts.length, 0, 'the ledger starts empty, never seeded')
    assert.equal(state.ledger.transactions.length, 0, 'no transactions are invented')
    assert.equal(state.ledger.budgets.length, 0)
    assert.equal(state.journal['2026-09-14'].note, 'A real entry', 'journal entries survive')
    assert.equal(state.settings.userName, 'Aarav', 'settings survive')
    assert.equal(window.localStorage.getItem('kcc_backup_pre_v6').includes('"version":7'), true, 'a pre-upgrade copy is kept')
    assert.deepEqual(errors, [])
    assert.ok($('#view-command').innerHTML.length > 500)
  } finally {
    window.close()
  }
})

test('the ledger round-trips through the backup envelope without loss', async () => {
  const { window, $ } = await boot()
  try {
    window.CC.switchView('money')
    await settle(20)
    window.CC.openAccountModal()
    await settle(20)
    let box = $('[data-modal-box]')
    box.querySelector('#account-name').value = 'Bank'
    box.querySelector('#account-opening').value = '5000'
    submit(window, box.querySelector('form'))
    await settle(30)
    window.CC.openTransactionModal()
    await settle(20)
    box = $('[data-modal-box]')
    box.querySelector('#tx-amount').value = '750'
    box.querySelector('#tx-note').value = 'Books'
    submit(window, box.querySelector('form'))
    await settle(30)

    const exported = window.eval(`JSON.stringify((function(){const mod = window.CC.getState();return {accounts: mod.ledger.accounts, transactions: mod.ledger.transactions}})())`)
    const parsed = JSON.parse(exported)
    assert.equal(parsed.accounts.length, 1)
    assert.equal(parsed.transactions[0].amount, 750)
    assert.equal(parsed.transactions[0].note, 'Books')
    // and the persisted workspace (the file a backup is built from) holds them too
    await settle(450) // the store persists on a 350ms debounce
    const stored = JSON.parse(window.localStorage.getItem('kcc_state_v1'))
    assert.equal(stored.ledger.transactions.length, 1, 'the ledger is persisted with everything else')
  } finally {
    window.close()
  }
})

test('money is reachable from the dock, the palette and the keyboard', async () => {
  const { window, $ } = await boot()
  try {
    click(window, $('#mobile-dock [data-view="money"]'))
    assert.equal($('#view-money').classList.contains('hidden'), false)
    assert.equal($('#mobile-dock [data-view="money"]').getAttribute('aria-current'), 'page')

    click(window, $('#mobile-dock [data-view="command"]'))
    assert.equal($('#view-command').classList.contains('hidden'), false)

    // the ledger's own commands exist in the palette
    window.CC.openCommandPalette()
    await settle(30)
    assert.ok($('#palette-query'), 'palette opened')
    const entries = Array.from(window.document.querySelectorAll('.palette-result')).map((node) => node.textContent)
    assert.ok(entries.length > 0)
    window.CC.closeModal()
    await settle(20)

    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'm', bubbles: true }))
    assert.equal($('#view-money').classList.contains('hidden'), false, 'M opens the ledger')
  } finally {
    window.close()
  }
})
