import test from 'node:test'
import assert from 'node:assert/strict'
import {
  accountBalance,
  accountSummary,
  budgetStatus,
  cashflowSeries,
  categorySpend,
  formatMoney,
  monthSummary,
  moneyAdvice,
  netWorthHistory,
  nextChargeDate,
  normalizeLedger,
  noteSummary,
  parseMoney,
  plannedBudget,
  recurringMonthlyTotal,
  roundMoney,
  transactionsInMonth,
  transactionsToCsv,
  upcomingObligations,
} from '../../src/client/lib/ledger.js'
import { makeCtx } from '../helpers/fixtures.js'

const categories = [
  { id: 'work', name: 'Work', color: '#7ba7ea' },
  { id: 'life', name: 'Life admin', color: '#9aabbf' },
  { id: 'wellbeing', name: 'Wellbeing', color: '#d3b17c' },
]

function ledger(overrides = {}) {
  return {
    accounts: [
      { id: 'a1', name: 'Salary account', kind: 'bank', openingBalance: 50000, institution: 'HDFC', archived: false, createdAt: 1 },
      { id: 'a2', name: 'Cash', kind: 'cash', openingBalance: 2000, institution: '', archived: false, createdAt: 1 },
      { id: 'a3', name: 'Credit card', kind: 'credit', openingBalance: 0, institution: '', archived: false, createdAt: 1 },
      { id: 'a4', name: 'Index funds', kind: 'investment', openingBalance: 120000, institution: '', archived: false, createdAt: 1 },
    ],
    transactions: [
      { id: 't1', kind: 'income', date: '2026-09-01', amount: 90000, accountId: 'a1', toAccountId: null, categoryId: null, note: 'Salary', tags: [], cleared: true, createdAt: 1 },
      { id: 't2', kind: 'expense', date: '2026-09-03', amount: 1200, accountId: 'a1', toAccountId: null, categoryId: 'life', note: 'Electricity', tags: [], cleared: true, createdAt: 2 },
      { id: 't3', kind: 'expense', date: '2026-09-04', amount: 800, accountId: 'a2', toAccountId: null, categoryId: 'life', note: 'Groceries', tags: [], cleared: true, createdAt: 3 },
      { id: 't4', kind: 'expense', date: '2026-09-05', amount: 2500, accountId: 'a3', toAccountId: null, categoryId: 'work', note: 'Books', tags: [], cleared: false, createdAt: 4 },
      { id: 't5', kind: 'transfer', date: '2026-09-06', amount: 10000, accountId: 'a1', toAccountId: 'a4', categoryId: null, note: 'SIP', tags: [], cleared: true, createdAt: 5 },
      { id: 't6', kind: 'income', date: '2026-08-01', amount: 90000, accountId: 'a1', toAccountId: null, categoryId: null, note: 'Salary', tags: [], cleared: true, createdAt: 6 },
      { id: 't7', kind: 'expense', date: '2026-08-20', amount: 3000, accountId: 'a1', toAccountId: null, categoryId: 'wellbeing', note: 'Gym', tags: [], cleared: true, createdAt: 7 },
    ],
    budgets: [
      { categoryId: 'life', limit: 2000, rollover: false },
      { categoryId: 'work', limit: 1000, rollover: false },
      { categoryId: 'wellbeing', limit: 5000, rollover: false },
    ],
    recurring: [
      { id: 'r1', name: 'Rent', amount: 20000, cadence: 'monthly', dayOfMonth: 5, categoryId: 'life', accountId: 'a1', active: true, note: '', createdAt: Date.parse('2026-01-01T00:00:00Z') },
      { id: 'r2', name: 'Streaming', amount: 500, cadence: 'monthly', dayOfMonth: 27, categoryId: 'life', accountId: 'a1', active: true, note: '', createdAt: 1 },
      { id: 'r3', name: 'Insurance', amount: 12000, cadence: 'yearly', dayOfMonth: 10, categoryId: 'wellbeing', accountId: 'a1', active: true, note: '', createdAt: 1 },
      { id: 'r4', name: 'Old gym', amount: 1500, cadence: 'monthly', dayOfMonth: 2, categoryId: 'wellbeing', accountId: 'a1', active: false, note: '', createdAt: 1 },
    ],
    notes: [
      { id: 'n1', direction: 'owed_to_me', person: 'Ravi', amount: 1500, date: '2026-09-02', dueDate: '2026-09-10', settled: false, note: 'Cab', createdAt: 1 },
      { id: 'n2', direction: 'i_owe', person: 'Ananya', amount: 500, date: '2026-09-03', dueDate: '2026-09-08', settled: false, note: 'Coffee', createdAt: 1 },
      { id: 'n3', direction: 'owed_to_me', person: 'Old friend', amount: 900, date: '2026-07-01', dueDate: null, settled: true, note: '', createdAt: 1 },
    ],
    ...overrides,
  }
}

