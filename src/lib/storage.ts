/**
 * Local persistence.
 *
 * VoiceBill has no backend: the shopkeeper's catalogue, bills and settings live
 * in localStorage on this device. Every read is sanitised so a corrupted or
 * hand-edited value can never crash the app or corrupt a bill.
 */
import type { AppData, AppMeta, Bill, BillItem, Draft, DraftItem, DraftItemStatus, Product, Settings } from './types.ts'
import { isUnit, UNIT_INFO } from './units.ts'
import { round2 } from './money.ts'

export const SCHEMA_VERSION = 1

export const STORAGE_KEYS = {
  products: 'voicebill.products.v1',
  bills: 'voicebill.bills.v1',
  settings: 'voicebill.settings.v1',
  draft: 'voicebill.draft.v1',
  meta: 'voicebill.meta.v1',
} as const

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** In-memory storage for tests, private mode fallbacks and previews. */
export class MemoryStorage implements StorageLike {
  private data = new Map<string, string>()

  getItem(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) as string) : null
  }

  setItem(key: string, value: string): void {
    this.data.set(key, String(value))
  }

  removeItem(key: string): void {
    this.data.delete(key)
  }

  clear(): void {
    this.data.clear()
  }

  get size(): number {
    return this.data.size
  }
}

export const DEFAULT_SETTINGS: Settings = {
  shopName: '',
  address: '',
  phone: '',
  currency: '₹',
  receiptWidth: '80',
  language: 'hi-IN',
  thankYou: 'Thank you for shopping with us!',
}

export function createEmptyDraft(now: number, id: string): Draft {
  return { id, items: [], discountType: 'amount', discountValue: 0, updatedAt: now }
}

