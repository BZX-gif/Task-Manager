/* -------------------------------------------------------------------------
   LEDGER — private money, modelled honestly
   -------------------------------------------------------------------------
   Command already holds the shape of a day, a week and a year. Money is the
   other half of "how is life actually going", so this module keeps a small,
   exact, dependency-free double-entry-*like* record:

     accounts      where the money sits     (cash · bank · wallet · card …)
     transactions  what moved and why       (expense · income · transfer)
     budgets       what you meant to spend  (per category, per month)
     recurring     what charges you anyway  (subscriptions, rent, SIPs)
     notes         what is still unsettled  (owed to me · I owe)

   Every figure the UI shows comes from these records. Nothing is estimated,
   nothing is simulated and nothing leaves the device.

   Money is stored as a plain number of major units (rupees, dollars…) rounded
   to two decimals through `roundMoney`, so sums never drift.

   The exported functions are pure: they take the ledger (and sometimes the
   app's categories) and return new values. The views own persistence.
   ------------------------------------------------------------------------- */

import { addDays, dateKey, diffDays, isValidKey, monthKey, parseKey } from './dates.js'

export const ACCOUNT_KINDS = [
  { id: 'bank', label: 'Bank account', symbol: 'wallet' },
  { id: 'cash', label: 'Cash', symbol: 'leaf' },
  { id: 'wallet', label: 'Digital wallet', symbol: 'bolt' },
  { id: 'credit', label: 'Credit card', symbol: 'card' },
  { id: 'investment', label: 'Investment', symbol: 'target' },
  { id: 'other', label: 'Other', symbol: 'projects' },
]

export const TX_KINDS = ['expense', 'income', 'transfer', 'adjustment']
export const CADENCES = ['weekly', 'monthly', 'quarterly', 'yearly']

const KIND_IDS = new Set(ACCOUNT_KINDS.map((kind) => kind.id))
const TX_KIND_SET = new Set(TX_KINDS)
const CADENCE_SET = new Set(CADENCES)

const isObj = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
const asArray = (value) => (Array.isArray(value) ? value : [])
const text = (value, max = 200) => (typeof value === 'string' ? value.slice(0, max).trim() : '')

/** Round to paise/cents so repeated sums stay stable. */
export function roundMoney(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return 0
  return Math.round(num * 100) / 100
}

/** Accepts "1,250.50", "₹1250", 1250 → 1250.5. Never returns NaN. */
export function parseMoney(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? roundMoney(value) : 0
  const cleaned = String(value ?? '').replace(/[^0-9.\-]/g, '')
  const num = Number(cleaned)
  return Number.isFinite(num) ? roundMoney(num) : 0
}

/**
 * Format money for display. Uses the device's locale rules but an explicit
 * currency so a rupee workspace never silently becomes dollars.
 * @param {number} amount
 * @param {{currency?: string, compact?: boolean, sign?: boolean}} [options]
 */
export function formatMoney(amount, { currency = 'INR', compact = false, sign = false } = {}) {
  const value = roundMoney(amount)
  let body
  try {
    body = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'INR',
      maximumFractionDigits: compact || Math.abs(value) >= 10000 ? 0 : Number.isInteger(value) ? 0 : 2,
      minimumFractionDigits: 0,
      notation: compact ? 'compact' : 'standard',
    }).format(Math.abs(value))
  } catch {
    body = `${currency === 'INR' ? '₹' : currency + ' '}${Math.abs(value).toFixed(0)}`
  }
  if (value < 0) return `−${body}`
  return sign && value > 0 ? `+${body}` : body
}

/** Compact money label without a leading 0 for small spends ("₹0" stays). */
export function moneyShort(amount, currency) {
  return formatMoney(amount, { currency, compact: Math.abs(amount) >= 100000 })
}

/* --------------------------------------------------------------- normalise */

