import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

// Run the real service worker with an offline network and a populated shell cache.
test('pre-cached assets are served offline without returning JavaScript for missing files', async () => {
  const script = await readFile(new URL('../../public/sw.js', import.meta.url), 'utf8')
  const handlers = {}
  const shell = new Map([
    ['/static/hero-atmosphere.jpg', new Response('image content', { headers: { 'content-type': 'image/jpeg' } })],
    ['/static/js/app.js', new Response('app bundle')],
  ])
  const caches = {
    async open(name) {
      return {
        async match(request) {
          const path = new URL(typeof request === 'string' ? request : request.url, 'https://app.test').pathname
          return name.startsWith('cc-shell-') ? shell.get(path)?.clone() : undefined
        },
        async put() {},
      }
    },
  }
  vm.runInNewContext(script, {
    self: { location: { origin: 'https://app.test' }, addEventListener: (name, handler) => { handlers[name] = handler } },
    caches,
    URL,
    Request,
    Response,
    fetch: async () => { throw new Error('offline') },
  })
  async function request(path) {
    let response
    handlers.fetch({ request: new Request(`https://app.test${path}`), respondWith(promise) { response = promise } })
    return response
  }
  const image = await request('/static/hero-atmosphere.jpg')
  assert.equal(image.headers.get('content-type'), 'image/jpeg')
  assert.equal(await image.text(), 'image content')
  const missing = await request('/static/missing.jpg')
  assert.equal(missing.type, 'error')
})

// A navigation to a client route (/calendar) must never be answered with the
// host's 404 page: the chapters are not files, so the shell is the right answer.
test('a navigation that would 404 falls back to the cached shell', async () => {
  const script = await readFile(new URL('../../public/sw.js', import.meta.url), 'utf8')
  const handlers = {}
  const shellCache = new Map([['/', new Response('<!DOCTYPE html><div id="app"></div>', { headers: { 'content-type': 'text/html' } })]])
  const caches = {
    async open(name) {
      return {
        async match(request) {
          const path = new URL(typeof request === 'string' ? request : request.url, 'https://app.test').pathname
          return name.startsWith('cc-shell-') ? shellCache.get(path)?.clone() : undefined
        },
        async put() {},
      }
    },
  }
  vm.runInNewContext(script, {
    self: { location: { origin: 'https://app.test' }, addEventListener: (name, handler) => { handlers[name] = handler } },
    caches,
    URL,
    Request,
    Response,
    // the host knows nothing about /calendar and answers 404, as a static host will
    fetch: async () => new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } }),
  })
  let response
  const nav = new Request('https://app.test/calendar')
  Object.defineProperty(nav, 'mode', { value: 'navigate' })
  handlers.fetch({ request: nav, respondWith(promise) { response = promise } })
  const resolved = await response
  assert.equal(resolved.status, 200, 'the visitor gets the app, not an error page')
  assert.match(await resolved.text(), /id="app"/, 'and it is the shell')
})

test('a genuine non-navigation 404 is passed through rather than hidden', async () => {
  const script = await readFile(new URL('../../public/sw.js', import.meta.url), 'utf8')
  const handlers = {}
  const caches = { async open() { return { async match() { return undefined }, async put() {} } } }
  vm.runInNewContext(script, {
    self: { location: { origin: 'https://app.test' }, addEventListener: (name, handler) => { handlers[name] = handler } },
    caches,
    URL,
    Request,
    Response,
    fetch: async () => new Response('Not Found', { status: 404 }),
  })
  let response
  handlers.fetch({ request: new Request('https://app.test/static/missing.png'), respondWith(promise) { response = promise } })
  assert.equal((await response).status, 404, 'a missing asset still reports 404')
})
