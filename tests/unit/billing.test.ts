import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeTotals, lineAmount, resolveDiscount, round2 } from '../../src/lib/money.ts'
import {
  draftItemFromParsed,
  draftItemFromProduct,
  draftIssues,
  draftReadiness,
  finalizeBill,
  mergeDraftItem,
  nextBillNumber,
} from '../../src/lib/billing.ts'
import { createEmptyDraft } from '../../src/lib/storage.ts'
import { parseUtterance } from '../../src/lib/parser.ts'
import { addProduct, buildSampleProducts } from '../../src/lib/catalog.ts'
import type { Draft, Product } from '../../src/lib/types.ts'

let counter = 0
const samples = (): Product[] => buildSampleProducts({ now: 1_000, nextId: () => `p${++counter}` })
const product = (id: string, name: string, price: number, unit: Product['unit'] = 'kg'): Product => ({
  id,
  name,
  price,
  unit,
  aliases: [name.toLowerCase()],
  createdAt: 1,
  updatedAt: 1,
})

test('money is rounded to paise, not floating point drift', () => {
  assert.equal(round2(1.005), 1.01)
  assert.equal(lineAmount(3, 45), 135)
  assert.equal(lineAmount(1.5, 45), 67.5)
  assert.equal(lineAmount(0.1, 0.2), 0.02)
  assert.equal(lineAmount(3, 45.333), 135.99, 'unit price is stored in paise')
})

test('the worked example from the brief totals correctly', () => {
  const products = samples()
  const parsed = parseUtterance('3 kilo chini aur 2 kilo aata aur 3 litre soybean tel')
  const items = parsed.map((item, index) => draftItemFromParsed(item, products, `i${index}`))
  const totals = computeTotals(items, { type: 'amount', value: 0 })
  assert.equal(totals.subtotal, 605)
  assert.equal(totals.total, 605)
  assert.deepEqual(Object.values(totals.lineTotals), [135, 80, 390])
})

test('quantity in a different but compatible unit converts', () => {
  const products = [{ ...product('sugar', 'Sugar', 45, 'kg'), aliases: ['sugar', 'chini'] }]
  const item = draftItemFromParsed(parseUtterance('500 gram chini')[0], products, 'i1')
  assert.equal(item.quantity, 0.5)
  assert.equal(item.unit, 'kg')
  assert.equal(item.status, 'ready')
})

test('an incompatible unit is flagged instead of silently billed', () => {
  const products = [product('maggi', 'Maggi', 14, 'packet')]
  const item = draftItemFromParsed(parseUtterance('2 kilo maggi')[0], products, 'i1')
  assert.equal(item.status, 'unit-mismatch')
  const issues = draftIssues({ ...createEmptyDraft(1, 'd'), items: [item] })
  assert.ok(issues.some((issue) => issue.code === 'unit-mismatch'))
})

test('discounts are clamped to the bill and support percent', () => {
  assert.equal(resolveDiscount(100, { type: 'amount', value: 20 }), 20)
  assert.equal(resolveDiscount(100, { type: 'amount', value: 500 }), 100)
  assert.equal(resolveDiscount(100, { type: 'percent', value: 10 }), 10)
  assert.equal(resolveDiscount(100, { type: 'percent', value: 150 }), 100)
  assert.equal(resolveDiscount(99.99, { type: 'percent', value: 12.5 }), 12.5)
})

test('empty bills cannot be finalised', () => {
  const draft = createEmptyDraft(1, 'd')
  const readiness = draftReadiness(draft)
  assert.equal(readiness.ok, false)
  assert.ok(readiness.issues.some((issue) => issue.code === 'empty'))
  const result = finalizeBill(draft, [], [], 1, 'bill')
  assert.equal(result.ok, false)
})

