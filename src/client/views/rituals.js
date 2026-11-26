/* -------------------------------------------------------------------------
   RITUALS — your own rules, kept one tick at a time
   -------------------------------------------------------------------------
   This is the private contract page: a short list of rules you set for
   yourself ("talk less", "brush daily", "no phone for the first hour"), a
   single tick per rule per day, and an honest streak that never punishes a
   rest day or an unfinished morning.

   The page is a ledger, not a dashboard: today's tick list first, then the
   month it belongs to, then the rules themselves. Everything here reads and
   writes through the store, so the same data reaches the calendar, the
   backup and the tests.
   ------------------------------------------------------------------------- */

import { state, commit, currentDayKey } from '../core/store.js'
import { closeModal, confirmDialog, escapeHtml, openModal, qsa, qs, toast } from '../core/dom.js'
import { addDays, weekdayOf } from '../lib/dates.js'
import { uid } from '../lib/state.js'
import {
  RITUAL_SUGGESTIONS,
  RITUAL_TONES,
  RITUAL_TONE_IDS,
  activeRituals,
  daysForPreset,
  isTicked,
  makeRitual,
  normalizeRitual,
  ritualDay,
  ritualHistory,
  ritualOverview,
  ritualStreak,
  ritualSummaryLine,
  streakLabel,
  toneOf,
  toggleTick,
} from '../lib/rituals.js'
import { icon, pageHeading, ring, empty, bindCommon } from '../ui/common.js'

let selectedRitualId = null
let editorOpen = false

