/* -------------------------------------------------------------------------
   TRASH ACTIONS — reversible deletes, and the “Recently deleted” manager
   ------------------------------------------------------------------------- */

import { closeModal, confirmDialog, escapeHtml, openModal, toast } from '../core/dom.js'
import { commit, state } from '../core/store.js'
import { archiveMission, emptyTrash, restoreMission, TRASH_TTL_DAYS, trashSummary } from '../lib/trash.js'
import { icon } from './icons.js'

function deletedAgo(timestamp, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - timestamp) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/** Move a mission to the trash and offer an immediate undo. */
export function trashMission(id, { silent = false } = {}) {
  /** @type {any} */ let result = null
  commit((s) => {
    result = archiveMission(s, id, { now: Date.now() })
  })
  if (!result?.ok) {
    if (!silent) toast(result?.reason || 'This mission could not be removed.', 'error')
    return result
  }
  if (!silent) {
    const recordId = result.record.id
    toast('Mission moved to Recently deleted. It can be restored for 30 days.', 'info', {
      timeout: 9000,
      action: {
        label: 'Undo',
        onClick: () => {
          /** @type {any} */ let restored = null
          commit((s) => { restored = restoreMission(s, recordId) })
          if (restored?.ok) {
            toast('Mission restored with its place in the day.', 'success')
            window.CC.refreshAll()
          }
        },
      },
    })
  }
  return result
}

function trashRow(record, now) {
  const blocks = record.blocks?.length || 0
  const detail = [
    record.task.date || 'No date',
    record.task.done ? 'was completed' : '',
    blocks ? `${blocks} scheduled block${blocks === 1 ? '' : 's'}` : '',
    `deleted ${deletedAgo(record.deletedAt, now)}`,
  ].filter(Boolean).join(' · ')
  return `<div class="trash-row" data-trash-row="${escapeHtml(record.id)}">
    <span class="trash-icon">${icon('missions')}</span>
    <div><strong>${escapeHtml(record.task.title)}</strong><span>${escapeHtml(detail)}</span></div>
    <button class="btn-ghost btn-small" data-trash-restore="${escapeHtml(record.id)}">${icon('recover')}Restore</button>
    <button class="icon-btn danger-hover" data-trash-purge="${escapeHtml(record.id)}" aria-label="Delete ${escapeHtml(record.task.title)} forever">${icon('trash')}</button>
  </div>`
}

/** The full manager, also reachable from Settings and the palette. */
export function openTrashManager() {
  const summary = trashSummary(state)
  const now = Date.now()
  const body = `
    <div class="trash-manager">
      <p class="section-sub">Deleting a mission is reversible. Everything here can be restored with its scheduled blocks and priority slot for ${TRASH_TTL_DAYS} days, then it is removed for good.</p>
      ${summary.records.length
        ? `<div class="trash-list">${summary.records.map((record) => trashRow(record, now)).join('')}</div>
           <div class="trash-foot">
             <span>${summary.count} mission${summary.count === 1 ? '' : 's'} · ${summary.expiringSoon ? `${summary.expiringSoon} expiring within 3 days` : 'none expiring soon'}</span>
             <button class="text-button danger-text" data-empty-trash>Empty Recently deleted</button>
           </div>`
        : `<div class="empty-state">${icon('trash')}<p>Nothing deleted.</p><p>Missions you remove will wait here for ${TRASH_TTL_DAYS} days.</p></div>`}
      <div class="form-footer"><button class="btn-primary" data-modal-close>Done</button></div>
    </div>`

  openModal({
    title: 'Recently deleted',
    size: 'modal-wide',
    body,
    onMount: (box) => {
      box.querySelectorAll('[data-trash-restore]').forEach((button) => {
        button.addEventListener('click', () => {
          const id = button.dataset.trashRestore
          /** @type {any} */ let restored = null
          commit((s) => { restored = restoreMission(s, id) })
          if (restored?.ok) {
            closeModal()
            toast('Mission restored with its place in the day.', 'success')
            window.CC.refreshAll()
          } else {
            toast(restored?.reason || 'This mission could not be restored.', 'error')
          }
        })
      })
      box.querySelectorAll('[data-trash-purge]').forEach((button) => {
        button.addEventListener('click', async () => {
          const id = button.dataset.trashPurge
          const record = state.trash.find((item) => item.id === id)
          if (!record) return
          const ok = await confirmDialog({
            title: 'Delete this mission forever?',
            message: 'Focus sessions and your completion history stay intact, but the mission itself cannot be brought back.',
            details: record.task.title,
            confirmText: 'Delete forever',
            danger: true,
          })
          if (!ok) return
          commit((s) => { s.trash = s.trash.filter((item) => item.id !== id) })
          openTrashManager()
          toast('Mission deleted permanently.', 'info')
        })
      })
      box.querySelector('[data-empty-trash]')?.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'Empty Recently deleted?',
          message: 'Every mission in this list will be removed permanently. Your focus history and completion log are never touched.',
          confirmText: 'Empty the trash',
          danger: true,
        })
        if (!ok) return
        let count = 0
        commit((s) => { count = emptyTrash(s) })
        closeModal()
        toast(`${count} mission${count === 1 ? '' : 's'} permanently deleted.`, 'info')
        window.CC.refreshAll()
      })
    },
  })
}

export function trashCount() {
  return (state.trash || []).length
}

