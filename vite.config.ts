import build from '@hono/vite-build/cloudflare-workers'
import devServer from '@hono/vite-dev-server'
import adapter from '@hono/vite-dev-server/cloudflare'
import { defineConfig, type Plugin } from 'vite'

function secureAiClientPatch(): Plugin {
  return {
    name: 'task-manager-secure-ai-client',
    transform(code, id) {
      if (!id.endsWith('/src/index.tsx')) return null
      const marker = '<script src="/static/app.js"></script>'
      if (!code.includes(marker)) return null
      return {
        code: code.replace(marker, `${marker}\n<script src="/static/ai-proxy.js"></script>`),
        map: null,
      }
    },
  }
}

export default defineConfig({
  plugins: [
    secureAiClientPatch(),
    build({ entry: './src/worker.ts' }),
    devServer({
      adapter,
      entry: 'src/worker.ts'
    })
  ]
})
