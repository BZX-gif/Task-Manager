/**
 * Draft lines → a finished, validated bill.
 *
 * This module owns the safety rules: an unmatched product, a missing price or a
 * mismatched unit can sit in the draft, but never in a saved bill.
 */
import type {
  Bill,
  BillItem,
  Draft,
  DraftItem,
  DraftItemStatus,
  ParsedItem,
  Product,
} from './types.ts'
import { computeTotals, isValidDiscount, lineAmount, round2, sumAmounts, type Totals } from './money.ts'
import { convertQuantity } from './units.ts'
import { matchProduct } from './matcher.ts'
import { dayKey } from './format.ts'

export interface DraftIssue {
  itemId?: string
  code: 'empty' | 'unmatched' | 'missing-price' | 'unit-mismatch' | 'quantity' | 'discount'
  message: string
}

const roundQuantity = (value: number): number => Math.round(value * 1000) / 1000

/** Build a draft line from a catalogue product. */
export function draftItemFromProduct(
  product: Product,
  quantity: number,
  meta: { id: string; source: 'voice' | 'manual' },
): DraftItem {
  return {
    id: meta.id,
    productId: product.id,
    name: product.name,
    unit: product.unit,
    quantity: roundQuantity(quantity > 0 ? quantity : 1),
    unitPrice: product.price,
    priceOverride: false,
    source: meta.source,
    status: product.price > 0 ? 'ready' : 'missing-price',
    confidence: 1,
    warnings: [],
  }
}

/**
 * Build a draft line from a spoken item: match the name, convert compatible
 * units, and mark anything that needs the shopkeeper's eye.
 */
export function draftItemFromParsed(parsed: ParsedItem, products: readonly Product[], id: string): DraftItem {
  const match = matchProduct(parsed.name, products)
  const quantity = parsed.quantity ?? 1
  const warnings = [...parsed.warnings]

  if (!match.product) {
    return {
      id,
      productId: null,
      name: parsed.name,
      unit: parsed.unit ?? 'piece',
      quantity: roundQuantity(quantity > 0 ? quantity : 1),
      unitPrice: 0,
      priceOverride: false,
      source: 'voice',
      status: 'unmatched',
      confidence: match.confidence,
      rawText: parsed.raw,
      candidates: match.candidates.slice(0, 4).map((candidate) => candidate.product.id),
      warnings,
    }
  }

  const product = match.product
  let resolvedQuantity = quantity > 0 ? quantity : 1
  let unit = product.unit
  let status: DraftItemStatus = product.price > 0 ? 'ready' : 'missing-price'

  if (parsed.unit && parsed.unit !== product.unit) {
    const converted = convertQuantity(resolvedQuantity, parsed.unit, product.unit)
    if (converted === null) {
      // e.g. "2 kilo Maggi" when Maggi is sold per packet — never guess.
      status = 'unit-mismatch'
      unit = parsed.unit
      warnings.push(`Sold per ${product.unit}, but you said ${parsed.unit}`)
    } else {
      resolvedQuantity = converted
    }
  }

  return {
    id,
    productId: product.id,
    name: product.name,
    unit,
    quantity: roundQuantity(resolvedQuantity),
    unitPrice: product.price,
    priceOverride: false,
    source: 'voice',
    status,
    confidence: match.confidence,
    rawText: parsed.raw,
    warnings,
  }
}

export interface MergeOutcome {
  items: DraftItem[]
  merged: boolean
  mergedIntoId?: string
}

/**
 * Add a line to the draft. Speaking the same product twice updates the existing
 * line instead of creating a duplicate — this is what makes repeated speech
 * events harmless.
 */
export function mergeDraftItem(items: readonly DraftItem[], incoming: DraftItem): MergeOutcome {
  const existing = items.find((item) => {
    if (item.status === 'unmatched' || incoming.status === 'unmatched') {
      return (
        item.status === 'unmatched' &&
        incoming.status === 'unmatched' &&
        item.name.trim().toLowerCase() === incoming.name.trim().toLowerCase() &&
        item.unit === incoming.unit
      )
    }
    return (
      item.productId !== null &&
      item.productId === incoming.productId &&
      item.unit === incoming.unit &&
      item.unitPrice === incoming.unitPrice
    )
  })

  if (!existing) return { items: [...items, incoming], merged: false }

  const total = roundQuantity(existing.quantity + incoming.quantity)
  const mergedItems = items.map((item) => (item.id === existing.id ? { ...item, quantity: total } : item))
  return { items: mergedItems, merged: true, mergedIntoId: existing.id }
}

