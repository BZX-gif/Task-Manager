import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

export interface WorkerEnv {
  GEMINI_API_KEY?: string
  GEMINI_MODEL?: string
  GEMINI_TRANSPORT?: 'direct' | 'gateway'
  GEMINI_EGRESS?: { fetch(input: string, init: RequestInit): Promise<Response> }
}

const GEMINI_MODEL = 'gemini-3.6-flash'
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

/** Only fixed categories are logged: provider bodies can echo credentials/prompts. */
function upstreamFailure(status: number, data: any): { code: string; status: ContentfulStatusCode; message: string } {
  const reason = typeof data?.error?.message === 'string' ? data.error.message : ''
  if (status === 400 && data?.error?.status === 'FAILED_PRECONDITION' && /user location is not supported for the api use/i.test(reason)) {
    return { code: 'provider_location', status: 503, message: FRIENDLY.unavailable }
  }
  if (status === 401 || status === 403 || (status === 400 &&
    ((Array.isArray(data?.error?.details) && data.error.details.some((detail: any) => detail?.reason === 'API_KEY_INVALID')) || /api key not valid|api_key_invalid/i.test(reason)))) {
    // These are server credentials, not the browser user's authentication.
    return { code: 'provider_authentication', status: 500, message: FRIENDLY.unavailable }
  }
  if (status === 429) return { code: 'provider_rate_limit', status: 429, message: FRIENDLY.rateLimited }
  if (status === 404) return { code: 'provider_model_configuration', status: 500, message: FRIENDLY.unavailable }
  if (status === 400) return { code: 'provider_bad_request', status: 400, message: FRIENDLY.badRequest }
  if (status >= 500) return { code: 'provider_unavailable', status: 503, message: FRIENDLY.unavailable }
  return { code: 'provider_protocol', status: 502, message: FRIENDLY.unavailable }
}

export async function aiHandler(c: Context) {
  const env = c.env as WorkerEnv | undefined
  const fail = (code: string, status: ContentfulStatusCode, message: string, upstreamStatus?: number) => {
    console.warn('[ai]', JSON.stringify({ provider: 'gemini', transport: env?.GEMINI_TRANSPORT === 'gateway' ? 'gateway' : 'direct', code, upstreamStatus }))
    return c.json({ error: { code, message } }, status)
  }

  let payload: {
    system?: string
    context?: string
    messages?: Array<{ role: 'user' | 'model' | 'assistant'; content: string }>
  }

  try {
    payload = await c.req.json()
  } catch {
    return fail('malformed_request', 400, 'Invalid JSON request.')
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.messages) ||
    (payload.system !== undefined && typeof payload.system !== 'string') ||
    (payload.context !== undefined && typeof payload.context !== 'string') ||
    payload.messages.some((message) => !message || typeof message.content !== 'string' || !['user', 'model', 'assistant'].includes(message.role))) {
    return fail('malformed_request', 400, FRIENDLY.badRequest)
  }

  const messages = (payload.messages ?? [])
    .filter((message) => typeof message?.content === 'string' && message.content.trim())
    .slice(-12)
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : message.role === 'model' ? 'model' : 'user',
      parts: [{ text: message.content.slice(0, 4000) }],
    }))

  if (!messages.length) {
    return fail('malformed_request', 400, 'A user message is required.')
  }

  const apiKey = env?.GEMINI_API_KEY?.trim()
  if (!apiKey) return fail('configuration', 500, FRIENDLY.missingKey)
  const model = env?.GEMINI_MODEL ?? GEMINI_MODEL
  const transport = env?.GEMINI_TRANSPORT ?? 'direct'
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(model) || !['direct', 'gateway'].includes(transport) ||
    (transport === 'gateway' && typeof env?.GEMINI_EGRESS?.fetch !== 'function')) {
    return fail('configuration', 500, 'The assistant server configuration needs attention.')
  }
  // Fixed Google origin, no caller-controlled proxy or destination. Fail closed
  // if Gateway is selected: never silently revert to rejected shared egress.
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
  const send = transport === 'gateway' ? env!.GEMINI_EGRESS!.fetch.bind(env!.GEMINI_EGRESS) : fetch

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
    response = await send(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    const timedOut = (error as Error)?.name === 'TimeoutError' || (error as Error)?.name === 'AbortError'
    return fail(timedOut ? 'provider_timeout' : 'provider_network', timedOut ? 504 : 503, timedOut ? FRIENDLY.timeout : FRIENDLY.network)
  }

  if (!response.ok) {
    let detail: unknown
    try { detail = await response.json() } catch { /* no raw response logging */ }
    const failure = upstreamFailure(response.status, detail)
    return fail(failure.code, failure.status, failure.message, response.status)
  }

  let data: any
  try {
    data = await response.json()
  } catch {
    return fail('provider_protocol', 502, FRIENDLY.unavailable)
  }

  const parts = data?.candidates?.[0]?.content?.parts
  const text = (Array.isArray(parts) ? parts : [])
    .map((part: { text?: string }) => typeof part?.text === 'string' ? part.text : '')
    .join('')
    .trim()

  if (!text) {
    const finishReason = data?.candidates?.[0]?.finishReason
    if (finishReason === 'SAFETY' || finishReason === 'PROHIBITED_CONTENT') {
      return fail('provider_safety', 422, 'That request was blocked by the assistant’s safety filter. Try rephrasing it.')
    }
    return fail('provider_empty', 502, FRIENDLY.empty)
  }

  return c.json({ text })
}
