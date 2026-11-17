/* -------------------------------------------------------------------------
   COMMAND — the executive layer
   -------------------------------------------------------------------------
   Overview used to answer one question ("what is my next move?"). This module
   answers the questions a serious operator asks every morning:

     • What is the one thing that needs a decision right now?
     • Is the week physically possible, or am I lying to myself?
     • Which few numbers actually predict a good week?
     • What is quietly slipping — money, routines, sleep, reflection?

   Everything here is pure and derived from records the app already holds
   (schedule, missions, focus history, journal, routines, ledger). Nothing is
   invented, nothing is estimated from a model, and the same records always
   produce the same answer.
   ------------------------------------------------------------------------- */

import { addDays, dateKey, formatDuration, minutesOfDay, weekdayShort } from './dates.js'
import { rangeDayStats } from './daystats.js'
import { scheduleFor, scheduleConflicts } from './planner.js'
import { overdueTasks } from './score.js'
import { top3Stats } from './top3.js'
import { sessionTotals } from './focus.js'
import { journalStats } from './journal.js'
import { budgetStatus, monthSummary, noteSummary, recurringMonthlyTotal } from './ledger.js'

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(value)))

/** Minutes between the configured working hours. */
export function capacityMinutes(settings) {
  const parse = (value, fallback) => {
    const [hours, minutes] = String(value || fallback).split(':').map(Number)
    return (hours || 0) * 60 + (minutes || 0)
  }
  const start = parse(settings?.workingHours?.start, '09:00')
  const end = parse(settings?.workingHours?.end, '18:00')
  return Math.max(60, end > start ? end - start : 60)
}

/** Rows for the next `days` days: committed minutes, capacity and verdict. */
export function loadPlan(state, { todayKey = dateKey(), now = new Date(), days = 7 } = {}) {
  const capacity = capacityMinutes(state.settings)
  const rows = []
  for (let index = 0; index < days; index += 1) {
    const key = addDays(todayKey, index)
    const blocks = scheduleFor(state, key).filter((block) => block.kind !== 'break')
    const committed = blocks.reduce((sum, block) => sum + (block.duration || 30), 0)
    const conflicts = scheduleConflicts(blocks, state.settings.protectedTime, key)
    const openTasks = (state.tasks || []).filter((task) => task.date === key && !task.done && task.status !== 'cancelled' && !task.inbox)
    const unplaced = openTasks.filter((task) => !blocks.some((block) => block.taskId === task.id))
    const unplacedMinutes = unplaced.reduce((sum, task) => sum + (task.estimateMinutes || 30), 0)
    const ratio = capacity ? (committed + unplacedMinutes) / capacity : 0
    const status = conflicts.length ? 'conflict' : ratio > 1 ? 'over' : ratio > 0.85 ? 'full' : ratio > 0.25 ? 'balanced' : committed || unplaced.length ? 'light' : 'empty'
    rows.push({
      key,
      weekday: weekdayShort(new Date(`${key}T12:00:00`).getDay()),
      day: Number(key.slice(8)),
      isToday: key === todayKey,
      committedMinutes: committed,
      unplacedMinutes,
      plannedMinutes: committed + unplacedMinutes,
      capacity,
      share: clamp(ratio * 100, 0, 999),
      blocks: blocks.length,
      tasks: openTasks.length,
      conflicts: conflicts.length,
      status,
    })
  }
  const totalPlanned = rows.reduce((sum, row) => sum + row.plannedMinutes, 0)
  const totalCapacity = capacity * days
  return {
    rows,
    capacity,
    totalPlanned,
    totalCapacity,
    share: totalCapacity ? Math.round((totalPlanned / totalCapacity) * 100) : 0,
    overcommitted: rows.filter((row) => row.status === 'over' || row.status === 'conflict').length,
    emptyDays: rows.filter((row) => row.status === 'empty').length,
    freeMinutes: Math.max(0, totalCapacity - totalPlanned),
  }
}

/**
 * The one decision that matters right now. Ordered, deterministic and always
 * accompanied by the surface that can resolve it.
 */
