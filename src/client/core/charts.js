/* -------------------------------------------------------------------------
   CHARTS — Chart.js is registered once here so views just create charts.
   Canvas is optional (jsdom/offline): every call is guarded and returns null
   when a chart cannot be drawn, so the rest of the UI keeps working.
   ------------------------------------------------------------------------- */
import { Chart, registerables } from 'chart.js'

Chart.register(...registerables)
Chart.defaults.color = '#828b99'
Chart.defaults.font.family = "Manrope, ui-sans-serif, system-ui, sans-serif"
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
