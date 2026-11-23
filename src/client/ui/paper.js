/* -------------------------------------------------------------------------
   PAPER · the shared component library
   -------------------------------------------------------------------------
   Every interior page builds from these helpers instead of hand-writing its
   own markup. They are deliberately small and composable: a page composes a
   header, some sections, and its own content inside the paper rhythm.

   Nothing here invents data. Each helper renders what the caller passes in;
   the state comes from the store exactly as before.
   ------------------------------------------------------------------------- */

import { escapeHtml } from '../core/dom.js'
import { icon } from './icons.js'

/**
 * JournalPageHeader — the opening of a chapter.
 * eyebrow · title · lede (a line of italic prose) · actions
 */
export function paperHeader({ eyebrow = '', title = '', lede = '', actions = '' } = {}) {
  return `<header class="page-heading paper-header">
    <div class="paper-header-main">
      ${eyebrow ? `<p class="eyebrow">${escapeHtml(eyebrow)}</p>` : ''}
      <h1>${title}</h1>
      ${lede ? `<p>${escapeHtml(lede)}</p>` : ''}
    </div>
    ${actions ? `<div class="heading-actions">${actions}</div>` : ''}
  </header>`
}

/** EditorialSectionHeading — a titled block inside a chapter. */
export function sectionTitle(title, { note = '', action = '', as = 'h2' } = {}) {
  return `<div class="paper-section">
    <div class="paper-section-head">
      <${as} class="paper-section-title">${escapeHtml(title)}</${as}>
      ${action || ''}
    </div>
    ${note ? `<p class="paper-lede paper-section-note">${escapeHtml(note)}</p>` : ''}
  </div>`
}

/** PaperCard — a sheet laid on the desk. */
export function paperCard({ title = '', note = '', action = '', body = '', foot = '', tone = '', label = '' } = {}) {
  return `<article class="card paper-card${tone ? ` paper-card--${tone}` : ''}"${label ? ` aria-label="${escapeHtml(label)}"` : ''}>
    ${title ? `<div class="card-header">
      <div><h3>${escapeHtml(title)}</h3>${note ? `<p class="meta">${escapeHtml(note)}</p>` : ''}</div>
      ${action || ''}
    </div>` : ''}
    ${body}
    ${foot ? `<div class="paper-card-foot">${foot}</div>` : ''}
  </article>`
}

/** PaperDivider — a rule that separates movements of a page. */
export function divider({ tone = '', label = '' } = {}) {
  if (label) return `<div class="paper-divider paper-divider--label"><span>${escapeHtml(label)}</span></div>`
  return `<hr class="paper-rule${tone ? ` paper-rule--${tone}` : ''}" />`
}

/** ProgressIndicator — the drawn rule that fills. */
export function progress(value, { label = '', showValue = true } = {}) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(value) || 0)))
  return `<div class="paper-progress" role="img" aria-label="${escapeHtml(label || 'Progress')}: ${pct}%">
    ${(label || showValue) ? `<div class="paper-progress-top"><span>${escapeHtml(label)}</span>${showValue ? `<strong>${pct}%</strong>` : ''}</div>` : ''}
    <div class="paper-progress-track"><div class="paper-progress-fill" style="width:${pct}%"></div></div>
  </div>`
}

/** PriorityMarker — a die-cut notch, not a coloured pill. */
export function priorityMarker(priority, text = '') {
  const level = String(priority || 'medium').toLowerCase()
  return `<span class="paper-priority paper-priority--${escapeHtml(level)}">${escapeHtml(text || level)}</span>`
}

/** JournalEntry — a numbered line in a ledger. */
export function entry({ index = '', title = '', meta = '', trailing = '', done = false, attrs = '' } = {}) {
  return `<div class="paper-entry${done ? ' paper-entry--done' : ''}" ${attrs}>
    ${index !== '' ? `<span class="paper-entry-index">${escapeHtml(String(index))}</span>` : '<span></span>'}
    <div class="paper-entry-body">
      <div class="paper-entry-title">${title}</div>
      ${meta ? `<div class="paper-entry-meta">${meta}</div>` : ''}
    </div>
    <div class="paper-entry-trailing">${trailing}</div>
  </div>`
}

/** PaperTimeline — an agenda where time sits in the margin. */
export function agendaRow({ time = '', title = '', meta = '', trailing = '', done = false, now = false } = {}) {
  return `<div class="paper-agenda-row${done ? ' paper-agenda-row--done' : ''}${now ? ' paper-agenda-row--now' : ''}">
    <span class="paper-agenda-time">${escapeHtml(time)}</span>
    <div class="paper-agenda-body"><strong>${title}</strong>${meta ? `<small>${meta}</small>` : ''}</div>
    <div class="paper-agenda-trailing">${trailing}</div>
  </div>`
}

/** A quiet absence. Never a centred box. */
export function absent({ icon: symbol = 'leaf', title = 'Nothing here yet', body = '', action = '' } = {}) {
  return `<div class="empty-state paper-absent">
    ${icon(symbol)}
    <p>${escapeHtml(title)}</p>
    ${body ? `<p>${escapeHtml(body)}</p>` : ''}
    ${action}
  </div>`
}

/** A stat set in the serif, as a marginal note beside a figure. */
export function figure(value, label, { note = '' } = {}) {
  return `<div class="paper-figure">
    <strong>${value}</strong>
    <span>${escapeHtml(label)}</span>
    ${note ? `<small>${escapeHtml(note)}</small>` : ''}
  </div>`
}

/** A stack of figures separated by hairlines — the margin of a journal page. */
export function figureRow(items) {
  return `<div class="paper-figure-row">${items.map((item) => figure(item.value, item.label, item)).join('')}</div>`
}

/** MissionCard / GoalCard / ProjectCard share this chapter card. */
export function chapterCard({ kind = 'chapter', eyebrow = '', title = '', body = '', progressValue = null, progressLabel = 'Progress', foot = '', actions = '', attrs = '' } = {}) {
  return `<article class="paper-chapter paper-chapter--${escapeHtml(kind)}" ${attrs}>
    <div class="paper-chapter-top">
      ${eyebrow ? `<p class="eyebrow">${escapeHtml(eyebrow)}</p>` : ''}
      ${actions ? `<div class="paper-chapter-actions">${actions}</div>` : ''}
    </div>
    <h3 class="paper-chapter-title">${title}</h3>
    ${body ? `<div class="paper-chapter-body">${body}</div>` : ''}
    ${progressValue !== null ? progress(progressValue, { label: progressLabel }) : ''}
    ${foot ? `<div class="paper-chapter-foot">${foot}</div>` : ''}
  </article>`
}

/** The note field: the one place handwriting is allowed. */
export function noteField({ id = 'note', label = '', value = '', rows = 3, placeholder = '' } = {}) {
  return `<div class="paper-note-field">
    <label class="field-label" for="${escapeHtml(id)}">${escapeHtml(label)}</label>
    <textarea id="${escapeHtml(id)}" class="input-field paper-note-input" rows="${rows}" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea>
  </div>`
}