export function headline(state, { todayKey = dateKey(), now = new Date() } = {}) {
  const stats = rangeDayStats(state, todayKey, todayKey, { todayKey, now })[0]
  const blocks = scheduleFor(state, todayKey)
  const conflicts = scheduleConflicts(blocks, state.settings.protectedTime, todayKey)
  const overdue = overdueTasks(state, todayKey)
  const top3 = top3Stats(state, todayKey)
  const openToday = (state.tasks || []).filter((task) => task.date === todayKey && !task.done && task.status !== 'cancelled' && !task.inbox)
  const load = loadPlan(state, { todayKey, now, days: 7 })
  const month = monthKeyOf(todayKey)
  const budgets = budgetStatus(state.ledger || {}, month, state.categories || [])
  const overspent = budgets.filter((row) => row.over)
  const notes = noteSummary(state.ledger || {})
  const journal = journalStats(state.journal || {}, { todayKey, days: 7 })
  const hour = now.getHours()

  if (conflicts.length) {
    return {
      key: 'conflict',
      tone: 'warn',
      icon: 'flag',
      title: `${conflicts.length} commitment${conflicts.length === 1 ? '' : 's'} overlap today`,
      reason: conflicts[0].label,
      action: 'Open the schedule',
      view: 'schedule',
      detail: 'Two promises cannot both keep the same hour.',
    }
  }
  const urgentOverdue = overdue.filter((task) => task.priority === 'high')
  if (urgentOverdue.length) {
    return {
      key: 'overdue',
      tone: 'warn',
      icon: 'recover',
      title: urgentOverdue[0].title,
      reason: `${urgentOverdue.length} high-priority mission${urgentOverdue.length === 1 ? '' : 's'} slipped past the planned day.`,
      action: 'Reschedule or complete it',
      view: 'tasks',
      detail: 'Clear the oldest debt first — everything else feels lighter afterwards.',
    }
  }
  if (load.overcommitted) {
    const worst = load.rows.find((row) => row.status === 'over' || row.status === 'conflict')
    return {
      key: 'overcommitted',
      tone: 'warn',
      icon: 'gauge',
      title: `${load.overcommitted} day${load.overcommitted === 1 ? '' : 's'} this week cannot physically fit`,
      reason: `${worst.weekday} is at ${Math.min(999, worst.share)}% of a realistic working day.`,
      action: 'Defer something on purpose',
      view: 'forecast',
      detail: 'Choose what moves now, while it is still your decision.',
    }
  }
  const running = blocks.find((block) => {
    const start = minutesOfDay(block.time)
    const end = start + (block.duration || 30)
    const nowMinutes = now.getHours() * 60 + now.getMinutes()
    return nowMinutes >= start && nowMinutes < end && block.status !== 'completed'
  })
  if (running) {
    return {
      key: 'running',
      tone: 'good',
      icon: 'play',
      title: running.title,
      reason: 'This block is happening right now.',
      action: 'Start a focus session',
      view: 'focus',
      detail: `${formatDuration(running.duration || 30)} blocked from ${running.time}. Nothing else needs you for that time.`,
    }
  }
  if (openToday.length && !top3.total) {
    return {
      key: 'choose',
      tone: 'info',
      icon: 'target',
      title: 'Today has missions but no priorities',
      reason: `${openToday.length} open mission${openToday.length === 1 ? '' : 's'} and three slots for what matters.`,
      action: 'Choose your three',
      view: 'day',
      detail: 'A list is not a plan until something is ranked above the rest.',
    }
  }
  if (overspent.length) {
    return {
      key: 'budget',
      tone: 'warn',
      icon: 'receipt',
      title: `${overspent[0].name} is over its monthly plan`,
      reason: `${overspent[0].pct}% of the budget used with the month still running.`,
      action: 'Review the ledger',
      view: 'money',
      detail: 'Money and attention are the same resource. Both deserve an honest number.',
    }
  }
  const dueSoon = (state.ledger?.recurring || []).filter((item) => item.active && nextChargeWithin(item, todayKey, 3))
  if (dueSoon.length) {
    return {
      key: 'bill',
      tone: 'info',
      icon: 'calendar',
      title: `${dueSoon[0].name} is due in the next few days`,
      reason: `${dueSoon.length} recurring charge${dueSoon.length === 1 ? '' : 's'} within three days.`,
      action: 'See what is leaving',
      view: 'money',
      detail: 'Nothing should be a surprise because it happens every month.',
    }
  }
  if (stats.hasData && stats.focusedMinutes < capacityMinutes(state.settings) * 0.15 && hour >= 15) {
    return {
      key: 'focus',
      tone: 'info',
      icon: 'focus',
      title: 'The day is mostly gone and focus is thin',
      reason: `${formatDuration(stats.focusedMinutes)} of recorded deep work so far.`,
      action: 'Enter the Focus Room',
      view: 'focus',
      detail: 'One honest 25-minute block would still change the day.',
    }
  }
  if (hour >= 18 && !journal.count) {
    return {
      key: 'reflect',
      tone: 'info',
      icon: 'review',
      title: 'The day will be over in a few hours',
      reason: 'No journal entry this week.',
      action: 'Write three lines',
      view: 'journal',
      detail: 'What actually happened is worth more than what you planned.',
    }
  }
  if (notes.open.length && notes.iOwe > 0) {
    return {
      key: 'iou',
      tone: 'info',
      icon: 'users',
      title: `You owe ${notes.open.filter((row) => row.direction === 'i_owe').length} settling`,
      reason: 'Small debts take up space whether or not you think about them.',
      action: 'Settle the ledger',
      view: 'money',
      detail: 'One transfer and it is off your mind.',
    }
  }
  if (!blocks.length && !openToday.length) {
    return {
      key: 'open',
      tone: 'good',
      icon: 'leaf',
      title: 'The day is genuinely open',
      reason: 'Nothing is scheduled and nothing is overdue.',
      action: 'Plan a shape for it',
      view: 'schedule',
      detail: 'Unscheduled is not the same as free. Give one thing a place.',
    }
  }
  return {
    key: 'steadys',
    tone: 'good',
    icon: 'shield',
    title: 'Everything that matters is in hand',
    reason: 'No conflicts, nothing overdue, the week fits.',
    action: 'Use the space well',
    view: 'focus',
    detail: 'This is what a working system feels like. Protect it.',
  }
}

