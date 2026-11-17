/* -------------------------------------------------------------------------
   CALENDAR & PRINT ACTIONS — take the plan outside the app
   -------------------------------------------------------------------------
   • .ics export for Google Calendar, Apple Calendar and Outlook
   • a printable day sheet on real paper
   Both are generated locally; nothing is uploaded.
   ------------------------------------------------------------------------- */

import { escapeHtml, openModal, toast } from '../core/dom.js'
import { currentDayKey, state } from '../core/store.js'
import { buildCalendar, buildDaySheet, buildIcs, calendarFilename } from '../lib/calendar-export.js'
import { calendarCoverage } from '../lib/calendar-export.js'
import { formatDuration, formatKeyLabel, toHHMM } from '../lib/dates.js'
import { icon } from './icons.js'

/** Browser download with a safe fallback message. */
export function downloadFile(content, filename, type = 'text/plain;charset=utf-8') {
  try {
    const blob = new Blob([content], { type })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1500)
    return true
  } catch {
    toast('This browser blocked the download. Try Settings → Export backup instead.', 'error')
    return false
  }
}

/**
 * Export a date range as .ics.
 * @param {{from?:string, days?:number, label?:string}} options
 */
export function exportCalendar({ from = currentDayKey(), days = 14, label = '' } = {}) {
  const events = buildCalendar(state, { from, days })
  if (!events.length) {
    toast('There is nothing scheduled in that range yet. Plan a day, then export.', 'info')
    return { ok: false, events: 0, filename: '' }
  }
  const ics = buildIcs(events, { now: new Date(), calendarName: `Command · ${state.settings.userName || 'Personal workspace'}` })
  const filename = calendarFilename(from, days)
  const saved = downloadFile(ics, filename, 'text/calendar;charset=utf-8')
  if (saved) {
    toast(`${events.length} commitment${events.length === 1 ? '' : 's'} exported${label ? ` · ${label}` : ''}. Open the file to add it to your calendar.`, 'success', { timeout: 7000 })
  }
  return { ok: saved, events: events.length, filename }
}

function sheetBlock(block) {
  return `<tr>
    <td class="sheet-time">${escapeHtml(block.time)}</td>
    <td>
      <strong class="${block.completed ? 'sheet-done' : ''}">${escapeHtml(block.title)}</strong>
      ${block.category ? `<span class="sheet-meta">${escapeHtml(block.category)}${block.priority === 'high' ? ' · High priority' : ''}</span>` : block.priority === 'high' ? '<span class="sheet-meta">High priority</span>' : ''}
    </td>
    <td class="sheet-duration">${formatDuration(block.duration)}</td>
    <td class="sheet-check"><span class="sheet-box">${block.completed ? '&#10003;' : ''}</span></td>
  </tr>`
}

function sheetMission(mission) {
  return `<li class="${mission.done ? 'is-done' : ''}"><span class="sheet-box">${mission.done ? '&#10003;' : ''}</span><span>${escapeHtml(mission.title)}</span><small>${formatDuration(mission.estimateMinutes)}</small></li>`
}

