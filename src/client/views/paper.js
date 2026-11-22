/* -------------------------------------------------------------------------
   PAPER · workspace — the executive intelligence interface.

   Four surfaces, all driven by the real engine in lib/paper/:
     Executive Briefing  the current situation, in facts
     Ask PAPER           the local intent interface (honest about limits)
     Recommendations     advice with evidence, impact and next steps
     Alerts              situations that need attention

   Prepared actions are shown as confirmations. Nothing in this view
   mutates the workspace without an explicit user decision.
   ------------------------------------------------------------------------- */

import { askPaper } from '../lib/paper/engine.js'
import { INTENTS, examplePrompts } from '../lib/paper/intent.js'
import { executiveBriefing, briefingNarrative } from '../lib/paper/briefing.js'
import { generateAlerts, generateRecommendations } from '../lib/paper/recommendations.js'
import { buildWorkspaceContext } from '../lib/paper/context.js'
import { executeAction, describeAction } from '../lib/paper/actions.js'
import { recordInteraction, clearHistory, emptyPaper } from '../lib/paper/memory.js'
import { PAPER_INTRO, PRIORITY_LABELS, EVIDENCE_LABELS, minutesLabel } from '../lib/paper/core.js'
import { AI_SYSTEM_PROMPT, buildAiContext, friendlyAiError, trimHistory } from '../lib/ai-context.js'
import { commit, currentDayKey, state } from '../core/store.js'
import { escapeHtml, qs, qsa, toast, openModal, closeModal, confirmDialog } from '../core/dom.js'
import { icon, pageHeading, empty } from '../ui/common.js'

let draft = ''
let pending = false
let lastError = null
/** Prepared action descriptors awaiting confirmation, by render index. */
let pendingActions = []

/* ------------------------------------------------------------------ render */

