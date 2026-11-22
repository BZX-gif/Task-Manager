#!/usr/bin/env node
/* Palette tuning helper (design-time QA, not part of npm run verify).
   Checks the same WCAG floors as tests/unit/theme-contrast.test.js against a
   candidate palette so the shipped tokens are proven before they are typed. */
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

const dark = {
  '--bg': '#090B10', '--bg-secondary': '#0D1017', '--surface': '#12161F',
  '--surface-elevated': '#181D28', '--surface-hover': '#202634', '--surface-sunken': '#06080C',
  '--text': '#EEF1F7', '--text-secondary': '#AFB7C9', '--muted': '#939CB0', '--accent': '#FF8A4C',
}
const light = {
  '--bg': '#F4F5F8', '--bg-secondary': '#EBEDF3', '--surface': '#FFFFFF',
  '--surface-elevated': '#F8F9FC', '--surface-hover': '#E7EAF1', '--surface-sunken': '#ECEEF4',
  '--text': '#12151C', '--text-secondary': '#4C5568', '--muted': '#5D6679', '--accent': '#B8481B',
}

let fail = 0
const check = (label, ratio) => {
  const ok = ratio >= 4.5
  if (!ok) fail++
  console.log(`${ok ? '✓' : '✗'} ${label}: ${ratio.toFixed(2)}:1`)
}
for (const [name, theme] of [['dark', dark], ['light', light]]) {
  const surfaces = ['--bg', '--bg-secondary', '--surface', '--surface-elevated', '--surface-hover', '--surface-sunken']
  for (const textToken of ['--muted', '--text-secondary', '--text']) {
    for (const s of surfaces) check(`${name} ${textToken} on ${s}`, contrast(theme[textToken], theme[s]))
  }
  for (const s of ['--bg', '--surface']) check(`${name} accent on ${s}`, contrast(theme['--accent'], theme[s]))
}

// accent ramps: dark accents must clear 4.5 on dark bg+surface; light accents on light bg+surface
const accentsDark = { ember: '#FF8A4C', iris: '#B7A7F7', blue: '#97BAF0', sage: '#9CCCB5', amber: '#E0C08E', rose: '#E1ACC0' }
const accentsLight = { ember: '#B8481B', iris: '#6F59B8', blue: '#3E6CA9', sage: '#3D7A60', amber: '#8F682D', rose: '#A0596F' }
for (const [k, v] of Object.entries(accentsDark)) {
  check(`dark accent ${k} on --bg`, contrast(v, dark['--bg']))
  check(`dark accent ${k} on --surface`, contrast(v, dark['--surface']))
}
for (const [k, v] of Object.entries(accentsLight)) {
  check(`light accent ${k} on --bg`, contrast(v, light['--bg']))
  check(`light accent ${k} on --surface`, contrast(v, light['--surface']))
}
console.log(fail ? `\n${fail} failures` : '\nall clear')
