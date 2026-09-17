/* -------------------------------------------------------------------------
   TITLES UI — private unlock celebration (Discipline Monster)
   -------------------------------------------------------------------------
   • Premium glass modal, no heavy libraries
   • Only fires on locked → unlocked transition
   • Respects prefers-reduced-motion
   • Stores seen flag so refresh doesn't re-trigger
   ------------------------------------------------------------------------- */

import { escapeHtml, openModal, closeModal } from '../core/dom.js'
import { commit } from '../core/store.js'
import { formatUnlockDate } from '../lib/achievements.js'

let hasShownThisSession = false

export function showTitleUnlockModal({ definition, streak }) {
  if (hasShownThisSession) return
  hasShownThisSession = true

  const title = definition || { name: 'DISCIPLINE MONSTER', subtitle: '10 DAY PERFECT RUN', icon: '⚡' }

  const body = `
    <div class="title-unlock-wrap" data-unlock-wrap>
      <div class="title-unlock-glow" aria-hidden="true"></div>
      <p class="title-unlock-eyebrow">✦ TITLE UNLOCKED ✦</p>
      <div class="title-unlock-badge" aria-hidden="true">
        <span class="title-unlock-icon">${escapeHtml(title.icon)}</span>
      </div>
      <h2 class="title-unlock-name">${escapeHtml(title.name)}</h2>
      <p class="title-unlock-sub">${escapeHtml(title.subtitle)}</p>
      <p class="title-unlock-detail">10 PERFECT DAYS COMPLETED</p>
      <div class="title-unlock-divider"></div>
      <p class="title-unlock-message">
        You showed up.<br>
        You finished.<br>
        You stayed consistent.
      </p>
      <div class="flex gap-3 mt-6 justify-center">
        <button class="btn-primary" data-unlock-view>VIEW TITLE</button>
        <button class="btn-ghost" data-modal-close>Continue</button>
      </div>
    </div>
  `

  openModal({
    title: '',
    body,
    size: 'modal-wide',
    onMount: (box) => {
      // Trigger entrance animation
      requestAnimationFrame(() => {
        const wrap = box.querySelector('[data-unlock-wrap]')
        if (wrap) wrap.classList.add('is-visible')
      })

      box.querySelector('[data-unlock-view]')?.addEventListener('click', () => {
        closeModal()
        // Mark seen and switch to settings (profile)
        commit((s) => {
          if (s.titles?.disciplineMonster) s.titles.disciplineMonster.seen = true
        }, { immediate: true })
        window.CC?.switchView('settings')
      })

      // On any close, mark seen
      const root = document.getElementById('modal-root')
      const observer = new MutationObserver(() => {
        if (!root || !root.innerHTML) {
          commit((s) => {
            if (s.titles?.disciplineMonster) s.titles.disciplineMonster.seen = true
          }, { immediate: true })
          observer.disconnect()
        }
      })
      if (root) observer.observe(root, { childList: true })

      // Respect reduced motion
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const wrap = box.querySelector('[data-unlock-wrap]')
        if (wrap) wrap.classList.add('reduce-motion')
      }
    },
    onClose: () => {
      commit((s) => {
        if (s.titles?.disciplineMonster) s.titles.disciplineMonster.seen = true
      }, { immediate: true })
    },
  })
}

export function initTitlesListener() {
  // Also expose global for custom events (fallback)
  window.addEventListener('titles-unlocked', (e) => {
    // @ts-ignore — CustomEvent detail
    const detail = e.detail
    if (detail) showTitleUnlockModal(detail)
  })
}

// Bus integration — called from main.js
export function handleTitlesUnlocked(detail) {
  showTitleUnlockModal(detail)
}
