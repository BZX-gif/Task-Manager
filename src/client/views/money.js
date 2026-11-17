/* -------------------------------------------------------------------------
   MONEY — the private ledger's one screen
   -------------------------------------------------------------------------
   Three questions, answered from real records only:

     1. Where does the money actually sit?          → accounts + net worth
     2. What happened this month?                   → cashflow + categories
     3. What is already promised to leave?          → budgets + recurring + IOUs

   Every figure is derived in lib/ledger.js. This file is presentation plus the
   small editors that write through `commit()` like the rest of the app.
   ------------------------------------------------------------------------- */

import { state, commit, currentDayKey } from '../core/store.js'
import { closeModal, confirmDialog, escapeHtml, openModal, qs, qsa, toast } from '../core/dom.js'
import { addDays, formatDuration, formatKeyLabel, monthKey } from '../lib/dates.js'
import { uid } from '../lib/state.js'
import {
  ACCOUNT_KINDS,
  CADENCES,
  accountSummary,
  budgetStatus,
  cashflowSeries,
  categorySpend,
  formatMoney,
  monthSummary,
  moneyAdvice,
  moneyShort,
  netWorthHistory,
  nextChargeDate,
  noteSummary,
  parseMoney,
  plannedBudget,
  recurringMonthlyTotal,
  transactionsInMonth,
  transactionsToCsv,
  upcomingObligations,
} from '../lib/ledger.js'
import { drawChart, chartColors } from '../core/charts.js'
import { icon, pageHeading, metric, empty, bindCommon } from '../ui/common.js'
import { categoryOptions } from './shared.js'

/** '' = all, 'in' = money in, 'out' = money out, <kind> = that transaction kind */
let searchTerm = ''
let kindFilter = ''
let monthOffset = 0

const KIND_LABEL = { expense: 'Expense', income: 'Income', transfer: 'Transfer', adjustment: 'Adjustment' }
const KIND_ICON = { expense: 'receipt', income: 'coins', transfer: 'repeat', adjustment: 'scale' }
const CADENCE_LABEL = { weekly: 'week', monthly: 'month', quarterly: 'quarter', yearly: 'year' }

const currency = () => state.settings.money?.currency || 'INR'
const money = (value, options = {}) => formatMoney(value, { currency: currency(), ...options })
const short = (value) => moneyShort(value, currency())

function shiftMonth(key, offset) {
  const [year, month] = key.split('-').map(Number)
  const total = year * 12 + (month - 1) + offset
  const nextYear = Math.floor(total / 12)
  const nextMonth = ((total % 12) + 12) % 12
  return `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}`
}