export function normalizeAccount(raw, ctx) {
  const kind = KIND_IDS.has(raw?.kind) ? raw.kind : 'bank'
  return {
    id: String(raw?.id || ctx.uid()),
    name: text(raw?.name, 60) || ACCOUNT_KINDS.find((k) => k.id === kind).label,
    kind,
    openingBalance: roundMoney(raw?.openingBalance),
    institution: text(raw?.institution, 60),
    archived: raw?.archived === true,
    createdAt: Number.isFinite(raw?.createdAt) ? raw.createdAt : ctx.now,
  }
}

/**
 * @param {any} raw
 * @param {any} ctx
 * @param {{accountIds?: Set<string>, categoryIds?: Set<string>}} [refs]
 */
export function normalizeTransaction(raw, ctx, refs = {}) {
  const { accountIds, categoryIds } = refs
  const kind = TX_KIND_SET.has(raw?.kind) ? raw.kind : 'expense'
  const accountId = accountIds && !accountIds.has(raw?.accountId) ? null : raw?.accountId ? String(raw.accountId) : null
  const toAccountId = accountIds && raw?.toAccountId && !accountIds.has(raw.toAccountId) ? null : raw?.toAccountId ? String(raw.toAccountId) : null
  return {
    id: String(raw?.id || ctx.uid()),
    kind,
    date: isValidKey(raw?.date) ? raw.date : dateKey(new Date(ctx.now)),
    amount: Math.abs(roundMoney(raw?.amount)),
    accountId,
    toAccountId: kind === 'transfer' ? toAccountId : null,
    categoryId: categoryIds && raw?.categoryId && !categoryIds.has(raw.categoryId) ? null : raw?.categoryId ? String(raw.categoryId) : null,
    note: text(raw?.note, 160),
    tags: asArray(raw?.tags).map((tag) => text(tag, 24)).filter(Boolean).slice(0, 6),
    cleared: raw?.cleared !== false,
    /** Optional link to the mission or habit that caused the spend. */
    sourceId: raw?.sourceId ? String(raw.sourceId) : null,
    createdAt: Number.isFinite(raw?.createdAt) ? raw.createdAt : ctx.now,
  }
}

/** @param {any} raw @param {{categoryIds?: Set<string>}} [refs] */
export function normalizeBudget(raw, refs = {}) {
  const { categoryIds } = refs
  const categoryId = raw?.categoryId ? String(raw.categoryId) : ''
  if (!categoryId) return null
  if (categoryIds && !categoryIds.has(categoryId)) return null
  const limit = roundMoney(raw?.limit)
  if (!(limit > 0)) return null
  return { categoryId, limit, rollover: raw?.rollover === true }
}

/**
 * @param {any} raw
 * @param {any} ctx
 * @param {{categoryIds?: Set<string>, accountIds?: Set<string>}} [refs]
 */
export function normalizeRecurring(raw, ctx, refs = {}) {
  const { categoryIds, accountIds } = refs
  const cadence = CADENCE_SET.has(raw?.cadence) ? raw.cadence : 'monthly'
  const amount = roundMoney(raw?.amount)
  if (!(amount > 0)) return null
  if (accountIds && raw?.accountId && !accountIds.has(raw.accountId)) return null
  return {
    id: String(raw?.id || ctx.uid()),
    name: text(raw?.name, 80) || 'Recurring charge',
    amount,
    cadence,
    dayOfMonth: Math.min(28, Math.max(1, Math.round(Number(raw?.dayOfMonth) || 1))),
    categoryId: categoryIds && raw?.categoryId && !categoryIds.has(raw.categoryId) ? null : raw?.categoryId ? String(raw.categoryId) : null,
    accountId: accountIds && raw?.accountId && !accountIds.has(raw.accountId) ? null : raw?.accountId ? String(raw.accountId) : null,
    active: raw?.active !== false,
    note: text(raw?.note, 120),
    createdAt: Number.isFinite(raw?.createdAt) ? raw.createdAt : ctx.now,
  }
}

export function normalizeNote(raw, ctx) {
  const amount = roundMoney(raw?.amount)
  if (!(amount > 0)) return null
  return {
    id: String(raw?.id || ctx.uid()),
    direction: raw?.direction === 'i_owe' ? 'i_owe' : 'owed_to_me',
    person: text(raw?.person, 60) || 'Someone',
    amount,
    date: isValidKey(raw?.date) ? raw.date : dateKey(new Date(ctx.now)),
    dueDate: isValidKey(raw?.dueDate) ? raw.dueDate : null,
    settled: raw?.settled === true,
    note: text(raw?.note, 160),
    createdAt: Number.isFinite(raw?.createdAt) ? raw.createdAt : ctx.now,
  }
}

