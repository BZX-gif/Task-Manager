import { Hono } from 'hono'
import { renderShell } from './shell'

const app = new Hono()

app.get('/', (c) => {
  return c.html(renderShell())
})

export default app
