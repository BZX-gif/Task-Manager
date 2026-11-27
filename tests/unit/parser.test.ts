import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseUtterance, parseUtteranceDetailed } from '../../src/lib/parser.ts'

test('English sentence with units and multiple products', () => {
  const items = parseUtterance('Three kilograms of sugar and two litres oil')
  assert.equal(items.length, 2)
  assert.deepEqual(
    items.map((item) => [item.name, item.quantity, item.unit]),
    [
      ['sugar', 3, 'kg'],
      ['oil', 2, 'litre'],
    ],
  )
})

test('Hinglish list separated by commas and "aur"', () => {
  const items = parseUtterance('3 kilo chini, 2 kilo aata aur 3 litre soybean tel')
  assert.deepEqual(
    items.map((item) => [item.name, item.quantity, item.unit]),
    [
      ['chini', 3, 'kg'],
      ['aata', 2, 'kg'],
      ['soybean tel', 3, 'litre'],
    ],
  )
})

test('Hindi number words are understood', () => {
  const items = parseUtterance('Teen litre tel aur paanch packet Maggi')
  assert.deepEqual(
    items.map((item) => [item.name, item.quantity, item.unit]),
    [
      ['tel', 3, 'litre'],
      ['maggi', 5, 'packet'],
    ],
  )
})

test('Devanagari speech is parsed through transliteration', () => {
  const items = parseUtterance('मुझे तीन किलो चीनी और दो किलो आटा चाहिए')
  assert.equal(items.length, 2)
  assert.deepEqual(
    items.map((item) => [item.name, item.quantity, item.unit]),
    [
      ['chini', 3, 'kg'],
      ['ata', 2, 'kg'],
    ],
  )
})

test('quantity-first and product-first phrasing both work', () => {
  assert.deepEqual(
    parseUtterance('chini 3 kilo').map((item) => [item.name, item.quantity, item.unit]),
    [['chini', 3, 'kg']],
  )
  assert.deepEqual(
    parseUtterance('3 kilo chini').map((item) => [item.name, item.quantity, item.unit]),
    [['chini', 3, 'kg']],
  )
})

test('two quantity groups in one breath without a separator', () => {
  const items = parseUtterance('2 kilo chini 1 kilo chawal')
  assert.deepEqual(
    items.map((item) => [item.name, item.quantity]),
    [
      ['chini', 2],
      ['chawal', 1],
    ],
  )
})

test('decimal and fractional quantities', () => {
  assert.equal(parseUtterance('1.5 kg aata')[0]?.quantity, 1.5)
  assert.equal(parseUtterance('aadha kilo chini')[0]?.quantity, 0.5)
  assert.equal(parseUtterance('do point five kilo chini')[0]?.quantity, 2.5)
  assert.equal(parseUtterance('1/2 kilo chini')[0]?.quantity, 0.5)
})

test('measurement units: gram, ml, packet, piece, dozen', () => {
  const units = parseUtterance('500 gram chini aur 250 ml tel aur 2 packet maggi aur 3 piece soap aur 1 dozen eggs').map(
    (item) => [item.quantity, item.unit, item.name],
  )
  assert.deepEqual(units, [
    [500, 'gram', 'chini'],
    [250, 'ml', 'tel'],
    [2, 'packet', 'maggi'],
    [3, 'piece', 'soap'],
    [1, 'dozen', 'eggs'],
  ])
})

test('a bare product gets no quantity and no unit', () => {
  const items = parseUtterance('maggi')
  assert.equal(items.length, 1)
  assert.equal(items[0].name, 'maggi')
  assert.equal(items[0].quantity, null)
  assert.equal(items[0].unit, null)
  assert.equal(items[0].hasQuantity, false)
})

test('repeat within one utterance is merged, not duplicated', () => {
  const items = parseUtterance('2 packet maggi aur 2 packet maggi')
  assert.equal(items.length, 1)
  assert.equal(items[0].quantity, 4)
})

test('empty and nonsense speech produces no items', () => {
  assert.deepEqual(parseUtterance(''), [])
  assert.deepEqual(parseUtterance('   '), [])
  assert.deepEqual(parseUtterance('...'), [])
})

test('a quantity with no product is reported, not silently dropped', () => {
  const outcome = parseUtteranceDetailed('3 kilo chini aur 2 kilo')
  assert.equal(outcome.items.length, 1)
  assert.equal(outcome.items[0].name, 'chini')
  assert.equal(outcome.issues.length, 1)
  assert.match(outcome.issues[0], /product name/i)
})

test('implausibly large quantities raise a warning', () => {
  const items = parseUtterance('9000 kilo chini')
  assert.ok(items[0].warnings.some((warning) => /large/i.test(warning)))
})

test('filler conversation around the list is ignored', () => {
  const items = parseUtterance('mujhe 3 kilo chini chahiye bhai')
  assert.deepEqual(
    items.map((item) => [item.name, item.quantity]),
    [['chini', 3]],
  )
})
