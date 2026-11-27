import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeText,
  numberFromToken,
  readNumber,
  similarity,
  transliterateDevanagari,
  matchTokens,
  normalizeForMatch,
} from '../../src/lib/text.ts'

test('Devanagari is transliterated into matchable Latin', () => {
  assert.equal(transliterateDevanagari('चीनी'), 'chini')
  assert.equal(transliterateDevanagari('तेल'), 'tel')
  assert.equal(transliterateDevanagari('नमक'), 'namak')
  assert.equal(transliterateDevanagari('आटा'), 'ata')
  assert.equal(transliterateDevanagari('दूध'), 'dudh')
  assert.equal(transliterateDevanagari('सरसों का तेल'), 'sarason ka tel') // schwa deletion is a matching concern, not a spelling one
  assert.equal(transliterateDevanagari('तीन किलो चीनी'), 'tin kilo chini')
})

test('normalisation lowercases, digitises and strips punctuation', () => {
  assert.equal(normalizeText('  3 KILO Chini!! '), '3 kilo chini')
  assert.equal(normalizeText('२ किलो चीनी'), '2 kilo chini')
  assert.equal(normalizeText('3kg sugar'), '3 kg sugar')
  assert.equal(normalizeText('chini, aata'), 'chini aur aata')
  assert.equal(normalizeText('1.5 litre oil'), '1.5 litre oil')
})

test('spoken numbers in Hindi and English', () => {
  assert.equal(numberFromToken('teen'), 3)
  assert.equal(numberFromToken('paanch'), 5)
  assert.equal(numberFromToken('do'), 2)
  assert.equal(numberFromToken('seven'), 7)
  assert.equal(numberFromToken('aadha'), 0.5)
  assert.equal(numberFromToken('dedh'), 1.5)
  assert.equal(numberFromToken('3.5'), 3.5)
  assert.equal(numberFromToken('1/2'), 0.5)
  assert.equal(numberFromToken('sabun'), null)
})

test('compound and decimal quantities are read together', () => {
  assert.deepEqual(readNumber(['twenty', 'five', 'kilo'], 0), { value: 25, length: 2 })
  assert.deepEqual(readNumber(['do', 'point', 'five', 'kilo'], 0), { value: 2.5, length: 3 })
  assert.deepEqual(readNumber(['do', 'sau', 'gram'], 0), { value: 200, length: 2 })
  assert.deepEqual(readNumber(['teen', 'litre'], 0), { value: 3, length: 1 })
  assert.equal(readNumber(['chini'], 0), null)
})

test('product matching keys fold connectives and plurals', () => {
  assert.equal(normalizeForMatch('Gehu ka Aata'), 'gehu aata')
  assert.equal(normalizeForMatch('Packets of biscuits'), 'packet biscuit')
  assert.equal(normalizeForMatch('Sarson ka tel'), 'sarson tel')
  assert.deepEqual(matchTokens('Mustard Oil'), ['mustard', 'oil'])
})

test('spelling distance is measured, not assumed', () => {
  assert.equal(similarity('chini', 'chini'), 1)
  assert.ok(similarity('chini', 'cheeni') > 0.6)
  assert.ok(similarity('chini', 'chana dal') < 0.4)
})
