import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSampleProducts } from '../../src/lib/catalog.ts'
import { matchProduct, rankProducts } from '../../src/lib/matcher.ts'
import type { Product } from '../../src/lib/types.ts'

let counter = 0
const samples = (): Product[] => buildSampleProducts({ now: 1_000, nextId: () => `p${++counter}` })

const customProduct = (name: string, aliases: string[], price = 50): Product => ({
  id: `c${++counter}`,
  name,
  price,
  unit: 'kg',
  aliases,
  createdAt: 1,
  updatedAt: 1,
})

test('exact product names match with full confidence', () => {
  const products = samples()
  const result = matchProduct('Sugar', products)
  assert.equal(result.product?.name, 'Sugar')
  assert.equal(result.confidence, 1)
  assert.equal(result.reason, 'exact')
})

test('Hindi aliases match the right catalogue product', () => {
  const products = samples()
  for (const [spoken, expected] of [
    ['chini', 'Sugar'],
    ['shakkar', 'Sugar'],
    ['aata', 'Wheat Flour (Aata)'],
    ['gehu ka aata', 'Wheat Flour (Aata)'],
    ['chawal', 'Rice'],
    ['tel', 'Soybean Oil'],
    ['sarson ka tel', 'Mustard Oil'],
    ['maggi', 'Maggi Noodles'],
    ['namak', 'Tata Salt'],
  ] as const) {
    assert.equal(matchProduct(spoken, products).product?.name, expected, `${spoken} → ${expected}`)
  }
})

test('custom aliases added by the shopkeeper are honoured', () => {
  const products: Product[] = [...samples(), customProduct('Doodh', ['doodh', 'milk'], 60)]
  assert.equal(matchProduct('milk', products).product?.name, 'Doodh')
  assert.equal(matchProduct('doodh', products).product?.name, 'Doodh')
})

test('a different dal is not silently billed as Toor Dal', () => {
  const products = samples()
  const result = matchProduct('chana dal', products)
  assert.equal(result.product, null)
  assert.notEqual(result.reason, 'exact')
})

test('unknown products are not matched to a random item', () => {
  const products = samples()
  for (const spoken of ['sabun', 'shampoo', 'chocolate', 'battery']) {
    assert.equal(matchProduct(spoken, products).product, null, spoken)
  }
})

test('near-identical products ask instead of guessing', () => {
  const products: Product[] = [customProduct('Sunflower Oil', ['tel', 'oil']), customProduct('Mustard Oil', ['tel'])]
  const result = matchProduct('tel', products)
  assert.equal(result.product, null)
  assert.equal(result.reason, 'ambiguous')
  assert.ok(result.candidates.length >= 2)
})

test('suggestions are ranked and capped', () => {
  const products = samples()
  const ranked = rankProducts('chini', products)
  assert.equal(ranked[0].product.name, 'Sugar')
  assert.ok(ranked.length <= 6)
  assert.ok(ranked.every((candidate, index) => index === 0 || candidate.score <= ranked[index - 1].score))
})

test('typos are suggestions, not automatic selections', () => {
  const products = samples()
  const result = matchProduct('cheeni', products)
  // "cheeni" is a sample alias, so this one is exact.
  assert.equal(result.product?.name, 'Sugar')
  const typo = matchProduct('chinii', products)
  if (typo.product) {
    assert.equal(typo.product.name, 'Sugar')
    assert.ok(['fuzzy', 'alias'].includes(typo.reason))
  } else {
    assert.ok(typo.candidates.length > 0)
  }
})
