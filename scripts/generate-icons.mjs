#!/usr/bin/env node
/**
 * Generates the PWA icons with zero dependencies (a tiny PNG encoder +
 * supersampled rasteriser). Run `npm run icons` after changing the artwork.
 *
 * Output: public/icons/icon-192.png, icon-512.png, icon-maskable-512.png,
 *         apple-touch-icon.png
 */
import { deflateSync } from 'node:zlib'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'public', 'icons')

/* ------------------------------------------------------------- PNG encoder */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (let i = 0; i < buffer.length; i++) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuffer = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

function encodePng(width, height, rgba) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* -------------------------------------------------------------- rasteriser */

const hexToRgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

const BG_FROM = hexToRgb('#141a30')
const BG_TO = hexToRgb('#05070d')
const STROKE = hexToRgb('#7c5cff')
const BOLT_A = hexToRgb('#7c5cff')
const BOLT_B = hexToRgb('#22d3ee')
const BOLT_C = hexToRgb('#34d399')

/** bolt outline in a 512×512 design space */
const BOLT = [
  [300, 84],
  [170, 288],
  [244, 288],
  [214, 428],
  [352, 214],
  [274, 214],
]

function insideRoundedRect(x, y, size, radius, inset = 0) {
  const min = inset
  const max = size - inset
  if (x < min || x > max || y < min || y > max) return false
  const r = Math.max(0, radius - inset)
  const cx = Math.min(Math.max(x, min + r), max - r)
  const cy = Math.min(Math.max(y, min + r), max - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

function insidePolygon(x, y, polygon) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Colour + alpha for one point of the 512-space design. */
function sample(x, y, { maskable }) {
  const pad = maskable ? 56 : 0
  const inner = 512 - pad * 2
  const px = (x - pad) / inner * 512
  const py = (y - pad) / inner * 512
  if (px < 0 || py < 0 || px > 512 || py > 512) return null

  const t = Math.min(1, Math.max(0, (px / 512 + py / 512) / 2))
  if (!insideRoundedRect(px, py, 512, 112)) return null
  let color = mix(BG_FROM, BG_TO, t)

  const inInner = insideRoundedRect(px, py, 512, 96, 26)
  if (!inInner && insideRoundedRect(px, py, 512, 112, 24)) {
    color = mix(color, STROKE, 0.55)
  }
  if (insidePolygon(px, py, BOLT)) {
    const bt = Math.min(1, Math.max(0, (px / 512 + py / 512) / 2))
    color = bt < 0.55 ? mix(BOLT_A, BOLT_B, bt / 0.55) : mix(BOLT_B, BOLT_C, (bt - 0.55) / 0.45)
  }
  return color
}

function renderIcon(size, { maskable = false, ss = 4 } = {}) {
  const buffer = Buffer.alloc(size * size * 4)
  const step = 1 / ss
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let hits = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const samplePoint = sample((x + (sx + 0.5) * step) * (512 / size), (y + (sy + 0.5) * step) * (512 / size), { maskable })
          if (samplePoint) {
            r += samplePoint[0]
            g += samplePoint[1]
            b += samplePoint[2]
            hits++
          }
        }
      }
      const total = ss * ss
      const offset = (y * size + x) * 4
      if (hits) {
        buffer[offset] = Math.round(r / hits)
        buffer[offset + 1] = Math.round(g / hits)
        buffer[offset + 2] = Math.round(b / hits)
        buffer[offset + 3] = Math.round((hits / total) * 255)
      }
    }
  }
  return encodePng(size, size, buffer)
}

await mkdir(outDir, { recursive: true })
const targets = [
  ['icon-192.png', 192, { maskable: false }],
  ['icon-512.png', 512, { maskable: false }],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, { maskable: false }],
]
for (const [name, size, options] of targets) {
  const png = renderIcon(size, options)
  await writeFile(path.join(outDir, name), png)
  console.log(`✔ icons/${name} (${size}×${size}, ${(png.length / 1024).toFixed(1)} kB)`)
}
