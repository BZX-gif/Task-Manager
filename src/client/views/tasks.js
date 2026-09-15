/* -------------------------------------------------------------------------
   TASKS — full task manager + Inbox + recurring tasks
   ------------------------------------------------------------------------- */

import { FREQUENCIES, FREQUENCY_LABELS, recurrenceLabel } from '../lib/recurrence.js'
import { isTop3, top3Candidates } from '../lib/top3.js'
import { overdueTasks } from '../lib/score.js'
import { addDays, formatDuration } from '../lib/dates.js'
import { closeModal, confirmDialog, escapeHtml, openModal, qs, qsa, toast } from '../core/dom.js'
import { commit, currentDayKey, ensureRecurringOccurrences, rollSeriesForward, state } from '../core/store.js'
import { categoryColor, categoryName, categoryOptions, emptyState, priorityColor, priorityRank } from './shared.js'
import { openFocusPickerForTask } from '../ui/focus.js'
import { uid } from '../lib/state.js'

export const FILTERS = ['today', 'upcoming', 'inbox', 'recurring', 'all', 'done']
const FILTER_LABELS = { today: 'Today', upcoming: 'Upcoming', inbox: 'Inbox', recurring: 'Repeating', all: 'All', done: 'Completed' }

let filter = 'today'
let searchTerm = ''

