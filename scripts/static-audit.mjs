#!/usr/bin/env node
/**
 * CSS + markup static audit:
 *  1. every var(--token) referenced in css/js exists in :root or [data-theme=light]
 *  2. balanced braces / stray syntax per sheet
 *  3. z-index inventory → collision report
 *  4. every getElementById('x') / #id selector in JS exists in shell or template output
 *  5. every data-* hook used in JS appears in some template, and vice versa
 */
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const cssFiles = ['public/static/style.css', 'public/static/system.css', 'public/static/studio.css']
const jsDirs = ['src/client']

const problems = []
const notes = []

// ── load sources ─────────────────────────────────────────────────────────
const css = {}
for (const f of cssFiles) css[f] = await readFile(path.join(root, f), 'utf8')
const allCss = Object.values(css).join('\n')
const shell = await readFile(path.join(root, 'src', 'shell.ts'), 'utf8')

let allJs = ''
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) await walk(p)
    else if (e.name.endsWith('.js')) allJs += `\n/* ${p} */\n` + (await readFile(p, 'utf8'))
  }
}
for (const d of jsDirs) await walk(path.join(root, d))

// ── 1 · token existence ──────────────────────────────────────────────────
const defined = new Set()
for (const m of allCss.matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(m[1])
// css vars
const usedCss = new Set()
for (const m of allCss.matchAll(/var\((--[a-z0-9-]+)/g)) usedCss.add(m[1])
// js vars (style.setProperty / var( in template strings)
const usedJs = new Set()
for (const m of allJs.matchAll(/var\((--[a-z0-9-]+)/g)) usedJs.add(m[1])
for (const m of allJs.matchAll(/setProperty\(\s*'(--[a-z0-9-]+)'/g)) usedJs.add(m[1])
// JS may set --mx/--my dynamically; those don't need :root definition.
const runtimeTokens = new Set(['--mx', '--my'])
for (const t of [...usedCss, ...usedJs]) {
  if (!defined.has(t) && !runtimeTokens.has(t)) problems.push(`token not defined anywhere: ${t}`)
}
notes.push(`tokens: ${defined.size} defined · ${usedCss.size} used in css · ${usedJs.size} used in js`)

// ── 2 · brace balance per sheet ──────────────────────────────────────────
for (const [f, text] of Object.entries(css)) {
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '')
  const open = (stripped.match(/{/g) || []).length
  const close = (stripped.match(/}/g) || []).length
  if (open !== close) problems.push(`${f}: unbalanced braces (${open} open vs ${close} close)`)
  // obvious typos: double semicolons inside declarations are fine; empty rules?
  for (const m of stripped.matchAll(/([^{}]+)\{\s*\}/g)) {
    const sel = m[1].trim().split('\n').pop().trim()
    if (sel && !sel.startsWith('@')) notes.push(`${f}: empty rule — ${sel.slice(0, 60)}`)
  }
}

// ── 3 · z-index inventory ────────────────────────────────────────────────
const zMap = new Map()
for (const [f, text] of Object.entries(css)) {
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '')
  // walk rules crudely: track current selector
  let current = ''
  for (const line of stripped.split('\n')) {
    const selMatch = line.match(/^([^{}@]+)\{/)
    if (selMatch) current = selMatch[1].trim()
    const z = line.match(/z-index:\s*(\d+)/)
    if (z) {
      const key = `${f}::${current.slice(0, 50)}`
      zMap.set(key, Number(z[1]))
    }
  }
}
const zGroups = {}
for (const [k, z] of zMap) (zGroups[z] ??= []).push(k)
for (const [z, keys] of Object.entries(zGroups)) {
  if (keys.length > 3) notes.push(`z-index ${z} shared by ${keys.length} selectors`)
}
notes.push(`z-index layers: ${[...new Set(zMap.values())].sort((a, b) => a - b).join(', ')}`)

// ── 4 · getElementById / querySelector('#id') existence ──────────────────
const markupIds = new Set()
for (const m of (shell + allJs).matchAll(/id="([a-z0-9-]+)"/gi)) markupIds.add(m[1])
for (const m of (shell + allJs).matchAll(/id=\\?"([a-z0-9-]+)\\?"/gi)) markupIds.add(m[1])
const wantedIds = new Map()
for (const m of allJs.matchAll(/getElementById\('([a-z0-9-]+)'\)/g)) wantedIds.set(m[1], (wantedIds.get(m[1]) || 0) + 1)
for (const m of allJs.matchAll(/el\('([a-z0-9-]+)'\)/g)) wantedIds.set(m[1], (wantedIds.get(m[1]) || 0) + 1)
for (const m of allJs.matchAll(/\$\('#([a-z0-9-]+)'\)|qsa?\(document,\s*'#([a-z0-9-]+)'\)/g)) {
  const id = m[1] || m[2]
  wantedIds.set(id, (wantedIds.get(id) || 0) + 1)
}
const missingIds = []
for (const [id] of wantedIds) {
  if (!markupIds.has(id)) missingIds.push(id)
}
if (missingIds.length) notes.push(`ids referenced in JS but not found in any markup: ${missingIds.join(', ') || 'none'}`)
notes.push(`ids: ${markupIds.size} in markup · ${wantedIds.size} referenced in js`)

// ── 5 · data-attribute hooks both ways ───────────────────────────────────
const markupData = new Set()
for (const m of (shell + allJs).matchAll(/data-([a-z0-9-]+)[=>\s]/g)) markupData.add(m[1])
const jsData = new Set()
for (const m of allJs.matchAll(/data-([a-z0-9-]+)/g)) jsData.add(m[1])
const onlyJs = [...jsData].filter((d) => !markupData.has(d))
const onlyMarkup = [...markupData].filter((d) => !jsData.has(d))
if (onlyJs.length) notes.push(`data-attrs only in JS reads: ${onlyJs.slice(0, 12).join(', ')}`)
if (onlyMarkup.length) notes.push(`data-attrs only in markup: ${onlyMarkup.slice(0, 12).join(', ')}`)

// ── report ───────────────────────────────────────────────────────────────
console.log('\n════ STATIC AUDIT REPORT ════')
console.log(`problems: ${problems.length}`)
for (const p of problems.slice(0, 60)) console.log('  ✗ ' + p)
console.log('notes:')
for (const n of notes) console.log('  · ' + n)
process.exit(problems.length ? 1 : 0)
