/* -------------------------------------------------------------------------
   SETTINGS — reminders, protected time, data backup/restore, AI status
   Plus: Profile — My Private Titles (Discipline Monster)
   ------------------------------------------------------------------------- */

import { BREAK_PRESETS, FOCUS_PRESETS, STATE_VERSION } from '../lib/defaults.js'
import { buildExport, describeImport, exportFilename, validateImport } from '../lib/backup.js'
import { reminderSummary } from '../lib/reminders.js'
import { describeBlock } from '../lib/protected.js'
import { STORAGE_KEY, storageUsage, uid } from '../lib/state.js'
import { closeModal, confirmDialog, copyText, escapeHtml, openModal, qsa, toast } from '../core/dom.js'
import { commit, currentDayKey, getStatus, replaceState, state, titlesInfo } from '../core/store.js'
import { fieldRow } from './shared.js'
import { formatUnlockDate } from '../lib/achievements.js'

let statusLine = ''
let statusTone = 'text-slate-400'

export function renderSettings() {
  const section = document.getElementById('view-settings')
  if (!section) return
  const settings = state.settings
  const usage = storageUsage()
  const appStatus = getStatus()
  const reminders = settings.reminders
  const titles = titlesInfo(new Date())
  const dm = titles.disciplineMonster

  section.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="section-title">Profile & Settings</h2>
        <p class="section-sub">Personal productivity command center for ${escapeHtml(settings.userName || 'you')} — everything stored locally, private, no social.</p>
      </div>
      <span class="chip">Schema v${STATE_VERSION}</span>
    </div>

    <!-- Profile / Personal -->
    <div class="glass-card p-5 space-y-4">
      <h3 class="section-title text-base flex items-center gap-2"><i class="fa-solid fa-user text-slate-400" aria-hidden="true"></i>Profile</h3>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label class="field-label">Your name</label>
          <input class="input-field" data-setting="userName" value="${escapeHtml(settings.userName)}">
        </div>
        <div>
          <label class="field-label">Week starts on</label>
          <select class="input-field" data-setting="weekStart">
            <option value="1" ${settings.weekStart === 1 ? 'selected' : ''}>Monday</option>
            <option value="0" ${settings.weekStart === 0 ? 'selected' : ''}>Sunday</option>
          </select>
        </div>
        <div>
          <label class="field-label">Day ends at</label>
          <input type="time" class="input-field" data-setting="dayEnd" value="${settings.dayEnd}">
        </div>
      </div>
      <div class="divide-y divide-white/5">
        ${fieldRow('Tasks', String(state.tasks.length))}
        ${fieldRow('Focus sessions', String(state.focus.sessions.length))}
        ${fieldRow('Tracked days', String(Object.keys(state.completionLog || {}).length))}
        ${fieldRow('Perfect days', String(dm.streakInfo.totalPerfect))}
        ${fieldRow('Best perfect streak', `${dm.best} days`)}
        ${fieldRow('Storage used', `${usage.kb} kB`, `key: ${STORAGE_KEY}`)}
        ${fieldRow('Last migration', appStatus.migrated ? `Upgraded on this load (${appStatus.applied?.join(', ') || 'v→v'})` : 'Not needed')}
      </div>
    </div>

    <!-- MY TITLES — Private -->
    <div class="glass-card p-5 space-y-5">
      <div class="flex items-center justify-between gap-3">
        <h3 class="section-title text-base flex items-center gap-2"><i class="fa-solid fa-crown text-accent-4" aria-hidden="true"></i>MY TITLES</h3>
        <span class="section-eyebrow">Private · Local only</span>
      </div>

      <div class="title-grid">
        ${titleCardHtml(dm)}
      </div>

      <div class="border-t border-white/5 pt-5">
        <h4 class="text-[11px] uppercase tracking-wider font-bold text-slate-500 mb-3">Locked Titles — Coming Soon</h4>
        <div class="title-grid locked">
          ${lockedFutureTitlesHtml()}
        </div>
      </div>

      <p class="text-[11.5px] text-slate-500 leading-relaxed">
        Titles are personal rewards stored only in your browser. No public profile, no leaderboard, no sharing.
        <br>Future titles: Focus Beast, Consistency King, Task Slayer, Deep Work Beast, 30 Day Machine.
      </p>
    </div>

    <!-- AI -->
    <div class="glass-card p-5 space-y-3">
      <h3 class="section-title text-base flex items-center gap-2"><i class="fa-solid fa-shield-halved text-emerald-400" aria-hidden="true"></i>Gemini Assistant</h3>
      <p class="text-[13px] text-slate-400">The assistant runs through your Cloudflare Worker (<code class="text-accent-2">/api/ai</code>). The API key is a Worker secret and never reaches the browser — nothing is stored in this page.</p>
      <div class="flex flex-wrap items-center gap-3">
        <button class="btn-ghost" data-action="test-ai"><i class="fa-solid fa-plug mr-1.5"></i>Test connection</button>
        <span class="text-[12.5px] ${statusTone}" data-ai-status>${escapeHtml(statusLine || 'Not tested yet.')}</span>
      </div>
      <p class="text-[12px] text-slate-500">Requests are small: a compact snapshot of today's plan, priorities, focus time and score. AI is only called when you ask.</p>
    </div>

    <!-- Focus -->
    <div class="glass-card p-5 space-y-4">
      <h3 class="section-title text-base flex items-center gap-2"><i class="fa-solid fa-stopwatch text-slate-400" aria-hidden="true"></i>Focus Mode</h3>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label class="field-label">Default session</label>
          <select class="input-field" data-setting="focus.defaultMinutes">
            ${[...new Set([...FOCUS_PRESETS, settings.focus.defaultMinutes])].sort((a, b) => a - b).map((m) => `<option value="${m}" ${settings.focus.defaultMinutes === m ? 'selected' : ''}>${m} min</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="field-label">Break length</label>
          <select class="input-field" data-setting="focus.breakMinutes">
            ${[...new Set([...BREAK_PRESETS, settings.focus.breakMinutes])].sort((a, b) => a - b).map((m) => `<option value="${m}" ${settings.focus.breakMinutes === m ? 'selected' : ''}>${m} min</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="field-label">Daily focus target</label>
          <input type="number" min="30" step="15" class="input-field" data-setting="focus.targetMinutes" value="${settings.focus.targetMinutes}">
        </div>
      </div>
      <label class="flex items-center gap-3 text-[13.5px] text-slate-200">
        <input type="checkbox" data-setting="focus.autoCompleteTask" ${settings.focus.autoCompleteTask ? 'checked' : ''} class="rounded border-white/20 bg-base-800">
        Completing a focus session marks its task done
      </label>
      <p class="text-[12px] text-slate-500">${fieldRow('Focused today', `${state.focus.sessions.filter((s) => s.date === currentDayKey()).reduce((sum, s) => sum + s.focusedSeconds, 0) / 60 | 0} min`)}</p>
    </div>

    <!-- Reminders -->
    <div class="glass-card p-5 space-y-4">
      <h3 class="section-title text-base flex items-center gap-2"><i class="fa-solid fa-bell text-slate-400" aria-hidden="true"></i>Reminders</h3>
      <label class="flex items-center gap-3 text-[13.5px] text-slate-200">
        <input type="checkbox" data-setting="reminders.enabled" ${reminders.enabled ? 'checked' : ''} class="rounded border-white/20 bg-base-800">
        Enable reminders
      </label>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label class="flex items-center gap-3 text-[13px] text-slate-300">
          <input type="checkbox" data-setting="reminders.timetable" ${reminders.timetable ? 'checked' : ''} class="rounded border-white/20 bg-base-800">
          Timetable blocks
        </label>
        <label class="flex items-center gap-3 text-[13px] text-slate-300">
          <input type="checkbox" data-setting="reminders.taskDue" ${reminders.taskDue ? 'checked' : ''} class="rounded border-white/20 bg-base-800">
          Timed tasks
        </label>
        <label class="flex items-center gap-3 text-[13px] text-slate-300">
          <input type="checkbox" data-setting="reminders.overdue" ${reminders.overdue ? 'checked' : ''} class="rounded border-white/20 bg-base-800">
          Overdue summary
        </label>
        <label class="flex items-center gap-3 text-[13px] text-slate-300">
          <input type="checkbox" data-setting="reminders.respectProtectedTime" ${reminders.respectProtectedTime ? 'checked' : ''} class="rounded border-white/20 bg-base-800">
          Stay silent during protected time
        </label>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label class="field-label">Warn before (minutes)</label>
          <input type="number" min="1" max="60" class="input-field" data-setting="reminders.beforeMinutes" value="${reminders.beforeMinutes}">
        </div>
        <div>
          <label class="field-label">Top 3 nudge</label>
          <input type="time" class="input-field" data-setting="reminders.top3NudgeAt" value="${reminders.top3NudgeAt || ''}">
        </div>
        <div>
          <label class="field-label">Desktop notifications</label>
          <button class="btn-ghost w-full" data-action="enable-notifications">
            <i class="fa-solid fa-desktop mr-1.5"></i>${'Notification' in window && Notification.permission === 'granted' ? 'Enabled' : 'Enable'}
          </button>
        </div>
      </div>
      <p class="text-[12px] text-slate-500">${escapeHtml(reminderSummary(reminders))} If the browser blocks notifications, reminders appear as in-app toasts instead. No paid service, no spam.</p>
    </div>

    <!-- Protected time -->
    <div class="glass-card p-5 space-y-4">
      <div class="flex items-center justify-between gap-3">
        <h3 class="section-title text-base flex items-center gap-2"><i class="fa-solid fa-moon text-slate-400" aria-hidden="true"></i>Protected Time</h3>
        <button class="btn-ghost !py-1.5 !text-xs" data-action="add-protected"><i class="fa-solid fa-plus mr-1.5"></i>Add window</button>
      </div>
      <p class="text-[13px] text-slate-400">Sleep, meals or any window you do not want scheduled into. Recovery plans skip these windows and the timetable warns about overlaps. This is purely a scheduling feature.</p>
      <div class="space-y-2.5">
        ${settings.protectedTime.length
          ? settings.protectedTime
              .map(
                (block) => `
          <div class="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/5">
            <div class="flex-1 min-w-[140px]">
              <p class="text-[13.5px] text-slate-200 font-semibold">${escapeHtml(block.label)}</p>
              <p class="text-[11.5px] text-slate-500">${escapeHtml(describeBlock(block))}</p>
            </div>
            <button class="icon-btn" data-protected-edit="${escapeHtml(block.id)}" title="Edit"><i class="fa-solid fa-pen text-xs"></i></button>
            <button class="icon-btn" data-protected-delete="${escapeHtml(block.id)}" title="Remove"><i class="fa-solid fa-trash text-xs"></i></button>
          </div>`,
              )
              .join('')
          : '<p class="text-[13px] text-slate-500">No protected windows yet. A common setup is Sleep 23:00 → 06:00.</p>'}
      </div>
      ${settings.protectedTime.length ? '' : '<button class="btn-ghost !py-1.5 !text-xs" data-action="sleep-preset"><i class="fa-solid fa-bed mr-1.5"></i>Add 23:00 → 06:00 sleep window</button>'}
    </div>

    <!-- Categories -->
    <div class="glass-card p-5 space-y-4">
      <div class="flex items-center justify-between gap-3">
        <h3 class="section-title text-base flex items-center gap-2"><i class="fa-solid fa-tags text-slate-400" aria-hidden="true"></i>Categories</h3>
        <button class="btn-ghost !py-1.5 !text-xs" data-action="add-category"><i class="fa-solid fa-plus mr-1.5"></i>Add category</button>
      </div>
      <div class="space-y-2.5">
        ${(state.categories || [])
          .map(
            (cat) => `
          <div class="flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.02] border border-white/5">
            <input type="color" value="${escapeHtml(cat.color)}" class="w-8 h-8 rounded-lg border-none bg-transparent cursor-pointer" data-category-color="${escapeHtml(cat.id)}" aria-label="Colour for ${escapeHtml(cat.name)}">
            <input class="input-field flex-1 !py-1.5" value="${escapeHtml(cat.name)}" data-category-name="${escapeHtml(cat.id)}" aria-label="Name for ${escapeHtml(cat.name)}">
            <span class="text-xs text-slate-500 whitespace-nowrap">${state.timetable.filter((t) => t.cat === cat.id).length} blocks</span>
            <button class="icon-btn" data-category-delete="${escapeHtml(cat.id)}" title="Delete category"><i class="fa-solid fa-trash text-xs"></i></button>
          </div>`,
          )
          .join('')}
      </div>
    </div>

    <!-- Day & data -->
    <div class="glass-card p-5 space-y-4">
      <h3 class="section-title text-base flex items-center gap-2"><i class="fa-solid fa-database text-slate-400" aria-hidden="true"></i>Data & Day</h3>
      <div class="divide-y divide-white/5">
        ${fieldRow('Storage used', `${usage.kb} kB`, `key: ${STORAGE_KEY}`)}
        ${fieldRow('Tasks', String(state.tasks.length))}
        ${fieldRow('Focus sessions', String(state.focus.sessions.length))}
        ${fieldRow('Tracked days', String(Object.keys(state.completionLog || {}).length))}
        ${fieldRow('Daily snapshots', String(Object.keys(state.dailyProgress || {}).length))}
        ${fieldRow('Last migration', appStatus.migrated ? 'Upgraded on this load' : 'Not needed')}
      </div>
      <div class="flex flex-wrap gap-2.5">
        <button class="btn-ghost" data-action="export"><i class="fa-solid fa-download mr-1.5"></i>Export JSON</button>
        <label class="btn-ghost cursor-pointer">
          <i class="fa-solid fa-upload mr-1.5"></i>Import JSON
          <input type="file" accept="application/json,.json" class="hidden" data-import>
        </label>
        <button class="btn-danger-ghost" data-action="reset"><i class="fa-solid fa-trash-can mr-1.5"></i>Reset all data</button>
      </div>
      <p class="text-[12px] text-slate-500">Exports include tasks, timetable, focus history, priorities, reminders, settings and your private titles. Import validates the file, keeps a backup of what you had, and never half-applies a broken file.</p>
    </div>

    <div class="glass-card p-5">
      <h3 class="section-title text-base flex items-center gap-2 mb-2"><i class="fa-solid fa-circle-info text-slate-400"></i>About</h3>
      <p class="text-[13px] text-slate-500 leading-relaxed">
        Command Center v2.3 · Private titles + Discipline Monster · Runs on Cloudflare Workers + Hono with a 100% local-first client.
        Focus sessions, priorities, recurring tasks, reminders, weekly review and analytics all work offline;
        only the AI assistant needs the internet. No backend, no database, no social features — ₹0 cost.
      </p>
    </div>
  `

  bindSettings(section)
}

function titleCardHtml(d) {
  const def = d.definition
  if (d.unlocked) {
    return `
      <div class="title-card is-unlocked">
        <div class="title-card-top">
          <span class="title-card-icon is-unlocked">${escapeHtml(def.icon)}</span>
          <span class="chip chip-warn">UNLOCKED ✓</span>
        </div>
        <h4 class="title-card-name">${escapeHtml(def.name)}</h4>
        <p class="title-card-sub">${escapeHtml(def.subtitle)}</p>
        <div class="title-card-meta">
          <p class="text-[12px] text-slate-300">10 consecutive Perfect Days</p>
          <p class="text-[11px] text-slate-500 mt-1">Current: ${d.current} · Best: ${d.best} days</p>
          ${d.unlockedAt ? `<p class="text-[11px] text-amber-300 mt-2"><i class="fa-solid fa-calendar-check mr-1"></i>Unlocked ${escapeHtml(formatUnlockDate(d.unlockedAt))}</p>` : ''}
        </div>
        <div class="progress-track mt-4 !h-2"><div class="progress-fill discipline-fill" style="width:100%"></div></div>
      </div>
    `
  }

  const pct = Math.round((d.progress / d.total) * 100)
  return `
    <div class="title-card is-locked">
      <div class="title-card-top">
        <span class="title-card-icon" aria-hidden="true">${escapeHtml(def.lockedIcon)}</span>
        <span class="chip">${d.progress} / ${d.total}</span>
      </div>
      <h4 class="title-card-name">${escapeHtml(def.name)}</h4>
      <p class="title-card-sub">${escapeHtml(def.subtitle)}</p>
      <div class="title-card-meta">
        <p class="text-[12px] text-slate-400">${d.progress} / ${d.total} PERFECT DAYS</p>
        <div class="progress-track mt-2 !h-2"><div class="progress-fill discipline-fill" style="width:${pct}%"></div></div>
        <p class="text-[11px] text-slate-500 mt-2">${d.remaining} day${d.remaining === 1 ? '' : 's'} to go · Current streak ${d.current}</p>
        <div class="flex gap-1 mt-3">
          ${d.recent.map((day) => `<span class="streak-dot ${day.perfect ? 'is-perfect' : ''} ${day.isToday ? 'is-today' : ''}" style="background:${day.perfect ? 'var(--color-warning)' : 'rgba(255,255,255,0.07)'}" title="${day.dateKey}"></span>`).join('')}
        </div>
      </div>
    </div>
  `
}

function lockedFutureTitlesHtml() {
  const future = [
    { icon: '🎯', name: 'FOCUS BEAST', sub: 'DEEP WORK MASTER' },
    { icon: '👑', name: 'CONSISTENCY KING', sub: '30 DAY STREAK' },
    { icon: '⚔️', name: 'TASK SLAYER', sub: '100 TASKS CRUSHED' },
    { icon: '🧠', name: 'DEEP WORK BEAST', sub: '50 HOURS FOCUSED' },
    { icon: '🤖', name: '30 DAY MACHINE', sub: 'MONTH OF DISCIPLINE' },
  ]
  return future.map(f => `
    <div class="title-card is-locked is-future">
      <div class="title-card-top">
        <span class="title-card-icon">${escapeHtml(f.icon)}</span>
        <span class="chip">LOCKED</span>
      </div>
      <h4 class="title-card-name">${escapeHtml(f.name)}</h4>
      <p class="title-card-sub">${escapeHtml(f.sub)}</p>
      <p class="text-[11px] text-slate-600 mt-3">Coming soon</p>
    </div>
  `).join('')
}

function bindSettings(section) {
  qsa(section, '[data-setting]').forEach((input) => {
    input.addEventListener('change', () => {
      const path = input.dataset.setting
      const value = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value
      commit((s) => {
        const [group, key] = path.split('.')
        if (key) s.settings[group][key] = value
        else s.settings[group] = value
      })
      toast('Setting saved', 'success')
      if (path.startsWith('reminders')) renderSettings()
    })
  })

  section.querySelector('[data-action="test-ai"]')?.addEventListener('click', testAiConnection)
  section.querySelector('[data-action="enable-notifications"]')?.addEventListener('click', requestNotifications)
  section.querySelector('[data-action="add-protected"]')?.addEventListener('click', () => openProtectedModal())
  section.querySelector('[data-action="sleep-preset"]')?.addEventListener('click', () => {
    commit((s) => {
      s.settings.protectedTime.push({ id: uid(), label: 'Sleep', start: '23:00', end: '06:00', days: [] })
    })
    toast('Sleep window added', 'success')
  })
  qsa(section, '[data-protected-edit]').forEach((btn) => btn.addEventListener('click', () => openProtectedModal(btn.dataset.protectedEdit)))
  qsa(section, '[data-protected-delete]').forEach((btn) =>
    btn.addEventListener('click', () => {
      commit((s) => {
        s.settings.protectedTime = s.settings.protectedTime.filter((b) => b.id !== btn.dataset.protectedDelete)
      })
      toast('Protected window removed', 'info')
    }),
  )
  section.querySelector('[data-action="add-category"]')?.addEventListener('click', () => openCategoryModal())
  qsa(section, '[data-category-color]').forEach((input) =>
    input.addEventListener('change', () => {
      commit((s) => {
        const cat = s.categories.find((c) => c.id === input.dataset.categoryColor)
        if (cat) cat.color = input.value
      })
    }),
  )
  qsa(section, '[data-category-name]').forEach((input) =>
    input.addEventListener('change', () => {
      const name = input.value.trim()
      if (!name) return
      commit((s) => {
        const cat = s.categories.find((c) => c.id === input.dataset.categoryName)
        if (cat) cat.name = name
      })
      toast('Category updated', 'success')
    }),
  )
  qsa(section, '[data-category-delete]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const id = btn.dataset.categoryDelete
      const cat = state.categories.find((c) => c.id === id)
      const used = state.timetable.filter((b) => b.cat === id).length + state.tasks.filter((t) => t.cat === id).length
      const ok = await confirmDialog({
        title: `Delete “${cat?.name || id}”?`,
        message: used ? `${used} item${used === 1 ? '' : 's'} use this category — they become uncategorised.` : 'This category is unused.',
        confirmText: 'Delete',
        danger: true,
      })
      if (!ok) return
      commit((s) => {
        s.categories = s.categories.filter((c) => c.id !== id)
        s.timetable.forEach((b) => {
          if (b.cat === id) b.cat = null
        })
        s.tasks.forEach((t) => {
          if (t.cat === id) t.cat = null
        })
      })
      toast('Category deleted', 'info')
    }),
  )

  section.querySelector('[data-action="export"]')?.addEventListener('click', exportData)
  section.querySelector('[data-import]')?.addEventListener('change', importData)
  section.querySelector('[data-action="reset"]')?.addEventListener('click', resetAllData)
}

async function testAiConnection() {
  const statusEl = document.querySelector('[data-ai-status]')
  if (statusEl) {
    statusEl.textContent = 'Testing…'
    statusEl.className = 'text-[12.5px] text-slate-400'
  }
  try {
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system: 'Reply with the single word OK.', messages: [{ role: 'user', content: 'ping' }] }),
    })
    const data = await response.json().catch(() => null)
    if (response.ok) {
      statusLine = 'Connected — the assistant answered.'
      statusTone = 'text-emerald-400'
      toast('Assistant connected', 'success')
    } else {
      statusLine = data?.error?.message || 'The assistant is not available right now.'
      statusTone = 'text-rose-400'
    }
  } catch {
    statusLine = 'Could not reach the Worker. Check your connection.'
    statusTone = 'text-rose-400'
  }
  if (statusEl) {
    statusEl.textContent = statusLine
    statusEl.className = `text-[12.5px] ${statusTone}`
  }
}

async function requestNotifications() {
  if (!('Notification' in window)) {
    toast('This browser has no notification support — reminders will show as in-app toasts.', 'info')
    return
  }
  let permission = Notification.permission
  if (permission === 'default') permission = await Notification.requestPermission()
  const granted = permission === 'granted'
  commit((s) => {
    s.settings.reminders.desktopNotifications = granted
  })
  toast(granted ? 'Desktop notifications enabled' : 'Notifications blocked — using in-app reminders instead', granted ? 'success' : 'info')
}

export function openProtectedModal(id = null) {
  const block = id ? state.settings.protectedTime.find((b) => b.id === id) : null
  const body = `
    <form id="protected-form" class="space-y-4">
      <div>
        <label class="field-label" for="protected-label">Label</label>
        <input required class="input-field" id="protected-label" value="${block ? escapeHtml(block.label) : ''}" placeholder="e.g. Sleep">
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="field-label" for="protected-start">From</label>
          <input required type="time" class="input-field" id="protected-start" value="${block?.start || '23:00'}">
        </div>
        <div>
          <label class="field-label" for="protected-end">Until</label>
          <input required type="time" class="input-field" id="protected-end" value="${block?.end || '06:00'}">
        </div>
      </div>
      <div>
        <label class="field-label">Applies to</label>
        <div class="flex flex-wrap gap-1.5">
          ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
            .map((label, index) => {
              const active = !block || !block.days.length ? false : block.days.includes(index)
              return `<button type="button" class="day-toggle ${active ? 'day-active' : ''}" data-pday="${index}">${label}</button>`
            })
            .join('')}
        </div>
        <p class="text-[11.5px] text-slate-500 mt-2">Leave every day off to apply the window every day.</p>
      </div>
      <div class="flex gap-3 pt-1">
        <button type="button" class="btn-ghost flex-1" data-modal-close>Cancel</button>
        <button type="submit" class="btn-primary flex-1">${block ? 'Save' : 'Add window'}</button>
      </div>
    </form>`
  openModal({
    title: block ? 'Edit protected window' : 'Add protected window',
    body,
    onMount: (box) => {
      box.querySelectorAll('[data-pday]').forEach((btn) => btn.addEventListener('click', () => btn.classList.toggle('day-active')))
      box.querySelector('#protected-form').addEventListener('submit', (event) => {
        event.preventDefault()
        const payload = {
          label: box.querySelector('#protected-label').value.trim() || 'Protected time',
          start: box.querySelector('#protected-start').value,
          end: box.querySelector('#protected-end').value,
          days: [...box.querySelectorAll('[data-pday].day-active')].map((b) => Number(b.dataset.pday)),
        }
        commit((s) => {
          if (block) {
            const target = s.settings.protectedTime.find((b) => b.id === block.id)
            Object.assign(target, payload)
          } else {
            s.settings.protectedTime.push({ id: uid(), ...payload })
          }
        })
        closeModal()
        toast(block ? 'Protected window updated' : 'Protected window added', 'success')
      })
    },
  })
}

export function openCategoryModal() {
  const body = `
    <form id="category-form" class="space-y-4">
      <div>
        <label class="field-label" for="category-name">Name</label>
        <input required class="input-field" id="category-name" placeholder="e.g. Maths">
      </div>
      <div>
        <label class="field-label" for="category-color">Colour</label>
        <input type="color" id="category-color" value="#5b93e6" class="w-12 h-10 rounded-lg border-none bg-transparent cursor-pointer">
      </div>
      <div class="flex gap-3 pt-1">
        <button type="button" class="btn-ghost flex-1" data-modal-close>Cancel</button>
        <button type="submit" class="btn-primary flex-1">Add category</button>
      </div>
    </form>`
  openModal({
    title: 'New category',
    body,
    onMount: (box) => {
      box.querySelector('#category-form').addEventListener('submit', (event) => {
        event.preventDefault()
        const name = box.querySelector('#category-name').value.trim()
        if (!name) return
        const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}-${Date.now().toString(36).slice(-4)}`
        commit((s) => {
          s.categories.push({ id, name, color: box.querySelector('#category-color').value })
        })
        closeModal()
        toast('Category added', 'success')
      })
    },
  })
}

