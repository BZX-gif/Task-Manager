/**
 * End-to-end UI tests: the real React app, a real store and real localStorage
 * semantics (in-memory), driven through clicks and typed input in jsdom.
 *
 * These cover the shopkeeper journey: setup → products → speak or pick items →
 * review → save → receipt → history.
 */
import '../helpers/dom.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ReactNode } from 'react'
import { createStore, type AppStore } from '../../src/state/store.ts'
import { MemoryStorage } from '../../src/lib/storage.ts'
import { parseUtterance } from '../../src/lib/parser.ts'

const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const { App } = await import('../../src/App.tsx')

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

let idCounter = 0
function makeStore(storage = new MemoryStorage()): AppStore {
  let now = Date.parse('2026-11-27T09:30:00')
  return createStore({
    storage,
    now: () => (now += 1000),
    id: (prefix) => `${prefix ?? 'id'}-${++idCounter}`,
  })
}

async function mount(store: AppStore) {
  window.location.hash = '#/'
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render((<App store={store} />) as ReactNode)
  })
  return {
    container,
    async cleanup() {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}

async function withApp(store: AppStore, run: (container: HTMLElement) => Promise<void>) {
  const mounted = await mount(store)
  try {
    await run(mounted.container)
  } finally {
    await mounted.cleanup()
  }
}

function button(container: ParentNode, text: RegExp): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((element) => text.test(element.textContent ?? ''))
  if (!found) throw new Error(`No button matching ${text}`)
  return found
}

function anyButton(container: ParentNode, text: RegExp): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((element) => text.test(element.textContent ?? ''))
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

