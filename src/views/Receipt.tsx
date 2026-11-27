import { useEffect } from 'react'
import { buildReceipt } from '../lib/receipt.ts'
import { formatMoney } from '../lib/format.ts'
import { useAppState, useStore } from '../state/react.tsx'
import { Icon } from '../ui/icons.tsx'
import { useToast } from '../ui/toast.tsx'

const WIDTH_LABEL = { '58': '58 mm thermal', '80': '80 mm thermal', a4: 'A4' } as const

export function ReceiptView({ billId }: { billId?: string }) {
  const store = useStore()
  const state = useAppState()
  const notify = useToast()
  const bill = billId ? store.getBill(billId) : undefined

  useEffect(() => {
    if (!bill) return
    const previous = document.title
    document.title = `${bill.number} · ${state.settings.shopName || 'VoiceBill'}`
    return () => {
      document.title = previous
    }
  }, [bill, state.settings.shopName])

  if (!bill) {
    return (
      <div className="page">
        <div className="card notfound">
          <span className="empty-icon" aria-hidden="true">
            <Icon name="receipt" size={26} />
          </span>
          <h1 className="empty-title">Bill not found</h1>
          <p className="empty-body">It may have been made on another device, or removed from this browser’s storage.</p>
          <div className="empty-action">
            <a className="btn btn-primary btn-sm" href="#/bills">
              Go to bill history
            </a>
          </div>
        </div>
      </div>
    )
  }

  const model = buildReceipt(bill, state.settings)
  const pageCss =
    state.settings.receiptWidth === 'a4'
      ? '@page { size: A4; margin: 12mm; }'
      : `@page { size: ${state.settings.receiptWidth}mm auto; margin: 3mm 2mm 4mm; }`

  return (
    <div className="receipt-screen">
      <style>{pageCss}</style>

      <div className="receipt-toolbar no-print">
        <a className="btn btn-ghost btn-sm" href="#/bills">
          <Icon name="chevron-left" size={16} />
          Bills
        </a>
        <div className="receipt-toolbar-actions">
          <span className="receipt-chip">{WIDTH_LABEL[state.settings.receiptWidth]}</span>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              try {
                window.print()
              } catch {
                notify('Printing is not available in this browser.', 'error')
              }
            }}
          >
            <Icon name="printer" size={17} />
            Print receipt
          </button>
        </div>
      </div>

      <article className={`receipt-paper receipt-${model.width}`} id="receipt">
        <header className="receipt-head">
          <h1 className="receipt-shop">{model.shopName}</h1>
          {model.address ? <p className="receipt-contact">{model.address}</p> : null}
          {model.phone ? <p className="receipt-contact">Ph: {model.phone}</p> : null}
        </header>

        <div className="receipt-rule" />

        <div className="receipt-meta">
          <span>{model.billNumber}</span>
          <span>
            {model.dateLabel} · {model.timeLabel}
          </span>
        </div>

        <div className="receipt-rule receipt-rule-dashed" />

        <ul className="receipt-lines">
          {model.lines.map((line, index) => (
            <li key={`${line.name}-${index}`} className="receipt-line">
              <span className="receipt-line-name">{line.name}</span>
              <span className="receipt-line-calc">
                <span>
                  {line.quantity} × {line.rate}
                </span>
                <span className="receipt-line-amount">{line.amount}</span>
              </span>
            </li>
          ))}
        </ul>

        <div className="receipt-rule receipt-rule-dashed" />

        <div className="receipt-total-row">
          <span>Subtotal</span>
          <span>{model.subtotal}</span>
        </div>
        {bill.discount > 0 ? (
          <div className="receipt-total-row">
            <span>Discount</span>
            <span>− {model.discount}</span>
          </div>
        ) : null}
        <div className="receipt-grand">
          <span>TOTAL</span>
          <span>{model.total}</span>
        </div>

        <p className="receipt-thanks">{model.thankYou}</p>
        <p className="receipt-foot">
          {model.itemCount} item{model.itemCount === 1 ? '' : 's'} · {model.dateLabel}
        </p>
        <p className="receipt-brand">Billed with VoiceBill</p>
      </article>

      <div className="receipt-actions no-print">
        <p className="receipt-tip">
          For a PDF, choose <strong>Save as PDF</strong> in the print dialog. The page size is already set for the receipt width — just pick
          your printer and print.
        </p>
        <div className="receipt-actions-row">
          <a className="btn btn-outline btn-sm" href="#/new">
            <Icon name="mic" size={16} />
            New bill
          </a>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(`${model.billNumber} · ${formatMoney(bill.total, state.settings.currency)} · ${model.shopName}`)
                notify('Bill summary copied.', 'success')
              } catch {
                notify('Could not copy to the clipboard.', 'error')
              }
            }}
          >
            Copy summary
          </button>
        </div>
      </div>
    </div>
  )
}