/**
 * Normalise any stored/imported ledger into the exact shape the views use.
 * Missing collections become empty; invalid records are dropped (never
 * half-applied) and unknown fields are preserved where it is safe to do so.
 */
/** @param {any} raw @param {any} ctx @param {{categoryIds?: Set<string>}} [refs] */
export function normalizeLedger(raw, ctx, refs = {}) {
  const { categoryIds } = refs
  const source = isObj(raw) ? raw : {}
  const accounts = asArray(source.accounts).filter(isObj).map((account) => normalizeAccount(account, ctx))
  const accountIds = new Set(accounts.map((account) => account.id))
  const transactions = asArray(source.transactions)
    .filter(isObj)
    .map((tx) => normalizeTransaction(tx, ctx, { accountIds, categoryIds }))
    .filter((tx) => tx.amount > 0)
    .sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : a.date.localeCompare(b.date)))
    .slice(-6000)
  const budgets = asArray(source.budgets)
    .filter(isObj)
    .map((budget) => normalizeBudget(budget, { categoryIds }))
    .filter(Boolean)
    .filter((budget, index, all) => all.findIndex((row) => row.categoryId === budget.categoryId) === index)
  const recurring = asArray(source.recurring)
    .filter(isObj)
    .map((item) => normalizeRecurring(item, ctx, { categoryIds, accountIds }))
    .filter(Boolean)
    .slice(0, 200)
  const notes = asArray(source.notes)
    .filter(isObj)
    .map((note) => normalizeNote(note, ctx))
    .filter(Boolean)
    .slice(-400)
  return {
    accounts,
    transactions,
    budgets,
    recurring,
    notes,
    updatedAt: Number.isFinite(source.updatedAt) ? source.updatedAt : null,
  }
}

export function emptyLedger() {
  return { accounts: [], transactions: [], budgets: [], recurring: [], notes: [], updatedAt: null }
}

/* ------------------------------------------------------------------ totals */

/** Balance of one account: opening + income − expense − transfers out + transfers in. */
export function accountBalance(ledger, accountId) {
  const account = ledger?.accounts?.find((row) => row.id === accountId)
  if (!account) return 0
  let balance = roundMoney(account.openingBalance)
  for (const tx of ledger.transactions || []) {
    if (tx.kind === 'transfer') {
      if (tx.accountId === accountId) balance -= tx.amount
      if (tx.toAccountId === accountId) balance += tx.amount
    } else if (tx.accountId === accountId) {
      balance += tx.kind === 'income' ? tx.amount : -tx.amount
    }
  }
  return roundMoney(balance)
}

/**
 * Every account with its live balance plus the roll-ups the UI needs.
 * Credit cards are treated as liabilities: a positive balance on a card means
 * money spent, so it is subtracted from net worth.
 */
export function accountSummary(ledger) {
  const rows = (ledger?.accounts || []).map((account) => {
    const balance = accountBalance(ledger, account.id)
    const liquid = ['bank', 'cash', 'wallet'].includes(account.kind)
    const liability = account.kind === 'credit'
    return {
      ...account,
      balance,
      /** What this account contributes to net worth. */
      net: liability ? -Math.abs(balance) : balance,
      liquid,
      liability,
      kindLabel: ACCOUNT_KINDS.find((kind) => kind.id === account.kind)?.label || 'Account',
    }
  })
  const active = rows.filter((row) => !row.archived)
  return {
    rows,
    active,
    netWorth: roundMoney(active.reduce((sum, row) => sum + row.net, 0)),
    liquid: roundMoney(active.filter((row) => row.liquid).reduce((sum, row) => sum + row.balance, 0)),
    invested: roundMoney(active.filter((row) => row.kind === 'investment').reduce((sum, row) => sum + row.balance, 0)),
    owed: roundMoney(active.filter((row) => row.liability).reduce((sum, row) => sum + Math.abs(row.balance), 0)),
  }
}

