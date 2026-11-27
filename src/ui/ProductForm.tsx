import { useEffect, useState, type FormEvent } from 'react'
import { UNITS, type Product, type Unit } from '../lib/types.ts'
import { UNIT_INFO } from '../lib/units.ts'
import { MAX_ALIASES, type ProductErrors } from '../lib/catalog.ts'
import { useStore } from '../state/react.tsx'
import { Dialog, Field } from './components.tsx'
import { useToast } from './toast.tsx'

export interface ProductFormInitial {
  name?: string
  price?: string
  unit?: Unit
  aliases?: string
}

export interface ProductFormProps {
  open: boolean
  onClose: () => void
  /** Pass a product to edit; omit to create. */
  product?: Product | null
  initial?: ProductFormInitial
  onSaved?: (product: Product) => void
  /** Shown above the form, e.g. "Creating from: chini". */
  context?: string
}

const emptyState = (initial?: ProductFormInitial) => ({
  name: initial?.name ?? '',
  price: initial?.price ?? '',
  unit: (initial?.unit ?? 'kg') as Unit,
  aliases: initial?.aliases ?? '',
})

/** Add or edit a catalogue product. All validation lives in lib/catalog.ts. */
export function ProductFormDialog({ open, onClose, product, initial, onSaved, context }: ProductFormProps) {
  const store = useStore()
  const notify = useToast()
  const [form, setForm] = useState(() => emptyState(initial))
  const [errors, setErrors] = useState<ProductErrors>({})

  useEffect(() => {
    if (!open) return
    setErrors({})
    setForm(
      product
        ? { name: product.name, price: String(product.price), unit: product.unit, aliases: product.aliases.join(', ') }
        : emptyState(initial),
    )
  }, [open, product?.id, initial?.name, initial?.price, initial?.unit, initial?.aliases])

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    if (errors[key as keyof ProductErrors]) setErrors((current) => ({ ...current, [key]: undefined }))
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const input = { name: form.name, price: form.price, unit: form.unit, aliases: form.aliases }
    const validation = store.validate(input, product?.id)
    if (!validation.ok) {
      setErrors(validation.errors)
      return
    }
    const result = product ? store.editProduct(product.id, input) : store.addProduct(input)
    if (!result.ok || !result.product) {
      setErrors(result.errors ?? {})
      notify('Please check the product details.', 'error')
      return
    }
    notify(product ? `${result.product.name} updated.` : `${result.product.name} added to your catalogue.`, 'success')
    onSaved?.(result.product)
    onClose()
  }

  const title = product ? 'Edit product' : 'Add product'

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={context ?? (product?.sample ? 'This is a sample product — change the price to match your shop.' : 'Price is per unit, e.g. ₹45 per kg.')}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="product-form" className="btn btn-primary">
            {product ? 'Save changes' : 'Add product'}
          </button>
        </>
      }
    >
      <form id="product-form" onSubmit={submit} noValidate className="form-stack">
        <Field label="Product name" htmlFor="product-name" error={errors.name}>
          <input
            id="product-name"
            className="input"
            value={form.name}
            onChange={(event) => set('name', event.target.value)}
            placeholder="e.g. Sugar"
            maxLength={60}
            autoComplete="off"
            aria-invalid={errors.name ? true : undefined}
          />
        </Field>

        <div className="form-row">
          <Field label="Price (₹)" htmlFor="product-price" error={errors.price} hint="Per unit, up to 2 decimals">
            <input
              id="product-price"
              className="input"
              value={form.price}
              onChange={(event) => set('price', event.target.value)}
              placeholder="45"
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={errors.price ? true : undefined}
            />
          </Field>
          <Field label="Unit" htmlFor="product-unit" error={errors.unit}>
            <select
              id="product-unit"
              className="input select"
              value={form.unit}
              onChange={(event) => set('unit', event.target.value as Unit)}
            >
              {UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {UNIT_INFO[unit].name} ({UNIT_INFO[unit].label})
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field
          label="Other names people use"
          htmlFor="product-aliases"
          error={errors.aliases}
          hint={`Comma separated, up to ${MAX_ALIASES}. These make voice matching work.`}
        >
          <input
            id="product-aliases"
            className="input"
            value={form.aliases}
            onChange={(event) => set('aliases', event.target.value)}
            placeholder="chini, cheeni, shakkar"
            autoComplete="off"
          />
        </Field>
      </form>
    </Dialog>
  )
}
