/**
 * The atmosphere engine is the visual identity's contract.
 *
 * These are behavioural assertions on the pure engine plus structural
 * assertions on the shipped assets: the boundaries, the manual override, the
 * greeting split, the three WebP photographs, the selector wiring and the
 * reduced-motion / reduced-transparency promises.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  ATMOSPHERES,
  atmosphereForHour,
  atmosphereForDate,
  resolveAtmosphere,
  nextAtmosphere,
  atmosphereInfo,
  splitGreeting,
  isAtmosphereMode,
  DEFAULT_ATMOSPHERE_MODE,
} from '../../src/client/lib/atmosphere.js'
import { normalizeSettings } from '../../src/client/lib/state.js'
import { DEFAULT_SETTINGS } from '../../src/client/lib/defaults.js'

const root = process.cwd()
const css = await readFile(path.join(root, 'public', 'static', 'atmosphere.css'), 'utf8')
const shell = await readFile(path.join(root, 'src', 'shell.ts'), 'utf8')
const sw = await readFile(path.join(root, 'public', 'sw.js'), 'utf8')
const ui = await readFile(path.join(root, 'src', 'client', 'ui', 'atmosphere.js'), 'utf8')
const dashboard = await readFile(path.join(root, 'src', 'client', 'views', 'dashboard.js'), 'utf8')

/* ------------------------------------------------------------------ engine */

test('the boundaries are 05:00 morning, 12:00 afternoon and 17:00 evening', () => {
  assert.equal(atmosphereForHour(4), 'evening', '04:59 still reads as night')
  assert.equal(atmosphereForHour(5), 'morning')
  assert.equal(atmosphereForHour(11), 'morning')
  assert.equal(atmosphereForHour(12), 'afternoon')
  assert.equal(atmosphereForHour(16), 'afternoon')
  assert.equal(atmosphereForHour(17), 'evening')
  assert.equal(atmosphereForHour(23), 'evening')
  assert.equal(atmosphereForHour(0), 'evening')
  for (let h = 0; h < 24; h++) assert.ok(['morning', 'afternoon', 'evening'].includes(atmosphereForHour(h)), `hour ${h} resolves`)
})

test('a Date is read in local time, never UTC', () => {
  const morning = new Date(2026, 10, 23, 6, 30, 0)
  assert.equal(atmosphereForDate(morning), 'morning')
  const night = new Date(2026, 10, 23, 22, 15, 0)
  assert.equal(atmosphereForDate(night), 'evening')
})

test('a manual choice always wins; auto follows the clock', () => {
  const evening = new Date(2026, 10, 23, 21, 0, 0)
  assert.equal(resolveAtmosphere('auto', evening), 'evening')
  assert.equal(resolveAtmosphere('morning', evening), 'morning', 'the override survives the clock')
  assert.equal(resolveAtmosphere('nonsense', evening), 'evening', 'an unknown stored value falls back to time')
  assert.equal(resolveAtmosphere(undefined, evening), 'evening')
})

test('the default is auto and the stored value is normalised', () => {
  assert.equal(DEFAULT_ATMOSPHERE_MODE, 'auto')
  assert.equal(DEFAULT_SETTINGS.atmosphere, 'auto')
  assert.equal(normalizeSettings({}).atmosphere, 'auto')
  assert.equal(normalizeSettings({ atmosphere: 'evening' }).atmosphere, 'evening')
  assert.equal(normalizeSettings({ atmosphere: 'midnight' }).atmosphere, 'auto', 'an invalid value can never lock the UI')
  assert.equal(normalizeSettings({ atmosphere: 42 }).atmosphere, 'auto')
})

test('every mode the selector can send is accepted', () => {
  for (const mode of ['auto', 'morning', 'afternoon', 'evening']) assert.equal(isAtmosphereMode(mode), true)
  for (const bad of ['dusk', '', null, undefined, 1]) assert.equal(isAtmosphereMode(bad), false)
})

test('the three environments form a cycle for preloading', () => {
  assert.equal(nextAtmosphere('morning'), 'afternoon')
  assert.equal(nextAtmosphere('afternoon'), 'evening')
  assert.equal(nextAtmosphere('evening'), 'morning')
  assert.equal(ATMOSPHERES.length, 3)
  for (const entry of ATMOSPHERES) {
    assert.match(entry.image, /^\/images\/atmosphere-[a-z]+\.webp$/)
    assert.match(entry.imageSmall, /-sm\.webp$/)
    assert.ok(entry.greeting.startsWith('Good '), 'each environment ships its own greeting')
    assert.ok(entry.note.length > 20, 'and a line of context')
  }
})

test('the greeting splits into an address and a name without losing punctuation', () => {
  assert.deepEqual(splitGreeting('Good evening, Sir.'), { part: 'Good evening,', name: 'Sir.' })
  assert.deepEqual(splitGreeting('Good morning, Asha.'), { part: 'Good morning,', name: 'Asha.' })
  assert.deepEqual(splitGreeting('A quiet moment'), { part: 'A quiet moment', name: '' })
  assert.deepEqual(splitGreeting(''), { part: '', name: '' })
})

