/* -------------------------------------------------------------------------
   ATMOSPHERE UI — photographs, crossfade, preloading and the manual selector
   -------------------------------------------------------------------------
   The engine (lib/atmosphere.js) decides *which* environment is active. This
   module owns the three photographic layers, the smooth swap and the lockstep
   with the persisted preference.

   Rules that keep the swap invisible:
     • all three layers exist from boot at identical geometry; only opacity
       animates, so nothing reflows and the scroll position is untouched
     • the incoming photograph is decoded *before* it is faded in
     • the next atmosphere in the cycle is warmed after the first idle frame
     • a manual choice is persisted through the store and survives reload;
       `auto` resumes following the device clock on the next minute tick
   ------------------------------------------------------------------------- */

import { emit, on } from '../core/bus.js'
import { commit, currentDayKey, state } from '../core/store.js'
import { ensureSceneLayers, refreshSidebarRoom, setScene } from './scenes.js'
import {
  ATMOSPHERES,
  atmosphereInfo,
  isAtmosphereId,
  isAtmosphereMode,
  nextAtmosphere,
  resolveAtmosphere,
} from '../lib/atmosphere.js'

const ROOT = () => document.documentElement
let root = null
let activeId = null
let lastAutoId = null
let ticker = null
let warmed = new Set()

function layerId(id) {
  return `atmo-${id}`
}

/** Create the three fixed photographic layers once. */
function ensureLayers() {
  if (!document.body || document.getElementById('atmosphere')) return document.getElementById('atmosphere')
  const wrap = document.createElement('div')
  wrap.id = 'atmosphere'
  wrap.setAttribute('aria-hidden', 'true')
  wrap.innerHTML = ATMOSPHERES.map(
    (entry) =>
      `<div class="atmo-layer" id="${layerId(entry.id)}" data-layer="${entry.id}" style="background-image:url('${entry.imageSmall}')"></div>`,
  ).join('')
  document.body.prepend(wrap)
  return wrap
}

/**
 * Warm a full-resolution photograph and swap the layer's background once it
 * has decoded. Returns a promise that settles either way: a failed download
 * must never block the atmosphere it replaces.
 */
function upgradeLayer(id) {
  const info = atmosphereInfo(id)
  const layer = document.getElementById(layerId(id))
  if (!layer || !info) return Promise.resolve()
  if (warmed.has(id)) return Promise.resolve()
  warmed.add(id)
  const preload = new Image()
  preload.decoding = 'async'
  preload.src = info.image
  const apply = () => {
    if (layer.isConnected) layer.style.backgroundImage = `url('${info.image}')`
  }
  if (typeof preload.decode === 'function') {
    return preload
      .decode()
      .then(apply)
      .catch(apply)
  }
  return new Promise((resolve) => {
    preload.onload = () => {
      apply()
      resolve()
    }
    preload.onerror = () => resolve()
  })
}

/** Preload the next environment in the cycle, off the critical path. */
function warmNext(id) {
  const next = nextAtmosphere(id)
  if (!next || warmed.has(next)) return
  const info = atmosphereInfo(next)
  const preload = new Image()
  preload.decoding = 'async'
  preload.src = info.imageSmall
  warmed.add(next)
  // the full-size fetch waits for an idle moment so the first paint stays fast
  const schedule = typeof requestIdleCallback === 'function' ? requestIdleCallback : (fn) => setTimeout(fn, 900)
  schedule(() => {
    const full = new Image()
    full.decoding = 'async'
    full.src = info.image
  })
}

/** Paint one atmosphere. Idempotent, so the minute tick can call it freely. */
export function setAtmosphere(id, { initial = false } = {}) {
  if (!root) root = ROOT()
  if (!isAtmosphereId(id)) return
  const wrap = ensureLayers()
  if (!wrap) return
  if (id === activeId && !initial) return
  const previous = activeId
  activeId = id
  for (const entry of ATMOSPHERES) {
    const layer = document.getElementById(layerId(entry.id))
    if (!layer) continue
    layer.classList.toggle('is-active', entry.id === id)
  }
  root?.setAttribute('data-atmosphere', id)
  // the navigation preview follows the villa's time of day too
  refreshSidebarRoom()
  if (previous !== id) emit('atmosphere:change', { id, previous })
  // full-resolution upgrade after the small image has painted
  const paint = () => upgradeLayer(id).then(() => warmNext(id))
  if (initial) {
    // first paint: decode the hero image immediately, no idle wait
    upgradeLayer(id).then(() => warmNext(id))
  } else if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => setTimeout(paint, 60))
  } else {
    paint()
  }
}