export function renderPaper() {
  const section = document.getElementById('view-paper')
  if (!section) return
  const input = qs(section, '#paper-input')
  if (input) draft = input.value
  const hadFocus = input === document.activeElement
  const start = input?.selectionStart || 0
  const end = input?.selectionEnd || 0

  const ctx = buildWorkspaceContext(state, { now: new Date() })
  const briefing = executiveBriefing(state, ctx)
  const alerts = generateAlerts(state, ctx)
  const recs = generateRecommendations(state, ctx).slice(0, 4)
  pendingActions = []
  const history = state.paper?.history || []

  section.innerHTML = `
    ${pageHeading('PAPER · PERSONAL INTELLIGENCE', 'Your chief of staff.', 'Deterministic analysis of your actual workspace — every statement labelled, every recommendation reasoned. Local, offline, and nothing changes without your confirmation.', `<span class="chip chip-good">${icon('shield')}Local · no external model</span>`)}
    <div class="paper-layout">
      <div class="paper-main">
        <section class="card paper-briefing" aria-label="Executive briefing">
          <div class="paper-card-head"><span class="entity-icon">${icon('sparkles')}</span><div><h3>Executive briefing</h3><p>${escapeHtml(briefing.greeting)} · ${escapeHtml(briefing.situation)}</p></div><span class="paper-stamp">${escapeHtml(ctx.todayKey)}</span></div>
          ${briefing.nextMove ? `<div class="paper-next"><span class="eyebrow">Next move</span><strong>${escapeHtml(briefing.nextMove.title)}</strong><p>${escapeHtml(briefing.nextMove.reason)}</p></div>` : `<div class="paper-next quiet"><span class="eyebrow">Next move</span><strong>The day is yours.</strong><p>No mission is demanding you right now.</p></div>`}
          <div class="paper-brief-grid">
            <div><span class="eyebrow">Objectives</span>${briefing.objectives.length ? `<ul class="paper-list">${briefing.objectives.map((o) => `<li><strong>${escapeHtml(o.title)}</strong><small>${escapeHtml(o.reason)}</small></li>`).join('')}</ul>` : '<p class="form-hint">No objectives chosen yet.</p>'}</div>
            <div><span class="eyebrow">Deadlines &amp; overdue</span>${briefing.deadlines.length || briefing.overdue.length ? `<ul class="paper-list">${briefing.overdue.map((o) => `<li><strong>${escapeHtml(o.title)}</strong><small>${o.days} day${o.days === 1 ? '' : 's'} overdue</small></li>`).join('')}${briefing.deadlines.map((d) => `<li><strong>${escapeHtml(d.title)}</strong><small>due ${escapeHtml(d.relative)}</small></li>`).join('')}</ul>` : '<p class="form-hint">Nothing overdue. No deadlines in reach.</p>'}</div>
            <div><span class="eyebrow">Time</span><ul class="paper-list"><li><strong>${minutesLabel(briefing.time.freeMinutes)} free</strong><small>${minutesLabel(briefing.time.focusedMinutes)} of deep work so far</small></li><li><strong>Score ${briefing.progress.hasData ? briefing.progress.score : '—'}</strong><small>Top 3 ${briefing.progress.top3Done}/${briefing.progress.top3Total} done</small></li></ul></div>
          </div>
          <p class="paper-narrative">${escapeHtml(briefingNarrative(briefing))}</p>
        </section>

        <section class="card paper-ask" aria-label="Ask PAPER">
          <div class="paper-card-head"><span class="entity-icon">${icon('sparkle')}</span><div><h3>Ask PAPER</h3><p>A fixed catalog of workspace questions, answered from your records. Not open-ended chat.</p></div><button class="icon-btn" data-paper-clear aria-label="Clear PAPER history">${icon('trash')}</button></div>
          <div class="paper-chips">${INTENTS.slice(0, 8).map((entry) => `<button class="chip chip-action" data-paper-ask="${escapeHtml(entry.examples[0])}">${escapeHtml(entry.label)}</button>`).join('')}</div>
          <div id="paper-log" class="paper-log" role="log" aria-live="polite">
            ${history.length ? history.map((m) => messageHtml(m)).join('') : `<div class="paper-welcome"><span class="paper-welcome-mark">${icon('sparkles')}</span><h4>${escapeHtml(PAPER_INTRO.split('.')[0])}.</h4><p>${escapeHtml(PAPER_INTRO.split('.').slice(1).join('.').trim())}</p></div>`}
            ${pending ? '<div class="msg-bubble msg-ai typing-indicator" aria-label="PAPER is analysing"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>' : ''}
          </div>
          ${lastError ? `<div class="notice warning-notice" style="margin:0 20px 14px">${icon('info')}<span>${escapeHtml(lastError)}</span></div>` : ''}
          <form id="paper-form" class="assistant-composer">
            <label class="sr-only" for="paper-input">Ask PAPER</label>
            <textarea id="paper-input" class="input-field" rows="2" maxlength="400" placeholder="What should I focus on today?" ${pending ? 'disabled' : ''}>${escapeHtml(draft)}</textarea>
            <button class="btn-primary" type="submit" aria-label="Ask PAPER" ${pending ? 'disabled' : ''}>${icon('arrow')}</button>
          </form>
          <label class="paper-external-toggle"><input type="checkbox" id="paper-external" ${pending ? 'disabled' : ''}><span>Also consult the optional external model (sends a compact productivity snapshot to the configured server)</span></label>
        </section>
      </div>

      <aside class="paper-side">
        <section class="card paper-recs" aria-label="Recommendations">
          <div class="paper-card-head"><span class="entity-icon">${icon('target')}</span><div><h3>Recommendations</h3><p>Ranked by urgency · every one carries its reasons</p></div></div>
          ${recs.length ? recs.map((rec) => recommendationHtml(rec)).join('') : empty('leaf', 'Nothing calls for a change.', 'When the workspace needs a decision, it will be listed here with its reasons.')}
        </section>

        <section class="card paper-alerts" aria-label="Alerts">
          <div class="paper-card-head"><span class="entity-icon">${icon('bell')}</span><div><h3>Alerts</h3><p>Situations, not advice</p></div></div>
          ${alerts.length ? alerts.map((a) => alertHtml(a)).join('') : empty('check', 'No open alerts.', 'Overdue work, close deadlines, conflicts and overload would appear here.')}
        </section>

        <section class="card paper-tools" aria-label="Planning tools">
          <h3 class="section-title">Planning tools</h3>
          <p class="form-hint" style="margin:8px 0 14px">Deterministic planners over your real schedule. Every proposal waits for your approval.</p>
          <div class="assistant-local-tools">
            <button data-local="plan">${icon('sun')}<span><strong>Plan my day</strong><small>Fit priorities into real available time.</small></span>${icon('chevron')}</button>
            <button data-local="recover">${icon('recover')}<span><strong>Recover my day</strong><small>Restore control without guilt.</small></span>${icon('chevron')}</button>
            <button data-local="next">${icon('arrow')}<span><strong>Find my next move</strong><small>One action, with a transparent reason.</small></span>${icon('chevron')}</button>
            <button data-local="review">${icon('review')}<span><strong>Review my week</strong><small>Notice what worked. Plan what’s next.</small></span>${icon('chevron')}</button>
          </div>
        </section>
      </aside>
    </div>`

  bindView(section)
  const log = qs(section, '#paper-log')
  if (log) log.scrollTop = log.scrollHeight
  const chat = qs(section, '#paper-input')
  if (hadFocus && !pending && chat) {
    chat.focus()
    chat.setSelectionRange(start, end)
  }
}