/** Transactions inside a `YYYY-MM` month, oldest first. */
export function transactionsInMonth(ledger, month) {
  return (ledger?.transactions || []).filter((tx) => tx.date.slice(0, 7) === month)
}

/** Transactions in an inclusive date-key range. */
export function transactionsBetween(ledger, from, to) {
  return (ledger?.transactions || []).filter((tx) => tx.date >= from && tx.date <= to)
}

/**
 * Month roll-up. Transfers are excluded from income and expense (they only
 * move money between your own accounts) but still count towards account
 * balances. Adjustments count as income when positive and expense when
 * negative so a reconciliation never hides a correction.
 */
export function monthSummary(ledger, month, { categories = [] } = {}) {
  const rows = transactionsInMonth(ledger, month)
  let income = 0
  let expense = 0
  const byCategory = new Map()
  for (const tx of rows) {
    if (tx.kind === 'income') income += tx.amount
    else if (tx.kind === 'expense') {
      expense += tx.amount
      const key = tx.categoryId || 'uncategorised'
      const bucket = byCategory.get(key) || { categoryId: key, total: 0, count: 0 }
      bucket.total += tx.amount
      bucket.count += 1
      byCategory.set(key, bucket)
    }
  }
  const categoryRows = [...byCategory.values()]
    .map((bucket) => {
      const category = categories.find((row) => row.id === bucket.categoryId)
      return {
        ...bucket,
        total: roundMoney(bucket.total),
        name: category?.name || 'Uncategorised',
        color: category?.color || '#9aabbf',
      }
    })
    .sort((a, b) => b.total - a.total)
  const net = roundMoney(income - expense)
  return {
    month,
    income: roundMoney(income),
    expense: roundMoney(expense),
    net,
    saved: net,
    savingsRate: income > 0 ? Math.round((net / income) * 100) : null,
    txCount: rows.length,
    byCategory: categoryRows,
    largest: categoryRows[0] || null,
  }
}

/** Budget rows for a month, with real spend attached. */
export function budgetStatus(ledger, month, categories = []) {
  const spend = new Map()
  for (const tx of transactionsInMonth(ledger, month)) {
    if (tx.kind !== 'expense' || !tx.categoryId) continue
    spend.set(tx.categoryId, roundMoney((spend.get(tx.categoryId) || 0) + tx.amount))
  }
  return (ledger?.budgets || [])
    .map((budget) => {
      const category = categories.find((row) => row.id === budget.categoryId)
      const spent = spend.get(budget.categoryId) || 0
      const remaining = roundMoney(budget.limit - spent)
      return {
        ...budget,
        name: category?.name || 'Uncategorised',
        color: category?.color || '#9aabbf',
        spent,
        remaining,
        pct: budget.limit > 0 ? Math.round((spent / budget.limit) * 100) : 0,
        over: remaining < 0,
      }
    })
    .sort((a, b) => b.pct - a.pct)
}

/** Total planned budget across categories. */
export function plannedBudget(ledger) {
  return roundMoney((ledger?.budgets || []).reduce((sum, budget) => sum + budget.limit, 0))
}

/** Monthly-equivalent cost of every active recurring charge. */
export function recurringMonthlyTotal(ledger) {
  const multiplier = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 }
  return roundMoney(
    (ledger?.recurring || [])
      .filter((item) => item.active)
      .reduce((sum, item) => sum + item.amount * (multiplier[item.cadence] ?? 1), 0),
  )
}

/**
 * The next charge date for a recurring item on or after `todayKey`.
 * Weekly items anchor on the item's creation date when it exists.
 */
