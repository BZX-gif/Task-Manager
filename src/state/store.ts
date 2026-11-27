/**
 * Application state.
 *
 * A tiny observable store keeps the app free of a state library. Every change
 * goes through an action that (a) updates state immutably, (b) writes the
 * affected slice to storage, and (c) notifies subscribers. React reads it with
 * useSyncExternalStore.
 */
import type {
  AppMeta,
  Bill,
  Draft,
  DraftItem,
  Language,
  ParsedItem,
  Product,
  Settings,
  Unit,
} from '../lib/types.ts'
import { createId } from '../lib/id.ts'
import {
  createEmptyDraft,
  createDefaultMeta,
  exportData,
  importData,
  loadData,
  saveAll,
  saveBills,
  saveDraft,
  saveMeta,
  saveProducts,
  saveSettings,
  storageAvailable,
  MemoryStorage,
  clearAll,
  type LoadResult,
  type StorageLike,
} from '../lib/storage.ts'
import {
  addProduct as addProductToList,
  updateProduct as updateProductInList,
  removeProduct as removeProductFromList,
  buildSampleProducts,
  validateProduct,
  type ProductErrors,
  type ProductInput,
} from '../lib/catalog.ts'
import {
  draftItemFromParsed,
  draftItemFromProduct,
  draftReadiness,
  finalizeBill,
  mergeDraftItem,
  type DraftIssue,
  type DraftReadiness,
} from '../lib/billing.ts'
import { round2 } from '../lib/money.ts'
import { matchProduct } from '../lib/matcher.ts'
import { convertQuantity, isUnit } from '../lib/units.ts'

export type StorageMode = 'ok' | 'memory' | 'error'

export interface StoreState {
  products: Product[]
  bills: Bill[]
  settings: Settings
  draft: Draft
  meta: AppMeta
  ready: boolean
  storageMode: StorageMode
  lastSavedAt: number | null
  /** Problems found while loading saved data (e.g. corrupted values). */
  loadProblems: string[]
}

export interface StoreDeps {
  storage?: StorageLike | null
  language?: Language
  now?: () => number
  id?: (prefix?: string) => string
}

export interface AddVoiceResult {
  added: DraftItem[]
  merged: number
  unmatched: string[]
  issues: string[]
}

export interface ActionResult {
  ok: boolean
  errors?: ProductErrors
  product?: Product
  message?: string
}

export interface FinalizeOutcome {
  ok: boolean
  bill?: Bill
  issues: DraftIssue[]
}

export type Listener = () => void

export interface AppStore {
  getState(): StoreState
  subscribe(listener: Listener): () => void
  /* catalogue */
  addProduct(input: ProductInput): ActionResult
  editProduct(id: string, input: ProductInput): ActionResult
  deleteProduct(id: string): void
  addSampleProducts(): number
  removeSampleProducts(): number
  validate(input: ProductInput, ignoreId?: string): ReturnType<typeof validateProduct>
  /* draft */
  addParsedItems(items: ParsedItem[]): AddVoiceResult
  addProductToDraft(productId: string, quantity?: number): boolean
  setItemQuantity(itemId: string, quantity: number): void
  setItemPrice(itemId: string, price: number): void
  setItemUnit(itemId: string, unit: Unit): void
  resolveItem(itemId: string, productId: string): void
  removeItem(itemId: string): void
  clearDraft(): void
  setDiscount(type: 'amount' | 'percent', value: number): void
  readiness(): DraftReadiness
  /* bills */
  finalize(): FinalizeOutcome
  getBill(billId: string): Bill | undefined
  deleteBill(billId: string): void
  /* settings & data */
  updateSettings(patch: Partial<Settings>): void
  markOnboarded(): void
  exportBackup(): string
  importBackup(json: string): { ok: boolean; message: string }
  clearEverything(): void
  storageWarning(): string | null
}

function clampQuantity(quantity: number): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return 1
  return Math.round(Math.min(9999, quantity) * 1000) / 1000
}

