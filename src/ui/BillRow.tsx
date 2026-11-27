import type { Bill } from '../lib/types.ts'
import { useAppState } from '../state/react.tsx'
import { formatMoney, formatTimeLabel, itemCountLabel } from '../lib/format.ts'
import { Icon } from './icons.tsx'

/** One saved bill, linking to its receipt. Used on the dashboard and history. */
export function BillRow({ bill, showTime = true }: { bill: Bill; showTime?: boolean }) {
  const { settings } = useAppState()
  const names = bill.items.slice(0, 2).map((item) => item.name)
  const extra = bill.items.length > 2 ? ` +${bill.items.length - 2} more` : ''
  return (
    <a className="bill-row" href={`#/bill/${encodeURIComponent(bill.id)}`}>
      <span className="bill-row-icon" aria-hidden="true">
        <Icon name="receipt" size={17} />
      </span>
      <span className="bill-row-main">
        <span className="bill-row-top">
          <span className="bill-row-number">{bill.number}</span>
          <span className="bill-row-amount">{formatMoney(bill.total, settings.currency)}</span>
        </span>
        <span className="bill-row-meta">
          {showTime ? `${formatTimeLabel(bill.createdAt)} · ` : ''}
          {names.join(', ')}
          {extra} · {itemCountLabel(bill.items.length)}
        </span>
      </span>
      <Icon name="chevron-right" size={16} className="bill-row-arrow" />
    </a>
  )
}
