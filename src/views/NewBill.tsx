import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DraftItem, Product, Unit } from '../lib/types.ts'
import { parseUtteranceDetailed } from '../lib/parser.ts'
import { lineAmount } from '../lib/money.ts'
import { formatMoney, rateLabel, itemCountLabel } from '../lib/format.ts'
import { parsePrice } from '../lib/catalog.ts'
import { formatQuantity } from '../lib/units.ts'
import { navigate } from '../router.ts'
import { useAppState, useStore } from '../state/react.tsx'
import { useSpeech } from '../state/useSpeech.ts'
import { useToast } from '../ui/toast.tsx'
import { Icon } from '../ui/icons.tsx'
import { Dialog, EmptyState, SectionHead } from '../ui/components.tsx'
import { ProductPicker } from '../ui/ProductPicker.tsx'
import { ProductFormDialog } from '../ui/ProductForm.tsx'

interface HeardLine {
  id: number
  text: string
  count: number
}

const VOICE_COPY: Record<string, { title: string; hint: string; example: string }> = {
  'hi-IN': {
    title: 'माइक दबाइए और बोलिए',
    hint: 'हिंदी, हिंग्लिश या English — जैसे बोलते हैं वैसे',
    example: '“तीन किलो चीनी और दो किलो आटा”',
  },
  'en-IN': {
    title: 'Tap the mic and speak',
    hint: 'Hindi, Hinglish or English — speak the way you talk',
    example: '“3 kilo chini and 2 kilo aata”',
  },
}

/* ------------------------------------------------------------------ */
/* Quantity control                                                    */
/* ------------------------------------------------------------------ */

function QtyStepper({ item, onChange }: { item: DraftItem; onChange: (quantity: number) => void }) {
  const [text, setText] = useState(String(item.quantity))
  useEffect(() => setText(String(item.quantity)), [item.quantity])

  const commit = (raw: string) => {
    const parsed = Number(raw.replace(',', '.'))
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setText(String(item.quantity))
      return
    }
    onChange(parsed)
  }

  const step = (direction: 1 | -1) => {
    const current = item.quantity
    const delta = Number.isInteger(current) ? 1 : 0.25
    const next = Math.max(0.25, Math.round((current + direction * delta) * 1000) / 1000)
    onChange(next)
  }

  return (
    <div className="qty">
      <button type="button" className="qty-btn" onClick={() => step(-1)} aria-label={`Decrease ${item.name} quantity`}>
        <Icon name="minus" size={15} />
      </button>
      <input
        className="qty-input"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => commit(text)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit(text)
            ;(event.target as HTMLInputElement).blur()
          }
        }}
        inputMode="decimal"
        aria-label={`${item.name} quantity`}
      />
      <span className="qty-unit">{item.unit}</span>
      <button type="button" className="qty-btn" onClick={() => step(1)} aria-label={`Increase ${item.name} quantity`}>
        <Icon name="plus" size={15} />
      </button>
    </div>
  )
}

function StatusChip({ status }: { status: DraftItem['status'] }) {
  if (status === 'ready') return null
  const map = {
    unmatched: { tone: 'amber', label: 'Needs product' },
    'missing-price': { tone: 'amber', label: 'No price' },
    'unit-mismatch': { tone: 'red', label: 'Check unit' },
  } as const
  const entry = map[status]
  return <span className={`badge badge-${entry.tone}`}>{entry.label}</span>
}

/* ------------------------------------------------------------------ */
/* One line in the draft                                               */
/* ------------------------------------------------------------------ */

interface DraftRowProps {
  item: DraftItem
  currency: string
  onResolve: (item: DraftItem) => void
  onCreate: (item: DraftItem) => void
  onChangeProduct: (item: DraftItem) => void
}

