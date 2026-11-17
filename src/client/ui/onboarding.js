/* -------------------------------------------------------------------------
   ONBOARDING — the first ninety seconds
   -------------------------------------------------------------------------
   A blank workspace is honest and useless. This is the one screen that turns
   an empty product into a place with a point of view: name, tempo, and a
   starting point the person actually chooses.

   It writes nothing until the person confirms, it can always be dismissed, and
   every record it creates is ordinary data they can edit or delete.
   ------------------------------------------------------------------------- */

import { escapeHtml, qs, qsa } from '../core/dom.js'
import { commit, currentDayKey, state } from '../core/store.js'
import { STARTER_PRESETS, applyStarter, buildStarter, buildDemoWorkspace, applyDemo, isFreshWorkspace } from '../lib/starters.js'
import { uid } from '../lib/state.js'
import { icon } from './icons.js'

let root = null
let step = 1
let choice = 'founder'
let draft = null

function ensureRoot() {
  if (root && document.body.contains(root)) return root
  root = document.createElement('div')
  root.id = 'onboarding-root'
  document.body.appendChild(root)
  return root
}

export function isOnboardingOpen() {
  return !!root && !root.classList.contains('hidden') && !!root.querySelector('.onboarding')
}

/** Offered once, only when there is genuinely nothing to look at. */
export function shouldOfferOnboarding() {
  if (!state) return false
  const seen = state.onboarding?.seen === true || state.settings?.onboarding?.seen === true
  return !seen && isFreshWorkspace(state)
}

export function openOnboarding({ force = false } = {}) {
  if (!force && !shouldOfferOnboarding()) return false
  draft = {
    userName: state.settings.userName || '',
    salutation: state.settings.salutation || '',
    workingStart: state.settings.workingHours?.start || '09:00',
    workingEnd: state.settings.workingHours?.end || '18:00',
  }
  step = 1
  choice = 'founder'
  render()
  return true
}

export function closeOnboarding() {
  if (root) root.innerHTML = ''
  draft = null
}

function markSeen(extra = {}) {
  commit((s) => {
    s.onboarding = { ...(s.onboarding || {}), seen: true, ...extra }
    s.settings.onboarding = { ...(s.settings.onboarding || {}), seen: true }
  }, { silent: true, immediate: true })
}

function saveProfile() {
  const name = qs(root, '#ob-name')?.value?.trim() || ''
  const salutation = qs(root, '#ob-salutation')?.value?.trim() || ''
  const start = qs(root, '#ob-start')?.value || '09:00'
  const end = qs(root, '#ob-end')?.value || '18:00'
  draft = { userName: name, salutation, workingStart: start, workingEnd: end }
  commit((s) => {
    s.settings.userName = name.slice(0, 60)
    s.settings.salutation = salutation.slice(0, 40)
    if (start < end) s.settings.workingHours = { start, end }
  }, { silent: true, immediate: true })
}

function render() {
  const host = ensureRoot()
  const fresh = isFreshWorkspace(state)
  const profileStep = step === 1
  host.innerHTML = `<div class="onboarding" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
    <div class="onboarding-card">
      <div class="onboarding-brand">
        <span class="brand-lockup" style="padding:0;min-height:0"><span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span><span></span></span><span class="brand-name">command<span>.</span></span></span>
        <div class="onboarding-steps" aria-label="Step ${step} of 2"><span class="${step >= 1 ? 'is-on' : ''}"></span><span class="${step >= 2 ? 'is-on' : ''}"></span></div>
      </div>
      ${profileStep ? profileHtml() : startHtml(fresh)}
    </div>
  </div>`
  bind()
}

function profileHtml() {
  const name = draft?.userName || ''
  const salutation = draft?.salutation || ''
  return `
    <p class="eyebrow">Welcome to Command</p>
    <h2 id="onboarding-title">A quieter place to do your best work.</h2>
    <p class="lede">Everything lives on this device. No account, no feed, nothing sent anywhere unless you ask for it. Two questions and you are in.</p>
    <form class="onboarding-form" id="ob-form">
      <div class="onboarding-grid">
        <div><label class="field-label" for="ob-name">What should we call you?</label><input class="input-field" id="ob-name" maxlength="60" placeholder="Your first name" value="${escapeHtml(name)}" autocomplete="given-name"></div>
        <div><label class="field-label" for="ob-salutation">How should the briefing address you?</label><input class="input-field" id="ob-salutation" maxlength="40" placeholder="Sir, Coach, or your name" value="${escapeHtml(salutation)}"></div>
      </div>
      <div class="onboarding-grid">
        <div><label class="field-label" for="ob-start">Your day begins</label><input class="input-field" id="ob-start" type="time" value="${escapeHtml(draft?.workingStart || '09:00')}"></div>
        <div><label class="field-label" for="ob-end">Your day ends</label><input class="input-field" id="ob-end" type="time" value="${escapeHtml(draft?.workingEnd || '18:00')}"></div>
      </div>
      <div class="onboarding-foot">
        <p class="hint">You can change all of this later. Nothing is public, and nothing leaves this browser.</p>
        <div style="display:flex;gap:8px">
          <button type="button" class="btn-ghost" data-ob-skip>Skip</button>
          <button type="submit" class="btn-primary">Continue ${icon('arrow')}</button>
        </div>
      </div>
    </form>`
}

