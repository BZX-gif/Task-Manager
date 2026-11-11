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
