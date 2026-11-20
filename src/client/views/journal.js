/* -------------------------------------------------------------------------
   JOURNAL — one honest entry per day
   -------------------------------------------------------------------------
   A calm, low-pressure record: what happened, one win, one next step, and how
   the day felt. Everything stays on this device like the rest of the app.
   ------------------------------------------------------------------------- */

import { state, currentDayKey, commit } from '../core/store.js'
import { escapeHtml, qsa, toast } from '../core/dom.js'
import { addDays } from '../lib/dates.js'
import { ENERGY_LEVELS, MOODS, entryFor, journalStats, journalSummaryLine, promptFor, saveEntry } from '../lib/journal.js'
import { dayPart } from '../lib/briefing.js'
import { icon, pageHeading, metric, empty, bindCommon } from '../ui/common.js'

let selectedDay = null
const RECENT_DAYS = 7

function dayLabel(key, today) {
  if (key === today) return 'Today'
  if (key === addDays(today, -1)) return 'Yesterday'
  return key.slice(5).replace('-', '/')
}

export function renderJournal() {
  const section = document.getElementById('view-journal')
  if (!section) return
  const today = currentDayKey()
  const key = selectedDay || today
  const entry = entryFor(state, key) || {}
  const stats = journalStats(state.journal, { todayKey: today, days: 30 })
  const part = dayPart(new Date())
  const prompt = promptFor(part, key)
  const recent = Array.from({ length: RECENT_DAYS }, (_, index) => addDays(today, index - (RECENT_DAYS - 1))).reverse()
  const history = stats.written.filter((row) => row.key !== key).slice(-20).reverse()

  section.innerHTML = `
    ${pageHeading(
      'A QUIET RECORD',
      'What actually happened.',
      'One entry a day. No streak to protect, no audience, nothing sent anywhere.',
      `<button class="btn-ghost" data-journal-review>${icon('review')}Weekly review</button>`,
    )}
    <div class="metric-strip journal-metrics">
      ${metric('review', 'Entries', `${stats.count}<small>/30d</small>`, `${stats.consistency}% of the last thirty days`)}
      ${metric('bolt', 'Current streak', `${stats.streak}<small>d</small>`, stats.streak ? 'Consecutive days written' : 'Write one entry to begin')}
      ${metric('leaf', 'Average mood', stats.mood ? escapeHtml(stats.mood.label) : '—', stats.count ? journalSummaryLine(stats) : 'Mood shows once you have a few entries')}
      ${metric('check', 'Wins recorded', `${stats.winsCount}`, stats.lastWin ? escapeHtml(stats.lastWin.slice(0, 48)) : 'One win per entry is enough')}
    </div>
    <div class="journal-layout">
      <article class="card journal-compose">
        <div class="journal-compose-head">
          <div>
            <p class="eyebrow">${key === today ? 'TODAY' : 'LOOKING BACK'}</p>
            <h3>${escapeHtml(dayLabel(key, today))}${key === today ? ` · ${new Date().toLocaleDateString('en-US', { weekday: 'long' })}` : ''}</h3>
            <p class="meta">${escapeHtml(prompt)}</p>
          </div>
          <span class="journal-compose-mark">${icon('edit')}</span>
        </div>
        <div class="journal-day-strip" role="group" aria-label="Choose a day to write about">
          ${recent
            .map((day) => {
              const has = !!state.journal?.[day]
              return `<button class="journal-day ${day === key ? 'is-active' : ''} ${has ? 'has-entry' : ''}" data-journal-day="${day}" aria-pressed="${day === key}" title="${day}${has ? ' · written' : ''}">
              <span>${day === today ? 'Today' : day.slice(8)}</span>
              <i></i>
            </button>`
            })
            .join('')}
        </div>
        <form id="journal-form" class="journal-form">
          <label class="field-label" for="journal-note">What happened <span>· a few honest lines</span></label>
          <textarea class="input-field journal-note" id="journal-note" rows="5" placeholder="${escapeHtml(prompt)}" maxlength="4000">${escapeHtml(entry.note || '')}</textarea>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="field-label" for="journal-win">One thing that went right</label>
              <input class="input-field" id="journal-win" maxlength="280" placeholder="Even something small" value="${escapeHtml(entry.win || '')}">
            </div>
            <div>
              <label class="field-label" for="journal-next">The next step</label>
              <input class="input-field" id="journal-next" maxlength="280" placeholder="One sentence is enough" value="${escapeHtml(entry.nextStep || '')}">
            </div>
          </div>
          <div class="journal-mood-block">
            <p class="field-label">How did it actually feel?</p>
            <div class="journal-moods" role="group" aria-label="Mood">
              ${MOODS.map(
                (mood) => `<button type="button" class="journal-mood ${entry.mood === mood.id ? 'is-active' : ''}" data-journal-mood="${mood.id}" aria-pressed="${entry.mood === mood.id}" title="${escapeHtml(mood.hint)}">
                  <span class="journal-mood-dot" data-mood="${mood.id}"></span>${escapeHtml(mood.label)}
                </button>`,
              ).join('')}
            </div>
            <div class="journal-energy" role="group" aria-label="Energy">
              <span class="meta">Energy</span>
              ${ENERGY_LEVELS.map(
                (level) => `<button type="button" class="journal-energy-btn ${entry.energy === level.id ? 'is-active' : ''}" data-journal-energy="${level.id}" aria-pressed="${entry.energy === level.id}">${escapeHtml(level.label)}</button>`,
              ).join('')}
            </div>
          </div>
          <div class="journal-form-foot">
            <span class="form-hint">${icon('shield')}Saved on this device only.</span>
            <div class="flex gap-2">
              ${entry.note || entry.win || entry.nextStep || entry.mood ? `<button type="button" class="btn-ghost" id="journal-clear">Clear entry</button>` : ''}
              <button type="submit" class="btn-primary">${icon('check')}Save entry</button>
            </div>
          </div>
        </form>
      </article>
      <div class="journal-side">
        <article class="card journal-timeline-card">
          <div class="card-header"><div><h3>Recent entries</h3><p class="meta">${stats.count ? `${stats.count} in the last 30 days` : 'Nothing written yet'}</p></div>${icon('review')}</div>
          ${
            history.length
              ? `<div class="journal-timeline">${history
                  .map((row) => {
                    const mood = MOODS.find((item) => item.id === row.entry.mood)
                    return `<button class="journal-entry" data-journal-open="${row.key}">
                      <span class="journal-entry-date"><strong>${escapeHtml(dayLabel(row.key, today))}</strong><small>${escapeHtml(row.weekday)}</small></span>
                      <span class="journal-entry-body">
                        ${row.entry.note ? `<span class="journal-entry-note">${escapeHtml(row.entry.note.slice(0, 180))}${row.entry.note.length > 180 ? '…' : ''}</span>` : '<span class="journal-entry-note muted">Mood and win only.</span>'}
                        ${row.entry.win ? `<small>${icon('check')}${escapeHtml(row.entry.win)}</small>` : ''}
                      </span>
                      ${mood ? `<span class="journal-entry-mood" data-mood="${mood.id}" title="${escapeHtml(mood.label)}"></span>` : ''}
                    </button>`
                  })
                  .join('')}</div>`
              : empty('edit', 'The page is still blank.', 'Write a single sentence about today. Future you will be glad it exists.')
          }
        </article>
        <article class="card journal-note-card">
          ${icon('leaf')}
          <p>${stats.count >= 3 ? 'Patterns show up in this record before they show up anywhere else. Read it before you judge a week.' : 'This is not a performance review. A hard day written down honestly is still a useful day.'}</p>
        </article>
      </div>
    </div>`

  bindCommon(section)
  section.querySelector('[data-journal-review]')?.addEventListener('click', () => window.CC.openWeeklyReview())

  qsa(section, '[data-journal-day]').forEach((button) =>
    button.addEventListener('click', () => {
      selectedDay = button.dataset.journalDay
      renderJournal()
    }),
  )
  qsa(section, '[data-journal-open]').forEach((button) =>
    button.addEventListener('click', () => {
      selectedDay = button.dataset.journalOpen
      renderJournal()
      const focusNote = /** @type {HTMLTextAreaElement|null} */ (section.querySelector('#journal-note'))
      focusNote?.focus()
    }),
  )

  const form = section.querySelector('#journal-form')
  let mood = entry.mood || null
  let energy = entry.energy || null

  qsa(section, '[data-journal-mood]').forEach((button) =>
    button.addEventListener('click', () => {
      mood = mood === button.dataset.journalMood ? null : button.dataset.journalMood
      qsa(section, '[data-journal-mood]').forEach((node) => {
        const active = node.dataset.journalMood === mood
        node.classList.toggle('is-active', active)
        node.setAttribute('aria-pressed', String(active))
      })
    }),
  )
  qsa(section, '[data-journal-energy]').forEach((button) =>
    button.addEventListener('click', () => {
      energy = energy === button.dataset.journalEnergy ? null : button.dataset.journalEnergy
      qsa(section, '[data-journal-energy]').forEach((node) => {
        const active = node.dataset.journalEnergy === energy
        node.classList.toggle('is-active', active)
        node.setAttribute('aria-pressed', String(active))
      })
    }),
  )

  const persist = () => {
    const note = /** @type {HTMLTextAreaElement} */ (section.querySelector('#journal-note'))?.value || ''
    const win = /** @type {HTMLInputElement} */ (section.querySelector('#journal-win'))?.value || ''
    const nextStep = /** @type {HTMLInputElement} */ (section.querySelector('#journal-next'))?.value || ''
    if (!note.trim() && !win.trim() && !nextStep.trim() && !mood && !energy) {
      toast('Write a line, choose a mood — or both.', 'error')
      return
    }
    let saved = null
    commit((draft) => {
      saved = saveEntry(draft, key, { note, win, nextStep, mood, energy })
    })
    toast(saved ? `Entry saved for ${dayLabel(key, today).toLowerCase()}` : 'Entry cleared', saved ? 'success' : 'info')
    if (key === today) selectedDay = null
    renderJournal()
  }

  form?.addEventListener('submit', (event) => {
    event.preventDefault()
    persist()
  })
  /** @type {HTMLTextAreaElement|null} */
  const noteInput = section.querySelector('#journal-note')
  noteInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      persist()
    }
  })
  section.querySelector('#journal-clear')?.addEventListener('click', () => {
    commit((draft) => {
      if (draft.journal) delete draft.journal[key]
    })
    toast('Entry cleared', 'info')
    renderJournal()
  })
}
