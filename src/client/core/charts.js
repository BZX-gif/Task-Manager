/* -------------------------------------------------------------------------
   CHARTS — Chart.js is registered once here so views just create charts.
   Canvas is optional (jsdom/offline): every call is guarded and returns null
   when a chart cannot be drawn, so the rest of the UI keeps working.
   ------------------------------------------------------------------------- */
import { Chart, registerables } from 'chart.js'

Chart.register(...registerables)
Chart.defaults.color = '#8b8d98'
Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif"
Chart.defaults.animation = { duration: 320 }

const registry = new Map()

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
  if (existing) existing.destroy()
  try {
    if (typeof canvas.getContext('2d')?.createLinearGradient !== 'function') return null
    const chart = new Chart(/** @type {any} */ (canvas), config)
    registry.set(canvasId, chart)
    return chart
  } catch (error) {
    console.warn('[charts] could not render', canvasId, error?.message || error)
    return null
  }
}

export function destroyAllCharts() {
  for (const [, chart] of registry) chart.destroy()
  registry.clear()
}

export { Chart }

/** Read semantic tokens at draw time, so light/dark and accent changes agree. */
export function chartColors() {
  const style = typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement) : null
  const read = (name, fallback) => style?.getPropertyValue(name).trim() || fallback
  const accent = read('--accent', '#b4a3f5')
  const accentRgb = read('--accent-rgb', '180,163,245')
  return {
    accent,
    soft: `rgba(${accentRgb},.16)`,
    softStrong: `rgba(${accentRgb},.42)`,
    muted: read('--text-muted', '#92939c'),
    border: read('--border', '#2c2d33'),
    success: read('--success', '#8ac6ad'),
    warning: read('--warning', '#d7b582'),
    surface: read('--surface', '#191a1e'),
    tooltipBg: read('--chart-tooltip-bg', 'rgba(13,14,18,.94)'),
    tooltipBorder: read('--chart-tooltip-border', 'rgba(255,255,255,.14)'),
  }
}