export function nextChargeDate(item, todayKey) {
  if (!item) return null
  const today = parseKey(todayKey)
  if (item.cadence === 'weekly') {
    const anchor = isValidKey(dateKey(new Date(item.createdAt))) ? dateKey(new Date(item.createdAt)) : todayKey
    const gap = Math.max(0, diffDays(anchor, todayKey)) % 7
    return addDays(todayKey, gap === 0 ? 0 : 7 - gap)
  }
  const months = item.cadence === 'yearly' ? 12 : item.cadence === 'quarterly' ? 3 : 1
  const day = Math.min(28, Math.max(1, item.dayOfMonth || 1))
  for (let step = 0; step < 13; step += months) {
    const monthIndex = today.getMonth() + step
    const year = today.getFullYear() + Math.floor(monthIndex / 12)
    const month = ((monthIndex % 12) + 12) % 12
    const candidate = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    if (candidate >= todayKey) return candidate
  }
  return null
}

/**
 * Everything that will ask for money in the next `days`, combining recurring
 * charges with unsettled IOUs. Sorted by date, so the Forecast can show it.
 */
export function upcomingObligations(ledger, { todayKey = dateKey(), days = 30, currency = 'INR' } = {}) {
  const until = addDays(todayKey, days)
  const rows = []
  for (const item of ledger?.recurring || []) {
    if (!item.active) continue
    const due = nextChargeDate(item, todayKey)
    if (due && due <= until) rows.push({ id: item.id, kind: 'recurring', label: item.name, amount: item.amount, date: due, categoryId: item.categoryId, currency })
  }
  for (const note of ledger?.notes || []) {
    if (note.settled || note.direction !== 'i_owe' || !note.dueDate) continue
    if (note.dueDate <= until) rows.push({ id: note.id, kind: 'note', label: `Owed to ${note.person}`, amount: note.amount, date: note.dueDate, categoryId: null, currency })
  }
  return rows.filter((row) => row.date >= addDays(todayKey, -90)).sort((a, b) => a.date.localeCompare(b.date))
}

/** Unsettled IOUs in both directions. */
export function noteSummary(ledger) {
  const open = (ledger?.notes || []).filter((note) => !note.settled)
  const owedToMe = roundMoney(open.filter((note) => note.direction === 'owed_to_me').reduce((sum, note) => sum + note.amount, 0))
  const iOwe = roundMoney(open.filter((note) => note.direction === 'i_owe').reduce((sum, note) => sum + note.amount, 0))
  return { owedToMe, iOwe, net: roundMoney(owedToMe - iOwe), open }
}

/**
 * Day-by-day cumulative net cash movement for a month — the small sparkline
 * that answers "am I ahead or behind this month?" at a glance.
 */
export function cashflowSeries(ledger, month) {
  const [year, monthNumber] = month.split('-').map(Number)
  const daysInMonth = new Date(year, monthNumber, 0).getDate()
  const totals = new Map()
  for (const tx of transactionsInMonth(ledger, month)) {
    if (tx.kind === 'transfer') continue
    const signed = tx.kind === 'income' ? tx.amount : -tx.amount
    totals.set(tx.date, roundMoney((totals.get(tx.date) || 0) + signed))
  }
  let running = 0
  return Array.from({ length: daysInMonth }, (_, index) => {
    const key = `${month}-${String(index + 1).padStart(2, '0')}`
    running = roundMoney(running + (totals.get(key) || 0))
    return { date: key, day: index + 1, change: totals.get(key) || 0, cumulative: running }
  })
}

/**
 * A single honest sentence about where the month stands. Deterministic: the
 * same records always produce the same sentence.
 */