/** Totals for the current draft. */
export function draftTotals(draft: Draft): Totals {
  return computeTotals(draft.items, { type: draft.discountType, value: draft.discountValue })
}

/** Every reason the draft cannot become a bill yet. */
export function draftIssues(draft: Draft): DraftIssue[] {
  const issues: DraftIssue[] = []
  if (draft.items.length === 0) {
    issues.push({ code: 'empty', message: 'Add at least one item to make a bill' })
  }
  for (const item of draft.items) {
    if (!item.productId) {
      issues.push({
        itemId: item.id,
        code: 'unmatched',
        message: `Choose a product for "${item.name}"`,
      })
    }
    if (item.status === 'unit-mismatch') {
      issues.push({
        itemId: item.id,
        code: 'unit-mismatch',
        message: `${item.name} is not sold by ${item.unit} — check the unit`,
      })
    }
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      issues.push({ itemId: item.id, code: 'quantity', message: `Set a quantity for ${item.name}` })
    }
    if (!Number.isFinite(item.unitPrice) || item.unitPrice <= 0) {
      issues.push({ itemId: item.id, code: 'missing-price', message: `Set a price for ${item.name}` })
    }
  }
  if (!isValidDiscount({ type: draft.discountType, value: draft.discountValue })) {
    issues.push({ code: 'discount', message: 'The discount is not valid' })
  }
  if (issues.length === 0) {
    const totals = draftTotals(draft)
    if (!(totals.total > 0) || !Number.isFinite(totals.total)) {
      issues.push({ code: 'empty', message: 'The bill total must be more than zero' })
    }
  }
  return issues
}

export interface DraftReadiness extends Totals {
  ok: boolean
  issues: DraftIssue[]
  itemCount: number
}

/** Totals plus everything still blocking the bill. */
export function draftReadiness(draft: Draft): DraftReadiness {
  const totals = draftTotals(draft)
  const issues = draftIssues(draft)
  return { ...totals, ok: issues.length === 0, issues, itemCount: draft.items.length }
}

/** Next bill number for a day: VB-20261127-001. */
export function nextBillNumber(bills: readonly Bill[], now: number): string {
  const key = dayKey(now).replace(/-/g, '')
  let highest = 0
  for (const bill of bills) {
    const match = bill.number.match(/^VB-\d{8}-(\d+)$/)
    if (!match) continue
    if (!bill.number.startsWith(`VB-${key}-`)) continue
    highest = Math.max(highest, Number(match[1]))
  }
  return `VB-${key}-${String(highest + 1).padStart(3, '0')}`
}

export type FinalizeResult =
  | { ok: true; bill: Bill }
  | { ok: false; issues: DraftIssue[] }

/**
 * Validate and freeze the draft into a bill. The caller is responsible for
 * persisting it and clearing the draft.
 */
export function finalizeBill(
  draft: Draft,
  products: readonly Product[],
  bills: readonly Bill[],
  now: number,
  id: string,
): FinalizeResult {
  const issues = draftIssues(draft)
  if (issues.length > 0) return { ok: false, issues }

  const productById = new Map(products.map((product) => [product.id, product]))
  const items: BillItem[] = draft.items.map((item) => {
    const product = item.productId ? productById.get(item.productId) : undefined
    const unitPrice = round2(item.unitPrice)
    const quantity = Math.round(item.quantity * 1000) / 1000
    return {
      productId: item.productId as string,
      name: product?.name ?? item.name,
      unit: item.unit,
      quantity,
      unitPrice,
      lineTotal: lineAmount(quantity, unitPrice),
    }
  })

  const subtotal = sumAmounts(items.map((item) => item.lineTotal))
  const totals = computeTotals(items.map((item) => ({ quantity: item.quantity, unitPrice: item.unitPrice })), {
    type: draft.discountType,
    value: draft.discountValue,
  })

  const bill: Bill = {
    id,
    number: nextBillNumber(bills, now),
    createdAt: now,
    items,
    subtotal,
    discount: totals.discount,
    discountType: draft.discountType,
    discountValue: draft.discountValue,
    total: totals.total,
  }
  return { ok: true, bill }
}
