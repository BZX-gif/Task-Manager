import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addProduct,
  buildSampleProducts,
  parseAliases,
  parsePrice,
  removeProduct,
  removeSampleProducts,
  updateProduct,
  validateProduct,
} from '../../src/lib/catalog.ts'
import type { Product } from '../../src/lib/types.ts'

const meta = { id: 'p1', now: 1_700_000_000_000 }

test('a valid product is created with clean aliases', () => {
  const result = addProduct([], { name: '  Sugar ', price: '45.50', unit: 'kg', aliases: 'chini, cheeni , Chini' }, meta)
  assert.equal(result.ok, true)
  assert.ok(result.product)
  assert.equal(result.product?.name, 'Sugar')
  assert.equal(result.product?.price, 45.5)
  assert.equal(result.product?.unit, 'kg')
  assert.deepEqual(result.product?.aliases, ['chini', 'cheeni'])
  assert.equal(result.product?.createdAt, meta.now)
})

test('product validation rejects empty names and bad prices', () => {
  assert.equal(validateProduct({ name: '   ', price: '45', unit: 'kg', aliases: '' }, []).ok, false)
  assert.equal(validateProduct({ name: 'Sugar', price: '', unit: 'kg', aliases: '' }, []).errors.price !== undefined, true)
  assert.equal(validateProduct({ name: 'Sugar', price: '0', unit: 'kg', aliases: '' }, []).errors.price !== undefined, true)
  assert.equal(validateProduct({ name: 'Sugar', price: 'abc', unit: 'kg', aliases: '' }, []).errors.price !== undefined, true)
  assert.equal(validateProduct({ name: 'Sugar', price: '45', unit: 'bottle', aliases: '' }, []).errors.unit !== undefined, true)
})

test('duplicate product names are rejected, but editing keeps its own name', () => {
  const products: Product[] = [
    { id: 'a', name: 'Sugar', price: 45, unit: 'kg', aliases: [], createdAt: 1, updatedAt: 1 },
  ]
  const duplicate = validateProduct({ name: 'sugar', price: '50', unit: 'kg', aliases: '' }, products)
  assert.equal(duplicate.ok, false)
  assert.match(duplicate.errors.name ?? '', /already exists/)
  const editing = validateProduct({ name: 'Sugar', price: '50', unit: 'kg', aliases: '' }, products, { ignoreId: 'a' })
  assert.equal(editing.ok, true)
})

test('prices are parsed from shopkeeper-friendly formats', () => {
  assert.equal(parsePrice('45'), 45)
  assert.equal(parsePrice('₹45.50'), 45.5)
  assert.equal(parsePrice('1,250'), 1250)
  assert.equal(parsePrice('45/-'), 45)
  assert.equal(parsePrice('45.555'), null)
  assert.equal(parsePrice(''), null)
  assert.equal(parsePrice('abc'), null)
})

test('alias input is deduplicated against the product name', () => {
  assert.deepEqual(parseAliases('chini, Sugar, cheeni, chini'), ['chini', 'Sugar', 'cheeni'])
  const result = addProduct([], { name: 'Sugar', price: 45, unit: 'kg', aliases: 'chini, chini, Sugar' }, meta)
  assert.deepEqual(result.product?.aliases, ['chini'])
})

test('editing keeps the id and creation date but changes the price', () => {
  const products: Product[] = [
    { id: 'a', name: 'Sugar', price: 45, unit: 'kg', aliases: ['chini'], createdAt: 100, updatedAt: 100 },
  ]
  const result = updateProduct(products, 'a', { name: 'Sugar', price: '48', unit: 'kg', aliases: 'chini' }, { now: 500 })
  assert.equal(result.ok, true)
  assert.equal(result.products[0].price, 48)
  assert.equal(result.products[0].createdAt, 100)
  assert.equal(result.products[0].updatedAt, 500)
})

test('deleting a product removes only that product', () => {
  const products: Product[] = [
    { id: 'a', name: 'Sugar', price: 45, unit: 'kg', aliases: [], createdAt: 1, updatedAt: 1 },
    { id: 'b', name: 'Rice', price: 55, unit: 'kg', aliases: [], createdAt: 1, updatedAt: 1 },
  ]
  assert.deepEqual(removeProduct(products, 'a').map((product) => product.id), ['b'])
})

test('sample products are clearly marked and can be removed together', () => {
  const samples = buildSampleProducts({ now: 5, nextId: (() => { let index = 0; return () => `s${++index}` })() })
  assert.ok(samples.length >= 6)
  assert.ok(samples.every((product) => product.sample === true))
  assert.ok(samples.every((product) => product.price > 0))
  const own: Product = { id: 'own', name: 'My Item', price: 10, unit: 'piece', aliases: [], createdAt: 1, updatedAt: 1 }
  const remaining = removeSampleProducts([...samples, own])
  assert.equal(remaining.length, 1)
  assert.equal(remaining[0].id, 'own')
})
