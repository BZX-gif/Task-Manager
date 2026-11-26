/* -------------------------------------------------------------------------
   SCENE UI — the photographs and the editorial opening of every room

   Two responsibilities, deliberately kept apart from the data layer:

   1. paint one full-screen photograph per environment and crossfade on route
      changes, with the small file first and the decoded full file second;
   2. give every view an opening that belongs to its room — the chapter mark,
      a large editorial heading, a line written for that environment and the
      real figures the view is about.

   All figures in the opening are read from the same store the view renders.
   ------------------------------------------------------------------------- */

import { escapeHtml } from '../core/dom.js'
import { currentDayKey, state } from '../core/store.js'
import { formatDuration } from '../lib/dates.js'
import { sessionTotals } from '../lib/focus.js'
import { scheduleFor } from '../lib/planner.js'
import { isSceneId, sceneForView, sceneImage, sceneInfo, SCENE_IDS } from '../lib/scenes.js'
import { ritualOverview } from '../lib/rituals.js'

const ROOT = () => (typeof document === 'undefined' ? null : document.documentElement)
const CURRENT = { id: 'villa', view: 'dashboard', warmed: new Set() }

function layerId(id) {
  return `scene-${id}`
}

/** The photographic layers are created once, long before the first route. */
export function ensureSceneLayers() {
  if (typeof document === 'undefined' || !document.body) return null
  let wrap = document.getElementById('scene')
  if (!wrap) {
    wrap = document.createElement('div')
    wrap.id = 'scene'
    wrap.setAttribute('aria-hidden', 'true')
    const villa = document.getElementById('atmosphere')
    if (villa?.parentNode) villa.parentNode.insertBefore(wrap, villa.nextSibling)
    else document.body.prepend(wrap)
  }
  if (wrap.querySelector('.scene-layer')) return wrap
  wrap.insertAdjacentHTML('beforeend', SCENE_IDS.map((id) => {
    const image = sceneImage(id)
    return `<div class="scene-layer" id="${layerId(id)}" data-scene-layer="${id}" style="background-image:url('${image.imageSmall}')"></div>`
  }).join(''))
  return wrap
}

/** Decode the full frame before fading it over the small one. */
function upgradeLayer(id) {
  const layer = document.getElementById(layerId(id))
  if (!layer || CURRENT.warmed.has(id)) return Promise.resolve()
  CURRENT.warmed.add(id)
  const info = sceneImage(id)
  const apply = () => {
    if (layer.isConnected) layer.style.backgroundImage = `url('${info.image}')`
  }
  const preload = new Image()
  preload.decoding = 'async'
  preload.src = info.image
  if (typeof preload.decode === 'function') return preload.decode().then(apply).catch(apply)
  return new Promise((resolve) => {
    preload.onload = () => { apply(); resolve() }
    preload.onerror = () => resolve()
  })
}

/** Warm the neighbouring rooms off the critical path. */
function warmNeighbours(id) {
  const index = SCENE_IDS.indexOf(id)
  if (index < 0) return
  for (const next of [SCENE_IDS[(index + 1) % SCENE_IDS.length], SCENE_IDS[(index + 2) % SCENE_IDS.length]]) {
    if (CURRENT.warmed.has(next)) continue
    const image = new Image()
    image.decoding = 'async'
    image.src = sceneImage(next).imageSmall
    CURRENT.warmed.add(next)
  }
}

/**
 * The navigation rail carries a small proof of the room you selected. It uses
 * the same photograph as the page itself, so the index and the environment
 * always agree — including when the villa changes time of day.
 */
export function refreshSidebarRoom() {
  if (typeof document === 'undefined') return
  const id = ROOT()?.dataset.scene || CURRENT.id || 'villa'
  const scene = isSceneId(id) ? sceneInfo(id) : sceneInfo('villa')
  const atmosphere = ROOT()?.dataset.atmosphere || 'morning'
  const image = sceneImage(scene.id, atmosphere).imageSmall
  for (const card of document.querySelectorAll('[data-sidebar-room]')) {
    if (!(card instanceof HTMLElement)) continue
    card.dataset.room = scene.id
    const photo = card.querySelector('[data-sidebar-room-photo]')
    if (photo instanceof HTMLElement) photo.style.backgroundImage = `url('${image}')`
    const name = card.querySelector('[data-sidebar-room-name]')
    if (name) name.textContent = scene.name
    const place = card.querySelector('[data-sidebar-room-place]')
    if (place) place.textContent = scene.place
  }
}

/**
 * Paint the room that belongs to a route. The villa is a no-op here: it is
 * already painted by the atmosphere engine's three layers.
 */
