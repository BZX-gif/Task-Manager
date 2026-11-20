/**
 * Contrast floors for the two shipped themes.
 *
 * The palette lives in `--muted`, `--text-secondary`, `--text` and the accent
 * ramps in `public/static/style.css`. Secondary text sits on every surface in
 * the app (canvas, card, elevated, hover, sunken), so the *weakest* pairing is
 * the one that matters: muted text on the lightest/darkest surface it can land
 * on. These assertions keep that honest when the palette is edited.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const css = await readFile(path.join(process.cwd(), 'public', 'static', 'style.css'), 'utf8')

const hexToRgb = (hex) => {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16))
}
const luminance = (rgb) => {
  const channel = (value) => {
    const v = value / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2])
}
const contrast = (a, b) => {
  const [l1, l2] = [luminance(hexToRgb(a)), luminance(hexToRgb(b))]
  const [light, dark] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (light + 0.05) / (dark + 0.05)
}

/** Read a custom property from the first rule that declares it. */
function token(name, scope = ':root') {
  const start = css.indexOf(`${scope}{`)
  assert.ok(start >= 0, `${scope} block exists`)
  const end = css.indexOf('}', start)
  const block = css.slice(start, end)
  const match = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,8})`))
  assert.ok(match, `${name} is a hex token inside ${scope}`)
  return match[1]
}

test('muted and secondary text clear WCAG AA on every dark surface', () => {
  const surfaces = [token('--bg'), token('--bg-secondary'), token('--surface'), token('--surface-elevated'), token('--surface-hover'), token('--surface-sunken')]
  for (const name of ['--muted', '--text-secondary', '--text']) {
    const colour = token(name)
    for (const surface of surfaces) {
      const ratio = contrast(colour, surface)
      assert.ok(ratio >= 4.5, `${name} ${colour} on ${surface} is ${ratio.toFixed(2)}:1 (needs 4.5:1)`)
    }
  }
})

test('muted and secondary text clear WCAG AA on every light surface', () => {
  const light = ':root[data-theme=light]'
  const surfaces = ['--bg', '--bg-secondary', '--surface', '--surface-elevated', '--surface-hover', '--surface-sunken'].map((name) => token(name, light))
  for (const name of ['--muted', '--text-secondary', '--text']) {
    const colour = token(name, light)
    for (const surface of surfaces) {
      const ratio = contrast(colour, surface)
      assert.ok(ratio >= 4.5, `${name} ${colour} on ${surface} is ${ratio.toFixed(2)}:1 (needs 4.5:1)`)
    }
  }
})

test('the accent reads as text on the canvas in both themes', () => {
  const light = ':root[data-theme=light]'
  for (const [scope, surfaces] of [
    [':root', ['--bg', '--surface']],
    [light, ['--bg', '--surface']],
  ]) {
    const accent = token('--accent', scope)
    for (const surface of surfaces) {
      const ratio = contrast(accent, token(surface, scope))
      assert.ok(ratio >= 4.5, `accent ${accent} on ${surface} (${scope}) is ${ratio.toFixed(2)}:1 (needs 4.5:1)`)
    }
  }
})

test('primary button ink stays legible on the accent fill', () => {
  for (const scope of [':root', ':root[data-theme=light]']) {
    const ratio = contrast(token('--accent-ink', scope), token('--accent', scope))
    assert.ok(ratio >= 4.5, `accent ink on accent (${scope}) is ${ratio.toFixed(2)}:1`)
  }
})
