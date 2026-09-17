/* -------------------------------------------------------------------------
   TIMETABLE — the fixed daily schedule
   ------------------------------------------------------------------------- */

import { formatDuration, minutesOfDay, toHHMM } from '../lib/dates.js'
import { protectedConflicts } from '../lib/protected.js'
import { computeDueReminders } from '../lib/reminders.js'
import { closeModal, confirmDialog, escapeHtml, openModal, qsa, toast } from '../core/dom.js'
import { commit, currentDayKey, minutesNow, state, statsFor, syncScoreHistory } from '../core/store.js'
import { categoryColor, categoryName, categoryOptions, emptyState } from './shared.js'
import { openRecoveryModal } from './recovery.js'

let showDone = true

export function renderTimetable() {
  const section = document.getElementById('view-timetable')
  if (!section) return
  const now = new Date()
  const today = currentDayKey(now)
  const log = state.completionLog[today] || { ttDone: [] }
  const nowMin = minutesNow(now)
  const sorted = [...state.timetable].sort((a, b) => minutesOfDay(a.time) - minutesOfDay(b.time))
  const conflicts = protectedConflicts(state.timetable, state.settings.protectedTime || [], today)
  const stats = statsFor(today, { now })
  const upcomingReminder = computeDueReminders({ state, todayKey: today, nowMinutes: nowMin, now, maxPerRun: 1 })[0] || null

  section.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="section-title">Daily Timetable</h2>
        <p class="section-sub">${now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })} · tap a block to mark it complete</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="btn-ghost" data-action="recover"><i class="fa-solid fa-wand-magic-sparkles mr-1.5"></i>Recover My Day</button>
        <button class="btn-ghost" data-action="toggle-done"><i class="fa-solid fa-eye${showDone ? '' : '-slash'} mr-1.5"></i>${showDone ? 'Hide done' : 'Show done'}</button>
        <button class="btn-ghost" data-action="reset"><i class="fa-solid fa-rotate-left mr-1.5"></i>Reset today</button>
        <button class="btn-primary" data-action="add"><i class="fa-solid fa-plus mr-1.5"></i>Add Block</button>
      </div>
    </div>

    ${conflicts.length
      ? `<div class="glass-card p-4 border-l-4 border-amber-400/60 flex items-start gap-3">
           <i class="fa-solid fa-triangle-exclamation text-accent-4 mt-0.5"></i>
           <div class="text-[13px] text-slate-300">
             <p class="font-semibold text-amber-200">${conflicts.length} block${conflicts.length > 1 ? 's overlap' : ' overlaps'} your protected time</p>
             <p class="text-slate-400 mt-1">${conflicts.slice(0, 3).map((c) => `${escapeHtml(c.time)} ${escapeHtml(c.title)} (${c.overlapMinutes} min inside “${escapeHtml(c.protectedLabel)}”)`).join(' · ')}</p>
             <button class="btn-ghost mt-2 !py-1.5 !text-xs" data-action="settings">Adjust protected time</button>
           </div>
         </div>`
      : ''}

    ${upcomingReminder
      ? `<div class="glass-card p-3.5 flex items-center gap-3 text-[13px]">
           <i class="fa-solid fa-bell text-accent-2"></i>
           <span class="text-slate-300"><span class="font-semibold text-white">${escapeHtml(upcomingReminder.title)}</span> — ${escapeHtml(upcomingReminder.body)}</span>
         </div>`
      : ''}

    <div class="schedule-summary">
      <div>
        <p class="sum-label">Blocks done</p>
        <p class="sum-value">${stats.blocksDone}<span style="color:var(--color-text-muted);font-size:0.85rem">/${stats.blocksTotal}</span></p>
      </div>
      <div>
        <p class="sum-label">Adherence so far</p>
        <p class="sum-value">${Math.round(stats.adherence * 100)}%</p>
      </div>
      <div>
        <p class="sum-label">Planned today</p>
        <p class="sum-value">${formatDuration(stats.plannedMinutes)}</p>
      </div>
      <div>
        <p class="sum-label">Focused today</p>
        <p class="sum-value">${formatDuration(stats.focusedMinutes)}</p>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-x-5 gap-y-2 px-1">
      ${state.categories.map((c) => `<span class="flex items-center gap-2 text-[12.5px] text-slate-500"><span class="legend-dot" style="background:${c.color}"></span>${escapeHtml(c.name)}</span>`).join('')}
    </div>

    <div class="glass-card p-1.5 sm:p-2.5">
      <div class="schedule">
        ${sorted.length
          ? sorted
              .filter((item) => showDone || !log.ttDone.includes(item.id))
              .map((item) => blockRowHtml(item, log, nowMin))
              .join('')
          : emptyState({
              icon: 'fa-regular fa-calendar',
              title: 'No timetable blocks yet',
              body: 'Add your daily structure — the dashboard and recovery planner use it.',
              action: '<button class="btn-primary mt-3" data-action="add">Add your first block</button>',
            })}
      </div>
    </div>
  `

  qsa(section, '[data-action]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const action = btn.dataset.action
      if (action === 'add') openBlockModal()
      else if (action === 'reset') resetToday()
      else if (action === 'recover') openRecoveryModal()
      else if (action === 'settings') window.CC.switchView('settings')
      else if (action === 'toggle-done') {
        showDone = !showDone
        renderTimetable()
      }
    }),
  )
  qsa(section, '[data-block-toggle]').forEach((btn) =>
    btn.addEventListener('click', (event) => {
      event.stopPropagation()
      toggleBlock(btn.dataset.blockToggle)
    }),
  )
  qsa(section, '[data-block-edit]').forEach((btn) =>
    btn.addEventListener('click', (event) => {
      event.stopPropagation()
      openBlockModal(btn.dataset.blockEdit)
    }),
  )
  qsa(section, '[data-block-delete]').forEach((btn) =>
    btn.addEventListener('click', async (event) => {
      event.stopPropagation()
      const block = state.timetable.find((b) => b.id === btn.dataset.blockDelete)
      if (!block) return
      const ok = await confirmDialog({
        title: 'Delete this block?',
        message: `“${block.title}” at ${block.time} will be removed from your daily timetable.`,
        confirmText: 'Delete',
        danger: true,
      })
      if (!ok) return
      commit((s) => {
        s.timetable = s.timetable.filter((b) => b.id !== block.id)
      })
      toast('Block deleted', 'info')
    }),
  )
  qsa(section, '[data-block-focus]').forEach((btn) =>
    btn.addEventListener('click', (event) => {
      event.stopPropagation()
      window.CC.openFocusMode(undefined)
    }),
  )
}

function blockRowHtml(item, log, nowMin) {
  const isDone = log.ttDone.includes(item.id)
  const start = minutesOfDay(item.time)
  const duration = item.duration || 60
  const isNow = nowMin >= start && nowMin < start + duration
  const isPast = nowMin >= start + duration
  return `
    <div class="tt-row ${isDone ? 'tt-done' : ''} ${isNow ? 'active-now' : ''}" style="--cat-color:${categoryColor(item.cat)}" ${isNow ? 'aria-current="true"' : ''}>
      <button class="tt-time text-left" data-block-toggle="${escapeHtml(item.id)}" aria-label="${isDone ? 'Mark unfinished' : 'Mark complete'}: ${escapeHtml(item.title)} at ${escapeHtml(item.time)}">${escapeHtml(item.time)}</button>
      <div class="min-w-0" data-block-toggle="${escapeHtml(item.id)}">
        <p class="tt-title truncate">${escapeHtml(item.title)}</p>
        <p class="tt-meta">
          ${escapeHtml(categoryName(item.cat))} · ${duration} min
          ${isPast && !isDone ? ' · <span class="text-accent-5 font-semibold">missed</span>' : ''}
          ${isNow ? ' · <span class="text-emerald-400 font-semibold">LIVE</span>' : ''}
        </p>
      </div>
      <div class="flex items-center gap-1.5">
        ${isNow ? `<button class="icon-btn" data-block-focus="${escapeHtml(item.id)}" title="Start a focus session"><i class="fa-solid fa-stopwatch text-xs"></i></button>` : ''}
        <button class="icon-btn" data-block-edit="${escapeHtml(item.id)}" title="Edit block"><i class="fa-solid fa-pen text-xs"></i></button>
        <button class="icon-btn" data-block-delete="${escapeHtml(item.id)}" title="Delete block"><i class="fa-solid fa-trash text-xs"></i></button>
        <button class="task-check ${isDone ? 'checked' : ''}" data-block-toggle="${escapeHtml(item.id)}" aria-label="Mark ${escapeHtml(item.title)} complete"><i class="fa-solid fa-check"></i></button>
      </div>
    </div>`
}

export function toggleBlock(id) {
  const today = currentDayKey()
  const stats = statsFor(today)
  const block = state.timetable.find((b) => b.id === id)
  let nowDone = false
  commit((s) => {
    if (!s.completionLog[today]) s.completionLog[today] = { ttDone: [], taskDone: [] }
    const list = s.completionLog[today].ttDone
    const index = list.indexOf(id)
    if (index === -1) {
      list.push(id)
      nowDone = true
    } else {
      list.splice(index, 1)
    }
  })
  if (nowDone) {
    const remaining = stats.blocksElapsed - (stats.blocksDone + 1)
    toast(remaining > 0 ? `Block complete · ${remaining} elapsed block${remaining === 1 ? '' : 's'} left to tick` : 'Block complete — right on schedule 💪', 'success')
  }
  if (block && !nowDone) toast('Block marked unfinished', 'info')
}

async function resetToday() {
  const ok = await confirmDialog({
    title: "Reset today's progress?",
    message: 'This clears which blocks you have marked complete today. Tasks and focus sessions are untouched.',
    confirmText: 'Reset',
    danger: true,
  })
  if (!ok) return
  commit((s) => {
    if (s.completionLog[currentDayKey()]) s.completionLog[currentDayKey()].ttDone = []
  })
  syncScoreHistory(currentDayKey())
  toast('Timetable progress reset', 'info')
}

export function openBlockModal(id = null) {
  const block = id ? state.timetable.find((b) => b.id === id) : null
  const body = `
    <form id="block-form" class="space-y-4">
      <div>
        <label class="field-label" for="block-title">Title</label>
        <input required class="input-field" id="block-title" name="title" placeholder="e.g. Deep study block" value="${block ? escapeHtml(block.title) : ''}">
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="field-label" for="block-time">Start time</label>
          <input required type="time" class="input-field" id="block-time" name="time" value="${block?.time || nextFreeTime()}">
        </div>
        <div>
          <label class="field-label" for="block-duration">Duration (min)</label>
          <input required type="number" min="5" step="5" class="input-field" id="block-duration" name="duration" value="${block?.duration || 60}">
        </div>
      </div>
      <div>
        <label class="field-label" for="block-cat">Category</label>
        <select class="input-field" id="block-cat" name="cat">${categoryOptions(block?.cat || state.categories[0]?.id, { includeNone: false })}</select>
      </div>
      <div class="flex gap-3 pt-1">
        <button type="button" class="btn-ghost flex-1" data-modal-close>Cancel</button>
        <button type="submit" class="btn-primary flex-1">${block ? 'Save changes' : 'Add block'}</button>
      </div>
    </form>`
  openModal({
    title: block ? 'Edit block' : 'Add timetable block',
    body,
    onMount: (box) => {
      box.querySelector('#block-form').addEventListener('submit', (event) => {
        event.preventDefault()
        const title = box.querySelector('#block-title').value.trim()
        const time = box.querySelector('#block-time').value
        const duration = Number(box.querySelector('#block-duration').value) || 60
        const cat = box.querySelector('#block-cat').value
        if (!title || !time) {
          toast('Title and start time are required', 'error')
          return
        }
        const conflicts = protectedConflicts(
          [{ id: 'temp', time, title, duration, cat }],
          state.settings.protectedTime || [],
          currentDayKey(),
        )
        commit((s) => {
          if (block) {
            const target = s.timetable.find((b) => b.id === block.id)
            Object.assign(target, { title, time, duration, cat })
          } else {
            s.timetable.push({ id: `${title.slice(0, 3).replace(/\W/g, '')}${Date.now().toString(36)}`, title, time, duration, cat })
          }
        })
        closeModal()
        toast(block ? 'Block updated' : 'Block added', 'success')
        if (conflicts.length) {
          toast(`Heads up: this overlaps your protected “${conflicts[0].protectedLabel}” time (${conflicts[0].overlapMinutes} min).`, 'error', { timeout: 7000 })
        }
      })
    },
  })
}

function nextFreeTime() {
  const nowMin = minutesNow()
  const sorted = [...state.timetable].sort((a, b) => minutesOfDay(a.time) - minutesOfDay(b.time))
  for (let i = 0; i < sorted.length; i++) {
    const start = minutesOfDay(sorted[i].time)
    const end = start + (sorted[i].duration || 60)
    if (nowMin < end) return toHHMM(Math.min(end, 23 * 60 + 45))
  }
  return toHHMM(Math.min(nowMin, 23 * 60 + 45))
}