function monthKeyOf(key) {
  return String(key).slice(0, 7)
}

function nextChargeWithin(item, todayKey, days) {
  const horizon = addDays(todayKey, days)
  const day = Math.min(28, Math.max(1, item.dayOfMonth || 1))
  const candidateThis = `${todayKey.slice(0, 7)}-${String(day).padStart(2, '0')}`
  if (candidateThis >= todayKey && candidateThis <= horizon) return true
  const nextMonth = addDays(`${todayKey.slice(0, 7)}-28`, 4)
  const candidateNext = `${nextMonth.slice(0, 7)}-${String(day).padStart(2, '0')}`
  return candidateNext >= todayKey && candidateNext <= horizon
}

/**
 * The few numbers worth watching. Each signal carries its own target, tone,
 * trend and the view that can change it — so nothing is a dead end.
 */
export function healthSignals(state, { todayKey = dateKey(), now = new Date() } = {}) {
  const window = rangeDayStats(state, addDays(todayKey, -6), todayKey, { todayKey, now })
  const today = window[window.length - 1]
  const done = window.filter((row) => row.hasAnyActivity)
  const avgScore = done.length ? Math.round(done.reduce((sum, row) => sum + row.score, 0) / done.length) : 0
  const top3 = top3Stats(state, todayKey)
  const focusTarget = state.settings.focus?.targetMinutes || 180
  const week = loadPlan(state, { todayKey, now, days: 7 })
  const journal = journalStats(state.journal || {}, { todayKey, days: 7 })
  const month = monthKeyOf(todayKey)
  const money = monthSummary(state.ledger || {}, month, { categories: state.categories || [] })
  const budgets = budgetStatus(state.ledger || {}, month, state.categories || [])
  const routinesToday = (state.routines || []).filter((routine) => !routine.archived && routine.days.includes(new Date(`${todayKey}T12:00:00`).getDay()))
  const routineChecks = (state.routineHistory?.[todayKey] || {})
  const routinesDone = routinesToday.filter((routine) => {
    const checked = routineChecks[routine.id] || []
    return routine.activities.length > 0 && routine.activities.every((activity) => checked.includes(activity.id))
  }).length

  const signals = [
    {
      key: 'execution',
      label: 'Execution today',
      value: today.hasAnyActivity ? today.score : 0,
      suffix: '',
      target: 70,
      display: today.hasAnyActivity ? String(today.score) : '—',
      caption: today.hasAnyActivity ? `7-day average ${avgScore}` : 'No activity recorded yet',
      good: today.hasAnyActivity && today.score >= 70,
      warn: today.hasAnyActivity && today.score < 40,
      view: 'progress',
      icon: 'gauge',
    },
    {
      key: 'priorities',
      label: 'Priorities',
      value: top3.total ? Math.round((top3.done / top3.total) * 100) : 0,
      display: `${top3.done}/${top3.total}`,
      caption: top3.total ? (top3.done === top3.total ? 'All three closed' : `${top3.total - top3.done} still open`) : 'Nothing chosen yet',
      good: top3.total > 0 && top3.done === top3.total,
      warn: top3.total === 0,
      view: 'day',
      icon: 'target',
    },
    {
      key: 'focus',
      label: 'Deep work',
      value: clamp((today.focusedMinutes / focusTarget) * 100),
      display: formatDuration(today.focusedMinutes),
      caption: `of ${formatDuration(focusTarget)} intended`,
      good: today.focusedMinutes >= focusTarget,
      warn: today.focusedMinutes === 0,
      view: 'focus',
      icon: 'focus',
    },
    {
      key: 'capacity',
      label: 'Week fits',
      value: week.share > 100 ? 100 : week.share,
      display: `${week.share}%`,
      caption: week.overcommitted ? `${week.overcommitted} day${week.overcommitted === 1 ? '' : 's'} over capacity` : `${formatDuration(week.freeMinutes)} unclaimed`,
      good: week.overcommitted === 0,
      warn: week.overcommitted > 1,
      view: 'forecast',
      icon: 'calendar',
    },
    {
      key: 'reflection',
      label: 'Reflection',
      value: clamp((journal.count / 7) * 100),
      display: `${journal.count}/7`,
      caption: journal.streak ? `${journal.streak}-day writing streak` : 'One honest entry a week is enough',
      good: journal.count >= 4,
      warn: journal.count === 0,
      view: 'journal',
      icon: 'review',
    },
    {
      key: 'routines',
      label: 'Routines',
      value: routinesToday.length ? clamp((routinesDone / routinesToday.length) * 100) : 0,
      display: routinesToday.length ? `${routinesDone}/${routinesToday.length}` : '—',
      caption: routinesToday.length ? 'Complete today' : 'Nothing scheduled today',
      good: routinesToday.length > 0 && routinesDone === routinesToday.length,
      warn: false,
      view: 'routines',
      icon: 'routines',
    },
    {
      key: 'money',
      label: 'Money kept',
      value: money.income ? clamp((money.net / money.income) * 100) : 0,
      display: money.income ? `${money.savingsRate}%` : budgets.length ? `${budgets.filter((row) => row.over).length} over` : '—',
      caption: money.income ? 'of this month’s income' : budgets.length ? 'budgets outside plan' : 'No ledger yet',
      good: money.income > 0 && money.savingsRate >= 20,
      warn: budgets.some((row) => row.over),
      view: 'money',
      icon: 'coins',
    },
  ]
  return signals
}

