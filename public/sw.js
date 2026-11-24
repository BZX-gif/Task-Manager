/* -------------------------------------------------------------------------
   Command Center service worker
   -------------------------------------------------------------------------
   • Pre-caches the app shell so the local-first workspace works offline.
   • Navigation requests: network-first, falling back to the cached shell.
   • Static assets: cache-first (they are content-addressed by version).
   • /api/* is never cached — AI responses must always be live.
   ------------------------------------------------------------------------- */

const VERSION = 'v6-0-0'
const SHELL_CACHE = `cc-shell-${VERSION}`
const ASSET_CACHE = `cc-assets-${VERSION}`

const SHELL_ASSETS = [
  '/',
  '/static/atmosphere.css',
  '/static/worlds.css',
  '/assets/atmospheres/myday/penthouse-sunrise-sm.webp',
  '/assets/atmospheres/missions/mountain-workspace-sm.webp',
  '/assets/atmospheres/goals/coastal-villa-sm.webp',
  '/assets/atmospheres/projects/creative-studio-sm.webp',
  '/assets/atmospheres/calendar/resort-terrace-sm.webp',
  '/assets/atmospheres/focus/private-study-night-sm.webp',
  '/assets/atmospheres/briefing/hotel-lounge-morning-sm.webp',
  '/assets/atmospheres/journal/writing-room-sm.webp',
  '/static/fonts/instrument-serif-400.woff2',
  '/static/fonts/instrument-serif-400-italic.woff2',
  '/static/fonts/dm-sans-400.woff2',
  '/static/fonts/dm-sans-600.woff2',
  '/images/atmosphere-morning-sm.webp',
  '/images/atmosphere-afternoon-sm.webp',
  '/images/atmosphere-night-sm.webp',
  '/static/style.css',
  '/static/studio.css',
  '/static/system.css',
  '/static/tailwind.css',
  '/static/js/app.js',
  '/static/favicon.svg',
  '/static/favicon-crown.svg',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      await Promise.all(
        SHELL_ASSETS.map((asset) =>
          cache.add(new Request(asset, { cache: 'reload' })).catch(() => {
            /* a missing optional asset must not break installation */
          }),
        ),
      )
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((key) => key !== SHELL_CACHE && key !== ASSET_CACHE).map((key) => caches.delete(key)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE)
        try {
          const response = await fetch(request)
          if (response.ok) {
            // every chapter is the same shell, so cache it under the root key
            await cache.put('/', response.clone())
            return response
          }
          // A 404 for a navigation is almost never the right answer: the app's
          // chapters are client routes (/calendar), so a host that does not
          // know them would show the visitor an error page instead of their
          // workspace. Fall back to the shell we already have and let the
          // client router show the chapter — or the dashboard if it cannot.
          if (response.status === 404) {
            const cached = (await cache.match('/')) || (await cache.match(request))
            if (cached) return cached
          }
          return response
        } catch {
          return (await cache.match('/')) || (await cache.match(request)) || Response.error()
        }
      })(),
    )
    return
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(ASSET_CACHE)
      const shell = await caches.open(SHELL_CACHE)
      const cached = (await cache.match(request)) || (await shell.match(request))
      if (cached) {
        // refresh in the background for the next load
        fetch(request)
          .then((response) => {
            if (response && response.ok) cache.put(request, response.clone())
          })
          .catch(() => {})
        return cached
      }
      try {
        const response = await fetch(request)
        if (response && response.ok) cache.put(request, response.clone())
        return response
      } catch {
        return Response.error()
      }
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting()
})
