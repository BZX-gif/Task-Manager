import { useMemo, useState } from 'react'
import type { Product } from '../lib/types.ts'
import { formatMoney, rateLabel } from '../lib/format.ts'
import { normalizeForMatch } from '../lib/text.ts'
import { useAppState, useStore } from '../state/react.tsx'
import { useToast } from '../ui/toast.tsx'
import { Icon } from '../ui/icons.tsx'
import { Dialog, EmptyState } from '../ui/components.tsx'
import { ProductFormDialog } from '../ui/ProductForm.tsx'

export function Products() {
  const state = useAppState()
  const store = useStore()
  const notify = useToast()
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [deleting, setDeleting] = useState<Product | null>(null)

  const filtered = useMemo(() => {
    const query = normalizeForMatch(search)
    return state.products
      .filter((product) => {
        if (!query) return true
        return (
          normalizeForMatch(product.name).includes(query) ||
          product.aliases.some((alias) => normalizeForMatch(alias).includes(query))
        )
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [state.products, search])

  const sampleCount = state.products.filter((product) => product.sample).length
  const inDraft = (product: Product) => state.draft.items.some((item) => item.productId === product.id)

  const openAdd = () => {
    setEditing(null)
    setFormOpen(true)
  }

  const openEdit = (product: Product) => {
    setEditing(product)
    setFormOpen(true)
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Catalogue</p>
          <h1 className="page-title">Products &amp; prices</h1>
          <p className="page-sub">
            {state.products.length
              ? `${state.products.length} product${state.products.length === 1 ? '' : 's'} ready for voice billing.`
              : 'Add the items you sell — voice billing matches what you say against this list.'}
          </p>
        </div>
        <button type="button" className="btn btn-primary page-head-action" onClick={openAdd}>
          <Icon name="plus" size={18} />
          Add product
        </button>
      </header>

      {state.products.length > 0 ? (
        <div className="toolbar">
          <div className="search-field">
            <Icon name="search" size={18} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search products or other names"
              aria-label="Search products"
              autoComplete="off"
            />
            {search ? (
              <button type="button" className="btn btn-icon btn-ghost btn-xs" onClick={() => setSearch('')} aria-label="Clear search">
                <Icon name="close" size={14} />
              </button>
            ) : null}
          </div>
          <p className="toolbar-count">
            {filtered.length} of {state.products.length}
          </p>
        </div>
      ) : null}

      {state.products.length === 0 ? (
        <section className="card">
          <EmptyState
            icon="box"
            title="Your catalogue is empty"
            body="VoiceBill never invents a price. Add a few products, or start with sample data and edit the prices."
            action={
              <div className="empty-actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={openAdd}>
                  <Icon name="plus" size={16} />
                  Add first product
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => {
                    const added = store.addSampleProducts()
                    notify(added ? `${added} sample products added. Edit the prices to match your shop.` : 'Sample products are already added.', 'success')
                  }}
                >
                  Add 9 sample products
                </button>
              </div>
            }
          />
        </section>
      ) : filtered.length === 0 ? (
        <section className="card">
          <EmptyState
            icon="search"
            title={`No product matches “${search.trim()}”`}
            body="Try a different word, or add this product to your catalogue."
            action={
              <button type="button" className="btn btn-primary btn-sm" onClick={openAdd}>
                <Icon name="plus" size={16} />
                Add “{search.trim()}”
              </button>
            }
          />
        </section>
      ) : (
        <section className="card table-card" aria-label="Product catalogue">
          <div className="product-head" aria-hidden="true">
            <span>Product</span>
            <span className="product-head-names">Spoken as</span>
            <span className="product-head-price">Price</span>
            <span />
          </div>
          <ul className="product-list">
            {filtered.map((product) => (
              <li key={product.id} className="product-row">
                <span className="product-main">
                  <span className="product-name">
                    {product.name}
                    {product.sample ? <span className="badge badge-neutral">Sample</span> : null}
                  </span>
                  <span className="product-mobile-price">{rateLabel(product.price, product.unit, state.settings.currency)}</span>
                </span>
                <span className="product-aliases">
                  {product.aliases.length ? (
                    product.aliases.slice(0, 4).map((alias) => (
                      <span key={alias} className="alias-chip">
                        {alias}
                      </span>
                    ))
                  ) : (
                    <span className="muted">Only its name</span>
                  )}
                  {product.aliases.length > 4 ? <span className="alias-more">+{product.aliases.length - 4}</span> : null}
                </span>
                <span className="product-price">
                  <strong>{formatMoney(product.price, state.settings.currency)}</strong>
                  <span className="product-unit">/ {product.unit}</span>
                </span>
                <span className="product-actions">
                  <button type="button" className="btn btn-icon btn-ghost" onClick={() => openEdit(product)} aria-label={`Edit ${product.name}`}>
                    <Icon name="edit" size={16} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-icon btn-ghost btn-danger-ghost"
                    onClick={() => setDeleting(product)}
                    aria-label={`Delete ${product.name}`}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {sampleCount > 0 ? (
        <div className="data-note">
          <Icon name="info" size={16} />
          <p>
            {sampleCount} sample product{sampleCount === 1 ? '' : 's'} in your catalogue. Edit the prices to match your shop, or remove
            them once you have added your own.
          </p>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              const removed = store.removeSampleProducts()
              notify(`${removed} sample product${removed === 1 ? '' : 's'} removed.`, 'info')
            }}
          >
            Remove samples
          </button>
        </div>
      ) : null}

      <ProductFormDialog open={formOpen} onClose={() => setFormOpen(false)} product={editing} />

      <Dialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={deleting ? `Delete ${deleting.name}?` : 'Delete product?'}
        description="Saved bills keep their own copy, so past bills will not change."
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setDeleting(null)}>
              Keep product
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                if (!deleting) return
                const name = deleting.name
                const wasInDraft = inDraft(deleting)
                store.deleteProduct(deleting.id)
                setDeleting(null)
                notify(`${name} deleted.${wasInDraft ? ' The item on your open bill needs a new product.' : ''}`, 'info')
              }}
            >
              Delete
            </button>
          </>
        }
      >
        {deleting && inDraft(deleting) ? (
          <p className="dialog-copy">
            <Icon name="alert" size={15} /> This product is on the bill you are building. That line will need a new product before you can
            save.
          </p>
        ) : (
          <p className="dialog-copy">You can add it again later — aliases and prices are not kept after deletion.</p>
        )}
      </Dialog>
    </div>
  )
}