async function fill(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const prototype =
    element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  await act(async () => {
    setter?.call(element, value)
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

async function go(hash: string) {
  await act(async () => {
    window.location.hash = hash
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
}

/* Torment the app with a fake speech engine. */
class FakeSpeech {
  static last: FakeSpeech | null = null
  lang = ''
  continuous = false
  interimResults = false
  maxAlternatives = 1
  onresult: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onend: (() => void) | null = null
  onstart: (() => void) | null = null
  starts = 0
  results: Array<{ isFinal: boolean; length: number; 0: { transcript: string; confidence: number } }> = []

  constructor() {
    FakeSpeech.last = this
  }

  start() {
    this.starts += 1
    this.results = []
    this.onstart?.()
  }

  stop() {
    this.onend?.()
  }

  abort() {
    this.onend?.()
  }

  /** A new final result, exactly like a real continuous session. */
  emit(transcript: string, isFinal = true) {
    this.results.push({ isFinal, length: 1, 0: { transcript, confidence: 0.95 } })
    this.deliver()
  }

  /** The browser firing the same last result again. */
  reemit() {
    this.deliver()
  }

  private deliver() {
    this.onresult?.({ resultIndex: this.results.length - 1, results: this.results })
  }

  fail(code: string) {
    this.onerror?.({ error: code })
  }
}

function installSpeech() {
  ;(window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeSpeech
}

function removeSpeech() {
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition
  FakeSpeech.last = null
}

const sugar = { name: 'Sugar', price: '45', unit: 'kg', aliases: 'chini, cheeni' }

/* ------------------------------------------------------------------ */
/* Setup & products                                                    */
/* ------------------------------------------------------------------ */

test('first run asks for the shop name, then opens the dashboard', async () => {
  const store = makeStore()
  await withApp(store, async (container) => {
    assert.match(container.textContent ?? '', /Speak\. Review\./)
    const name = container.querySelector<HTMLInputElement>('#onboard-shop')
    assert.ok(name)
    await fill(name!, 'Sharma Kirana Store')
    await submit(name!.closest('form') as HTMLFormElement)

    assert.equal(store.getState().meta.onboarded, true)
    assert.equal(store.getState().settings.shopName, 'Sharma Kirana Store')
    assert.ok(store.getState().products.length >= 6, 'samples are added when the box is ticked')
    assert.match(container.textContent ?? '', /Sharma Kirana Store/)
    assert.ok(container.querySelector('.bottom-nav'), 'mobile navigation exists')
    assert.ok(container.querySelector('.voice-hero'), 'dashboard voice action exists')
  })
})

test('a shopkeeper can add, edit and delete a product', async () => {
  const store = makeStore()
  store.updateSettings({ shopName: 'Test Shop' })
  store.markOnboarded()

  await withApp(store, async (container) => {
    await go('#/products')
    assert.match(container.textContent ?? '', /Products & prices/)

    await click(container.querySelector('.page-head-action') as Element)
    await fill(container.querySelector('#product-name') as HTMLInputElement, 'Ghee')
    await fill(container.querySelector('#product-price') as HTMLInputElement, '650')
    await fill(container.querySelector('#product-unit') as HTMLSelectElement, 'litre')
    await fill(container.querySelector('#product-aliases') as HTMLInputElement, 'ghee, desi ghee')
    await submit(container.querySelector('#product-form') as HTMLFormElement)

    assert.equal(store.getState().products.length, 1)
    assert.equal(store.getState().products[0].name, 'Ghee')
    assert.equal(store.getState().products[0].price, 650)
    assert.match(container.textContent ?? '', /Ghee/)

    await click(container.querySelector('button[aria-label="Edit Ghee"]') as Element)
    await fill(container.querySelector('#product-price') as HTMLInputElement, '675')
    await submit(container.querySelector('#product-form') as HTMLFormElement)
    assert.equal(store.getState().products[0].price, 675)

    await click(container.querySelector('button[aria-label="Delete Ghee"]') as Element)
    await click(container.querySelector('.dialog .btn-danger') as Element)
    assert.equal(store.getState().products.length, 0)
  })
})

test('invalid products are rejected with a visible message', async () => {
  const store = makeStore()
  store.markOnboarded()
  await withApp(store, async (container) => {
    await go('#/products')
    await click(container.querySelector('.page-head-action') as Element)
    await fill(container.querySelector('#product-name') as HTMLInputElement, 'Soap')
    await fill(container.querySelector('#product-price') as HTMLInputElement, '0')
    await submit(container.querySelector('#product-form') as HTMLFormElement)
    assert.equal(store.getState().products.length, 0)
    assert.ok(container.querySelector('.error-text'), 'price error is shown')
  })
})

/* ------------------------------------------------------------------ */
/* Billing                                                             */
/* ------------------------------------------------------------------ */

test('pick a product, review and save a bill, then find it in history', async () => {
  const store = makeStore()
  store.updateSettings({ shopName: 'Test Shop' })
  store.markOnboarded()
  store.addProduct(sugar)

  await withApp(store, async (container) => {
    await go('#/new')
    assert.match(container.textContent ?? '', /What is the customer buying\?/)

    await click(button(container, /Choose a product/))
    await click(container.querySelector('.picker-row') as Element)
    assert.match(container.textContent ?? '', /Sugar/)

    await click(button(container, /Review bill/))
    assert.match(container.textContent ?? '', /Review before saving/)
    await click(button(container, /Save bill/))

    assert.equal(store.getState().bills.length, 1)
    const bill = store.getState().bills[0]
    assert.equal(bill.total, 45)
    assert.match(window.location.hash, /^#\/bill\//)
    assert.match(container.textContent ?? '', new RegExp(bill.number))
    assert.match(container.textContent ?? '', /Sugar/)
    assert.match(container.textContent ?? '', /45\.00/)
    assert.equal(store.getState().draft.items.length, 0)

    await go('#/bills')
    assert.match(container.textContent ?? '', /Bill history/)
    assert.match(container.textContent ?? '', new RegExp(bill.number))
  })
})

test('a line can be switched to a different product', async () => {
  const store = makeStore()
  store.markOnboarded()
  store.addProduct(sugar)
  store.addProduct({ name: 'Rice', price: '55', unit: 'kg', aliases: 'chawal' })
  store.addParsedItems(parseUtterance('1 kilo chini'))

  await withApp(store, async (container) => {
    await go('#/new')
    assert.match(container.textContent ?? '', /Sugar/)
    await click(container.querySelector('button[aria-label="Change product for Sugar"]') as Element)
    const rows = Array.from(container.querySelectorAll('.picker-row'))
    const riceRow = rows.find((row) => /Rice/.test(row.textContent ?? ''))
    assert.ok(riceRow, 'the picker lists the other product')
    await click(riceRow!)
    const item = store.getState().draft.items[0]
    assert.equal(item.name, 'Rice')
    assert.equal(item.unitPrice, 55)
    assert.equal(store.readiness().total, 55)
  })
})

test('the draft is restored after a refresh', async () => {
  const storage = new MemoryStorage()
  const store = makeStore(storage)
  store.updateSettings({ shopName: 'Test Shop' })
  store.markOnboarded()
  store.addProduct(sugar)
  store.addParsedItems(parseUtterance('2 kilo chini'))

  const reloaded = makeStore(storage)
  assert.equal(reloaded.getState().draft.items.length, 1)

  await withApp(reloaded, async (container) => {
    await go('#/new')
    assert.match(container.textContent ?? '', /Sugar/)
    const qty = container.querySelector('.qty-input') as HTMLInputElement
    assert.equal(qty.value, '2')
  })
})

test('a discount changes the total on screen and on the bill', async () => {
  const store = makeStore()
  store.markOnboarded()
  store.updateSettings({ shopName: 'Test Shop' })
  store.addProduct(sugar)
  store.addParsedItems(parseUtterance('2 kilo chini'))

  await withApp(store, async (container) => {
    await go('#/new')
    const discount = container.querySelector('.discount-input') as HTMLInputElement
    await fill(discount, '10')
    const totals = container.querySelector('.total-final')?.textContent ?? ''
    assert.match(totals, /₹80/)

    await click(button(container, /Review bill/))
    await click(button(container, /Save bill/))
    assert.equal(store.getState().bills[0].discount, 10)
    assert.equal(store.getState().bills[0].total, 80)
  })
})

test('unmatched products block saving and offer a fix', async () => {
  const store = makeStore()
  store.markOnboarded()
  store.addProduct(sugar)
  store.addParsedItems(parseUtterance('2 kilo sabun'))

  await withApp(store, async (container) => {
    await go('#/new')
    assert.match(container.textContent ?? '', /Needs product/)
    await click(button(container, /Review bill/))
    assert.match(container.textContent ?? '', /Fix these before saving/)
    const save = anyButton(container, /Save bill/)
    assert.ok(save)
    assert.equal(save!.disabled, true)
    assert.equal(store.getState().bills.length, 0)
  })
})

/* ------------------------------------------------------------------ */
/* Voice                                                               */
/* ------------------------------------------------------------------ */

test('speaking adds items to the bill, and repeats are not duplicated', async () => {
  installSpeech()
  try {
    const store = makeStore()
    store.markOnboarded()
    store.addProduct(sugar)

    await withApp(store, async (container) => {
      await go('#/new')
      const mic = container.querySelector<HTMLButtonElement>('button[aria-label="Start voice input"]')
      assert.ok(mic, 'the mic is the primary control')
      await click(mic!)
      assert.ok(FakeSpeech.last, 'a recogniser was created')
      assert.match(container.textContent ?? '', /Listening/)

      await act(async () => {
        FakeSpeech.last!.emit('3 kilo chini')
      })

      assert.equal(store.getState().draft.items.length, 1)
      assert.equal(store.getState().draft.items[0].name, 'Sugar')
      assert.equal(store.getState().draft.items[0].quantity, 3)
      assert.match(container.textContent ?? '', /3 kilo chini/)
      assert.match(container.textContent ?? '', /₹135/)

      // The browser re-emits the same final result: no extra item, no extra qty.
      await act(async () => {
        FakeSpeech.last!.reemit()
      })
      assert.equal(store.getState().draft.items.length, 1)
      assert.equal(store.getState().draft.items[0].quantity, 3)
    })
  } finally {
    removeSpeech()
  }
})

test('a second utterance adds to the same bill', async () => {
  installSpeech()
  try {
    const store = makeStore()
    store.markOnboarded()
    store.addProduct(sugar)
    store.addProduct({ name: 'Rice', price: '55', unit: 'kg', aliases: 'chawal' })

    await withApp(store, async (container) => {
      await go('#/new')
      await click(container.querySelector('button[aria-label="Start voice input"]') as Element)
      await act(async () => {
        FakeSpeech.last!.emit('2 kilo chini')
      })
      await act(async () => {
        FakeSpeech.last!.emit('1 kilo chawal')
      })
      assert.equal(store.getState().draft.items.length, 2)
      assert.match(container.textContent ?? '', /Rice/)
    })
  } finally {
    removeSpeech()
  }
})

test('a denied microphone keeps the bill and points to manual entry', async () => {
  installSpeech()
  try {
    const store = makeStore()
    store.markOnboarded()
    store.addProduct(sugar)
    store.addParsedItems(parseUtterance('1 kilo chini'))

    await withApp(store, async (container) => {
      await go('#/new')
      await click(container.querySelector('button[aria-label="Start voice input"]') as Element)
      await act(async () => {
        FakeSpeech.last!.fail('not-allowed')
      })
      assert.match(container.textContent ?? '', /Microphone permission is blocked/i)
      assert.equal(store.getState().draft.items.length, 1, 'the draft is untouched')
      assert.ok(anyButton(container, /Add by hand/))
    })
  } finally {
    removeSpeech()
  }
})

test('browsers without speech support show a manual fallback', async () => {
  removeSpeech()
  const store = makeStore()
  store.markOnboarded()
  store.addProduct(sugar)

  await withApp(store, async (container) => {
    await go('#/new')
    assert.match(container.textContent ?? '', /Voice input isn’t available in this browser/)
    assert.ok(container.querySelector('.banner-warn'))
    assert.ok(container.querySelector('.mic-button.is-disabled'))
    assert.ok(anyButton(container, /Choose a product/), 'manual entry is still offered')
  })
})
