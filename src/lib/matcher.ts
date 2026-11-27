/**
 * Spoken product name → catalogue product.
 *
 * Scoring is intentionally conservative: a wrong product with the right price is
 * worse than showing a correction step. Anything below `AUTO_MATCH_MIN`, or a
 * near-tie between two products, comes back unmatched with suggestions.
 */
import type { MatchCandidate, MatchResult, Product } from './types.ts'
import { matchTokens, normalizeForMatch, similarity } from './text.ts'

/** Best score must reach this before a product is selected automatically. */
export const AUTO_MATCH_MIN = 0.75
/** If the runner-up is this close, ask instead of guessing. */
export const AMBIGUITY_MARGIN = 0.08
/** Candidates below this are not worth showing as suggestions. */
export const SUGGEST_MIN = 0.45

interface Key {
  text: string
  tokens: string[]
  kind: 'name' | 'alias'
  label: string
}

function keysOf(product: Product): Key[] {
  const keys: Key[] = [
    {
      text: normalizeForMatch(product.name),
      tokens: matchTokens(product.name),
      kind: 'name',
      label: product.name,
    },
  ]
  for (const alias of product.aliases) {
    const text = normalizeForMatch(alias)
    if (!text) continue
    keys.push({ text, tokens: matchTokens(alias), kind: 'alias', label: alias })
  }
  return keys
}

/** Score one normalised spoken name against one product key. */
function scoreKey(query: string, queryTokens: string[], target: string): number {
  if (!query || !target) return 0
  if (query === target) return 1

  const targetTokens = target.split(' ').filter(Boolean)
  const querySet = new Set(queryTokens)
  const targetSet = new Set(targetTokens)

  // Every spoken word appears in the product name…
  const queryCovered = queryTokens.every((token) => targetSet.has(token))
  // …or every word of the product name appears in the sentence. Extra spoken
  // words are a warning sign: "chana dal" must not become a "dal" product.
  const targetCovered = targetTokens.every((token) => querySet.has(token))
  if (queryCovered && targetCovered) return 0.95
  if (queryCovered) return 0.85
  if (targetCovered) return 0.6

  // A whole phrase sitting inside the other one ("chini" in "chini sugar").
  if (query.length >= 3 && target.includes(query)) return 0.8
  if (target.length >= 3 && query.includes(target)) return 0.78

  // Typo tolerance: cheeni ≈ chini, maida ≈ meda.
  const sim = similarity(query, target)
  if (sim >= 0.9) return 0.82
  if (sim >= 0.82) return 0.74
  if (sim >= 0.72) return 0.62

  // Partial word overlap for longer phrases ("sarson tel" vs "mustard sarson oil").
  if (queryTokens.length > 1 || targetTokens.length > 1) {
    const shared = queryTokens.filter((token) => targetSet.has(token)).length
    if (shared > 0) return Math.min(0.7, (shared / Math.max(queryTokens.length, targetTokens.length)) * 0.9)
  }
  return 0
}

/** Rank the catalogue for a spoken product name. */
export function rankProducts(spoken: string, products: readonly Product[]): MatchCandidate[] {
  const query = normalizeForMatch(spoken)
  if (!query) return []
  const queryTokens = matchTokens(spoken)
  const scored: MatchCandidate[] = []

  for (const product of products) {
    let best = 0
    let matchedOn = product.name
    for (const key of keysOf(product)) {
      const score = scoreKey(query, queryTokens, key.text)
      if (score > best) {
        best = score
        matchedOn = key.label
      }
    }
    if (best > 0) scored.push({ product, score: Math.round(best * 100) / 100, matchedOn })
  }

  return scored
    .sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name))
    .slice(0, 6)
}

/** Match one spoken name, applying the confidence and ambiguity rules. */
export function matchProduct(spoken: string, products: readonly Product[]): MatchResult {
  const ranked = rankProducts(spoken, products)
  const best = ranked[0]
  if (!best || best.score < AUTO_MATCH_MIN) {
    return { product: null, confidence: best?.score ?? 0, candidates: ranked, reason: 'none' }
  }
  const runnerUp = ranked[1]
  const tie = runnerUp !== undefined && best.score === 1 && runnerUp.score === 1
  const fuzzyTie = runnerUp !== undefined && best.score < 1 && best.score - runnerUp.score < AMBIGUITY_MARGIN
  if (tie || fuzzyTie) {
    return { product: null, confidence: best.score, candidates: ranked, reason: 'ambiguous' }
  }
  const exact = normalizeForMatch(best.matchedOn) === normalizeForMatch(spoken)
  return {
    product: best.product,
    confidence: best.score,
    candidates: ranked,
    reason: exact ? (best.matchedOn === best.product.name ? 'exact' : 'alias') : 'fuzzy',
  }
}
