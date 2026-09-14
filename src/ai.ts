import type { Context } from 'hono'

export interface WorkerEnv {
  GEMINI_API_KEY: string
}

type AIContext = Context<{ Bindings: WorkerEnv }>

export async function aiHandler(c: AIContext) {
  const apiKey = c.env.GEMINI_API_KEY?.trim()

  if (!apiKey) {
    return c.json({ error: { message: 'GEMINI_API_KEY is not configured on this Worker.' } }, 500)
  }

  let payload: {
    system?: string
    messages?: Array<{ role: 'user' | 'model' | 'assistant'; content: string }>
  }

  try {
    payload = await c.req.json()
  } catch {
    return c.json({ error: { message: 'Invalid JSON request.' } }, 400)
  }

  const messages = (payload.messages ?? [])
    .filter((message) => typeof message?.content === 'string' && message.content.trim())
    .slice(-16)
    .map((message) => ({
      role: message.role === 'model' ? 'assistant' : message.role,
      content: message.content,
    }))

  if (!messages.length) {
    return c.json({ error: { message: 'A user message is required.' } }, 400)
  }

  if (payload.system?.trim()) {
    messages.unshift({ role: 'system', content: payload.system.trim() })
  }

  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gemini-2.5-flash',
      messages,
      reasoning_effort: 'low',
    }),
  })

  const data = await response.json()

  if (!response.ok) {
    return c.json(data, response.status as 400 | 401 | 403 | 404 | 429 | 500 | 502 | 503 | 504)
  }

  return c.json({
    text: data?.choices?.[0]?.message?.content ?? '',
  })
}
