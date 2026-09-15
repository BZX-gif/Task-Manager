/* -------------------------------------------------------------------------
   REMINDER RUNNER — delivers the reminders computed by lib/reminders.js
   Desktop notifications when the user allowed them, in-app toasts otherwise.
   Every reminder has a stable key so nothing is ever sent twice.
   ------------------------------------------------------------------------- */

import { computeDueReminders, pruneSentLog } from '../lib/reminders.js'
import { currentDayKey, commit, minutesNow, state } from '../core/store.js'
import { toast } from '../core/dom.js'
import { emit } from '../core/bus.js'

const CHECK_INTERVAL_MS = 45_000

export function startReminderRunner() {
  checkReminders()
  return setInterval(checkReminders, CHECK_INTERVAL_MS)
}

export function checkReminders(now = new Date()) {
  if (!state?.settings?.reminders?.enabled) return []
  const today = currentDayKey(now)
  const nowMin = minutesNow(now)
  const sent = state.reminders?.sent || {}
  const due = computeDueReminders({ state, todayKey: today, nowMinutes: nowMin, now })
  const fresh = due.filter((reminder) => !sent[reminder.key])
  if (!fresh.length) return []

  const updated = { ...sent }
  for (const reminder of fresh) {
    updated[reminder.key] = Date.now()
    deliver(reminder)
    emit('reminder', reminder)
  }
  commit((s) => {
    s.reminders.sent = pruneSentLog(updated, today, 14)
  }, { silent: true })
  return fresh
}

function deliver(reminder) {
  const toastType = reminder.kind === 'overdue' ? 'error' : reminder.kind === 'timetable' ? 'timer' : 'info'
  toast(`${reminder.title} — ${reminder.body}`, toastType, { timeout: reminder.kind === 'overdue' ? 8000 : 6000 })
  try {
    const wantsDesktop = state.settings?.reminders?.desktopNotifications
    if (wantsDesktop && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(`Command Center · ${reminder.title}`, { body: reminder.body, icon: '/icons/icon-192.png', tag: reminder.key })
    }
  } catch {
    /* notifications are optional */
  }
}
