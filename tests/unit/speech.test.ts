import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createRecognizer,
  describeSpeechError,
  speechSupport,
  type SpeechEnvironment,
  type SpeechErrorEvent,
  type SpeechRecognitionConstructor,
  type SpeechRecognitionInstance,
  type SpeechResultEvent,
} from '../../src/lib/speech.ts'

class FakeRecognition implements SpeechRecognitionInstance {
  lang = ''
  continuous = false
  interimResults = false
  maxAlternatives = 0
  onresult: ((event: SpeechResultEvent) => void) | null = null
  onerror: ((event: SpeechErrorEvent) => void) | null = null
  onend: (() => void) | null = null
  onstart: (() => void) | null = null
  starts = 0
  stops = 0
  aborts = 0
  failOnStart = false

  start(): void {
    if (this.failOnStart) throw new Error('already started')
    this.starts += 1
    this.onstart?.()
  }
  stop(): void {
    this.stops += 1
    this.onend?.()
  }
  abort(): void {
    this.aborts += 1
    this.onend?.()
  }

  private results: { isFinal: boolean; text: string }[] = []

  emit(text: string, isFinal: boolean): void {
    this.results.push({ isFinal, text })
    const list = this.results.map((entry) => ({
      isFinal: entry.isFinal,
      length: 1,
      0: { transcript: entry.text, confidence: 0.9 },
    })) as unknown as SpeechResultEvent['results']
    this.onresult?.({ resultIndex: Math.max(0, this.results.length - 1), results: list })
  }

  error(code: string): void {
    this.onerror?.({ error: code })
  }
}

interface Harness {
  env: SpeechEnvironment
  recognition: FakeRecognition
  finals: string[]
  interims: string[]
  failures: string[]
  states: string[]
  endCalls: number[]
  recognizer: ReturnType<typeof createRecognizer>
}

function harness(): Harness {
  const recognition = new FakeRecognition()
  const Constructor = function FakeConstructor() {
    return recognition
  } as unknown as SpeechRecognitionConstructor
  const finals: string[] = []
  const interims: string[] = []
  const failures: string[] = []
  const states: string[] = []
  const endCalls: number[] = []
  const recognizer = createRecognizer({
    env: { SpeechRecognition: Constructor, isSecureContext: true },
    lang: 'hi-IN',
    onFinal: (text) => finals.push(text),
    onInterim: (text) => interims.push(text),
    onError: (failure) => failures.push(failure.code),
    onStateChange: (state) => {
      states.push(state)
    },
    onEnd: () => {
      endCalls.push(1)
    },
  })
  return { env: {}, recognition, finals, interims, failures, states, endCalls, recognizer }
}

test('browsers without speech support are detected up front', () => {
  assert.equal(speechSupport({}).supported, false)
  assert.equal(speechSupport({}).reason, 'unsupported')
  assert.equal(createRecognizer({ env: {}, lang: 'hi-IN', onFinal: () => {} }), null)
  assert.equal(speechSupport({ SpeechRecognition: FakeRecognition as unknown as SpeechRecognitionConstructor }).supported, true)
  assert.equal(
    speechSupport({ SpeechRecognition: FakeRecognition as unknown as SpeechRecognitionConstructor, isSecureContext: false }).reason,
    'insecure',
  )
})

test('the recogniser requests continuous final results in the chosen language', () => {
  const h = harness()
  assert.ok(h.recognizer)
  h.recognizer!.setLanguage('en-IN')
  assert.equal(h.recognizer!.start(), true)
  assert.equal(h.recognition.lang, 'en-IN')
  assert.equal(h.recognition.continuous, true)
  assert.equal(h.recognition.interimResults, true)
  assert.deepEqual(h.states, ['starting', 'listening'])
})

test('interim text is shown but never billed', () => {
  const h = harness()
  h.recognizer!.start()
  h.recognition.emit('3 kilo', false)
  assert.deepEqual(h.finals, [])
  assert.deepEqual(h.interims, ['3 kilo'])
  h.recognition.emit('3 kilo chini', true)
  assert.deepEqual(h.finals, ['3 kilo chini'])
})

test('repeated recognition events do not duplicate a phrase', () => {
  const h = harness()
  h.recognizer!.start()
  h.recognition.emit('2 kilo aata', true)
  // The browser re-emits the same result: same index, same text.
  const list = [{ isFinal: true, length: 1, 0: { transcript: '2 kilo aata', confidence: 0.9 } }] as unknown as SpeechResultEvent['results']
  h.recognition.onresult?.({ resultIndex: 0, results: list })
  assert.deepEqual(h.finals, ['2 kilo aata'])
})

test('multiple final results in one event are all delivered', () => {
  const h = harness()
  h.recognizer!.start()
  const results = [
    { isFinal: true, length: 1, 0: { transcript: '1 kilo chini', confidence: 1 } },
    { isFinal: true, length: 1, 0: { transcript: '2 kilo aata', confidence: 1 } },
    { isFinal: false, length: 1, 0: { transcript: 'aur', confidence: 1 } },
  ] as unknown as SpeechResultEvent['results']
  h.recognition.onresult?.({ resultIndex: 0, results })
  assert.deepEqual(h.finals, ['1 kilo chini', '2 kilo aata'])
})

test('permission and hardware errors become actionable messages', () => {
  assert.equal(describeSpeechError('not-allowed').code, 'permission')
  assert.equal(describeSpeechError('not-allowed').recoverable, false)
  assert.match(describeSpeechError('not-allowed').message, /permission/i)
  assert.equal(describeSpeechError('audio-capture').code, 'audio')
  assert.match(describeSpeechError('audio-capture').message, /microphone/i)
  assert.equal(describeSpeechError('no-speech').code, 'no-speech')
  assert.match(describeSpeechError('no-speech').message, /didn.t hear/i)
  assert.equal(describeSpeechError('network').recoverable, true)
  assert.equal(describeSpeechError('language-not-supported').code, 'language')
  assert.equal(describeSpeechError('something-new').code, 'unknown')
})

test('a microphone permission denial stops listening and reports once', () => {
  const h = harness()
  h.recognizer!.start()
  h.recognition.error('not-allowed')
  assert.deepEqual(h.failures, ['permission'])
  assert.equal(h.recognizer!.state(), 'idle')
})

test('stopping ends the session and allows a fresh one', () => {
  const h = harness()
  h.recognizer!.start()
  h.recognizer!.stop()
  assert.equal(h.recognizer!.state(), 'idle')
  assert.equal(h.recognition.stops, 1)
  assert.equal(h.endCalls.length, 1)
  assert.equal(h.recognizer!.start(), true)
  assert.equal(h.recognition.starts, 2)
})

test('a recogniser that refuses to start is reported, not thrown', () => {
  const h = harness()
  h.recognition.failOnStart = true
  assert.equal(h.recognizer!.start(), false)
  assert.deepEqual(h.failures, ['unknown'])
  assert.equal(h.recognizer!.state(), 'idle')
})

test('starting twice while listening does nothing', () => {
  const h = harness()
  assert.equal(h.recognizer!.start(), true)
  assert.equal(h.recognizer!.start(), false)
  assert.equal(h.recognition.starts, 1)
})
