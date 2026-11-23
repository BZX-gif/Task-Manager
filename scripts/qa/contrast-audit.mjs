/**
 * Photograph-aware contrast audit.
 *
 * For each atmosphere, sample the real 2560px photograph at the regions where
 * text sits on the glass, composite the atmosphere grade + the glass scrim +
 * the panel alpha, and report the WCAG ratio for every text role.
 */
import { execFileSync } from 'node:child_process'

const IMG = {
  morning: 'public/images/atmosphere-morning.webp',
  afternoon: 'public/images/atmosphere-afternoon.webp',
  evening: 'public/images/atmosphere-night.webp',
}
// normalized coordinates of regions text sits over (hero + panel areas)
const REGIONS = {
  'hero (top-left, over photo)': [[0.10, 0.16], [0.22, 0.22], [0.36, 0.20]],
  'command panel': [[0.30, 0.40], [0.55, 0.44], [0.42, 0.50]],
  'body panels': [[0.28, 0.62], [0.52, 0.66], [0.70, 0.70]],
  'foot panels': [[0.30, 0.82], [0.60, 0.85], [0.45, 0.90]],
}

const sample = (path, [u, v], size = 9) => {
  const x = Math.round(u * 2560), y = Math.round(v * 1592)
  const out = execFileSync('convert', [path, '-crop', `${size}x${size}+${x - size / 2}+${y - size / 2}`, '-resize', '1x1!', '-format', '%[pixel:p{0,0}]', 'info:'], { encoding: 'utf8' })
  const m = out.match(/(\d+),(\d+),(\d+)/)
  return m ? [+m[1], +m[2], +m[3]] : [128, 110, 90]
}
const blend = (fg, a, bg) => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)))
const hex = (rgb) => '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('')
const lum = (rgb) => {
  const ch = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * ch(rgb[0]) + 0.7152 * ch(rgb[1]) + 0.0722 * ch(rgb[2])
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

// grade per atmosphere, from #atmosphere::after (bottom wash is place-dependent;
// we take the mid-frame value ~0.10 alpha of rgba(10,8,6) plus the atmo grade)
const GRADE = {
  morning: { wash: [10, 8, 6], washAlpha: 0.16, grade: [86, 58, 26], gradeAlpha: 0.10 },
  afternoon: { wash: [10, 8, 6], washAlpha: 0.16, grade: [38, 54, 64], gradeAlpha: 0.08 },
  evening: { wash: [10, 8, 6], washAlpha: 0.30, grade: [6, 9, 20], gradeAlpha: 0.34 },
}
const SCRIM = { glass1: [22, 18, 13], alpha: 0.60, sheenExtra: 0.04 }
const TEXT = {
  ivory: [246, 239, 227],
  champagne: [234, 219, 194],
  muted: [184, 169, 145],
  faint: [240, 229, 211, 0.66],
}
const ROLES = [
  ['display (greeting / titles)', 'ivory', 40, 3],
  ['champagne label', 'champagne', 11, 4.5],
  ['body copy', 'muted', 13.5, 4.5],
  ['faint meta on glass', 'faint', 11, 4.5],
]

let worst = 99
const rows = []
for (const [atmo, file] of Object.entries(IMG)) {
  const g = GRADE[atmo]
  for (const [region, points] of Object.entries(REGIONS)) {
    for (const point of points) {
      const photo = sample(file, point)
      const graded = blend(g.grade, g.gradeAlpha, blend(g.wash, g.washAlpha, photo))
      const panel = blend(SCRIM.glass1, SCRIM.alpha, graded)
      for (const [label, role, size, min] of ROLES) {
        const t = TEXT[role]
        const fg = role === 'faint' ? blend(t.slice(0, 3), t[3], panel) : t
        const r = ratio(fg, panel)
        const pass = r >= min
        worst = Math.min(worst, r)
        rows.push({ atmo, region, label, ratio: r, min, pass, panel: hex(panel) })
      }
    }
  }
}
const failures = rows.filter((r) => !r.pass)
const byKey = new Map()
for (const r of rows) {
  const k = `${r.atmo} · ${r.label}`
  if (!byKey.has(k) || byKey.get(k).ratio > r.ratio) byKey.set(k, r)
}
console.log('worst measured ratio per atmosphere × role (min over sampled regions):\n')
for (const [k, r] of byKey) {
  const flag = r.pass ? 'ok  ' : 'FAIL'
  console.log(`${flag} ${k.padEnd(48)} ${r.ratio.toFixed(2)}:1 (needs ${r.min})  darkest-panel ${r.panel}`)
}
console.log(`\noverall worst: ${worst.toFixed(2)}:1 · failures: ${failures.length}/${rows.length}`)
if (failures.length) {
  console.log('\nfailing samples:')
  for (const f of failures.slice(0, 12)) console.log(`  ${f.atmo} · ${f.region} · ${f.label} → ${f.ratio.toFixed(2)}:1`)
  process.exitCode = 1
}