export function createDefaultMeta(now: number): AppMeta {
  return { onboarded: false, createdAt: now, version: SCHEMA_VERSION }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const finiteNumber = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const cleanString = (value: unknown, fallback = '', maxLength = 2000): string => {
  if (typeof value !== 'string') return fallback
  return value.trim().slice(0, maxLength)
}

const isReceiptWidth = (value: unknown): value is Settings['receiptWidth'] =>
  value === '58' || value === '80' || value === 'a4'

const DRAFT_STATUSES: readonly DraftItemStatus[] = ['ready', 'unmatched', 'missing-price', 'unit-mismatch']

/* ------------------------------------------------------------------ */
/* Sanitisers                                                          */
/* ------------------------------------------------------------------ */

export function sanitizeProduct(raw: unknown): Product | null {
  if (!isObject(raw)) return null
  const id = cleanString(raw.id, '', 80)
  const name = cleanString(raw.name, '', 60)
  const unit = String(raw.unit ?? '')
  const price = finiteNumber(raw.price, Number.NaN)
  if (!id || !name || !isUnit(unit)) return null
  if (!Number.isFinite(price) || price < 0) return null
  const aliases = Array.isArray(raw.aliases)
    ? raw.aliases
        .filter((alias): alias is string => typeof alias === 'string')
        .map((alias) => alias.trim().slice(0, 40))
        .filter(Boolean)
        .slice(0, 20)
    : []
  const createdAt = finiteNumber(raw.createdAt, Date.now())
  return {
    id,
    name,
    price: round2(price),
    unit,
    aliases,
    createdAt,
    updatedAt: finiteNumber(raw.updatedAt, createdAt),
    sample: raw.sample === true ? true : undefined,
  }
}

export function sanitizeBillItem(raw: unknown): BillItem | null {
  if (!isObject(raw)) return null
  const name = cleanString(raw.name, '', 60)
  const unit = String(raw.unit ?? '')
  const quantity = finiteNumber(raw.quantity, Number.NaN)
  const unitPrice = finiteNumber(raw.unitPrice, Number.NaN)
  const lineTotal = finiteNumber(raw.lineTotal, Number.NaN)
  if (!name || !isUnit(unit)) return null
  if (!Number.isFinite(quantity) || quantity <= 0) return null
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return null
  if (!Number.isFinite(lineTotal) || lineTotal < 0) return null
  return {
    productId: cleanString(raw.productId, '', 80),
    name,
    unit,
    quantity,
    unitPrice: round2(unitPrice),
    lineTotal: round2(lineTotal),
  }
}

export function sanitizeBill(raw: unknown): Bill | null {
  if (!isObject(raw)) return null
  const id = cleanString(raw.id, '', 80)
  const number = cleanString(raw.number, '', 40)
  const createdAt = finiteNumber(raw.createdAt, Number.NaN)
  const items = Array.isArray(raw.items) ? raw.items.map(sanitizeBillItem).filter((item): item is BillItem => !!item) : []
  if (!id || !number || !Number.isFinite(createdAt) || items.length === 0) return null
  const subtotal = finiteNumber(raw.subtotal, Number.NaN)
  const discount = finiteNumber(raw.discount, 0)
  const total = finiteNumber(raw.total, Number.NaN)
  if (!Number.isFinite(subtotal) || !Number.isFinite(total) || subtotal < 0 || total < 0) return null
  return {
    id,
    number,
    createdAt,
    items,
    subtotal: round2(subtotal),
    discount: round2(Math.max(0, discount)),
    discountType: raw.discountType === 'percent' ? 'percent' : 'amount',
    discountValue: round2(Math.max(0, finiteNumber(raw.discountValue, 0))),
    total: round2(total),
  }
}

export function sanitizeDraftItem(raw: unknown): DraftItem | null {
  if (!isObject(raw)) return null
  const id = cleanString(raw.id, '', 80)
  const name = cleanString(raw.name, '', 80)
  const unit = String(raw.unit ?? '')
  const quantity = finiteNumber(raw.quantity, Number.NaN)
  if (!id || !name || !isUnit(unit)) return null
  if (!Number.isFinite(quantity) || quantity <= 0) return null
  const status = DRAFT_STATUSES.includes(raw.status as DraftItemStatus) ? (raw.status as DraftItemStatus) : 'ready'
  return {
    id,
    productId: typeof raw.productId === 'string' && raw.productId ? raw.productId : null,
    name,
    unit,
    quantity,
    unitPrice: round2(Math.max(0, finiteNumber(raw.unitPrice, 0))),
    priceOverride: raw.priceOverride === true,
    source: raw.source === 'manual' ? 'manual' : 'voice',
    status,
    confidence: Math.min(1, Math.max(0, finiteNumber(raw.confidence, 0))),
    rawText: typeof raw.rawText === 'string' ? raw.rawText.slice(0, 300) : undefined,
    candidates: Array.isArray(raw.candidates)
      ? raw.candidates.filter((id): id is string => typeof id === 'string').slice(0, 6)
      : undefined,
    warnings: Array.isArray(raw.warnings)
      ? raw.warnings.filter((warning): warning is string => typeof warning === 'string').slice(0, 6)
      : undefined,
  }
}

export function sanitizeDraft(raw: unknown, fallback: Draft): Draft {
  if (!isObject(raw)) return fallback
  const items = Array.isArray(raw.items)
    ? raw.items.map(sanitizeDraftItem).filter((item): item is DraftItem => !!item)
    : []
  const discountType = raw.discountType === 'percent' ? 'percent' : 'amount'
  const discountValue = Math.max(0, finiteNumber(raw.discountValue, 0))
  return {
    id: cleanString(raw.id, fallback.id, 80),
    items,
    discountType,
    discountValue: discountType === 'percent' ? Math.min(100, discountValue) : round2(discountValue),
    updatedAt: finiteNumber(raw.updatedAt, fallback.updatedAt),
  }
}

export function sanitizeSettings(raw: unknown): Settings {
  if (!isObject(raw)) return { ...DEFAULT_SETTINGS }
  const currency = cleanString(raw.currency, DEFAULT_SETTINGS.currency, 4) || DEFAULT_SETTINGS.currency
  return {
    shopName: cleanString(raw.shopName, '', 60),
    address: cleanString(raw.address, '', 160),
    phone: cleanString(raw.phone, '', 20),
    currency,
    receiptWidth: isReceiptWidth(raw.receiptWidth) ? raw.receiptWidth : DEFAULT_SETTINGS.receiptWidth,
    language: raw.language === 'en-IN' ? 'en-IN' : 'hi-IN',
    thankYou: cleanString(raw.thankYou, DEFAULT_SETTINGS.thankYou, 120) || DEFAULT_SETTINGS.thankYou,
  }
}

export function sanitizeMeta(raw: unknown, now: number): AppMeta {
  if (!isObject(raw)) return createDefaultMeta(now)
  return {
    onboarded: raw.onboarded === true,
    createdAt: finiteNumber(raw.createdAt, now),
    version: Math.max(0, Math.floor(finiteNumber(raw.version, SCHEMA_VERSION))),
  }
}

/* ------------------------------------------------------------------ */
/* Read / write                                                        */
/* ------------------------------------------------------------------ */

function readKey(storage: StorageLike, key: string, problems: string[]): unknown {
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    problems.push(`Saved data in "${key}" could not be read.`)
    return null
  }
}

export interface LoadResult {
  data: AppData
  /** Human-readable notes about anything that had to be reset or dropped. */
  problems: string[]
}

