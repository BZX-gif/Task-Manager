import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildReceipt, receiptFileName, receiptWidthMm } from '../../src/lib/receipt.ts'
import type { Bill, Settings } from '../../src/lib/types.ts'

const settings: Settings = {
  shopName: 'Sharma Kirana Store',
  address: '12, Gandhi Market, Jaipur',
  phone: '98765 43210',
  currency: '₹',
  receiptWidth: '80',
  language: 'hi-IN',
  thankYou: 'Thank you, phir aaiye!',
}

const bill: Bill = {
  id: 'bill-1',
  number: 'VB-20261127-001',
  createdAt: Date.parse('2026-11-27T09:15:00'),
  items: [
    { productId: 'p1', name: 'Sugar', unit: 'kg', quantity: 3, unitPrice: 45, lineTotal: 135 },
    { productId: 'p2', name: 'Soybean Oil', unit: 'litre', quantity: 3, unitPrice: 130, lineTotal: 390 },
  ],
  subtotal: 525,
  discount: 25,
  discountType: 'amount',
  discountValue: 25,
  total: 500,
}

test('receipt contains everything a shop receipt needs', () => {
  const model = buildReceipt(bill, settings)
  assert.equal(model.shopName, 'Sharma Kirana Store')
  assert.equal(model.address, '12, Gandhi Market, Jaipur')
  assert.equal(model.phone, '98765 43210')
  assert.equal(model.billNumber, 'VB-20261127-001')
  assert.equal(model.dateLabel, '27 Nov 2026')
  assert.match(model.timeLabel, /9:15\sAM/i)
  assert.equal(model.lines.length, 2)
  assert.deepEqual(model.lines[0], {
    name: 'Sugar',
    quantity: '3 kg',
    rate: '₹45.00/kg',
    amount: '₹135.00',
  })
  assert.equal(model.subtotal, '₹525.00')
  assert.equal(model.discount, '₹25.00')
  assert.equal(model.total, '₹500.00')
  assert.equal(model.thankYou, 'Thank you, phir aaiye!')
  assert.equal(model.itemCount, 2)
})

test('receipt width is translated to real paper sizes', () => {
  assert.equal(receiptWidthMm('58'), 58)
  assert.equal(receiptWidthMm('80'), 80)
  assert.equal(receiptWidthMm('a4'), null)
  assert.equal(buildReceipt(bill, { ...settings, receiptWidth: '58' }).widthMm, 58)
  assert.equal(buildReceipt(bill, { ...settings, receiptWidth: 'a4' }).width, 'a4')
})

test('empty shop details fall back gracefully', () => {
  const model = buildReceipt(bill, { ...settings, shopName: '', address: '', phone: '', thankYou: '' })
  assert.equal(model.shopName, 'Your Shop')
  assert.equal(model.address, '')
  assert.equal(model.phone, '')
  assert.match(model.thankYou, /thank you/i)
})

test('receipt filename follows the bill number', () => {
  assert.equal(receiptFileName(bill), 'VB-20261127-001.pdf')
})
