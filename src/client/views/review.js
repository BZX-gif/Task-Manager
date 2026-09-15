/* -------------------------------------------------------------------------
   WEEKLY REVIEW — a modal that reads your real week and tells you what to do
   ------------------------------------------------------------------------- */

import { addDays, formatDuration, weekdayName, weekdayOf } from '../lib/dates.js'
import { weeklyReview, weekLabel } from '../lib/review.js'
import { escapeHtml, openModal } from '../core/dom.js'
import { currentDayKey, state } from '../core/store.js'
import { emptyState, fieldRow } from './shared.js'

let weekOffset = 0

export function openWeeklyReview({ offset = 0 } = {}) {
  weekOffset = offset
  const today = currentDayKey()
  const anchor = addDays(today, weekOffset * 7)
  const review = weeklyReview(state, { dateKey: anchor, todayKey: today, now: new Date(), weekStart: state.settings.weekStart })

  const body = `
    <div class="flex items-center justify-between gap-3 mb-4">
      <div>
        <p class="text-[13px] text-slate-300 font-semibold">${escapeHtml(weekLabel(review.from, review.to))}</p>
        <p class="text-[11.5px] text-slate-500">${review.isCurrentWeek ? 'This week so far' : 'Completed week'}</p>
      </div>
      <div class="flex gap-2">
        <button class="icon-btn" data-week="-1" title="Previous week"><i class="fa-solid fa-chevron-left text-xs"></i></button>
        <button class="icon-btn" data-week="1" title="Next week" ${weekOffset >= 0 ? 'disabled' : ''}><i class="fa-solid fa-chevron-right text-xs"></i></button>
      </div>
    </div>

    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      ${tile('Focused', formatDuration(review.focusedMinutes), `${review.focusTargetPct}% of ${formatDuration(review.focusTarget)}`)}
      ${tile('Completion', `${review.completionPct}%`, `${formatDuration(review.completedMinutes)} of ${formatDuration(review.elapsedPlannedMinutes)}`)}
      ${tile('Avg score', String(review.averageScore), `Streak days: ${review.activeDays}/7`)}
      ${tile('Tasks', `${review.tasksDone}/${review.tasksPlanned}`, `${review.taskCompletionPct}% done`)}
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5">
      <div class="glass-card p-4">
        <p class="text-[11px] uppercase tracking-wider font-bold text-slate-500 mb-2">Best day</p>
        ${review.bestDay
          ? `<p class="font-display font-bold text-white text-lg">${weekdayName(weekdayOf(review.bestDay.dateKey))}</p>
             <p class="text-[12.5px] text-slate-400 mt-1">${review.bestDay.score}/100 · ${formatDuration(review.bestDay.focusedMinutes)} focused · ${review.bestDay.tasksDone}/${review.bestDay.tasksPlanned} tasks</p>`
          : '<p class="text-[13px] text-slate-500">Not enough data yet.</p>'}
      </div>
      <div class="glass-card p-4">
        <p class="text-[11px] uppercase tracking-wider font-bold text-slate-500 mb-2">Needs attention</p>
        ${review.weakestDay
          ? `<p class="font-display font-bold text-white text-lg">${weekdayName(weekdayOf(review.weakestDay.dateKey))}</p>
             <p class="text-[12.5px] text-slate-400 mt-1">${review.weakestDay.score}/100 · ${review.weakestDay.blocksDone}/${review.weakestDay.blocksTotal} blocks · ${formatDuration(review.weakestDay.focusedMinutes)} focused</p>`
          : '<p class="text-[13px] text-slate-500">Every day looked solid.</p>'}
      </div>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
      <div class="glass-card p-4">
        <p class="text-[11px] uppercase tracking-wider font-bold text-slate-500 mb-2">Day by day</p>
        <div class="space-y-1.5">
          ${review.dayRows
            .map(
              (day) => `
            <div class="flex items-center gap-3 text-[12.5px]">
              <span class="w-9 text-slate-500">${escapeHtml(day.dateKey.slice(8))}</span>
              <span class="w-8 text-slate-400">${escapeHtml(weekdayName(weekdayOf(day.dateKey)).slice(0, 3))}</span>
              <div class="progress-track !h-1.5 flex-1"><div class="progress-fill" style="width:${day.score}%"></div></div>
              <span class="w-8 text-right text-slate-400">${day.score}</span>
              <span class="w-12 text-right ${day.focusedMinutes ? 'text-accent-2' : 'text-slate-600'}">${day.focusedMinutes}m</span>
            </div>`,
            )
            .join('')}
        </div>
      </div>
      <div class="glass-card p-4">
        <p class="text-[11px] uppercase tracking-wider font-bold text-slate-500 mb-2">Category performance</p>
        ${
          review.strongestCategory
            ? `${fieldRow('Strongest', `<span class="text-emerald-400">${escapeHtml(review.strongestCategory.name)} · ${review.strongestCategory.completionPct}%</span>`)}
               ${review.weakestCategory ? fieldRow('Weakest', `<span class="text-accent-5">${escapeHtml(review.weakestCategory.name)} · ${review.weakestCategory.completionPct}%</span>`) : ''}
               <div class="mt-2 space-y-1.5">
                 ${review.categories
                   .filter((c) => c.itemsPlanned > 0)
                   .slice(0, 5)
                   .map(
                     (c) => `<div class="flex items-center gap-2 text-[12px]">
                        <span class="legend-dot" style="background:${c.color}"></span>
                        <span class="flex-1 text-slate-300 truncate">${escapeHtml(c.name)}</span>
                        <span class="text-slate-500">${c.completionPct}%</span>
                      </div>`,
                   )
                   .join('')}
               </div>`
            : '<p class="text-[13px] text-slate-500">No category activity this week.</p>'
        }
      </div>
    </div>

    <div class="glass-card p-4 mt-4">
      <p class="text-[11px] uppercase tracking-wider font-bold text-slate-500 mb-3">Recommendations</p>
      <div class="space-y-2.5">
        ${review.recommendations
          .map(
            (rec) => `
          <div class="flex items-start gap-3 text-[13px] text-slate-300">
            <i class="fa-solid fa-arrow-right text-accent-2 mt-1 text-xs"></i>
            <span>${escapeHtml(rec.text)}</span>
          </div>`,
          )
          .join('')}
      </div>
    </div>

    ${review.missedTasks.length
      ? `<div class="glass-card p-4 mt-4">
           <p class="text-[11px] uppercase tracking-wider font-bold text-slate-500 mb-2">Missed tasks (${review.missedTasks.length})</p>
           <div class="space-y-1.5 text-[12.5px] text-slate-400">
             ${review.missedTasks.map((t) => `<div class="flex items-center gap-2"><span class="priority-dot" style="background:#fb7185"></span><span class="flex-1 truncate">${escapeHtml(t.title)}</span><span class="text-slate-600">${escapeHtml(t.date)}</span></div>`).join('')}
           </div>
         </div>`
      : ''}

    <div class="flex flex-wrap gap-3 justify-end mt-5">
      <button class="btn-ghost" data-ai-review><i class="fa-solid fa-robot mr-1.5"></i>Ask AI to review</button>
      <button class="btn-primary" data-modal-close>Done</button>
    </div>`

  openModal({
    title: 'Weekly Review',
    body,
    size: 'modal-wide',
    onMount: (box) => {
      box.querySelectorAll('[data-week]').forEach((btn) =>
        btn.addEventListener('click', () => {
          const delta = Number(btn.dataset.week)
          const next = weekOffset + delta
          if (next > 0) return
          openWeeklyReview({ offset: next })
        }),
      )
      box.querySelector('[data-ai-review]')?.addEventListener('click', () => {
        window.CC.switchView('assistant')
        window.CC.askAI('Review my week')
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

