#!/usr/bin/env node
/**
 * Class-coverage audit: every class name the markup/JS emits must have at
 * least one CSS rule, or be a known dynamic/variant token. Catches rules
 * silently dropped in redesigns (e.g. invisible accent swatches).
 */
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const cssFiles = ['public/static/style.css', 'public/static/system.css', 'public/static/studio.css']
let allCss = ''
for (const f of cssFiles) allCss += (await readFile(path.join(root, f), 'utf8')) + '\n'

let allJs = ''
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) await walk(p)
    else if (e.name.endsWith('.js')) allJs += `\n/*${p}*/\n` + (await readFile(p, 'utf8'))
  }
}
await walk(path.join(root, 'src', 'client'))
allJs += '\n/*shell*/\n' + (await readFile(path.join(root, 'src', 'shell.ts'), 'utf8'))
allJs += '\n/*index*/\n' + (await readFile(path.join(root, 'index.html'), 'utf8').catch(() => ''))

// ── collect class tokens ─────────────────────────────────────────────────
const classes = new Map()
const add = (token, where) => {
  const t = token.trim()
  if (!t) return
  if (!classes.has(t)) classes.set(t, where)
}
for (const m of allJs.matchAll(/class=\\?"([^"\\]*)\\?"/g)) {
  for (const t of m[1].split(/\s+/)) add(t, m[1].slice(0, 40))
}
for (const m of allJs.matchAll(/className\s*=\s*['"`]([^'"`]*)/g)) {
  for (const t of m[1].split(/\s+/)) add(t, 'className')
}
for (const m of allJs.matchAll(/classList\.(?:add|toggle|remove)\(\s*['"`]([a-z0-9-]+)/gi)) add(m[1], 'classList')
for (const m of allJs.matchAll(/\$\{\s*[^}]*\?\s*'([a-z0-9-]+)'\s*:\s*'([a-z0-9-]+)'\s*\}/g)) { add(m[1], 'ternary'); add(m[2], 'ternary') }

// ── styled? ──────────────────────────────────────────────────────────────
const unstyled = []
const dynamic = []
for (const [token] of classes) {
  if (token.includes('${') || token.includes('$')) { dynamic.push(token); continue }
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(token)) { dynamic.push(token); continue }
  // state/hook classes that are structural, not visual — still check them
  const re = new RegExp(`\\.${token.replace(/-/g, '\\-')}(?![a-zA-Z0-9_-])`)
  if (!re.test(allCss)) unstyled.push(token)
}

console.log('\n════ CLASS COVERAGE AUDIT ════')
console.log(`classes emitted: ${classes.size} · dynamic/unparsed: ${dynamic.length}`)
console.log(`\nunstyled (${unstyled.length}):`)
for (const t of unstyled.sort()) console.log('  ✗ .' + t)
console.log(`\ndynamic families to verify manually:`)
const fams = [...new Set(dynamic.filter((d) => d.length > 1).map((d) => d.split('-').slice(0, 2).join('-')))]
for (const f of fams.sort()) console.log('  · ' + f)
process.exit(0)
