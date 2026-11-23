/**
 * Fetches the two typefaces the interface is set in, self-hosted.
 *
 * The design system uses Instrument Serif (display) and DM Sans (body). They
 * are *never* loaded from a remote origin at runtime — tests forbid it — so the
 * binaries live in the repository. This script is what produced them, and it
 * re-creates them for a clean checkout or when the version pin changes.
 *
 *   node scripts/fetch-fonts.mjs
 */
import { mkdir, writeFile, stat } from 'node:fs/promises'
import path from 'node:path'

const OUT = path.join(process.cwd(), 'public', 'static', 'fonts')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

const FACES = [
  { file: 'instrument-serif-400.woff2', family: 'Instrument+Serif', axis: 'ital,wght@0,400' },
  { file: 'instrument-serif-400-italic.woff2', family: 'Instrument+Serif', axis: 'ital,wght@1,400' },
  { file: 'dm-sans-400.woff2', family: 'DM+Sans', axis: 'wght@400' },
  { file: 'dm-sans-500.woff2', family: 'DM+Sans', axis: 'wght@500' },
  { file: 'dm-sans-600.woff2', family: 'DM+Sans', axis: 'wght@600' },
  { file: 'dm-sans-700.woff2', family: 'DM+Sans', axis: 'wght@700' },
]

const cssUrl = (f) => `https://fonts.googleapis.com/css2?family=${f.family}:${f.axis}&display=swap`

async function woff2For(url) {
  const css = await (await fetch(url, { headers: { 'User-Agent': UA } })).text()
  // chrom* answers with unicode-range subsets; latin is always last
  const urls = [...css.matchAll(/url\((https:\/\/[^)]+\.woff2)\)/g)].map((m) => m[1])
  if (!urls.length) throw new Error(`no woff2 in response for ${url}`)
  return urls[urls.length - 1]
}

await mkdir(OUT, { recursive: true })
let fetched = 0
for (const face of FACES) {
  const dest = path.join(OUT, face.file)
  const existing = await stat(dest).catch(() => null)
  if (existing && existing.size > 2000) {
    console.log(`· ${face.file} already present (${(existing.size / 1024).toFixed(1)} kB)`)
    continue
  }
  const href = await woff2For(cssUrl(face))
  const res = await fetch(href)
  if (!res.ok) throw new Error(`${href} → ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.subarray(0, 4).toString('latin1') !== 'wOF2') throw new Error(`${face.file} is not a woff2`)
  await writeFile(dest, buf)
  fetched += 1
  console.log(`✔ ${face.file} (${(buf.length / 1024).toFixed(1)} kB)`)
}
console.log(fetched ? `\nfonts written to ${path.relative(process.cwd(), OUT)}` : '\nall fonts already present')
