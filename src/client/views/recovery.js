/* -------------------------------------------------------------------------
   RECOVER MY DAY — show the proposal first, never change anything silently
   ------------------------------------------------------------------------- */

import { formatDuration, minutesOfDay } from '../lib/dates.js'
import { applyRecovery, planRecovery, undoRecovery } from '../lib/recovery.js'
import { closeModal, escapeHtml, openModal, toast } from '../core/dom.js'
import { commit, currentDayKey, minutesNow, state } from '../core/store.js'

export function openRecoveryModal({ nowMinutes = minutesNow() } = {}) {
  const today = currentDayKey()
  const log = state.completionLog[today] || { ttDone: [] }
  const plan = planRecovery({
    timetable: state.timetable,
    ttDone: log.ttDone,
    nowMinutes,
    dayEndMinutes: minutesOfDay(state.settings.dayEnd || '23:30'),
    protectedBlocks: state.settings.protectedTime || [],
    todayKey: today,
  })

  const body = `
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
      ${tile('Missed', formatDuration(plan.missedMinutes), `${plan.missed.length} block${plan.missed.length === 1 ? '' : 's'}`)}
      ${tile('Free time left', formatDuration(plan.availableMinutes), plan.protectedMinutes ? `${formatDuration(plan.protectedMinutes)} protected` : 'no protected time')}
      ${tile('Still ahead', `${plan.upcoming.length}`, `${formatDuration(plan.upcoming.reduce((s, b) => s + b.duration, 0))} scheduled`)}
    </div>

    ${
      plan.missed.length
        ? `<div class="glass-card p-4">
             <p class="text-[11px] uppercase tracking-wider font-bold text-slate-500 mb-2">Missed</p>
             <div class="space-y-1.5 text-[13px]">
               ${plan.missed
                 .map(
                   (m) => `<div class="flex items-center gap-3">
                      <span class="text-slate-500 w-14">${escapeHtml(m.time)}</span>
                      <span class="flex-1 text-slate-300 truncate">${escapeHtml(m.title)}</span>
                      <span class="text-slate-500 text-[12px]">${m.duration}m</span>
                    </div>`,
                 )
                 .join('')}
             </div>
           </div>`
        : ''
    }

    ${
      plan.proposals.length
        ? `<div class="glass-card p-4 mt-4">
             <p class="text-[11px] uppercase tracking-wider font-bold text-slate-500 mb-2">Proposed compressed schedule</p>
             <div class="space-y-2">
               ${plan.proposals
                 .map(
                   (p) => `
                 <div class="flex flex-wrap items-center gap-3 text-[13px]">
                   <span class="text-slate-500 line-through w-14">${escapeHtml(p.from.time)}</span>
                   <i class="fa-solid fa-arrow-right text-slate-600 text-[10px]"></i>
                   <span class="text-emerald-400 font-semibold w-14">${escapeHtml(p.to.time)}</span>
                   <span class="flex-1 text-slate-200 truncate">${escapeHtml(p.title)}</span>
                   <span class="text-[12px] ${p.compressed ? 'text-accent-4' : 'text-slate-500'}">${p.compressed ? `${p.from.duration} → ${p.to.duration}m` : `${p.to.duration}m`}</span>
                 </div>`,
                 )
                 .join('')}
             </div>
           </div>`
        : ''
    }

    ${
      plan.notes.length
        ? `<ul class="mt-4 space-y-1.5 text-[12.5px] text-slate-400">
             ${plan.notes.map((n) => `<li class="flex items-start gap-2"><i class="fa-solid fa-circle-info text-[10px] mt-1.5 text-slate-600"></i><span>${escapeHtml(n)}</span></li>`).join('')}
           </ul>`
        : ''
    }

    ${
      plan.skipped.length
        ? `<div class="mt-3 text-[12.5px] text-accent-5">
             ${plan.skipped.map((s) => `<div class="flex items-center gap-2"><i class="fa-solid fa-triangle-exclamation text-[11px]"></i><span>${escapeHtml(s.title)} — ${escapeHtml(s.reason)}</span></div>`).join('')}
           </div>`
        : ''
    }

    <div class="flex flex-wrap gap-3 justify-end mt-5">
      <button class="btn-ghost" data-ai-recovery><i class="fa-solid fa-robot mr-1.5"></i>Ask AI</button>
      <button class="btn-ghost" data-modal-close>Cancel</button>
      <button class="btn-primary" data-apply ${plan.canApply ? '' : 'disabled'}><i class="fa-solid fa-check mr-1.5"></i>Apply recovery plan</button>
    </div>`

  openModal({
    title: 'Recover My Day',
    body,
    size: 'modal-wide',
    onMount: (box) => {
      box.querySelector('[data-apply]')?.addEventListener('click', () => {
        let snapshot = []
        commit((s) => {
          snapshot = applyRecovery(s.timetable, plan.proposals)
        })
        closeModal()
        toast(`${plan.proposals.length} block${plan.proposals.length === 1 ? '' : 's'} rescheduled`, 'success', {
          timeout: 9000,
          action: {
            label: 'Undo',
            onClick: () => {
              commit((s) => {
                undoRecovery(s.timetable, snapshot)
              })
              toast('Schedule restored', 'info')
            },
          },
        })
      })
      box.querySelector('[data-ai-recovery]')?.addEventListener('click', () => {
        window.CC.switchView('assistant')
        window.CC.askAI('Help me recover today')
      })
    },
  })
}

function tile(label, value, sub) {
  return `
    <div class="glass-card p-3.5">
      <p class="text-[11px] uppercase tracking-wider font-bold text-slate-500">${label}</p>
      <p class="text-xl font-display font-extrabold text-white mt-0.5">${value}</p>
      <p class="text-[11px] text-slate-500 mt-0.5">${sub}</p>
    </div>`
}
