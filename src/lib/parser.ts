/**
 * Speech → structured items.
 *
 * Input is one final speech-recognition transcript such as
 *   "3 kilo chini, 2 kilo aata aur teen litre soybean tel"
 * Output is a list of { name, quantity, unit } candidates. Matching those names
 * against the catalogue is a separate concern (see matcher.ts) so parsing can be
 * tested on its own.
 *
 * Ordering is handled with one heuristic: if the clause starts with the product
 * ("chini 3 kilo") the products come before their quantities; if it starts with
 * a number ("3 kilo chini") products follow their quantities. Both are common
 * in real speech, and mixed phrasing inside one clause is rare enough that the
 * correction workflow covers it.
 */
import type { ParsedItem, Unit } from './types.ts'
import { isSeparator, normalizeText, readNumber, trimFillers } from './text.ts'
import { unitFromWord } from './units.ts'

/** Connectives allowed between a quantity and a unit ("2 packet of biscuits"). */
const UNIT_LINKS = new Set(['of', 'ka', 'ki', 'ke'])

interface Group {
  /** Index of the first number token. */
  start: number
  /** Index just after the last consumed token (number + optional unit). */
  end: number
  quantity: number
  unit: Unit | null
}

export interface ParseOutcome {
  items: ParsedItem[]
  /** Things that were heard but could not be turned into an item. */
  issues: string[]
}

/** Split a token stream on spoken separators ("aur", "and", "plus"). */
export function splitSegments(tokens: readonly string[]): string[][] {
  const segments: string[][] = []
  let current: string[] = []
  for (const token of tokens) {
    if (isSeparator(token)) {
      if (current.length) segments.push(current)
      current = []
      continue
    }
    current.push(token)
  }
  if (current.length) segments.push(current)
  return segments
}

/** Find every quantity group in a token list. */
function findGroups(tokens: readonly string[]): Group[] {
  const groups: Group[] = []
  let index = 0
  while (index < tokens.length) {
    const read = readNumber(tokens, index)
    if (!read) {
      index += 1
      continue
    }
    let cursor = index + read.length
    let unit: Unit | null = null
    if (cursor < tokens.length) {
      const direct = unitFromWord(tokens[cursor])
      if (direct) {
        unit = direct
        cursor += 1
      } else if (UNIT_LINKS.has(tokens[cursor]) && cursor + 1 < tokens.length) {
        const linked = unitFromWord(tokens[cursor + 1])
        if (linked) {
          unit = linked
          cursor += 2
        }
      }
    }
    groups.push({ start: index, end: cursor, quantity: read.value, unit })
    index = cursor
  }
  return groups
}

function warningForQuantity(quantity: number): string | null {
  if (!Number.isFinite(quantity) || quantity <= 0) return 'Quantity must be more than zero'
  if (quantity > 1000) return 'This quantity looks very large — please check it'
  const scaled = quantity * 1000
  if (Math.abs(scaled - Math.round(scaled)) > 1e-6) return 'Too many decimal places — please check the quantity'
  return null
}

/** Turn one clause into items. A clause may hold several quantity groups. */
function parseClause(tokens: readonly string[], raw: string): ParseOutcome {
  const groups = findGroups(tokens)

  if (groups.length === 0) {
    // No numbers: a bare product ("maggi") or a product with a unit ("chini kilo").
    const unitIndex = tokens.findIndex((token) => unitFromWord(token) !== null)
    const unit = unitIndex >= 0 ? unitFromWord(tokens[unitIndex]) : null
    const nameTokens = unitIndex >= 0 ? tokens.filter((_, i) => i !== unitIndex) : [...tokens]
    const name = trimFillers(nameTokens).join(' ').trim()
    if (!name) return { items: [], issues: [] }
    return {
      items: [{ raw, name, quantity: null, unit, hasQuantity: false, warnings: [] }],
      issues: [],
    }
  }

  const prefixStyle = trimFillers(tokens.slice(0, groups[0].start)).length > 0
  const items: ParsedItem[] = []
  const issues: string[] = []

  for (let g = 0; g < groups.length; g += 1) {
    const group = groups[g]
    let productStart: number
    let productEnd: number
    if (prefixStyle) {
      productStart = g === 0 ? 0 : groups[g - 1].end
      productEnd = group.start
    } else {
      productStart = group.end
      productEnd = groups[g + 1] ? groups[g + 1].start : tokens.length
    }

    const name = trimFillers(tokens.slice(productStart, productEnd)).join(' ').trim()
    if (!name) {
      issues.push(`Could not find a product name for ${formatSpokenQuantity(group)}`)
      continue
    }

    const warnings: string[] = []
    const warning = warningForQuantity(group.quantity)
    if (warning) warnings.push(warning)

    items.push({
      raw: [...tokens.slice(productStart, productEnd), ...tokens.slice(group.start, group.end)]
        .join(' ')
        .trim(),
      name,
      quantity: group.quantity,
      unit: group.unit,
      hasQuantity: true,
      warnings,
    })
  }

  void raw
  return { items, issues }
}

function formatSpokenQuantity(group: Group): string {
  return group.unit ? `${group.quantity} ${group.unit}` : String(group.quantity)
}

/** Parse a transcript into items plus any "heard but not understood" notes. */
export function parseUtteranceDetailed(input: string): ParseOutcome {
  const normalized = normalizeText(input)
  if (!normalized) return { items: [], issues: [] }
  const tokens = normalized.split(' ').filter((token) => /[a-z0-9]/.test(token))
  const items: ParsedItem[] = []
  const issues: string[] = []
  for (const segment of splitSegments(tokens)) {
    const clause = segment.join(' ').trim()
    if (!clause) continue
    const outcome = parseClause(segment, clause)
    items.push(...outcome.items)
    issues.push(...outcome.issues)
  }
  // Two identically parsed lines in one breath are the same request.
  const merged: ParsedItem[] = []
  for (const item of items) {
    const duplicate = merged.find(
      (candidate) =>
        candidate.name === item.name && candidate.unit === item.unit && candidate.hasQuantity && item.hasQuantity,
    )
    if (duplicate) {
      duplicate.quantity = (duplicate.quantity ?? 0) + (item.quantity ?? 0)
      continue
    }
    merged.push(item)
  }
  return { items: merged, issues }
}

/**
 * Parse a transcript into items. Never throws; returns [] when nothing usable
 * was said (the caller shows a "didn't catch that" message).
 */
export function parseUtterance(input: string): ParsedItem[] {
  return parseUtteranceDetailed(input).items
}
