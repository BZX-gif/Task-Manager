#!/usr/bin/env node
/**
 * Canvas-mode repro — boots the real bundle in jsdom with a WORKING 2d
 * context stub so Chart.js actually executes its full pipeline (including
 * per-frame scriptable options), the way a real browser does. Catches the
 * class of bugs the null-canvas harnesses cannot see.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { JSDOM, VirtualConsole } from 'jsdom'

const root = process.cwd()
const worker = (await import(path.join(root, 'dist', 'index.js'))).default
const shell = await (await worker.request('/')).text()
const bundle = await readFile(path.join(root, 'public', 'static', 'js', 'app.js'), 'utf8')

const errors = []
const warnings = []
const vc = new VirtualConsole()
vc.on('jsdomError', (e) => errors.push(`jsdomError: ${e.message}\n${(e.detail?.stack || e.stack || '').split('\n').slice(0, 6).join('\n')}`))
vc.on('error', (...a) => errors.push(`console.error: ${a.map((x) => (x && x.stack) ? x.stack.split('\n').slice(0, 6).join('\n') : String(x)).join(' ')}`))
vc.on('warn', (...a) => warnings.push(`warn: ${a.join(' ')}`))

// ── a 2d context that behaves well enough for Chart.js ───────────────────
function makeGradient() { return { addColorStop() {} } }
function makeCtx2d(canvas) {
  const noop = () => {}
  const ctx = {
    canvas,
    save: noop, restore: noop, beginPath: noop, closePath: noop,
    moveTo: noop, lineTo: noop, bezierCurveTo: noop, quadraticCurveTo: noop,
    arc: noop, arcTo: noop, ellipse: noop, rect: noop, roundRect: noop,
    fill: noop, stroke: noop, clip: noop, fillRect: noop, strokeRect: noop,
    clearRect: noop, fillText: noop, strokeText: noop, drawImage: noop,
    translate: noop, rotate: noop, scale: noop, setTransform: noop, transform: noop,
    setLineDash: noop, getLineDash: () => [], resetTransform: noop, getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }), measureText: (t) => ({ width: String(t ?? '').length * 6 }),
    createLinearGradient: makeGradient, createRadialGradient: makeGradient,
    createPattern: () => ({ setTransform: noop }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: noop, createImageData: () => ({ data: new Uint8ClampedArray(4) }),
    // writable style properties
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
    globalAlpha: 1, globalCompositeOperation: 'source-over', lineCap: '', lineJoin: '',
    lineDashOffset: 0, shadowBlur: 0, shadowColor: '', shadowOffsetX: 0, shadowOffsetY: 0,
    miterLimit: 10, filter: 'none', direction: 'ltr',
  }
  return ctx
}

const dom = new JSDOM(shell, {
  url: 'https://command-center.test/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  virtualConsole: vc,
})
const { window } = dom
const { document } = window
window.fetch = async () => new Response('{}', { status: 200 })
window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
window.scrollTo = () => {}
window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
window.HTMLCanvasElement.prototype.getContext = function getContext(type) {
  if (type === '2d') { this._ctx2d = this._ctx2d || makeCtx2d(this); return this._ctx2d }
  return null
}
window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,'
window.addEventListener('error', (e) => errors.push(`window error: ${e.message}\n${(e.error?.stack || '').split('\n').slice(0, 8).join('\n')}`))
process.on('uncaughtException', (e) => errors.push(`uncaught: ${e.message}`))

window.eval(bundle)

const settle = (ms) => new Promise((r) => setTimeout(r, ms))
await settle(120)

// drive the chart views + a second pass (destroy/recreate) + theme switch
const CC = window.CC
for (const round of [1, 2]) {
  for (const v of ['dashboard', 'progress', 'forecast', 'focus', 'day', 'schedule']) {
    try { CC.switchView(v) } catch (e) { errors.push(`[${v}:r${round}] switchView threw: ${e.stack ? e.stack.split('\n').slice(0, 8).join('\n') : e.message}`) }
    await settle(120) // let rAF animation frames tick
  }
}
// toggle theme and redraw charts (chartColors() re-reads tokens)
try {
  document.documentElement.dataset.theme = 'light'
  CC.refreshAll()
  await settle(150)
  CC.switchView('dashboard'); await settle(120)
  CC.switchView('progress'); await settle(120)
  CC.switchView('forecast'); await settle(150)
} catch (e) {
  errors.push(`theme redraw threw: ${e.message}`)
}

const uniq = [...new Set(errors)]
const uniqWarn = [...new Set(warnings)].filter((w) => !/Not implemented/.test(w))
console.log('\n════ CANVAS-MODE REPRO ════')
console.log(`errors: ${uniq.length} · warnings: ${uniqWarn.length}`)
for (const e of uniq.slice(0, 40)) console.log('  ✗ ' + e)
for (const w of uniqWarn.slice(0, 15)) console.log('  ⚠ ' + w.slice(0, 160))
if (!uniq.length) console.log('  ✔ chart pipeline ran clean with a live 2d context')
process.exit(uniq.length ? 1 : 0)
