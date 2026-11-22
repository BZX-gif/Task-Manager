/* -------------------------------------------------------------------------
   CHARTS — Chart.js is registered once here so views just create charts.
   Canvas is optional (jsdom/offline): every call is guarded and returns null
   when a chart cannot be drawn, so the rest of the UI keeps working.
   ------------------------------------------------------------------------- */
import { Chart, registerables } from 'chart.js'

Chart.register(...registerables)
Chart.defaults.color = '#939CB0'
Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable Text', 'Segoe UI', Roboto, sans-serif"
// Merge — never replace. Chart.js reads Object.keys(defaults.animation) to
// decide which animation fields (incl. `type: 'color'`) reach every tween;
// replacing this object with { duration } silently drops `type`, every colour
// tween then resolves `interpolators[typeof from]` → undefined, and each
// frame throws "this._fn is not a function" until the chart is destroyed.
Chart.defaults.animation = { ...Chart.defaults.animation, duration: 320 }

const registry = new Map()
const signatures = new Map()

/**
 * Create (or replace) a chart on a canvas id. Returns the chart or null.
 * @param {string} canvasId
 * @param {any} config Chart.js configuration
 */
export function drawChart(canvasId, config) {
  /** @type {HTMLCanvasElement|null} */
  const canvas = /** @type {any} */ (document.getElementById(canvasId))
  if (!canvas || typeof canvas.getContext !== 'function') return null
  const existing = registry.get(canvasId)
  if (existing) {
    // Skip rebuilds when nothing changed (the per-minute repaint hits this),
    // and never let a poisoned chart take a render down.
    try {
      const signature = JSON.stringify([config.type, config.data, config.options])
      if (signatures.get(canvasId) === signature) return existing
      existing.destroy()
    } catch { /* keep rendering */ }
    registry.delete(canvasId)
    signatures.delete(canvasId)
  }
  try {
    if (typeof canvas.getContext('2d')?.createLinearGradient !== 'function') return null
    const chart = new Chart(/** @type {any} */ (canvas), config)
    registry.set(canvasId, chart)
    signatures.set(canvasId, JSON.stringify([config.type, config.data, config.options]))
    return chart
  } catch (error) {
    console.warn('[charts] could not render', canvasId, error?.message || error)
    return null
  }
}

export function destroyAllCharts() {
  for (const [, chart] of registry) {
    try { chart.destroy() } catch { /* keep the view switch alive */ }
  }
  registry.clear()
  signatures.clear()
}

export { Chart }

/** Rebuild a colour at a new alpha. Handles hex and rgba() token values. */
export function alpha(color, value) {
  const hex = String(color || '')
  if (hex.startsWith('#')) {
    const n = hex.length === 4 ? hex.slice(1).split('').map((c) => c + c).join('') : hex.slice(1)
    return `#${n.slice(0, 6)}${Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, '0')}`
  }
  return hex.replace(/rgba\((\d+),\s*(\d+),\s*(\d+),[^)]*\)/, `rgba($1,$2,$3,${value})`)
}

/** A soft vertical fill so charts read as light, not slabs. */
export function vGrad(chart, top, bottom) {
  const h = chart?.height || 1
  const g = chart.ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, top)
  g.addColorStop(1, bottom)
  return g
}

/** Read semantic tokens at draw time, so light/dark and accent changes agree. */
export function chartColors() {
  const style = typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement) : null
  const read = (name, fallback) => style?.getPropertyValue(name).trim() || fallback
  return {
    accent: read('--accent', '#FF8A4C'),
    text: read('--text', '#EEF1F7'),
    series: read('--chart-series', 'rgba(255,255,255,.16)'),
    seriesStrong: read('--chart-series-strong', 'rgba(255,255,255,.72)'),
    seriesHover: read('--chart-series-hover', 'rgba(255,255,255,.36)'),
    muted: read('--muted', '#939CB0'),
    border: read('--border', 'rgba(255,255,255,.09)'),
    success: read('--success', '#7FC9A8'),
    warning: read('--warning', '#E2BC85'),
    danger: read('--danger', '#EFA0A0'),
    surface: read('--surface', '#12161F'),
    tooltipBg: read('--chart-tooltip-bg', 'rgba(18,22,31,.96)'),
    tooltipBorder: read('--chart-tooltip-border', 'rgba(255,255,255,.14)'),
  }
}