/** Load everything, falling back to safe defaults on any corruption. */
export function loadData(storage: StorageLike, now: number, id: () => string): LoadResult {
  const problems: string[] = []
  const meta = sanitizeMeta(readKey(storage, STORAGE_KEYS.meta, problems), now)

  const rawProducts = readKey(storage, STORAGE_KEYS.products, problems)
  const products: Product[] = Array.isArray(rawProducts)
    ? rawProducts.map(sanitizeProduct).filter((product): product is Product => !!product)
    : []
  if (Array.isArray(rawProducts) && products.length !== rawProducts.length) {
    problems.push('Some saved products were invalid and have been skipped.')
  }

  const rawBills = readKey(storage, STORAGE_KEYS.bills, problems)
  const bills: Bill[] = Array.isArray(rawBills)
    ? rawBills.map(sanitizeBill).filter((bill): bill is Bill => !!bill)
    : []
  if (Array.isArray(rawBills) && bills.length !== rawBills.length) {
    problems.push('Some saved bills were invalid and have been skipped.')
  }

  const settings = sanitizeSettings(readKey(storage, STORAGE_KEYS.settings, problems))
  const draft = sanitizeDraft(readKey(storage, STORAGE_KEYS.draft, problems), createEmptyDraft(now, id()))

  return {
    data: { products, bills, settings, draft, meta },
    problems,
  }
}

/** Persist one slice. Returns false when storage is unavailable or full. */
export function writeKey(storage: StorageLike, key: string, value: unknown): boolean {
  try {
    storage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function saveProducts(storage: StorageLike, products: readonly Product[]): boolean {
  return writeKey(storage, STORAGE_KEYS.products, products)
}

export function saveBills(storage: StorageLike, bills: readonly Bill[]): boolean {
  return writeKey(storage, STORAGE_KEYS.bills, bills)
}

export function saveSettings(storage: StorageLike, settings: Settings): boolean {
  return writeKey(storage, STORAGE_KEYS.settings, settings)
}

export function saveDraft(storage: StorageLike, draft: Draft): boolean {
  return writeKey(storage, STORAGE_KEYS.draft, draft)
}

export function saveMeta(storage: StorageLike, meta: AppMeta): boolean {
  return writeKey(storage, STORAGE_KEYS.meta, meta)
}

export function saveAll(storage: StorageLike, data: AppData): boolean {
  return (
    saveProducts(storage, data.products) &&
    saveBills(storage, data.bills) &&
    saveSettings(storage, data.settings) &&
    saveDraft(storage, data.draft) &&
    saveMeta(storage, data.meta)
  )
}

/** True when localStorage actually works (it throws in some private modes). */
export function storageAvailable(storage: StorageLike | null | undefined): storage is StorageLike {
  if (!storage) return false
  try {
    const probe = '__voicebill_probe__'
    storage.setItem(probe, '1')
    storage.removeItem(probe)
    return true
  } catch {
    return false
  }
}

export function clearAll(storage: StorageLike): void {
  for (const key of Object.values(STORAGE_KEYS)) {
    try {
      storage.removeItem(key)
    } catch {
      // Nothing useful to do — the caller reports the failure.
    }
  }
}

/* ------------------------------------------------------------------ */
/* Backup                                                              */
/* ------------------------------------------------------------------ */

export interface BackupFile extends AppData {
  app: 'voicebill'
  version: number
  exportedAt: string
}

export function exportData(data: AppData): string {
  const backup: BackupFile = {
    app: 'voicebill',
    version: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    ...data,
  }
  return JSON.stringify(backup, null, 2)
}

export type ImportResult = { ok: true; data: AppData; problems: string[] } | { ok: false; error: string }

/** Validate and normalise a backup file before anything is replaced. */
export function importData(json: string, now: number, id: () => string): ImportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' }
  }
  if (!isObject(parsed)) return { ok: false, error: 'That file does not look like a VoiceBill backup.' }
  if (parsed.app !== 'voicebill') return { ok: false, error: 'That file was not exported from VoiceBill.' }
  if (!Array.isArray(parsed.products) || !Array.isArray(parsed.bills)) {
    return { ok: false, error: 'The backup is missing its products or bills.' }
  }

  const problems: string[] = []
  const products = parsed.products.map(sanitizeProduct).filter((product): product is Product => !!product)
  const bills = parsed.bills.map(sanitizeBill).filter((bill): bill is Bill => !!bill)
  if (products.length !== parsed.products.length) problems.push('Some products in the backup were invalid.')
  if (bills.length !== parsed.bills.length) problems.push('Some bills in the backup were invalid.')

  const data: AppData = {
    products,
    bills,
    settings: sanitizeSettings(parsed.settings),
    draft: sanitizeDraft(parsed.draft, createEmptyDraft(now, id())),
    meta: { ...sanitizeMeta(parsed.meta, now), onboarded: true },
  }
  return { ok: true, data, problems }
}

/** Rough size of everything VoiceBill stores, for the settings screen. */
export function storageFootprint(storage: StorageLike): number {
  let bytes = 0
  for (const key of Object.values(STORAGE_KEYS)) {
    try {
      const value = storage.getItem(key)
      if (value) bytes += key.length + value.length
    } catch {
      // ignore
    }
  }
  return bytes
}

/** Human summary of the units in use, used by the products screen. */
export function unitSummary(products: readonly Product[]): { unit: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const product of products) {
    const label = UNIT_INFO[product.unit].name
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts.entries()].map(([unit, count]) => ({ unit, count }))
}
