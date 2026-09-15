import { Hono } from 'hono'
import type { WorkerEnv } from './ai'
import { renderShell } from './shell'

const app = new Hono<{ Bindings: WorkerEnv }>()

app.get('/', (c) => {
  return c.html(renderShell())
})

export default app
