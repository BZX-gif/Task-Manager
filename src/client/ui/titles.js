/* -------------------------------------------------------------------------
   TITLES — presentation for the private achievement collection
   -------------------------------------------------------------------------
   • titleCardHtml()        → the full card used on the Profile
   • disciplineStripHtml()  → the small dashboard progression strip
   • checkTitleUnlock()     → the one-time unlock ceremony

   The ceremony fires ONLY on the locked → unlocked transition: the unlock is
   stamped in localStorage when it happens and immediately marked as seen, so
   reloading the page can never replay it. Nothing here is shared or published.
   ------------------------------------------------------------------------- */

import { closeModal, escapeHtml, openModal } from '../core/dom.js'
import { commit, state } from '../core/store.js'
import { formatUnlockDate, pendingCelebrations, titleById, unlockSummary } from '../lib/achievements.js'

/** Tick row (the "██████░░░░" look, one tick per required day). */
function ticksHtml(value, target) {
  const cells = []
  for (let i = 0; i < target; i++) {
    cells.push(`<span class="title-tick${i < value ? ' is-on' : ''}"></span>`)
  }
  return `<div class="title-ticks" aria-hidden="true">${cells.join('')}</div>`
}

/**
 * Today's live line. Today is never counted until it is over, so this is the
 * honest "how is today going" feedback under the streak.
 */
export function todayLineHtml(title) {
  const today = title?.today
  if (!today || !today.started) return ''
  const ahead = today.blocksAhead
  const hasPlan = today.tasksPlanned > 0 || today.blocksPlanned > 0 || ahead > 0
  if (!hasPlan) {
    return '<p class="title-today"><i class="fa-regular fa-circle"></i> Today has no planned work yet — add tasks and timetable blocks to make it count.</p>'
  }
  const parts = [
    `Today: ${today.tasksCompleted}/${today.tasksPlanned} tasks`,
    today.blocksPlanned > 0 ? `${today.blocksCompleted}/${today.blocksPlanned} blocks due so far` : 'no block due yet',
    ahead > 0 ? `${ahead} block${ahead === 1 ? '' : 's'} still ahead` : '',
  ].filter(Boolean)
  const left = today.tasksLeft + today.blocksLeft
  const tail = today.onTrack ? ' — today counts once the day ends.' : left ? ` — ${left} left to close it out` : ''
  const icon = today.onTrack ? 'fa-solid fa-circle-check' : 'fa-regular fa-circle'
  return `<p class="title-today${today.onTrack ? ' is-perfect' : ''}"><i class="${icon}"></i> ${escapeHtml(parts.join(' · '))}${escapeHtml(tail)}</p>`
}

/**
 * Full title card for the Profile.
 * @param {any} input a single title from store.titleStates() (or the array)
 */
export function titleCardHtml(input) {
  const title = Array.isArray(input) ? input[0] : input
  if (!title) return ''
  const unlocked = title.unlocked
  const unlockedLine = unlocked
    ? `<p class="title-state-line"><i class="fa-solid fa-check"></i> UNLOCKED${title.unlockedDateKey ? ` · ${escapeHtml(formatUnlockDate(title.unlockedDateKey))}` : ''}</p>
       <p class="title-desc">${escapeHtml(`${title.unlockedStreak} consecutive Perfect Days`)}</p>`
    : ''

  return `
    <article class="title-card ${unlocked ? 'is-unlocked' : 'is-locked'}" data-title="${escapeHtml(title.id)}" aria-label="${escapeHtml(`${title.name} — ${title.subtitle} — ${unlocked ? 'unlocked' : `${title.value} of ${title.target}`}`)}">
      <div class="title-glow" aria-hidden="true"></div>
      <div class="flex items-start gap-3.5 sm:gap-4">
        <div class="title-badge ${unlocked ? 'is-earned' : ''}" aria-hidden="true">
          ${unlocked ? `<span class="title-emoji">${title.emoji}</span>` : '<i class="fa-solid fa-lock"></i>'}
        </div>
        <div class="min-w-0 flex-1">
          <h3 class="title-name">${escapeHtml(title.name)}</h3>
          <p class="title-sub">${escapeHtml(title.subtitle)}</p>
        </div>
        <span class="chip ${unlocked ? 'chip-good' : 'chip-muted'} title-chip">${unlocked ? 'UNLOCKED' : 'LOCKED'}</span>
      </div>

      ${unlocked
        ? unlockedLine
        : `<div class="title-progress">
             <p class="title-progress-label">${escapeHtml(title.progressLabel)}</p>
             <div class="progress-track progress-track-lg"><div class="progress-fill progress-fill-gold" style="width:${title.percent}%"></div></div>
             ${ticksHtml(title.value, title.target)}
             <p class="title-remaining">${escapeHtml(title.remainingLabel)}</p>
             ${todayLineHtml(title)}
           </div>`}

      <p class="title-rule">${escapeHtml(title.description)}</p>
    </article>`
}