/** Open a clean, ink-friendly day sheet and hand it to the print dialog. */
export function openPrintSheet(date = currentDayKey(), { autoPrint = false } = {}) {
  const sheet = buildDaySheet(state, date, { now: new Date() })
  const salutation = state.settings.salutation || 'Sir'
  const body = `
    <div class="print-sheet" id="print-sheet">
      <header class="print-head">
        <div class="print-brand"><span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span><span></span></span><strong>command<span>.</span></strong></div>
        <div class="print-head-right">
          <p>${escapeHtml(formatKeyLabel(date, { weekday: true, year: true }))}</p>
          <span>At your command, ${escapeHtml(salutation)}.</span>
        </div>
      </header>
      <div class="print-summary">
        <div><span>Commitments</span><strong>${sheet.count}</strong></div>
        <div><span>Planned time</span><strong>${formatDuration(sheet.plannedMinutes)}</strong></div>
        <div><span>Focused</span><strong>${sheet.focusMinutes} min</strong></div>
      </div>
      <section class="print-section">
        <h4>Today’s three</h4>
        ${sheet.priorities.length
          ? `<ol class="print-priorities">${sheet.priorities.map((item) => `<li class="${item.done ? 'is-done' : ''}"><span class="sheet-box">${item.done ? '&#10003;' : ''}</span>${escapeHtml(item.title)}</li>`).join('')}</ol>`
          : '<p class="print-empty">No priorities chosen. Leave this line blank and choose one thing that matters.</p>'}
      </section>
      <section class="print-section">
        <h4>The shape of the day</h4>
        ${sheet.blocks.length
          ? `<table class="sheet-table"><tbody>${sheet.blocks.map(sheetBlock).join('')}</tbody></table>`
          : '<p class="print-empty">Nothing timed yet.</p>'}
      </section>
      ${sheet.missions.length ? `<section class="print-section"><h4>Missions without a time</h4><ul class="print-missions">${sheet.missions.map(sheetMission).join('')}</ul></section>` : ''}
      <section class="print-section">
        <h4>Notes</h4>
        <div class="print-lines"><span></span><span></span><span></span><span></span></div>
      </section>
      <footer class="print-foot"><span>Command · local-first by design</span><span>${escapeHtml(toHHMM(new Date().getHours() * 60 + new Date().getMinutes()))} · one page, no noise</span></footer>
    </div>`

  openModal({
    title: 'Print the day',
    size: 'modal-wide',
    id: 'print-modal',
    body,
    footer: `<button class="btn-ghost" data-download-sheet>${icon('download')}Save as HTML</button><button class="btn-ghost" data-modal-close>Close</button><button class="btn-primary" data-print-now>${icon('calendar')}Print</button>`,
    onMount: (box) => {
      box.classList.add('print-mode')
      box.querySelector('[data-print-now]')?.addEventListener('click', () => {
        try {
          window.print()
        } catch {
          toast('Printing is not available in this browser. Save the sheet as HTML instead.', 'info')
        }
      })
      box.querySelector('[data-download-sheet]')?.addEventListener('click', () => {
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>Command · ${escapeHtml(formatKeyLabel(date))}</title><style>${printSheetCss}</style></head><body>${document.getElementById('print-sheet').outerHTML}</body></html>`
        downloadFile(html, `command-day-sheet-${date}.html`, 'text/html;charset=utf-8')
      })
      if (autoPrint) setTimeout(() => { try { window.print() } catch { /* ignored */ } }, 250)
    },
  })
}

const printSheetCss = `
  :root{color-scheme:light}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#171512;background:#fff;margin:32px;font-size:14px;line-height:1.5}
  .print-sheet{max-width:720px;margin:0 auto}
  .print-head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #171512;padding-bottom:14px;margin-bottom:22px}
  .print-brand{display:flex;align-items:center;gap:9px;font-size:18px}
  .brand-mark{display:grid;grid-template-columns:repeat(2,7px);gap:2px}
  .brand-mark span{width:7px;height:7px;background:#171512;border-radius:2px}
  .print-head-right{text-align:right;font-size:12px}
  .print-head-right p{font-weight:600;margin:0 0 3px}
  .print-summary{display:flex;gap:34px;margin-bottom:26px}
  .print-summary div{display:flex;flex-direction:column;gap:2px}
  .print-summary span{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#6b665f}
  .print-summary strong{font-size:22px;font-weight:600}
  .print-section{margin-bottom:24px;break-inside:avoid}
  .print-section h4{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#6b665f;margin:0 0 10px;border-bottom:1px solid #ddd8d0;padding-bottom:6px}
  .print-priorities{list-style:none;padding:0;margin:0}
  .print-priorities li{display:flex;gap:10px;align-items:center;font-size:15px;padding:6px 0}
  .sheet-table{width:100%;border-collapse:collapse}
  .sheet-table td{border-bottom:1px solid #eee9e2;padding:9px 6px;vertical-align:top}
  .sheet-time{width:74px;font-variant-numeric:tabular-nums;font-weight:600;color:#3d3934}
  .sheet-duration{width:78px;text-align:right;color:#6b665f;font-size:12px}
  .sheet-check{width:28px;text-align:center}
  .sheet-meta{display:block;font-size:11px;color:#6b665f;margin-top:2px}
  .sheet-box{display:inline-block;width:14px;height:14px;border:1.5px solid #9a948c;border-radius:3px;text-align:center;font-size:11px;line-height:13px}
  .sheet-done,.is-done{color:#8a847c;text-decoration:line-through}
  .print-missions{list-style:none;padding:0;margin:0}
  .print-missions li{display:flex;gap:10px;align-items:center;padding:7px 0;border-bottom:1px solid #f1ece5}
  .print-missions small{margin-left:auto;color:#6b665f}
  .print-empty{color:#6b665f;font-style:italic;margin:0}
  .print-lines span{display:block;border-bottom:1px solid #e4dfd7;height:26px}
  .print-foot{display:flex;justify-content:space-between;border-top:1px solid #ddd8d0;padding-top:10px;margin-top:30px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#8a847c}
  @media print{body{margin:0}.print-sheet{max-width:none}}
`

/** Short summary used by Settings. */
export function calendarSummary(days = 14) {
  return calendarCoverage(state, currentDayKey(), days)
}

