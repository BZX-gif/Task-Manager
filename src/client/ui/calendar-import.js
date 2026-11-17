/* -------------------------------------------------------------------------
   CALENDAR IMPORT — bring the real week into the plan
   -------------------------------------------------------------------------
   Reads a locally exported .ics file (Google Calendar, Outlook, Apple
   Calendar), previews what it found, and writes it as protected time blocks so
   planning finally respects the meetings that already exist.

   Nothing is uploaded. Re-importing the same file is safe: events are matched
   by UID and never duplicated.
   ------------------------------------------------------------------------- */

import { addDays, formatKeyLabel, dateKey } from '../lib/dates.js'
import { eventsToBlocks, parseIcs } from '../lib/ics.js'
import { commit, currentDayKey, state } from '../core/store.js'
import { closeModal, escapeHtml, openModal, qs, qsa, toast } from '../core/dom.js'
import { icon } from './icons.js'

let parsed = null
let range = 30

export function openCalendarImport() {
  parsed = null
  openModal({
    title: 'Bring your calendar in',
    size: 'modal-wide',
    body: `<p class="section-sub" style="margin-bottom:18px">Export your calendar as an <strong>.ics</strong> file, then drop it here. Events become protected time blocks so the planner stops pretending that time is free. Nothing is uploaded — the file is read in this browser.</p>
      <div class="import-drop" data-import-drop>
        ${icon('upload')}
        <p style="margin-top:10px"><strong>Drop your .ics file here</strong> or <label for="ics-file" style="color:var(--accent);cursor:pointer;text-decoration:underline">choose a file</label></p>
        <p class="form-hint" style="margin-top:6px">Google Calendar → Settings → Export · Outlook → Save calendar · Apple Calendar → File → Export</p>
        <input id="ics-file" type="file" accept=".ics,text/calendar" class="sr-only">
      </div>
      <div class="form-grid" style="margin-top:16px">
        <div><label class="field-label" for="ics-range">How far ahead?</label><select class="input-field" id="ics-range">
          ${[[14, 'Next two weeks'], [30, 'Next 30 days'], [60, 'Next two months']].map(([n, label]) => `<option value="${n}" ${range === n ? 'selected' : ''}>${label}</option>`).join('')}
        </select></div>
        <div><label class="field-label" for="ics-paste">Or paste the file contents</label><textarea class="input-field" id="ics-paste" rows="2" placeholder="BEGIN:VCALENDAR…" style="font-family:ui-monospace,monospace;font-size:11px"></textarea></div>
      </div>
      <div data-import-result></div>
      <div class="form-footer">
        <button type="button" class="btn-ghost" data-modal-close>Cancel</button>
        <button type="button" class="btn-primary" data-import-apply disabled>${icon('calendar')}Import events</button>
      </div>`,
    onMount: (box) => {
      const drop = qs(box, '[data-import-drop]')
      const file = qs(box, '#ics-file')
      const paste = qs(box, '#ics-paste')
      const apply = qs(box, '[data-import-apply]')
      const readText = (text, label = '') => {
        parsed = parseIcs(text, { from: currentDayKey(), to: addDays(currentDayKey(), Number(qs(box, '#ics-range').value) - 1) })
        if (label) parsed.calendarName = parsed.calendarName || label
        renderResult(box)
      }
      file?.addEventListener('change', () => {
        const chosen = file.files?.[0]
        if (!chosen) return
        if (chosen.size > 4 * 1024 * 1024) {
          toast('That file is larger than 4 MB. Export a shorter date range.', 'error')
          return
        }
        const reader = new FileReader()
        reader.onload = () => readText(String(reader.result || ''), chosen.name.replace(/\.ics$/i, ''))
        reader.onerror = () => toast('That file could not be read. Try exporting it again.', 'error')
        reader.readAsText(chosen)
      })
      ;['dragenter', 'dragover'].forEach((name) =>
        drop.addEventListener(name, (event) => {
          event.preventDefault()
          drop.classList.add('is-over')
        }),
      )
      ;['dragleave', 'drop'].forEach((name) =>
        drop.addEventListener(name, (event) => {
          event.preventDefault()
          drop.classList.remove('is-over')
        }),
      )
      drop.addEventListener('drop', (event) => {
        const dropped = event.dataTransfer?.files?.[0]
        if (!dropped) return
        if (file) {
          const transfer = new DataTransfer()
          transfer.items.add(dropped)
          file.files = transfer.files
          file.dispatchEvent(new Event('change'))
        }
      })
      paste?.addEventListener('input', () => {
        if (paste.value.includes('BEGIN:VCALENDAR')) readText(paste.value)
      })
      qs(box, '#ics-range')?.addEventListener('change', (event) => {
        range = Number(event.target.value)
        if (paste?.value.includes('BEGIN:VCALENDAR')) readText(paste.value)
        else if (parsed) renderResult(box)
      })
      apply?.addEventListener('click', () => {
        if (!parsed?.events?.length) return
        let summary = { added: 0, duplicates: 0, daysAffected: 0 }
        commit((s) => {
          summary = eventsToBlocks(parsed.events, s.schedule.days, { today: currentDayKey() })
          s.schedule.days = summary.days
        })
        closeModal()
        const skipped = parsed.stats.allDay + parsed.stats.cancelled + parsed.stats.free + parsed.stats.outside
        toast(
          summary.added
            ? `${summary.added} event${summary.added === 1 ? '' : 's'} imported across ${summary.daysAffected} day${summary.daysAffected === 1 ? '' : 's'}.${summary.duplicates ? ` ${summary.duplicates} already imported.` : ''}${skipped ? ` ${skipped} skipped.` : ''}`
            : summary.duplicates
              ? 'Every event in that file is already on your schedule.'
              : 'No timed events were found in that file.',
          summary.added ? 'success' : 'info',
        )
        if (summary.added) window.CC?.switchView?.('schedule')
      })
    },
  })
}

