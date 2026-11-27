import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MemoryStorage,
  STORAGE_KEYS,
  clearAll,
  createDefaultMeta,
  createEmptyDraft,
  exportData,
  importData,
  loadData,
  sanitizeBill,
  sanitizeProduct,
  sanitizeSettings,
  saveAll,
  saveDraft,
  saveProducts,
  storageAvailable,
  storageFootprint,
  writeKey,
} from '../../src/lib/storage.ts'
import { draftItemFromProduct } from '../../src/lib/billing.ts'
import type { AppData, Product } from '../../src/lib/types.ts'

let ids = 0
const id = () => `id${++ids}`

const sampleProduct: Product = {
  id: 'p1',
  name: 'Sugar',
  price: 45,
  unit: 'kg',
  aliases: ['chini'],
  createdAt: 1,
  updatedAt: 1,
}

function seedData(): AppData {
  const draft = {
    ...createEmptyDraft(500, 'draft-a'),
    items: [draftItemFromProduct(sampleProduct, 2, { id: 'i1', source: 'manual' })],
  }
  return {
    products: [sampleProduct],
    bills: [],
    settings: {
      shopName: 'Sharma Kirana',
      address: '12 Gandhi Market',
      phone: '9876543210',
      currency: '₹',
      receiptWidth: '80',
      language: 'hi-IN',
      thankYou: 'Thank you!',
    },
    draft,
    meta: { ...createDefaultMeta(100), onboarded: true },
  }
}

test('product, draft and settings survive a reload', () => {
  const storage = new MemoryStorage()
  const data = seedData()
  assert.equal(saveAll(storage, data), true)
  const loaded = loadData(storage, 9_999, id)
  assert.equal(loaded.problems.length, 0)
  assert.equal(loaded.data.products.length, 1)
  assert.equal(loaded.data.products[0].name, 'Sugar')
  assert.equal(loaded.data.settings.shopName, 'Sharma Kirana')
  assert.equal(loaded.data.draft.items.length, 1)
  assert.equal(loaded.data.draft.items[0].quantity, 2)
  assert.equal(loaded.data.meta.onboarded, true)
})

test('corrupted JSON falls back safely instead of crashing', () => {
  const storage = new MemoryStorage()
  storage.setItem(STORAGE_KEYS.products, '{not json')
  storage.setItem(STORAGE_KEYS.settings, 'null')
  const loaded = loadData(storage, 100, id)
  assert.deepEqual(loaded.data.products, [])
  assert.equal(loaded.data.settings.currency, '₹')
  assert.ok(loaded.problems.length >= 1)
})

test('invalid saved products are skipped, not trusted', () => {
  const storage = new MemoryStorage()
  storage.setItem(
    STORAGE_KEYS.products,
    JSON.stringify([
      { id: 'a', name: 'Sugar', price: 45, unit: 'kg', aliases: [] },
      { id: 'b', name: '', price: 10, unit: 'kg' },
      { id: 'c', name: 'Oil', price: -5, unit: 'litre' },
      { id: 'd', name: 'Soap', price: 30, unit: 'bar' },
      { id: 'e', name: 'Rice', price: 55, unit: 'kg', aliases: 'not-an-array' },
    ]),
  )
  const loaded = loadData(storage, 1, id)
  assert.deepEqual(loaded.data.products.map((p) => p.name), ['Sugar', 'Rice'])
  assert.equal(loaded.data.products[1].aliases.length, 0)
  assert.ok(loaded.problems.some((problem) => /product/i.test(problem)))
})

test('sanitisers normalise values rather than passing them through', () => {
  assert.equal(sanitizeProduct({ id: 'x', name: ' Sugar ', price: 45.678, unit: 'kg' })?.price, 45.68)
  assert.equal(sanitizeProduct({ id: 'x', name: 'Sugar', price: 45, unit: 'kg', aliases: ['a', 3, 'b'] })?.aliases.length, 2)
  assert.equal(sanitizeSettings({ receiptWidth: 'huge', language: 'fr', currency: '' }).receiptWidth, '80')
  assert.equal(sanitizeSettings({ receiptWidth: '58', language: 'en-IN' }).language, 'en-IN')
  assert.equal(sanitizeBill({ id: 'b', number: 'VB-1', createdAt: 1, items: [], total: 5 }), null)
})

test('the draft is saved on every change (refresh is safe)', () => {
  const storage = new MemoryStorage()
  const draft = { ...createEmptyDraft(10, 'd'), items: [draftItemFromProduct(sampleProduct, 1.5, { id: 'i1', source: 'voice' })] }
  assert.equal(saveDraft(storage, draft), true)
  assert.equal(loadData(storage, 20, id).data.draft.items[0].quantity, 1.5)
})

test('export → import round-trips the whole shop', () => {
  const data = seedData()
  const json = exportData(data)
  assert.match(json, /"app": "voicebill"/)
  const result = importData(json, 1_000, id)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.data.products.length, 1)
  assert.equal(result.data.settings.shopName, 'Sharma Kirana')
  assert.equal(result.data.draft.items.length, 1)
})

test('imports from other apps and broken files are refused', () => {
  assert.equal(importData('not json', 1, id).ok, false)
  assert.equal(importData('{"app":"other"}', 1, id).ok, false)
  assert.equal(importData('{"app":"voicebill"}', 1, id).ok, false)
})

test('storage failures are reported, not swallowed silently', () => {
  const full = {
    getItem: () => null,
    setItem: () => {
      throw new Error('quota exceeded')
    },
    removeItem: () => undefined,
  }
  assert.equal(writeKey(full, STORAGE_KEYS.products, []), false)
  assert.equal(storageAvailable(full), false)
  assert.equal(storageAvailable(new MemoryStorage()), true)
  assert.equal(storageAvailable(null), false)
})

test('clearing removes every VoiceBill key', () => {
  const storage = new MemoryStorage()
  saveProducts(storage, [sampleProduct])
  saveAll(storage, seedData())
  assert.ok(storageFootprint(storage) > 0)
  clearAll(storage)
  assert.equal(storageFootprint(storage), 0)
  assert.deepEqual(loadData(storage, 1, id).data.products, [])
})
