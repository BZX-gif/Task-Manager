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
      role: message.role === 'assistant' ? 'model' : message.role,
      parts: [{ text: message.content }],
    }))

  if (!messages.length) {
    return c.json({ error: { message: 'A user message is required.' } }, 400)
  }

  const body: Record<string, unknown> = {
    contents: messages,
  }

  if (payload.system?.trim()) {
    body.systemInstruction = {
      parts: [{ text: payload.system.trim() }],
    }
  }

  // Gemini 3.6 Flash is a current stable model. Use the native Gemini REST
  // endpoint so newer AQ.* Auth Keys are authenticated with x-goog-api-key.
  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
    },
  )

  const data = await response.json()

  if (!response.ok) {
    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const text = (data?.candidates?.[0]?.content?.parts ?? [])
    .map((part: { text?: string }) => part?.text ?? '')
    .join('')
    .trim()

  return c.json({ text })
}