export function moneyAdvice(ledger, { todayKey = dateKey(), month = monthKey(todayKey), categories = [], currency = 'INR' } = {}) {
  const summary = monthSummary(ledger, month, { categories })
  const budgets = budgetStatus(ledger, month, categories)
  const planned = plannedBudget(ledger)
  const overspent = budgets.filter((row) => row.over)
  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()
  const dayOfMonth = Number(todayKey.slice(8, 10))
  const pace = Math.round((dayOfMonth / daysInMonth) * 100)
  if (!ledger?.accounts?.length) return { tone: 'info', title: 'Start with one account.', body: 'Add the account you actually spend from and every figure below becomes real.' }
  if (overspent.length) {
    const worst = overspent[0]
    return { tone: 'warn', title: `${worst.name} is over its plan.`, body: `${formatMoney(Math.abs(worst.remaining), { currency })} past the ${formatMoney(worst.limit, { currency })} budget with ${daysInMonth - dayOfMonth} days left. Adjust the plan or move the spend — no judgement either way.` }
  }
  if (!summary.txCount) return { tone: 'info', title: 'A clean slate for this month.', body: 'Record one expense and the month starts telling the truth.' }
  if (summary.net < 0) return { tone: 'warn', title: 'More went out than came in.', body: `${formatMoney(summary.expense, { currency })} spent against ${formatMoney(summary.income, { currency })} received. One category is usually the whole story: ${summary.largest ? `${summary.largest.name} at ${formatMoney(summary.largest.total, { currency })}` : 'check the breakdown'}.` }
  if (planned && summary.expense > planned * (pace / 100) * 1.15) return { tone: 'warn', title: 'Spending is ahead of the month.', body: `${pace}% of the month has passed and ${Math.round((summary.expense / planned) * 100)}% of the budget is used. Nothing is broken — it is just worth knowing early.` }
  return { tone: 'good', title: 'The month is holding.', body: `${formatMoney(summary.income - summary.expense, { currency })} kept so far, ${summary.savingsRate == null ? 'with no income recorded' : `${summary.savingsRate}% of income`}. ${budgets.length ? `${budgets.length - overspent.length} of ${budgets.length} budgets are within plan.` : 'Add a budget and this view will hold you to your own intention.'}` }
}

/** Category spend totals with a share of the month's expense (for the chart). */
export function categorySpend(ledger, month, categories = []) {
  const summary = monthSummary(ledger, month, { categories })
  return summary.byCategory.map((row) => ({ ...row, share: summary.expense ? Math.round((row.total / summary.expense) * 100) : 0 }))
}

/** Export the ledger as CSV text — the user's money data must never be trapped. */
export function transactionsToCsv(ledger, { categories = [] } = {}) {
  const accounts = new Map((ledger?.accounts || []).map((account) => [account.id, account.name]))
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]))
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`
  const header = ['Date', 'Kind', 'Amount', 'Account', 'To account', 'Category', 'Note', 'Cleared', 'Tags']
  const rows = (ledger?.transactions || []).map((tx) => [
    tx.date,
    tx.kind,
    roundMoney(tx.amount).toFixed(2),
    accounts.get(tx.accountId) || '',
    tx.toAccountId ? accounts.get(tx.toAccountId) || '' : '',
    tx.categoryId ? categoryNames.get(tx.categoryId) || '' : '',
    tx.note,
    tx.cleared ? 'yes' : 'no',
    (tx.tags || []).join(' '),
  ])
  return [header, ...rows].map((row) => row.map(escape).join(',')).join('\r\n')
}

/**
 * Net-worth history derived from the transactions themselves: for each month
 * that has records, the closing balance of every account at that point.
 * This is real history, not a projection.
 */
export function netWorthHistory(ledger, { months = 12, todayKey = dateKey() } = {}) {
  const all = [...(ledger?.transactions || [])].sort((a, b) => a.date.localeCompare(b.date))
  if (!all.length) return []
  const start = monthKey(all[0].date)
  const end = monthKey(todayKey)
  const cursor = []
  const [startYear, startMonth] = start.split('-').map(Number)
  const [endYear, endMonth] = end.split('-').map(Number)
  let year = startYear
  let month = startMonth
  while (year < endYear || (year === endYear && month <= endMonth)) {
    cursor.push(`${year}-${String(month).padStart(2, '0')}`)
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  const opening = roundMoney((ledger?.accounts || []).reduce((sum, account) => sum + (account.kind === 'credit' ? -Math.abs(account.openingBalance) : account.openingBalance), 0))
  let running = opening
  const rows = cursor.map((monthKeyValue) => {
    for (const tx of all) {
      if (tx.date.slice(0, 7) !== monthKeyValue) continue
      if (tx.kind === 'income') running += tx.amount
      else if (tx.kind === 'expense') running -= tx.amount
    }
    return { month: monthKeyValue, netWorth: roundMoney(running) }
  })
  return rows.slice(-months)
}