test('the greeting tokens the hero renders are the engine’s, dot supplied by CSS', () => {
  // the hero strips the trailing period and re-adds it with ::after, so the
  // two never double up
  assert.match(dashboard, /name\.replace\(\/\\\.\$\/, ''\)/)
  assert.match(css, /\.atmo-greeting \.greeting-name::after\{content:'.'/)
})

/* ----------------------------------------------------------------- assets */

test('all three photographs exist at full and small size, in WebP', async () => {
  for (const entry of ATMOSPHERES) {
    for (const file of [entry.image, entry.imageSmall]) {
      const info = await stat(path.join(root, 'public', file)).catch(() => null)
      assert.ok(info && info.size > 40_000, `${file} is a real photograph`)
    }
  }
})

test('the photographs are optimised, not raw dumps', async () => {
  for (const entry of ATMOSPHERES) {
    const full = (await stat(path.join(root, 'public', entry.image))).size
    const small = (await stat(path.join(root, 'public', entry.imageSmall))).size
    assert.ok(full < 420_000, `${entry.image} stays under 420 kB (${Math.round(full / 1024)} kB)`)
    assert.ok(small < 160_000, `${entry.imageSmall} stays under 160 kB (${Math.round(small / 1024)} kB)`)
    assert.ok(small < full, 'the small variant is genuinely smaller')
  }
})

test('the sheet, the fonts and the photographs are shipped and precached', () => {
  assert.match(shell, /\/static\/atmosphere\.css/, 'the shell links the atmosphere sheet')
  assert.match(shell, /preload[^>]*instrument-serif-400\.woff2/, 'the display face is preloaded')
  assert.match(shell, /preload[^>]*dm-sans-400\.woff2/, 'the body face is preloaded')
  assert.match(sw, /\/static\/atmosphere\.css/, 'the service worker precaches the sheet')
  for (const entry of ATMOSPHERES) {
    assert.ok(sw.includes(entry.imageSmall), `${entry.imageSmall} is available offline`)
  }
  assert.doesNotMatch(shell, /fonts\.(googleapis|gstatic)\.com|@import\s+url\(['"]?https?:/, 'fonts stay local')
})

test('the pre-paint script selects the atmosphere before the first paint', () => {
  // it must live inline in <head> so the photograph class is right at paint 1
  const head = shell.slice(shell.indexOf('<head>'), shell.indexOf('</head>'))
  assert.match(head, /dataset\.atmosphere=/, 'the document carries the atmosphere before CSS paints')
  assert.match(head, /dataset\.atmosphereView=/, 'and the scope the stylesheet keys off')
  assert.match(head, /atmosphereMode/, 'and records whether the choice is manual')
  assert.match(head, /preload/, 'and asks for the right photograph immediately')
  for (const hour of ['h>=5&&h<12', 'h>=12&&h<17']) assert.ok(head.includes(hour), 'the inline boundaries match the engine')
})

/* -------------------------------------------------------------- behaviour */

test('the crossfade only animates opacity and honours reduced motion', () => {
  assert.match(css, /\.atmo-layer\{[^}]*transition:opacity/)
  assert.doesNotMatch(css, /\.atmo-layer\{[^}]*(transform|filter):/)
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion:reduce)'))
  assert.match(reduced, /\.atmo-layer\{transition:opacity 1ms linear\}/, 'reduced motion swaps without a fade')
  assert.match(css, /@media \(prefers-reduced-transparency:reduce\)/, 'opaque glass is offered')
  assert.match(css, /--glass-blur:26px/, 'blur sits inside the 20–30px brief')
})

test('the blur budget is lowered on phones instead of paid at full cost', () => {
  const mobile = css.slice(css.indexOf('@media (max-width:767px){\n  :root{--glass-blur'))
  assert.match(mobile.slice(0, 200), /--glass-blur:14px/, 'small screens use a thinner blur')
  assert.match(css, /--glass-blur:26px/, 'desktop keeps the 20–30px brief')
})

test('the glass is warm translucent ivory with a fine border, not frosted plastic', () => {
  assert.match(css, /--glass-1:rgba\(22,18,13,\.60\)/, 'the scrim is warm and deep enough for contrast')
  assert.match(css, /--glass-line:rgba\(246,236,220,\.16\)/, 'the hairline is low opacity warm white')
  assert.match(css, /backdrop-filter:blur\(var\(--glass-blur\)\) saturate\(135%\)/)
})

test('the palette has no generic SaaS blue or neon in the accent family', () => {
  const accentBlock = css.match(/:root\{\n  --accent:#[0-9A-Fa-f]{6};--accent-rgb:[^}]*\}/)?.[0] || ''
  assert.ok(accentBlock, 'the accent family is declared as the warm metal')
  assert.match(accentBlock, /--accent:#C69A5E/, 'champagne bronze, not blue')
})

test('loading a photograph never blocks: the small file paints first', () => {
  assert.match(ui, /imageSmall/, 'the layer starts on the small file')
  assert.match(ui, /upgradeLayer/, 'and upgrades to full size after decode')
  assert.match(ui, /requestIdleCallback|setTimeout\(fn, 900\)/, 'the neighbour is warmed off the critical path')
  assert.match(ui, /preload\s*\n?\s*\.decode\(\)/, 'decode happens before the swap')
})

test('the manual selector is a real radiogroup with arrow keys', () => {
  assert.match(ui, /role="radiogroup"/)
  assert.match(ui, /aria-checked="\$\{/)
  assert.match(ui, /ArrowRight/)
  assert.match(ui, /ArrowLeft/)
  assert.match(ui, /data-atmosphere-choice/)
})

test('the customer-facing copy uses the atmosphere name', () => {
  // the hero says "Morning in the villa", the note underneath explains it
  assert.match(dashboard, /\$\{escapeHtml\(atmosphereInfo\(atmosphereId\)\.label\)\} in the villa/)
  assert.match(dashboard, /atmosphereInfo\(atmosphereId\)\.note/)
})

test('the dashboard keeps every functional hook the application relies on', () => {
  for (const hook of [
    'data-command-start', 'data-command-complete', 'data-command-delay', 'data-command-block',
    'data-priority-toggle', 'data-priority-edit', 'data-priority-up', 'data-priority-down',
    'data-priority-delay', 'data-priority-add', 'data-score-info', 'data-recovery-toggle',
    'data-recovery-resume', 'data-recovery-reschedule', 'data-recovery-postpone', 'data-recovery-abandon',
    'data-common="new-task"', 'data-common="plan"', 'data-common="focus"',
    'data-common="calendar"', 'data-common="schedule"', 'data-common="briefing"',
    'overview-greeting', 'overview-clock', 'day-progress-fill', 'overviewWeekChart',
  ]) {
    assert.ok(dashboard.includes(hook), `the redesigned dashboard still ships ${hook}`)
  }
})

/* -------------------------------------------------- cascade & token contract */

test('the sheets load in a deliberate order: base, atmosphere, then paper', () => {
  const links = [...shell.matchAll(/href="\/static\/([\w-]+)\.css"/g)].map((m) => m[1])
  assert.ok(links.includes('style'), 'the base sheet is still shipped')
  const atmo = links.indexOf('atmosphere')
  const paper = links.indexOf('paper')
  assert.ok(atmo > links.indexOf('system'), 'atmosphere overrides the base sheets')
  assert.ok(paper > atmo, 'and paper, the global design system, overrides both')
  assert.equal(links[links.length - 1], 'paper', `sheet order is ${links.join(' → ')}`)
})

test('the redesign does not steal the signature-font or mono tokens', () => {
  // `instrument` in settings · Appearance resolves to --font-mono, so the
  // redesigned sheet must leave that token as a monospace stack.
  const mono = css.match(/--font-mono:([^;]+);/)?.[1] ?? ''
  assert.ok(/mono|Menlo|Consolas|'SF Mono'/.test(mono), `--font-mono stays monospace (got ${mono.trim()})`)
  assert.doesNotMatch(mono, /^'DM Sans'/, 'the body sans must not overwrite the mono token')

  // and the three signature modes must still be expressible after this sheet
  const editorial = css.slice(css.indexOf(':root[data-signature-font=editorial]'))
  assert.match(editorial.slice(0, 400), /font-family:var\(--font-serif\)/, 'editorial keeps the serif')
  const instrument = css.slice(css.indexOf(':root[data-signature-font=instrument]'))
  assert.match(instrument.slice(0, 400), /font-family:var\(--font-mono\)/, 'instrument keeps the mono face')
  for (const target of ['.page-heading h1', '.overview-greeting h1', '.briefing-salute']) {
    assert.ok(editorial.slice(0, 400).includes(target), `${target} still honours the preference`)
  }
})

test('the accent family is identical in both themes so no cool blue leaks in', () => {
  const light = css.slice(css.indexOf(':root[data-theme=light]'))
  const accent = light.slice(0, 600).match(/--accent:#([0-9A-Fa-f]{6})/)
  assert.ok(accent, 'light theme declares its own warm accent')
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(accent[1].slice(i - 1, i + 1), 16))
  assert.ok(r > b && g > b, `light accent ${accent[1]} is warm (r=${r} g=${g} b=${b})`)
})

test('the offline shell ships the italic serif that draws the greeting', () => {
  // the greeting name is italic Instrument Serif; without this file the
  // signature element silently degrades to a synthesised oblique
  assert.match(sw, /instrument-serif-400-italic\.woff2/, 'the italic face is precached')
  const italicFace = css.slice(0, css.indexOf("url('/static/fonts/dm-sans-400.woff2')"))
  assert.match(italicFace, /@font-face\s*\{[^}]*font-style:\s*italic[^}]*instrument-serif-400-italic\.woff2/s, 'the italic face is declared')
})

test('every precached shell asset is a real file in the tree', async () => {
  const list = [...sw.matchAll(/^\s*'(\/[^']*)',$/gm)].map((m) => m[1])
  assert.ok(list.length >= 15, `precache list has ${list.length} entries`)
  for (const asset of list) {
    if (asset === '/') continue
    const info = await stat(path.join(root, 'public', asset)).catch(() => null)
    assert.ok(info, `${asset} is missing from public/ — install would fail`)
  }
})
