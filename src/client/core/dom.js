/* -------------------------------------------------------------------------
   DOM PLUMBING — escaping, toasts, accessible modals, confirm dialogs
   ------------------------------------------------------------------------- */

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m])
}

/** Attribute-safe escaping (used for values injected into inline handlers). */
export function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;')
}

export function el(id) {
  return document.getElementById(id)
}

/**
 * `querySelector` that keeps element typing usable from plain JS.
 * (Callers pass HTML elements; the DOM lib types the result as `Element`.)
 * @param {ParentNode|null|undefined} root
 * @param {string} selector
 * @returns {any}
 */
export function qs(root, selector) {
  return root ? root.querySelector(selector) : null
}

/**
 * `querySelectorAll` returning an array so callers can use `forEach`/`map`.
 * @param {ParentNode|null|undefined} root
 * @param {string} selector
 * @returns {any[]}
 */
export function qsa(root, selector) {
  if (!root) return []
  return Array.from(root.querySelectorAll(selector))
}

/** Value of an input/select/textarea element (empty string when missing). */
export function valueOf(root, selector) {
  const node = qs(root, selector)
  return node && typeof node.value === 'string' ? node.value : ''
}

/** Value of a checkbox (false when missing). */
export function checkedOf(root, selector) {
  const node = qs(root, selector)
  return !!(node && node.checked)
}

export function debounce(fn, wait = 250) {
  let timer = null
  return (...args) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }
}

let lastFocus = null

/* ------------------------------------------------------------------ toasts */

const TOAST_ICONS = {
  info: 'fa-circle-info text-accent-2',
  success: 'fa-circle-check text-emerald-400',
  error: 'fa-circle-exclamation text-rose-400',
  timer: 'fa-stopwatch text-accent',
}

/**
 * @param {string} message
 * @param {'info'|'success'|'error'|'timer'} [type]
 * @param {{timeout?:number, action?:{label:string, onClick:Function}, id?:string}} [options]
 */
export function toast(message, type = 'info', options = {}) {
  const container = el('toast-container')
  if (!container) return null
  const { timeout = type === 'error' ? 6000 : 3600, action } = options
  const node = document.createElement('div')
  node.className = 'toast'
  node.setAttribute('role', type === 'error' ? 'alert' : 'status')
  node.innerHTML = `<i class="fa-solid ${TOAST_ICONS[type] || TOAST_ICONS.info}"></i><span>${escapeHtml(message)}</span>`
  if (action) {
    const button = document.createElement('button')
    button.className = 'toast-action'
    button.textContent = action.label
    button.addEventListener('click', () => {
      action.onClick()
      dismiss()
    })
    node.appendChild(button)
  }
  container.appendChild(node)
  let dismissed = false
  const dismiss = () => {
    if (dismissed) return
    dismissed = true
    node.classList.add('is-exiting')
    setTimeout(() => node.remove(), EXIT_MS)
  }
  attachSwipeToDismiss(node, dismiss)
  if (timeout) setTimeout(dismiss, timeout)
  return { dismiss }
}

/** Duration of the CSS exit animations (keep in sync with --motion-normal). */
const EXIT_MS = 200

/**
 * Pointer-driven swipe-to-dismiss for touch toasts. The finger moves the node
 * directly (no animation loop, no dependency); releasing past the threshold
 * hands off to the CSS exit animation.
 */
function attachSwipeToDismiss(node, dismiss) {
  if (typeof window === 'undefined' || !window.PointerEvent) return
  let startX = 0
  let dx = 0
  let dragging = false
  node.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse') return
    dragging = true
    startX = event.clientX
    dx = 0
    node.classList.add('is-dragging')
    try {
      node.setPointerCapture(event.pointerId)
    } catch {
      /* capture is best-effort */
    }
  })
  node.addEventListener('pointermove', (event) => {
    if (!dragging) return
    dx = event.clientX - startX
    if (dx < 0) dx = 0
    node.style.transform = `translate3d(${dx}px, 0, 0)`
    node.style.opacity = String(Math.max(0, 1 - dx / 220))
  })
  const end = () => {
    if (!dragging) return
    dragging = false
    node.classList.remove('is-dragging')
    node.style.transform = ''
    node.style.opacity = ''
    if (dx > 80) {
      node.classList.add('is-swiped')
      setTimeout(() => node.remove(), EXIT_MS)
    }
  }
  node.addEventListener('pointerup', end)
  node.addEventListener('pointercancel', end)
}

/* ------------------------------------------------------------------ modals */

/**
 * Render a modal into #modal-root.
 * @param {Object} options
 * @param {string} options.title
 * @param {string} options.body      raw HTML (caller escapes user data)
 * @param {string} [options.footer]  raw HTML
 * @param {string} [options.size]    '' | 'modal-wide' | 'modal-tall'
 * @param {Function} [options.onMount] called after insertion with the modal element
 * @param {Function} [options.onClose] called when the modal closes (any reason)
 * @param {boolean} [options.onCloseDismiss] whether Escape/backdrop closes
 * @param {string} [options.id]
 */
