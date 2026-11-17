/* -------------------------------------------------------------------------
   CLOSE THE DAY — the evening ritual, in one calm screen
   -------------------------------------------------------------------------
   Everything on this screen is prefilled from real records and nothing is
   applied until “Close the day” is pressed. The flow is deliberately short:
   see the day, choose what comes with you, choose tomorrow’s three, write one
   honest line.
   ------------------------------------------------------------------------- */

import { closeModal, escapeHtml, openModal, toast } from '../core/dom.js'
import { commit, currentDayKey, state } from '../core/store.js'
import { formatDuration, formatKeyLabel } from '../lib/dates.js'
import { ENERGY_LEVELS, MOODS } from '../lib/journal.js'
import { applyShutdown, reopenDay, shutdownSummary } from '../lib/shutdown.js'
import { categoryName } from '../views/shared.js'
import { icon } from './icons.js'

function statTile(label, value, detail) {
  return `<div class="ritual-stat"><span>${escapeHtml(label)}</span><strong>${value}</strong><small>${escapeHtml(detail)}</small></div>`
}

function reasonLabel(reason) {
  if (reason === 'overdue') return 'Overdue'
  if (reason === 'today') return 'Open today'
  return 'Tomorrow'
}

function candidateRow(item, { carried, priority }) {
  const alreadyTomorrow = item.reason === 'tomorrow'
  return `
    <div class="ritual-row ${alreadyTomorrow ? 'is-tomorrow' : ''}" data-ritual-row="${escapeHtml(item.id)}">
      <label class="ritual-check" title="${alreadyTomorrow ? 'Already on tomorrow’s plan' : 'Carry to tomorrow'}">
        <input type="checkbox" data-carry="${escapeHtml(item.id)}" ${carried ? 'checked' : ''} ${alreadyTomorrow ? 'disabled' : ''} aria-label="Carry ${escapeHtml(item.title)} to tomorrow">
      </label>
      <div class="ritual-row-copy">
        <strong>${escapeHtml(item.title)}</strong>
        <span>
          <em class="ritual-tag ritual-tag-${item.reason}">${reasonLabel(item.reason)}</em>
          ${item.priority === 'high' ? '<em class="ritual-tag ritual-tag-high">High priority</em>' : ''}
          ${item.categoryId ? escapeHtml(categoryName(item.categoryId, '')) : ''}
          ${item.time ? `· ${escapeHtml(item.time)}` : ''}
          · ${formatDuration(item.estimateMinutes || 30)}
        </span>
      </div>
      <label class="ritual-priority">
        <input type="checkbox" data-priority="${escapeHtml(item.id)}" ${priority ? 'checked' : ''} aria-label="Make ${escapeHtml(item.title)} a priority tomorrow">
        <span>Tomorrow</span>
      </label>
    </div>`
}