function DraftRow({ item, currency, onResolve, onCreate, onChangeProduct }: DraftRowProps) {
  const store = useStore()
  const state = useAppState()
  const notify = useToast()
  const [editingPrice, setEditingPrice] = useState(item.status === 'missing-price')
  const [priceText, setPriceText] = useState(item.unitPrice > 0 ? String(item.unitPrice) : '')

  useEffect(() => {
    setPriceText(item.unitPrice > 0 ? String(item.unitPrice) : '')
    if (item.status === 'missing-price') setEditingPrice(true)
  }, [item.unitPrice, item.status])

  const product = state.products.find((candidate) => candidate.id === item.productId)
  const amount = lineAmount(item.quantity, item.unitPrice)
  const suggestions = (item.candidates ?? [])
    .map((id) => state.products.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is Product => !!candidate)
    .slice(0, 2)

  const commitPrice = () => {
    const parsed = parsePrice(priceText)
    if (parsed === null || parsed <= 0) {
      notify('Enter a price like 45 or 45.50', 'error')
      setPriceText(item.unitPrice > 0 ? String(item.unitPrice) : '')
      return
    }
    store.setItemPrice(item.id, parsed)
    setEditingPrice(false)
  }

  return (
    <li className={`item-row item-${item.status}`}>
      <div className="item-main">
        <div className="item-line">
          <span className="item-name">{item.name}</span>
          <StatusChip status={item.status} />
        </div>

        <div className="item-meta">
          {item.productId ? (
            editingPrice ? (
              <span className="price-edit">
                <span className="price-prefix">{currency}</span>
                <input
                  className="price-input"
                  value={priceText}
                  onChange={(event) => setPriceText(event.target.value)}
                  onBlur={commitPrice}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      commitPrice()
                    }
                    if (event.key === 'Escape') setEditingPrice(false)
                  }}
                  inputMode="decimal"
                  aria-label={`${item.name} price per ${item.unit}`}
                  autoFocus={item.status === 'missing-price'}
                />
                <span className="price-suffix">/{item.unit}</span>
                <button type="button" className="btn btn-icon btn-ghost btn-xs" onClick={commitPrice} aria-label="Save price">
                  <Icon name="check" size={14} />
                </button>
              </span>
            ) : (
              <button type="button" className="price-button" onClick={() => setEditingPrice(true)} aria-label={`Change price for ${item.name}`}>
                {rateLabel(item.unitPrice, item.unit, currency)}
                <Icon name="edit" size={12} />
              </button>
            )
          ) : (
            <span className="item-meta-muted">Not in your catalogue — choose a product to set its price.</span>
          )}
          {item.priceOverride ? <span className="item-tag">price changed</span> : null}
        </div>

        {item.warnings?.length ? <p className="item-warning">{item.warnings[0]}</p> : null}

        {item.status === 'unmatched' ? (
          <div className="item-fix">
            <div className="item-fix-actions">
              <button type="button" className="btn btn-primary btn-xs" onClick={() => onResolve(item)}>
                <Icon name="search" size={14} />
                Choose product
              </button>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => onCreate(item)}>
                <Icon name="plus" size={14} />
                Create new
              </button>
            </div>
            {suggestions.length ? (
              <div className="suggestions">
                <span className="suggestions-label">Did you mean</span>
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion.id}
                    type="button"
                    className="chip chip-suggestion"
                    onClick={() => {
                      store.resolveItem(item.id, suggestion.id)
                      notify(`${suggestion.name} matched.`, 'success')
                    }}
                  >
                    {suggestion.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {item.status === 'unit-mismatch' && product ? (
          <div className="item-fix">
            <p className="item-warning">
              {item.name} is sold per {product.unit}, but you said {item.unit}.
            </p>
            <button
              type="button"
              className="btn btn-outline btn-xs"
              onClick={() => {
                store.setItemUnit(item.id, product.unit)
                notify(`Unit set to ${product.unit}.`, 'info')
              }}
            >
              Use {formatQuantity(item.quantity, product.unit)}
            </button>
          </div>
        ) : null}
      </div>

      <div className="item-qty">
        <QtyStepper item={item} onChange={(quantity) => store.setItemQuantity(item.id, quantity)} />
      </div>

      <div className="item-end">
        <span className="item-amount">{formatMoney(amount, currency)}</span>
        <button
          type="button"
          className="btn btn-icon btn-ghost item-swap"
          onClick={() => onChangeProduct(item)}
          aria-label={`Change product for ${item.name}`}
          title="Change product"
        >
          <Icon name="swap" size={16} />
        </button>
        <button
          type="button"
          className="btn btn-icon btn-ghost item-remove"
          onClick={() => {
            store.removeItem(item.id)
            notify(`${item.name} removed.`, 'info')
          }}
          aria-label={`Remove ${item.name}`}
        >
          <Icon name="trash" size={16} />
        </button>
      </div>
    </li>
  )
}

/* ------------------------------------------------------------------ */
/* Discount + totals                                                   */
/* ------------------------------------------------------------------ */

function TotalsPanel({ onReview }: { onReview: () => void }) {
  const store = useStore()
  const state = useAppState()
  const draft = state.draft
  const readiness = store.readiness()
  const currency = state.settings.currency
  const [discountText, setDiscountText] = useState(draft.discountValue ? String(draft.discountValue) : '')

  const updateDiscount = (raw: string) => {
    setDiscountText(raw)
    const parsed = Number(raw.replace(',', '.'))
    store.setDiscount(draft.discountType, Number.isFinite(parsed) ? parsed : 0)
  }

  return (
    <div className="totals">
      <div className="total-row">
        <span>Subtotal</span>
        <span className="total-number">{formatMoney(readiness.subtotal, currency)}</span>
      </div>
      <div className="total-row total-discount">
        <span>Discount</span>
        <span className="discount-control">
          <span className="mini-seg" role="group" aria-label="Discount type">
            <button
              type="button"
              className={draft.discountType === 'amount' ? 'is-active' : ''}
              aria-pressed={draft.discountType === 'amount'}
              onClick={() => store.setDiscount('amount', draft.discountValue)}
              title="Rupees off"
            >
              {currency}
            </button>
            <button
              type="button"
              className={draft.discountType === 'percent' ? 'is-active' : ''}
              aria-pressed={draft.discountType === 'percent'}
              onClick={() => store.setDiscount('percent', draft.discountValue)}
              title="Percent off"
            >
              %
            </button>
          </span>
          <input
            className="discount-input"
            value={discountText}
            onChange={(event) => updateDiscount(event.target.value)}
            inputMode="decimal"
            placeholder="0"
            aria-label={draft.discountType === 'percent' ? 'Discount percent' : 'Discount amount'}
          />
        </span>
      </div>
      {readiness.discount > 0 ? (
        <p className="total-save">Customer saves {formatMoney(readiness.discount, currency)}</p>
      ) : null}
      <div className="total-final">
        <span>Total</span>
        <span>{formatMoney(readiness.total, currency)}</span>
      </div>

      {readiness.issues.length > 0 ? (
        <div className="issue-box" role="status">
          <Icon name="alert" size={16} />
          <div>
            <p className="issue-title">
              {readiness.issues.length === 1 ? '1 thing to fix' : `${readiness.issues.length} things to fix`}
            </p>
            <ul className="issue-list">
              {readiness.issues.slice(0, 3).map((issue, index) => (
                <li key={`${issue.code}-${issue.itemId ?? index}`}>{issue.message}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <button type="button" className="btn btn-primary btn-lg btn-block" onClick={onReview}>
        Review bill
        <Icon name="arrow-right" size={18} />
      </button>
      <p className="totals-note">Nothing is saved until you review and confirm.</p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The screen                                                          */
/* ------------------------------------------------------------------ */

export function NewBill() {
  const store = useStore()
  const state = useAppState()
  const notify = useToast()
  const { draft, settings, products } = state
  const currency = settings.currency
  const [heard, setHeard] = useState<HeardLine[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerTarget, setPickerTarget] = useState<{ item: DraftItem; mode: 'resolve' | 'change' } | null>(null)
  const [createFor, setCreateFor] = useState<{ itemId: string; name: string; unit: Unit } | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [processing, setProcessing] = useState(false)
  const manualRef = useRef<HTMLElement>(null)
  const counter = useRef(0)
  const processingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (processingTimer.current) clearTimeout(processingTimer.current)
    },
    [],
  )

  const onFinal = useCallback(
    (text: string) => {
      setProcessing(true)
      if (processingTimer.current) clearTimeout(processingTimer.current)
      processingTimer.current = setTimeout(() => setProcessing(false), 450)
      const outcome = parseUtteranceDetailed(text)
      counter.current += 1
      if (outcome.items.length === 0) {
        setHeard((prev) => [...prev, { id: counter.current, text, count: 0 }].slice(-3))
        notify(`I heard “${text}” but couldn’t find an item. Try “3 kilo chini”.`, 'error')
        return
      }
      const result = store.addParsedItems(outcome.items)
      setHeard((prev) => [...prev, { id: counter.current, text, count: outcome.items.length }].slice(-3))

      const newlyUnmatched = result.added.filter((item) => item.status === 'unmatched').map((item) => item.name)
      if (result.merged > 0 && result.added.length === 0) {
        notify(`Updated the quantity of ${result.merged} existing item${result.merged > 1 ? 's' : ''}.`, 'info')
      } else {
        const added = result.added.length + result.merged
        notify(`Added ${itemCountLabel(added)} to the bill.`, 'success')
      }
      if (newlyUnmatched.length) {
        notify(`Not in your catalogue: ${newlyUnmatched.join(', ')}. Choose a product to continue.`, 'error')
      }
      for (const issue of outcome.issues) notify(issue, 'error')
      const warning = outcome.items.flatMap((item) => item.warnings)[0]
      if (warning) notify(warning, 'error')
    },
    [store, notify],
  )

  const speech = useSpeech({ lang: settings.language, onFinal })
  const copy = VOICE_COPY[settings.language] ?? VOICE_COPY['en-IN']
  const listening = speech.listening
  const readiness = store.readiness()
  const items = draft.items

  const frequentProducts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const bill of state.bills.slice(0, 40)) {
      for (const item of bill.items) counts.set(item.productId, (counts.get(item.productId) ?? 0) + 1)
    }
    const ranked = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => products.find((product) => product.id === id))
      .filter((product): product is Product => !!product)
    const rest = products.filter((product) => !ranked.some((rankedProduct) => rankedProduct.id === product.id))
    return [...ranked, ...rest].slice(0, 5)
  }, [state.bills, products])

  const changeLanguage = (language: 'hi-IN' | 'en-IN') => {
    if (language === settings.language) return
    if (listening) speech.stop()
    store.updateSettings({ language })
  }

  const focusManual = () => {
    manualRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    const button = manualRef.current?.querySelector<HTMLButtonElement>('button')
    button?.focus({ preventScroll: true })
  }

  const status = listening
    ? processing
      ? 'Adding what I heard to the bill…'
      : 'Listening — speak, then tap to stop.'
    : speech.state === 'starting'
      ? 'Starting the microphone…'
      : processing
        ? 'Adding what I heard to the bill…'
        : heard.length
          ? 'Stopped. Tap the mic to add more, or fix the items below.'
          : 'Speak a list, one item after another. Everything stays editable.'

  const confirmBill = () => {
    const result = store.finalize()
    if (!result.ok || !result.bill) {
      for (const issue of result.issues.slice(0, 3)) notify(issue.message, 'error')
      return
    }
    setReviewOpen(false)
    setHeard([])
    notify(`Bill ${result.bill.number} saved.`, 'success')
    navigate({ name: 'receipt', billId: result.bill.id })
  }

  return (
    <div className="page page-newbill">
      <header className="page-head">
        <div>
          <p className="eyebrow">New bill</p>
          <h1 className="page-title">
            {items.length > 0 ? 'Keep adding, then review' : 'What is the customer buying?'}
          </h1>
        </div>
        {items.length > 0 ? (
          <span className="draft-badge">
            <Icon name="receipt" size={15} />
            {itemCountLabel(items.length)}
          </span>
        ) : null}
      </header>

      <section className={`mic-stage${listening ? ' is-live' : ''}`} aria-labelledby="mic-title">
        <div className="mic-head">
          <div>
            <p className="eyebrow">Voice bill</p>
            <h2 className="mic-title" id="mic-title">
              {listening ? 'Listening…' : copy.title}
            </h2>
            <p className="mic-sub">{copy.hint}</p>
          </div>
          <div className="segmented" role="group" aria-label="Recognition language">
            <button
              type="button"
              className={settings.language === 'hi-IN' ? 'is-active' : ''}
              aria-pressed={settings.language === 'hi-IN'}
              onClick={() => changeLanguage('hi-IN')}
            >
              हिंदी
            </button>
            <button
              type="button"
              className={settings.language === 'en-IN' ? 'is-active' : ''}
              aria-pressed={settings.language === 'en-IN'}
              onClick={() => changeLanguage('en-IN')}
            >
              English
            </button>
          </div>
        </div>

        <div className="mic-center">
          <div className="mic-wrap">
            <div className="mic-rings" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <button
              type="button"
              className={`mic-button${listening ? ' is-listening' : ''}${!speech.supported ? ' is-disabled' : ''}`}
              onClick={() => {
                if (!speech.supported) {
                  notify(
                    speech.reason === 'insecure'
                      ? 'Voice needs a secure (https) connection here. Add items by hand below.'
                      : 'This browser can’t do speech recognition. Add items by hand below — it works the same.',
                    'error',
                  )
                  focusManual()
                  return
                }
                speech.toggle()
              }}
              aria-pressed={listening}
              aria-label={listening ? 'Stop listening' : 'Start voice input'}
            >
              <Icon name="mic" size={46} />
            </button>
          </div>
          {listening ? (
            <div className="wave" aria-hidden="true">
              {[0, 1, 2, 3, 4].map((bar) => (
                <span key={bar} style={{ animationDelay: `${bar * 0.12}s` }} />
              ))}
            </div>
          ) : (
            <p className="mic-example">{copy.example}</p>
          )}
        </div>

        <p className={`mic-status${processing ? ' is-processing' : ''}`} role="status">
          {processing ? <span className="dot-pulse" aria-hidden="true" /> : null}
          {status}
        </p>

        <div className="transcript" aria-live="polite">
          {speech.interim ? <p className="transcript-interim">“{speech.interim}”</p> : null}
          {heard.length === 0 && !speech.interim ? (
            <p className="transcript-empty">Nothing heard yet. Speak naturally — “2 kilo aata aur 1 litre tel”.</p>
          ) : null}
          {heard.map((line) => (
            <p key={line.id} className="transcript-line">
              <Icon name={line.count > 0 ? 'check-circle' : 'alert'} size={15} />
              <span>“{line.text}”</span>
              <em>{line.count > 0 ? `${line.count} item${line.count > 1 ? 's' : ''}` : 'not understood'}</em>
            </p>
          ))}
        </div>

        {!speech.supported ? (
          <div className="banner banner-warn">
            <Icon name="alert" size={18} />
            <div className="banner-body">
              <strong>Voice input isn’t available in this browser.</strong>
              <p>
                {speech.reason === 'insecure'
                  ? 'Speech recognition needs an https connection. You can still add items by hand — the bill works exactly the same.'
                  : 'Chrome on Android or desktop supports Hindi and English speech. You can add items by hand below.'}
              </p>
            </div>
            <button type="button" className="btn btn-outline btn-sm" onClick={focusManual}>
              Add by hand
            </button>
          </div>
        ) : null}

        {speech.failure ? (
          <div className="banner banner-error" role="alert">
            <Icon name="mic-off" size={18} />
            <div className="banner-body">
              <strong>Voice input stopped</strong>
              <p>{speech.failure.message}</p>
            </div>
            <div className="banner-actions">
              {speech.failure.recoverable ? (
                <button type="button" className="btn btn-outline btn-sm" onClick={() => speech.start()}>
                  Try again
                </button>
              ) : null}
              <button type="button" className="btn btn-ghost btn-sm" onClick={focusManual}>
                Add by hand
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <div className="workspace">
        <section className="card bill-card">
          <SectionHead
            eyebrow="Draft bill"
            title={items.length ? itemCountLabel(items.length) : 'Your bill'}
            action={
              items.length ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setClearOpen(true)}>
                  <Icon name="trash" size={15} />
                  Clear
                </button>
              ) : (
                <span className="section-note">Not saved yet</span>
              )
            }
          />

          {items.length === 0 ? (
            <EmptyState
              icon="mic"
              title="No items yet"
              body="Speak the items or add them by hand. Prices come from your catalogue and you can change any line before saving."
            />
          ) : (
            <>
              <ul className="items">
                {items.map((item) => (
                  <DraftRow
                    key={item.id}
                    item={item}
                    currency={currency}
                    onResolve={(item) => setPickerTarget({ item, mode: 'resolve' })}
                    onChangeProduct={(item) => setPickerTarget({ item, mode: 'change' })}
                    onCreate={(target) => setCreateFor({ itemId: target.id, name: target.name, unit: target.unit })}
                  />
                ))}
              </ul>
              <TotalsPanel onReview={() => setReviewOpen(true)} />
            </>
          )}
        </section>

        <section className="card manual-card" ref={manualRef}>
          <SectionHead eyebrow="Manual" title="Add by hand" />
          <p className="manual-copy">No voice, or a noisy shop? Pick from your catalogue.</p>
          <button type="button" className="btn btn-outline btn-block" onClick={() => setPickerOpen(true)}>
            <Icon name="search" size={17} />
            Choose a product
          </button>

          {products.length > 0 ? (
            <div className="quick-add">
              <p className="quick-add-label">Frequently billed</p>
              <div className="chips">
                {frequentProducts.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    className="chip chip-add"
                    onClick={() => {
                      store.addProductToDraft(product.id, 1)
                      notify(`${product.name} added.`, 'success')
                    }}
                  >
                    <Icon name="plus" size={12} />
                    {product.name}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="manual-empty">
              <p className="hint">Your catalogue is empty. Add products and prices first — VoiceBill never invents a price.</p>
              <a className="btn btn-primary btn-sm" href="#/products">
                Add products
              </a>
            </div>
          )}

          <div className="privacy-note">
            <Icon name="shield" size={15} />
            <p>Voice audio is handled by your browser and never uploaded by VoiceBill.</p>
          </div>
        </section>
      </div>

      <ProductPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Add an item"
        description="Pick a product — it is added at your catalogue price."
        onPick={(product) => {
          store.addProductToDraft(product.id, 1)
          notify(`${product.name} added.`, 'success')
          setPickerOpen(false)
        }}
        onCreate={(name) => {
          setPickerOpen(false)
          setCreateFor({ itemId: '', name, unit: 'kg' })
        }}
      />

      <ProductPicker
        open={!!pickerTarget}
        onClose={() => setPickerTarget(null)}
        title={
          pickerTarget
            ? pickerTarget.mode === 'resolve'
              ? `Choose the product for “${pickerTarget.item.name}”`
              : `Change ${pickerTarget.item.name} to…`
            : 'Choose the product'
        }
        description="Your catalogue price is used. You can still change it on the bill."
        query={pickerTarget?.mode === 'resolve' ? pickerTarget.item.name : undefined}
        suggestedIds={pickerTarget?.mode === 'resolve' ? pickerTarget.item.candidates : undefined}
        onPick={(product) => {
          if (pickerTarget) {
            const previous = pickerTarget.item.name
            store.resolveItem(pickerTarget.item.id, product.id)
            notify(
              pickerTarget.mode === 'resolve'
                ? `“${previous}” matched to ${product.name}.`
                : `${previous} changed to ${product.name}.`,
              'success',
            )
          }
          setPickerTarget(null)
        }}
        onCreate={(name) => {
          setCreateFor({
            itemId: pickerTarget?.item.id ?? '',
            name,
            unit: pickerTarget?.item.unit ?? 'kg',
          })
          setPickerTarget(null)
        }}
      />

      <ProductFormDialog
        open={!!createFor}
        onClose={() => setCreateFor(null)}
        initial={{ name: createFor?.name ?? '', unit: createFor?.unit ?? 'kg' }}
        context={createFor?.itemId ? 'Creating a product fixes the unmatched line once you save.' : undefined}
        onSaved={(product) => {
          if (createFor?.itemId) {
            store.resolveItem(createFor.itemId, product.id)
          } else {
            store.addProductToDraft(product.id, 1)
          }
        }}
      />

      <Dialog
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        title="Clear this bill?"
        description="The items and discount on this bill will be removed. Saved bills are not affected."
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setClearOpen(false)}>
              Keep bill
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                store.clearDraft()
                setHeard([])
                setClearOpen(false)
                notify('Bill cleared.', 'info')
              }}
            >
              Clear bill
            </button>
          </>
        }
      >
        <p className="dialog-copy">
          {itemCountLabel(items.length)} · {formatMoney(readiness.total, currency)}
        </p>
      </Dialog>

      <Dialog
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        title="Review before saving"
        description="Check the items and total. Nothing is saved until you confirm."
        size="lg"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setReviewOpen(false)}>
              Keep editing
            </button>
            <button type="button" className="btn btn-primary" onClick={confirmBill} disabled={!readiness.ok}>
              <Icon name="check" size={17} />
              Save bill
            </button>
          </>
        }
      >
        <ul className="review-list">
          {items.map((item) => (
            <li key={item.id} className="review-row">
              <span className="review-main">
                <span className="review-name">{item.name}</span>
                <span className="review-meta">
                  {formatQuantity(item.quantity, item.unit)} × {rateLabel(item.unitPrice, item.unit, currency)}
                </span>
              </span>
              <span className="review-amount">{formatMoney(lineAmount(item.quantity, item.unitPrice), currency)}</span>
            </li>
          ))}
        </ul>
        <div className="review-totals">
          <div className="total-row">
            <span>Subtotal</span>
            <span>{formatMoney(readiness.subtotal, currency)}</span>
          </div>
          {readiness.discount > 0 ? (
            <div className="total-row">
              <span>Discount</span>
              <span>− {formatMoney(readiness.discount, currency)}</span>
            </div>
          ) : null}
          <div className="total-final total-final-compact">
            <span>Total</span>
            <span>{formatMoney(readiness.total, currency)}</span>
          </div>
        </div>
        {!readiness.ok ? (
          <div className="issue-box" role="alert">
            <Icon name="alert" size={16} />
            <div>
              <p className="issue-title">Fix these before saving</p>
              <ul className="issue-list">
                {readiness.issues.map((issue, index) => (
                  <li key={`${issue.code}-${issue.itemId ?? index}`}>{issue.message}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
        {readiness.ok ? (
          <p className="review-note">
            <Icon name="shield" size={15} /> Saved on this device only. You can reprint it from Bill history.
          </p>
        ) : null}
      </Dialog>
    </div>
  )
}