export function openModal({ title, body, footer = '', size = '', onMount, onClose = null, onCloseDismiss = true, id = 'app-modal' }) {
  const root = el('modal-root')
  if (!root) return null
  lastFocus = document.activeElement
  activeModalOnClose = onClose
  root.innerHTML = `
    <div class="modal-overlay" data-modal-backdrop>
      <div class="modal-box ${size}" role="dialog" aria-modal="true" aria-labelledby="${id}-title" data-modal-box>
        <div class="flex items-start justify-between gap-3 mb-4">
          <h3 class="font-display font-bold text-lg text-white" id="${id}-title">${title}</h3>
          <button class="icon-btn" data-modal-close aria-label="Close dialog"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div data-modal-body>${body}</div>
        ${footer ? `<div class="mt-5 flex flex-wrap gap-3 justify-end" data-modal-footer>${footer}</div>` : ''}
      </div>
    </div>`
  const overlay = root.querySelector('[data-modal-backdrop]')
  const box = root.querySelector('[data-modal-box]')
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay && onCloseDismiss) closeModal()
  })
  root.querySelectorAll('[data-modal-close]').forEach((btn) => btn.addEventListener('click', () => closeModal()))
  if (onMount) onMount(box)
  const focusable = /** @type {any} */ (box.querySelector('input, textarea, select, button:not([data-modal-close])'))
  if (focusable && typeof focusable.focus === 'function') focusable.focus()
  if (focusable && focusable.tagName === 'INPUT' && typeof focusable.select === 'function') focusable.select()
  return box
}

let activeModalOnClose = null

/**
 * Clone the open overlay into a non-queryable ghost layer and let CSS play the
 * `.is-exiting` animation there. No data-* hooks survive the clone, so nothing
 * can match `[data-modal-box]` after `closeModal()` returns.
 */
function playModalExit(root) {
  const overlay = root.querySelector('[data-modal-backdrop]')
  if (!overlay || typeof overlay.cloneNode !== 'function') return
  const ghost = /** @type {any} */ (overlay.cloneNode(true))
  ghost.removeAttribute('data-modal-backdrop')
  ghost.querySelectorAll('[data-modal-box], [data-modal-body], [data-modal-footer], [data-modal-close]').forEach((node) => {
    node.removeAttribute('data-modal-box')
    node.removeAttribute('data-modal-body')
    node.removeAttribute('data-modal-footer')
    node.removeAttribute('data-modal-close')
  })
  // Strip identity so the ghost is invisible to queries, a11y and duplicate ids.
  ghost.removeAttribute('id')
  ghost.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'))
  ghost.querySelectorAll('[role]').forEach((node) => node.removeAttribute('role'))
  ghost.setAttribute('aria-hidden', 'true')
  ghost.style.pointerEvents = 'none'
  ghost.classList.add('is-exiting')
  const layer = document.body
  if (!layer) return
  layer.appendChild(ghost)
  setTimeout(() => ghost.remove(), EXIT_MS)
}

export function closeModal() {
  const root = el('modal-root')
  if (root) {
    // The modal leaves the queryable tree immediately (tests and callers may
    // assert on it synchronously); the exit animation plays on a detached
    // clone parked in a sibling layer, so behaviour never becomes async.
    playModalExit(root)
    root.innerHTML = ''
  }
  const previous = /** @type {any} */ (lastFocus)
  if (previous && typeof previous.focus === 'function' && document.contains(previous)) previous.focus()
  lastFocus = null
  const callback = activeModalOnClose
  activeModalOnClose = null
  if (typeof callback === 'function') {
    try {
      callback()
    } catch (error) {
      console.error('[dom] modal onClose failed', error)
    }
  }
}

export function isModalOpen() {
  return !!document.querySelector('[data-modal-backdrop]')
}

/**
 * Promise-based confirmation dialog (replaces window.confirm so it is styled,
 * keyboard accessible and testable).
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title = 'Are you sure?', message = '', confirmText = 'Confirm', cancelText = 'Cancel', danger = false, details = '' } = {}) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      closeModal()
      resolve(value)
    }
    openModal({
      title: escapeHtml(title),
      body: `<p class="text-[13.5px] text-slate-300 leading-relaxed">${escapeHtml(message)}</p>${details ? `<div class="mt-3 text-[12.5px] text-slate-500 whitespace-pre-line">${escapeHtml(details)}</div>` : ''}`,
      footer: `<button class="btn-ghost" data-cancel>${escapeHtml(cancelText)}</button><button class="${danger ? 'btn-danger' : 'btn-primary'}" data-confirm>${escapeHtml(confirmText)}</button>`,
      onMount: (box) => {
        box.querySelector('[data-cancel]').addEventListener('click', () => finish(false))
        box.querySelector('[data-confirm]').addEventListener('click', () => finish(true))
        box.querySelector('[data-confirm]').focus()
      },
    })
  })
}

/* --------------------------------------------------------------- clipboard */

export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', 'true')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}

/** Bootstrap-ish tooltip: title attribute already covers most cases. */
export function hint(text, label = '') {
  return `<span class="help-dot" title="${escapeAttr(text)}" aria-label="${escapeAttr(text)}">${label || '<i class="fa-regular fa-circle-question"></i>'}</span>`
}
