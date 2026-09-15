/* -------------------------------------------------------------------------
   AI ASSISTANT — talks to the Worker (/api/ai), never to Gemini directly.
   The Gemini key stays a server-side secret; the browser only sends a small
   productivity context + the user's message.
   ------------------------------------------------------------------------- */

import { AI_COMMANDS, AI_SYSTEM_PROMPT, buildAiContext, buildCommandPrompt, friendlyAiError, trimHistory } from '../lib/ai-context.js'
import { escapeHtml, openModal, qs, qsa, toast } from '../core/dom.js'
import { commit, currentDayKey, state } from '../core/store.js'
import { categoryName, emptyState } from './shared.js'

let pending = false
let lastError = null

export function renderAssistant() {
  const section = document.getElementById('view-assistant')
  if (!section) return
  const history = state.chatHistory || []

  section.innerHTML = `
    <div class="glass-card flex flex-col h-[calc(100vh-190px)] min-h-[520px]">
      <div class="flex items-center justify-between gap-3 px-5 py-4 border-b border-white/5">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-accent to-accent-2 grid place-items-center shadow-glow">
            <i class="fa-solid fa-robot text-white text-sm"></i>
          </div>
          <div>
            <p class="font-display font-bold text-white text-sm">Productivity Assistant</p>
            <p class="text-[11px] text-slate-400">
              <i class="fa-solid fa-shield-halved text-emerald-400 text-[9px] mr-1"></i>
              Runs through your Cloudflare Worker · key stays server-side
            </p>
          </div>
        </div>
        <button class="btn-ghost !py-1.5 !px-3 text-xs" data-action="clear-chat"><i class="fa-solid fa-broom mr-1.5"></i>Clear</button>
      </div>

      <div class="px-4 py-3 border-b border-white/5">
        <div class="flex flex-wrap gap-2">
          ${AI_COMMANDS.map(
            (c) => `<button class="nav-pill" data-command="${c.id}" title="${escapeHtml(c.prompt.slice(0, 120))}"><i class="fa-solid ${c.icon} mr-1.5"></i>${escapeHtml(c.label)}</button>`,
          ).join('')}
        </div>
      </div>

      <div id="chat-scroll" class="flex-1 overflow-y-auto chat-scroll px-5 py-4 flex flex-col gap-3">
        ${history.length ? history.map(messageHtml).join('') : emptyState({ icon: 'fa-solid fa-comments', title: 'Ask about your day', body: 'Try “Plan My Day” or “Why am I falling behind?” — the assistant sees your tasks, timetable, focus time and score.' })}
        ${pending ? typingBubbleHtml() : ''}
      </div>

      ${lastError ? `<div class="mx-5 mb-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-200 text-[12.5px] flex items-start gap-2.5"><i class="fa-solid fa-circle-exclamation mt-0.5"></i><span>${escapeHtml(lastError)}</span></div>` : ''}

      <div class="px-4 py-3.5 border-t border-white/5">
        <div class="flex items-end gap-2">
          <textarea id="chat-input" rows="1" class="input-field resize-none max-h-28" placeholder="Ask your assistant…" data-chat-input aria-label="Message the assistant" ${pending ? 'disabled' : ''}></textarea>
          <button id="chat-send-btn" class="btn-primary !px-4 !py-3 shrink-0" data-action="send" aria-label="Send message" ${pending ? 'disabled' : ''}><i class="fa-solid ${pending ? 'fa-spinner fa-spin' : 'fa-paper-plane'}"></i></button>
        </div>
        <p class="text-[11px] text-slate-600 mt-2">Enter to send · Shift + Enter for a new line · Only your current productivity data is sent.</p>
      </div>
    </div>
  `

  const scroll = document.getElementById('chat-scroll')
  if (scroll) scroll.scrollTop = scroll.scrollHeight

  section.querySelector('[data-action="send"]')?.addEventListener('click', () => sendMessage())
  section.querySelector('[data-action="clear-chat"]')?.addEventListener('click', () => {
    commit((s) => {
      s.chatHistory = []
    })
    toast('Chat cleared', 'info')
  })
  qsa(section, '[data-command]').forEach((btn) =>
    btn.addEventListener('click', () => runCommand(btn.dataset.command)),
  )
  const input = /** @type {any} */ (qs(section, '#chat-input'))
  if (input) {
    input.addEventListener('keydown', handleChatKey)
    input.addEventListener('input', () => {
      input.style.height = 'auto'
      input.style.height = `${Math.min(input.scrollHeight, 112)}px`
    })
    input.focus()
  }
}

