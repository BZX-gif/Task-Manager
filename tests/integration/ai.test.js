import { test } from 'node:test'
import assert from 'node:assert/strict'
import worker from '../../dist/index.js'

const payload = { system: 'Be helpful', context: 'Today', messages: [{ role: 'user', content: 'Plan my day' }] }
const env = { GEMINI_API_KEY: 'test-only-placeholder' }
const answer = () => Response.json({ candidates: [{ content: { parts: [{ text: 'A plan' }] } }] })
const request = (bindings = env, body = payload) => worker.request('/api/ai', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}, bindings)

test('direct Gemini preserves contract, model and server-only credential', async (t) => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls++
    assert.match(url, /models\/gemini-3.6-flash:generateContent$/)
    assert.equal(init.headers['x-goog-api-key'], env.GEMINI_API_KEY)
    assert.equal(init.redirect, 'error')
    assert.equal(JSON.parse(init.body).contents[0].parts[0].text, 'Plan my day')
    return answer()
  })
  assert.deepEqual(await (await request()).json(), { text: 'A plan' })
  assert.equal(calls, 1)
})

for (const [upstream, detail, status, code] of [
  [400, { status: 'FAILED_PRECONDITION', message: 'User location is not supported for the API use' }, 503, 'provider_location'],
  [400, { message: 'bad input' }, 400, 'provider_bad_request'],
  [400, { message: 'API key not valid' }, 500, 'provider_authentication'],
  [401, {}, 500, 'provider_authentication'], [403, {}, 500, 'provider_authentication'],
  [404, {}, 500, 'provider_model_configuration'], [429, {}, 429, 'provider_rate_limit'],
  [500, {}, 503, 'provider_unavailable'], [503, {}, 503, 'provider_unavailable'],
]) {
  test(`upstream ${upstream}/${code} is classified, sanitized and never retried`, async (t) => {
    const logs = []
    let calls = 0
    t.mock.method(console, 'warn', (...args) => logs.push(args))
    t.mock.method(globalThis, 'fetch', async () => {
      calls++
      return Response.json({ error: { ...detail, diagnostic: env.GEMINI_API_KEY } }, { status: upstream })
    })
    const response = await request()
    assert.equal(response.status, status)
    const body = await response.json()
    assert.equal(body.error.code, code)
    assert.equal(calls, 1)
    assert.ok(!JSON.stringify([body, logs]).includes(env.GEMINI_API_KEY))
    assert.match(JSON.stringify(logs), new RegExp(code))
  })
}

test('Gateway uses only the binding and configurable Gemini model', async (t) => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('must not use direct egress'))
  const binding = { async fetch(url) {
    assert.equal(this, binding)
    assert.match(url, /models\/test-model:generateContent$/)
    return answer()
  } }
  const response = await request({ ...env, GEMINI_TRANSPORT: 'gateway', GEMINI_MODEL: 'test-model', GEMINI_EGRESS: binding })
  assert.deepEqual(await response.json(), { text: 'A plan' })
})

test('Gateway failure does not fall back to shared egress or expose exceptions', async (t) => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('no direct fallback'))
  const logs = []
  t.mock.method(console, 'warn', (...args) => logs.push(args))
  const response = await request({ ...env, GEMINI_TRANSPORT: 'gateway', GEMINI_EGRESS: { async fetch() { throw Error(env.GEMINI_API_KEY) } } })
  assert.equal(response.status, 503)
  const body = await response.json()
  assert.equal(body.error.code, 'provider_network')
  assert.ok(!JSON.stringify([body, logs]).includes(env.GEMINI_API_KEY))
})

for (const bindings of [{}, { ...env, GEMINI_TRANSPORT: 'gateway' }, { ...env, GEMINI_TRANSPORT: 'invalid' }, { ...env, GEMINI_MODEL: '../bad?key=x' }]) {
  test(`invalid configuration ${JSON.stringify(Object.keys(bindings))} fails closed`, async (t) => {
    t.mock.method(globalThis, 'fetch', () => assert.fail('no upstream call'))
    const response = await request(bindings)
    assert.equal(response.status, 500)
    assert.equal((await response.json()).error.code, 'configuration')
  })
}

for (const body of [null, [], {}, { messages: {} }, { messages: [null] }, { messages: [{ role: 'invalid', content: 'x' }] }, { messages: [] }, { ...payload, system: 123 }]) {
  test(`malformed request ${JSON.stringify(body)} returns 400 before any upstream call`, async (t) => {
    t.mock.method(globalThis, 'fetch', () => assert.fail('no upstream call'))
    assert.equal((await request({}, body)).status, 400)
  })
}

test('invalid JSON, malformed success, empty answer, safety and timeout', async (t) => {
  assert.equal((await worker.request('/api/ai', { method: 'POST', body: '{' }, env)).status, 400)
  for (const [make, status, code] of [
    [() => new Response('not json'), 502, 'provider_protocol'],
    [() => Response.json({ candidates: [{ content: { parts: {} } }] }), 502, 'provider_empty'],
    [() => Response.json({ candidates: [{ finishReason: 'SAFETY' }] }), 422, 'provider_safety'],
    [() => { throw new DOMException('timeout', 'TimeoutError') }, 504, 'provider_timeout'],
  ]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => make())
    const response = await request()
    assert.equal(response.status, status)
    assert.equal((await response.json()).error.code, code)
    mock.mock.restore()
  }
})