/* ------------------------------------------------------------------ pieces */

function messageHtml(m) {
  const isUser = m.role === 'user'
  const findings = (m.findings || []).slice(0, 4)
  const actions = m.actions || []
  return `<div class="chat-message ${isUser ? 'is-user' : 'is-assistant'}">
    <span class="chat-avatar">${icon(isUser ? 'user' : 'sparkles')}</span>
    <div>
      <span class="chat-role">${isUser ? 'You' : m.source === 'external' ? 'PAPER · external model' : 'PAPER'}${m.error ? ' · unavailable' : ''}</span>
      <div class="msg-bubble ${isUser ? 'msg-user' : 'msg-ai'}">${escapeHtml(m.text).replace(/\n/g, '<br>')}</div>
      ${findings.length ? `<div class="paper-findings">${findings.map((f) => `<div class="paper-finding"><span class="evidence evidence-${escapeHtml(f.kind)}">${escapeHtml(EVIDENCE_LABELS[f.kind] || f.kind)}</span><span>${escapeHtml(f.text)}</span></div>`).join('')}</div>` : ''}
      ${actions.map((action) => {
        const index = pendingActions.push(action) - 1
        return `<button class="btn-ghost btn-small paper-history-action" data-paper-action="${index}">${icon('check')}${escapeHtml(action.label || describeAction(action))} · confirm</button>`
      }).join('')}
      ${!isUser && m.intent && m.intent !== 'none' ? `<span class="paper-intent-tag">intent · ${escapeHtml(m.intent.replace(/_/g, ' '))}</span>` : ''}
    </div>
  </div>`
}