/**
 * Four pillars, one index. Pillars with no underlying records are excluded
 * and the remaining weights are redistributed — the same honest approach the
 * daily score already takes.
 */
export function commandIndex(state, { todayKey = dateKey(), now = new Date() } = {}) {
  const window = rangeDayStats(state, addDays(todayKey, -27), todayKey, { todayKey, now })
  const active = window.filter((row) => row.hasAnyActivity)
  const execution = active.length ? Math.round(active.reduce((sum, row) => sum + row.score, 0) / active.length) : null
  const focusTarget = (state.settings.focus?.targetMinutes || 180) * 7
  const focusWeek = rangeDayStats(state, addDays(todayKey, -6), todayKey, { todayKey, now }).reduce((sum, row) => sum + row.focusedMinutes, 0)
  const focus = focusWeek > 0 ? clamp((focusWeek / focusTarget) * 100) : null
  const journal = journalStats(state.journal || {}, { todayKey, days: 28 })
  const routines = (state.routines || []).filter((routine) => !routine.archived)
  const routineDays = routines.length ? new Set(Object.keys(state.routineHistory || {}).filter((key) => key >= addDays(todayKey, -27) && Object.values(state.routineHistory[key] || {}).some((checked) => Array.isArray(checked) && checked.length))) : null
  const consistency = journal.count || routineDays
    ? clamp(((journal.count / 28) * 0.6 + ((routineDays ? routineDays.size : 0) / 28) * 0.4) * 100)
    : null
  const month = monthKeyOf(todayKey)
  const money = monthSummary(state.ledger || {}, month, { categories: state.categories || [] })
  const budgets = budgetStatus(state.ledger || {}, month, state.categories || [])
  const stewardship = state.ledger?.accounts?.length
    ? clamp((money.income ? Math.max(0, Math.min(100, money.savingsRate || 0)) * 0.6 : 40) + (budgets.length ? (budgets.filter((row) => !row.over).length / budgets.length) * 40 : 20))
    : null

  const pillars = [
    { key: 'execution', label: 'Execution', value: execution, weight: 0.35, caption: 'Missions and adherence, last 28 days', view: 'progress', icon: 'gauge' },
    { key: 'focus', label: 'Deep work', value: focus, weight: 0.25, caption: 'Focused minutes against your own target', view: 'focus', icon: 'focus' },
    { key: 'consistency', label: 'Consistency', value: consistency, weight: 0.2, caption: 'Showing up — routines and reflection', view: 'routines', icon: 'routines' },
    { key: 'stewardship', label: 'Stewardship', value: stewardship, weight: 0.2, caption: 'Money kept, budgets kept', view: 'money', icon: 'coins' },
  ].map((pillar) => ({ ...pillar, available: pillar.value != null }))
  const available = pillars.filter((pillar) => pillar.available)
  const weightSum = available.reduce((sum, pillar) => sum + pillar.weight, 0)
  const index = weightSum ? Math.round(available.reduce((sum, pillar) => sum + pillar.value * pillar.weight, 0) / weightSum) : null
  return { index, pillars }
}

