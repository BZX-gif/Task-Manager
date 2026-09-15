/* -------------------------------------------------------------------------
   PWA — service worker registration + install prompt
   The app shell (HTML, CSS, JS, icons) is cached so the core task/timetable
   experience keeps working offline. AI calls obviously still need the network.
   ------------------------------------------------------------------------- */

import { toast } from '../core/dom.js'

let deferredPrompt = null

export function initPwa() {
  registerServiceWorker()
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferredPrompt = event
    toast('Command Center can be installed as an app.', 'info', {
      timeout: 8000,
      action: { label: 'Install', onClick: () => promptInstall() },
    })
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    toast('Installed — open it from your home screen.', 'success')
  })
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('[pwa] service worker registration failed', error?.message || error)
    })
  })
}

export async function promptInstall() {
  if (!deferredPrompt) {
    toast('Use your browser menu → “Install app” to add this to your home screen.', 'info', { timeout: 7000 })
    return false
  }
  deferredPrompt.prompt()
  const choice = await deferredPrompt.userChoice
  deferredPrompt = null
  return choice?.outcome === 'accepted'
}

export function canInstall() {
  return !!deferredPrompt
}
