/* -------------------------------------------------------------------------
   SHARED VIEW HELPERS
   ------------------------------------------------------------------------- */

import { PRIORITY_COLORS, PRIORITY_ORDER } from '../lib/defaults.js'
import { escapeHtml } from '../core/dom.js'
import { icon as svgIcon } from '../ui/icons.js'
import { state } from '../core/store.js'
import { STATUS_STYLES } from '../ui/status.js'

export function categoryName(id, fallback = 'Uncategorised') {
  if (!id) return fallback
  return state.categories.find((c) => c.id === id)?.name || fallback
}

export function categoryColor(id) {
  return state.categories.find((c) => c.id === id)?.color || '#d4d4d4'
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
export function emptyState({ icon = 'clipboard', title = 'Nothing here yet', body = '', action = '' } = {}) {
  return `
    <div class="empty-state">
      ${svgIcon(icon.includes('calendar') ? 'calendar' : icon.includes('inbox') ? 'inbox' : 'check')}
      <p class="empty-title">${escapeHtml(title)}</p>
      ${body ? `<p class="empty-body">${escapeHtml(body)}</p>` : ''}
      ${action}
    </div>`
}

export function chip(text, { tone = '' } = {}) {
  return `<span class="chip ${tone}">${escapeHtml(text)}</span>`
}

export function fieldRow(label, valueHtml, hintText = '') {
  return `
    <div class="flex items-center justify-between gap-3 py-1.5">
      <span class="field-row-label">${escapeHtml(label)}${hintText ? ` <span class="field-row-hint">${escapeHtml(hintText)}</span>` : ''}</span>
      <span class="field-row-value">${valueHtml}</span>
    </div>`
}
