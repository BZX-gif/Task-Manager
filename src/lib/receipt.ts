/**
 * The receipt document model.
 *
 * Kept separate from the React view so the numbers and labels can be tested
 * without a DOM, and so the same model drives screen, thermal print and A4.
 */
import type { Bill, ReceiptWidth, Settings } from './types.ts'
import { formatDateLabel, formatMoneyFixed, formatTimeLabel } from './format.ts'
import { formatNumber } from './units.ts'

export interface ReceiptLine {
  name: string
  quantity: string
  rate: string
  amount: string
}

export interface ReceiptModel {
  shopName: string
  address: string
  phone: string
  billNumber: string
  dateLabel: string
  timeLabel: string
  lines: ReceiptLine[]
  itemCount: number
  subtotal: string
  discount: string
  total: string
  thankYou: string
  currency: string
  width: ReceiptWidth
  /** Physical paper width in millimetres; null for A4. */
  widthMm: number | null
}

export function receiptWidthMm(width: ReceiptWidth): number | null {
  if (width === '58') return 58
  if (width === '80') return 80
  return null
}

export function buildReceipt(bill: Bill, settings: Settings): ReceiptModel {
  const currency = settings.currency || '₹'
  return {
    shopName: settings.shopName.trim() || 'Your Shop',
    address: settings.address.trim(),
    phone: settings.phone.trim(),
    billNumber: bill.number,
    dateLabel: formatDateLabel(bill.createdAt),
    timeLabel: formatTimeLabel(bill.createdAt),
    lines: bill.items.map((item) => ({
      name: item.name,
      quantity: `${formatNumber(item.quantity)} ${item.unit}`,
      rate: `${formatMoneyFixed(item.unitPrice, currency)}/${item.unit}`,
      amount: formatMoneyFixed(item.lineTotal, currency),
    })),
    itemCount: bill.items.length,
    subtotal: formatMoneyFixed(bill.subtotal, currency),
    discount: formatMoneyFixed(bill.discount, currency),
    total: formatMoneyFixed(bill.total, currency),
    thankYou: settings.thankYou.trim() || 'Thank you for shopping with us!',
    currency,
    width: settings.receiptWidth,
    widthMm: receiptWidthMm(settings.receiptWidth),
  }
}

/** Filename used when printing to PDF, e.g. VB-20261127-001.pdf. */
export function receiptFileName(bill: Bill): string {
  return `${bill.number}.pdf`
}
