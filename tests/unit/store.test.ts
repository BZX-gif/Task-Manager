import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStore } from '../../src/state/store.ts'
import { MemoryStorage } from '../../src/lib/storage.ts'
import { parseUtterance } from '../../src/lib/parser.ts'
import type { ProductInput } from '../../src/lib/catalog.ts'

function makeStore(storage = new MemoryStorage(), now = 1_700_000_000_000) {
  let tick = now
  let ids = 0
  return createStore({
    storage,
    now: () => (tick += 1),
    id: (prefix) => `${prefix ?? 'id'}-${++ids}`,
  })
}

const sugarInput: ProductInput = { name: 'Sugar', price: '45', unit: 'kg', aliases: 'chini, cheeni' }
const flourInput: ProductInput = { name: 'Aata', price: '40', unit: 'kg', aliases: 'aata, atta' }

test('products can be created, edited and deleted through the store', () => {
  const store = makeStore()
  const created = store.addProduct(sugarInput)
  assert.equal(created.ok, true)
  assert.equal(store.getState().products.length, 1)

  const id = created.product!.id
  const edited = store.editProduct(id, { ...sugarInput, price: '48' })
  assert.equal(edited.ok, true)
  assert.equal(store.getState().products[0].price, 48)

  store.deleteProduct(id)
  assert.equal(store.getState().products.length, 0)
})

test('invalid products are rejected with field errors', () => {
  const store = makeStore()
  const result = store.addProduct({ name: '', price: '0', unit: 'kg', aliases: '' })
  assert.equal(result.ok, false)
  assert.ok(result.errors?.name)
  assert.ok(result.errors?.price)
  assert.equal(store.getState().products.length, 0)
})

test('voice items are matched, priced and merged into the draft', () => {
  const store = makeStore()
  store.addProduct(sugarInput)
  store.addProduct(flourInput)

  const result = store.addParsedItems(parseUtterance('3 kilo chini aur 2 kilo aata'))
  assert.equal(result.added.length, 2)
  assert.equal(store.getState().draft.items.length, 2)
  assert.equal(store.readiness().subtotal, 3 * 45 + 2 * 40)
  assert.equal(store.readiness().ok, true)

  const again = store.addParsedItems(parseUtterance('2 kilo chini'))
  assert.equal(again.merged, 1)
  const sugar = store.getState().draft.items.find((item) => item.name === 'Sugar')
  assert.equal(sugar?.quantity, 5)
})

test('an unknown product stays unmatched and blocks the bill', () => {
  const store = makeStore()
  store.addProduct(sugarInput)
  const result = store.addParsedItems(parseUtterance('2 kilo sabun'))
  assert.equal(result.added[0].status, 'unmatched')
  assert.equal(store.readiness().ok, false)
  const finalise = store.finalize()
  assert.equal(finalise.ok, false)
  assert.ok(finalise.issues.some((issue) => issue.code === 'unmatched'))
})

test('choosing a product fixes an unmatched line and prices it', () => {
  const store = makeStore()
  const product = store.addProduct(sugarInput).product!
  store.addParsedItems(parseUtterance('2 kilo sabun'))
  const item = store.getState().draft.items[0]
  store.resolveItem(item.id, product.id)
  const resolved = store.getState().draft.items[0]
  assert.equal(resolved.productId, product.id)
  assert.equal(resolved.unitPrice, 45)
  assert.equal(resolved.status, 'ready')
  assert.equal(store.readiness().ok, true)
})

test('prices can be corrected and a discount applied', () => {
  const store = makeStore()
  store.addProduct(sugarInput)
  store.addParsedItems(parseUtterance('2 kilo chini'))
  const item = store.getState().draft.items[0]
  store.setItemPrice(item.id, 50)
  assert.equal(store.readiness().subtotal, 100)
  store.setDiscount('percent', 10)
  assert.equal(store.readiness().discount, 10)
  assert.equal(store.readiness().total, 90)
  store.setDiscount('amount', 25)
  assert.equal(store.readiness().total, 75)
})

