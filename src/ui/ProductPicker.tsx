import { useEffect, useMemo, useState } from 'react'
import type { Product } from '../lib/types.ts'
import { formatMoney, rateLabel } from '../lib/format.ts'
import { normalizeForMatch } from '../lib/text.ts'
import { rankProducts } from '../lib/matcher.ts'
import { useAppState } from '../state/react.tsx'
import { Dialog } from './components.tsx'
import { Icon } from './icons.tsx'

export interface ProductPickerProps {
  open: boolean
  onClose: () => void
  onPick: (product: Product) => void
  title?: string
  description?: string
  /** Spoken name to pre-fill the search and rank suggestions by. */
  query?: string
  suggestedIds?: string[]
  onCreate?: (name: string) => void
}

/** Searchable catalogue list used for adding items and fixing unmatched ones. */
export function ProductPicker({ open, onClose, onPick, title = 'Add an item', description, query, suggestedIds, onCreate }: ProductPickerProps) {
  const { products, settings } = useAppState()
  const [search, setSearch] = useState(query ?? '')

  useEffect(() => {
    if (open) setSearch(query ?? '')
  }, [open, query])

  const results = useMemo(() => {
    const term = search.trim()
    if (!term) {
      if (suggestedIds?.length) {
        const suggested = suggestedIds
          .map((id) => products.find((product) => product.id === id))
          .filter((product): product is Product => !!product)
        const rest = products.filter((product) => !suggestedIds.includes(product.id))
        return [...suggested, ...rest]
      }
      return products
    }
    const key = normalizeForMatch(term)
    const ranked = rankProducts(term, products).filter((candidate) => candidate.score >= 0.3)
    const extra = products.filter(
      (product) =>
        !ranked.some((candidate) => candidate.product.id === product.id) &&
        (normalizeForMatch(product.name).includes(key) ||
          product.aliases.some((alias) => normalizeForMatch(alias).includes(key))),
    )
    return [...ranked.map((candidate) => candidate.product), ...extra]
  }, [search, products, suggestedIds])

  return (
    <Dialog open={open} onClose={onClose} title={title} description={description} size="md">
      <div className="picker-search">
        <Icon name="search" size={18} />
        <input
          className="picker-input"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search products or say the name"
          aria-label="Search products"
          autoComplete="off"
        />
        {search ? (
          <button type="button" className="btn btn-icon btn-ghost" onClick={() => setSearch('')} aria-label="Clear search">
            <Icon name="close" size={16} />
          </button>
        ) : null}
      </div>

      {products.length === 0 ? (
        <div className="picker-empty">
          <p className="picker-empty-title">Your catalogue is empty</p>
          <p className="hint">Add a product first — then bills can use its price.</p>
          {onCreate ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onCreate(search.trim() || 'New product')}>
              <Icon name="plus" size={16} />
              Create a product
            </button>
          ) : null}
        </div>
      ) : results.length === 0 ? (
        <div className="picker-empty">
          <p className="picker-empty-title">No product matches “{search.trim()}”</p>
          <p className="hint">VoiceBill never guesses a price. Create the product to bill it.</p>
          {onCreate ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onCreate(search.trim() || 'New product')}>
              <Icon name="plus" size={16} />
              Create “{search.trim() || 'product'}”
            </button>
          ) : null}
        </div>
      ) : (
        <ul className="picker-list">
          {results.map((product, index) => (
            <li key={product.id}>
              <button type="button" className="picker-row" onClick={() => onPick(product)}>
                <span className="picker-row-main">
                  <span className="picker-row-name">
                    {product.name}
                    {product.sample ? <span className="badge badge-neutral">Sample</span> : null}
                  </span>
                  <span className="picker-row-meta">
                    {rateLabel(product.price, product.unit, settings.currency)}
                    {product.aliases.length ? ` · ${product.aliases.slice(0, 3).join(', ')}` : ''}
                  </span>
                </span>
                {suggestedIds?.includes(product.id) && index === 0 ? <span className="badge badge-green">Suggested</span> : null}
                <span className="picker-row-price">{formatMoney(product.price, settings.currency)}</span>
                <Icon name="plus" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {onCreate && products.length > 0 ? (
        <div className="picker-foot">
          <button type="button" className="btn btn-outline btn-sm" onClick={() => onCreate(search.trim())}>
            <Icon name="plus" size={15} />
            {search.trim() ? `Create “${search.trim()}”` : 'Create a new product'}
          </button>
        </div>
      ) : null}
    </Dialog>
  )
}
