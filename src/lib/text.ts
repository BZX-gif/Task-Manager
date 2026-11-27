/**
 * Text normalisation for spoken Indian retail language.
 *
 * Speech engines deliver a messy mix of Devanagari, romanised Hindi ("Hinglish")
 * and English. This module is the single place that turns all of it into a
 * predictable lowercase Latin form the parser and matcher can reason about.
 */

/* ------------------------------------------------------------------ */
/* Devanagari → Latin                                                  */
/* ------------------------------------------------------------------ */

const CONSONANTS: Record<string, string> = {
  क: 'k', ख: 'kh', ग: 'g', घ: 'gh', ङ: 'n',
  च: 'ch', छ: 'chh', ज: 'j', झ: 'jh', ञ: 'n',
  ट: 't', ठ: 'th', ड: 'd', ढ: 'dh', ण: 'n',
  त: 't', थ: 'th', द: 'd', ध: 'dh', न: 'n',
  प: 'p', फ: 'ph', ब: 'b', भ: 'bh', म: 'm',
  य: 'y', र: 'r', ल: 'l', व: 'v', ळ: 'l',
  श: 'sh', ष: 'sh', स: 's', ह: 'h',
  क़: 'q', ख़: 'kh', ग़: 'g', ज़: 'z', ड़: 'r', ढ़: 'rh', फ़: 'f', य़: 'y',
}

const INDEPENDENT_VOWELS: Record<string, string> = {
  अ: 'a', आ: 'a', इ: 'i', ई: 'i', उ: 'u', ऊ: 'u', ऋ: 'ri',
  ए: 'e', ऐ: 'ai', ओ: 'o', औ: 'au', ऑ: 'o', ऍ: 'e', ॲ: 'a', ॐ: 'om',
}

const MATRAS: Record<string, string> = {
  'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'ृ': 'ri',
  'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॉ': 'o', 'ॅ': 'e',
  'ं': 'n', 'ँ': 'n', 'ः': 'h', 'ऽ': '',
}

const VIRAMA = '्'
const NUKTA = '़'

const DEVANAGARI_DIGITS: Record<string, string> = {
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
  '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
}

const hasDevanagari = (text: string) => /[\u0900-\u097F]/.test(text)

/**
 * Transliterate Devanagari to a compact Latin form: चीनी → chini, तेल → tel,
 * आटा → ata. It is lossy by design — good enough for matching, never shown.
 */
