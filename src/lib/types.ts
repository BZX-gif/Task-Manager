/**
 * Shared domain types for VoiceBill.
 *
 * Everything here is deliberately plain data so it can be persisted to
 * localStorage, exported as JSON, and unit-tested without a browser.
 */

/** The measurement units the shopkeeper can bill in. */
export type Unit = 'kg' | 'gram' | 'litre' | 'ml' | 'piece' | 'packet' | 'dozen'

export const UNITS: readonly Unit[] = ['kg', 'gram', 'litre', 'ml', 'piece', 'packet', 'dozen']

/** A product in the shopkeeper's own catalogue. */
export interface Product {
  id: string
  name: string
  /** Price per single `unit`, in rupees. */
  price: number
  unit: Unit
  /** Spoken names the shopkeeper uses for this product ("chini", "shakkar"). */
  aliases: string[]
  createdAt: number
  updatedAt: number
  /** True when the product came from the optional first-run sample set. */
  sample?: boolean
}

export type DiscountType = 'amount' | 'percent'

/** A frozen line on a saved bill. */
export interface BillItem {
  productId: string
  name: string
  unit: Unit
  quantity: number
  unitPrice: number
  lineTotal: number
}

/** A completed, saved bill. */
export interface Bill {
  id: string
  /** Human-readable number, e.g. VB-20261127-003. */
  number: string
  createdAt: number
  items: BillItem[]
  subtotal: number
  discount: number
  discountType: DiscountType
  discountValue: number
  total: number
}

export type ReceiptWidth = '58' | '80' | 'a4'
export type Language = 'hi-IN' | 'en-IN'

export interface Settings {
  shopName: string
  address: string
  phone: string
  /** Currency symbol used on screen and on receipts. */
  currency: string
  receiptWidth: ReceiptWidth
  language: Language
  thankYou: string
}

/** Why a draft line still needs the shopkeeper's attention. */
export type DraftItemStatus = 'ready' | 'unmatched' | 'missing-price' | 'unit-mismatch'

/** A line in the bill currently being built. */
export interface DraftItem {
  id: string
  productId: string | null
  name: string
  unit: Unit
  quantity: number
  /** Price per unit captured when the line was added (editable). */
  unitPrice: number
  /** True once the shopkeeper typed a price by hand. */
  priceOverride: boolean
  source: 'voice' | 'manual'
  status: DraftItemStatus
  /** Matching confidence, 0–1. 1 for manual picks. */
  confidence: number
  rawText?: string
  /** Product ids suggested when the line could not be matched. */
  candidates?: string[]
  /** Non-blocking things worth showing next to the line. */
  warnings?: string[]
}

export interface Draft {
  id: string
  items: DraftItem[]
  discountType: DiscountType
  discountValue: number
  updatedAt: number
}

export interface AppMeta {
  onboarded: boolean
  createdAt: number
  version: number
}

export interface AppData {
  products: Product[]
  bills: Bill[]
  settings: Settings
  draft: Draft
  meta: AppMeta
}

/** Result of matching a spoken name against the catalogue. */
export interface MatchCandidate {
  product: Product
  score: number
  matchedOn: string
}

export interface MatchResult {
  product: Product | null
  confidence: number
  candidates: MatchCandidate[]
  reason: 'exact' | 'alias' | 'fuzzy' | 'ambiguous' | 'none'
}

/** One product the shopkeeper was heard asking for. */
export interface ParsedItem {
  /** The exact words this line was extracted from. */
  raw: string
  /** Cleaned spoken product name, before catalogue matching. */
  name: string
  quantity: number | null
  unit: Unit | null
  /** False when no quantity was spoken (the line defaults to 1). */
  hasQuantity: boolean
  /** Warnings raised by the parser (e.g. an implausible quantity). */
  warnings: string[]
}
