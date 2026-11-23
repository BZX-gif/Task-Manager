import { Hono } from 'hono'
import type { WorkerEnv } from './ai'
import { renderShell, ROUTES, ROUTE_ALIASES } from './shell'

const app = new Hono<{ Bindings: WorkerEnv }>()

/**
 * The application is a single page whose router writes the current chapter into
 * the URL (`/calendar`, `/goals`, …). Those names are not files, so without an
 * explicit answer the host falls through to this Worker, finds no matching
 * route, and returns 404 — which is exactly what a visitor saw after clicking
 * Calendar once the URL started being written.
 *
 * So: the shell is served for `/` and for every client route. Static files under
 * /static, /images and /icons are served by the asset binding *before* the
 * Worker runs, so they are unaffected.
 */
const SHELL_PATHS = new Set<string>([
  '/',
  ...ROUTES.map((route) => `/${route}`),
  ...Object.keys(ROUTE_ALIASES).map((route) => `/${route}`),
])

/** One trailing slash is tolerated; anything deeper is a real 404. */
const normalize = (path: string) => (path !== '/' && path.endsWith('/') ? path.slice(0, -1) : path)

app.get('*', (c, next) => {
  const path = normalize(new URL(c.req.url).pathname)
  if (SHELL_PATHS.has(path)) return c.html(renderShell())
  return next()
})

export default app