/** Re-derive a line's attention state after an edit. */
function statusFor(item: DraftItem, product: Product | undefined): DraftItem['status'] {
  if (!product) return 'unmatched'
  if (item.unit !== product.unit) return 'unit-mismatch'
  if (!(item.unitPrice > 0)) return 'missing-price'
  return 'ready'
}

export function createStore(deps: StoreDeps = {}): AppStore {
  const now = deps.now ?? (() => Date.now())
  const nextId = deps.id ?? ((prefix?: string) => createId(prefix))
  const fallbackStorage = new MemoryStorage()
  const usable = storageAvailable(deps.storage)
  const storage: StorageLike = usable ? (deps.storage as StorageLike) : fallbackStorage
  const storageMode: StorageMode = usable ? 'ok' : deps.storage ? 'error' : 'memory'

  let loadResult: LoadResult = loadData(storage, now(), () => nextId('draft'))
  if (!usable && deps.language && !loadResult.data.settings.shopName) {
    loadResult = {
      ...loadResult,
      data: { ...loadResult.data, settings: { ...loadResult.data.settings, language: deps.language } },
    }
  }

  let state: StoreState = {
    ...loadResult.data,
    ready: true,
    storageMode,
    lastSavedAt: usable ? null : null,
    loadProblems: loadResult.problems,
  }

  const listeners = new Set<Listener>()

  const notify = () => {
    for (const listener of listeners) listener()
  }

  const commit = (patch: Partial<StoreState>, persist?: () => boolean) => {
    const saved = persist ? persist() : true
    state = {
      ...state,
      ...patch,
      lastSavedAt: saved ? now() : state.lastSavedAt,
      storageMode: saved ? state.storageMode : 'error',
    }
    notify()
  }

  const persistProducts = (products: Product[]) => saveProducts(storage, products)
  const persistBills = (bills: Bill[]) => saveBills(storage, bills)
  const persistSettings = (settings: Settings) => saveSettings(storage, settings)
  const persistDraft = (draft: Draft) => saveDraft(storage, draft)
  const persistMeta = (meta: AppMeta) => saveMeta(storage, meta)

  const updateDraft = (mutate: (draft: Draft) => Draft) => {
    const next = { ...mutate(state.draft), updatedAt: now() }
    commit({ draft: next }, () => persistDraft(next))
    return next
  }

  const productById = (id: string | null): Product | undefined =>
    id ? state.products.find((product) => product.id === id) : undefined

  const store: AppStore = {
    getState: () => state,

    subscribe(listener: Listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    /* ---------------- catalogue ---------------- */

    validate(input, ignoreId) {
      return validateProduct(input, state.products, { ignoreId })
    },

    addProduct(input) {
      const result = addProductToList(state.products, input, { id: nextId('prod'), now: now() })
      if (!result.ok || !result.product) return { ok: false, errors: result.errors }
      commit({ products: result.products }, () => persistProducts(result.products))
      return { ok: true, product: result.product }
    },

    editProduct(id, input) {
      const result = updateProductInList(state.products, id, input, { now: now() })
      if (!result.ok || !result.product) return { ok: false, errors: result.errors }
      const updated = result.product
      // Keep the open bill honest: unpaid lines follow the new price unless the
      // shopkeeper typed a price by hand for that line.
      const draftItems = state.draft.items.map((item) => {
        if (item.productId !== updated.id) return item
        const unitPrice = item.priceOverride ? item.unitPrice : updated.price
        let { unit, quantity } = item
        if (unit !== updated.unit) {
          // A product moved from kg to gram keeps the physical quantity correct.
          const converted = convertQuantity(quantity, unit, updated.unit)
          if (converted !== null) {
            quantity = Math.round(converted * 1000) / 1000
            unit = updated.unit
          }
        }
        const next: DraftItem = { ...item, name: updated.name, unit, quantity, unitPrice }
        return { ...next, status: statusFor(next, updated) }
      })
      const draft = { ...state.draft, items: draftItems, updatedAt: now() }
      commit({ products: result.products, draft }, () => persistProducts(result.products) && persistDraft(draft))
      return { ok: true, product: updated }
    },

    deleteProduct(id) {
      const products = removeProductFromList(state.products, id)
      const draftItems = state.draft.items.map((item) =>
        item.productId === id
          ? { ...item, productId: null, status: 'unmatched' as const, unitPrice: 0, priceOverride: false }
          : item,
      )
      const draft = { ...state.draft, items: draftItems, updatedAt: now() }
      commit({ products, draft }, () => persistProducts(products) && persistDraft(draft))
    },

    addSampleProducts() {
      const existingNames = new Set(state.products.map((product) => product.name.toLowerCase()))
      const samples = buildSampleProducts({ now: now(), nextId: () => nextId('prod') }).filter(
        (product) => !existingNames.has(product.name.toLowerCase()),
      )
      if (samples.length === 0) return 0
      const products = [...state.products, ...samples]
      commit({ products }, () => persistProducts(products))
      return samples.length
    },

    removeSampleProducts() {
      const kept = state.products.filter((product) => !product.sample)
      const removed = state.products.length - kept.length
      if (removed === 0) return 0
      const keptIds = new Set(kept.map((product) => product.id))
      const draftItems = state.draft.items.map((item) =>
        item.productId && !keptIds.has(item.productId)
          ? { ...item, productId: null, status: 'unmatched' as const, unitPrice: 0, priceOverride: false }
          : item,
      )
      const draft = { ...state.draft, items: draftItems, updatedAt: now() }
      commit({ products: kept, draft }, () => persistProducts(kept) && persistDraft(draft))
      return removed
    },

    /* ---------------- draft ---------------- */

    addParsedItems(items) {
      let draft = state.draft
      const added: DraftItem[] = []
      let merged = 0
      for (const parsed of items) {
        const item = draftItemFromParsed(parsed, state.products, nextId('item'))
        const outcome = mergeDraftItem(draft.items, item)
        if (outcome.merged) merged += 1
        else added.push(item)
        draft = { ...draft, items: outcome.items }
      }
      const unmatched = draft.items.filter((item) => item.status === 'unmatched').map((item) => item.name)
      if (items.length > 0) {
        draft = { ...draft, updatedAt: now() }
        commit({ draft }, () => persistDraft(draft))
      }
      return { added, merged, unmatched, issues: [] }
    },

    addProductToDraft(productId, quantity = 1) {
      const product = productById(productId)
      if (!product) return false
      const item = draftItemFromProduct(product, clampQuantity(quantity), { id: nextId('item'), source: 'manual' })
      const outcome = mergeDraftItem(state.draft.items, item)
      updateDraft((draft) => ({ ...draft, items: outcome.items }))
      return true
    },

    setItemQuantity(itemId, quantity) {
      updateDraft((draft) => ({
        ...draft,
        items: draft.items.map((item) =>
          item.id === itemId ? { ...item, quantity: clampQuantity(quantity) } : item,
        ),
      }))
    },

    setItemPrice(itemId, price) {
      updateDraft((draft) => ({
        ...draft,
        items: draft.items.map((item) => {
          if (item.id !== itemId) return item
          const unitPrice = Number.isFinite(price) && price > 0 ? round2(price) : 0
          const next: DraftItem = { ...item, unitPrice, priceOverride: true }
          return { ...next, status: statusFor(next, productById(next.productId)) }
        }),
      }))
    },

    setItemUnit(itemId, unit) {
      if (!isUnit(unit)) return
      updateDraft((draft) => ({
        ...draft,
        items: draft.items.map((item) => {
          if (item.id !== itemId) return item
          const product = productById(item.productId)
          return { ...item, unit, status: statusFor({ ...item, unit }, product) }
        }),
      }))
    },

    resolveItem(itemId, productId) {
      const product = productById(productId)
      if (!product) return
      updateDraft((draft) => ({
        ...draft,
        items: draft.items.map((item) => {
          if (item.id !== itemId) return item
          const unitMatches = item.unit === product.unit
          const next: DraftItem = {
            ...item,
            productId: product.id,
            name: product.name,
            unit: unitMatches ? item.unit : product.unit,
            unitPrice: product.price,
            priceOverride: false,
            confidence: 1,
            status: product.price <= 0 ? 'missing-price' : 'ready',
            candidates: [],
            warnings: [],
          }
          return next
        }),
      }))
    },

    removeItem(itemId) {
      updateDraft((draft) => ({ ...draft, items: draft.items.filter((item) => item.id !== itemId) }))
    },

    clearDraft() {
      updateDraft(() => createEmptyDraft(now(), nextId('draft')))
    },

    setDiscount(type, value) {
      updateDraft((draft) => ({
        ...draft,
        discountType: type,
        discountValue: Number.isFinite(value) ? Math.max(0, round2(value)) : 0,
      }))
    },

    readiness: () => draftReadiness(state.draft),

    /* ---------------- bills ---------------- */

    finalize() {
      const result = finalizeBill(state.draft, state.products, state.bills, now(), nextId('bill'))
      if (!result.ok) return { ok: false, issues: result.issues }
      const bills = [result.bill, ...state.bills]
      const draft = createEmptyDraft(now(), nextId('draft'))
      commit({ bills, draft }, () => persistBills(bills) && persistDraft(draft))
      return { ok: true, bill: result.bill, issues: [] }
    },

    getBill(billId) {
      return state.bills.find((bill) => bill.id === billId)
    },

    deleteBill(billId) {
      const bills = state.bills.filter((bill) => bill.id !== billId)
      commit({ bills }, () => persistBills(bills))
    },

    /* ---------------- settings & data ---------------- */

    updateSettings(patch) {
      const settings: Settings = {
        ...state.settings,
        ...patch,
        shopName: (patch.shopName ?? state.settings.shopName).slice(0, 60),
        address: (patch.address ?? state.settings.address).slice(0, 160),
        phone: (patch.phone ?? state.settings.phone).slice(0, 20),
        thankYou: (patch.thankYou ?? state.settings.thankYou).slice(0, 120),
      }
      commit({ settings }, () => persistSettings(settings))
    },

    markOnboarded() {
      const meta: AppMeta = { ...state.meta, onboarded: true }
      commit({ meta }, () => persistMeta(meta))
    },

    exportBackup() {
      return exportData({
        products: state.products,
        bills: state.bills,
        settings: state.settings,
        draft: state.draft,
        meta: state.meta,
      })
    },

    importBackup(json) {
      const result = importData(json, now(), () => nextId('draft'))
      if (!result.ok) return { ok: false, message: result.error }
      commit({ ...result.data }, () => saveAll(storage, result.data))
      const note = result.problems.length ? ` ${result.problems.join(' ')}` : ''
      return { ok: true, message: `Backup restored: ${result.data.products.length} products, ${result.data.bills.length} bills.${note}` }
    },

    clearEverything() {
      clearAll(storage)
      const settings: Settings = { ...state.settings, shopName: '', address: '', phone: '' }
      const draft = createEmptyDraft(now(), nextId('draft'))
      const meta = createDefaultMeta(now())
      commit(
        { products: [], bills: [], settings, draft, meta: { ...meta, onboarded: true }, lastSavedAt: now() },
        () => saveAll(storage, { products: [], bills: [], settings, draft, meta: { ...meta, onboarded: true } }),
      )
    },

    storageWarning() {
      if (state.storageMode === 'ok') return null
      if (state.storageMode === 'error') return 'This browser is not saving data. Bills will disappear when you close the tab.'
      return 'Storage is unavailable here, so this session is temporary. Export a backup before closing.'
    },
  }

  return store
}

export { matchProduct }
