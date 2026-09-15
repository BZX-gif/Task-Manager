import app from './index'
import { aiHandler } from './ai'

/** Secure AI bridge: the Gemini key lives only in the Worker secret. */
app.post('/api/ai', aiHandler)

/** Health probe (used by the smoke tests and uptime checks). */
app.get('/api/health', (c) =>
  c.json({
    ok: true,
    name: 'command-center',
    ai: 'server-side',
    time: new Date().toISOString(),
  }),
)

export default app