/**
 * Small dashboard strip — motivating, never dominating.
 * @param {any} input a single title from store.titleStates() (or the array)
 */
export function disciplineStripHtml(input) {
  const title = Array.isArray(input) ? input[0] : input
  if (!title) return ''
  const unlocked = title.unlocked
  const head = `
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <div class="min-w-0">
        <p class="discipline-eyebrow"><span aria-hidden="true">${unlocked ? title.emoji : '⚡'}</span> ${escapeHtml(title.name)}</p>
        <p class="discipline-sub">${escapeHtml(title.subtitle)}</p>
      </div>
      ${unlocked
        ? '<span class="chip chip-good"><i class="fa-solid fa-check"></i> TITLE UNLOCKED</span>'
        : '<span class="chip">CURRENT STREAK</span>'}
    </div>`

  if (unlocked) {
    return `
      <button type="button" class="glass-card discipline-strip is-unlocked w-full text-left" data-open-title>
        ${head}
        <p class="discipline-unlocked mt-3"><span class="discipline-count">${title.unlockedStreak}</span> PERFECT DAYS ACHIEVED</p>
        <p class="discipline-hint">Best run: ${title.run.best} days · open Profile to see your private titles</p>
      </button>`
  }

  return `
    <button type="button" class="glass-card discipline-strip w-full text-left" data-open-title>
      ${head}
      <div class="mt-3">
        <p class="discipline-count-line"><span class="discipline-count">${title.value}</span> <span class="discipline-of">/ ${title.target} PERFECT DAYS</span></p>
        <div class="progress-track progress-track-lg mt-2"><div class="progress-fill progress-fill-gold" style="width:${title.percent}%"></div></div>
        <div class="flex items-center justify-between gap-3 mt-2 flex-wrap">
          <p class="discipline-remaining">${escapeHtml(title.remainingLabel)}</p>
          <p class="discipline-best">Best run: ${title.run.best} day${title.run.best === 1 ? '' : 's'}</p>
        </div>
      </div>
      ${todayLineHtml(title)}
      <p class="discipline-hint">Perfect day = 100% of that day's tasks and started timetable blocks.</p>
    </button>`
}

/* ------------------------------------------------------------- celebration */

let celebrating = false

/**
 * Show the unlock ceremony if a title was earned and never celebrated.
 * Safe to call often — it is a no-op unless a brand new unlock exists.
 * @returns {string|null} the title id that was celebrated
 */
export function checkTitleUnlock() {
  if (celebrating || !state) return null
  const pending = pendingCelebrations(state)
  if (!pending.length) return null
  const id = pending[0]
  const title = titleById(id)
  const entry = state.achievements?.unlocked?.[id] || null
  if (!title) return null

  celebrating = true
  // Mark it seen *before* painting: a reload must never replay the ceremony.
  commit(
    (s) => {
      if (s.achievements?.unlocked?.[id]) s.achievements.unlocked[id].seen = true
    },
    { immediate: true, silent: true },
  )
  showUnlockCeremony(title, entry)
  return id
}

/** The premium unlock moment: scale + fade + glass glow + badge reveal. */
export function showUnlockCeremony(title, entry = null) {
  const summary = unlockSummary(title, entry)
  const body = `
    <div class="unlock-card">
      <div class="unlock-badge-wrap" aria-hidden="true">
        <span class="unlock-ring"></span>
        <span class="unlock-badge">${title.emoji}</span>
      </div>
      <p class="unlock-name">${escapeHtml(title.name)}</p>
      <p class="unlock-sub">${escapeHtml(title.subtitle)}</p>
      <p class="unlock-completed">${escapeHtml(summary.completedLabel)}</p>
      <p class="unlock-note">${escapeHtml(summary.note)}</p>
    </div>`
  const footer = `
    <button type="button" class="btn-ghost" data-modal-close>Later</button>
    <button type="button" class="btn-primary" data-view-title>VIEW TITLE</button>`

  openModal({
    id: 'title-unlock',
    size: 'modal-unlock',
    title: '✦ TITLE UNLOCKED ✦',
    body,
    footer,
    onMount: (box) => {
      // "Later"/Escape are wired up by openModal itself
      box.querySelector('[data-view-title]')?.addEventListener('click', () => {
        closeModal()
        window.CC?.switchView?.('profile')
      })
    },
    onClose: () => {
      celebrating = false
    },
  })
  return true
}
