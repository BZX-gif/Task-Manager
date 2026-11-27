/** Small, dependency-free id generator that works in browsers and in Node. */
let counter = 0

export function createId(prefix = ''): string {
  const cryptoApi = globalThis.crypto
  const random =
    cryptoApi && typeof cryptoApi.randomUUID === 'function'
      ? cryptoApi.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  counter = (counter + 1) % 1000
  const suffix = counter.toString(36).padStart(2, '0')
  return `${prefix}${prefix ? '-' : ''}${random}${suffix}`
}
