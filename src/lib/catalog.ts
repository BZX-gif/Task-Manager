/**
 * The product catalogue: validation, create / edit / delete, and the optional
 * sample set offered during first-time setup.
 *
 * These functions are pure — they take a list and return a new list — which
 * keeps them easy to test and lets the store decide when to persist.
 */
import type { Product, Unit } from './types.ts'
import { isUnit } from './units.ts'
import { normalizeForMatch } from './text.ts'
import { round2 } from './money.ts'

export const MAX_PRICE = 1_000_000
export const MAX_ALIASES = 10

export interface ProductInput {
  name: string
  price: string | number
  unit: string
  /** Comma separated text or an array. */
  aliases: string | string[]
}

export interface ProductErrors {
  name?: string
  price?: string
  unit?: string
  aliases?: string
}

export interface ValidationResult {
  ok: boolean
  errors: ProductErrors
  value?: { name: string; price: number; unit: Unit; aliases: string[] }
}

/** Split alias input ("chini, shakkar , cheeni") into clean, unique names. */
export function parseAliases(input: string | string[]): string[] {
  const raw = Array.isArray(input) ? input : input.split(',')
  const seen = new Set<string>()
  const aliases: string[] = []
  for (const entry of raw) {
    const alias = String(entry ?? '').trim().replace(/\s+/g, ' ')
    if (!alias) continue
    const key = normalizeForMatch(alias)
    if (!key || seen.has(key)) continue
    seen.add(key)
    aliases.push(alias)
  }
  return aliases
}

/** Parse "₹45.50" / "45,5" / 45 into a number, or null. */
export function parsePrice(input: string | number): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null
  const cleaned = String(input ?? '')
    .replace(/[₹$€£\s,]/g, '')
    .replace(/\/-$/, '')
    .trim()
  if (!cleaned) return null
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

/** Validate a product form submission against the existing catalogue. */
export function validateProduct(
  input: ProductInput,
  products: readonly Product[],
  options: { ignoreId?: string } = {},
): ValidationResult {
  const errors: ProductErrors = {}
  const name = String(input.name ?? '').trim().replace(/\s+/g, ' ')

  if (!name) errors.name = 'Enter a product name'
  else if (name.length > 60) errors.name = 'Keep the name under 60 characters'

  const duplicate = products.find(
    (product) => product.id !== options.ignoreId && normalizeForMatch(product.name) === normalizeForMatch(name),
  )
  if (!errors.name && duplicate) errors.name = `"${duplicate.name}" already exists in your catalogue`

  const price = parsePrice(input.price)
  if (price === null) errors.price = 'Enter a price like 45 or 45.50'
  else if (price <= 0) errors.price = 'Price must be more than zero'
  else if (price > MAX_PRICE) errors.price = 'That price looks too high'

  const unit = String(input.unit ?? '').trim().toLowerCase()
  if (!isUnit(unit)) errors.unit = 'Choose a unit'

  let aliases = parseAliases(input.aliases)
  if (aliases.length > MAX_ALIASES) {
    errors.aliases = `Use up to ${MAX_ALIASES} other names`
    aliases = aliases.slice(0, MAX_ALIASES)
  }
  const tooLong = aliases.find((alias) => alias.length > 40)
  if (tooLong) errors.aliases = 'Keep each other name under 40 characters'

  const ok = Object.keys(errors).length === 0
  if (!ok) return { ok, errors }
  return {
    ok,
    errors,
    value: {
      name,
      price: round2(price as number),
      unit: unit as Unit,
      aliases: aliases.filter((alias) => normalizeForMatch(alias) !== normalizeForMatch(name)),
    },
  }
}

export interface ProductResult {
  ok: boolean
  products: Product[]
  product?: Product
  errors?: ProductErrors
}

/** Add a validated product to the catalogue. */
export function addProduct(
  products: readonly Product[],
  input: ProductInput,
  meta: { id: string; now: number },
): ProductResult {
  const validation = validateProduct(input, products)
  if (!validation.ok || !validation.value) {
    return { ok: false, products: [...products], errors: validation.errors }
  }
  const product: Product = {
    id: meta.id,
    name: validation.value.name,
    price: validation.value.price,
    unit: validation.value.unit,
    aliases: validation.value.aliases,
    createdAt: meta.now,
    updatedAt: meta.now,
  }
  return { ok: true, products: [...products, product], product }
}

/** Edit a product in place (keeping its id and creation date). */
export function updateProduct(
  products: readonly Product[],
  id: string,
  input: ProductInput,
  meta: { now: number },
): ProductResult {
  const existing = products.find((product) => product.id === id)
  if (!existing) return { ok: false, products: [...products], errors: { name: 'Product not found' } }
  const validation = validateProduct(input, products, { ignoreId: id })
  if (!validation.ok || !validation.value) {
    return { ok: false, products: [...products], errors: validation.errors }
  }
  const product: Product = {
    ...existing,
    name: validation.value.name,
    price: validation.value.price,
    unit: validation.value.unit,
    aliases: validation.value.aliases,
    updatedAt: meta.now,
    sample: existing.sample,
  }
  return {
    ok: true,
    products: products.map((candidate) => (candidate.id === id ? product : candidate)),
    product,
  }
}

/** Remove a product by id. */
export function removeProduct(products: readonly Product[], id: string): Product[] {
  return products.filter((product) => product.id !== id)
}

/** Remove every product that came from the sample set. */
export function removeSampleProducts(products: readonly Product[]): Product[] {
  return products.filter((product) => !product.sample)
}

interface SampleSpec {
  name: string
  price: number
  unit: Unit
  aliases: string[]
}

/**
 * Optional starter catalogue, clearly marked as sample data. It is only ever
 * added when the shopkeeper explicitly asks for it during setup.
 */
export const SAMPLE_CATALOGUE: readonly SampleSpec[] = [
  { name: 'Sugar', price: 45, unit: 'kg', aliases: ['chini', 'cheeni', 'shakkar', 'sugar'] },
  { name: 'Wheat Flour (Aata)', price: 40, unit: 'kg', aliases: ['aata', 'atta', 'gehu ka aata', 'wheat flour'] },
  { name: 'Rice', price: 55, unit: 'kg', aliases: ['chawal', 'rice', 'basmati'] },
  { name: 'Toor Dal', price: 145, unit: 'kg', aliases: ['dal', 'daal', 'toor dal', 'arhar dal'] },
  { name: 'Soybean Oil', price: 130, unit: 'litre', aliases: ['tel', 'oil', 'refined oil', 'soyabean tel', 'soya tel'] },
  { name: 'Mustard Oil', price: 155, unit: 'litre', aliases: ['sarson ka tel', 'sarson tel', 'sarason ka tel', 'mustard oil', 'mustard tel'] },
  { name: 'Maggi Noodles', price: 14, unit: 'packet', aliases: ['maggi', 'noodles', 'maggi masala'] },
  { name: 'Parle-G Biscuits', price: 10, unit: 'packet', aliases: ['biscuit', 'biscuits', 'parle g', 'parle'] },
  { name: 'Tata Salt', price: 28, unit: 'kg', aliases: ['namak', 'salt', 'tata namak'] },
]

/** Build product records for the sample catalogue. */
export function buildSampleProducts(meta: { now: number; nextId: () => string }): Product[] {
  return SAMPLE_CATALOGUE.map((spec) => ({
    id: meta.nextId(),
    name: spec.name,
    price: spec.price,
    unit: spec.unit,
    aliases: [...spec.aliases],
    createdAt: meta.now,
    updatedAt: meta.now,
    sample: true,
  }))
}
