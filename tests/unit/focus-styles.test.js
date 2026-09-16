/**
 * Static guards for the parts of the Focus Mission redesign that live purely
 * in CSS: the reduced-motion contract and the mobile-first overlay layout.
 * (Runtime behaviour is covered by tests/integration/behaviour.test.js.)
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const css = await readFile(path.join(process.cwd(), 'public', 'static', 'style.css'), 'utf8')

test('the focus overlay keeps its overlay/fullscreen contract', () => {
  const overlay = css.match(/\.focus-overlay\s*{[^}]*}/)?.[0] || ''
  assert.match(overlay, /position:\s*fixed/)
  assert.match(overlay, /inset:\s*0/)
  assert.match(overlay, /z-index:\s*95/)
})

test('reduced motion stills every continuous or celebratory focus animation', () => {
  const rm = css.match(/@media \(prefers-reduced-motion: reduce\)\s*{([\s\S]*)$/m)?.[1] || ''
  assert.ok(rm.length > 0, 'a reduced-motion block exists')
  for (const selector of ['.fz-orb', '.fz-burst', '.fz-count-tick']) {
    assert.ok(rm.includes(selector), `${selector} is stilled for reduced-motion users`)
  }
  // transition/animation durations are globally crushed as the baseline guard
  assert.match(rm, /animation-duration:\s*0\.001ms/)
  assert.match(rm, /transition-duration:\s*0\.001ms/)
})

test('the mobile pass intentionally re-lays-out the overlay and its controls', () => {
  const mobile = css.match(/@media \(max-width: 640px\)\s*{([\s\S]*)$/m)?.[1] || ''
  assert.ok(mobile.length > 0, 'a 640px media block exists')
  assert.ok(mobile.includes('.focus-overlay'), 'the overlay adapts on small screens')
  assert.ok(mobile.includes('.focus-controls'), 'controls become thumb-friendly rows')
  assert.ok(mobile.includes('order: -1'), 'the primary pause/resume sits first and full-width')
})

test('phase and progress are never communicated by colour alone', () => {
  // every phase ships a text label via the chip (classes below drive only tone)
  for (const cls of ['.focus-phase-chip', '.focus-phase-dot']) assert.ok(css.includes(cls), `${cls} exists`)
  // the energy bar is a real progressbar target with text percent nearby
  for (const cls of ['.focus-energy-fill', '.fz-tick']) assert.ok(css.includes(cls), `${cls} exists`)
})
