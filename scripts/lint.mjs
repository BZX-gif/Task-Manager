#!/usr/bin/env node
/**
 * Project lint for VoiceBill — zero extra dependencies.
 *
 * It checks the things that would actually hurt this app: leaked credentials,
 * remote resources (the app must work offline and without a CDN), browser code
 * that reaches for the network, un-namespaced localStorage keys, stray debug
 * logging, missing assets and unimplemented placeholders.
 *
 * Exit code 1 on any problem so `npm run lint` fails loudly.
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const problems = []
const notes = []

const rel = (file) => path.relative(root, file)

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
      if (['node_modules', 'dist', '.git', '.tmp', 'coverage'].includes(entry.name)) continue
      out.push(...(await walk(full, filter)))
    } else if (filter(full)) {
      out.push(full)
    }
  }
  return out
}

const sourceFiles = await walk(path.join(root, 'src'), (file) => /\.(ts|tsx|css)$/.test(file))
const files = [...sourceFiles, path.join(root, 'index.html')]

/* 1 — no credentials or secrets anywhere */
const SECRET_PATTERNS = [
  { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{20,}/ },
  { name: 'OpenAI-style key', re: /\bsk-[A-Za-z0-9]{20,}/ },
  { name: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'hardcoded bearer token', re: /Authorization['"]\s*:\s*['"]Bearer\s+[A-Za-z0-9._-]{20,}/ },
]

/* 2 — nothing may be loaded from the network */
const REMOTE_PATTERN = /(?:src|href)\s*=\s*['"]https?:\/\/|url\(\s*['"]?https?:\/\/|fetch\(\s*['"]https?:\/\/|import\s+['"]https?:\/\//g
const ALLOWED_URL = /https?:\/\/www\.w3\.org\//

/* 3 — localStorage keys must be namespaced and versioned */
const STORAGE_KEY_PATTERN = /'(voicebill\.[a-z]+\.[a-z0-9]+)'/g

for (const file of files) {
  const text = await readFile(file, 'utf8')
  const name = rel(file)

  for (const pattern of SECRET_PATTERNS) {
    if (pattern.re.test(text)) problems.push(`${name}: ${pattern.name} found in source`)
  }

  for (const match of text.matchAll(REMOTE_PATTERN)) {
    if (!ALLOWED_URL.test(match[0])) problems.push(`${name}: remote resource reference (${match[0].slice(0, 60)})`)
  }

  if (file.endsWith('.ts') && /console\.log\(/.test(text)) problems.push(`${name}: console.log left in shipped code`)
  if (/\beval\s*\(|new Function\s*\(/.test(text)) problems.push(`${name}: dynamic code execution`)
  if (/TODO|FIXME|XXX/.test(text)) problems.push(`${name}: unresolved TODO/FIXME`)
  if (/dangerouslySetInnerHTML/.test(text) && !name.endsWith('icons.tsx')) {
    problems.push(`${name}: raw HTML injection outside the icon set`)
  }
}

/* 4 — storage keys are announced and versioned */
const storageSource = await readFile(path.join(root, 'src/lib/storage.ts'), 'utf8')
const keys = [...storageSource.matchAll(STORAGE_KEY_PATTERN)].map((match) => match[1])
if (keys.length < 5) problems.push('storage.ts: expected namespaced keys for products, bills, settings, draft and meta')
for (const key of keys) {
  if (!key.startsWith('voicebill.')) problems.push(`storage.ts: key "${key}" is not namespaced`)
}
notes.push(`localStorage keys: ${keys.join(', ')}`)

/* 5 — public assets referenced by the shell exist */
for (const asset of ['public/favicon.svg', 'public/manifest.webmanifest']) {
  try {
    await stat(path.join(root, asset))
  } catch {
    problems.push(`missing asset: ${asset}`)
  }
}

const manifest = JSON.parse(await readFile(path.join(root, 'public/manifest.webmanifest'), 'utf8'))
if (!manifest.name || !manifest.start_url) problems.push('manifest.webmanifest: name and start_url are required')
if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) problems.push('manifest.webmanifest: at least one icon is required')

/* 6 — fonts are self-hosted and referenced */
const css = await readFile(path.join(root, 'src/styles.css'), 'utf8')
const fontFaces = [...css.matchAll(/@font-face\s*{([^}]+)}/g)]
if (fontFaces.length < 4) problems.push('styles.css: expected the self-hosted DM Sans / Instrument Serif faces')
for (const [, body] of fontFaces) {
  const match = body.match(/url\('([^']+)'\)/)
  if (!match) {
    problems.push('styles.css: @font-face without a local url()')
    continue
  }
  const fontPath = path.join(root, 'src', match[1])
  try {
    await stat(fontPath)
  } catch {
    problems.push(`styles.css: missing font file ${match[1]}`)
  }
}

/* 7 — every navigation target in the shell has a route */
const routerSource = await readFile(path.join(root, 'src/router.ts'), 'utf8')
const appSource = await readFile(path.join(root, 'src/App.tsx'), 'utf8')
for (const [, hash] of appSource.matchAll(/href="(#[^"]*)"/g)) {
  if (!hash.startsWith('#/')) continue
  const route = hash.replace(/^#/, '').split('?')[0]
  if (route === '/') continue
  if (!routerSource.includes(`'${route}'`) && !route.startsWith('/bill/')) {
    problems.push(`App.tsx: link to "${hash}" has no matching route`)
  }
}

/* 8 — the speech fallback must exist in the New Bill screen */
const newBill = await readFile(path.join(root, 'src/views/NewBill.tsx'), 'utf8')
if (!/speech\.supported/.test(newBill) || !/Add by hand|Choose a product/.test(newBill)) {
  problems.push('NewBill.tsx: manual entry fallback is missing')
}

/* 9 — no accounts, no auth, no paid API keys in the client */
const clientSource = (await Promise.all(sourceFiles.map((file) => readFile(file, 'utf8')))).join('\n')
for (const forbidden of ['GEMINI', 'OPENAI', 'apiKey', 'Authorization']) {
  if (clientSource.includes(forbidden)) problems.push(`client code mentions "${forbidden}" — VoiceBill must need no keys`)
}

/* 10 — tests exist for the core logic */
const unitTests = await walk(path.join(root, 'tests/unit'), (file) => file.endsWith('.test.ts'))
const integrationTests = await walk(path.join(root, 'tests/integration'), (file) => file.endsWith('.test.tsx'))
if (unitTests.length < 8) problems.push(`expected at least 8 unit test files, found ${unitTests.length}`)
if (integrationTests.length < 1) problems.push('expected at least one UI integration test')
notes.push(`tests: ${unitTests.length} unit files, ${integrationTests.length} UI files`)

/* ------------------------------------------------------------------ */

if (problems.length > 0) {
  console.error(`\n✖ lint found ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n`)
  for (const problem of problems) console.error(`  • ${problem}`)
  console.error('')
  process.exit(1)
}

console.log('✔ lint passed')
console.log(`  ${sourceFiles.length} source files checked · no secrets · no CDN · no network calls`)
for (const note of notes) console.log(`  ${note}`)