/* ------------------------------------------------------------------ money */

test('money parsing and rounding never invent or lose a rupee', () => {
  assert.equal(parseMoney('₹1,250.50'), 1250.5)
  assert.equal(parseMoney(' 42 '), 42)
  assert.equal(parseMoney('abc'), 0)
  assert.equal(parseMoney(undefined), 0)
  assert.equal(roundMoney(0.1 + 0.2), 0.3)
  assert.equal(roundMoney(-12.345), -12.34, 'Math.round breaks toward +∞ exactly like the rest of the app')
  assert.equal(roundMoney('nope'), 0)
})

test('amounts format in the workspace currency, with an honest minus sign', () => {
  const inr = formatMoney(1250, { currency: 'INR' })
  assert.match(inr, /1,250/)
  assert.equal(formatMoney(-450, { currency: 'INR' }).startsWith('−'), true, 'negative uses a true minus')
  assert.equal(formatMoney(450, { currency: 'INR', sign: true }).startsWith('+'), true, 'sign option shows plus')
  assert.equal(formatMoney(0, { currency: 'USD' }).includes('$'), true, 'respects the configured currency')
})

test('account balances follow income, expenses and transfers exactly', () => {
  const data = ledger()
  // 50000 + 90000 (Sep) + 90000 (Aug) - 1200 - 3000 - 10000 (transfer out)
  assert.equal(accountBalance(data, 'a1'), 215800)
  assert.equal(accountBalance(data, 'a2'), 1200) // 2000 - 800
  assert.equal(accountBalance(data, 'a3'), -2500) // credit spending
  assert.equal(accountBalance(data, 'a4'), 130000) // 120000 + 10000
  assert.equal(accountBalance(data, 'missing'), 0)
})

test('net worth treats credit cards as liabilities and excludes archived accounts', () => {
  const summary = accountSummary(ledger())
  assert.equal(summary.netWorth, 215800 + 1200 - 2500 + 130000)
  assert.equal(summary.liquid, 215800 + 1200)
  assert.equal(summary.invested, 130000)
  assert.equal(summary.owed, 2500)
  const archived = accountSummary(ledger({ accounts: ledger().accounts.map((a) => (a.id === 'a4' ? { ...a, archived: true } : a)) }))
  assert.equal(archived.invested, 0, 'archived accounts leave the totals')
  assert.equal(archived.netWorth, 215800 + 1200 - 2500)
})

test('a month summary separates income, expense and transfers', () => {
  const summary = monthSummary(ledger(), '2026-09', { categories })
  assert.equal(summary.income, 90000)
  assert.equal(summary.expense, 4500, 'the transfer is not an expense')
  assert.equal(summary.net, 85500)
  assert.equal(summary.savingsRate, 95)
  assert.equal(summary.txCount, 5)
  assert.equal(summary.byCategory[0].categoryId, 'work')
  assert.equal(summary.byCategory[0].total, 2500)
  assert.equal(transactionsInMonth(ledger(), '2026-09').length, 5)
})

test('budgets compare real spend with the limit the user chose', () => {
  const rows = budgetStatus(ledger(), '2026-09', categories)
  const life = rows.find((row) => row.categoryId === 'life')
  assert.equal(life.spent, 2000)
  assert.equal(life.remaining, 0)
  assert.equal(life.over, false)
  assert.equal(life.pct, 100)
  const work = rows.find((row) => row.categoryId === 'work')
  assert.equal(work.spent, 2500)
  assert.equal(work.over, true)
  assert.equal(work.remaining, -1500)
  const wellbeing = rows.find((row) => row.categoryId === 'wellbeing')
  assert.equal(wellbeing.spent, 0, 'August spend never leaks into September')
  assert.equal(plannedBudget(ledger()), 8000)
})

