/* -------------------------------------------------------------------------
   QUICK CAPTURE — type a sentence, get a scheduled mission
   -------------------------------------------------------------------------
   Ctrl/⌘ + K, type, Ctrl/⌘ + Enter to save.

   The input understands natural language (`lib/quickparse.js`) and mirrors
   whatever it detects straight back into the visible controls, so nothing is
   ever saved that the user cannot see first.
   ------------------------------------------------------------------------- */

import { addDays, formatDuration, weekdayOf, weekdayShort } from '../lib/dates.js'
import { closeModal, escapeHtml, openModal, toast } from '../core/dom.js'
import { commit, currentDayKey, state } from '../core/store.js'
import { categoryName, categoryOptions } from '../views/shared.js'
import { timeLabel } from './common.js'
import { icon } from './icons.js'
import { parseQuickCapture, priorityLabel, recurrenceLabel } from '../lib/quickparse.js'
import { uid } from '../lib/state.js'

let open = false

export function isQuickCaptureOpen() {
  return open
}

function dateChipLabel(key, today) {
  if (!key) return ''
  if (key === today) return 'Today'
  if (key === addDays(today, 1)) return 'Tomorrow'
  if (key === addDays(today, -1)) return 'Yesterday'
  const [, month, day] = key.split('-')
  return `${weekdayShort(weekdayOf(key))}, ${Number(month)}/${Number(day)}`
}

function chipsFor(parsed, today) {
  const chips = []
  if (parsed.recurrence) chips.push({ kind: 'repeat', icon: 'bolt', text: recurrenceLabel(parsed.recurrence, { weekdayName: weekdayShort }) })
  if (parsed.date) chips.push({ kind: 'date', icon: 'calendar', text: dateChipLabel(parsed.date, today) })
  if (parsed.time) chips.push({ kind: 'time', icon: 'clock', text: timeLabel(parsed.time, true) })
  if (parsed.estimateMinutes) chips.push({ kind: 'duration', icon: 'focus', text: formatDuration(parsed.estimateMinutes) })
  if (parsed.priority) chips.push({ kind: 'priority', icon: 'flag', text: priorityLabel(parsed.priority) })
  if (parsed.categoryId) chips.push({ kind: 'category', icon: 'target', text: categoryName(parsed.categoryId) })
  return chips
}

function renderPreview(box, parsed, today) {
  const preview = box.querySelector('#capture-preview')
  if (!preview) return
  const chips = chipsFor(parsed, today)
  preview.innerHTML = chips.length
    ? `<span class="capture-preview-label">${icon('sparkle')}Reading</span>${chips
        .map((chip) => `<span class="capture-chip capture-chip--${chip.kind}">${icon(chip.icon)}${escapeHtml(chip.text)}</span>`)
        .join('')}`
    : `<span class="capture-preview-hint">${icon('info')}<span>Type it naturally — <strong>tomorrow 6pm</strong>, <strong>45m</strong>, <strong>!high</strong>, <strong>#work</strong>, <strong>every weekday</strong>.</span></span>`
  preview.dataset.count = String(chips.length)
}