/** The context `lib/rituals.js` expects when it mints an id or a timestamp. */
const ritualCtx = () => ({ now: Date.now(), uid })

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function dayLabel(key, today) {
  if (key === today) return 'Today'
  if (key === addDays(today, -1)) return 'Yesterday'
  return new Date(`${key}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function daysCopy(ritual) {
  if (ritual.days.length === 7) return 'Every day'
  if (ritual.days.length === 5 && [0, 1, 2, 3, 4].every((d) => ritual.days.includes(d))) return 'Weekdays'
  if (ritual.days.length === 2 && ritual.days.includes(5) && ritual.days.includes(6)) return 'Weekends'
  return ritual.days.map((d) => WEEKDAY_SHORT[d].slice(0, 2)).join(' · ')
}

/** A single tick control. `label` is used for the accessible name. */
function tickButton(ritual, dayKey, done, extraClass = '') {
  return `<button type="button" class="ritual-tick ${done ? 'is-done' : ''} ${extraClass}"
    data-ritual-tick="${escapeHtml(ritual.id)}"
    aria-pressed="${done}"
    aria-label="${done ? 'Untick' : 'Tick'} ${escapeHtml(ritual.title)} for ${escapeHtml(dayLabel(dayKey, currentDayKey()))}">${icon('check')}</button>`
}

/** The headline ring: today's rules kept. Pure CSS/SVG, dashed like `ring()`. */
function todayRing(day) {
  const pct = day.dueCount ? (day.doneCount / day.dueCount) * 100 : 0
  const dashed = 270.18
  return `<div class="ritual-ring ${day.complete ? 'is-complete' : ''}" role="img"
    aria-label="${day.dueCount ? `${day.doneCount} of ${day.dueCount} rules kept today` : 'No rules are set for today'}">
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle class="ring-track" cx="50" cy="50" r="43"/>
      <circle class="ring-value" cx="50" cy="50" r="43" stroke-dasharray="${dashed}" stroke-dashoffset="${dashed * (1 - pct / 100)}"/>
    </svg>
    <div class="ritual-ring-label"><strong>${day.doneCount}${day.dueCount ? `<span style="opacity:.45">/${day.dueCount}</span>` : ''}</strong><small>kept</small></div>
  </div>`
}

/* ------------------------------------------------------------- the ledger */

function ledgerPanel(today) {
  const overview = ritualOverview(state.rituals, today, { days: 400 })
  const day = ritualDay(state.rituals, today)
  const rules = activeRituals(state.rituals).filter((ritual) => ritual.days.includes(weekdayOf(today)))
  const line = ritualSummaryLine(overview, today)
  return `<section class="ritual-ledger" aria-label="Today's rules">
    ${todayRing(day)}
    <div class="ritual-ledger-main">
      <p class="eyebrow ritual-ledger-eyebrow">${icon('sun')}Today · ${escapeHtml(new Date(`${today}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }))}</p>
      <h2>${day.complete ? 'Every rule is kept.' : day.dueCount ? 'Keep the rules you set.' : 'No rules set for today.'}</h2>
      <p class="ritual-ledger-line">${escapeHtml(line)}</p>
      <div class="ritual-ledger-figures">
        <div class="ritual-ledger-figure"><span>Rules</span><strong>${overview.count}</strong></div>
        <div class="ritual-ledger-figure"><span>Combined run</span><strong>${overview.currentRun}d</strong></div>
        <div class="ritual-ledger-figure"><span>Best run</span><strong>${overview.bestRun}d</strong></div>
        <div class="ritual-ledger-figure"><span>Kept · 60 days</span><strong>${overview.rate}%</strong></div>
      </div>
    </div>
    <div class="ritual-ledger-actions">
      <button type="button" class="btn-primary btn-small" data-ritual-new>${icon('plus')}New rule</button>
      <button type="button" class="btn-ghost btn-small" data-ritual-jump="${escapeHtml(today)}">${icon('check')}${rules.length ? `${rules.filter((r) => isTicked(state.rituals, r.id, today)).length} of ${rules.length} ticked` : 'Today'}</button>
    </div>
  </section>`
}

/* -------------------------------------------------------------- the ticks */

function todayPanel(today) {
  const rituals = activeRituals(state.rituals)
  const due = rituals.filter((ritual) => ritual.days.includes(weekdayOf(today)))
  const rest = rituals.filter((ritual) => !ritual.days.includes(weekdayOf(today)))
  const doneCount = due.filter((ritual) => isTicked(state.rituals, ritual.id, today)).length
  return `<section class="rituals-panel" id="ritual-today" aria-label="Tick today's rules">
    <div class="rituals-panel-head">
      <div>
        <h3>Today's ticks</h3>
        <p class="meta">${rituals.length ? `${doneCount} of ${due.length} kept · tick the ones you actually did` : 'Your rules will appear here each morning.'}</p>
      </div>
      <button type="button" class="btn-ghost" data-ritual-new>${icon('plus')}Add</button>
    </div>
    ${rituals.length ? `<div class="ritual-list">${due.length ? due.map((ritual) => tickRow(ritual, today)).join('') : `<p class="ritual-quiet">Nothing is asked of you today. A rest day is part of the practice.</p>`}</div>` : ''}
    ${rest.length ? `<div class="ritual-list" style="margin-top:10px">
      ${rest.map((ritual) => `<p class="ritual-quiet" style="padding:0 2px">${escapeHtml(ritual.title)} · ${escapeHtml(daysCopy(ritual))} — not today.</p>`).join('')}
    </div>` : ''}
    ${!rituals.length ? ritualEmpty() : ''}
  </section>`
}

function tickRow(ritual, today) {
  const done = isTicked(state.rituals, ritual.id, today)
  const streak = ritualStreak(state.rituals, ritual, today)
  const tone = toneOf(ritual.tone)
  const week = ritualHistory(state.rituals, ritual, today, 7)
  return `<article class="ritual-row ${done ? 'is-done' : ''}" data-ritual-row="${escapeHtml(ritual.id)}">
    ${tickButton(ritual, today, done)}
    <div class="ritual-body">
      <p class="ritual-title">${escapeHtml(ritual.title)}</p>
      <div class="ritual-sub">
        <span class="ritual-tone">${icon(tone.icon)}${escapeHtml(tone.label)}</span>
        <span class="ritual-sep" aria-hidden="true">·</span>
        <span>${escapeHtml(daysCopy(ritual))}</span>
        ${ritual.note ? `<span class="ritual-sep" aria-hidden="true">·</span><span class="ritual-note">${escapeHtml(ritual.note)}</span>` : ''}
      </div>
      <div class="ritual-week" aria-hidden="true">${week.map((row) => `<i class="${row.due ? (row.done ? 'kept' : '') : 'rest'}" title="${row.dateKey}"></i>`).join('')}</div>
    </div>
    <div class="ritual-row-end">
      <div class="ritual-streak ${streak.current >= 3 ? 'is-hot' : ''}" title="${escapeHtml(streakLabel(streak))}">
        ${icon('bolt')}
        <strong>${streak.current}</strong><span>day${streak.current === 1 ? '' : 's'}</span>
      </div>
      <div class="ritual-streak-actions">
        <button type="button" class="icon-btn" data-ritual-detail="${escapeHtml(ritual.id)}" aria-label="Open ${escapeHtml(ritual.title)} history">${icon('analytics')}</button>
        <button type="button" class="icon-btn" data-ritual-edit="${escapeHtml(ritual.id)}" aria-label="Edit ${escapeHtml(ritual.title)}">${icon('edit')}</button>
      </div>
    </div>
  </article>`
}

/* ---------------------------------------------------------- month + week */

function heatmapPanel(today) {
  const overview = ritualOverview(state.rituals, today, { days: 90, recentDays: 42 })
  const rows = overview.perDay
  if (!rows.length) return ''
  // pad the front so the grid starts on a Monday column
  const lead = weekdayOf(rows[0].dateKey)
  const pad = (lead + 6) % 7
  const cells = [...Array(pad).fill(null), ...rows]
  const weeks = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  const lastPerfect = overview.lastPerfect ? dayLabel(overview.lastPerfect, today) : '—'
  return `<section class="rituals-panel" aria-label="Your last six weeks">
    <div class="rituals-panel-head">
      <div>
        <h3>The last six weeks</h3>
        <p class="meta">${overview.perfectToday ? 'Every rule kept today.' : `Last perfectly kept day · ${escapeHtml(lastPerfect)}`}</p>
      </div>
      <span class="chip chip-accent">${overview.rate}% kept</span>
    </div>
    <div class="ritual-heatmap">
      <div class="ritual-heatmap-weeks" role="img" aria-label="A day-by-day record of the last six weeks">
        ${weeks
          .map(
            (week) => `<div class="ritual-heat-week">${week
              .map((row) => {
                if (!row) return `<span class="ritual-heat-day" style="opacity:0" aria-hidden="true"></span>`
                const cls = row.empty
                  ? 'is-rest'
                  : row.perfect
                    ? 'is-perfect'
                    : row.done > 0
                      ? 'is-partial'
                      : ''
                return `<span class="ritual-heat-day ${cls} ${row.dateKey === today ? 'is-today' : ''}" title="${row.dateKey} · ${row.empty ? 'nothing asked' : `${row.done}/${row.due} kept`}" role="presentation"></span>`
              })
              .join('')}</div>`,
          )
          .join('')}
      </div>
      <div class="ritual-heatmap-foot">
        <span>${escapeHtml(rows[0] ? dayLabel(rows[0].dateKey, today) : '')} → today</span>
        <span class="ritual-heat-key"><i style="background:rgba(240,229,211,.09)"></i>nothing asked <i style="background:rgba(192,138,78,.34)"></i>partial <i style="background:var(--accent-paper)"></i>kept</span>
      </div>
    </div>
  </section>`
}

function weekPanel(today) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6))
  const rituals = activeRituals(state.rituals)
  return `<section class="rituals-panel" aria-label="This week">
    <div class="rituals-panel-head">
      <div>
        <h3>This week</h3>
        <p class="meta">Every rule, day by day. Today is open until the day ends.</p>
      </div>
    </div>
    <div class="ritual-weekstrip">
      ${days
        .map((key) => {
          const day = ritualDay(state.rituals, key, rituals)
          const pct = day.dueCount ? Math.round((day.doneCount / day.dueCount) * 100) : 0
          return `<div class="ritual-weekstrip-day ${key === today ? 'is-today' : ''} ${day.complete ? 'is-perfect' : ''}" title="${key} · ${day.doneCount}/${day.dueCount} kept">
            <span>${key === today ? 'Today' : WEEKDAY_SHORT[weekdayOf(key)].slice(0, 2)}</span>
            <strong>${day.dueCount ? `${day.doneCount}/${day.dueCount}` : '—'}</strong>
            <i aria-hidden="true"><b style="width:${pct}%"></b></i>
          </div>`
        })
        .join('')}
    </div>
  </section>`
}

/* ---------------------------------------------------------- the rule list */

function rulesPanel(today) {
  const rituals = activeRituals(state.rituals)
  if (!rituals.length) return ''
  const scored = rituals.map((ritual) => ({ ritual, streak: ritualStreak(state.rituals, ritual, today) }))
  const ordered = [...scored].sort((a, b) => b.streak.current - a.streak.current || b.streak.best - a.streak.best)
  return `<section class="rituals-panel" aria-label="Your rules and their streaks">
    <div class="rituals-panel-head">
      <div>
        <h3>Your rules</h3>
        <p class="meta">${rituals.length} rule${rituals.length === 1 ? '' : 's'} · best consecutive run for each</p>
      </div>
      <button type="button" class="btn-ghost" data-ritual-new>${icon('plus')}New</button>
    </div>
    <div class="ritual-shelf">
      ${ordered.map(({ ritual, streak }) => `<div class="ritual-shelf-row">
        <span><button type="button" class="text-button" style="font-size:11.5px;color:inherit;padding:0" data-ritual-detail="${escapeHtml(ritual.id)}">${escapeHtml(ritual.title)}</button></span>
        <em>now ${streak.current} · best ${streak.best}</em>
        <strong>${streak.current}d</strong>
      </div>`).join('')}
    </div>
  </section>`
}

/* ----------------------------------------------------------------- editor */

function ritualEmpty() {
  return `<div class="ritual-empty">
    <span class="ritual-empty-mark">${icon('leaf')}</span>
    <h3>One rule is enough to begin.</h3>
    <p>Talk less. Brush twice. No phone for the first hour. Name the smallest rule you will actually keep, and tick it when you do.</p>
    <button type="button" class="btn-primary" data-ritual-new>${icon('plus')}Write your first rule</button>
  </div>`
}

function suggestionChips() {
  return `<div class="ritual-preset-list">${RITUAL_SUGGESTIONS.map((s) => `<button type="button" class="ritual-preset" data-ritual-preset="${escapeHtml(s.title)}" data-ritual-preset-tone="${escapeHtml(s.tone)}" data-ritual-preset-days="${escapeHtml(s.days)}">${escapeHtml(s.title)}</button>`).join('')}</div>`
}

/** The "something of your own" editor, used both inline and from a modal. */
function editorFields(ritual = null) {
  const tone = ritual?.tone || 'custom'
  const days = ritual ? [...ritual.days] : [...daysForPreset('every')]
  return `<div class="ritual-editor" data-ritual-editor>
    <div>
      <label class="field-label" for="ritual-title">Your rule <span>· short and specific works best</span></label>
      <input class="input-field" id="ritual-title" maxlength="80" required
        placeholder="Talk less than I usually do" value="${escapeHtml(ritual?.title || '')}" autocomplete="off">
    </div>
    <div>
      <label class="field-label" for="ritual-note">A note to yourself <span>· optional</span></label>
      <input class="input-field" id="ritual-note" maxlength="160"
        placeholder="Count to three before replying" value="${escapeHtml(ritual?.note || '')}">
    </div>
    <div>
      <p class="field-label">What kind of rule is this?</p>
      <div class="ritual-tone-picker" role="group" aria-label="Rule kind">
        ${RITUAL_TONES.map((item) => `<button type="button" class="ritual-tone-btn ${item.id === tone ? 'is-active' : ''}" data-ritual-tone="${item.id}" aria-pressed="${item.id === tone}" title="${escapeHtml(item.hint)}">
          ${icon(item.icon)}${escapeHtml(item.label)}
        </button>`).join('')}
      </div>
    </div>
    <div>
      <p class="field-label">Which days is it asked for?</p>
      <div class="flex flex-wrap items-center gap-2">
        ${['every', 'weekdays', 'weekend', 'custom'].map((preset) => `<button type="button" class="ritual-preset ${daysPresetActive(preset, days) ? 'is-active' : ''}" data-ritual-days-preset="${preset}" aria-pressed="${daysPresetActive(preset, days)}">${preset === 'every' ? 'Every day' : preset === 'weekdays' ? 'Weekdays' : preset === 'weekend' ? 'Weekends' : 'Choose days'}</button>`).join('')}
      </div>
      <div class="flex flex-wrap gap-2" style="margin-top:10px" data-ritual-day-picker ${daysPresetActive('every', days) ? 'hidden' : ''}>
        ${[0, 1, 2, 3, 4, 5, 6].map((d) => `<button type="button" class="day-toggle ${days.includes(d) ? 'day-active' : ''}" data-ritual-day="${d}" aria-pressed="${days.includes(d)}" aria-label="${WEEKDAY_LONG[d]}">${WEEKDAY_LONG[d].slice(0, 2)}</button>`).join('')}
      </div>
    </div>
    <div class="ritual-preview ${ritual?.title ? '' : 'is-empty'}" data-ritual-preview>
      ${ritual?.title ? `<span class="ritual-tick is-done" aria-hidden="true">${icon('check')}</span><span>${escapeHtml(ritual.title)}</span>` : 'Your rule will preview here as you type.'}
    </div>
    <div>
      <p class="field-label">Or start from one of these</p>
      ${suggestionChips()}
    </div>
  </div>`
}

function daysPresetActive(preset, days) {
  if (preset === 'every') return days.length === 7
  if (preset === 'weekdays') return days.length === 5 && [0, 1, 2, 3, 4].every((d) => days.includes(d))
  if (preset === 'weekend') return days.length === 2 && days.includes(5) && days.includes(6)
  return days.length !== 7 && !(days.length === 5 && [0, 1, 2, 3, 4].every((d) => days.includes(d))) && !(days.length === 2 && days.includes(5) && days.includes(6))
}

/** Wire the live preview, tone buttons, day presets and day toggles. */
function bindEditor(root, options = {}) {
  const onChange = typeof options.onChange === 'function' ? options.onChange : null
  const box = root.querySelector('[data-ritual-editor]') || root
  const titleInput = /** @type {HTMLInputElement|null} */ (box.querySelector('#ritual-title'))
  const preview = box.querySelector('[data-ritual-preview]')
  const dayPicker = box.querySelector('[data-ritual-day-picker]')
  const refreshPreview = () => {
    if (!preview) return
    const value = (titleInput?.value || '').trim()
    preview.classList.toggle('is-empty', !value)
    preview.innerHTML = value
      ? `<span class="ritual-tick is-done" aria-hidden="true">${icon('check')}</span><span>${escapeHtml(value)}</span>`
      : 'Your rule will preview here as you type.'
    onChange?.()
  }
  titleInput?.addEventListener('input', refreshPreview)

  qsa(box, '[data-ritual-tone]').forEach((button) =>
    button.addEventListener('click', () => {
      qsa(box, '[data-ritual-tone]').forEach((node) => {
        const active = node === button
        node.classList.toggle('is-active', active)
        node.setAttribute('aria-pressed', String(active))
      })
      onChange?.()
    }),
  )

  qsa(box, '[data-ritual-days-preset]').forEach((button) =>
    button.addEventListener('click', () => {
      const preset = button.dataset.ritualDaysPreset
      qsa(box, '[data-ritual-days-preset]').forEach((node) => {
        const active = node === button
        node.classList.toggle('is-active', active)
        node.setAttribute('aria-pressed', String(active))
      })
      const chosen = preset === 'custom' ? [...daysForPreset('every')] : daysForPreset(preset)
      if (dayPicker) {
        dayPicker.hidden = preset === 'every'
        qsa(dayPicker, '[data-ritual-day]').forEach((day) => {
          const active = chosen.includes(Number(day.dataset.ritualDay))
          day.classList.toggle('day-active', active)
          day.setAttribute('aria-pressed', String(active))
        })
      }
      onChange?.()
    }),
  )

  qsa(box, '[data-ritual-day]').forEach((button) =>
    button.addEventListener('click', () => {
      button.classList.toggle('day-active')
      button.setAttribute('aria-pressed', String(button.classList.contains('day-active')))
      // toggling an individual day means "choose days"
      qsa(box, '[data-ritual-days-preset]').forEach((node) => {
        const custom = node.dataset.ritualDaysPreset === 'custom'
        node.classList.toggle('is-active', custom)
        node.setAttribute('aria-pressed', String(custom))
      })
      if (dayPicker) dayPicker.hidden = false
      onChange?.()
    }),
  )

  qsa(box, '[data-ritual-preset]').forEach((button) =>
    button.addEventListener('click', () => {
      if (titleInput) titleInput.value = button.dataset.ritualPreset || ''
      const tone = button.dataset.ritualPresetTone
      qsa(box, '[data-ritual-tone]').forEach((node) => {
        const active = node.dataset.ritualTone === tone
        node.classList.toggle('is-active', active)
        node.setAttribute('aria-pressed', String(active))
      })
      const presetDays = button.dataset.ritualPresetDays
      const chosen = daysForPreset(presetDays)
      qsa(box, '[data-ritual-days-preset]').forEach((node) => {
        const active = daysPresetActive(node.dataset.ritualDaysPreset, chosen)
        node.classList.toggle('is-active', active)
        node.setAttribute('aria-pressed', String(active))
      })
      if (dayPicker) {
        dayPicker.hidden = false
        qsa(dayPicker, '[data-ritual-day]').forEach((day) => {
          const active = chosen.includes(Number(day.dataset.ritualDay))
          day.classList.toggle('day-active', active)
          day.setAttribute('aria-pressed', String(active))
        })
      }
      refreshPreview()
      titleInput?.focus()
    }),
  )

  return {
    /** Read the form's current values as a ritual payload. */
    read() {
      const title = (titleInput?.value || '').trim()
      const note = /** @type {HTMLInputElement|null} */ (box.querySelector('#ritual-note'))?.value || ''
      const activeTone = box.querySelector('[data-ritual-tone].is-active')?.dataset.ritualTone || 'custom'
      const days = dayPicker && !dayPicker.hidden
        ? qsa(dayPicker, '[data-ritual-day].day-active').map((node) => Number(node.dataset.ritualDay))
        : [...daysForPreset('every')]
      return {
        title,
        note,
        tone: RITUAL_TONE_IDS.includes(activeTone) ? activeTone : 'custom',
        days: days.length ? days : [...daysForPreset('every')],
      }
    },
  }
}

/* --------------------------------------------------------------- actions */

function openRitualEditor(id = null) {
  const ritual = state.rituals?.rituals?.find((item) => item.id === id) || null
  openModal({
    title: ritual ? 'Edit this rule' : 'Write a rule for yourself',
    body: `<form id="ritual-form" class="form-stack">
      ${editorFields(ritual)}
      <p class="form-hint">${icon('shield')} Rules and ticks stay on this device. A rest day is not a debt.</p>
      <div class="form-footer">
        ${ritual ? `<button type="button" class="btn-ghost" data-ritual-archive>Archive</button>` : ''}
        <button type="button" class="btn-ghost" data-modal-close>Cancel</button>
        <button type="submit" class="btn-primary">${ritual ? 'Save rule' : 'Begin this rule'}</button>
      </div>
    </form>`,
    size: 'modal-wide',
    onMount: (box) => {
      const handle = bindEditor(box)
      box.querySelector('#ritual-form')?.addEventListener('submit', (event) => {
        event.preventDefault()
        const values = handle.read()
        if (!values.title) {
          toast('Give the rule a name first — even three words is enough.', 'error')
          const titleField = /** @type {any} */ (box.querySelector('#ritual-title'))
          if (titleField && typeof titleField.focus === 'function') titleField.focus()
          return
        }
        commit((draft) => {
          if (!draft.rituals) draft.rituals = { rituals: [], log: {} }
          if (ritual) {
            const target = draft.rituals.rituals.find((item) => item.id === ritual.id)
            if (target) Object.assign(target, normalizeRitual({ ...target, ...values, editedAt: Date.now() }, { now: Date.now(), uid: () => target.id }))
          } else {
            const created = makeRitual(values, ritualCtx())
            if (created) draft.rituals.rituals.push(created)
          }
        })
        closeModal()
        toast(ritual ? 'Rule updated. Your history is untouched.' : 'A new rule. Tick it tonight if you keep it.', 'success')
        editorOpen = false
      })
      box.querySelector('[data-ritual-archive]')?.addEventListener('click', async () => {
        if (!ritual) return
        const ok = await confirmDialog({
          title: 'Archive this rule?',
          message: `“${ritual.title}” will stop appearing each day. Every tick you recorded stays in its history, and the rule can be restored by asking again.`,
          confirmText: 'Archive the rule',
          cancelText: 'Keep it',
          danger: true,
        })
        if (!ok) return
        commit((draft) => {
          const target = draft.rituals?.rituals?.find((item) => item.id === ritual.id)
          if (target) target.archived = true
        })
        closeModal()
        toast('Rule archived. The days you kept it are still yours.', 'info')
      })
    },
  })
}

function openRitualDetail(id) {
  const ritual = state.rituals?.rituals?.find((item) => item.id === id)
  if (!ritual) return
  const today = currentDayKey()
  const streak = ritualStreak(state.rituals, ritual, today)
  const history = ritualHistory(state.rituals, ritual, today, 35).slice().reverse()
  const tone = toneOf(ritual.tone)
  openModal({
    title: escapeHtml(ritual.title),
    body: `<div class="ritual-detail">
      <div class="ritual-detail-head">
        <span class="ritual-detail-mark">${icon(tone.icon)}</span>
        <div>
          <p class="eyebrow" style="margin:0 0 3px">${escapeHtml(tone.label)} · ${escapeHtml(daysCopy(ritual))}</p>
          <p class="meta" style="margin:0">${escapeHtml(ritual.note || 'No note — the rule speaks for itself.')}</p>
        </div>
      </div>
      <div class="ritual-detail-figures">
        <div class="ritual-detail-figure"><span>Current run</span><strong>${streak.current} days</strong></div>
        <div class="ritual-detail-figure"><span>Best run</span><strong>${streak.best} days</strong></div>
        <div class="ritual-detail-figure"><span>Kept · 60 days</span><strong>${streak.rate}%</strong></div>
        <div class="ritual-detail-figure"><span>This week</span><strong>${streak.weekDone}/${streak.weekDue}</strong></div>
      </div>
      <p class="meta" style="margin:0 0 10px">${escapeHtml(streakLabel(streak))}${streak.todayDue ? ' · today counts the moment you tick it' : ''}</p>
      <div class="ritual-detail-ledger" role="list" aria-label="Recent history">
        ${history
          .map((row) => `<div class="ritual-detail-day" role="listitem">
            <span>${escapeHtml(dayLabel(row.dateKey, today))}</span>
            <span>${row.due ? (row.done ? `<span class="ritual-dot is-kept" aria-hidden="true"></span> Kept` : `<span class="ritual-dot is-missed" aria-hidden="true"></span> Not ticked`) : `<span class="ritual-dot" aria-hidden="true"></span> Rest day`}</span>
            <strong>${row.due ? (row.done ? '✓' : '—') : ''}</strong>
          </div>`)
          .join('')}
      </div>
      <div class="form-footer">
        <button type="button" class="btn-ghost" data-ritual-tick-modal="${escapeHtml(ritual.id)}">${isTicked(state.rituals, ritual.id, today) ? 'Untick today' : 'Tick today'}</button>
        <button type="button" class="btn-ghost" data-ritual-edit="${escapeHtml(ritual.id)}">Edit rule</button>
        <button type="button" class="btn-primary" data-modal-close>Close</button>
      </div>
    </div>`,
    onMount: (box) => {
      box.querySelector('[data-ritual-edit]')?.addEventListener('click', () => {
        closeModal()
        setTimeout(() => openRitualEditor(ritual.id), 60)
      })
      box.querySelector('[data-ritual-tick-modal]')?.addEventListener('click', () => {
        const nowDone = commitTick(ritual, today)
        closeModal()
        toast(nowDone ? 'Kept. That is a day added to the run.' : 'Tick removed. Today is open again.', nowDone ? 'success' : 'info')
      })
    },
  })
}

/** Toggle a title on today from the ledger's right-hand button. */
function commitTick(ritual, dayKey) {
  let result = false
  commit((draft) => {
    result = toggleTick(draft, ritual.id, dayKey)
  })
  return result
}

/* --------------------------------------------------------------- render */

export function renderRituals() {
  /** @type {any} */ const section = document.getElementById('view-rituals')
  if (!section) return
  const today = currentDayKey()
  const rituals = activeRituals(state.rituals)
  const overview = ritualOverview(state.rituals, today, { days: 400, recentDays: 42 })
  const heroActions = `<button class="btn-primary" type="button" data-ritual-new>${icon('plus')}New rule</button><button class="btn-ghost" type="button" data-ritual-days>${icon('calendar')}Which days?</button>`

  section.innerHTML = `
    ${pageHeading(
      'YOUR OWN RULES',
      'The rules you keep.',
      'A private list of the small rules that shape a day — talk less, brush twice, put the phone down. One tick a day is the whole practice.',
      heroActions,
    )}
    <div class="rituals-page">
      ${ledgerPanel(today)}
      <div class="rituals-layout">
        <div class="rituals-stack">
          ${todayPanel(today)}
          ${weekPanel(today)}
          ${rulesPanel(today)}
        </div>
        <div class="rituals-stack">
          ${heatmapPanel(today)}
          <section class="rituals-panel" aria-label="Why this page exists">
            <div class="rituals-panel-head">
              <div>
                <h3>The honest rule</h3>
                <p class="meta">How a streak is counted here</p>
              </div>
              ${icon('leaf')}
            </div>
            <div class="notice" style="margin:0 0 12px">${icon('info')}<span>A streak counts the days you ticked the rule. A rest day is not asked for and cannot break it. An unfinished morning never breaks it either — today stays open until the day ends.</span></div>
            <p class="ritual-quiet">Miss a day? The run starts again at one, but the history stays. Nothing here is a debt, and nothing is invented.</p>
            <div class="ritual-shelf" style="margin-top:8px">
              <div class="ritual-shelf-row"><span>Rules today</span><em>asked for</em><strong>${overview.dueToday}</strong></div>
              <div class="ritual-shelf-row"><span>Ticked today</span><em>kept</em><strong>${overview.doneToday}</strong></div>
              <div class="ritual-shelf-row"><span>Perfect days</span><em>all rules kept</em><strong>${overview.perDay.filter((d) => d.perfect).length}</strong></div>
            </div>
          </section>
        </div>
      </div>
      ${editorOpen ? `<section class="rituals-panel" id="ritual-inline-editor" aria-label="Write a rule">
        <div class="rituals-panel-head">
          <div><h3>Write a rule</h3><p class="meta">Short, specific, and yours.</p></div>
          <button type="button" class="btn-ghost" data-ritual-close-editor>${icon('close')}Close</button>
        </div>
        <form id="ritual-inline-form">${editorFields(null)}<div class="form-footer"><button type="submit" class="btn-primary">${icon('plus')}Begin this rule</button></div></form>
      </section>` : ''}
    </div>`

  bindCommon(section)

  /* --- ticks: optimistic, announced --- */
  qsa(section, '[data-ritual-tick]').forEach((button) =>
    button.addEventListener('click', (event) => {
      event.preventDefault()
      const ritual = state.rituals?.rituals?.find((item) => item.id === button.dataset.ritualTick)
      if (!ritual) return
      const nowDone = commitTick(ritual, today)
      const row = button.closest('.ritual-row')
      button.classList.toggle('is-done', nowDone)
      button.setAttribute('aria-pressed', String(nowDone))
      button.classList.remove('just-ticked')
      void button.offsetWidth
      if (nowDone) button.classList.add('just-ticked')
      row?.classList.toggle('is-done', nowDone)
      if (nowDone) {
        const streak = ritualStreak(state.rituals, ritual, today)
        toast(streak.current <= 1 ? `Kept. ${ritual.title} — day one.` : `Kept. ${ritual.title} — ${streak.current} days in a row.`, 'success')
      }
    }),
  )

  /* --- open / edit / new --- */
  qsa(section, '[data-ritual-detail]').forEach((button) => button.addEventListener('click', () => openRitualDetail(button.dataset.ritualDetail)))
  qsa(section, '[data-ritual-edit]').forEach((button) => button.addEventListener('click', () => openRitualEditor(button.dataset.ritualEdit)))
  qsa(section, '[data-ritual-new]').forEach((button) => button.addEventListener('click', () => openRitualEditor(null)))
  qs(section, '[data-ritual-jump]')?.addEventListener('click', () => {
    /** @type {any} */ const target = section.querySelector('#ritual-today')
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    /** @type {any} */ (target?.querySelector('[data-ritual-tick]'))?.focus()
  })
  qs(section, '[data-ritual-days]')?.addEventListener('click', () => {
    if (rituals.length) openRitualDetail(rituals[0].id)
    else openRitualEditor(null)
  })
  qsa(section, '[data-ritual-close-editor]').forEach((button) =>
    button.addEventListener('click', () => {
      editorOpen = false
      renderRituals()
    }),
  )

  /* --- the inline editor --- */
  const inlineForm = section.querySelector('#ritual-inline-form')
  if (inlineForm) {
    const handle = bindEditor(inlineForm)
    inlineForm.addEventListener('submit', (event) => {
      event.preventDefault()
      const values = handle.read()
      if (!values.title) {
        toast('Give the rule a name first.', 'error')
        return
      }
      commit((draft) => {
        if (!draft.rituals) draft.rituals = { rituals: [], log: {} }
        const created = makeRitual(values, ritualCtx())
        if (created) draft.rituals.rituals.push(created)
      })
      editorOpen = false
      toast('A new rule. Tick it if you keep it tonight.', 'success')
      renderRituals()
    })
  }

  if (selectedRitualId && !state.rituals?.rituals?.some((item) => item.id === selectedRitualId)) selectedRitualId = null
  if (!rituals.length && !editorOpen) {
    // A brand-new user lands on the empty state that already carries the form
    // button; nothing else to bind.
  }
  return section
}

export { openRitualEditor }