test('recurring charges normalise to a monthly figure and skip paused ones', () => {
  // 20000 + 500 + 12000/12 = 21500 · the paused item is excluded
  assert.equal(recurringMonthlyTotal(ledger()), 21500)
})

test('next charge dates never land in the past and never exceed day 28', () => {
  const rent = ledger().recurring[0]
  assert.equal(nextChargeDate(rent, '2026-09-01'), '2026-09-05')
  assert.equal(nextChargeDate(rent, '2026-09-05'), '2026-09-05', 'a charge on the day still counts')
  assert.equal(nextChargeDate(rent, '2026-09-06'), '2026-10-05')
  const insurance = ledger().recurring[2]
  assert.equal(nextChargeDate(insurance, '2026-09-11'), '2027-09-10', 'yearly charges wait a full year')
  const weekly = { id: 'w', amount: 100, cadence: 'weekly', dayOfMonth: 1, active: true, createdAt: Date.parse('2026-09-01T05:00:00Z') }
  assert.equal(nextChargeDate(weekly, '2026-09-03'), '2026-09-08')
})

test('upcoming obligations combine charges and IOUs inside the horizon', () => {
  const rows = upcomingObligations(ledger(), { todayKey: '2026-09-01', days: 30 })
  assert.ok(rows.some((row) => row.kind === 'recurring' && row.label === 'Rent' && row.date === '2026-09-05'))
  assert.ok(rows.some((row) => row.kind === 'note' && row.label === 'Owed to Ananya' && row.date === '2026-09-08'))
  assert.ok(!rows.some((row) => row.label === 'Old gym'), 'paused charges stay out')
  assert.deepEqual(rows.map((row) => row.date), [...rows.map((row) => row.date)].sort(), 'sorted by date')
  assert.equal(upcomingObligations(ledger(), { todayKey: '2026-09-01', days: 2 }).length, 0)
})

test('IOU summary nets both directions without hiding either', () => {
  const summary = noteSummary(ledger())
  assert.equal(summary.owedToMe, 1500)
  assert.equal(summary.iOwe, 500)
  assert.equal(summary.net, 1000)
  assert.equal(summary.open.length, 2, 'settled IOUs are not outstanding')
})

test('cashflow accumulates day by day and ignores transfers', () => {
  const series = cashflowSeries(ledger(), '2026-09')
  assert.equal(series.length, 30)
  assert.equal(series[0].cumulative, 90000)
  assert.equal(series[2].cumulative, 88800)
  assert.equal(series[3].cumulative, 88000)
  assert.equal(series[5].cumulative, 85500, 'the transfer does not change net cashflow')
  assert.equal(series.at(-1).cumulative, 85500)
})

test('category spend shares add up to the month’s expense', () => {
  const rows = categorySpend(ledger(), '2026-09', categories)
  const total = rows.reduce((sum, row) => sum + row.share, 0)
  assert.ok(Math.abs(total - 100) <= 1, `shares round to ~100 (${total})`)
  assert.equal(rows[0].name, 'Work')
})

test('money advice is deterministic and honest about an over-budget month', () => {
  const warn = moneyAdvice(ledger(), { todayKey: '2026-09-20', month: '2026-09', categories, currency: 'INR' })
  assert.equal(warn.tone, 'warn')
  assert.match(warn.title, /Work is over its plan/)
  const fresh = moneyAdvice({ accounts: [], transactions: [], budgets: [], recurring: [], notes: [] }, { todayKey: '2026-09-20' })
  assert.equal(fresh.tone, 'info')
  assert.match(fresh.title, /one account/i)
  const healthy = moneyAdvice(ledger({ budgets: [] }), { todayKey: '2026-09-20', month: '2026-09', categories, currency: 'INR' })
  assert.equal(healthy.tone, 'good')
})

