/* -------------------------------------------------------------------------
   QUICK CAPTURE — Ctrl/⌘ + K, type, Ctrl + Enter to save
   ------------------------------------------------------------------------- */

import { addDays } from '../lib/dates.js'
import { closeModal, escapeHtml, openModal, toast } from '../core/dom.js'
import { commit, currentDayKey } from '../core/store.js'
import { categoryOptions } from '../views/shared.js'
import { uid } from '../lib/state.js'

let open = false

export function isQuickCaptureOpen() {
  return open
}

export function openQuickCapture({ inbox = false, prefill = '' } = {}) {
  if (open) return
  open = true
  const today = currentDayKey()
  const body = `
    <form id="capture-form" class="space-y-3.5">
      <div>
        <label class="field-label" for="capture-title">Task</label>
        <input class="input-field !text-[15px]" id="capture-title" placeholder="What needs doing?" value="${escapeHtml(prefill)}" autocomplete="off">
      </div>
      <div class="flex flex-wrap gap-1.5" data-capture-dates>
        <button type="button" class="preset-btn preset-active" data-date="${today}">Today</button>
        <button type="button" class="preset-btn" data-date="${addDays(today, 1)}">Tomorrow</button>
        <button type="button" class="preset-btn" data-date="custom">Pick a date…</button>
        <button type="button" class="preset-btn ${inbox ? 'preset-active' : ''}" data-date="inbox">Inbox (no date)</button>
      </div>
      <input type="date" class="input-field hidden" id="capture-date" value="${today}">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="field-label" for="capture-priority">Priority</label>
          <select class="input-field" id="capture-priority">
            <option value="high">High</option>
            <option value="medium" selected>Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
        <div>
          <label class="field-label" for="capture-cat">Category</label>
          <select class="input-field" id="capture-cat">${categoryOptions(null)}</select>
        </div>
      </div>
      <label class="flex items-center gap-2.5 text-[13px] text-slate-300">
        <input type="checkbox" id="capture-top3" class="rounded border-white/20 bg-base-800"> Add to today's Top 3
      </label>
      <div class="flex items-center justify-between gap-3 pt-1">
        <span class="text-[11.5px] text-slate-500"><kbd class="kbd">Ctrl</kbd> + <kbd class="kbd">Enter</kbd> to save · <kbd class="kbd">Esc</kbd> to close</span>
        <div class="flex gap-2">
          <button type="button" class="btn-ghost" data-modal-close>Cancel</button>
          <button type="submit" class="btn-primary">Add task</button>
        </div>
      </div>
    </form>`

  openModal({
    title: 'Quick capture',
    body,
    onMount: (box) => {
      let chosenDate = inbox ? null : today
      const dateInput = box.querySelector('#capture-date')
      box.querySelectorAll('[data-capture-dates] [data-date]').forEach((btn) =>
        btn.addEventListener('click', () => {
          const value = btn.dataset.date
          box.querySelectorAll('[data-capture-dates] .preset-btn').forEach((b) => b.classList.remove('preset-active'))
          btn.classList.add('preset-active')
          if (value === 'custom') {
            dateInput.classList.remove('hidden')
            dateInput.focus()
            chosenDate = dateInput.value || today
            return
          }
          dateInput.classList.add('hidden')
          chosenDate = value === 'inbox' ? null : value
        }),
      )
      dateInput.addEventListener('change', () => {
        chosenDate = dateInput.value || today
      })

      const form = box.querySelector('#capture-form')
      form.addEventListener('submit', (event) => {
        event.preventDefault()
        save(box, { date: chosenDate, inbox: chosenDate === null })
      })
      box.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault()
          save(box, { date: chosenDate, inbox: chosenDate === null })
        }
      })
      const titleInput = box.querySelector('#capture-title')
      titleInput.focus()
      titleInput.select()
    },
    onClose: () => {
      open = false
    },
  })
}

function save(box, { date, inbox }) {
  const title = box.querySelector('#capture-title').value.trim()
  if (!title) {
    toast('Type what needs doing first', 'error')
    return
  }
  const priority = box.querySelector('#capture-priority').value
  const cat = box.querySelector('#capture-cat').value || null
  const toTop3 = box.querySelector('#capture-top3').checked
  const today = currentDayKey()
  let id = null
  commit((s) => {
    id = uid()
    s.tasks.push({
      id,
      title,
      date,
      time: null,
      priority,
      cat,
      notes: '',
      estimateMinutes: 30,
      done: false,
      inbox: inbox || (!date && !cat),
      createdAt: Date.now(),
      completedAt: null,
      recurrence: null,
      seriesId: null,
      occurrenceDate: null,
    })
    if (toTop3) {
      const current = s.top3[today] || []
      if (current.length < 3 && !current.includes(id)) s.top3[today] = [...current, id]
    }
  })
  open = false
  closeModal()
  toast(inbox ? 'Captured to inbox' : 'Task added', 'success')
  // capture another quickly with the same shortcut
  window.CC?.refreshAll?.()
}

export function closeQuickCapture() {
  open = false
  closeModal()
}
