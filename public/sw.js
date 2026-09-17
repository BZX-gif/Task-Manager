/* -------------------------------------------------------------------------
   Command Center service worker
   -------------------------------------------------------------------------
   • Pre-caches the app shell so tasks + timetable work offline.
   • Navigation requests: network-first, falling back to the cached shell.
   • Static assets: cache-first (they are content-addressed by version).
   • /api/* is never cached — AI responses must always be live.
   ------------------------------------------------------------------------- */

const VERSION = 'v2-1-0'
const SHELL_CACHE = `cc-shell-${VERSION}`
const ASSET_CACHE = `cc-assets-${VERSION}`

const SHELL_ASSETS = [
  '/',
  '/static/style.css',
  '/static/tailwind.css',
  '/static/js/app.js',
  '/static/vendor/fontawesome/css/all.min.css',
  '/static/fonts.css',
  '/static/fonts/sora-latin-700.woff2',
  '/static/fonts/manrope-latin-400.woff2',
  '/static/favicon.svg',
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
        try {
          const response = await fetch(request)
          const cache = await caches.open(SHELL_CACHE)
          cache.put('/', response.clone())
          return response
        } catch {
          const cache = await caches.open(SHELL_CACHE)
          return (await cache.match('/')) || (await cache.match(request)) || Response.error()
        }
      })(),
    )
    return
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(ASSET_CACHE)
      const cached = await cache.match(request)
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
        return (await caches.match('/static/js/app.js')) || Response.error()
      }
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting()
})