export function openQuickCapture({ inbox = false, prefill = '' } = {}) {
  if (open) return
  open = true
  const today = currentDayKey()
  const body = `
    <form id="capture-form" class="space-y-3.5">
      <div>
        <label class="field-label" for="capture-title">Mission</label>
        <input class="input-field !text-[15px]" id="capture-title" placeholder="What’s on your mind?" value="${escapeHtml(prefill)}" autocomplete="off" spellcheck="false">
        <div class="capture-preview" id="capture-preview" aria-live="polite"></div>
      </div>
      <div class="flex flex-wrap gap-1.5" data-capture-dates>
        <button type="button" class="preset-btn ${inbox ? '' : 'preset-active'}" data-date="${today}" data-label="today">Today</button>
        <button type="button" class="preset-btn" data-date="${addDays(today, 1)}" data-label="tomorrow">Tomorrow</button>
        <button type="button" class="preset-btn" data-date="custom" data-label="custom">Pick a date…</button>
        <button type="button" class="preset-btn ${inbox ? 'preset-active' : ''}" data-date="inbox" data-label="inbox">Inbox (no date)</button>
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
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label class="flex items-center gap-2.5 text-[13px] text-slate-300">
          <input type="checkbox" id="capture-top3" class="rounded border-white/20 bg-base-800"> Add to today's Top 3
        </label>
        <label class="capture-recurring hidden items-center gap-2 text-[12px] text-slate-400" id="capture-repeat-wrap">
          <input type="checkbox" id="capture-repeat" class="rounded border-white/20 bg-base-800" checked> Keep repeating
        </label>
      </div>
      <div class="flex items-center justify-between gap-3 pt-1">
        <span class="text-[11.5px] text-slate-500"><kbd class="kbd">Ctrl</kbd> + <kbd class="kbd">Enter</kbd> to save · <kbd class="kbd">Esc</kbd> to close</span>
        <div class="flex gap-2">
          <button type="button" class="btn-ghost" data-modal-close>Cancel</button>
          <button type="submit" class="btn-primary">Add mission</button>
        </div>
      </div>
    </form>`

  openModal({
    title: 'Quick capture',
    body,
    onMount: (box) => {
      let chosenDate = inbox ? null : today
      /** the most recent parse — the single source of truth for the save */
      let parsed = parseQuickCapture('', { todayKey: today, categories: state.categories })
      const dateInput = box.querySelector('#capture-date')
      const titleInput = box.querySelector('#capture-title')
      const prioritySelect = box.querySelector('#capture-priority')
      const catSelect = box.querySelector('#capture-cat')
      const top3 = box.querySelector('#capture-top3')
      const repeatWrap = box.querySelector('#capture-repeat-wrap')
      const repeat = box.querySelector('#capture-repeat')
      const presetButtons = [...box.querySelectorAll('[data-capture-dates] [data-date]')]

      const syncTop3 = () => {
        const allowed = chosenDate === today
        top3.disabled = !allowed
        if (!allowed) top3.checked = false
        top3.closest('label').style.opacity = allowed ? '1' : '.45'
      }

      const paintDate = () => {
        const key = chosenDate
        const tomorrow = addDays(today, 1)
        presetButtons.forEach((btn) => {
          const value = btn.dataset.date
          const active = key === null ? value === 'inbox' : value === key || (value === 'custom' && key !== today && key !== tomorrow)
          btn.classList.toggle('preset-active', active)
        })
        if (key && key !== today && key !== tomorrow) {
          dateInput.classList.remove('hidden')
          dateInput.value = key
        } else {
          dateInput.classList.add('hidden')
        }
        syncTop3()
      }

      const setDate = (key) => {
        chosenDate = key
        paintDate()
      }

      /* ------------------------------------------------ live parsing */
      const sync = () => {
        parsed = parseQuickCapture(titleInput.value, { todayKey: today, categories: state.categories })
        renderPreview(box, parsed, today)

        // only the parsed date moves the picker; a manual choice stays put
        if (parsed.date) setDate(parsed.date)

        if (parsed.priority) prioritySelect.value = parsed.priority
        if (parsed.categoryId) catSelect.value = parsed.categoryId
        const repeating = !!parsed.recurrence
        repeatWrap.classList.toggle('hidden', !repeating)
        repeatWrap.classList.toggle('flex', repeating)
        if (repeating) {
          repeat.checked = true
          repeatWrap.title = recurrenceLabel(parsed.recurrence, { weekdayName: weekdayShort })
        }
      }

      titleInput.addEventListener('input', sync)
      titleInput.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          closeQuickCapture()
        }
      })

      /* --------------------------------------------- manual controls */
      presetButtons.forEach((btn) =>
        btn.addEventListener('click', () => {
          const value = btn.dataset.date
          if (value === 'custom') {
            dateInput.classList.remove('hidden')
            dateInput.focus()
            presetButtons.forEach((b) => b.classList.toggle('preset-active', b === btn))
            return
          }
          setDate(value === 'inbox' ? null : value)
        }),
      )
      dateInput.addEventListener('change', () => {
        if (dateInput.value) setDate(dateInput.value)
      })

      const form = box.querySelector('#capture-form')
      const submit = () => save(box, { date: chosenDate, parsed, includeRecurrence: repeat.checked })
      form.addEventListener('submit', (event) => {
        event.preventDefault()
        submit()
      })
      box.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault()
          submit()
        }
      })

      paintDate()
      sync()
      titleInput.focus()
      titleInput.select()
    },
    onClose: () => {
      open = false
    },
  })
}

function save(box, { date, parsed, includeRecurrence = true }) {
  const raw = box.querySelector('#capture-title').value.trim()
  const title = (parsed?.title || raw).trim()
  if (!title) {
    toast('Type what needs doing first', 'error')
    return
  }
  const priority = box.querySelector('#capture-priority').value
  const cat = box.querySelector('#capture-cat').value || null
  const toTop3 = box.querySelector('#capture-top3').checked
  const today = currentDayKey()
  const recurrence = includeRecurrence && parsed?.recurrence ? { ...parsed.recurrence, startDate: date || parsed.recurrence.startDate || today } : null
  let id = null
  commit((s) => {
    id = uid()
    s.tasks.push({
      id,
      title,
      date,
      time: date ? parsed?.time || null : null,
      priority,
      cat,
      notes: '',
      estimateMinutes: parsed?.estimateMinutes || state.settings.defaultTaskMinutes,
      status: date ? 'ready' : 'not_started',
      horizon: 'quick',
      done: false,
      inbox: date === null,
      createdAt: Date.now(),
      completedAt: null,
      recurrence,
      seriesId: recurrence ? id : null,
      occurrenceDate: recurrence ? date || today : null,
    })
    if (toTop3 && date === today) {
      const current = s.top3[today] || []
      if (current.length < 3 && !current.includes(id)) s.top3[today] = [...current, id]
    }
  })
  open = false
  closeModal()
  const what = recurrence ? 'Repeating mission added' : date === null ? 'Captured to inbox' : parsed?.time ? `Mission added for ${timeLabel(parsed.time, true)}` : 'Mission added'
  toast(what, 'success')
  window.CC?.refreshAll?.()
}

export function closeQuickCapture() {
  open = false
  closeModal()
}