function recommendationHtml(rec) {
  const actionHtml = rec.action ? (() => {
    const index = pendingActions.push(rec.action) - 1
    return `<button class="btn-primary btn-small paper-rec-action" data-paper-action="${index}">${icon('check')}${escapeHtml(rec.action.label || 'Review & confirm')}</button>`
  })() : ''
  return `<article class="paper-rec priority-${escapeHtml(rec.priority)}">
    <div class="paper-rec-top"><span class="paper-priority">${escapeHtml(PRIORITY_LABELS[rec.priority] || rec.priority)}</span><h4>${escapeHtml(rec.title)}</h4></div>
    <p>${escapeHtml(rec.detail)}</p>
    <details class="paper-why"><summary>Why (${rec.why.length})</summary><ul>${rec.why.map((f) => `<li><span class="evidence evidence-${escapeHtml(f.kind)}">${escapeHtml(EVIDENCE_LABELS[f.kind] || f.kind)}</span>${escapeHtml(f.text)}</li>`).join('')}</ul></details>
    ${rec.impact ? `<p class="paper-impact"><span class="eyebrow">Impact</span>${escapeHtml(rec.impact)}</p>` : ''}
    ${rec.nextStep ? `<p class="paper-nextstep"><span class="eyebrow">Next step</span>${escapeHtml(rec.nextStep)}</p>` : ''}
    ${actionHtml}
  </article>`
}

function alertHtml(a) {
  return `<article class="paper-alert severity-${escapeHtml(a.severity)}">
    <div class="paper-alert-top"><span class="paper-severity">${escapeHtml(a.severity)}</span><strong>${escapeHtml(a.title)}</strong></div>
    <p>${escapeHtml(a.detail)}</p>
    ${a.link ? `<button class="text-button" data-paper-goto="${escapeHtml(a.link.view)}">Open ${escapeHtml(a.link.view)} ${icon('chevron')}</button>` : ''}
  </article>`
}

function findingsHtml(findings) {
  if (!findings || !findings.length) return ''
  return `<div class="paper-findings">${findings.slice(0, 5).map((f) => `<div class="paper-finding"><span class="evidence evidence-${escapeHtml(f.kind)}">${escapeHtml(EVIDENCE_LABELS[f.kind] || f.kind)}</span><span>${escapeHtml(f.text)}</span></div>`).join('')}</div>`
}

/* ------------------------------------------------------------------ wiring */

function bindView(section) {
  const form = qs(section, '#paper-form')
  const input = qs(section, '#paper-input')
  if (input) {
    input.value = draft
    input.addEventListener('input', () => { draft = input.value })
    input.addEventListener('keydown', handleChatKey)
  }
  if (form) form.addEventListener('submit', (event) => { event.preventDefault(); sendMessage() })

  qsa(section, '[data-paper-ask]').forEach((button) => button.addEventListener('click', () => sendMessage(button.dataset.paperAsk)))
  qsa(section, '[data-local]').forEach((button) => button.addEventListener('click', () => runLocalCommand(button.dataset.local)))
  qsa(section, '[data-paper-action]').forEach((button) => button.addEventListener('click', () => confirmPreparedAction(Number(button.dataset.paperAction))))
  qsa(section, '[data-paper-goto]').forEach((button) => button.addEventListener('click', () => window.CC.switchView(button.dataset.paperGoto)))
  qs(section, '[data-paper-clear]')?.addEventListener('click', async () => {
    if (await confirmDialog({ title: 'Clear PAPER’s history?', message: 'This clears the question log only. Missions, schedule and focus history are untouched.', confirmText: 'Clear history' })) {
      commit((s) => clearHistory(s))
      toast('PAPER’s history is clear.', 'info')
    }
  })
}

export function handleChatKey(event) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    sendMessage()
  }
}

/**
 * Ask PAPER. Local intent parsing first; the optional external model is used
 * only when the user explicitly opts in with the checkbox.
 */
export async function sendMessage(textOverride = null) {
  if (pending) return
  const input = /** @type {any} */ (document.getElementById('paper-input'))
  const text = (textOverride ?? input?.value ?? '').trim()
  if (!text) return
  draft = ''
  pending = true
  lastError = null

  const useExternal = !!(/** @type {any} */ (document.getElementById('paper-external'))?.checked)
  commit((s) => {
    recordInteraction(s, { role: 'user', text })
    if (!s.paper) s.paper = emptyPaper()
  }, { silent: true })
  renderPaper()

  if (useExternal) {
    await askExternal(text)
  } else {
    const answer = askPaper(text, state, { now: new Date() })
    commit((s) => {
      recordInteraction(s, {
        role: 'paper',
        text: answer.text,
        intent: answer.intent,
        source: 'local',
        findings: answer.findings || [],
        sections: answer.sections || [],
        actions: answer.actions || [],
      })
    }, { silent: true })
  }
  pending = false
  renderPaper()
}