test('net worth history replays the real transactions month by month', () => {
  const rows = netWorthHistory(ledger(), { months: 12, todayKey: '2026-09-15' })
  assert.deepEqual(rows.map((row) => row.month), ['2026-08', '2026-09'])
  // opening 172000 → August +87000 → September +85500
  assert.equal(rows[0].netWorth, 259000)
  assert.equal(rows[1].netWorth, 344500)
})

test('the CSV export contains every entry and escapes text safely', () => {
  const csv = transactionsToCsv(ledger({ transactions: [...ledger().transactions, { id: 'x', kind: 'expense', date: '2026-09-09', amount: 10, accountId: 'a1', toAccountId: null, categoryId: null, note: 'A "quoted" note', tags: ['a', 'b'], cleared: true, createdAt: 9 }] }), { categories })
  const lines = csv.split('\r\n')
  assert.match(lines[0], /^"Date","Kind","Amount"/)
  assert.equal(lines.length, 9)
  assert.ok(csv.includes('"A ""quoted"" note"'), 'quotes are doubled, not broken')
  assert.ok(csv.includes('Salary account'))
})

test('normalisation drops impossible records and keeps every valid one', () => {
  const ctx = makeCtx()
  const dirty = normalizeLedger(
    {
      accounts: [{ id: 'a1', name: 'Bank', kind: 'bank', openingBalance: '1000' }, { id: 'a2', name: 'Cash', kind: 'nonsense' }],
      transactions: [
        { id: 't1', kind: 'expense', date: '2026-09-01', amount: '250.555', accountId: 'a1', categoryId: 'work' },
        { id: 't2', kind: 'expense', date: '2026-09-02', amount: 0, accountId: 'a1' },
        { id: 't3', kind: 'transfer', date: 'not-a-date', amount: 10, accountId: 'a1', toAccountId: 'a2' },
        { id: 't4', kind: 'expense', date: '2026-09-03', amount: 20, accountId: 'ghost', categoryId: 'ghost' },
      ],
      budgets: [{ categoryId: 'work', limit: 500 }, { categoryId: 'work', limit: 900 }, { categoryId: 'nope', limit: 10 }, { categoryId: 'life', limit: 0 }],
      recurring: [{ id: 'r1', name: 'Rent', amount: 100, cadence: 'monthly' }, { id: 'r2', name: 'Zero', amount: 0 }],
      notes: [{ id: 'n1', person: 'A', amount: 100 }, { id: 'n2', person: 'B', amount: -5 }],
    },
    ctx,
    { categoryIds: new Set(['work', 'life']) },
  )
  assert.equal(dirty.accounts.length, 2)
  assert.equal(dirty.accounts[1].kind, 'bank', 'an unknown kind falls back safely')
  assert.equal(dirty.accounts[0].openingBalance, 1000)
  assert.equal(dirty.transactions.length, 3, 'zero-amount records are dropped')
  const byId = new Map(dirty.transactions.map((tx) => [tx.id, tx]))
  assert.equal(byId.get('t1').amount, 250.56, 'money is rounded to paise')
  assert.equal(byId.get('t3').date, '2026-09-15', 'an invalid date falls back to today')
  assert.equal(byId.get('t4').accountId, null, 'an unknown account is unlinked, not invented')
  assert.equal(byId.get('t4').categoryId, null)
  assert.equal(dirty.budgets.length, 1, 'duplicates, unknown categories and empty limits are dropped')
  assert.equal(dirty.budgets[0].limit, 500, 'the first budget for a category wins')
  assert.equal(dirty.recurring.length, 1)
  assert.equal(dirty.notes.length, 1, 'a negative IOU is impossible')
  assert.equal(dirty.notes[0].direction, 'owed_to_me')
})

test('an empty ledger is a valid, fully-shaped ledger', () => {
  const empty = normalizeLedger(null, makeCtx())
  assert.deepEqual(empty.accounts, [])
  assert.deepEqual(empty.transactions, [])
  assert.deepEqual(empty.budgets, [])
  assert.equal(accountSummary(empty).netWorth, 0)
  assert.equal(monthSummary(empty, '2026-09').txCount, 0)
  assert.equal(moneyAdvice(empty, { todayKey: '2026-09-01' }).tone, 'info')
})