/** Which atmosphere the record currently asks for. */
export function currentAtmosphere() {
  return activeId || resolveAtmosphere(state?.settings?.atmosphere, new Date())
}

export function currentAtmosphereMode() {
  return isAtmosphereMode(state?.settings?.atmosphere) ? state.settings.atmosphere : 'auto'
}

/**
 * Apply the stored preference. `auto` follows the clock; a pinned choice is
 * honoured exactly as chosen. Called on boot, on every store change and from
 * the dashboard selector.
 */
export function applyAtmospherePreference({ initial = false } = {}) {
  const mode = currentAtmosphereMode()
  const resolved = resolveAtmosphere(mode, new Date())
  lastAutoId = resolved
  root = root || ROOT()
  root?.setAttribute('data-atmosphere-mode', mode)
  setAtmosphere(resolved, { initial })
  return resolved
}

/** Reflected on the root so styles can reserve the photograph for the dashboard. */
export function setAtmosphereScope(view) {
  const scope = view === 'dashboard' ? 'dashboard' : 'workspace'
  ROOT()?.setAttribute('data-atmosphere-view', scope)
  // Each chapter paints its own commissioned environment. The attribute is
  // set before the view renders, so its shared opening already knows the room.
  setScene(view)
  // Every chapter gets an address (/calendar, /goals) so it can be linked and
  // reloaded. The Worker answers those paths with the shell, and the router
  // reads the last segment back on boot — see viewFromPath().
  //
  // Replace the *chapter segment*, never append to it: appending turned
  // /calendar into /calendar/calendar on the next navigation.
  try {
    if (typeof history === 'undefined' || !history.replaceState) return
    const path = (typeof window !== 'undefined' && window.location?.pathname) || '/'
    const segments = path.split('/').filter(Boolean)
    const KNOWN = ['dashboard', 'day', 'calendar', 'schedule', 'hyb', 'tasks', 'goals', 'projects',
      'routines', 'focus', 'progress', 'review', 'journal', 'forecast', 'paper', 'settings',
      'assistant', 'overview']
    // drop a trailing chapter name if there is one, then add the new chapter
    if (segments.length && KNOWN.includes(segments[segments.length - 1])) segments.pop()
    const target = view === 'dashboard'
      ? `/${segments.join('/')}`.replace(/\/+$/, '') || '/'
      : `/${[...segments, view].join('/')}`
    if (target !== path) history.replaceState(null, '', target)
  } catch {
    /* sandboxed frames may refuse history writes — the attribute is what matters */
  }
}

/** Persist a manual choice (`morning` … `evening`) or `auto`. */
export function chooseAtmosphere(mode) {
  if (!isAtmosphereMode(mode)) return
  commit((draft) => {
    draft.settings.atmosphere = mode
  }, { silent: true, immediate: true })
  applyAtmospherePreference()
  warmAll()
}

/** Warm the two photographs that are not on screen (used after a choice). */
function warmAll() {
  for (const entry of ATMOSPHERES) {
    if (warmed.has(entry.id)) continue
    const image = new Image()
    image.decoding = 'async'
    image.src = entry.imageSmall
    warmed.add(entry.id)
  }
}

/**
 * The minute tick. When the device clock crosses a boundary the automatic
 * atmosphere changes on its own — without a reload, and only if the user has
 * not pinned an environment.
 */
export function tickAtmosphere(now = new Date()) {
  if (currentAtmosphereMode() !== 'auto') return activeId
  const resolved = resolveAtmosphere('auto', now)
  if (resolved !== activeId) setAtmosphere(resolved)
  lastAutoId = resolved
  return resolved
}

