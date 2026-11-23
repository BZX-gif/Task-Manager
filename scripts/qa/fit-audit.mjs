/**
 * Horizontal-fit audit, decided from the stylesheet rather than a screenshot.
 *
 * At each breakpoint we walk the real rendered DOM (jsdom, seeded) and check
 * that every element whose CSS fixes a min-width, or that declares a grid with
 * fixed+flexible tracks, can still fit the space its ancestors leave it. Any
 * element that cannot shrink below the available width is a guaranteed
 * overflow — the class of bug the mobile requirement calls out.
 */
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { execFileSync } from 'node:child_process'
import { parseCss, computed, resolveVars, setViewport } from './css.mjs'

const WIDTHS = [1440, 1280, 1024, 900, 768, 640, 430, 390, 360, 320]
const SIDEBAR = (w) => (w >= 1600 ? 264 : w >= 1200 ? 252 : w >= 1024 ? 224 : 0)
const GUTTER = (w) => (w >= 768 ? 44 : 20)

// Build the fixture on demand so the audit is runnable from a clean checkout.
const FIXTURE = '/tmp/command-qa-fixture.html'
execFileSync(process.execPath, ['scripts/qa/preview.mjs', 'auto', 'dashboard', FIXTURE], { stdio: 'ignore' })
// the whole cascade, in load order: a rule in paper.css can widen a layout
const SHEETS = ['style', 'studio', 'system', 'atmosphere', 'paper']
const rules = []
for (const sheet of SHEETS) {
  try { rules.push(...parseCss(await readFile(`public/static/${sheet}.css`, 'utf8'))) } catch { /* optional sheet */ }
}
const px = (v, fallback = 0) => {
  if (v == null || v === '') return fallback
  const n = parseFloat(String(v))
  return Number.isFinite(n) ? n : fallback
}

const parsePx = (v) => String(v).match(/^-?([\d.]+)px$/)
const gridTracks = (tpl) => {
  // returns [{kind, value}] for minmax()/px/fr/% tracks
  const out = []
  const tokens = String(tpl).trim().match(/(minmax\([^)]*\)|[^\s]+)/g) || []
  for (const t of tokens) {
    const mm = t.match(/^minmax\((.*),(.*)\)$/)
    if (mm) {
      const minPart = mm[1].trim(), maxPart = mm[2].trim()
      const min = parsePx(minPart) ? +parsePx(minPart)[1] : /^min-content|auto|max-content$/.test(minPart) ? 0 : 0
      out.push({ kind: 'minmax', min, flexible: /fr$|\.\d+fr/.test(maxPart) })
    } else if (parsePx(t)) out.push({ kind: 'fixed', min: +parsePx(t)[1], flexible: false })
    else if (/fr$/.test(t)) out.push({ kind: 'fr', min: 0, flexible: true })
    else out.push({ kind: 'auto', min: 0, flexible: true })
  }
  return out
}

const problems = []
const COVERAGE = { scopes: 0, widths: 0, nodes: 0 }
for (const width of WIDTHS) {
  setViewport(width)
  const dom = new JSDOM(await readFile(FIXTURE, 'utf8'))
  const doc = dom.window.document
  const contentW = width - SIDEBAR(width) - GUTTER(width) * 2
  const rootEl = doc.documentElement
  const rootPath = [{ tag: 'html', isRoot: true, id: '', classes: Array.from(rootEl.classList || []), attrs: Object.fromEntries(Array.from(rootEl.attributes).filter((a) => a.name.startsWith('data-')).map((a) => [a.name, a.value])) }]
  const rootDecls = resolveVars(computed(rules, rootPath), null, width)

  const pathOf = (el) => {
    const p = []
    let n = el
    while (n && n.nodeType === 1) {
      p.unshift({ tag: n.tagName.toLowerCase(), id: n.id || '', classes: Array.from(n.classList || []), attrs: Object.fromEntries(Array.from(n.attributes).filter((a) => a.name.startsWith('data-')).map((a) => [a.name, a.value])) })
      n = n.parentElement
    }
    return p
  }

  // Every route is measured: PAPER is product-wide, so the fit guarantee has to
  // cover the whole application rather than only the redesigned dashboard.
  const scopeIds = ['dashboard','day','calendar','schedule','hyb','tasks','goals','projects','routines','focus','progress','review','journal','forecast','paper','settings']
  const scopes = scopeIds.map((id) => doc.getElementById(`view-${id}`)).filter(Boolean)
  if (!scopes.length) { problems.push({ width, msg: 'no views in fixture' }); continue }
  COVERAGE.widths += 1
  COVERAGE.scopes = Math.max(COVERAGE.scopes, scopes.length)

  for (const scope of scopes) {
    const scopeId = scope.id.replace('view-', '')
    const all = [scope, ...scope.querySelectorAll('*')]
    COVERAGE.nodes += all.length
    for (const el of all) {
      const style = resolveVars(computed(rules, pathOf(el)), rootDecls, width)
      const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''
      const label = `${scopeId} · ${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls ? '.' + cls : ''}`
      const minW = style['min-width']
      if (parsePx(minW) && +parsePx(minW)[1] > contentW) {
        problems.push({ width, el: label.slice(0, 96), msg: `min-width ${minW} exceeds the ${Math.round(contentW)}px content column` })
      }
      if (style.display && /grid/.test(style.display) && style['grid-template-columns']) {
        const tracks = gridTracks(style['grid-template-columns'])
        if (tracks.length > 1) {
          const fixedMin = tracks.reduce((a, t) => a + t.min, 0)
          const gaps = (tracks.length - 1) * px(style.gap ?? style['column-gap'], 0)
          if (fixedMin + gaps > contentW + 1) {
            problems.push({ width, el: label.slice(0, 96), msg: `grid min ${Math.round(fixedMin + gaps)}px > content ${Math.round(contentW)}px (${style['grid-template-columns']})` })
          }
        }
      }
      if (parsePx(style.width) && +parsePx(style.width)[1] > contentW + 40) {
        problems.push({ width, el: label.slice(0, 96), msg: `hard width ${style.width} > content ${Math.round(contentW)}px` })
      }
    }
  }
}

const seen = new Set()
const unique = problems.filter((p) => { const k = p.el + p.msg.replace(/\d+/g, '#') + p.msg.slice(30, 60); if (seen.has(k)) return false; seen.add(k); return true })
if (!unique.length) {
  console.log(`✔ fit audit: ${COVERAGE.scopes} routes × ${COVERAGE.widths} widths (${COVERAGE.nodes} boxes): no guaranteed horizontal overflow`)
} else {
  console.log(`✖ fit audit: ${unique.length} guaranteed-overflow sites\n`)
  for (const p of unique.slice(0, 30)) console.log(`  ${p.width}px · ${p.el}\n      ${p.msg}`)
  process.exitCode = 1
}
