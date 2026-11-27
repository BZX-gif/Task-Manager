/**
 * Measurement units: the words people speak, how they are displayed, and how
 * quantities convert between compatible units (500 gram of sugar is 0.5 kg).
 */
import type { Unit } from './types.ts'

export interface UnitInfo {
  unit: Unit
  /** Singular label used in lists: "1 kg", "2 packet". */
  label: string
  /** Long form for pickers and receipts. */
  name: string
  /** Words a shopkeeper may speak. Compared after text normalisation. */
  spoken: readonly string[]
  /** Same physical dimension — quantities convert freely inside a family. */
  family: 'mass' | 'volume' | 'count'
  /** How many base units one of this unit is worth inside its family. */
  factor: number
  /** Base unit of the family. */
  base: Unit
}

export const UNIT_INFO: Record<Unit, UnitInfo> = {
  kg: {
    unit: 'kg',
    label: 'kg',
    name: 'Kilogram',
    spoken: ['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms', 'kilogramme', 'kilogrammes', 'keji', 'kilo gram'],
    family: 'mass',
    factor: 1000,
    base: 'gram',
  },
  gram: {
    unit: 'gram',
    label: 'g',
    name: 'Gram',
    spoken: ['g', 'gm', 'gms', 'gram', 'grams', 'gramme', 'grammes', 'gr', 'gramm'],
    family: 'mass',
    factor: 1,
    base: 'gram',
  },
  litre: {
    unit: 'litre',
    label: 'L',
    name: 'Litre',
    spoken: ['l', 'lt', 'ltr', 'ltrs', 'litre', 'litres', 'liter', 'liters', 'lit', 'leter'],
    family: 'volume',
    factor: 1000,
    base: 'ml',
  },
  ml: {
    unit: 'ml',
    label: 'ml',
    name: 'Millilitre',
    spoken: ['ml', 'mls', 'millilitre', 'millilitres', 'milliliter', 'milliliters'],
    family: 'volume',
    factor: 1,
    base: 'ml',
  },
  piece: {
    unit: 'piece',
    label: 'pc',
    name: 'Piece',
    spoken: ['pc', 'pcs', 'piece', 'pieces', 'nos', 'nag', 'nugs', 'adan', 'adad', 'dana', 'dane', 'peez'],
    family: 'count',
    factor: 1,
    base: 'piece',
  },
  packet: {
    unit: 'packet',
    label: 'pkt',
    name: 'Packet',
    spoken: ['packet', 'packets', 'pkt', 'pkts', 'pack', 'packs', 'pouch', 'pouches', 'puria', 'pudiya', 'packit'],
    family: 'count',
    factor: 1,
    base: 'packet',
  },
  dozen: {
    unit: 'dozen',
    label: 'dozen',
    name: 'Dozen',
    spoken: ['dozen', 'dozens', 'darjan', 'darzan', 'dazan', 'dzz'],
    family: 'count',
    factor: 12,
    base: 'piece',
  },
}

/** Look-up of every spoken form → canonical unit. */
const SPOKEN_INDEX: Record<string, Unit> = (() => {
  const index: Record<string, Unit> = {}
  for (const info of Object.values(UNIT_INFO)) {
    index[info.unit] = info.unit
    for (const word of info.spoken) index[word] = info.unit
  }
  return index
})()

export function isUnit(value: unknown): value is Unit {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(UNIT_INFO, value)
}

/** Resolve a spoken word to a unit, or null. */
export function unitFromWord(word: string): Unit | null {
  const cleaned = word.trim().toLowerCase()
  if (!cleaned) return null
  return SPOKEN_INDEX[cleaned] ?? null
}

/** How a quantity is written in a list ("3 kg", "1 packet", "500 g"). */
export function formatQuantity(quantity: number, unit: Unit): string {
  const info = UNIT_INFO[unit]
  return `${formatNumber(quantity)} ${info.label}`
}

/** Compact number: 2, 2.5, 0.75 — never "2.00". */
export function formatNumber(value: number, maximumFractionDigits = 3): string {
  if (!Number.isFinite(value)) return '0'
  const rounded = Math.round(value * 1000) / 1000
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits }).format(rounded)
}

/**
 * Convert a quantity between units of the same family.
 * Returns null when the units are not compatible (kg ↔ packet).
 */
export function convertQuantity(quantity: number, from: Unit, to: Unit): number | null {
  if (from === to) return quantity
  const source = UNIT_INFO[from]
  const target = UNIT_INFO[to]
  if (source.family !== target.family) return null
  // dozen ↔ piece is a count conversion that is meaningful; the rest share a base.
  if (source.family === 'count' && source.base !== target.base) {
    return (quantity * source.factor) / target.factor
  }
  return (quantity * source.factor) / target.factor
}

/** Units that make sense to offer for a given product. */
export function compatibleUnits(unit: Unit): Unit[] {
  const family = UNIT_INFO[unit].family
  return (Object.keys(UNIT_INFO) as Unit[]).filter((candidate) => UNIT_INFO[candidate].family === family)
}
