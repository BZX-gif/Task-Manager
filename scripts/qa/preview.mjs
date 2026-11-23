/**
 * Renders the real Worker + client bundle inside jsdom, seeds the workspace,
 * and writes the shell's DOM to a standalone HTML file for a headless browser
 * screenshot. Uses the *built* client so breakpoints and CSS are real.
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { JSDOM, VirtualConsole } from 'jsdom'

const root = process.cwd()
const [atmo = 'auto', view = 'dashboard', out = '/tmp/preview.html', seedPath] = process.argv.slice(2)

const worker = (await import(path.join(root, 'dist', 'index.js'))).default
const shell = await (await worker.request('/')).text()
const bundle = await readFile(path.join(root, 'public', 'static', 'js', 'app.js'), 'utf8')
// A worked example workspace so screenshots show a lived-in day. Any state
// file can be passed instead; without one the fixture is built in memory.
const { emptyState, normalizeState } = await import(path.join(root, 'src', 'client', 'lib', 'state.js'))
const { DEFAULT_SETTINGS } = await import(path.join(root, 'src', 'client', 'lib', 'defaults.js'))
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
function seedState() {
  const today = new Date()
  const key = iso(today)
  const at = (h, m) => { const d = new Date(today); d.setHours(h, m, 0, 0); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
  const now = today.getTime()
  const s = emptyState()
  s.settings = { ...DEFAULT_SETTINGS, ...s.settings, userName: 'Asha', salutation: 'Sir', atmosphere: 'auto' }
  const task = (id, title, time, priority, estimateMinutes, done = false) => ({ id, title, time, priority, estimateMinutes, done, date: key, cat: null, createdAt: now, ...(done ? { completedAt: now } : {}) })
  s.tasks = [
    task('t1', 'Review the villa collection brief', at(9, 30), 'high', 90),
    task('t2', 'Call the Aranya landscape studio', at(15, 30), 'medium', 30),
    task('t3', 'Lunch on the terrace', at(13, 0), 'low', 45, true),
    task('t4', 'Walk before sunset', at(17, 40), 'medium', 40),
    task('t5', 'Read the final chapter of the monograph', null, 'low', 45),
  ]
  s.top3 = { [key]: ['t1', 't2', 't5'] }
  s.goals = [{ id: 'g1', title: 'Open the coastal residence', status: 'active', progress: 50, createdAt: now }]
  s.scoreHistory = Object.fromEntries([...Array(6)].map((_, i) => { const d = new Date(today); d.setDate(d.getDate() - (6 - i)); return [iso(d), { score: 42 + i * 7, tasksDone: 1 + (i % 3), tasksPlanned: 4, focusedMinutes: 30 + i * 10 }] }))
  return s
}
const seed = seedPath ? JSON.parse(await readFile(seedPath, 'utf8')) : seedState()
if (atmo !== 'auto') seed.settings = { ...(seed.settings || {}), atmosphere: atmo }

const errors = []
const vc = new VirtualConsole()
vc.on('jsdomError', (e) => errors.push(`jsdomError: ${e.message}`))
vc.on('error', (m) => errors.push(`console.error: ${m}`))

const dom = new JSDOM(shell, { url: 'https://command-center.test/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc })
const { window } = dom
window.fetch = async () => new Response('{"text":"ok"}', { status: 200, headers: { 'content-type': 'application/json' } })
window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
window.scrollTo = () => {}
window.HTMLCanvasElement.prototype.getContext = () => null
window.localStorage.setItem('kcc_state_v1', JSON.stringify(seed))
window.eval(bundle)
await new Promise((r) => setTimeout(r, 400))
if (view !== 'dashboard') window.CC.switchView(view)
await new Promise((r) => setTimeout(r, 400))

const html = window.document.documentElement.outerHTML
  .replace('<head>', `<head><base href="http://localhost:5173/" />`)
await writeFile(out, `<!DOCTYPE html>\n${html}`)
console.log('wrote', out, 'errors:', errors.length ? errors.join(' | ') : 'none')
window.close()