export function setScene(view, { initial = false } = {}) {
  if (typeof document === 'undefined') return null
  const id = sceneForView(view)
  CURRENT.id = id
  CURRENT.view = view
  ROOT()?.setAttribute('data-scene', id)
  refreshSidebarRoom()
  if (!document.getElementById('scene')) ensureSceneLayers()
  if (id === 'villa') {
    // The villa has its own three-layer atmosphere; the rooms stand down.
    for (const layer of document.querySelectorAll('#scene .scene-layer')) layer.classList.remove('is-active')
    return id
  }
  for (const layer of document.querySelectorAll('#scene .scene-layer')) {
    if (!(layer instanceof HTMLElement)) continue
    layer.classList.toggle('is-active', layer.dataset.sceneLayer === id)
  }
  const paint = () => {
    upgradeLayer(id).then(() => warmNeighbours(id))
  }
  if (initial || typeof requestAnimationFrame !== 'function') paint()
  else requestAnimationFrame(() => setTimeout(paint, 40))
  return id
}

/* ------------------------------------------------------- the room's figures */

function count(list, predicate) {
  return Array.isArray(list) ? list.filter(predicate).length : 0
}

/** Real numbers for the room's opening line. Never invented, never mocked. */
function sceneFacts(id) {
  const today = currentDayKey()
  const tasks = state?.tasks || []
  const open = count(tasks, (t) => !t.done && t.status !== 'cancelled')
  const doneToday = count(tasks, (t) => t.done && t.date === today)
  const overdue = count(tasks, (t) => !t.done && t.status !== 'cancelled' && t.date && t.date < today)
  const top3 = (state?.top3?.[today] || []).filter(Boolean)
  const top3Done = count(top3, (id) => tasks.find((t) => t.id === id)?.done)
  const focusMinutes = sessionTotals(state?.focus?.sessions || [], today).focusedMinutes
  const focusTarget = Number(state?.settings?.focus?.targetMinutes || 180)
  const blocks = count(scheduleFor(state || {}, today), (block) => block.time && block.kind !== 'protected')
  const goals = state?.goals || []
  const projects = state?.projects || []
  const milestones = goals.reduce((sum, goal) => sum + count(goal.milestones || [], (m) => m.done), 0)
  const entries = count(state?.journal?.entries || state?.journal || [], (entry) => !!entry?.dateKey || !!entry?.date)
  const rituals = ritualOverview(state?.rituals, today, { days: 60 })
  const map = {
    villa: [['Today', String(doneToday)], ['Open', String(open)]],
    day: [['Date', new Date(`${today}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })], ['Priorities', `${top3Done}/${top3.length || 3}`], ['Open', String(open)]],
    missions: [['Open', String(open)], ['Earlier', String(overdue)], ['Done today', String(doneToday)]],
    goals: [['In motion', String(count(goals, (g) => g.status === 'active'))], ['Milestones', String(milestones)]],
    projects: [['In motion', String(count(projects, (p) => p.status === 'active'))], ['Completed', String(count(projects, (p) => p.status === 'completed'))]],
    terrace: [['Committed', String(blocks)], ['Earlier', String(overdue)]],
    study: [['Focused today', focusMinutes > 60 ? formatDuration(focusMinutes) : `${Math.round(focusMinutes)}m`], ['Target', formatDuration(focusTarget)]],
    lounge: [['Open', String(open)], ['Earlier', String(overdue)], ['Done today', String(doneToday)]],
    writing: [['Entries', String(entries)], ['Focused today', focusMinutes > 60 ? formatDuration(focusMinutes) : `${Math.round(focusMinutes)}m`]],
    garden: [['Kept today', `${rituals.doneToday}/${rituals.dueToday}`], ['Best run', `${rituals.bestRun}d`], ['Rules', String(rituals.count)]],
  }
  return map[id] || map.villa
}

/**
 * The chapter opening shared by every view. The caller's title may contain
 * markup (several views set a span inside a heading), so it is trusted; the
 * scene copy and figures are escaped.
 */
export function sceneHero({ eyebrow = '', title = '', lede = '', actions = '' } = {}) {
  const id = ROOT()?.dataset.scene || CURRENT.id || 'villa'
  const scene = isSceneId(id) ? sceneInfo(id) : sceneInfo('villa')
  const facts = sceneFacts(scene.id)
  return `<header class="page-heading paper-header scene-hero" data-scene-hero>
    <div class="scene-hero-wash" aria-hidden="true"></div>
    <div class="scene-hero-main">
      <div class="scene-hero-mark">
        <span class="scene-index" aria-hidden="true">${scene.index}</span>
        <i class="scene-hair" aria-hidden="true"></i>
        <p class="eyebrow">${escapeHtml(eyebrow || scene.name)}</p>
      </div>
      <h1>${title}</h1>
      <p class="scene-lede">${escapeHtml(lede || scene.welcome)}</p>
      <div class="scene-welcome"><span aria-hidden="true">✦</span><p>${escapeHtml(scene.welcome)}</p></div>
    </div>
    <aside class="scene-hero-aside">
      <div class="scene-place">
        <span>Your environment</span>
        <strong>${escapeHtml(scene.place)}</strong>
        <small>${escapeHtml(scene.light)}</small>
      </div>
      <dl class="scene-facts">${facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>
      ${actions ? `<div class="heading-actions">${actions}</div>` : ''}
    </aside>
  </header>`
}