/** A one-line verdict that matches the index without flattering it. */
export function indexVerdict(index) {
  if (index == null) return 'Your index appears once there is something real to measure.'
  if (index >= 85) return 'An unusually strong month. Protect whatever made this possible.'
  if (index >= 70) return 'Working, and it shows. Keep the boring parts.'
  if (index >= 50) return 'Solid foundations with one clear drag. Fix that one thing.'
  if (index >= 30) return 'The pieces are there — the rhythm is not yet.'
  return 'Everything counts from here. One honest day is the whole start.'
}

/** Ordered, actionable suggestions (max 4) for "what to do about it". */
export function nextActions(state, { todayKey = dateKey(), now = new Date(), limit = 4 } = {}) {
  const out = []
  const add = (action) => {
    if (out.length >= limit) return
    if (out.some((row) => row.key === action.key)) return
    out.push(action)
  }
  const head = headline(state, { todayKey, now })
  add({ key: head.key, label: head.title, hint: head.action, view: head.view, icon: head.icon, tone: head.tone })
  const overdue = overdueTasks(state, todayKey)
  if (overdue.length) add({ key: 'overdue-list', label: `${overdue.length} mission${overdue.length === 1 ? '' : 's'} past their day`, hint: 'Recover the day', view: 'day', icon: 'recover', tone: 'warn' })
  const openToday = (state.tasks || []).filter((task) => task.date === todayKey && !task.done && task.status !== 'cancelled' && !task.inbox)
  if (openToday.length) add({ key: 'today-open', label: `${openToday.length} mission${openToday.length === 1 ? '' : 's'} still open today`, hint: 'See today', view: 'day', icon: 'missions', tone: 'info' })
  const inbox = (state.tasks || []).filter((task) => task.inbox && !task.done)
  if (inbox.length) add({ key: 'inbox', label: `${inbox.length} capture${inbox.length === 1 ? '' : 's'} waiting for a decision`, hint: 'Clear the inbox', view: 'tasks', icon: 'inbox', tone: 'info' })
  const week = loadPlan(state, { todayKey, now, days: 7 })
  if (week.emptyDays >= 5) add({ key: 'empty-week', label: 'The next seven days are almost empty', hint: 'Give the week a shape', view: 'forecast', icon: 'forecast', tone: 'info' })
  const month = monthKeyOf(todayKey)
  for (const budget of budgetStatus(state.ledger || {}, month, state.categories || [])) {
    if (budget.over) add({ key: `budget-${budget.categoryId}`, label: `${budget.name} is past its monthly plan`, hint: 'Review the ledger', view: 'money', icon: 'receipt', tone: 'warn' })
  }
  const journal = journalStats(state.journal || {}, { todayKey, days: 7 })
  if (journal.count === 0) add({ key: 'journal', label: 'No journal entry this week', hint: 'Write three lines', view: 'journal', icon: 'review', tone: 'info' })
  const recurring = recurringMonthlyTotal(state.ledger || {})
  if (recurring > 0) add({ key: 'recurring', label: 'Recurring charges are already promised every month', hint: 'See what is committed', view: 'money', icon: 'repeat', tone: 'info' })
  if (!state.goals?.length) add({ key: 'goal', label: 'No goals connected to the work', hint: 'Give it a direction', view: 'goals', icon: 'target', tone: 'info' })
  return out
}