/** The optional external model — explicitly requested, honestly labelled. */
async function askExternal(text) {
  try {
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system: AI_SYSTEM_PROMPT,
        context: buildAiContext(state, { todayKey: currentDayKey() }),
        messages: trimHistory([{ role: 'user', text }, ...(state.paper?.history || []).filter((m) => m.source === 'external').map((m) => ({ role: m.role === 'user' ? 'user' : 'model', text: m.text }))], 12),
      }),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) throw Object.assign(new Error('ai-failed'), { status: response.status, payload: data })
    const reply = String(data?.text || '').trim()
    if (!reply) throw Object.assign(new Error('empty'), { status: 502 })
    commit((s) => recordInteraction(s, { role: 'paper', text: reply.slice(0, 12000), source: 'external' }), { silent: true })
  } catch (error) {
    lastError = friendlyAiError(error?.status ?? 0, error?.payload)
    commit((s) => recordInteraction(s, { role: 'paper', text: lastError, source: 'external', error: true }), { silent: true })
    toast('The external model is unavailable. PAPER’s local analysis still works.', 'info')
  }
}

/** Confirmation before any prepared action touches the workspace. */
function confirmPreparedAction(index) {
  const descriptor = pendingActions[index]
  if (!descriptor) return
  openModal({
    title: 'Confirm this change.',
    body: `
      <div class="notice">${icon('shield')}<span>PAPER prepared this from your workspace. Nothing has been changed yet.</span></div>
      <div class="next-action-detail"><span class="eyebrow">${escapeHtml(descriptor.kind.replace(/_/g, ' '))}</span><h2>${escapeHtml(descriptor.title)}</h2><p>${escapeHtml(describeAction(descriptor))}</p></div>
      <div class="form-footer">
        <button class="btn-ghost" data-modal-close>Cancel</button>
        <button class="btn-primary" data-paper-confirm>${icon('check')}Confirm and apply</button>
      </div>`,
    onMount: (box) => {
      box.querySelector('[data-paper-confirm]')?.addEventListener('click', () => {
        let result = { ok: false, summary: 'Nothing was changed.' }
        commit((s) => { result = executeAction(s, descriptor, {}) })
        closeModal()
        toast(result.ok ? result.summary : (result.error || 'Nothing was changed.'), result.ok ? 'success' : 'error')
        if (result.ok) window.CC.refreshAll()
      })
    },
  })
}

/* -------------------------------------------------------------- local tools */

export function runLocalCommand(id) {
  if (id === 'plan') { window.CC.openDayPlanner(); return }
  if (id === 'recover') { window.CC.openRecoveryModal(); return }
  if (id === 'review') { window.CC.switchView('review'); return }
  if (id === 'next') {
    sendMessage('What should I focus on today?')
  }
}

/** Kept for compatibility with the command palette and keyboard layer. */
export function askPaperView(text) {
  const section = document.getElementById('view-paper')
  const alreadyOpen = section && !section.classList.contains('hidden')
  if (!alreadyOpen) window.CC.switchView('paper')
  draft = text
  sendMessage(text)
}

export function paperExamplePrompts() {
  return examplePrompts()
}

/** Exposed for the settings page: what PAPER would see right now. */
export function paperContextPreview() {
  const ctx = buildWorkspaceContext(state, { now: new Date() })
  return {
    missions: ctx.openTasks.length,
    goals: ctx.goals.length,
    projects: ctx.projects.length,
    recordedDays: ctx.daysOfData.completions,
    narrative: `${ctx.openTasks.length} open missions · ${ctx.goals.length} goals · ${ctx.daysOfData.completions} recorded days`,
  }
}