function messageHtml(message) {
  const isUser = message.role === 'user'
  return `<div class="msg-bubble ${isUser ? 'msg-user' : 'msg-ai'}">${escapeHtml(message.text).replace(/\n/g, '<br>')}</div>`
}

function typingBubbleHtml() {
  return `<div class="msg-bubble msg-ai flex items-center gap-1.5" id="typing-indicator"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>`
}

export function handleChatKey(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    sendMessage()
  }
}

async function runCommand(id) {
  const command = AI_COMMANDS.find((c) => c.id === id)
  if (!command) return
  if (!command.needsTask) {
    await sendMessage(buildCommandPrompt(id), { label: command.label })
    return
  }
  const candidates = state.tasks.filter((t) => !t.done && (!t.date || t.date === currentDayKey())).slice(0, 12)
  if (!candidates.length) {
    toast('No open task to break down — add one first.', 'error')
    return
  }
  pickTaskForCommand(command, candidates)
}

/** Ask which task a command should run on (styled modal, not window.prompt). */
function pickTaskForCommand(command, candidates) {
  openModal({
    title: command.label,
    body: `
      <p class="text-[13px] text-slate-400 mb-4">Which task should I break down?</p>
      <div class="flex flex-col gap-2">
        ${candidates.map((t, i) => `
          <button class="task-row text-left w-full" data-pick-task="${escapeHtml(t.id)}">
            <span class="top3-index">${i + 1}</span>
            <span class="flex-1 min-w-0 truncate">${escapeHtml(t.title)}</span>
            <span class="chip">${escapeHtml(categoryName(t.categoryId || t.cat))}</span>
          </button>`).join('')}
      </div>`,
    onMount: (box) => {
      box.querySelectorAll('[data-pick-task]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const task = candidates.find((t) => t.id === btn.dataset.pickTask)
          close()
          if (task) sendMessage(buildCommandPrompt(command.id, { task }), { label: command.label })
        })
      })
    },
  })
}

/** Close the currently open modal (imported lazily to avoid a cycle). */
function close() {
  window.CC?.closeModal()
}

export async function sendMessage(textOverride = null, { label = null } = {}) {
  if (pending) return
  const input = /** @type {any} */ (document.getElementById('chat-input'))
  const text = (textOverride ?? input?.value ?? '').trim()
  if (!text) return

  commit((s) => {
    s.chatHistory.push({ role: 'user', text, ts: Date.now() })
    if (s.chatHistory.length > 60) s.chatHistory = s.chatHistory.slice(-60)
  })
  if (input && !textOverride) {
    input.value = ''
    input.style.height = 'auto'
  }

  pending = true
  lastError = null
  renderAssistant()

  try {
    const payload = {
      system: AI_SYSTEM_PROMPT,
      context: buildAiContext(state, { todayKey: currentDayKey() }),
      messages: trimHistory(state.chatHistory, 12),
    }
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    let data = null
    try {
      data = await response.json()
    } catch {
      data = null
    }
    if (!response.ok) {
      throw Object.assign(new Error('ai-failed'), { status: response.status, payload: data })
    }
    const reply = (data?.text || '').trim() || 'I could not generate a response just now — try rephrasing.'
    commit((s) => {
      s.chatHistory.push({ role: 'model', text: reply, ts: Date.now() })
    })
  } catch (error) {
    const status = error?.status ?? 0
    const message = friendlyAiError(status, error?.payload)
    lastError = message
    commit((s) => {
      s.chatHistory.push({ role: 'model', text: message, ts: Date.now(), error: true })
    })
    toast(label ? `“${label}” failed` : 'Assistant request failed', 'error')
  } finally {
    pending = false
    renderAssistant()
  }
}

export function askAI(text) {
  window.CC.switchView('assistant')
  const input = /** @type {any} */ (document.getElementById('chat-input'))
  if (input) input.value = text
  setTimeout(() => sendMessage(), 60)
}

/** Sidebar/settings helper: shows which categories the assistant knows about. */
export function assistantContextPreview() {
  const context = buildAiContext(state, { todayKey: currentDayKey() })
  return {
    chars: context.length,
    categories: state.categories.map((c) => categoryName(c.id)).join(', '),
    context,
  }
}