/** Where the week actually went: weekday performance over the last 8 weeks. */
export function weekdayRhythm(state, { todayKey = dateKey(), now = new Date() } = {}) {
  const rows = rangeDayStats(state, addDays(todayKey, -55), todayKey, { todayKey, now })
  const buckets = Array.from({ length: 7 }, (_, index) => ({ weekday: index, label: weekdayShort(index), scores: [], focus: 0, days: 0 }))
  for (const row of rows) {
    if (!row.hasAnyActivity) continue
    const index = new Date(`${row.dateKey}T12:00:00`).getDay()
    buckets[index].scores.push(row.score)
    buckets[index].focus += row.focusedMinutes
    buckets[index].days += 1
  }
  const out = buckets.map((bucket) => ({
    weekday: bucket.weekday,
    label: bucket.label,
    days: bucket.days,
    focus: bucket.focus,
    average: bucket.scores.length ? Math.round(bucket.scores.reduce((sum, value) => sum + value, 0) / bucket.scores.length) : null,
  }))
  const measured = out.filter((row) => row.average != null)
  const best = measured.slice().sort((a, b) => b.average - a.average)[0] || null
  const hardest = measured.slice().sort((a, b) => a.average - b.average)[0] || null
  return { days: out, best, hardest, measured: measured.length }
}

/** Simple least-squares-free trend: last-7 average vs the 7 before it. */
export function trendOf(series) {
  if (!Array.isArray(series) || series.length < 4) return null
  const half = Math.floor(series.length / 2)
  const earlier = series.slice(0, half)
  const later = series.slice(series.length - half)
  const mean = (list) => list.reduce((sum, value) => sum + (Number(value) || 0), 0) / (list.length || 1)
  const before = mean(earlier)
  const after = mean(later)
  const delta = Math.round(after - before)
  return { before: Math.round(before), after: Math.round(after), delta, direction: delta > 2 ? 'up' : delta < -2 ? 'down' : 'flat' }
}

/**
 * Everything the planning assistant (and the optional AI) needs to be useful
 * about the whole workspace, in one compact object. No secrets, no PII beyond
 * what the user typed themselves.
 */
export function workspaceDigest(state, { todayKey = dateKey(), now = new Date() } = {}) {
  const head = headline(state, { todayKey, now })
  const index = commandIndex(state, { todayKey, now })
  const week = loadPlan(state, { todayKey, now, days: 7 })
  const month = monthKeyOf(todayKey)
  const money = monthSummary(state.ledger || {}, month, { categories: state.categories || [] })
  const focusWeek = rangeDayStats(state, addDays(todayKey, -6), todayKey, { todayKey, now }).reduce((sum, row) => sum + row.focusedMinutes, 0)
  return {
    todayKey,
    headline: head.title,
    reason: head.reason,
    index: index.index,
    week: {
      planned: week.totalPlanned,
      capacity: week.totalCapacity,
      share: week.share,
      overcommitted: week.overcommitted,
    },
    openTasks: (state.tasks || []).filter((task) => !task.done && task.status !== 'cancelled').length,
    overdue: overdueTasks(state, todayKey).length,
    focusWeek,
    money: { income: money.income, expense: money.expense, net: money.net, budgetOverspends: budgetStatus(state.ledger || {}, month, state.categories || []).filter((row) => row.over).length },
    goals: (state.goals || []).length,
    routines: (state.routines || []).filter((routine) => !routine.archived).length,
  }
}

/** Small helper for views: the greeting's supporting sentence. */
export function commandLine(state, { todayKey = dateKey(), now = new Date() } = {}) {
  const week = loadPlan(state, { todayKey, now, days: 7 })
  const focus = sessionTotals(state.focus?.sessions || [], todayKey).focusedMinutes
  const parts = []
  if (week.overcommitted) parts.push(`${week.overcommitted} day${week.overcommitted === 1 ? '' : 's'} over capacity`)
  if (focus) parts.push(`${formatDuration(focus)} focused`)
  const open = (state.tasks || []).filter((task) => task.date === todayKey && !task.done && task.status !== 'cancelled' && !task.inbox).length
  if (open) parts.push(`${open} open today`)
  return parts.length ? parts.join(' · ') : 'Nothing is late, nothing is clashing.'
}


