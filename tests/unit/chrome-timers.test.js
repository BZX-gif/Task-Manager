/**
 * Regression: the clock tick used to destroy markup.
 *
 * `updateClockAndGreeting()` runs every second. It refreshed the header date
 * with `date.textContent = …`, which replaced whatever the view had rendered
 * inside that element. When the date block gained two spans (a full form and a
 * compact form for phones) the first tick deleted both, so the compact form
 * could never appear and the layout silently fell back to the long string.
 *
 * The rule these tests protect: a chrome timer may update *text nodes it owns*,
 * never the inner structure of a view.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const chrome = await readFile(path.join(process.cwd(), 'src', 'client', 'ui', 'chrome.js'), 'utf8')

test('the clock tick never writes textContent onto the date block', () => {
  // the destructive form was: document.querySelector('.date-day').textContent = …
  assert.doesNotMatch(
    chrome,
    /querySelector\(['"]\.date-day['"]\)[^;\n]*\.textContent\s*=/,
    'updateClockAndGreeting must not overwrite .date-day wholesale',
  )
})

test('the clock tick updates both date forms in place', () => {
  assert.match(chrome, /\.date-day \.date-full/, 'it addresses the full form')
  assert.match(chrome, /\.date-day \.date-short/, 'it addresses the compact form')
})

test('the tick still supports a bare date element for older markup', () => {
  // a view that renders a single text node must keep working
  assert.match(chrome, /dateBare|\.date-day['"]\)/)
})

test('no other chrome timer rewrites a container it does not own', () => {
  // guard the class of bug: any `X.textContent =` where X came from a query
  // for a *container* class rather than a leaf would be the same mistake again
  const writes = [...chrome.matchAll(/querySelector\(['"]\.([a-z0-9-]+)['"]\)[^;\n]{0,80}\.textContent\s*=/g)]
  const containers = ['date-day', 'overview-greeting', 'command-strip', 'priority-card', 'card']
  for (const [, cls] of writes) {
    assert.ok(!containers.includes(cls), `chrome.js overwrites .${cls}, which the view renders into`)
  }
})