test('finalising saves a bill, clears the draft and keeps history', () => {
  const store = makeStore()
  store.addProduct(sugarInput)
  store.addParsedItems(parseUtterance('3 kilo chini'))
  const result = store.finalize()
  assert.equal(result.ok, true)
  assert.ok(result.bill)
  assert.equal(result.bill!.total, 135)
  assert.match(result.bill!.number, /^VB-\d{8}-001$/)
  assert.equal(store.getState().draft.items.length, 0)
  assert.equal(store.getState().bills.length, 1)
  assert.equal(store.getBill(result.bill!.id)?.number, result.bill!.number)
})

test('the draft and bills survive a page reload', () => {
  const storage = new MemoryStorage()
  const store = makeStore(storage)
  store.addProduct(sugarInput)
  store.addParsedItems(parseUtterance('1 kilo chini'))
  store.finalize()
  store.addParsedItems(parseUtterance('2 kilo chini'))

  const reloaded = makeStore(storage)
  assert.equal(reloaded.getState().bills.length, 1)
  assert.equal(reloaded.getState().products.length, 1)
  assert.equal(reloaded.getState().draft.items.length, 1)
  assert.equal(reloaded.getState().draft.items[0].quantity, 2)
})

test('editing a product updates open bill lines unless the price was overridden', () => {
  const store = makeStore()
  const product = store.addProduct(sugarInput).product!
  store.addProduct(flourInput)
  store.addParsedItems(parseUtterance('1 kilo chini aur 1 kilo aata'))
  const sugarLine = store.getState().draft.items.find((item) => item.productId === product.id)!
  store.setItemPrice(sugarLine.id, 42)
  store.editProduct(product.id, { ...sugarInput, price: '50' })
  const after = store.getState().draft.items.find((item) => item.id === sugarLine.id)
  assert.equal(after?.unitPrice, 42, 'hand-edited price is preserved')
  store.deleteProduct(product.id)
  const unmatched = store.getState().draft.items.find((item) => item.id === sugarLine.id)
  assert.equal(unmatched?.status, 'unmatched')
  assert.equal(unmatched?.productId, null)
})

test('settings and sample products are handled explicitly', () => {
  const store = makeStore()
  store.updateSettings({ shopName: 'Sharma Kirana', receiptWidth: '58', language: 'en-IN' })
  assert.equal(store.getState().settings.shopName, 'Sharma Kirana')
  assert.equal(store.getState().settings.receiptWidth, '58')

  const added = store.addSampleProducts()
  assert.ok(added >= 6)
  assert.equal(store.addSampleProducts(), 0, 'samples are never duplicated')
  const removed = store.removeSampleProducts()
  assert.equal(removed, added)
  assert.equal(store.getState().products.length, 0)
})

test('backup export and restore round-trips through the store', () => {
  const store = makeStore()
  store.addProduct(sugarInput)
  store.addParsedItems(parseUtterance('2 kilo chini'))
  store.finalize()
  const backup = store.exportBackup()

  const other = makeStore()
  const result = other.importBackup(backup)
  assert.equal(result.ok, true)
  assert.equal(other.getState().products.length, 1)
  assert.equal(other.getState().bills.length, 1)
  assert.equal(other.importBackup('{"app":"nope"}').ok, false)
})

test('erasing everything leaves a clean but onboarded app', () => {
  const store = makeStore()
  store.addProduct(sugarInput)
  store.addParsedItems(parseUtterance('2 kilo chini'))
  store.finalize()
  store.clearEverything()
  assert.deepEqual(store.getState().products, [])
  assert.deepEqual(store.getState().bills, [])
  assert.equal(store.getState().draft.items.length, 0)
  assert.equal(store.getState().meta.onboarded, true)
})

test('storage problems are surfaced to the interface', () => {
  const store = makeStore()
  assert.equal(store.storageWarning(), null)
  const failing = createStore({
    storage: {
      getItem: () => null,
      setItem: () => {
        throw new Error('nope')
      },
      removeItem: () => undefined,
    },
    now: () => 1,
    id: () => 'x',
  })
  assert.match(failing.storageWarning() ?? '', /not saving|temporary/i)
})
