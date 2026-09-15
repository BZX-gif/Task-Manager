import build from '@hono/vite-build/cloudflare-workers'
import devServer from '@hono/vite-dev-server'
import adapter from '@hono/vite-dev-server/cloudflare'
import { defineConfig, type Plugin } from 'vite'
import { spawn } from 'node:child_process'
import { watch } from 'node:fs'
import path from 'node:path'

/**
 * Keeps the browser bundle in sync while `npm run dev` is running: the bundle
 * is a plain static file produced by scripts/build-client.mjs (the same script
 * the production build uses), so a change under `src/client/**` triggers a
 * debounced rebuild and Vite reloads the page.
 */
function clientWatcher(): Plugin {
  const WATCHED = [path.resolve(import.meta.dirname, 'src/client'), path.resolve(import.meta.dirname, 'src/shell.ts')]
  return {
    name: 'command-center-client-watcher',
    apply: 'serve',
    configureServer(server) {
      let building = false
      let queued = false
      const run = () => {
        if (building) {
          queued = true
          return
        }
        building = true
        const child = spawn(process.execPath, ['scripts/build-client.mjs', '--dev'], { stdio: 'inherit' })
        child.on('exit', () => {
          building = false
          if (queued) {
            queued = false
            run()
          }
        })
      }
      run()
      const watchers = WATCHED.map((target) =>
        watch(target, { recursive: true }, () => {
          run()
          server.ws.send({ type: 'full-reload' })
        }),
      )
      return () => watchers.forEach((watcher) => watcher.close())
    },
  }
}

export default defineConfig({
  plugins: [
    clientWatcher(),
    build({ entry: './src/worker.ts' }),
    devServer({
      adapter,
      entry: 'src/worker.ts',
    }),
  ],
  // the platform preview runs behind a proxied host — never block it
  server: {
    allowedHosts: true,
    host: true,
  },
})
