/* -------------------------------------------------------------------------
   SHARED VIEW HELPERS
   ------------------------------------------------------------------------- */

import { PRIORITY_COLORS, PRIORITY_ORDER } from '../lib/defaults.js'
import { escapeHtml } from '../core/dom.js'
import { state } from '../core/store.js'
import { STATUS_STYLES } from '../ui/status.js'

export function categoryName(id, fallback = 'Uncategorised') {
  if (!id) return fallback
  return state.categories.find((c) => c.id === id)?.name || fallback
}

export function categoryColor(id) {
  return state.categories.find((c) => c.id === id)?.color || '#7c5cff'
}

export function priorityColor(priority) {
  return PRIORITY_COLORS[priority] || PRIORITY_COLORS.medium
}

export function priorityRank(priority) {
  return PRIORITY_ORDER[priority] ?? 1
}

export function categoryOptions(selected = null, { includeNone = true } = {}) {
  return `
    ${includeNone ? `<option value="" ${!selected ? 'selected' : ''}>None</option>` : ''}
    ${state.categories
      .map((c) => `<option value="${escapeHtml(c.id)}" ${selected === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)
      .join('')}`
}

export function statusForStreakDot(day) {
  const style = STATUS_STYLES[day.status] || STATUS_STYLES.rest
  const title = `${day.dateKey} · ${style.label}${day.score ? ` · score ${day.score}` : ''}`
  return `<span class="streak-dot ${day.isToday ? 'is-today' : ''}" style="background:${style.dot}" title="${escapeHtml(title)}"></span>`
}

/** Empty state block used across views. */
export function emptyState({ icon = 'fa-regular fa-clipboard', title = 'Nothing here yet', body = '', action = '' } = {}) {
  return `
    <div class="empty-state">
      <i class="${icon}"></i>
      <p class="text-sm font-medium text-slate-300">${escapeHtml(title)}</p>
      ${body ? `<p class="text-[12.5px] text-slate-500 max-w-sm">${escapeHtml(body)}</p>` : ''}
      ${action}
    </div>`
}

export function chip(text, { tone = '' } = {}) {
  return `<span class="chip ${tone}">${escapeHtml(text)}</span>`
}

export function fieldRow(label, valueHtml, hintText = '') {
  return `
    <div class="flex items-center justify-between gap-3 py-1.5">
      <span class="text-[13px] text-slate-400">${escapeHtml(label)}${hintText ? ` <span class="text-[11px] text-slate-600">${escapeHtml(hintText)}</span>` : ''}</span>
      <span class="text-[13.5px] font-semibold text-slate-100">${valueHtml}</span>
    </div>`
}