export function transliterateDevanagari(text: string): string {
  if (!hasDevanagari(text)) return text
  let out = ''
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const digit = DEVANAGARI_DIGITS[char]
    if (digit) {
      out += digit
      continue
    }
    const consonant = CONSONANTS[char]
    if (consonant) {
      out += consonant
      // A consonant carries an inherent "a" unless a virama or matra follows.
      const next = text[i + 1]
      if (next === NUKTA) {
        i += 1
        out += 'a'
        continue
      }
      if (next === VIRAMA) {
        i += 1
        continue
      }
      if (next && MATRAS[next] !== undefined) {
        out += MATRAS[next]
        i += 1
        continue
      }
      // Hindi words usually end on the consonant sound ("तीन" = teen, not teen-a).
      const atWordEnd = next === undefined || next === ' ' || /[\s.,!?;:()\-[\]{}"']/.test(next)
      if (!atWordEnd) out += 'a'
      continue
    }
    const vowel = INDEPENDENT_VOWELS[char]
    if (vowel) {
      out += vowel
      continue
    }
    if (char === VIRAMA || char === NUKTA) continue
    const matra = MATRAS[char]
    if (matra !== undefined) {
      out += matra
      continue
    }
    out += char
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

/** Words that carry no product meaning and are safe to ignore when matching. */
const CONNECTIVES = new Set(['ka', 'ki', 'ke', 'of', 'the', 'wala', 'wali', 'waala', 'waali', 'vala', 'vali', 'brand'])

/** Conversational filler that may sit at the edges of what someone said. */
export const FILLER_WORDS = new Set([
  'please', 'plz', 'pls', 'kripya', 'kripaya', 'mujhe', 'muje', 'chahiye', 'chahie', 'chaiye', 'chahye', 'chaihiye',
  'dena', 'dedo', 'de', 'dijiye', 'dijiyega', 'kardo', 'kar', 'karo', 'kijiyega', 'jaldi',
  'bhai', 'bhaiya', 'ji', 'sir', 'madam', 'sahab', 'saheb', 'add', 'also', 'then',
  'phir', 'uske', 'baad', 'sath', 'saath', 'liye', 'bill', 'bana', 'banao', 'banado',
  'ek', 'some', 'here', 'hai', 'ka', 'ki', 'ke', 'of', 'the', 'me', 'mein', 'ko',
  'total', 'amount',
])

/**
 * Lowercase, transliterate Devanagari, unify digits and strip punctuation.
 * Commas and plus signs become the word "aur" so "chini, aata" splits cleanly.
 */
export function normalizeText(input: string): string {
  if (!input) return ''
  let text = transliterateDevanagari(String(input))
  text = text
    .replace(/[०-९]/g, (d) => DEVANAGARI_DIGITS[d] ?? d)
    .replace(/[½]/g, ' 0.5 ')
    .replace(/[¼]/g, ' 0.25 ')
    .replace(/[¾]/g, ' 0.75 ')
    .toLowerCase()
    .replace(/[,;+&]/g, ' aur ')
    .replace(/[’'`"“”]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/-/g, ' ')
    // "1.5kg", "3kilo" → keep the number and unit apart
    .replace(/(\d)\s*(kg|kgs|gm|gms|ml|ltr|ltrs|kg)\b/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/[^a-z0-9.\s/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text
}

/** Split normalised text into word tokens, keeping decimals and fractions whole. */
export function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean)
}

/** Tokens that separate two products in one breath. */
export const SEPARATORS = new Set(['aur', 'and', 'or', 'plus', 'tatha', 'phir', 'then', 'uske', 'baad'])

/** True when the token is a separator between products. */
export function isSeparator(token: string): boolean {
  return SEPARATORS.has(token)
}

/** Remove leading and trailing filler words, keeping the middle untouched. */
export function trimFillers(tokens: string[]): string[] {
  let start = 0
  let end = tokens.length
  while (start < end && FILLER_WORDS.has(tokens[start])) start += 1
  while (end > start && FILLER_WORDS.has(tokens[end - 1])) end -= 1
  return tokens.slice(start, end)
}

/* ------------------------------------------------------------------ */
/* Spoken numbers                                                      */
/* ------------------------------------------------------------------ */

const NUMBER_WORDS: Record<string, number> = {
  // English
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, fourty: 40, forty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
  half: 0.5, quarter: 0.25, a: 1, an: 1, single: 1,
  // Hindi / Hinglish
  ek: 1, do: 2, teen: 3, tin: 3, char: 4, chaar: 4, panch: 5, paanch: 5,
  chhah: 6, chhe: 6, che: 6, chah: 6, saat: 7, sath: 7, aath: 8, ath: 8, nau: 9,
  das: 10, dus: 10, gyarah: 11, barah: 12, terah: 13, chaudah: 14, pandrah: 15,
  solah: 16, satrah: 17, atharah: 18, unnis: 19, bees: 20, bis: 20, pachees: 25,
  pachchis: 25, tees: 30, tis: 30, pachas: 40, pachchas: 40, pachpan: 55,
  sattar: 70, assi: 80, nabbe: 90, sau: 100,
  // Fractions and colloquial quantities
  adha: 0.5, aadha: 0.5, aadhi: 0.5, ardha: 0.5, dedh: 1.5, dedha: 1.5, derh: 1.5,
  dhai: 2.5, dhaai: 2.5, dhaii: 2.5, sawa: 1.25, sava: 1.25, savaa: 1.25,
  paun: 0.75, paav: 0.25, pao: 0.25,
  point: Number.NaN, dashamlav: Number.NaN, decimal: Number.NaN,
}

/** Words that mean "and a half" and must not be read as a whole number. */
const POINT_WORDS = new Set(['point', 'dashamlav', 'decimal'])

/** Parse one token as a spoken number, or return null. */
export function numberFromToken(token: string): number | null {
  const clean = token.trim().toLowerCase()
  if (!clean) return null
  // 1/2, 3/4
  const fraction = clean.match(/^(\d+)\/(\d+)$/)
  if (fraction) {
    const numerator = Number(fraction[1])
    const denominator = Number(fraction[2])
    if (denominator === 0) return null
    return numerator / denominator
  }
  if (/^\d+(\.\d+)?$/.test(clean)) {
    const value = Number(clean)
    return Number.isFinite(value) ? value : null
  }
  const word = NUMBER_WORDS[clean]
  if (word === undefined) return null
  return Number.isNaN(word) ? null : word
}

/** True when a token reads as a number (including decimals and fractions). */
export function isNumberToken(token: string): boolean {
  return numberFromToken(token) !== null || POINT_WORDS.has(token.toLowerCase())
}

export interface ReadNumber {
  value: number
  /** How many tokens were consumed. */
  length: number
}

/**
 * Read a spoken quantity starting at `start`.
 *
 * Handles digits, fractions, Hindi/English words, compounds ("twenty five",
 * "do sau") and decimals ("do point five").
 */
export function readNumber(tokens: readonly string[], start: number): ReadNumber | null {
  const first = tokens[start]
  if (first === undefined) return null
  const head = numberFromToken(first)
  if (head === null) return null
  let value = head
  let length = 1

  const isMultiplier = tokens[start + 1] === 'hundred' || tokens[start + 1] === 'sau'
  if (isMultiplier && Number.isInteger(value) && value > 0 && value < 100) {
    value *= 100
    length += 1
    return { value, length }
  }

  const next = tokens[start + length]
  const nextNumber = next === undefined ? null : numberFromToken(next)
  if (
    nextNumber !== null &&
    Number.isInteger(value) &&
    value >= 20 &&
    value % 10 === 0 &&
    Number.isInteger(nextNumber) &&
    nextNumber > 0 &&
    nextNumber < 10
  ) {
    return { value: value + nextNumber, length: length + 1 }
  }

  const pointWord = tokens[start + length]
  if (pointWord && POINT_WORDS.has(pointWord)) {
    const decimalToken = tokens[start + length + 1]
    const decimalValue = decimalToken ? numberFromToken(decimalToken) : null
    if (decimalValue !== null && Number.isInteger(decimalValue) && decimalValue >= 0 && decimalValue <= 999) {
      const digits = String(decimalValue)
      return { value: Number(`${Math.trunc(value)}.${digits}`), length: length + 2 }
    }
  }

  return { value, length }
}

/* ------------------------------------------------------------------ */
/* Product-name normalisation for matching                             */
/* ------------------------------------------------------------------ */

const singularize = (word: string): string => {
  if (word.length >= 5 && word.endsWith('es') && /(ch|sh|x|s)es$/.test(word)) return word.slice(0, -2)
  if (word.length >= 4 && word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us') && !word.endsWith('is')) {
    return word.slice(0, -1)
  }
  return word
}

/** Tokens of a product name with connectives removed and plurals folded. */
export function matchTokens(input: string): string[] {
  return normalizeText(input)
    .split(' ')
    .map((token) => token.replace(/^[.]|[.]$/g, ''))
    .filter((token) => token.length > 0 && !CONNECTIVES.has(token))
    .map(singularize)
    .filter(Boolean)
}

/** A stable key for exact lookups: "Gehu ka Aata" → "gehu ata". */
export function normalizeForMatch(input: string): string {
  return matchTokens(input).join(' ').trim()
}

/** Levenshtein distance, bounded for long strings. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let previous = new Array<number>(b.length + 1)
  let current = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j += 1) previous[j] = j
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
    }
    const swap = previous
    previous = current
    current = swap
  }
  return previous[b.length]
}

/** 0–1 similarity between two strings. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const distance = levenshtein(a, b)
  return 1 - distance / Math.max(a.length, b.length)
}