export async function exportData() {
  const payload = buildExport(state)
  const text = JSON.stringify(payload, null, 2)
  try {
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = exportFilename()
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast('Backup downloaded', 'success')
  } catch {
    const copied = await copyText(text)
    toast(copied ? 'Download blocked — backup copied to the clipboard instead' : 'Could not create the backup file', copied ? 'info' : 'error')
  }
}

export async function importData(event) {
  const file = event?.target?.files?.[0]
  if (!file) return
  let parsed = null
  try {
    parsed = JSON.parse(await file.text())
  } catch {
    toast('That file is not valid JSON', 'error')
    event.target.value = ''
    return
  }
  const result = validateImport(parsed)
  if (!result.ok) {
    toast(result.errors[0] || 'That backup could not be read', 'error')
    event.target.value = ''
    return
  }
  const ok = await confirmDialog({
    title: 'Replace your current data?',
    message: 'The imported backup will become your active data. A copy of your current data is saved first so nothing is lost.',
    details: describeImport(result.summary),
    confirmText: 'Import and replace',
    danger: true,
  })
  if (!ok) {
    event.target.value = ''
    return
  }
  try {
    localStorage.setItem('kcc_backup_pre_import', JSON.stringify(buildExport(state).data))
  } catch {
    /* storage may be full — the import itself still proceeds */
  }
  for (const warning of result.warnings) toast(warning, 'info', { timeout: 6000 })
  replaceState(result.state)
  toast('Backup imported', 'success')
  event.target.value = ''
  window.CC.switchView('dashboard')
}

export async function resetAllData() {
  const first = await confirmDialog({
    title: 'Reset all data?',
    message: 'Every task, timetable block, focus session, priority and setting in this browser will be deleted. This cannot be undone.',
    confirmText: 'Continue',
    danger: true,
  })
  if (!first) return
  const second = await confirmDialog({
    title: 'Really delete everything?',
    message: 'Export a backup first if you might need this data. Type nothing — just confirm to wipe.',
    details: `${state.tasks.length} tasks · ${state.timetable.length} blocks · ${state.focus.sessions.length} focus sessions`,
    confirmText: 'Delete everything',
    danger: true,
  })
  if (!second) return
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
  location.reload()
}