function monthLabel(key) {
  const [year, month] = key.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export function renderMoney() {
  const section = document.getElementById('view-money')
  if (!section) return
  const today = currentDayKey()
  const month = shiftMonth(monthKey(today), monthOffset)
  const isCurrent = month === monthKey(today)
  const ledger = state.ledger || { accounts: [], transactions: [], budgets: [], recurring: [], notes: [] }
  const categories = state.categories
  const accounts = accountSummary(ledger)
  const summary = monthSummary(ledger, month, { categories })
  const budgets = budgetStatus(ledger, month, categories)
  const spend = categorySpend(ledger, month, categories)
  const advice = moneyAdvice(ledger, { todayKey: today, month, categories, currency: currency() })
  const notes = noteSummary(ledger)
  const recurringTotal = recurringMonthlyTotal(ledger)
  const planned = plannedBudget(ledger)
  const dueSoon = upcomingObligations(ledger, { todayKey: today, days: 30, currency: currency() })
  const recent = visibleTransactions(month)

  section.innerHTML = `
    ${pageHeading(
      'PRIVATE BY DESIGN',
      'Your money, honestly.',
      'Accounts, spending and what is already promised. Stored on this device only — no bank connection, no account, nothing uploaded.',
      `<button class="btn-ghost" data-money-export>${icon('download')}Export CSV</button>
       <button class="btn-primary" data-money-add>${icon('plus')}Record entry</button>`,
    )}
    <div class="money-month-bar">
      <div class="money-month-nav">
        <button class="icon-btn" data-money-month="-1" aria-label="Previous month">${icon('left')}</button>
        <strong>${escapeHtml(monthLabel(month))}</strong>
        <button class="icon-btn" data-money-month="1" aria-label="Next month" ${monthOffset >= 0 ? 'disabled' : ''}>${icon('chevron')}</button>
        ${isCurrent ? '' : `<button class="btn btn-secondary btn-small" data-money-month="reset">This month</button>`}
      </div>
      <div class="segmented" aria-label="Filter entries">
        ${[['', 'All'], ['out', 'Money out'], ['in', 'Money in'], ['transfer', 'Transfers']].map(([key, label]) => `<button data-money-kind="${key}" class="${kindFilter === key ? 'seg-active' : ''}" aria-pressed="${kindFilter === key}">${label}</button>`).join('')}
      </div>
    </div>
    <div class="money-advice money-advice--${advice.tone}" role="status">
      <span class="money-advice-icon">${icon(advice.tone === 'warn' ? 'bolt' : advice.tone === 'good' ? 'leaf' : 'info')}</span>
      <div><strong>${escapeHtml(advice.title)}</strong><p>${escapeHtml(advice.body)}</p></div>
    </div>
    <div class="metric-strip money-metrics">
      ${metric('coins', 'Money in', money(summary.income), `${summary.txCount} entries recorded this month`)}
      ${metric('receipt', 'Money out', money(summary.expense), summary.largest ? `${escapeHtml(summary.largest.name)} is the largest area` : 'Nothing spent yet')}
      ${metric('scale', 'Kept this month', money(summary.net, { sign: true }), summary.savingsRate == null ? 'Record income to see a rate' : `${summary.savingsRate}% of income kept`)}
      ${metric('wallet', 'Net worth', money(accounts.netWorth), `${accounts.active.length} account${accounts.active.length === 1 ? '' : 's'} · ${money(accounts.owed)} owed`)}
    </div>
    <div class="money-grid">
      <article class="card money-flow-card">
        <div class="card-header">
          <div><h3>Am I ahead or behind?</h3><p class="meta">Running net movement through ${escapeHtml(monthLabel(month))} — transfers excluded</p></div>
          <div class="chart-legend"><span><i></i>Cumulative</span></div>
        </div>
        <div class="chart-wrap money-chart"><canvas id="moneyFlowChart" role="img" aria-label="Cumulative net cash movement through ${escapeHtml(monthLabel(month))}"></canvas></div>
        <details class="chart-data"><summary>View the cashflow data</summary>
          <table><thead><tr><th>Day</th><th>Net change</th><th>Cumulative</th></tr></thead><tbody>
            ${cashflowSeries(ledger, month).filter((row) => row.change || row.cumulative).map((row) => `<tr><td>${row.date}</td><td>${money(row.change, { sign: true })}</td><td>${money(row.cumulative, { sign: true })}</td></tr>`).join('') || '<tr><td colspan="3">No entries recorded for this month yet.</td></tr>'}
          </tbody></table>
        </details>
      </article>
      <article class="card">
        <div class="card-header"><div><h3>Where it went</h3><p class="meta">${summary.expense ? `${money(summary.expense)} across ${spend.length} categor${spend.length === 1 ? 'y' : 'ies'}` : 'No spending recorded yet'}</p></div>${icon('target')}</div>
        ${spend.length
          ? `<div class="money-breakdown">${spend.slice(0, 7).map((row) => `<div class="money-breakdown-row"><span class="money-breakdown-label"><i class="legend-dot" style="background:${escapeHtml(row.color)}"></i>${escapeHtml(row.name)}</span><div class="progress-track"><div class="progress-fill" style="width:${row.share}%;background:${escapeHtml(row.color)}"></div></div><strong>${money(row.total)}</strong><small>${row.share}%</small></div>`).join('')}</div>`
          : empty('receipt', 'The month is a blank page.', 'Record an expense and this breakdown becomes your most useful chart.')}
      </article>
    </div>
    <div class="money-grid money-grid--split">
      <article class="card">
        <div class="card-header"><div><h3>Accounts</h3><p class="meta">Balances derived from every recorded entry · ${money(accounts.liquid)} available</p></div><button class="text-button" data-money-account>${icon('plus')}Add account</button></div>
        ${accounts.rows.length
          ? `<div class="money-accounts">${accounts.rows.map((account) => `<div class="money-account ${account.archived ? 'is-archived' : ''}"><span class="money-account-icon">${icon(ACCOUNT_KINDS.find((kind) => kind.id === account.kind)?.symbol || 'wallet')}</span><div><strong>${escapeHtml(account.name)}</strong><p>${escapeHtml(account.kindLabel)}${account.institution ? ` · ${escapeHtml(account.institution)}` : ''}${account.archived ? ' · archived' : ''}</p></div><span class="money-account-balance ${account.liability ? 'is-liability' : ''}">${money(account.liability ? -Math.abs(account.balance) : account.balance)}</span><button class="icon-btn" data-money-account="${escapeHtml(account.id)}" aria-label="Edit ${escapeHtml(account.name)}">${icon('edit')}</button></div>`).join('')}</div>`
          : empty('wallet', 'Start with what is real.', 'Add the account you actually spend from. No bank connection is needed — you stay in control.', `<button class="btn-ghost" data-money-account>${icon('plus')}Add your first account</button>`)}
      </article>
      <article class="card">
        <div class="card-header"><div><h3>Every month, already spoken for</h3><p class="meta">${money(recurringTotal)} of recurring charges</p></div><button class="text-button" data-money-recurring>${icon('plus')}Add charge</button></div>
        ${ledger.recurring.length
          ? `<div class="money-recurring">${[...ledger.recurring].sort((a, b) => (nextChargeDate(a, today) || '9999').localeCompare(nextChargeDate(b, today) || '9999')).map((item) => { const due = nextChargeDate(item, today); return `<div class="money-recurring-row ${item.active ? '' : 'is-paused'}"><span class="money-recurring-dot"></span><div><strong>${escapeHtml(item.name)}</strong><p>${money(item.amount)} · every ${CADENCE_LABEL[item.cadence] || 'month'}${item.active && due ? ` · next ${formatKeyLabel(due)}` : ' · paused'}</p></div><button class="icon-btn" data-money-recurring="${escapeHtml(item.id)}" aria-label="Edit ${escapeHtml(item.name)}">${icon('edit')}</button></div>` }).join('')}</div>`
          : empty('repeat', 'The quiet leak.', 'Subscriptions, rent, insurance. Seeing them together is usually enough to change one.')}
        ${dueSoon.length ? `<div class="money-due"><p class="field-label">Leaving in the next 30 days</p>${dueSoon.slice(0, 5).map((row) => `<div class="money-due-row"><span>${escapeHtml(row.label)}</span><small>${formatKeyLabel(row.date)}</small><strong>${money(row.amount)}</strong></div>`).join('')}</div>` : ''}
      </article>
    </div>
    <div class="money-grid money-grid--split">
      <article class="card">
        <div class="card-header"><div><h3>Budgets you set yourself</h3><p class="meta">${budgets.length ? `${money(planned)} planned · ${budgets.length - budgets.filter((row) => row.over).length} of ${budgets.length} within plan` : 'No budgets yet'}</p></div><button class="text-button" data-money-budget>${icon('plus')}Set a budget</button></div>
        ${budgets.length
          ? `<div class="money-budgets">${budgets.map((row) => `<div class="money-budget ${row.over ? 'is-over' : ''}"><div class="money-budget-head"><strong>${escapeHtml(row.name)}</strong><span>${money(row.spent)} <small>of ${money(row.limit)}</small></span></div><div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, row.pct)}%;${row.over ? 'background:var(--danger)' : ''}"></div></div><p>${row.over ? `${money(Math.abs(row.remaining))} over plan` : `${money(row.remaining)} left`} · ${row.pct}% used<button class="text-button" data-money-budget="${escapeHtml(row.categoryId)}">Edit</button></p></div>`).join('')}</div>`
          : empty('gauge', 'A limit you chose, not a rule imposed.', 'A budget turns a vague intention into something the month can answer.')}
      </article>
      <article class="card">
        <div class="card-header"><div><h3>Owes and owed</h3><p class="meta">${notes.open.length ? `${money(notes.net, { sign: true })} net` : 'Nothing outstanding'}</p></div><button class="text-button" data-money-note>${icon('plus')}Add</button></div>
        ${notes.open.length
          ? `<div class="money-notes">${notes.open.map((note) => `<div class="money-note"><span class="money-note-dir ${note.direction === 'owed_to_me' ? 'is-in' : 'is-out'}">${icon(note.direction === 'owed_to_me' ? 'arrow' : 'scale')}</span><div><strong>${escapeHtml(note.person)}</strong><p>${note.direction === 'owed_to_me' ? 'owes you' : 'you owe'}${note.dueDate ? ` · due ${formatKeyLabel(note.dueDate)}` : ''}${note.note ? ` · ${escapeHtml(note.note)}` : ''}</p></div><strong class="${note.direction === 'owed_to_me' ? 'success' : 'warning'}">${money(note.amount)}</strong><button class="icon-btn" data-money-note-settle="${escapeHtml(note.id)}" aria-label="Mark settled">${icon('check')}</button></div>`).join('')}</div>`
          : empty('users', 'An empty slate between friends.', 'Small IOUs are easy to forget. Write them down once and stop carrying them.')}
      </article>
    </div>
    <article class="card money-entries-card">
      <div class="card-header"><div><h3>Every entry, newest first</h3><p class="meta">${recent.length} shown${kindFilter || searchTerm ? ' · filtered' : ''}</p></div><div class="toolbar-search money-search">${icon('search')}<input class="input-field" placeholder="Search notes, people, amounts…" value="${escapeHtml(searchTerm)}" data-money-search aria-label="Search ledger entries"></div></div>
      ${recent.length
        ? `<div class="money-entries">${recent.map(entryRow).join('')}</div>`
        : empty('receipt', searchTerm || kindFilter ? 'No matching entries.' : 'Nothing recorded for this month yet.', searchTerm || kindFilter ? 'Try another search, or clear the filter.' : 'Record one entry — it takes one line and makes every figure above real.', '<button class="btn-ghost" data-money-add>Record an entry</button>')}
    </article>
    <div class="money-footer">${icon('lock')}<span>Your ledger is stored in this browser only. Export a backup or CSV before clearing site data.</span></div>`

  bindCommon(section)
  bindMoneyActions(section, month, today)
  drawMoneyCharts(section, ledger, month)
}

function visibleTransactions(month) {
  const term = searchTerm.trim().toLowerCase()
  return transactionsInMonth(state.ledger || {}, month)
    .filter((tx) => {
      if (kindFilter === 'in') return tx.kind === 'income'
      if (kindFilter === 'out') return tx.kind === 'expense'
      if (kindFilter) return tx.kind === kindFilter
      return true
    })
    .filter((tx) => {
      if (!term) return true
      const category = state.categories.find((row) => row.id === tx.categoryId)?.name || ''
      const account = state.ledger.accounts.find((row) => row.id === tx.accountId)?.name || ''
      return `${tx.note} ${category} ${account} ${tx.amount} ${(tx.tags || []).join(' ')}`.toLowerCase().includes(term)
    })
    .slice()
    .reverse()
}

function entryRow(tx) {
  const account = state.ledger.accounts.find((row) => row.id === tx.accountId)
  const to = state.ledger.accounts.find((row) => row.id === tx.toAccountId)
  const category = state.categories.find((row) => row.id === tx.categoryId)
  const amount = tx.kind === 'income' ? tx.amount : tx.kind === 'transfer' ? tx.amount : -tx.amount
  const tone = tx.kind === 'income' ? 'is-in' : tx.kind === 'transfer' ? 'is-move' : 'is-out'
  return `<button class="money-entry ${tone}" data-money-edit="${escapeHtml(tx.id)}">
    <span class="money-entry-icon">${icon(KIND_ICON[tx.kind] || 'receipt')}</span>
    <span class="money-entry-date">${tx.date.slice(8)}<small>${formatKeyLabel(tx.date).split(',')[0]}</small></span>
    <span class="money-entry-body">
      <strong>${escapeHtml(tx.note || (category?.name || KIND_LABEL[tx.kind]))}</strong>
      <small>${escapeHtml(KIND_LABEL[tx.kind])}${account ? ` · ${escapeHtml(account.name)}` : ''}${to ? ` → ${escapeHtml(to.name)}` : ''}${category ? ` · ${escapeHtml(category.name)}` : ''}${tx.cleared ? '' : ' · uncleared'}</small>
    </span>
    <span class="money-entry-amount">${money(amount, { sign: tx.kind === 'income' })}</span>
  </button>`
}

function bindMoneyActions(section, month, today) {
  qsa(section, '[data-money-month]').forEach((button) =>
    button.addEventListener('click', () => {
      const value = button.dataset.moneyMonth
      monthOffset = value === 'reset' ? 0 : Math.min(0, monthOffset + Number(value))
      renderMoney()
    }),
  )
  qsa(section, '[data-money-kind]').forEach((button) =>
    button.addEventListener('click', () => {
      kindFilter = button.dataset.moneyKind
      renderMoney()
    }),
  )
  const search = qs(section, '[data-money-search]')
  search?.addEventListener('input', () => {
    searchTerm = search.value
    const list = qs(section, '.money-entries')
    const rows = visibleTransactions(month)
    if (list) list.innerHTML = rows.map(entryRow).join('')
    else renderMoney()
    qsa(section, '[data-money-edit]').forEach((button) => button.onclick = () => openTransactionModal(button.dataset.moneyEdit))
  })
  qsa(section, '[data-money-add]').forEach((button) => button.addEventListener('click', () => openTransactionModal(null)))
  qsa(section, '[data-money-edit]').forEach((button) => button.addEventListener('click', () => openTransactionModal(button.dataset.moneyEdit)))
  qsa(section, '[data-money-account]').forEach((button) => button.addEventListener('click', () => openAccountModal(button.dataset.moneyAccount || null)))
  qsa(section, '[data-money-recurring]').forEach((button) => button.addEventListener('click', () => openRecurringModal(button.dataset.moneyRecurring || null)))
  qsa(section, '[data-money-budget]').forEach((button) => button.addEventListener('click', () => openBudgetModal(button.dataset.moneyBudget || null)))
  qsa(section, '[data-money-note]').forEach((button) => button.addEventListener('click', () => openNoteModal(null)))
  qsa(section, '[data-money-note-settle]').forEach((button) =>
    button.addEventListener('click', () => {
      const note = state.ledger.notes.find((row) => row.id === button.dataset.moneyNoteSettle)
      if (!note) return
      commit((s) => { const target = s.ledger.notes.find((row) => row.id === note.id); if (target) target.settled = true })
      toast(`Settled with ${note.person}. One less thing to remember.`, 'success')
    }),
  )
  qs(section, '[data-money-export]')?.addEventListener('click', () => {
    const csv = transactionsToCsv(state.ledger, { categories: state.categories })
    if (!state.ledger.transactions.length) { toast('Nothing to export yet — record an entry first.', 'info'); return }
    try {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `command-ledger-${today}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast('Ledger exported as CSV. Your data is never trapped here.', 'success')
    } catch {
      toast('The download was blocked by the browser.', 'error')
    }
  })
}

function drawMoneyCharts(section, ledger, month) {
  const colors = chartColors()
  const series = cashflowSeries(ledger, month)
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  drawChart('moneyFlowChart', {
    type: 'line',
    data: {
      labels: series.map((row) => String(row.day)),
      datasets: [
        {
          label: 'Cumulative',
          data: series.map((row) => row.cumulative),
          borderColor: colors.accent,
          backgroundColor: 'rgba(0,0,0,0)',
          fill: false,
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: colors.accent,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: reduced ? 0 : 380 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: colors.tooltipBg,
          titleColor: '#fff',
          bodyColor: colors.muted,
          borderColor: colors.tooltipBorder,
          borderWidth: 1,
          padding: 12,
          cornerRadius: 10,
          callbacks: { label: (context) => money(Number(context.raw)) },
        },
      },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: colors.muted, font: { size: 10 }, maxTicksLimit: 8 } },
        y: { grid: { color: colors.border }, border: { display: false }, ticks: { color: colors.muted, font: { size: 10 }, maxTicksLimit: 5, callback: (value) => short(Number(value)) } },
      },
    },
  })
  section.dataset.chart = 'money'
}

/* ---------------------------------------------------------------- editors */

function accountOptions(selected = '') {
  return state.ledger.accounts
    .filter((account) => !account.archived || account.id === selected)
    .map((account) => `<option value="${escapeHtml(account.id)}" ${selected === account.id ? 'selected' : ''}>${escapeHtml(account.name)}</option>`)
    .join('')
}

export function openTransactionModal(id = null) {
  const tx = state.ledger.transactions.find((row) => row.id === id)
  if (!state.ledger.accounts.length) {
    openAccountModal(null, { next: () => openTransactionModal(id) })
    return
  }
  const today = currentDayKey()
  const kind = tx?.kind || 'expense'
  openModal({
    title: tx ? 'Edit this entry' : 'What moved?',
    body: `<form id="tx-form" class="form-stack">
      <div class="segmented money-kind-picker" data-tx-kinds role="group" aria-label="Entry type">
        ${[['expense', 'Money out'], ['income', 'Money in'], ['transfer', 'Transfer'], ['adjustment', 'Adjustment']].map(([value, label]) => `<button type="button" data-tx-kind="${value}" class="${kind === value ? 'seg-active' : ''}" aria-pressed="${kind === value}">${label}</button>`).join('')}
      </div>
      <div class="form-grid">
        <div><label class="field-label" for="tx-amount">Amount</label><input class="input-field" id="tx-amount" inputmode="decimal" required value="${tx ? tx.amount : ''}" placeholder="0"></div>
        <div><label class="field-label" for="tx-date">Date</label><input class="input-field" id="tx-date" type="date" required value="${tx?.date || today}"></div>
      </div>
      <div class="form-grid">
        <div><label class="field-label" for="tx-account" data-tx-from-label>${kind === 'income' ? 'Into' : 'From'}</label><select class="input-field" id="tx-account">${accountOptions(tx?.accountId || state.ledger.accounts[0]?.id)}</select></div>
        <div data-tx-to-wrap class="${kind === 'transfer' ? '' : 'hidden'}"><label class="field-label" for="tx-to">To</label><select class="input-field" id="tx-to">${accountOptions(tx?.toAccountId || '')}</select></div>
      </div>
      <div data-tx-category-wrap class="${kind === 'transfer' ? 'hidden' : ''}"><label class="field-label" for="tx-category">Area of life</label><select class="input-field" id="tx-category">${categoryOptions(tx?.categoryId ?? null)}</select></div>
      <div><label class="field-label" for="tx-note">What was it?</label><input class="input-field" id="tx-note" maxlength="160" value="${escapeHtml(tx?.note || '')}" placeholder="Groceries, salary, a train ticket…"></div>
      <label class="check-label"><input type="checkbox" id="tx-cleared" ${tx?.cleared !== false ? 'checked' : ''}>Already settled in the account</label>
      <div class="form-footer">
        ${tx ? `<button type="button" class="btn-ghost" data-tx-delete>${icon('trash')}Delete</button>` : ''}
        <button type="button" class="btn-ghost" data-modal-close>Cancel</button>
        <button type="submit" class="btn-primary">${tx ? 'Save entry' : 'Record it'}</button>
      </div>
    </form>`,
    onMount: (box) => {
      let current = kind
      const syncKind = () => {
        box.querySelectorAll('[data-tx-kind]').forEach((button) => {
          const active = button.dataset.txKind === current
          button.classList.toggle('seg-active', active)
          button.setAttribute('aria-pressed', String(active))
        })
        box.querySelector('[data-tx-to-wrap]').classList.toggle('hidden', current !== 'transfer')
        box.querySelector('[data-tx-category-wrap]').classList.toggle('hidden', current === 'transfer')
        box.querySelector('[data-tx-from-label]').textContent = current === 'income' ? 'Into' : 'From'
      }
      box.querySelectorAll('[data-tx-kind]').forEach((button) =>
        button.addEventListener('click', () => {
          current = button.dataset.txKind
          syncKind()
        }),
      )
      box.querySelector('[data-tx-delete]')?.addEventListener('click', async () => {
        if (!(await confirmDialog({ title: 'Delete this entry?', message: 'Balances will be recalculated. This cannot be undone.', confirmText: 'Delete', danger: true }))) return
        commit((s) => { s.ledger.transactions = s.ledger.transactions.filter((row) => row.id !== tx.id) })
        closeModal()
        toast('Entry removed. Balances updated.', 'info')
      })
      box.querySelector('form').addEventListener('submit', (event) => {
        event.preventDefault()
        const amount = parseMoney(box.querySelector('#tx-amount').value)
        if (!(amount > 0)) { toast('Enter an amount greater than zero.', 'error'); return }
        const payload = {
          kind: current,
          amount,
          date: box.querySelector('#tx-date').value || today,
          accountId: box.querySelector('#tx-account').value || null,
          toAccountId: current === 'transfer' ? box.querySelector('#tx-to').value || null : null,
          categoryId: current === 'transfer' ? null : box.querySelector('#tx-category').value || null,
          note: box.querySelector('#tx-note').value.trim(),
          cleared: box.querySelector('#tx-cleared').checked,
        }
        if (current === 'transfer' && (!payload.toAccountId || payload.toAccountId === payload.accountId)) {
          toast('Choose two different accounts for a transfer.', 'error')
          return
        }
        commit((s) => {
          if (tx) {
            const target = s.ledger.transactions.find((row) => row.id === tx.id)
            if (target) Object.assign(target, payload)
          } else {
            s.ledger.transactions.push({ id: uid(), createdAt: Date.now(), tags: [], sourceId: null, ...payload })
          }
          s.ledger.updatedAt = Date.now()
        })
        closeModal()
        toast(tx ? 'Entry updated.' : 'Recorded. The month is a little more honest.', 'success')
      })
      box.querySelector('#tx-amount').focus()
    },
  })
}

export function openAccountModal(id = null, { next = null } = {}) {
  const account = state.ledger.accounts.find((row) => row.id === id)
  openModal({
    title: account ? 'Edit account' : 'Where does the money sit?',
    body: `<form id="account-form" class="form-stack">
      <div><label class="field-label" for="account-name">Name</label><input class="input-field" id="account-name" required maxlength="60" value="${escapeHtml(account?.name || '')}" placeholder="Salary account, Cash, Credit card…"></div>
      <div class="form-grid">
        <div><label class="field-label" for="account-kind">Kind</label><select class="input-field" id="account-kind">${ACCOUNT_KINDS.map((kind) => `<option value="${kind.id}" ${account?.kind === kind.id ? 'selected' : ''}>${kind.label}</option>`).join('')}</select></div>
        <div><label class="field-label" for="account-opening">Current balance</label><input class="input-field" id="account-opening" inputmode="decimal" value="${account ? account.openingBalance : ''}" placeholder="0"></div>
      </div>
      <div><label class="field-label" for="account-institution">Where it is · optional</label><input class="input-field" id="account-institution" maxlength="60" value="${escapeHtml(account?.institution || '')}" placeholder="HDFC, SBI, a local bank…"></div>
      <p class="form-hint">This is a starting balance you enter yourself. Every recorded entry moves it — nothing is fetched from a bank.</p>
      ${account ? `<label class="check-label"><input type="checkbox" id="account-archived" ${account.archived ? 'checked' : ''}>Hide this account from totals</label>` : ''}
      <div class="form-footer">
        <button type="button" class="btn-ghost" data-modal-close>Cancel</button>
        <button type="submit" class="btn-primary">${account ? 'Save account' : 'Add account'}</button>
      </div>
    </form>`,
    onMount: (box) => {
      box.querySelector('form').addEventListener('submit', (event) => {
        event.preventDefault()
        const name = box.querySelector('#account-name').value.trim()
        if (!name) return
        const payload = {
          name,
          kind: box.querySelector('#account-kind').value,
          openingBalance: parseMoney(box.querySelector('#account-opening').value),
          institution: box.querySelector('#account-institution').value.trim(),
          archived: box.querySelector('#account-archived')?.checked === true,
        }
        commit((s) => {
          if (account) Object.assign(s.ledger.accounts.find((row) => row.id === account.id), payload)
          else s.ledger.accounts.push({ id: uid(), createdAt: Date.now(), ...payload })
          s.ledger.updatedAt = Date.now()
        })
        closeModal()
        toast(account ? 'Account updated.' : 'Account added. Everything else can build from here.', 'success')
        if (next) setTimeout(next, 60)
      })
    },
  })
}

export function openBudgetModal(categoryId = null) {
  const existing = state.ledger.budgets.find((row) => row.categoryId === categoryId)
  openModal({
    title: existing ? 'Adjust this budget' : 'A limit you chose',
    body: `<form id="budget-form" class="form-stack">
      <div><label class="field-label" for="budget-category">Area of life</label><select class="input-field" id="budget-category" ${existing ? 'disabled' : ''}>${categoryOptions(categoryId)}</select></div>
      <div><label class="field-label" for="budget-limit">Monthly limit</label><input class="input-field" id="budget-limit" inputmode="decimal" required value="${existing ? existing.limit : ''}" placeholder="0"></div>
      <label class="check-label"><input type="checkbox" id="budget-rollover" ${existing?.rollover ? 'checked' : ''}>Let unspent money carry over</label>
      <p class="form-hint">Budgets are yours to change at any time. This one applies every month until you edit it.</p>
      <div class="form-footer">
        ${existing ? `<button type="button" class="btn-ghost" data-budget-remove>${icon('trash')}Remove budget</button>` : ''}
        <button type="button" class="btn-ghost" data-modal-close>Cancel</button>
        <button type="submit" class="btn-primary">${existing ? 'Save budget' : 'Set budget'}</button>
      </div>
    </form>`,
    onMount: (box) => {
      box.querySelector('[data-budget-remove]')?.addEventListener('click', () => {
        commit((s) => { s.ledger.budgets = s.ledger.budgets.filter((row) => row.categoryId !== existing.categoryId) })
        closeModal()
        toast('Budget removed. Nothing else changed.', 'info')
      })
      box.querySelector('form').addEventListener('submit', (event) => {
        event.preventDefault()
        const limit = parseMoney(box.querySelector('#budget-limit').value)
        const targetCategory = existing ? existing.categoryId : box.querySelector('#budget-category').value
        if (!targetCategory) { toast('Choose an area to budget.', 'error'); return }
        if (!(limit > 0)) { toast('Enter a limit greater than zero.', 'error'); return }
        commit((s) => {
          const found = s.ledger.budgets.find((row) => row.categoryId === targetCategory)
          const payload = { categoryId: targetCategory, limit, rollover: box.querySelector('#budget-rollover').checked }
          if (found) Object.assign(found, payload)
          else s.ledger.budgets.push(payload)
        })
        closeModal()
        toast('Budget saved. The month has something to answer to.', 'success')
      })
    },
  })
}

export function openRecurringModal(id = null) {
  const item = state.ledger.recurring.find((row) => row.id === id)
  openModal({
    title: item ? 'Edit recurring charge' : 'What charges you anyway?',
    body: `<form id="recurring-form" class="form-stack">
      <div><label class="field-label" for="recurring-name">Name</label><input class="input-field" id="recurring-name" required maxlength="80" value="${escapeHtml(item?.name || '')}" placeholder="Rent, phone bill, a streaming service…"></div>
      <div class="form-grid">
        <div><label class="field-label" for="recurring-amount">Amount</label><input class="input-field" id="recurring-amount" inputmode="decimal" required value="${item ? item.amount : ''}" placeholder="0"></div>
        <div><label class="field-label" for="recurring-cadence">How often</label><select class="input-field" id="recurring-cadence">${CADENCES.map((cadence) => `<option value="${cadence}" ${item?.cadence === cadence ? 'selected' : ''}>${cadence[0].toUpperCase() + cadence.slice(1)}</option>`).join('')}</select></div>
      </div>
      <div class="form-grid">
        <div><label class="field-label" for="recurring-day">Day of the month</label><input class="input-field" id="recurring-day" type="number" min="1" max="28" value="${item?.dayOfMonth || 1}"></div>
        <div><label class="field-label" for="recurring-category">Area of life</label><select class="input-field" id="recurring-category">${categoryOptions(item?.categoryId ?? null)}</select></div>
      </div>
      <label class="check-label"><input type="checkbox" id="recurring-active" ${item?.active !== false ? 'checked' : ''}>This is still active</label>
      <p class="form-hint">Recurring charges are never posted automatically. They appear in the forecast so nothing surprises you.</p>
      <div class="form-footer">
        ${item ? `<button type="button" class="btn-ghost" data-recurring-delete>${icon('trash')}Remove</button>` : ''}
        <button type="button" class="btn-ghost" data-modal-close>Cancel</button>
        <button type="submit" class="btn-primary">${item ? 'Save charge' : 'Add charge'}</button>
      </div>
    </form>`,
    onMount: (box) => {
      box.querySelector('[data-recurring-delete]')?.addEventListener('click', () => {
        commit((s) => { s.ledger.recurring = s.ledger.recurring.filter((row) => row.id !== item.id) })
        closeModal()
        toast('Recurring charge removed.', 'info')
      })
      box.querySelector('form').addEventListener('submit', (event) => {
        event.preventDefault()
        const amount = parseMoney(box.querySelector('#recurring-amount').value)
        const name = box.querySelector('#recurring-name').value.trim()
        if (!name || !(amount > 0)) { toast('Give the charge a name and an amount.', 'error'); return }
        const payload = {
          name,
          amount,
          cadence: box.querySelector('#recurring-cadence').value,
          dayOfMonth: Number(box.querySelector('#recurring-day').value) || 1,
          categoryId: box.querySelector('#recurring-category').value || null,
          active: box.querySelector('#recurring-active').checked,
        }
        commit((s) => {
          if (item) Object.assign(s.ledger.recurring.find((row) => row.id === item.id), payload)
          else s.ledger.recurring.push({ id: uid(), createdAt: Date.now(), accountId: null, note: '', ...payload })
        })
        closeModal()
        toast(item ? 'Recurring charge updated.' : 'Added. Now you can see it coming.', 'success')
      })
    },
  })
}

export function openNoteModal(id = null) {
  const note = state.ledger.notes.find((row) => row.id === id)
  openModal({
    title: note ? 'Edit this IOU' : 'Who owes whom?',
    body: `<form id="note-form" class="form-stack">
      <div class="segmented" data-note-dirs role="group" aria-label="Direction">
        ${[['owed_to_me', 'They owe me'], ['i_owe', 'I owe them']].map(([value, label]) => `<button type="button" data-note-dir="${value}" class="${(note?.direction || 'owed_to_me') === value ? 'seg-active' : ''}" aria-pressed="${(note?.direction || 'owed_to_me') === value}">${label}</button>`).join('')}
      </div>
      <div class="form-grid">
        <div><label class="field-label" for="note-person">Person</label><input class="input-field" id="note-person" required maxlength="60" value="${escapeHtml(note?.person || '')}" placeholder="A name"></div>
        <div><label class="field-label" for="note-amount">Amount</label><input class="input-field" id="note-amount" inputmode="decimal" required value="${note ? note.amount : ''}" placeholder="0"></div>
      </div>
      <div class="form-grid">
        <div><label class="field-label" for="note-due">When · optional</label><input class="input-field" id="note-due" type="date" value="${note?.dueDate || ''}"></div>
        <div><label class="field-label" for="note-why">What for · optional</label><input class="input-field" id="note-why" maxlength="160" value="${escapeHtml(note?.note || '')}" placeholder="Dinner, a book, a cab"></div>
      </div>
      <div class="form-footer">
        <button type="button" class="btn-ghost" data-modal-close>Cancel</button>
        <button type="submit" class="btn-primary">${note ? 'Save IOU' : 'Add IOU'}</button>
      </div>
    </form>`,
    onMount: (box) => {
      let direction = note?.direction || 'owed_to_me'
      box.querySelectorAll('[data-note-dir]').forEach((button) =>
        button.addEventListener('click', () => {
          direction = button.dataset.noteDir
          box.querySelectorAll('[data-note-dir]').forEach((other) => {
            const active = other.dataset.noteDir === direction
            other.classList.toggle('seg-active', active)
            other.setAttribute('aria-pressed', String(active))
          })
        }),
      )
      box.querySelector('form').addEventListener('submit', (event) => {
        event.preventDefault()
        const amount = parseMoney(box.querySelector('#note-amount').value)
        const person = box.querySelector('#note-person').value.trim()
        if (!person || !(amount > 0)) { toast('Add a name and an amount.', 'error'); return }
        const payload = {
          direction,
          person,
          amount,
          dueDate: box.querySelector('#note-due').value || null,
          note: box.querySelector('#note-why').value.trim(),
          date: note?.date || currentDayKey(),
        }
        commit((s) => {
          if (note) Object.assign(s.ledger.notes.find((row) => row.id === note.id), payload)
          else s.ledger.notes.push({ id: uid(), createdAt: Date.now(), settled: false, ...payload })
        })
        closeModal()
        toast(note ? 'IOU updated.' : 'Written down. Your head can let it go.', 'success')
      })
    },
  })
}