function renderResult(box) {
  const result = qs(box, '[data-import-result]')
  const apply = qs(box, '[data-import-apply]')
  if (!result) return
  if (!parsed) {
    result.innerHTML = ''
    if (apply) apply.disabled = true
    return
  }
  if (parsed.error) {
    result.innerHTML = `<div class="notice warning-notice" style="margin-top:16px">${icon('info')}<span>${escapeHtml(parsed.error)}</span></div>`
    if (apply) apply.disabled = true
    return
  }
  const events = parsed.events.slice(0, 8)
  const skipped = parsed.stats.allDay + parsed.stats.cancelled + parsed.stats.free + parsed.stats.outside
  result.innerHTML = `
    <div class="import-preview">
      <div class="import-preview-head">
        <span>${parsed.events.length} timed event${parsed.events.length === 1 ? '' : 's'} found${parsed.calendarName ? ` · ${escapeHtml(parsed.calendarName)}` : ''}</span>
        <span>${skipped ? `${skipped} skipped` : 'ready to import'}</span>
      </div>
      ${events
        .map(
          (event) => `<div class="import-row"><span>${formatKeyLabel(event.date)}</span><strong>${escapeHtml(event.title)}</strong><span>${escapeHtml(event.time || '')} · ${event.duration}m${event.repeating ? ' · repeats' : ''}</span></div>`,
        )
        .join('')}
      ${parsed.events.length > events.length ? `<div class="import-row"><span></span><strong>+ ${parsed.events.length - events.length} more</strong><span></span></div>` : ''}
    </div>
    <p class="form-hint" style="margin-top:12px">All-day entries, declined events and free-time blocks are left out. Imported events are protected, so “Plan my day” will work around them.</p>`
  if (apply) apply.disabled = parsed.events.length === 0
}

/** A tiny helper used by Settings to explain where imports live. */
export function calendarImportSummary() {
  const imported = Object.values(state.schedule?.days || {})
    .flat()
    .filter((block) => block?.icsUid).length
  return { imported, today: dateKey() }
}
