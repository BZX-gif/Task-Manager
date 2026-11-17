/**
 * Static guards for the 5.0 design layer.
 *
 * These are the contracts that are easy to break silently and expensive to
 * notice in production: semantic tokens instead of hardcoded colours, motion
 * that respects the user's preference, responsive breakpoints for every new
 * grid, and navigation that actually points at sections that exist.
 *
 * Runtime behaviour is covered by tests/integration/command-center-5.test.js.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { readFileSync, readdirSync } from 'node:fs'

/** Read a source file as UTF-8 text. */
const read = (file) => readFileSync(file, 'utf8')

const root = process.cwd()
const css = await readFile(path.join(root, 'public', 'static', 'style.css'), 'utf8')
const shell = await readFile(path.join(root, 'src', 'shell.ts'), 'utf8')
const router = await readFile(path.join(root, 'src', 'client', 'ui', 'router.js'), 'utf8')

/** Everything from the 5.0 marker onwards is the new layer. */
const five = css.slice(css.indexOf('COMMAND 5.0'))

test('the 5.0 layer exists and styles both new surfaces', () => {
  assert.ok(five.length > 4000, 'the 5.0 design block is present')
  for (const selector of ['.command-hero', '.command-focus-card', '.command-index-card', '.command-signal', '.command-week-day', '.command-action', '.command-rhythm', '.money-advice', '.money-accounts', '.money-entry', '.money-budget']) {
    assert.ok(five.includes(selector), `${selector} is styled`)
  }
})

test('new surfaces use semantic tokens, never a raw surface colour', () => {
  // Semantic state tints (warning/success) may carry an alpha suffix; surfaces,
  // text and borders may not be hardcoded at all.
  const hex = five.match(/#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) || []
  const stateTints = ['#d7b582', '#8ac6ad', '#e39b9b']
  const stray = hex.filter((value) => !stateTints.some((tint) => value.toLowerCase().startsWith(tint)))
  assert.deepEqual(stray, [], `unexpected hardcoded colours: ${stray.join(', ')}`)
  assert.ok(five.includes('var(--accent)'), 'the accent token is used')
  assert.ok(five.includes('var(--glass-interactive-bg)'), 'the interactive glass token is used')
  assert.ok(five.includes('var(--danger)') && five.includes('var(--success)') && five.includes('var(--warning)'), 'semantic states are tokenised')
})

test('every new grid has a responsive counterpart', () => {
  for (const width of ['1380px', '1180px', '900px', '720px', '420px']) {
    assert.ok(five.includes(`max-width:${width}`) || five.includes(`max-width: ${width}`), `a ${width} breakpoint exists`)
  }
  // the widest grids must collapse before they overflow a narrow laptop
  const narrow = five.slice(five.indexOf('@media (max-width:1180px)'))
  assert.match(narrow, /\.command-top,\.command-grid\{grid-template-columns:minmax\(0,1fr\)\}/)
  assert.match(narrow, /\.money-grid,\.money-grid--split\{grid-template-columns:minmax\(0,1fr\)\}/)
})

test('reduced motion stills every new animation and transition', () => {
  const block = five.slice(five.indexOf('@media (prefers-reduced-motion: reduce)'))
  assert.ok(block.length > 0, 'a reduced-motion block exists in the 5.0 layer')
  for (const selector of ['.command-signal', '.command-action', '.command-week-day', '.money-entry']) {
    assert.ok(block.includes(selector), `${selector} is stilled`)
  }
  assert.match(block, /transition:none/)
})

test('every new interactive control is a real button with a visible focus ring', () => {
  const focusRule = css.match(/:focus-visible\{[^}]*\}/)?.[0] || ''
  assert.match(css, /button:focus-visible[^{]*\{[^}]*outline:2px solid var\(--accent\)/, 'buttons keep a visible focus ring')
  assert.ok(focusRule.length > 0)
  // the signal/pillar/week controls must be buttons so they are keyboard reachable
  const view = read(path.join(root, 'src', 'client', 'views', 'command.js'))
  for (const hook of ['class="command-signal', 'class="command-pillar', 'class="command-week-day', 'class="command-action']) {
    assert.ok(view.includes(`<button ${hook}`) || view.includes(`<button ${hook}`), `${hook} renders as a button`)
  }
})

test('the ledger view keeps money private, in words as well as code', () => {
  // every client source is loaded as one string: a bundle module can be split
  // across files at any time, and the promise must survive that refactor.
  const dir = path.join(root, 'src', 'client', 'views')
  const view = readdirSync(dir).map((file) => readFileSync(path.join(dir, file), 'utf8')).join('\n')
  assert.match(view, /this browser only/i, 'the privacy promise is visible')
  assert.match(view, /no bank connection/i, 'the user is told what this is not')
  assert.match(view, /nothing uploaded/i, 'the user is told where it does not go')
  const settings = read(path.join(root, 'src', 'client', 'views', 'settings.js'))
  assert.match(settings, /never leaves this device/i)
})

test('navigation, router and shell agree on every view', () => {
  const routerViews = router.match(/export const VIEWS = \[([^\]]*)\]/)[1].split(',').map((value) => value.trim().replace(/'/g, '')).filter(Boolean)
  const navItems = [...shell.matchAll(/\['([a-z]+)', '[^']+', '[a-z]+'\]/g)].map((match) => match[1])
  // assistant and settings live in the sidebar's secondary actions, not the groups
  for (const extra of [...shell.matchAll(/data-view="([a-z]+)"/g)].map((match) => match[1])) if (!navItems.includes(extra)) navItems.push(extra)
  navItems.splice(0, navItems.length, ...new Set(navItems))
  for (const view of routerViews) assert.ok(navItems.includes(view), `${view} is reachable from the sidebar`)
  for (const view of navItems) assert.ok(routerViews.includes(view), `${view} has a renderer`)
  // the home view is first in both the router and the sidebar
  assert.equal(routerViews[0], 'command')
  assert.equal(navItems[0], 'command')
  // the dock stays small enough to be thumb-reachable on a phone
  const dock = shell.slice(shell.indexOf('<nav id="mobile-dock"'), shell.indexOf('</nav>', shell.indexOf('<nav id="mobile-dock"')))
  const dockItems = (dock.match(/class="dock-item/g) || []).length
  assert.ok(dockItems <= 7, `the dock holds ${dockItems} items (max 7)`)
})

test('every shell icon resolves to a real local SVG path', () => {
  const icons = readFileSync(path.join(root, 'src', 'client', 'ui', 'icons.js'), 'utf8')
  const named = [...shell.matchAll(/svg\('([a-zA-Z]+)'\)/g)].map((match) => match[1])
  const defined = [...icons.matchAll(/^ {2}([a-zA-Z]+):/gm)].map((match) => match[1])
  for (const name of new Set(named)) assert.ok(defined.includes(name), `icon "${name}" is defined`)
})

test('the status strip announces the week, and print stays readable', () => {
  assert.match(shell, /APP_VERSION = '5\.0'/)
  const print = five.slice(five.indexOf('@media print'))
  for (const hidden of ['.sidebar', '.topbar', '.mobile-dock']) assert.ok(print.includes(hidden), `${hidden} is hidden when printing`)
})
