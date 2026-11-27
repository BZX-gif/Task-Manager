import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (file: string) => readFile(path.join(root, file), 'utf8')

test('print stylesheet hides the app and keeps only the receipt', async () => {
  const css = await read('src/styles.css')
  const printBlock = css.slice(css.indexOf('@media print'))
  assert.ok(printBlock.length > 200)
  for (const selector of ['.sidebar', '.bottom-nav', '.receipt-toolbar', '.receipt-actions', '.toast-stack']) {
    assert.ok(printBlock.includes(selector), `${selector} should be hidden when printing`)
  }
  assert.match(printBlock, /\.main\s*{[^}]*margin:\s*0/)
  assert.match(printBlock, /\.receipt-paper\s*{[^}]*box-shadow:\s*none/)
})

test('receipt paper widths exist for 58mm, 80mm and A4', async () => {
  const css = await read('src/styles.css')
  assert.match(css, /\.receipt-paper\s*{[^}]*width:\s*80mm/)
  assert.match(css, /\.receipt-58\s*{[^}]*width:\s*58mm/)
  assert.match(css, /\.receipt-a4\s*{[^}]*width:\s*190mm/)
})

test('the receipt sets a page size for the selected printer', async () => {
  const source = await read('src/views/Receipt.tsx')
  assert.match(source, /@page \{ size: A4/)
  assert.match(source, /@page \{ size: \$\{state\.settings\.receiptWidth\}mm auto/)
  assert.match(source, /window\.print\(\)/)
})

test('the shell is mobile-first and asks for no extra permissions', async () => {
  const html = await read('index.html')
  assert.match(html, /name="viewport"[^>]*width=device-width/)
  assert.match(html, /lang="en"/)
  assert.match(html, /manifest\.webmanifest/)
  const manifest = JSON.parse(await read('public/manifest.webmanifest'))
  assert.equal(manifest.short_name, 'VoiceBill')
  assert.ok(manifest.icons.length >= 1)
})

test('the app ships self-hosted fonts and no external CDN', async () => {
  const css = await read('src/styles.css')
  assert.ok(!/url\(\s*['"]?https?:/i.test(css), 'styles must not load remote resources')
  assert.ok(!/https:\/\/cdn|fonts\.googleapis/i.test(css), 'no CDN or hosted font references')
  const html = await read('index.html')
  assert.ok(!/https?:\/\/cdn/.test(html))
  assert.equal(html.includes('fonts.googleapis'), false)
})

test('reduced motion is respected', async () => {
  const css = await read('src/styles.css')
  assert.match(css, /prefers-reduced-motion: reduce/)
  assert.match(css, /animation-duration:\s*0\.001ms\s*!important/)
})

test('touch targets and small-screen breakpoints are covered', async () => {
  const css = await read('src/styles.css')
  for (const width of ['960px', '760px', '620px', '380px']) {
    assert.ok(css.includes(`max-width: ${width}`), `${width} breakpoint missing`)
  }
  assert.match(css, /\.btn\s*{[^}]*height:\s*44px/)
  assert.match(css, /\.bottom-nav/)
  assert.match(css, /\.mic-button\s*{[^}]*width:\s*130px/)
})
