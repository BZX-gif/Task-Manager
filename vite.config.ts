import build from '@hono/vite-build/cloudflare-workers'
import devServer from '@hono/vite-dev-server'
import adapter from '@hono/vite-dev-server/cloudflare'
import { defineConfig, type Plugin } from 'vite'
import { spawn } from 'node:child_process'

/**
 * Rebuilds the browser bundle while `npm run dev` is running so the client
 * always matches `src/client/**`. (The bundle is a plain static file, generated
 * by scripts/build-client.mjs — the same script the production build uses.)
 */
function clientWatcher(): Plugin {
  return {
    name: 'command-center-client-watcher',
    apply: 'serve',
    configureServer() {
      const child = spawn(process.execPath, ['scripts/build-client.mjs', '--dev'], { stdio: 'inherit' })
      return () => child.kill()
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
