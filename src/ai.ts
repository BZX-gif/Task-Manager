import type { Context } from 'hono'

export interface WorkerEnv {
  GEMINI_API_KEY: string
}

export async function aiHandler(c: Context) {
  const env = c.env as WorkerEnv
  const apiKey = env.GEMINI_API_KEY?.trim()

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
    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return c.json({
    text: data?.choices?.[0]?.message?.content ?? '',
  })
}
