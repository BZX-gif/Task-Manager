import { readFile, writeFile } from 'node:fs/promises'
import build from '@hono/vite-build/cloudflare-workers'
import devServer from '@hono/vite-dev-server'
import adapter from '@hono/vite-dev-server/cloudflare'
import { defineConfig, type Plugin } from 'vite'

const geminiWorkerRoute = `

type WorkerBindings = { GEMINI_API_KEY?: string }

app.post('/api/gemini', async (c) => {
  const apiKey = c.env.GEMINI_API_KEY?.trim()
  if (!apiKey) {
    return c.json({ error: 'Gemini API key is not configured on the Worker.' }, 500)
  }

  try {
    const payload = await c.req.json()
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(payload),
    })

    const responseBody = await response.text()
    return new Response(responseBody, {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Gemini proxy error:', error)
    return c.json({ error: 'Invalid Gemini request.' }, 400)
  }
})
`

function geminiRuntimePatch(): Plugin {
  return {
    name: 'task-manager-gemini-runtime-patch',
    transform(code, id) {
      if (!id.endsWith('/src/index.tsx')) return null
      if (!code.includes('const app = new Hono()')) return null

      const transformed = code.replace(
        'const app = new Hono()\n',
        'const app = new Hono<{ Bindings: WorkerBindings }>()\n' + geminiWorkerRoute,
      )

      return { code: transformed, map: null }
    },
    async closeBundle() {
      const assetPath = 'dist/static/app.js'
      try {
        let source = await readFile(assetPath, 'utf8')
        source = source.replace(
          /const GEMINI_ENDPOINT = \(model\) => `https:\\/\\/generativelanguage\\.googleapis\\.com\\/v1beta\\/models\/\$\{model\}:generateContent`;/,
          'const GEMINI_ENDPOINT = () => "/api/gemini";',
        )
        source = source.replace(
          /const apiKey = \(state\.settings\.geminiApiKey \|\| ""\)\.trim\(\);/g,
          'const apiKey = "server-managed";',
        )
        source = source.replace(
          /headers: \{ "Content-Type": "application\\/json", "x-goog-api-key": apiKey \}/g,
          'headers: { "Content-Type": "application/json" }',
        )
        source = source.replace(/AQ\.[A-Za-z0-9_-]+/g, '')
        await writeFile(assetPath, source, 'utf8')
      } catch (error) {
        console.warn('Gemini runtime asset patch skipped:', error)
      }
    },
  }
}

export default defineConfig({
  plugins: [
    geminiRuntimePatch(),
    build(),
    devServer({
      adapter,
      entry: 'src/index.tsx'
    })
  ]
})
