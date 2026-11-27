/**
 * Money maths for VoiceBill.
 *
 * Indian retail prices have paise, and floating point rupees drift when they
 * are added up. Every total is therefore accumulated in integer paise and only
 * converted back to rupees at the edge.
 */

/** Round to the nearest paisa, guarding against 0.1 + 0.2 style drift. */
export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** Rupees → integer paise. */
export function toPaise(rupees: number): number {
  if (!Number.isFinite(rupees)) return 0
  return Math.round(rupees * 100)
}

/** Integer paise → rupees. */
export function fromPaise(paise: number): number {
  return Math.round(paise) / 100
}

/** A single line's amount, rounded to paise. */
export function lineAmount(quantity: number, unitPrice: number): number {
  if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) return 0
  const q = Math.max(0, quantity)
  const p = Math.max(0, unitPrice)
  // Multiply in paise and round once: 1.5 kg × ₹45.33 = ₹67.995 → ₹68.00
  return fromPaise(Math.round(q * toPaise(p)))
}

/** Sum of line amounts, in rupees, rounded once at the end. */
export function sumAmounts(amounts: readonly number[]): number {
  return fromPaise(amounts.reduce((total, amount) => total + toPaise(amount), 0))
}

export interface DiscountInput {
  type: 'amount' | 'percent'
  value: number
}

/** The rupee value of a discount, clamped so it can never exceed the bill. */
export function resolveDiscount(subtotal: number, discount: DiscountInput): number {
  const base = Math.max(0, round2(subtotal))
  const value = Number.isFinite(discount.value) ? Math.max(0, discount.value) : 0
  if (discount.type === 'percent') {
    const percent = Math.min(100, value)
    return Math.min(base, fromPaise(Math.round((toPaise(base) * percent) / 100)))
  }
  return Math.min(base, round2(value))
}

/** Whether a typed discount is valid (used by form validation). */
export function isValidDiscount(discount: DiscountInput): boolean {
  const value = discount.value
  if (!Number.isFinite(value) || value < 0) return false
  if (discount.type === 'percent') return value <= 100
  return value <= 1_000_000
}

export interface Totals {
  subtotal: number
  discount: number
  total: number
  lineTotals: Record<string, number>
}

/** Totals for a drafted or saved set of lines. */
export function computeTotals(
  lines: readonly { id?: string; quantity: number; unitPrice: number }[],
  discount: DiscountInput,
): Totals {
  const lineTotals: Record<string, number> = {}
  let subtotalPaise = 0
  for (const [index, line] of lines.entries()) {
    const amount = lineAmount(line.quantity, line.unitPrice)
    lineTotals[line.id ?? String(index)] = amount
    subtotalPaise += toPaise(amount)
  }
  const subtotal = fromPaise(subtotalPaise)
  const discountValue = resolveDiscount(subtotal, discount)
  return {
    subtotal,
    discount: discountValue,
    total: round2(subtotal - discountValue),
    lineTotals,
  }
}
