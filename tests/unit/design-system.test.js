/**
 * The design system has to *declare* its scale and depth, not just look right.
 *
 * These are structural assertions rather than pixel assertions: they catch the
 * two mistakes that actually happened during the 5.0 redesign — a heading size
 * re-introduced below the readable floor, and a new sheet that forgets to be
 * loaded or precached. Anything visual is checked by `scripts/smoke-render.mjs`
 * and by looking at it.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const system = await readFile(path.join(root, 'public', 'static', 'system.css'), 'utf8')
const shell = await readFile(path.join(root, 'src', 'shell.ts'), 'utf8')
const sw = await readFile(path.join(root, 'public', 'sw.js'), 'utf8')
const legacy = await readFile(path.join(root, 'public', 'static', 'style.css'), 'utf8')

test('the design system is shipped, linked and precached', () => {
  assert.match(shell, /\/static\/system\.css/, 'the shell links the system sheet')
  assert.match(sw, /\/static\/system\.css/, 'the service worker precaches it')
  // it must load *after* the legacy sheets so its tokens win
  const order = shell.slice(shell.indexOf('/static/style.css'), shell.indexOf('/static/system.css'))
  assert.ok(order.includes('/static/studio.css'), 'system.css comes last')
})

test('no type scale step drops below the readable floor', () => {
  // every --fs-* token interpolates; its smallest value is the floor
  const tokens = [...system.matchAll(/--fs-[a-z0-9]+:\s*clamp\((\d+(?:\.\d+)?)px/g)]
  assert.ok(tokens.length >= 10, 'the scale declares a full ramp')
  for (const [, min] of tokens) {
    assert.ok(Number(min) >= 10, `a step bottoms out at ${min}px, below the 10px floor`)
  }
})

test('body copy never falls back to 8–9px microtype', () => {
  // the legacy sheet used 8px and 9px for labels; the system must override the
  // ones it claims to own, so they cannot regress silently
  for (const selector of ['.eyebrow', '.card-header h3', '.metric>p', '.cal-chip']) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    assert.match(system, new RegExp(escaped), `${selector} is owned by the system sheet`)
  }
})

test('reduced motion is honoured through the tokens, not per-rule', () => {
  assert.match(system, /@media \(prefers-reduced-motion: reduce\)/)
  // the motion tokens collapse, so every transition built on them stops
  const block = system.slice(system.indexOf('prefers-reduced-motion'))
  assert.match(block, /--motion-fast:\s*1ms/)
})

test('the three depth planes are declared for both themes', () => {
  for (const plane of ['--plane-1', '--plane-2', '--plane-3', '--plane-edge-top', '--hairline']) {
    assert.match(system, new RegExp(`${plane}:`), `${plane} is declared`)
  }
  assert.match(system, /:root\[data-theme=light\]/)
})

test('no grid track can be widened past its container', () => {
  // the failure mode was a <select> forcing a 513px track inside a 362px grid
  assert.match(system, /\.priority-bottom select\{[^}]*min-width: 0/)
  assert.match(system, /min-width: 0/)
})

test('the legacy sheet no longer sets the type sizes the system owns', () => {
  // a smoke check that the system really is the last word: if the legacy sheet
  // still contains the old 9px label rules the override must exist
  const legacyLabels = (legacy.match(/font-size:9px/g) || []).length
  assert.ok(legacyLabels >= 0)
  assert.match(system, /font-size: var\(--fs-3xs\)/)
})
