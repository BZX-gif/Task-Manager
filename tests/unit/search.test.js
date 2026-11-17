import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyState, makeContext, normalizeTask } from '../../src/client/lib/state.js'
import {
  searchWorkspace, searchCommands, highlightMatch, searchTokens, tokenScore,
  snippetAround, scoreText, COMMANDS,
} from '../../src/client/lib/search.js'

const NOW = new Date(2026, 8, 15, 18, 0, 0).getTime()
const TODAY = '2026-09-15'

function workspace() {
  const state = emptyState(makeContext({ now: NOW, id: (() => { let n = 0; return () => `id${++n}` })() }))
  state.tasks.push(
    normalizeTask({ id: 't1', title: 'Draft the investor update', date: TODAY, priority: 'high', cat: 'work', notes: 'Include the retention curve and runway', subtasks: [{ id: 's1', title: 'Pull September metrics', done: false }] }, makeContext({ now: NOW })),
    normalizeTask({ id: 't2', title: 'Plan my day', date: TODAY, priority: 'medium', estimateMinutes: 20 }, makeContext({ now: NOW })),
    normalizeTask({ id: 't3', title: 'Call the architect', date: '2026-09-16', priority: 'low' }, makeContext({ now: NOW })),
  )
  state.goals.push({ id: 'g1', title: 'Build a calmer company', category: 'Work', status: 'active', milestones: [{ id: 'm1', title: 'Hire a chief of staff', done: false }] })
  state.projects.push({ id: 'p1', title: 'Headquarters renovation', status: 'active', notes: 'The architect needs the brief' })
  state.routines.push({ id: 'r1', title: 'Morning pages', activities: [{ id: 'a1', title: 'Three pages by hand' }], archived: false })
  state.journal[TODAY] = { note: 'The investor update took longer than expected, but the retention story is finally clear.', win: 'A honest conversation with the team', nextStep: 'Finish the metrics appendix', mood: 'steady', energy: 'medium', updatedAt: NOW }
  return state
}

test('search tokens ignore decorative markers and keep useful ones', () => {
  assert.deepEqual(searchTokens('  #Work !high  Q3 '), ['work', 'high', 'q3'])
  assert.deepEqual(searchTokens(''), [])
})

test('tokenScore prefers word starts and supports ordered subsequences', () => {
  assert.ok(tokenScore('plan', 'plan my day') > tokenScore('plan', 'explain the plan'))
  assert.ok(tokenScore('plnday', 'plan my day') > 0)
  assert.equal(tokenScore('zzz', 'plan my day'), 0)
})

test('scoreText requires every token to be present', () => {
  assert.ok(scoreText(['investor', 'update'], 'Draft the investor update') > 0)
  assert.equal(scoreText(['investor', 'wedding'], 'Draft the investor update'), 0)
})

test('searchWorkspace returns grouped, ranked results across records', () => {
  const result = searchWorkspace(workspace(), 'investor', { now: NOW })
  assert.equal(result.groups[0].kind, 'mission')
  assert.equal(result.flat[0].id, 't1')
  assert.match(result.flat[0].subtitle, /High priority/)
  assert.ok(result.groups.some((group) => group.kind === 'journal'), 'journal entries are searchable')
  assert.equal(result.total, result.flat.length)
})

test('searchWorkspace searches descriptions, notes, subtasks and milestones', () => {
  const state = workspace()
  for (const query of ['retention', 'metrics', 'chief of staff', 'brief']) {
    const result = searchWorkspace(state, query, { now: NOW })
    assert.ok(result.total > 0, `expected a result for “${query}”`)
  }
})

test('searchWorkspace is deterministic and recency-aware', () => {
  const state = workspace()
  state.tasks[0].createdAt = NOW - 40 * 86_400_000
  state.tasks.push(normalizeTask({ id: 'new', title: 'Draft the investor update', date: TODAY, createdAt: NOW - 3_600_000 }, makeContext({ now: NOW })))
  const first = searchWorkspace(state, 'draft investor', { now: NOW })
  const second = searchWorkspace(state, 'draft investor', { now: NOW })
  assert.deepEqual(first.flat.map((item) => item.id), second.flat.map((item) => item.id))
  assert.equal(first.flat[0].id, 'new', 'the recently created match wins a tie')
})

test('empty and whitespace queries return nothing rather than everything', () => {
  for (const query of ['', '   ', '!!!']) {
    assert.equal(searchWorkspace(workspace(), query, { now: NOW }).total, 0)
  }
})

test('highlightMatch escapes user text and marks only the matched span', () => {
  const html = highlightMatch('<script>alert(1)</script> plan the day', 'plan')
  assert.ok(!html.includes('<script>'))
  assert.ok(html.includes('<mark>plan</mark>'))
  assert.equal(highlightMatch('Nothing here', 'zzz'), 'Nothing here')
})

test('snippetAround keeps the match visible and the excerpt short', () => {
  const text = `${'a '.repeat(80)}retention curve${' b'.repeat(80)}`
  const snippet = snippetAround(text, ['retention'], 60)
  assert.ok(snippet.length <= 62)
  assert.match(snippet, /retention curve/)
  assert.match(snippet, /…/)
})

test('searchCommands matches titles and subtitles and offers the ritual', () => {
  assert.equal(searchCommands('')[0].action, COMMANDS[0].action)
  const results = searchCommands('close day')
  assert.equal(results[0].action, 'close-day')
  assert.ok(searchCommands('nonsense query').length === 0)
})

test('searchWorkspace can exclude journal entries for a lighter index', () => {
  const result = searchWorkspace(workspace(), 'retention', { now: NOW, includeJournal: false })
  assert.ok(!result.groups.some((group) => group.kind === 'journal'))
})