function startHtml(fresh) {
  return `
    <p class="eyebrow">Step two · your starting point</p>
    <h2 id="onboarding-title">Begin with something real.</h2>
    <p class="lede">A small, working example is easier to bend than an empty screen. Choose one — it creates a few goals, missions and routines you can edit or delete. ${fresh ? '' : 'These are added alongside what you already have.'}</p>
    <div class="preset-grid" role="radiogroup" aria-label="Starting point">
      ${STARTER_PRESETS.map(
        (preset) => `<button type="button" class="preset ${choice === preset.id ? 'is-active' : ''}" role="radio" aria-checked="${choice === preset.id}" data-ob-preset="${preset.id}">
          <span class="preset-head">${icon(preset.icon)}${escapeHtml(preset.label)}</span>
          <p>${escapeHtml(preset.blurb)}</p>
          <small>${escapeHtml(preset.promise)}</small>
        </button>`,
      ).join('')}
      <button type="button" class="preset ${choice === 'demo' ? 'is-active' : ''}" role="radio" aria-checked="${choice === 'demo'}" data-ob-preset="demo">
        <span class="preset-head">${icon('sparkle')}Show me a full workspace</span>
        <p>A fortnight of realistic history — goals, projects, focus sessions and journal entries — so every view has something to say.</p>
        <small>Example data · clearly reversible</small>
      </button>
      <button type="button" class="preset ${choice === 'empty' ? 'is-active' : ''}" role="radio" aria-checked="${choice === 'empty'}" data-ob-preset="empty">
        <span class="preset-head">${icon('shield')}Start empty</span>
        <p>No sample records. A clean workspace, exactly as it is, with a good first mission to add yourself.</p>
        <small>Nothing created</small>
      </button>
    </div>
    <div class="onboarding-foot">
      <p class="hint">Everything here is ordinary data. Export or delete it at any time from Settings.</p>
      <div style="display:flex;gap:8px">
        <button type="button" class="btn-ghost" data-ob-back>Back</button>
        <button type="button" class="btn-primary" data-ob-begin>${choice === 'empty' ? 'Open my workspace' : 'Begin'} ${icon('arrow')}</button>
      </div>
    </div>`
}

function bind() {
  const host = ensureRoot()
  qs(host, '#ob-form')?.addEventListener('submit', (event) => {
    event.preventDefault()
    saveProfile()
    step = 2
    render()
  })
  qs(host, '[data-ob-skip]')?.addEventListener('click', () => {
    saveProfile()
    step = 2
    render()
  })
  qs(host, '[data-ob-back]')?.addEventListener('click', () => {
    saveProfile()
    step = 1
    render()
  })
  qsa(host, '[data-ob-preset]').forEach((button) =>
    button.addEventListener('click', () => {
      choice = button.dataset.obPreset
      render()
    }),
  )
  qs(host, '[data-ob-begin]')?.addEventListener('click', begin)
}

function begin() {
  const today = currentDayKey()
  if (choice !== 'empty') {
    commit((s) => {
      if (choice === 'demo') {
        applyDemo(s, buildDemoWorkspace({ today, now: Date.now(), uid }), { today })
      } else {
        const starter = buildStarter(choice, { today, now: Date.now(), uid })
        if (starter) applyStarter(s, starter)
      }
    })
  } else {
    markSeen({ completed: true, preset: 'empty', completedAt: Date.now() })
  }
  closeOnboarding()
  // A fresh start should show its first real screen, not a second overlay.
  window.CC?.refreshAll?.()
  try {
    window.CC?.switchView?.('dashboard')
  } catch {
    /* the shell is still usable */
  }
}
