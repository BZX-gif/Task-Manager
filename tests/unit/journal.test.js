import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyState } from '../../src/client/lib/state.js'
import {
  ENERGY_LEVELS,
  MOODS,
  energyOf,
  entryFor,
  journalStats,
  journalSummaryLine,
  moodFromAverage,
  moodOf,
  normalizeEntry,
  normalizeJournal,
  promptFor,
  saveEntry,
} from '../../src/client/lib/journal.js'

const TODAY = '2026-11-16'

test('blank entries are not saved', () => {
  assert.equal(normalizeEntry(null), null)
  assert.equal(normalizeEntry({}), null)
  assert.equal(normalizeEntry({ note: '   ', win: '', nextStep: '' }), null)
})

test('entries are trimmed, bounded and validated', () => {
  const entry = normalizeEntry({ note: `  ${'x'.repeat(5000)}  `, win: '  Shipped it ', mood: 'invented', energy: 'nuclear', updatedAt: 42 })
  assert.equal(entry.note.length, 4000)
  assert.equal(entry.win, 'Shipped it')
  assert.equal(entry.mood, null)
  assert.equal(entry.energy, null)
  assert.equal(entry.updatedAt, 42)
  assert.equal(normalizeEntry({ note: 'ok', mood: 'good', energy: 'high' }).mood, 'good')
})

test('the journal map rejects bad keys and empty rows', () => {
  const journal = normalizeJournal({ '2026-11-16': { note: 'Real' }, nonsense: { note: 'Nope' }, '2026-11-17': {} })
  assert.deepEqual(Object.keys(journal), ['2026-11-16'])
})

test('saving, editing and clearing a day', () => {
  const state = emptyState()
  const saved = saveEntry(state, TODAY, { note: 'First line', mood: 'steady' }, { now: 100 })
  assert.equal(saved.note, 'First line')
  assert.equal(entryFor(state, TODAY).mood, 'steady')

  const updated = saveEntry(state, TODAY, { win: 'Finished the draft' }, { now: 200 })
  assert.equal(updated.note, 'First line', 'existing fields are preserved')
  assert.equal(updated.win, 'Finished the draft')
  assert.equal(updated.updatedAt, 200)

  saveEntry(state, TODAY, { note: '', win: '', nextStep: '', mood: null, energy: null })
  assert.equal(state.journal[TODAY], undefined, 'an emptied entry is removed, not stored blank')
})

test('stats count entries, streak and mood', () => {
  const state = emptyState()
  saveEntry(state, '2026-11-08', { mood: 'heavy', note: 'very rough' })
  saveEntry(state, '2026-11-09', { mood: 'low', note: 'rough' })
  saveEntry(state, '2026-11-13', { mood: 'low', note: 'rough' })
  saveEntry(state, '2026-11-14', { mood: 'steady', note: 'ok' })
  saveEntry(state, '2026-11-15', { mood: 'good', win: 'walked' })
  saveEntry(state, TODAY, { mood: 'good', note: 'solid' })

  const stats = journalStats(state.journal, { todayKey: TODAY, days: 30 })
  assert.equal(stats.count, 6)
  assert.equal(stats.streak, 4)
  assert.equal(stats.consistency, 20)
  assert.equal(stats.winsCount, 1)
  assert.equal(stats.lastWin, 'walked')
  assert.ok(stats.averageMood >= 2.5 && stats.averageMood <= 4)
  assert.ok(stats.mood)
  assert.equal(stats.trend, 'up', 'the last week is lighter than the week before')
})

test('a streak survives writing yesterday but not a two-day gap', () => {
  const state = emptyState()
  saveEntry(state, '2026-11-14', { note: 'a' })
  saveEntry(state, TODAY, { note: 'b' })
  assert.equal(journalStats(state.journal, { todayKey: TODAY }).streak, 1, 'yesterday-only still counts one day')
  saveEntry(state, '2026-11-15', { note: 'c' })
  assert.equal(journalStats(state.journal, { todayKey: TODAY }).streak, 3)

  const broken = emptyState()
  saveEntry(broken, '2026-11-13', { note: 'old' })
  assert.equal(journalStats(broken.journal, { todayKey: TODAY }).streak, 0)
})

test('mood helpers map scores to the nearest label', () => {
  assert.equal(moodOf('good').score, 4)
  assert.equal(moodOf('nope'), null)
  assert.equal(energyOf('high').value, 3)
  assert.equal(energyOf('high').label, 'High')
  assert.equal(moodFromAverage(0), null)
  assert.equal(moodFromAverage(4.4).id, 'good')
  assert.equal(moodFromAverage(1.2).id, 'heavy')
  assert.equal(MOODS.length, 5)
  assert.equal(ENERGY_LEVELS.length, 3)
})

test('prompts are time-aware and stable for a given day', () => {
  const first = promptFor('morning', TODAY)
  assert.equal(promptFor('morning', TODAY), first)
  assert.ok(promptFor('evening', TODAY).length > 8)
  assert.ok(promptFor('unknown-part', TODAY).length > 8)
})

test('summary line stays gentle and factual', () => {
  assert.match(journalSummaryLine({ count: 0 }), /Nothing written yet/)
  const stats = journalStats(
    {
      '2026-11-15': { note: 'a', mood: 'good' },
      '2026-11-16': { note: 'b', mood: 'good' },
    },
    { todayKey: TODAY },
  )
  const line = journalSummaryLine(stats)
  assert.match(line, /2 days in a row/)
  assert.match(line, /mood mostly good/)
})
