#!/usr/bin/env node
/**
 * QA sweep — drives the real client bundle through every interactive path
 * the test-suite doesn't reach, collecting console/window errors and DOM
 * anomalies (NaN / undefined / [object Object] leaks into rendered output).
 * Run after `npm run build`. Prints a report; exits 1 on findings.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { JSDOM, VirtualConsole } from 'jsdom'

const root = process.cwd()
const worker = (await import(path.join(root, 'dist', 'index.js'))).default
const shell = await (await worker.request('/')).text()
const bundle = await readFile(path.join(root, 'public', 'static', 'js', 'app.js'), 'utf8')

const errors = []
const warnings = []
const virtualConsole = new VirtualConsole()
virtualConsole.on('jsdomError', (e) => errors.push(`jsdomError: ${e.message}`))
virtualConsole.on('error', (...a) => errors.push(`console.error: ${a.join(' ')}`))
virtualConsole.on('warn', (...a) => warnings.push(`console.warn: ${a.join(' ')}`))

const dom = new JSDOM(shell, {
  url: 'https://command-center.test/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  virtualConsole,
})
const { window } = dom
const { document } = window
window.fetch = async () => new Response(JSON.stringify({ text: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } })
window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
window.scrollTo = () => {}
window.HTMLCanvasElement.prototype.getContext = () => null
window.addEventListener('error', (e) => errors.push(`window error: ${e.message} @ ${e.filename}:${e.lineno}`))
window.eval(bundle)

const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms))
const $ = (s) => document.querySelector(s)
const $$ = (s) => Array.from(document.querySelectorAll(s))
const probe = (name, fn) => { try { fn() } catch (e) { errors.push(`[${name}] threw: ${e.message}`) } }
const click = (el, name) => { if (!el) { warnings.push(`missing element: ${name}`); return } try { el.click() } catch (e) { errors.push(`[${name}] click threw: ${e.message}`) } }
const type = (el, v, name = 'input') => {
  if (!el) { warnings.push(`missing input for typing: ${name}`); return }
  el.value = v
  el.dispatchEvent(new window.Event('input', { bubbles: true }))
  el.dispatchEvent(new window.Event('change', { bubbles: true }))
}
const CC = () => window.CC

await settle(80)

const VIEWS = ['dashboard', 'day', 'calendar', 'schedule', 'hyb', 'tasks', 'goals', 'projects', 'routines', 'focus', 'progress', 'review', 'journal', 'forecast', 'assistant', 'settings']

// ── 1 · every view, twice (cold + warm repaint) ────────────────────────────
for (const round of [1, 2]) {
  for (const v of VIEWS) {
    probe(`switch:${v}:r${round}`, () => CC().switchView(v))
    await settle(25)
  }
}

// ── 2 · quick capture: syntax variations incl. hostile input ──────────────
probe('open quick capture', () => CC().openQuickCapture({ inbox: true }))
await settle(150)
if (!$('#capture-title')) {
  const overlay = $('#modal-overlay') || $('.modal-overlay')
  warnings.push(`capture diag: overlay=${overlay ? overlay.className : 'none'} body=${($('#modal-body')?.innerHTML || '').slice(0, 80)}`)
}
for (const txt of ['', '   ', 'Pay taxes !high @14:00 tomorrow', '<img src=x onerror=alert(1)>', 'A'.repeat(400), 'Ünïcødé — टेस्ट 🎯', 'Review: 2^53+1 numbers']) {
  probe(`reopen quick capture:${txt.slice(0, 10)}`, () => CC().openQuickCapture({ inbox: true }))
  await settle(60)
  type($('#capture-title'), txt, 'capture-title')
  probe(`capture submit:${txt.slice(0, 16)}`, () => $('#capture-form')?.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })))
  await settle(25)
}
probe('close quick capture', () => CC().closeQuickCapture())
await settle(15)

// ── 3 · task modal CRUD paths ─────────────────────────────────────────────
probe('open task modal', () => CC().openTaskModal())
await settle(30)
type($('#task-title'), 'QA sweep task', 'task-title')
probe('submit task modal', () => $('#task-form')?.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })) ?? $('[data-modal-body] form')?.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })))
await settle(25)
probe('close modal', () => CC().closeModal())
await settle(15)

// ── 4 · tasks view interactions ───────────────────────────────────────────
CC().switchView('tasks')
await settle(40)
click($('[data-task-toggle]'), 'task toggle')
await settle(20)
click($('[data-task-toggle]'), 'task untoggle')
await settle(20)
type($('[data-task-search]'), 'QA', 'task-search')
await settle(20)
type($('[data-task-search]'), '', 'task-search')
await settle(20)
const filter = $('[data-task-filter]')
if (filter?.options?.[1]) { type(filter, filter.options[1].value); await settle(20) }
const rowBtns = $$('[data-edit], [data-delete]')
for (const b of rowBtns.slice(0, 8)) {
  click(b, `row:${b.getAttribute('data-edit') || b.getAttribute('data-delete')}`)
  await settle(25)
  probe('close modal after row', () => CC().closeModal())
  await settle(15)
}

// ── 5 · focus lifecycle through the public API ───────────────────────────
CC().switchView('focus')
await settle(40)
probe('openFocusMode (setup picker)', () => CC().openFocusMode())
await settle(30)
click($('#focus-start'), 'focus-start launch')
await settle(40)
probe('openFocusRoom (view)', () => CC().openFocusRoom())
await settle(25)
probe('pauseFocus', () => CC().pauseFocus())
await settle(20)
probe('resumeFocus', () => CC().resumeFocus())
await settle(20)
probe('completeFocus', () => CC().completeFocus())
await settle(30)
probe('openFocusRoom', () => CC().openFocusRoom())
await settle(25)
probe('stopFocus (no session)', () => CC().stopFocus())
await settle(20)
probe('close any focus overlay', () => { CC().closeModal() })
for (const chip of $$('[data-phase]').slice(0, 5)) { click(chip, 'phase chip'); await settle(15) }

// ── 6 · chrome modals + settings ─────────────────────────────────────────
for (const o of ['#notifications-btn', '#quick-add-btn', '#command-search', '#streak-mini', '#active-timer-chip', '#theme-toggle', '#sidebar-collapse', '#mobile-menu-btn']) {
  click($(o), `opener ${o}`)
  await settle(20)
  probe('close', () => { CC().closeModal(); CC().closeMobileNav?.() })
  await settle(10)
}
click($('[data-briefing-open]'), 'briefing-open')
await settle(25)
probe('close briefing via openers', () => CC().closeBriefing())
// notifications → reminder settings hop
click($('#notifications-btn'), 'notifications again')
await settle(25)
click($('[data-reminder-settings]'), 'reminder settings')
await settle(35)
probe('close', () => CC().closeModal())
probe('openShortcuts', () => CC().openShortcuts())
await settle(20)
probe('close shortcuts', () => CC().closeModal())
CC().switchView('settings')
await settle(40)
for (const choice of $$('[data-theme-choice], [data-accent-choice], [data-edition-choice]').slice(0, 12)) {
  click(choice, `setting ${choice.getAttribute('data-theme-choice') || choice.getAttribute('data-accent-choice') || choice.getAttribute('data-edition-choice')}`)
  await settle(20)
}
for (const t of $$('input[type=checkbox]').slice(0, 14)) {
  click(t, 'settings toggle')
  await settle(15)
}
click($('[data-theme-choice="dark"]'), 'restore dark')
await settle(20)

// ── 7 · briefing / review / recovery / journal / palette / calendar ──────
CC().switchView('dashboard')
await settle(30)
probe('openBriefing', () => CC().openBriefing())
await settle(60)
probe('speakBriefing', () => CC().speakBriefing?.())
await settle(20)
probe('close briefing', () => CC().closeBriefing())
await settle(15)
CC().switchView('review')
await settle(30)
for (const b of $$('button').slice(0, 12)) { click(b, 'review btn'); await settle(15); probe('close', () => CC().closeModal()) }
CC().switchView('journal')
await settle(30)
type($('#journal-note'), 'QA sweep entry — the quick brown fox.', 'journal-note')
type($('#journal-win'), 'A small QA win', 'journal-win')
type($('#journal-next'), 'Ship the fix', 'journal-next')
click($('[data-journal-mood="calm"]') || $('[data-journal-mood]'), 'journal mood')
await settle(15)
click($('[data-journal-energy="2"]') || $('[data-journal-energy]'), 'journal energy')
await settle(15)
probe('journal save (form submit)', () => $('#journal-note')?.closest('form')?.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })))
await settle(25)
await settle(25)
probe('openCommandPalette', () => CC().openCommandPalette())
await settle(25)
type($('#palette-query') || $('#palette input'), 'focus', 'palette-query')
for (const r of $$('[data-command]').slice(0, 5)) { click(r, 'palette cmd'); await settle(15) }
probe('close palette', () => CC().closeModal())
await settle(15)
CC().switchView('calendar')
await settle(30)
probe('openCalendar modal', () => CC().openCalendar())
await settle(25)
probe('close calendar', () => CC().closeModal())
click($('[data-cal-step="1"]'), 'cal next'); await settle(20)
click($('[data-cal-step="-1"]'), 'cal prev'); await settle(20)
click($('[data-cal-today]'), 'cal today'); await settle(20)

// ── 8 · creation flows: goals / projects / routines / protected ──────────
probe('openGoalModal', () => CC().openGoalModal())
await settle(25); probe('close', () => CC().closeModal())
probe('openProjectModal', () => CC().openProjectModal())
await settle(25); probe('close', () => CC().closeModal())
probe('openRoutineModal', () => CC().openRoutineModal())
await settle(25); probe('close', () => CC().closeModal())
probe('openProtectedModal', () => CC().openProtectedModal())
await settle(25); probe('close', () => CC().closeModal())
probe('openCategoryModal', () => CC().openCategoryModal())
await settle(25); probe('close', () => CC().closeModal())
probe('openRescheduleModal', () => CC().openRescheduleModal())
await settle(25); probe('close', () => CC().closeModal())
probe('openDayPlanner', () => CC().openDayPlanner())
await settle(25); probe('close', () => CC().closeModal())
probe('openScoreInfo', () => CC().openScoreInfo())
await settle(25); probe('close', () => CC().closeModal())
probe('openHybDeck', () => CC().openHybDeck())
await settle(25); probe('closeHybDeck', () => CC().closeHybDeck())
probe('openHybPlanModal', () => CC().openHybPlanModal())
await settle(25); probe('close', () => CC().closeModal())

// ── 9 · forecast horizon + hyb + schedule + day ──────────────────────────
CC().switchView('forecast')
await settle(35)
for (const h of $$('[data-forecast-horizon]')) { click(h, 'horizon'); await settle(25) }
CC().switchView('hyb')
await settle(30)
for (const b of $$('button').slice(0, 10)) { click(b, 'hyb btn'); await settle(15); probe('close', () => CC().closeModal()) }
CC().switchView('day')
await settle(30)
for (const b of $$('button').slice(0, 12)) { click(b, 'day btn'); await settle(15); probe('close', () => CC().closeModal()) }
CC().switchView('schedule')
await settle(30)
for (const b of $$('button').slice(0, 10)) { click(b, 'schedule btn'); await settle(15); probe('close', () => CC().closeModal()) }

// ── 10 · keyboard shortcuts ──────────────────────────────────────────────
const key = (k) => probe(`key:${k}`, () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })))
for (const k of ['?', 'h', 'c', 'b', 'f', 'n', 'j', 'o', '1', '2', '3', '9']) {
  key(k)
  await settle(18)
  probe('close after key', () => { CC().closeModal(); CC().closeBriefing?.(); CC().closeHybDeck?.() })
  await settle(10)
}

// ── 10b · direct state-API probes (logic layer) ─────────────────────────
CC().switchView('dashboard')
await settle(30)
const st = CC().getState()
const firstTask = st?.tasks?.[0]
if (firstTask) {
  probe('toggleMission', () => CC().toggleMission(firstTask.id))
  await settle(20)
  probe('addTaskToTop3', () => CC().addTaskToTop3(firstTask.id))
  await settle(20)
  probe('removeFromTop3', () => CC().removeFromTop3(firstTask.id))
  await settle(20)
}
probe('toggleScheduleItem', () => { const s2 = CC().getState(); const item = s2?.timetables?.[s2?.activeMission]?.[0] ?? s2?.timetables?.ssc_cgl_2027?.[0]; if (item) CC().toggleScheduleItem(item.id) })
await settle(20)
probe('movePriority', () => CC().movePriority(0, 1))
await settle(20)
probe('runLocalCommand', () => CC().runLocalCommand('help'))
await settle(25)
probe('runLocalCommand stats', () => CC().runLocalCommand('stats'))
await settle(25)
probe('askAI', () => CC().askAI('hello'))
await settle(40)
probe('handleChatKey Enter', () => CC().handleChatKey({ key: 'Enter', target: $('#chat-input'), preventDefault() {}, shiftKey: false }))
await settle(30)
probe('checkReminders', () => CC().checkReminders())
await settle(20)
probe('refreshQuoteInline', () => CC().refreshQuoteInline())
await settle(15)
probe('streakInfo', () => CC().streakInfo())
probe('disciplineInfo', () => CC().disciplineInfo())
probe('hasRunningSession', () => CC().hasRunningSession())
probe('todayKey', () => CC().todayKey())
probe('titles read', () => Array.isArray(CC().titles))

// ── 11 · persistence round-trip ──────────────────────────────────────────
let snapshot = null
probe('state snapshot', () => { snapshot = CC().getState() })
if (snapshot) {
  window.localStorage.setItem('cc-state', JSON.stringify(snapshot))
  const shell2 = await (await worker.request('/')).text()
  const vc2 = new VirtualConsole()
  vc2.on('jsdomError', (e) => errors.push(`[reload] jsdomError: ${e.message}`))
  vc2.on('error', (...a) => errors.push(`[reload] console.error: ${a.join(' ')}`))
  const dom2 = new JSDOM(shell2, { url: 'https://command-center.test/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc2 })
  dom2.window.fetch = window.fetch
  dom2.window.matchMedia = window.matchMedia
  dom2.window.scrollTo = () => {}
  dom2.window.HTMLCanvasElement.prototype.getContext = () => null
  dom2.window.addEventListener('error', (e) => errors.push(`[reload] window error: ${e.message}`))
  dom2.window.eval(bundle)
  await settle(80)
  for (const v of ['dashboard', 'tasks', 'focus', 'progress', 'settings']) {
    probe(`reload switch:${v}`, () => dom2.window.CC.switchView(v))
    await settle(25)
  }
  dom2.window.close()
}

// ── 12 · rendered-output anomaly scan across all views ───────────────────
for (const v of VIEWS) {
  probe(`scan:${v}`, () => CC().switchView(v))
  await settle(25)
  const main = $('#app-main') || document.body
  const text = main.textContent || ''
  for (const bad of ['NaN', 'undefined', '[object Object]', 'Invalid Date', 'Infinity']) {
    if (text.includes(bad)) errors.push(`[${v}] rendered text contains "${bad}"`)
  }
  for (const el of $$('[class]')) {
    const cls = el.className
    if (typeof cls === 'string' && (cls.includes('undefined') || cls.includes('[object'))) errors.push(`[${v}] class attr polluted: ${cls.slice(0, 70)}`)
  }
  const ids = new Map()
  for (const el of $$('[id]')) {
    if (ids.has(el.id)) errors.push(`[${v}] duplicate id #${el.id}`)
    ids.set(el.id, true)
  }
}
window.close()

// ── report ───────────────────────────────────────────────────────────────
const uniq = [...new Set(errors)]
const uniqWarn = [...new Set(warnings)]
console.log(`\n════ QA SWEEP REPORT ════`)
console.log(`errors: ${uniq.length} · warnings: ${uniqWarn.length}`)
for (const e of uniq.slice(0, 80)) console.log('  ✗ ' + e)
for (const w of uniqWarn.slice(0, 30)) console.log('  ⚠ ' + w)
if (!uniq.length) console.log('  ✔ no errors captured across all probes')
process.exit(uniq.length ? 1 : 0)