export function renderTasks() {
  const section = document.getElementById('view-tasks')
  if (!section) return
  const today = currentDayKey()
  const list = filteredTasks(today)
  const inboxCount = state.tasks.filter((t) => t.inbox && !t.done).length
  const overdue = overdueTasks(state, today)

  section.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="section-title">Task Manager</h2>
        <p class="section-sub">${state.tasks.filter((t) => !t.done).length} open · ${overdue.length ? `<span class="text-accent-5">${overdue.length} overdue</span>` : 'nothing overdue'} · ${inboxCount} in inbox</p>
      </div>
      <div class="flex gap-2">
        <button class="btn-ghost" data-action="quick-capture"><i class="fa-solid fa-bolt mr-1.5"></i>Quick capture</button>
        <button class="btn-primary" data-action="new-task"><i class="fa-solid fa-plus mr-1.5"></i>New Task</button>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <div class="segmented" id="task-filter-seg">
        ${FILTERS.map((f) => `<button data-f="${f}" class="${filter === f ? 'seg-active' : ''}">${FILTER_LABELS[f]}${f === 'inbox' && inboxCount ? ` (${inboxCount})` : ''}</button>`).join('')}
      </div>
      <div class="relative flex-1 min-w-[200px]">
        <i class="fa-solid fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs"></i>
        <input class="input-field !pl-9" placeholder="Search tasks…" value="${escapeHtml(searchTerm)}" data-task-search aria-label="Search tasks">
      </div>
    </div>

    <div class="glass-card p-4 sm:p-5">
      <div class="space-y-2.5" data-task-list>
        ${list.length ? list.map((t) => taskRowHtml(t, today)).join('') : emptyStateForFilter()}
      </div>
    </div>
  `

  qsa(section, '#task-filter-seg button').forEach((btn) =>
    btn.addEventListener('click', () => {
      filter = btn.dataset.f
      renderTasks()
    }),
  )
  const search = /** @type {any} */ (qs(section, '[data-task-search]'))
  search?.addEventListener('input', () => {
    searchTerm = search.value
    const listEl = section.querySelector('[data-task-list]')
    const rows = filteredTasks(currentDayKey())
    listEl.innerHTML = rows.length ? rows.map((t) => taskRowHtml(t, currentDayKey())).join('') : emptyStateForFilter()
    bindRows(section)
  })
  qsa(section, '[data-action]').forEach((btn) =>
    btn.addEventListener('click', () => {
      if (btn.dataset.action === 'new-task') openTaskModal()
      else if (btn.dataset.action === 'quick-capture') window.CC?.openQuickCapture()
    }),
  )
  bindRows(section)
}

function emptyStateForFilter() {
  if (filter === 'inbox') {
    return emptyState({
      icon: 'fa-solid fa-inbox',
      title: 'Inbox is empty',
      body: 'Dump quick ideas here without deciding where they belong. Sort them later.',
      action: '<button class="btn-ghost mt-2" data-action="quick-capture">Capture something</button>',
    })
  }
  if (filter === 'recurring') {
    return emptyState({ icon: 'fa-solid fa-arrows-rotate', title: 'No repeating tasks', body: 'Create a task and set it to repeat daily, weekly or on selected days.' })
  }
  return emptyState({ icon: 'fa-regular fa-square-check', title: 'Nothing here', body: 'Add a task or switch filters.' })
}

function filteredTasks(today) {
  const term = searchTerm.trim().toLowerCase()
  let list = [...state.tasks]
  if (filter === 'today') list = list.filter((t) => t.date === today && !t.inbox)
  else if (filter === 'upcoming') list = list.filter((t) => t.date && t.date > today && !t.done)
  else if (filter === 'inbox') list = list.filter((t) => t.inbox)
  else if (filter === 'recurring') list = list.filter((t) => t.recurrence)
  else if (filter === 'done') list = list.filter((t) => t.done)
  else if (filter === 'all') list = list.filter((t) => !t.inbox)
  if (term) list = list.filter((t) => `${t.title} ${t.notes || ''} ${categoryName(t.cat, '')}`.toLowerCase().includes(term))
  list.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1
    if (a.date && b.date && a.date !== b.date) return a.date < b.date ? -1 : 1
    if (a.date !== b.date) return a.date ? -1 : 1
    return priorityRank(a.priority) - priorityRank(b.priority)
  })
  return list
}

export function taskRowHtml(task, today) {
  const isOverdue = !task.done && task.date && task.date < today
  const inTop3 = isTop3(state, today, task.id)
  const focused = Math.round(
    (state.focus.sessions || []).filter((s) => s.taskId === task.id && s.mode !== 'break').reduce((sum, s) => sum + s.focusedSeconds, 0) / 60,
  )
  return `
    <div class="task-row ${task.done ? 'done' : ''} ${isOverdue ? 'is-overdue' : ''}" data-task-row="${escapeHtml(task.id)}">
      <button class="task-check ${task.done ? 'checked' : ''}" data-task-toggle="${escapeHtml(task.id)}" aria-label="Toggle ${escapeHtml(task.title)}"><i class="fa-solid fa-check"></i></button>
      <span class="priority-dot" style="background:${priorityColor(task.priority)}"></span>
      <div class="flex-1 min-w-0">
        <p class="task-title text-sm font-semibold text-slate-100 truncate">${escapeHtml(task.title)}</p>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-slate-500">
          ${task.cat ? `<span class="flex items-center gap-1"><span class="legend-dot" style="background:${categoryColor(task.cat)}"></span>${escapeHtml(categoryName(task.cat))}</span>` : ''}
          ${task.inbox ? '<span class="text-accent-2"><i class="fa-solid fa-inbox mr-1"></i>Inbox</span>' : ''}
          ${task.date ? `<span class="${isOverdue ? 'text-accent-5' : ''}"><i class="fa-regular fa-calendar mr-1"></i>${isOverdue ? 'Overdue · ' : ''}${escapeHtml(task.date)}${task.time ? ` ${escapeHtml(task.time)}` : ''}</span>` : ''}
          <span>${formatDuration(task.estimateMinutes || 30)}</span>
          ${task.recurrence ? `<span class="text-accent"><i class="fa-solid fa-arrows-rotate mr-1"></i>${escapeHtml(recurrenceLabel(task.recurrence))}</span>` : ''}
          ${focused ? `<span class="text-accent-2">${formatDuration(focused)} focused</span>` : ''}
          ${inTop3 ? '<span class="top3-tag">Top 3</span>' : ''}
        </div>
      </div>
      <div class="flex items-center gap-1.5">
        ${!task.done ? `<button class="icon-btn" data-task-focus="${escapeHtml(task.id)}" title="Start focus session"><i class="fa-solid fa-play text-xs"></i></button>` : ''}
        ${!task.done && !inTop3 ? `<button class="icon-btn" data-task-top3="${escapeHtml(task.id)}" title="Add to Top 3"><i class="fa-solid fa-ranking-star text-xs"></i></button>` : ''}
        ${task.inbox ? `<button class="icon-btn" data-task-sort="${escapeHtml(task.id)}" title="File this task"><i class="fa-solid fa-folder-open text-xs"></i></button>` : ''}
        <button class="icon-btn" data-task-edit="${escapeHtml(task.id)}" title="Edit"><i class="fa-solid fa-pen text-xs"></i></button>
        <button class="icon-btn" data-task-delete="${escapeHtml(task.id)}" title="Delete"><i class="fa-solid fa-trash text-xs"></i></button>
      </div>
    </div>`
}

function bindRows(section) {
  qsa(section, '[data-task-toggle]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const id = btn.dataset.taskToggle
      /** @type {any} */
      let followUp = null
      let nowDone = false
      commit((s) => {
        const task = s.tasks.find((t) => t.id === id)
        if (!task) return
        task.done = !task.done
        task.completedAt = task.done ? Date.now() : null
        nowDone = task.done
        if (task.done && task.recurrence) followUp = rollSeriesForward(task)
      })
      if (nowDone) toast('Task completed 🎉', 'success')
      if (followUp) toast(`Next occurrence created · ${followUp.date}`, 'info')
    }),
  )
  qsa(section, '[data-task-focus]').forEach((btn) => btn.addEventListener('click', () => openFocusPickerForTask(btn.dataset.taskFocus)))
  qsa(section, '[data-task-edit]').forEach((btn) => btn.addEventListener('click', () => openTaskModal(btn.dataset.taskEdit)))
  qsa(section, '[data-task-top3]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const result = window.CC.addTaskToTop3(btn.dataset.taskTop3)
      if (!result.ok) toast(result.reason || 'Could not add', 'error')
      else toast('Added to today\'s Top 3', 'success')
    }),
  )
  qsa(section, '[data-task-sort]').forEach((btn) => btn.addEventListener('click', () => openOrganiseModal(btn.dataset.taskSort)))
  qsa(section, '[data-task-delete]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const id = btn.dataset.taskDelete
      const task = state.tasks.find((t) => t.id === id)
      if (!task) return
      const confirmed = await confirmDialog({
        title: 'Delete task?',
        message: `“${task.title}” will be removed. Focus time already logged for it is kept.`,
        confirmText: 'Delete',
        danger: true,
      })
      if (!confirmed) return
      commit((s) => {
        s.tasks = s.tasks.filter((t) => t.id !== id)
        for (const key of Object.keys(s.top3 || {})) {
          s.top3[key] = s.top3[key].filter((x) => x !== id)
          if (!s.top3[key].length) delete s.top3[key]
        }
      })
      toast('Task deleted', 'info')
    }),
  )
}

/* ------------------------------------------------------------- task modal */

export function openTaskModal(id = null, { inbox = false } = {}) {
  const task = id ? state.tasks.find((t) => t.id === id) : null
  const today = currentDayKey()
  const recurrence = task?.recurrence || null
  const body = `
    <form id="task-form" class="space-y-4">
      <div>
        <label class="field-label" for="task-title">Task</label>
        <input required class="input-field" id="task-title" name="title" placeholder="e.g. Complete Polity chapter 5" value="${task ? escapeHtml(task.title) : ''}">
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="field-label" for="task-date">Date</label>
          <input type="date" class="input-field" id="task-date" name="date" value="${task?.date || (inbox ? '' : today)}">
        </div>
        <div>
          <label class="field-label" for="task-time">Start time <span class="text-slate-600">optional</span></label>
          <input type="time" class="input-field" id="task-time" name="time" value="${task?.time || ''}">
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="field-label" for="task-priority">Priority</label>
          <select class="input-field" id="task-priority" name="priority">
            ${['high', 'medium', 'low'].map((p) => `<option value="${p}" ${(task?.priority || 'medium') === p ? 'selected' : ''}>${p[0].toUpperCase() + p.slice(1)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="field-label" for="task-estimate">Estimate (min)</label>
          <input type="number" min="5" step="5" class="input-field" id="task-estimate" name="estimateMinutes" value="${task?.estimateMinutes ?? 30}">
        </div>
      </div>
      <div>
        <label class="field-label" for="task-cat">Category</label>
        <select class="input-field" id="task-cat" name="cat">${categoryOptions(task?.cat || null)}</select>
      </div>
      <div>
        <label class="field-label" for="task-repeat">Repeat</label>
        <select class="input-field" id="task-repeat" name="repeat">
          <option value="">Does not repeat</option>
          ${FREQUENCIES.map((f) => `<option value="${f}" ${recurrence?.freq === f ? 'selected' : ''}>${FREQUENCY_LABELS[f]}</option>`).join('')}
        </select>
      </div>
      <div class="hidden" data-weekday-picker>
        <label class="field-label">Repeat on</label>
        <div class="flex flex-wrap gap-1.5">
          ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
            .map((label, index) => {
              const active = recurrence?.weekdays?.length ? recurrence.weekdays.includes(index) : [1, 2, 3, 4, 5].includes(index)
              return `<button type="button" class="day-toggle ${active ? 'day-active' : ''}" data-day="${index}">${label}</button>`
            })
            .join('')}
        </div>
      </div>
      <div>
        <label class="field-label" for="task-notes">Notes <span class="text-slate-600">optional</span></label>
        <textarea class="input-field" id="task-notes" name="notes" rows="2" placeholder="Any details…">${task ? escapeHtml(task.notes || '') : ''}</textarea>
      </div>
      <label class="flex items-center gap-2.5 text-[13px] text-slate-300">
        <input type="checkbox" id="task-top3" ${id && isTop3(state, today, id) ? 'checked' : ''} class="rounded border-white/20 bg-base-800">
        Add to today's Top 3
      </label>
      <div class="flex gap-3 pt-1">
        <button type="button" class="btn-ghost flex-1" data-modal-close>Cancel</button>
        <button type="submit" class="btn-primary flex-1">${task ? 'Save changes' : 'Add task'}</button>
      </div>
    </form>`

  openModal({
    title: task ? 'Edit task' : inbox ? 'Capture to inbox' : 'New task',
    body,
    onMount: (box) => {
        const repeat = box.querySelector('#task-repeat')
        const weekdayPicker = box.querySelector('[data-weekday-picker]')
      const syncRepeatUi = () => {
        const needsDays = ['weekdays', 'weekly'].includes(repeat.value)
        weekdayPicker.classList.toggle('hidden', !needsDays)
      }
      repeat.addEventListener('change', syncRepeatUi)
      syncRepeatUi()
      box.querySelectorAll('[data-day]').forEach((btn) =>
        btn.addEventListener('click', () => btn.classList.toggle('day-active')),
      )
      box.querySelector('#task-form').addEventListener('submit', (event) => {
        event.preventDefault()
        submitTask(box, task)
      })
      if (!task) box.querySelector('#task-title').focus()
    },
  })
}

function submitTask(box, existing) {
  const title = box.querySelector('#task-title').value.trim()
  if (!title) {
    toast('Give the task a title', 'error')
    return
  }
  const date = box.querySelector('#task-date').value || null
  const time = box.querySelector('#task-time').value || null
  const priority = box.querySelector('#task-priority').value
  const cat = box.querySelector('#task-cat').value || null
  const estimateMinutes = Number(box.querySelector('#task-estimate').value) || 30
  const notes = box.querySelector('#task-notes').value
  const repeat = box.querySelector('#task-repeat').value
  const weekdays = [...box.querySelectorAll('[data-day].day-active')].map((b) => Number(b.dataset.day))
  const wantTop3 = box.querySelector('#task-top3').checked
  const today = currentDayKey()

  const recurrence = repeat
    ? {
        freq: repeat,
        weekdays: repeat === 'daily' ? [] : weekdays,
        dayOfMonth: repeat === 'monthly' ? Number((date || today).slice(8, 10)) : null,
        startDate: date || today,
        endDate: null,
      }
    : null

  let newId = null
  commit((s) => {
    if (existing) {
      const task = s.tasks.find((t) => t.id === existing.id)
      Object.assign(task, { title, date, time, priority, cat, estimateMinutes, notes, recurrence, inbox: !date && !cat })
      if (recurrence && !task.seriesId) {
        task.seriesId = task.id
        task.occurrenceDate = date || today
      }
    } else {
      newId = uid()
      s.tasks.push({
        id: newId,
        title,
        date,
        time,
        priority,
        cat,
        estimateMinutes,
        notes,
        done: false,
        inbox: !date && !cat,
        createdAt: Date.now(),
        completedAt: null,
        recurrence,
        seriesId: recurrence ? newId : null,
        occurrenceDate: recurrence ? date || today : null,
      })
    }
    if (wantTop3 && newId) {
      s.top3[today] = [...new Set([...(s.top3[today] || []), newId])].slice(0, 3)
    }
  })
  let generated = 0
  if (recurrence) {
    // create the upcoming occurrences straight away so tomorrow's list is real
    generated = ensureRecurringOccurrences(today).length
    commit(() => {}, { immediate: true })
  }
  if (wantTop3 && existing) window.CC.addTaskToTop3(existing.id)

  closeModal()
  if (recurrence) toast(`Repeating task created · ${generated + 1} occurrence${generated ? 's' : ''} scheduled`, 'success')
  else toast(existing ? 'Task updated' : 'Task added', 'success')
}

/* -------------------------------------------------- organise (inbox) modal */

export function openOrganiseModal(taskId) {
  const task = state.tasks.find((t) => t.id === taskId)
  if (!task) return
  const today = currentDayKey()
  const body = `
    <p class="text-[13px] text-slate-400 mb-4">File “${escapeHtml(task.title)}” so it shows up where you need it.</p>
    <div class="space-y-3">
      <div>
        <label class="field-label" for="organise-cat">Category</label>
        <select class="input-field" id="organise-cat">${categoryOptions(task.cat)}</select>
      </div>
      <div>
        <label class="field-label">When</label>
        <div class="flex flex-wrap gap-2">
          <button class="preset-btn" data-when="${today}">Today</button>
          <button class="preset-btn" data-when="${addDays(today, 1)}">Tomorrow</button>
          <button class="preset-btn" data-when="custom">Custom…</button>
        </div>
        <input type="date" class="input-field mt-2 hidden" id="organise-date" value="${today}">
      </div>
      <label class="flex items-center gap-2.5 text-[13px] text-slate-300">
        <input type="checkbox" id="organise-top3" class="rounded border-white/20 bg-base-800"> Add to today's Top 3
      </label>
    </div>
    <div class="flex gap-3 pt-4">
      <button class="btn-ghost flex-1" data-modal-close>Cancel</button>
      <button class="btn-primary flex-1" data-organise-save>File task</button>
    </div>`
  openModal({
    title: 'File this task',
    body,
    onMount: (box) => {
      let chosenDate = today
      const dateInput = box.querySelector('#organise-date')
      box.querySelectorAll('[data-when]').forEach((btn) =>
        btn.addEventListener('click', () => {
          const value = btn.dataset.when
          if (value === 'custom') {
            dateInput.classList.remove('hidden')
            dateInput.focus()
            return
          }
          chosenDate = value
          dateInput.value = value
          box.querySelectorAll('[data-when]').forEach((b) => b.classList.remove('preset-active'))
          btn.classList.add('preset-active')
        }),
      )
      dateInput.addEventListener('change', () => {
        chosenDate = dateInput.value
      })
      box.querySelector('[data-organise-save]').addEventListener('click', () => {
          const cat = box.querySelector('#organise-cat').value || null
          const toTop3 = box.querySelector('#organise-top3').checked
        commit((s) => {
          const target = s.tasks.find((t) => t.id === taskId)
          if (!target) return
          target.cat = cat
          target.date = chosenDate
          target.inbox = false
          if (toTop3) {
            const current = s.top3[today] || []
            if (current.length < 3 && !current.includes(taskId)) s.top3[today] = [...current, taskId]
          }
        })
        closeModal()
        toast('Task filed', 'success')
      })
    },
  })
}

/** Candidate helper used by the dashboard Top 3 picker. */
export function top3CandidateList(today) {
  return top3Candidates(state, today, { overdueIds: overdueTasks(state, today).map((t) => t.id) })
}

