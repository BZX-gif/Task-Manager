import { escapeHtml } from '../core/dom.js'
import { state } from '../core/store.js'
import { icon } from './icons.js'
export { icon }
export function pageHeading(eyebrow, title, subtitle, actions = '') { return `<div class="page-heading"><div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div>${actions ? `<div class="heading-actions">${actions}</div>` : ''}</div>` }
export function actionButton(action, label, symbol = 'plus', primary = false) { return `<button class="${primary ? 'btn-primary' : 'btn-ghost'}" data-common="${action}">${icon(symbol)}${escapeHtml(label)}</button>` }
export function ring(value, label = 'of 100', empty = false) { const pct = Math.max(0,Math.min(100,Number(value)||0)); return `<div class="score-ring" role="img" aria-label="${empty ? 'No score yet' : `${pct} ${label}`}"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="ring-track" cx="50" cy="50" r="43"/><circle class="ring-value" cx="50" cy="50" r="43" stroke-dasharray="270.18" stroke-dashoffset="${270.18*(1-pct/100)}"/></svg><div class="ring-label"><strong>${empty ? '—' : Math.round(pct)}</strong><small>${escapeHtml(label)}</small></div></div>` }
export function empty(iconName, title, description, action = '') { return `<div class="empty-state">${icon(iconName)}<p>${escapeHtml(title)}</p><p>${escapeHtml(description)}</p>${action}</div>` }
export function metric(symbol, label, value, detail) { return `<div class="metric"><div class="metric-top">${icon(symbol)}${escapeHtml(label)}</div><strong>${value}</strong><p>${escapeHtml(detail)}</p></div>` }
export function goalOptions(selected = '', includeNone = true) { return `${includeNone ? `<option value="">No connected goal</option>` : ''}${state.goals.filter((g) => g.status !== 'cancelled').map((g) => `<option value="${escapeHtml(g.id)}" ${selected === g.id ? 'selected' : ''}>${escapeHtml(g.title)}</option>`).join('')}` }
export function projectOptions(selected = '', goalId = '') { return `<option value="">No connected project</option>${state.projects.filter((p) => p.status !== 'cancelled' && (!goalId || p.goalId === goalId)).map((p) => `<option value="${escapeHtml(p.id)}" ${selected === p.id ? 'selected' : ''}>${escapeHtml(p.title)}</option>`).join('')}` }
export function taskOptions(selected = '', includeNone = true) { return `${includeNone ? '<option value="">Choose a mission</option>' : ''}${state.tasks.filter((t) => !t.done && t.status !== 'cancelled').slice(0,200).map((t) => `<option value="${escapeHtml(t.id)}" ${selected === t.id ? 'selected' : ''}>${escapeHtml(t.title)}</option>`).join('')}` }
export function timeLabel(time, suffix = false) { if (!time) return ''; const [h,m] = time.split(':').map(Number); return state.settings.timeFormat === '24h' ? `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}` : `${h%12||12}:${String(m).padStart(2,'0')}${suffix ? (h>=12 ? ' pm' : ' am') : ''}` }
export function bindCommon(root) {
  root.querySelectorAll('[data-common]').forEach((button) => button.addEventListener('click', () => {
    const action = button.dataset.common
    const cc = window.CC
    if (action === 'new-task') cc.openTaskModal(null, { date: button.dataset.date || undefined })
    else if (action === 'capture') cc.openQuickCapture()
    else if (action === 'plan') cc.openDayPlanner({ date: button.dataset.date })
    else if (action === 'recover') cc.openRecoveryModal()
    else if (action === 'focus') cc.openFocusRoom()
    else if (action === 'goal') cc.openGoalModal()
    else if (action === 'project') cc.openProjectModal()
    else if (action === 'routine') cc.openRoutineModal()
    else if (action === 'review') cc.switchView('review')
    else if (action === 'assistant') cc.switchView('assistant')
    else if (action === 'settings') cc.switchView('settings')
    else cc.switchView(action)
  }))
}
export function weekdayButtons(selected = [], attr = 'data-rday') { return ['S','M','T','W','T','F','S'].map((d,i) => `<button type="button" class="day-toggle ${selected.includes(i) ? 'day-active' : ''}" ${attr}="${i}" aria-label="${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][i]}" aria-pressed="${selected.includes(i)}">${d}</button>`).join('') }
