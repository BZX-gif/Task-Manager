#!/usr/bin/env node
/**
 * Zero-dependency project lint. It checks the things that actually break this
 * app: leaked secrets, a browser-side Gemini client, syntax errors, missing
 * assets, CDN regressions and `window.CC` calls that have no implementation.
 *
 * Exit code 1 on any problem so `npm run lint` fails loudly in CI.
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const problems = []
const notes = []

async function walk(dir, filter) {
  const out = []
  let entries = []
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', '.git', 'vendor'].includes(entry.name)) continue
      out.push(...(await walk(full, filter)))
    } else if (filter(full)) {
      out.push(full)
    }
  }
  return out
}

const rel = (file) => path.relative(root, file)
const clientFiles = await walk(path.join(root, 'src'), (f) => f.endsWith('.js') || f.endsWith('.ts'))

/* 1 — secrets must never live in the repo at all */
const SECRET_PATTERNS = [
  { name: 'Gemini/Google API key', re: /(AIza[0-9A-Za-z_-]{20,}|AQ\.[0-9A-Za-z_-]{20,})/ },
  { name: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'hardcoded bearer token', re: /Authorization['"]\s*:\s*['"]Bearer\s+[A-Za-z0-9._-]{20,}/ },
]
const scanned = [
  ...clientFiles,
  ...(await walk(path.join(root, 'public'), (f) => f.endsWith('.js'))),
  ...(await walk(path.join(root, 'scripts'), (f) => f.endsWith('.mjs'))),
  path.join(root, 'src', 'ai.ts'),
  path.join(root, 'wrangler.jsonc'),
  path.join(root, 'README.md'),
]
for (const file of scanned) {
  const text = await readFile(file, 'utf8').catch(() => '')
  for (const { name, re } of SECRET_PATTERNS) {
    if (re.test(text)) problems.push(`${rel(file)}: possible ${name} committed to the repository`)
  }
}

/* 2 — the browser must never call Gemini directly (server code is exempt) */
const browserFiles = clientFiles.filter((f) => rel(f).startsWith('src/client/'))
for (const file of browserFiles) {
  const text = await readFile(file, 'utf8')
  if (/generativelanguage\.googleapis\.com/.test(text)) {
    problems.push(`${rel(file)}: browser must not call the Gemini API directly (use /api/ai)`)
  }
  if (/x-goog-api-key/i.test(text)) {
    problems.push(`${rel(file)}: browser code must not send a Gemini API key`)
  }
}

/* 3 — every JS file must parse */
for (const file of clientFiles) {
  if (!file.endsWith('.js')) continue
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
  if (result.status !== 0) {
    problems.push(`${rel(file)}: syntax error\n${(result.stderr || '').split('\n').slice(0, 4).join('\n')}`)
  }
}

/* 4 — no CDN Tailwind / runtime-only dependencies in the shell */
const shell = await readFile(path.join(root, 'src', 'shell.ts'), 'utf8')
if (/cdn\.tailwindcss\.com/.test(shell)) problems.push('src/shell.ts: cdn.tailwindcss.com is back (it warns in production)')
if (/cdn\.jsdelivr\.net/.test(shell)) problems.push('src/shell.ts: third-party CDN scripts should be bundled instead')
if (/fonts\.(googleapis|gstatic)\.com/.test(shell)) problems.push('src/shell.ts: fonts are self-hosted — remove the Google Fonts CDN link')
for (const asset of ['/static/js/app.js', '/static/tailwind.css', '/static/style.css', '/static/fonts.css', '/static/vendor/fontawesome/css/all.min.css']) {
  if (!shell.includes(asset)) problems.push(`src/shell.ts: expected to reference ${asset}`)
}

/* 5 — generated assets referenced by the shell must exist after a build */
const requiredArtifacts = ['public/static/js/app.js', 'public/static/tailwind.css', 'public/static/fonts.css', 'public/static/vendor/fontawesome/css/all.min.css']
for (const artifact of requiredArtifacts) {
  try {
    await stat(path.join(root, artifact))
  } catch {
    notes.push(`${artifact} not built yet — run "npm run build:client" (lint still passes)`)
  }
}

/* 6 — every window.CC.<method> used in the UI must exist on the CC API */
const mainText = await readFile(path.join(root, 'src', 'client', 'main.js'), 'utf8')
const apiBlock = mainText.slice(mainText.indexOf('window.CC = {'))
const apiEnd = apiBlock.indexOf('\n}')
const apiSource = apiBlock.slice(0, apiEnd)
const apiKeys = new Set()
for (const match of apiSource.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*)\s*[:(,]/gm)) apiKeys.add(match[1])

const usedKeys = new Map()
for (const file of clientFiles) {
  const text = await readFile(file, 'utf8')
  for (const match of text.matchAll(/(?:window\.)?CC\.([a-zA-Z][a-zA-Z0-9]*)/g)) {
    if (!usedKeys.has(match[1])) usedKeys.set(match[1], rel(file))
  }
}
for (const [key, file] of usedKeys) {
  if (!apiKeys.has(key)) problems.push(`${file}: CC.${key} is used but not exported from the CC API in main.js`)
}

/* 7 — no stray debug logging in shipped client code */
for (const file of clientFiles) {
  const text = await readFile(file, 'utf8')
  if (/^\s*console\.log\(/m.test(text)) problems.push(`${rel(file)}: console.log left in client code (use console.warn/info or remove)`)
}

/* 8 — dynamic imports make the single-bundle build fragile */
for (const file of clientFiles) {
  const text = await readFile(file, 'utf8')
  if (/\bimport\s*\(/.test(text)) problems.push(`${rel(file)}: dynamic import() in client code — keep the bundle static`)
}

if (notes.length) {
  console.log('ℹ notes')
  for (const note of notes) console.log(`  • ${note}`)
}
if (problems.length) {
  console.error(`\n✖ lint found ${problems.length} problem${problems.length === 1 ? '' : 's'}:`)
  for (const problem of problems) console.error(`  • ${problem}`)
  process.exit(1)
}
console.log(`✔ lint passed (${clientFiles.length} source files, ${usedKeys.size} CC API calls verified)`)