test('unmatched products block the bill', () => {
  const draft: Draft = {
    ...createEmptyDraft(1, 'd'),
    items: [
      {
        id: 'i1',
        productId: null,
        name: 'chocolate',
        unit: 'piece',
        quantity: 2,
        unitPrice: 0,
        priceOverride: false,
        source: 'voice',
        status: 'unmatched',
        confidence: 0,
      },
    ],
  }
  const readiness = draftReadiness(draft)
  assert.equal(readiness.ok, false)
  assert.ok(readiness.issues.some((issue) => issue.code === 'unmatched'))
})

test('a product with no price blocks the bill until a price is set', () => {
  const zeroPrice = product('x', 'No Price', 0)
  const item = draftItemFromProduct(zeroPrice, 2, { id: 'i1', source: 'manual' })
  assert.equal(item.status, 'missing-price')
  const issues = draftIssues({ ...createEmptyDraft(1, 'd'), items: [item] })
  assert.ok(issues.some((issue) => issue.code === 'missing-price'))
})

test('a valid draft finalises with a bill number and frozen lines', () => {
  const products = [product('sugar', 'Sugar', 45), product('rice', 'Rice', 55)]
  const draft: Draft = {
    ...createEmptyDraft(10, 'd'),
    items: [
      draftItemFromProduct(products[0], 3, { id: 'i1', source: 'manual' }),
      draftItemFromProduct(products[1], 2, { id: 'i2', source: 'manual' }),
    ],
    discountType: 'amount',
    discountValue: 11.5,
  }
  assert.equal(draftReadiness(draft).ok, true)
  const now = Date.parse('2026-11-27T10:00:00')
  const result = finalizeBill(draft, products, [], now, 'bill-1')
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.bill.number, 'VB-20261127-001')
  assert.equal(result.bill.subtotal, 245)
  assert.equal(result.bill.discount, 11.5)
  assert.equal(result.bill.total, 233.5)
  assert.equal(result.bill.items.length, 2)
  assert.equal(result.bill.items[0].lineTotal, 135)
})

test('bill numbers increment per day and never collide', () => {
  const day = Date.parse('2026-11-27T10:00:00')
  const other = Date.parse('2026-11-26T10:00:00')
  const bills = [
    { id: '1', number: 'VB-20261127-001', createdAt: day, items: [], subtotal: 0, discount: 0, discountType: 'amount' as const, discountValue: 0, total: 0 },
    { id: '2', number: 'VB-20261127-007', createdAt: day, items: [], subtotal: 0, discount: 0, discountType: 'amount' as const, discountValue: 0, total: 0 },
    { id: '3', number: 'VB-20261126-003', createdAt: other, items: [], subtotal: 0, discount: 0, discountType: 'amount' as const, discountValue: 0, total: 0 },
  ]
  assert.equal(nextBillNumber(bills, day), 'VB-20261127-008')
  assert.equal(nextBillNumber(bills, other), 'VB-20261126-004')
})

test('the same product spoken twice merges into one line', () => {
  const products = [product('sugar', 'Sugar', 45)]
  const first = draftItemFromProduct(products[0], 2, { id: 'i1', source: 'voice' })
  const second = draftItemFromProduct(products[0], 3, { id: 'i2', source: 'voice' })
  const merged = mergeDraftItem([first], second)
  assert.equal(merged.merged, true)
  assert.equal(merged.items.length, 1)
  assert.equal(merged.items[0].quantity, 5)

  const different = draftItemFromProduct(products[0], 1, { id: 'i3', source: 'manual' })
  different.unitPrice = 40
  const notMerged = mergeDraftItem([first], different)
  assert.equal(notMerged.merged, false)
  assert.equal(notMerged.items.length, 2)
})

test('a newly added product can be used immediately for billing', () => {
  const created = addProduct([], { name: 'Ghee', price: '650', unit: 'litre', aliases: 'ghee, clarified butter' }, { id: 'g1', now: 1 })
  assert.ok(created.product)
  const draft = { ...createEmptyDraft(1, 'd'), items: [draftItemFromProduct(created.product!, 0.5, { id: 'i1', source: 'manual' })] }
  const result = finalizeBill(draft, [created.product!], [], Date.parse('2026-01-02T09:00:00'), 'b1')
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.bill.total, 325)
})
