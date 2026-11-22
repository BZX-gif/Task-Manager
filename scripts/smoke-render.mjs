#!/usr/bin/env node
/**
 * Local QA harness (not part of `npm run verify`).
 * Boots the real client bundle inside jsdom against the real shell, walks
 * every view and a set of dialogs in both a populated and an empty workspace,
 * and reports console errors, render sizes and suspicious output.
 *
 *   node scripts/smoke-render.mjs
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { JSDOM, VirtualConsole } from 'jsdom'

const root = process.cwd()
const worker = (await import(path.join(root, 'dist', 'index.js'))).default
const shell = await (await worker.request('/')).text()
const bundle = await readFile(path.join(root, 'public', 'static', 'js', 'app.js'), 'utf8')

const settle = (ms = 90) => new Promise((r) => setTimeout(r, ms))
const today = new Date().toISOString().slice(0, 10)
const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10)

function seedState() {
  return {
    version: 8,
    hyb: {
      plans: [
        { id: 'h1', title: 'Evening revision — polity', date: today, startTime: '18:30', minutes: 90, kind: 'study', priority: 'high', energy: 'deep', repeat: 'none', status: 'planned', notes: 'Previous year questions.', tags: ['mock'], steps: [{ id: 'hs1', title: 'Set the timer', done: false }, { id: 'hs2', title: 'Write without the phone', done: false }], log: {}, missionId: null, goalId: 'g1', projectId: null, createdAt: 1, updatedAt: 1, completedAt: null },
        { id: 'h2', title: 'Morning run', date: day(-6), startTime: '06:15', minutes: 40, kind: 'body', priority: 'medium', energy: 'steady', repeat: 'daily', status: 'planned', notes: '', tags: [], steps: [], log: { [day(-1)]: 'done', [today]: 'skipped' }, createdAt: 1, updatedAt: 1, completedAt: null },
        { id: 'h3', title: 'Call the bank', date: null, startTime: null, minutes: 20, kind: 'personal', priority: 'low', energy: 'light', repeat: 'none', status: 'planned', notes: '', tags: [], steps: [], log: {}, createdAt: 1, updatedAt: 1, completedAt: null },
        { id: 'h4', title: 'Idea for the essay', date: day(3), startTime: '21:00', minutes: 25, kind: 'idea', priority: 'medium', energy: 'light', repeat: 'weekly', status: 'planned', notes: '', tags: ['essay'], steps: [], log: {}, createdAt: 1, updatedAt: 1, completedAt: null },
      ],
    },
    journal: {
      [day(-1)]: { note: 'Held the morning block and shipped the audit.', win: 'Shipped the audit', nextStep: 'Send the summary', mood: 'good', energy: 'medium', updatedAt: Date.now() - 864e5 },
      [day(-2)]: { note: 'Slow start, but I showed up.', win: 'Showed up', nextStep: 'Sleep earlier', mood: 'steady', energy: 'low', updatedAt: Date.now() - 2 * 864e5 },
    },
    categories: [{ id: 'work', name: 'Work', color: '#7ba7ea' }, { id: 'learning', name: 'Learning', color: '#79bca5' }],
    tasks: [
      { id: 't1', title: 'Ship the design audit', date: today, time: '09:00', estimateMinutes: 90, priority: 'high', cat: 'work', done: false, status: 'ready', inbox: false, createdAt: 1, goalId: 'g1', projectId: null, milestoneId: null, subtasks: [{ id: 's1', title: 'Read sources', done: true }, { id: 's2', title: 'Write findings', done: false }], history: [] },
      { id: 't2', title: 'Review pull requests', date: today, time: '11:00', estimateMinutes: 45, priority: 'medium', cat: 'work', done: true, status: 'completed', inbox: false, createdAt: 2, completedAt: 3, history: [] },
      { id: 't3', title: 'Evening reading', date: today, estimateMinutes: 30, priority: 'low', cat: 'learning', done: false, status: 'ready', inbox: false, createdAt: 3, history: [] },
      { id: 't4', title: 'Old unfinished mission', date: day(-2), estimateMinutes: 30, priority: 'medium', done: false, status: 'ready', inbox: false, createdAt: 4, history: [] },
      { id: 't5', title: 'Someday idea', inbox: true, done: false, status: 'ready', createdAt: 5, history: [] },
    ],
    goals: [{ id: 'g1', title: 'Run a marathon', category: 'Body', status: 'active', targetDate: day(90), progressMode: 'milestones', milestones: [{ id: 'm1', title: '10k run', done: true }, { id: 'm2', title: 'Half marathon', done: false }], createdAt: 1 }],
    projects: [{ id: 'p1', title: 'Redesign Command', goalId: 'g1', status: 'active', startDate: day(-7), targetDate: day(14), createdAt: 1 }],
    routines: [{ id: 'r1', title: 'Morning stretch', scheduleType: 'weekly', days: [1, 2, 3, 4, 5], activities: [{ id: 'a1', title: 'Stretch 10m', done: false }], archived: false, createdAt: 1 }],
    schedule: { days: { [today]: [{ id: 'b1', time: '09:00', title: 'Deep work', duration: 90, taskId: 't1', cat: 'work', priority: 'high' }, { id: 'b2', time: '13:00', title: 'Lunch walk', duration: 30, protected: true }] }, history: [] },
    timetables: {},
    completionLog: { [day(-1)]: { ttDone: [], taskDone: ['x1'] }, [today]: { ttDone: [], taskDone: ['t2'] } },
    focus: { active: null, sessions: [{ id: 'f1', taskId: 't1', mode: 'focus', startedAt: Date.now() - 36e5, endedAt: Date.now() - 36e5 + 15e5, plannedSeconds: 1500, focusedSeconds: 1500, completed: true, dateKey: today }] },
    top3: { [today]: ['t1', 't3'] },
    dayPlans: {},
    reviews: {},
    reminders: {},
    chatHistory: [{ role: 'user', text: 'How should I plan today?', ts: Date.now() }, { role: 'model', text: 'Start with your highest priority.', ts: Date.now() }],
    scoreHistory: { [day(-1)]: 62, [day(-2)]: 48, [today]: 35 },
    settings: { userName: 'Asha', theme: 'dark', accent: 'ember', timeFormat: '12h', weekStart: 1, sidebarCollapsed: false, dayEnd: '22:00', defaultTaskMinutes: 45, workingHours: { start: '08:00', end: '20:00' }, focus: { defaultMinutes: 25, targetMinutes: 180, breakMinutes: 5, longBreakMinutes: 20, longBreakEvery: 4, autoStartBreaks: false, autoCompleteTask: false }, reminders: { enabled: true, timetable: true, taskDue: true, overdue: true, routines: false, respectProtectedTime: true, beforeMinutes: 10, planningAt: '08:00', top3NudgeAt: '15:00', reviewAt: '18:00', reviewDay: 5, permissionRequested: false, desktopNotifications: false }, protectedTime: [{ id: 'pt1', label: 'Sleep', start: '23:00', end: '06:00', days: [] }], hyb: { defaultMinutes: 60, defaultKind: 'study', showOnCalendar: true, deckOnLoad: false }, calendar: { mode: 'month', layers: { blocks: true, missions: true, hyb: true, routines: true, deadlines: true, journal: true } } },
  }
}

async function boot(seed) {
  const virtualConsole = new VirtualConsole()
  const errors = []
  virtualConsole.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message))
  virtualConsole.on('error', (m) => errors.push('console.error: ' + m))
  const dom = new JSDOM(shell, { url: 'https://command-center.test/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole })
  const { window } = dom
  window.HTMLCanvasElement.prototype.getContext = () => null
  window.scrollTo = () => {}
  window.fetch = async () => new Response(JSON.stringify({ text: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } })
  if (seed) window.localStorage.setItem('kcc_state_v1', JSON.stringify(seed))
  window.eval(bundle)
  await settle(140)
  return { dom, window, errors, $: (s) => window.document.querySelector(s) }
}

const VIEWS = ['dashboard', 'day', 'calendar', 'hyb', 'schedule', 'tasks', 'goals', 'projects', 'routines', 'focus', 'progress', 'review', 'journal', 'forecast', 'paper', 'settings']
let failures = 0

async function walk(label, seed) {
  const { window, errors, $ } = await boot(seed)
  try {
    console.log(`\n== ${label} ==`)
    console.log('shell accent attr:', window.document.documentElement.dataset.accent, '| theme:', window.document.documentElement.dataset.theme)
    for (const view of VIEWS) {
      window.CC.switchView(view)
      await settle(40)
      const node = $(`#view-${view}`)
      const len = node?.innerHTML.length || 0
      const bad = /undefined|NaN|\[object Object\]/.test(node?.textContent || '') ? ' SUSPICIOUS-TEXT' : ''
      const ok = len > 200
      if (!ok || bad) failures++
      console.log(`  view ${view.padEnd(10)} ${String(len).padStart(7)} chars ${ok ? 'ok' : 'EMPTY!'}${bad}`)
    }
    // the old assistant route stays alive as an alias of the PAPER workspace
    window.CC.switchView('assistant')
    await settle(40)
    if ($('#view-paper')?.classList.contains('hidden')) { failures++; console.log('  assistant alias -> paper: BROKEN') } else console.log('  assistant alias -> paper: ok')
    // dialogs
    window.CC.openTaskModal(); await settle(30)
    console.log('  task modal:', $('.modal-box') ? 'ok' : 'MISSING'); if (!$('.modal-box')) failures++
    window.CC.closeModal(); await settle(300)
    window.CC.openScoreInfo(); await settle(30)
    console.log('  score modal:', $('.score-formula') ? 'ok' : 'MISSING'); if (!$('.score-formula')) failures++
    window.CC.closeModal(); await settle(300)
    window.CC.openCommandPalette(); await settle(30)
    console.log('  palette:', $('.palette-result') ? 'ok (' + window.document.querySelectorAll('.palette-result').length + ' results)' : 'MISSING RESULTS'); if (!$('.palette-result')) failures++
    window.CC.closeModal(); await settle(300)
    window.CC.openGoalModal(); await settle(30)
    console.log('  goal modal:', $('.modal-box') ? 'ok' : 'MISSING'); if (!$('.modal-box')) failures++
    window.CC.closeModal(); await settle(300)
    window.CC.openQuickCapture(); await settle(30)
    console.log('  quick capture:', $('.modal-box, [class*=capture]') ? 'ok' : 'MISSING')
    const captureInput = $('#capture-title')
    if (captureInput) {
      captureInput.value = 'Pay the bill tomorrow at 6pm for 15m !high #work'
      captureInput.dispatchEvent(new window.Event('input', { bubbles: true }))
      await settle(20)
      const chips = window.document.querySelectorAll('.capture-chip').length
      console.log('  capture parse:', chips === 5 ? 'ok (5 fields)' : `UNEXPECTED (${chips} chips)`)
      if (chips !== 5) failures++
    }
    window.CC.closeQuickCapture(); await settle(300)
    // interactions
    // HYB deck: one line in, a parsed plan out
    window.CC.openHybDeck(); await settle(40)
    console.log('  hyb deck:', $('.hyb-deck') ? 'ok' : 'MISSING'); if (!$('.hyb-deck')) failures++
    const hybInput = $('#hyb-quick-input')
    if (hybInput) {
      hybInput.value = 'Mock paper tomorrow 6pm for 3h @study ~deep !high #gs'
      hybInput.dispatchEvent(new window.Event('input', { bubbles: true }))
      await settle(20)
      const hybChips = window.document.querySelectorAll('#hyb-quick-chips .hyb-chip').length
      console.log('  hyb parse:', hybChips >= 6 ? `ok (${hybChips} fields read)` : `UNEXPECTED (${hybChips} chips)`)
      if (hybChips < 6) failures++
      // a tag becomes its own chip (so it never sits inside the title)
      const tagChips = [...window.document.querySelectorAll('#hyb-quick-chips .hyb-chip--tag')].map((chip) => chip.textContent.trim())
      console.log('  hyb tags:', tagChips.join(' ') === '#gs' ? 'ok (one clean tag chip)' : `UNEXPECTED (${tagChips.join(', ') || 'none'})`)
      if (tagChips.join(' ') !== '#gs') failures++
    }
    window.CC.openHybPlanModal(); await settle(40)
    console.log('  hyb plan editor:', $('#hyb-plan-form') ? 'ok' : 'MISSING'); if (!$('#hyb-plan-form')) failures++
    window.CC.closeModal(); await settle(300)
    window.CC.closeHybDeck(); await settle(40)
    console.log('  hyb triggers:', window.document.querySelectorAll('[data-hyb-trigger]').length, '| count badge:', $('[data-hyb-count]')?.textContent || '-')
    // calendar: three modes, a layer toggle, a day tap
    window.CC.openCalendar(today); await settle(50)
    const cells = window.document.querySelectorAll('.cal-cell').length
    console.log('  calendar grid:', cells >= 28 ? `ok (${cells} cells)` : `EMPTY (${cells})`); if (cells < 28) failures++
    console.log('  calendar hyb chips:', window.document.querySelectorAll('.cal-chip--hyb').length, '| day rail rows:', window.document.querySelectorAll('.cal-day-row').length)
    for (const mode of ['week', 'agenda', 'month']) {
      const btn = window.document.querySelector(`[data-cal-mode="${mode}"]`)
      btn?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await settle(40)
      console.log(`  calendar ${mode.padEnd(6)}:`, ($('#view-calendar').innerHTML.length > 400) ? 'ok' : 'EMPTY!')
      if ($('#view-calendar').innerHTML.length <= 400) failures++
    }
    const layerBtn = window.document.querySelector('[data-cal-layer="hyb"]')
    layerBtn?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await settle(40)
    console.log('  calendar layer toggle:', window.document.querySelectorAll('.cal-chip--hyb').length === 0 ? 'ok (off)' : 'STILL SHOWING')
    layerBtn?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await settle(40)
    window.CC.switchView('hyb'); await settle(40)
    console.log('  hyb studio cards:', window.document.querySelectorAll('.hyb-card').length, '| balance rows:', window.document.querySelectorAll('.hyb-balance-row').length)
    window.CC.switchView('dashboard'); await settle(40)
    const check = $('[data-priority-toggle]')
    if (check) { check.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await settle(40); console.log('  priority toggle: ok') }
    const themeBtn = $('#theme-toggle')
    themeBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await settle(30)
    console.log('  theme toggle ->', window.document.documentElement.dataset.theme)
    themeBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await settle(30)
    console.log('  focus start/stop:')
    window.CC.openFocusRoom(); await settle(40)
    console.log('    focus room view rendered:', ($('#view-focus').innerHTML.length > 200) ? 'ok' : 'EMPTY!')
    if (errors.length) { failures++; console.log('  ERRORS:'); for (const e of errors) console.log('   ', e) } else console.log('  console errors: none')
  } finally { window.close() }
}

await walk('populated workspace', seedState())
await walk('empty workspace', null)
console.log(failures ? `\nSMOKE FAILURES: ${failures}` : '\nSMOKE OK — no failures')
process.exit(failures ? 1 : 0)
