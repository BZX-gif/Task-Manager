/**
 * Route surface inventory.
 *
 * Boots the real app once and records, for every route, the markup vocabulary
 * it emits: page headings, card classes, tables, bespoke component classes and
 * the count of interactive hooks. This is the audit the redesign plan is built
 * from — it shows what already exists so nothing is redesigned blind or lost.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { JSDOM, VirtualConsole } from 'jsdom'

const root = process.cwd()
const worker = (await import(path.join(root, 'dist', 'index.js'))).default
const shell = await (await worker.request('/')).text()
const bundle = await readFile(path.join(root, 'public', 'static', 'js', 'app.js'), 'utf8')
const today = new Date()
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const key = iso(today)
const at = (h, m = 0) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
const now = Date.now()

const vc = new VirtualConsole()
const errors = []
vc.on('jsdomError', (e) => errors.push(e.message))
const dom = new JSDOM(shell, { url: 'https://command-center.test/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc })
const { window } = dom
window.fetch = async () => new Response('{"text":"ok"}', { status: 200 })
window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
window.scrollTo = () => {}
window.HTMLCanvasElement.prototype.getContext = () => null
const { emptyState } = await import(path.join(root, 'src/client/lib/state.js'))
const { DEFAULT_SETTINGS } = await import(path.join(root, 'src/client/lib/defaults.js'))
const s = emptyState()
s.settings = { ...DEFAULT_SETTINGS, ...s.settings, userName: 'Asha', salutation: 'Sir', atmosphere: 'auto' }
const task = (id, title, time, priority, estimateMinutes, done = false, extra = {}) => ({ id, title, time, priority, estimateMinutes, done, date: key, cat: null, createdAt: now, ...(done ? { completedAt: now } : {}), ...extra })
s.tasks = [
  task('t1', 'Review the villa collection brief', at(9, 30), 'high', 90, false, { goalId: 'g1', projectId: 'p1' }),
  task('t2', 'Call the Aranya landscape studio', at(15, 30), 'medium', 30),
  task('t3', 'Lunch on the terrace', at(13, 0), 'low', 45, true),
  task('t4', 'Walk before sunset', at(17, 40), 'medium', 40),
  task('t5', 'Read the final chapter', null, 'low', 45, false, { goalId: 'g1' }),
]
s.tasksTomorrow = null
s.top3 = { [key]: ['t1', 't2', 't5'] }
s.goals = [{ id: 'g1', title: 'Open the coastal residence', why: 'A quieter life, closer to the water.', status: 'active', progress: 50, targetDate: iso(new Date(now + 120 * 864e5)), milestones: [{ id: 'm1', title: 'Site survey', done: true }, { id: 'm2', title: 'Structural drawings', done: false }], createdAt: now }]
s.projects = [{ id: 'p1', title: 'Villa collection', description: 'The autumn editorial.', status: 'active', progress: 40, goalId: 'g1', createdAt: now }]
s.missions = [{ id: 'ms1', title: 'Autumn editorial', exam: 'Villa', year: 2026, targetRole: 'Curator', target: 'Publish', createdAt: now }]
s.routines = [{ id: 'r1', title: 'Morning ritual', type: 'Personal', time: '07:00', days: [0, 1, 2, 3, 4, 5, 6], activities: [{ id: 'a1', title: 'Tea + walk', duration: 30 }], archived: false, createdAt: now }]
s.scoreHistory = Object.fromEntries([...Array(6)].map((_, i) => { const d = new Date(today); d.setDate(d.getDate() - (6 - i)); return [iso(d), { score: 40 + i * 8, tasksDone: 1 + (i % 3), tasksPlanned: 4, focusedMinutes: 25 + i * 12 }] }))
s.focusSessions = [{ id: 'f1', date: key, startedAt: now - 3600e3, endedAt: now - 1800e3, minutes: 30, taskId: 't1', completed: true }]
s.journal = {}
window.localStorage.setItem('kcc_state_v1', JSON.stringify(s))
window.eval(bundle)
await new Promise((r) => setTimeout(r, 600))

const VIEWS = ['dashboard', 'day', 'calendar', 'schedule', 'hyb', 'tasks', 'goals', 'projects', 'routines', 'focus', 'progress', 'review', 'journal', 'forecast', 'paper', 'settings']
const INTERACTIVE = /\[data-(?!atmosphere|view)[\w-]+/g
const rows = []
for (const view of VIEWS) {
  window.CC.switchView(view)
  await new Promise((r) => setTimeout(r, 320))
  const section = window.document.getElementById(`view-${view}`)
  if (!section) { rows.push({ view, missing: true }); continue }
  const classes = new Set()
  for (const el of section.querySelectorAll('[class]')) for (const c of el.classList) classes.add(c)
  const hooks = new Set([...section.innerHTML.matchAll(new RegExp(INTERACTIVE)).map((m) => m[0].slice(6))])
  rows.push({
    view,
    nodes: section.querySelectorAll('*').length,
    bytes: section.innerHTML.length,
    headings: [...section.querySelectorAll('h1,h2,h3')].map((h) => h.tagName + ':' + h.textContent.trim().slice(0, 38)),
    cards: [...classes].filter((c) => /card|panel|grid|table|journal|paper|atmo/.test(c)).sort(),
    classes: [...classes],
    hooks: [...hooks].sort(),
    empties: [...section.querySelectorAll('.empty-state')].length,
  })
}
await readFile(path.join(root, 'package.json'), 'utf8')
const { writeFile } = await import('node:fs/promises')
await writeFile('/tmp/surface.json', JSON.stringify({ views: rows, errors }, null, 2))
console.log('view'.padEnd(11), 'nodes'.padStart(6), 'KB'.padStart(7), ' empty  hooks  headings')
for (const r of rows) {
  if (r.missing) { console.log(r.view.padEnd(11), 'MISSING'); continue }
  console.log(r.view.padEnd(11), String(r.nodes).padStart(6), (r.bytes / 1024).toFixed(1).padStart(7), String(r.empties).padStart(6), String(r.hooks.length).padStart(6), '  ', (r.headings[0] || '—').slice(0, 46))
}
console.log('\nerrors:', errors.length ? errors.slice(0, 4) : 'none')
console.log('wrote /tmp/surface.json')
window.close()