/** Render the accessible Auto / Morning / Afternoon / Evening selector. */
export function atmosphereSwitch() {
  const mode = currentAtmosphereMode()
  const auto = mode === 'auto'
  const autoLabel = auto ? atmosphereInfo(currentAtmosphere()).label : 'Auto'
  const buttons = [
    `<button type="button" role="radio" aria-checked="${auto}" tabindex="${auto ? '0' : '-1'}" class="atmo-choice${auto ? ' is-active' : ''}" data-atmosphere-choice="auto" title="Follow the time of day">
      <span class="atmo-dot dot-auto" aria-hidden="true"></span><span class="atmo-name">${autoLabel}</span><span class="atmo-switch-label">· Auto</span>
    </button>`,
    ...ATMOSPHERES.map((entry) => {
      const active = mode === entry.id
      return `<button type="button" role="radio" aria-checked="${active}" tabindex="${active ? '0' : '-1'}" class="atmo-choice${active ? ' is-active' : ''}" data-atmosphere-choice="${entry.id}" title="${entry.label} atmosphere">
        <span class="atmo-dot dot-${entry.id}" aria-hidden="true"></span><span class="atmo-name">${entry.label}</span>
      </button>`
    }),
  ].join('')
  return `<div class="atmo-switch" role="radiogroup" aria-label="Atmosphere">${buttons}</div>`
}

/**
 * Wire a rendered selector. Renderers call this after inserting their markup;
 * it is delegated on `document`, so it is safe to call on every repaint.
 */
let bound = false
export function bindAtmosphereSwitch() {
  if (bound) return
  bound = true
  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-atmosphere-choice]') : null
    if (!(button instanceof HTMLElement)) return
    const mode = button.dataset.atmosphereChoice
    if (!isAtmosphereMode(mode)) return
    chooseAtmosphere(mode)
    syncSwitchState()
  })
  document.addEventListener('keydown', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-atmosphere-choice]') : null
    if (!(button instanceof HTMLElement)) return
    const group = button.closest('[role=radiogroup]')
    if (!group) return
    const choices = [...group.querySelectorAll('[data-atmosphere-choice]')].filter((node) => node instanceof HTMLElement)
    const index = choices.indexOf(button)
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1
      const next = choices[(index + step + choices.length) % choices.length]
      if (next) {
        next.focus()
        next.click()
      }
    }
  })
}

/** Keep every rendered selector in step with the stored preference. */
export function syncSwitchState() {
  const mode = currentAtmosphereMode()
  const autoLabel = atmosphereInfo(currentAtmosphere()).label
  for (const group of document.querySelectorAll('.atmo-switch')) {
    for (const button of group.querySelectorAll('[data-atmosphere-choice]')) {
      if (!(button instanceof HTMLElement)) continue
      const choice = button.dataset.atmosphereChoice
      const active = choice === mode
      button.classList.toggle('is-active', active)
      button.setAttribute('aria-checked', String(active))
      button.tabIndex = active ? 0 : -1
      if (choice === 'auto') {
        const name = button.querySelector('.atmo-name')
        if (name) name.textContent = autoLabel
      }
    }
  }
}

/** Boot: layers, first paint, warm neighbours, timers and store wiring. */
export function initAtmosphere() {
  if (typeof document === 'undefined') return () => {}
  root = ROOT()
  ensureLayers()
  ensureSceneLayers()
  applyAtmospherePreference({ initial: true })
  bindAtmosphereSwitch()
  on('store:change', () => {
    applyAtmospherePreference()
    syncSwitchState()
  })
  if (ticker) clearInterval(ticker)
  ticker = setInterval(() => {
    if (document.visibilityState !== 'visible') return
    tickAtmosphere()
    syncSwitchState()
  }, 60_000)
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        applyAtmospherePreference()
        syncSwitchState()
      }
    })
  }
  // the day may change while the app is open: re-evaluate at midnight too
  let lastDay = currentDayKey()
  const dayWatch = setInterval(() => {
    const day = currentDayKey()
    if (day !== lastDay) {
      lastDay = day
      applyAtmospherePreference()
      syncSwitchState()
    }
  }, 60_000)
  return () => {
    if (ticker) clearInterval(ticker)
    ticker = null
    clearInterval(dayWatch)
  }
}
