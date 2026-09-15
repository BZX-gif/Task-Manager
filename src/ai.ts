import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

export interface WorkerEnv {
  GEMINI_API_KEY: string
}

const GEMINI_MODEL = 'gemini-3.6-flash'
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`
const REQUEST_TIMEOUT_MS = 25_000

/** Friendly, non-technical messages — never leak provider errors or secrets. */
const FRIENDLY = {
  missingKey: 'The assistant is not configured on the server yet. Add the GEMINI_API_KEY secret to your Worker and redeploy.',
  badRequest: 'That request could not be understood. Please try rephrasing it.',
  rateLimited: 'The assistant is rate-limited right now. Please wait a moment and try again.',
  unavailable: 'The assistant service is unavailable right now. Your data is safe — try again shortly.',
  empty: 'The assistant did not return an answer for that. Try asking in a different way.',
  timeout: 'The assistant took too long to answer. Try a shorter request.',
  network: 'The assistant could not be reached. Check your connection and try again.',
}

/**
 * Never forward an arbitrary upstream status: the client only needs to know
 * "rate limited" (429) or "something went wrong upstream" (502).
 */
function clientStatus(status: number): ContentfulStatusCode {
  return status === 429 ? 429 : 502
}

function friendlyForStatus(status: number): string {
  if (status === 429) return FRIENDLY.rateLimited
  if (status === 400) return FRIENDLY.badRequest
  if (status === 401 || status === 403) return FRIENDLY.unavailable
  if (status >= 500) return FRIENDLY.unavailable
  return FRIENDLY.empty
}

export async function aiHandler(c: Context) {
  const env = c.env as WorkerEnv | undefined
  const apiKey = env?.GEMINI_API_KEY?.trim()

  if (!apiKey) {
    return c.json({ error: { message: FRIENDLY.missingKey } }, 500)
  }

  let payload: {
    system?: string
    context?: string
    messages?: Array<{ role: 'user' | 'model' | 'assistant'; content: string }>
  }

  try {
    payload = await c.req.json()
  } catch {
    return c.json({ error: { message: 'Invalid JSON request.' } }, 400)
  }

  const messages = (payload.messages ?? [])
    .filter((message) => typeof message?.content === 'string' && message.content.trim())
    .slice(-12)
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : message.role === 'model' ? 'model' : 'user',
      parts: [{ text: message.content.slice(0, 4000) }],
    }))

  if (!messages.length) {
    return c.json({ error: { message: 'A user message is required.' } }, 400)
  }

  // The productivity snapshot travels with the system instruction: one small
  // context block, no personal notes, no history beyond the last few turns.
  const systemParts = [typeof payload.system === 'string' ? payload.system.trim() : '']
  if (typeof payload.context === 'string' && payload.context.trim()) {
    systemParts.push(`Current productivity context:\n${payload.context.trim().slice(0, 2500)}`)
  }
  const system = systemParts.filter(Boolean).join('\n\n').slice(0, 6000)

  const body: Record<string, unknown> = {
    contents: messages,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 700,
      topP: 0.9,
    },
  }
  if (system) {
    body.systemInstruction = { parts: [{ text: system }] }
  }

  let response: Response
  try {
    response = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    console.warn('[ai] upstream request failed:', (error as Error)?.name || 'unknown')
    const timedOut = (error as Error)?.name === 'TimeoutError' || (error as Error)?.name === 'AbortError'
    return c.json({ error: { message: timedOut ? FRIENDLY.timeout : FRIENDLY.network } }, 504)
  }

  if (!response.ok) {
    // Log the provider's reason for the developer, return something friendly.
    let detail = ''
    try {
      detail = (await response.text()).slice(0, 500)
    } catch {
      /* ignore */
    }
    console.warn(`[ai] upstream ${response.status}: ${detail}`)
    return c.json({ error: { message: friendlyForStatus(response.status) } }, clientStatus(response.status))
  }

  let data: any
  try {
    data = await response.json()
  } catch {
    return c.json({ error: { message: FRIENDLY.unavailable } }, 502)
  }

  const text = (data?.candidates?.[0]?.content?.parts ?? [])
    .map((part: { text?: string }) => part?.text ?? '')
    .join('')
    .trim()

  if (!text) {
    const finishReason = data?.candidates?.[0]?.finishReason
    if (finishReason === 'SAFETY' || finishReason === 'PROHIBITED_CONTENT') {
      return c.json({ error: { message: 'That request was blocked by the assistant’s safety filter. Try rephrasing it.' } }, 422)
    }
    return c.json({ error: { message: FRIENDLY.empty } }, 502)
  }

  return c.json({ text })
}
