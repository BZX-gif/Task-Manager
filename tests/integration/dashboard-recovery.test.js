#!/usr/bin/env node
/**
 * Dashboard refinement contract: the command card states the real task and its
 * facts, and the recovery assistant is explicit — it never changes a mission
 * unless the user asks it to.
 *
 * Requires `npm run build` first (npm test does that automatically).
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { JSDOM, VirtualConsole } from 'jsdom'

const root = process.cwd()
const worker = (await import(path.join(root, 'dist', 'index.js'))).default

const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10)
const today = day(0)

let dom
let window
let errors = []
const $ = (selector) => window.document.querySelector(selector)
const $$ = (selector) => Array.from(window.document.querySelectorAll(selector))
const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms))

before(async () => {
  const shell = await (await worker.request('/')).text()
  const bundle = await readFile(path.join(root, 'public', 'static', 'js', 'app.js'), 'utf8')
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', (error) => errors.push(`jsdomError: ${error.message}`))
  virtualConsole.on('error', (message) => errors.push(`console.error: ${message}`))
  dom = new JSDOM(shell, { url: 'https://command-center.test/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole })
  window = dom.window
  window.fetch = async () => new Response(JSON.stringify({ text: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } })
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
  window.scrollTo = () => {}
  window.HTMLCanvasElement.prototype.getContext = () => null

  const seed = {
    version: 8,
    tasks: [
      { id: 't1', title: 'Ship the design audit', date: today, time: '09:00', estimateMinutes: 90, priority: 'high', cat: 'work', done: false, status: 'ready', inbox: false, createdAt: 1, goalId: 'g1', history: [] },
      { id: 't2', title: 'Old unfinished mission', date: day(-3), estimateMinutes: 30, priority: 'medium', cat: 'work', done: false, status: 'ready', inbox: false, createdAt: 2, history: [] },
      { id: 't3', title: 'Another open mission', date: day(-6), estimateMinutes: 60, priority: 'high', cat: 'work', done: false, status: 'ready', inbox: false, createdAt: 3, history: [] },
    ],
    goals: [{ id: 'g1', title: 'Run a marathon', category: 'Body', status: 'active', targetDate: day(90), progressMode: 'milestones', milestones: [], createdAt: 1 }],
    top3: { [today]: ['t1'] },
    schedule: { days: { [today]: [{ id: 'b1', time: '09:00', title: 'Deep work', duration: 90, taskId: 't1', cat: 'work', priority: 'high' }] }, history: [] },
    completionLog: { [today]: { ttDone: [], taskDone: [] } },
    settings: { userName: 'Asha', theme: 'dark', accent: 'ember', timeFormat: '12h', weekStart: 1, sidebarCollapsed: false, dayEnd: '22:00', defaultTaskMinutes: 45, workingHours: { start: '08:00', end: '20:00' }, focus: { defaultMinutes: 25, targetMinutes: 180, breakMinutes: 5 }, reminders: { enabled: true }, protectedTime: [], hyb: {}, calendar: {} },
    hyb: { plans: [] },
    focus: { active: null, sessions: [] },
    categories: [], projects: [], routines: [], timetables: {}, journal: {}, scoreHistory: {}, dayPlans: {}, reviews: {}, reminders: {}, chatHistory: [],
  }
  window.localStorage.setItem('kcc_state_v1', JSON.stringify(seed))
  window.eval(bundle)
  await settle(160)
})

after(() => {
  dom?.window?.close()
})

test('the command card names the real task and its facts', () => {
  const title = $('.atmo-command-title')?.textContent.trim()
  assert.equal(title, 'Ship the design audit', 'the linked mission title leads, not the generic block label')
  assert.match($('.atmo-command .atmo-command-reason')?.textContent || '', /make today matter|window is open|highest-priority|next commitment|ready when you are/)
  const facts = $$('.atmo-command .atmo-fact')
  assert.equal(facts.length, 4, 'what / why / when / priority are stated as facts')
  const labels = facts.map((fact) => fact.querySelector('.atmo-fact-label')?.textContent)
  assert.deepEqual(labels.slice(0, 3), ['Scheduled', 'Length', 'Priority'])
  assert.ok(['Window', 'Remaining'].includes(labels[3]), 'the fourth fact is the time window')
})

test('recovery states the count and keeps every action explicit', async () => {
  const card = $('[data-recovery]')
  assert.ok(card, 'the recovery assistant is present when missions are overdue')
  assert.match(card.textContent, /2 earlier missions are still open/)
  assert.match(card.textContent, /No catch-up required/)
  assert.ok($('[data-recovery-toggle]'), 'details are opt-in')
  assert.equal($('[data-recovery-detail]')?.getAttribute('aria-hidden'), 'true')

  $('[data-recovery-toggle]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await settle(20)
  assert.equal($('[data-recovery-detail]')?.classList.contains('is-open'), true)
  assert.equal($('[data-recovery-detail]')?.getAttribute('aria-hidden'), 'false')
  assert.equal($$('.recovery-row').length, 2)
})

test('postpone moves one mission to tomorrow without touching the others', async () => {
  const before = window.CC.getState().tasks.find((t) => t.id === 't2')
  $(`[data-recovery-postpone="${before.id}"]`).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await settle(40)
  const after = window.CC.getState().tasks.find((t) => t.id === 't2')
  assert.equal(after.date, day(1))
  assert.equal(after.status, 'rescheduled')
  const untouched = window.CC.getState().tasks.find((t) => t.id === 't3')
  assert.equal(untouched.date, day(-6), 'no other mission moved')
})

test('abandon asks first, then marks the mission cancelled', async () => {
  const id = 't3'
  // the postpone above re-rendered the dashboard, so reopen the detail list
  if ($('[data-recovery-detail]') && !$('[data-recovery-detail]').classList.contains('is-open')) {
    $('[data-recovery-toggle]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await settle(20)
  }
  $(`[data-recovery-abandon="${id}"]`).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await settle(40)
  const confirmButton = $$('[data-modal-box] button').find((button) => /Abandon mission/.test(button.textContent))
  assert.ok(confirmButton, 'a confirmation guards the destructive action')
  assert.equal(window.CC.getState().tasks.find((t) => t.id === id).status, 'ready', 'nothing changed before confirmation')
  confirmButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await settle(40)
  const task = window.CC.getState().tasks.find((t) => t.id === id)
  assert.equal(task.status, 'cancelled')
  assert.ok(task.history.length >= 1, 'the decision is recorded in history')
})

test('the dashboard boot is clean', () => {
  assert.deepEqual(errors, [])
})