export function openShutdown() {
  const today = currentDayKey()
  const summary = shutdownSummary(state, { today, now: new Date() })
  const tomorrowKey = summary.tomorrowKey
  const tomorrowTop3 = (state.top3?.[tomorrowKey] || []).filter((id) => state.tasks.some((task) => task.id === id && !task.done))
  const tomorrowOpen = state.tasks
    .filter((task) => task.date === tomorrowKey && !task.done && !task.inbox && task.status !== 'cancelled')
    .map((task) => ({ id: task.id, title: task.title, priority: task.priority, estimateMinutes: task.estimateMinutes, categoryId: task.cat, time: task.time, reason: 'tomorrow' }))

  const seen = new Set()
  const candidates = [...summary.unfinished, ...tomorrowOpen]
    .filter((item) => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })
    .slice(0, 14)

  const existing = state.journal?.[today] || {}
  const mood = existing.mood || null
  const energy = existing.energy || null

  const closed = summary.closed
  const body = closed
    ? `<div class="ritual-closed">
        <span class="ritual-closed-mark">${icon('check')}</span>
        <h4>${escapeHtml(summary.headline)}</h4>
        <p>You closed <strong>${escapeHtml(formatKeyLabel(today))}</strong> at ${summary.closedAt ? new Date(summary.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}.</p>
        <div class="ritual-stats">
          ${statTile('Missions', `${summary.missions.done}<small> / ${summary.missions.total}</small>`, 'completed today')}
          ${statTile('Focused', `${summary.focusMinutes}<small> min</small>`, 'deep work')}
          ${statTile('Tomorrow', String(summary.tomorrow.missions), 'missions waiting')}
        </div>
        <p class="ritual-quiet">${icon('moon')}Rest is part of the work. Nothing else is required tonight.</p>
        <div class="form-footer">
          <button type="button" class="btn-ghost" data-reopen-day>${icon('recover')}Reopen the day</button>
          <button type="button" class="btn-ghost" data-open-journal>${icon('journal')}Open journal</button>
          <button type="button" class="btn-primary" data-modal-close>Goodnight</button>
        </div>
      </div>`
    : `<div class="ritual">
        <div class="ritual-hero">
          <p class="eyebrow">${icon('moon')}END OF DAY · ${escapeHtml(formatKeyLabel(today).toUpperCase())}</p>
          <h4>${escapeHtml(summary.headline)}</h4>
          <p>${escapeHtml(summary.prompt)}</p>
          <div class="ritual-stats">
            ${statTile('Missions', `${summary.missions.done}<small> / ${summary.missions.total}</small>`, 'completed today')}
            ${statTile('Focused', `${summary.focusMinutes}<small> min</small>`, 'deep work today')}
            ${statTile('Still open', String(summary.unfinished.length), summary.unfinished.length === 0 ? 'nothing hanging' : summary.unfinished.length === 1 ? 'mission, not a failure' : 'missions, not failures')}
          </div>
        </div>

        ${candidates.length ? `<section class="ritual-section">
          <div class="ritual-section-head">
            <div><h5>What comes with you?</h5><p>Carried work moves to ${escapeHtml(formatKeyLabel(tomorrowKey))} and is re-placed in real time. Nothing is marked as failure.</p></div>
            <button type="button" class="text-button" data-carry-all>Select all</button>
          </div>
          <div class="ritual-list">${candidates.map((item) => candidateRow(item, { carried: item.reason === 'tomorrow' || summary.carrySuggestion.includes(item.id), priority: tomorrowTop3.includes(item.id) })).join('')}</div>
        </section>` : `<section class="ritual-section"><div class="ritual-empty">${icon('leaf')}<div><h5>Nothing is left hanging.</h5><p>Tomorrow starts clean. Choose up to three priorities below.</p></div></div></section>`}

        <section class="ritual-section">
          <div class="ritual-section-head">
            <div><h5>Tomorrow’s three</h5><p>Chosen before the day ends, so tomorrow starts with a direction instead of a decision.</p></div>
            <span class="chip" data-priority-count>${tomorrowTop3.length} / 3 chosen</span>
          </div>
          ${candidates.length ? `<p class="form-hint">Tick “Tomorrow” on up to three rows above. Choosing a priority also carries it forward.</p>` : `<p class="form-hint">Add a mission for tomorrow first, then close the day.</p>`}
        </section>

        <section class="ritual-section ritual-journal">
          <div class="ritual-section-head"><div><h5>One honest line</h5><p>Private, local, and only for you. This joins today’s journal entry.</p></div>${icon('shield')}</div>
          <label class="field-label" for="ritual-note">What happened today?</label>
          <textarea class="input-field" id="ritual-note" rows="3" maxlength="4000" placeholder="${escapeHtml(summary.prompt)}">${escapeHtml(existing.note || '')}</textarea>
          <label class="field-label" for="ritual-win" style="margin-top:14px">One thing that went right</label>
          <input class="input-field" id="ritual-win" maxlength="280" value="${escapeHtml(existing.win || '')}" placeholder="Even something small counts.">
          <div class="ritual-feeling">
            <div class="journal-mood-block">
              <p class="field-label">How did today feel?</p>
              <div class="journal-moods" role="group" aria-label="Mood">
                ${MOODS.map((item) => `<button type="button" class="journal-mood ${mood === item.id ? 'is-active' : ''}" data-ritual-mood="${item.id}" aria-pressed="${mood === item.id}" title="${escapeHtml(item.hint)}"><span class="journal-mood-dot" data-mood="${item.id}"></span>${escapeHtml(item.label)}</button>`).join('')}
              </div>
            </div>
            <div>
              <p class="field-label">Energy</p>
              <div class="journal-energy" role="group" aria-label="Energy">
                ${ENERGY_LEVELS.map((level) => `<button type="button" class="journal-energy-btn ${energy === level.id ? 'is-active' : ''}" data-ritual-energy="${level.id}" aria-pressed="${energy === level.id}">${escapeHtml(level.label)}</button>`).join('')}
              </div>
            </div>
          </div>
        </section>

        <div class="form-footer ritual-footer">
          <button type="button" class="btn-ghost" data-modal-close>Not yet</button>
          <button type="button" class="btn-primary" data-close-day>${icon('moon')}Close the day</button>
        </div>
      </div>`

  openModal({
    title: closed ? 'The day is closed.' : 'Close the day.',
    size: 'modal-wide',
    body,
    onMount: (box) => {
      if (closed) {
        box.querySelector('[data-reopen-day]')?.addEventListener('click', () => {
          commit((s) => { reopenDay(s, today) })
          closeModal()
          toast('The day is open again. Take the time you need.', 'info')
          window.CC.refreshAll()
        })
        box.querySelector('[data-open-journal]')?.addEventListener('click', () => {
          closeModal()
          window.CC.switchView('journal')
        })
        return
      }

      let selectedMood = mood
      let selectedEnergy = energy
      const carryBoxes = [...box.querySelectorAll('[data-carry]')]
      const priorityBoxes = [...box.querySelectorAll('[data-priority]')]
      const countLabel = box.querySelector('[data-priority-count]')
      const selectedPriorities = () => priorityBoxes.filter((node) => node.checked)

      const syncCount = () => {
        if (countLabel) countLabel.textContent = `${selectedPriorities().length} / 3 chosen`
      }

      for (const checkbox of priorityBoxes) {
        checkbox.addEventListener('change', () => {
          if (checkbox.checked && selectedPriorities().length > 3) {
            checkbox.checked = false
            toast('Three priorities is the point. Choose the three that matter.', 'info')
          }
          if (checkbox.checked) {
            const carry = box.querySelector(`[data-carry="${checkbox.dataset.priority}"]`)
            if (carry && !carry.disabled) carry.checked = true
          }
          syncCount()
        })
      }
      for (const checkbox of carryBoxes) {
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) return
          const priority = box.querySelector(`[data-priority="${checkbox.dataset.carry}"]`)
          if (priority) priority.checked = false
          syncCount()
        })
      }
      box.querySelector('[data-carry-all]')?.addEventListener('click', () => {
        for (const checkbox of carryBoxes) checkbox.checked = true
      })

      box.querySelectorAll('[data-ritual-mood]').forEach((button) => {
        button.addEventListener('click', () => {
          selectedMood = selectedMood === button.dataset.ritualMood ? null : button.dataset.ritualMood
          box.querySelectorAll('[data-ritual-mood]').forEach((node) => {
            const active = node.dataset.ritualMood === selectedMood
            node.classList.toggle('is-active', active)
            node.setAttribute('aria-pressed', String(active))
          })
        })
      })
      box.querySelectorAll('[data-ritual-energy]').forEach((button) => {
        button.addEventListener('click', () => {
          selectedEnergy = selectedEnergy === button.dataset.ritualEnergy ? null : button.dataset.ritualEnergy
          box.querySelectorAll('[data-ritual-energy]').forEach((node) => {
            const active = node.dataset.ritualEnergy === selectedEnergy
            node.classList.toggle('is-active', active)
            node.setAttribute('aria-pressed', String(active))
          })
        })
      })

      box.querySelector('[data-close-day]')?.addEventListener('click', () => {
        const carryIds = carryBoxes.filter((node) => node.checked).map((node) => node.dataset.carry)
        const priorityIds = selectedPriorities().map((node) => node.dataset.priority)
        const note = box.querySelector('#ritual-note').value
        const win = box.querySelector('#ritual-win').value
        /** @type {any} */ let result = null
        commit((s) => {
          result = applyShutdown(s, { today, carryIds, priorityIds, note, win, mood: selectedMood, energy: selectedEnergy, now: Date.now() })
        })
        closeModal()
        if (!result?.ok) {
          toast(result?.reason || 'The day could not be closed. Nothing was changed.', 'error')
          return
        }
        const carried = result.carried.length
        const parts = [`Day closed`]
        if (carried) parts.push(`${carried} mission${carried === 1 ? '' : 's'} carried to tomorrow`)
        if (result.priorities.length) parts.push('tomorrow’s three are set')
        toast(parts.join(' · '), 'success', {
          timeout: 9000,
          action: {
            label: 'Reopen',
            onClick: () => {
              commit((s) => { reopenDay(s, today) })
              window.CC.refreshAll()
              toast('The day is open again.', 'info')
            },
          },
        })
        window.CC.refreshAll()
      })
    },
  })
}

/** A lightweight card model for the dashboard and command strip. */
export function shutdownCard(stateObject, today = currentDayKey()) {
  const summary = shutdownSummary(stateObject, { today, now: new Date() })
  return {
    ...summary,
    label: summary.closed ? 'Day closed' : summary.unfinished.length ? `${summary.unfinished.length} open` : 'Ready to close',
  }
}
