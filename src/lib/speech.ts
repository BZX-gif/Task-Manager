/**
 * Browser speech recognition, wrapped in something predictable.
 *
 * The Web Speech API is not standard: Chrome/Edge implement it, Firefox does not,
 * Safari needs prefixes. This wrapper:
 *   • feature-detects and explains what is missing,
 *   • reports only final results (interim text is display-only) so a phrase is
 *     never billed twice,
 *   • de-duplicates repeated result events by result index,
 *   • turns browser error codes into messages a shopkeeper can act on,
 *   • never touches the bill — the caller decides what to do with text.
 */
import type { Language } from './types.ts'

export interface SpeechAlternative {
  transcript: string
  confidence: number
}

export interface SpeechResult {
  readonly length: number
  readonly isFinal: boolean
  [index: number]: SpeechAlternative
}

export interface SpeechResultList {
  readonly length: number
  [index: number]: SpeechResult
}

export interface SpeechResultEvent {
  resultIndex: number
  results: SpeechResultList
}

export interface SpeechErrorEvent {
  error: string
  message?: string
}

export interface SpeechRecognitionInstance {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechResultEvent) => void) | null
  onerror: ((event: SpeechErrorEvent) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}

export type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance

export interface SpeechEnvironment {
  SpeechRecognition?: SpeechRecognitionConstructor
  webkitSpeechRecognition?: SpeechRecognitionConstructor
  isSecureContext?: boolean
}

export function getSpeechConstructor(env: SpeechEnvironment | undefined): SpeechRecognitionConstructor | null {
  if (!env) return null
  return env.SpeechRecognition ?? env.webkitSpeechRecognition ?? null
}

export type SpeechSupportReason = 'supported' | 'unsupported' | 'insecure'

/** Why speech is unavailable, so the UI can say something useful. */
export function speechSupport(env: SpeechEnvironment | undefined): {
  supported: boolean
  reason: SpeechSupportReason
} {
  const constructor = getSpeechConstructor(env)
  if (!constructor) return { supported: false, reason: 'unsupported' }
  if (env?.isSecureContext === false) return { supported: false, reason: 'insecure' }
  return { supported: true, reason: 'supported' }
}

export type SpeechErrorCode =
  | 'permission'
  | 'no-speech'
  | 'audio'
  | 'network'
  | 'language'
  | 'busy'
  | 'unsupported'
  | 'unknown'

export interface SpeechFailure {
  code: SpeechErrorCode
  message: string
  /** False when retrying cannot help (permission denied, unsupported language). */
  recoverable: boolean
}

export function describeSpeechError(code: string): SpeechFailure {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return {
        code: 'permission',
        message: 'Microphone permission is blocked. Allow the mic in your browser settings, or add items by hand.',
        recoverable: false,
      }
    case 'no-speech':
      return {
        code: 'no-speech',
        message: "I didn't hear anything. Tap the mic and speak a little closer.",
        recoverable: true,
      }
    case 'audio-capture':
      return {
        code: 'audio',
        message: 'No microphone was found. You can still add items by hand.',
        recoverable: false,
      }
    case 'network':
      return {
        code: 'network',
        message: 'Speech recognition needs a connection in this browser. Your bill is safe — try again, or add items by hand.',
        recoverable: true,
      }
    case 'language-not-supported':
      return {
        code: 'language',
        message: 'This language is not available in your browser. Try the other language, or add items by hand.',
        recoverable: false,
      }
    case 'aborted':
      return { code: 'unknown', message: 'Listening stopped.', recoverable: true }
    case 'not-supported':
      return {
        code: 'unsupported',
        message: 'This browser does not support voice input. Add items by hand below.',
        recoverable: false,
      }
    default:
      return {
        code: 'unknown',
        message: 'Voice input could not start. Your bill is safe — try again, or add items by hand.',
        recoverable: true,
      }
  }
}

export type RecognitionState = 'idle' | 'starting' | 'listening'

export interface RecognizerOptions {
  env?: SpeechEnvironment
  lang: Language
  onFinal(text: string): void
  onInterim?(text: string): void
  onError?(failure: SpeechFailure): void
  onStateChange?(state: RecognitionState): void | undefined
  onEnd?(): void
}

export interface Recognizer {
  start(): boolean
  stop(): void
  abort(): void
  dispose(): void
  setLanguage(lang: Language): void
  state(): RecognitionState
}

const isBlank = (text: string) => !text || !text.trim()

/**
 * Create a recogniser, or null when the browser cannot do speech recognition.
 * Callers must keep the manual-entry path available either way.
 */
export function createRecognizer(options: RecognizerOptions): Recognizer | null {
  const Constructor = getSpeechConstructor(options.env)
  if (!Constructor) return null

  let recognition: SpeechRecognitionInstance | null = null
  let state: RecognitionState = 'idle'
  let lang = options.lang
  let stopRequested = false
  /** Result indices already delivered as final text in this session. */
  let delivered = new Set<number>()

  const setState = (next: RecognitionState) => {
    state = next
    options.onStateChange?.(next)
  }

  const ensure = (): SpeechRecognitionInstance => {
    if (recognition) return recognition
    const instance = new Constructor()
    instance.lang = lang
    instance.continuous = true
    instance.interimResults = true
    instance.maxAlternatives = 1

    instance.onstart = () => {
      if (stopRequested) return
      setState('listening')
    }

    instance.onresult = (event) => {
      let interim = ''
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index]
        if (!result || result.length === 0) continue
        const transcript = result[0]?.transcript ?? ''
        if (result.isFinal) {
          if (delivered.has(index)) continue
          delivered.add(index)
          if (!isBlank(transcript)) options.onFinal(transcript.trim())
        } else if (index >= event.resultIndex) {
          interim += transcript
        }
      }
      if (options.onInterim) options.onInterim(interim.trim())
    }

    instance.onerror = (event) => {
      const failure = describeSpeechError(event.error)
      if (event.error === 'aborted') {
        setState('idle')
        return
      }
      stopRequested = true
      options.onError?.(failure)
      setState('idle')
    }

    instance.onend = () => {
      setState('idle')
      options.onEnd?.()
    }

    recognition = instance
    return instance
  }

  return {
    start(): boolean {
      if (state !== 'idle') return false
      try {
        const instance = ensure()
        delivered = new Set<number>()
        stopRequested = false
        setState('starting')
        instance.start()
        return true
      } catch {
        // start() throws when called twice on some browsers.
        options.onError?.(describeSpeechError('unknown'))
        setState('idle')
        return false
      }
    },
    stop(): void {
      if (!recognition) return
      stopRequested = true
      try {
        recognition.stop()
      } catch {
        setState('idle')
      }
    },
    abort(): void {
      if (!recognition) return
      stopRequested = true
      try {
        recognition.abort()
      } catch {
        // ignore
      }
      setState('idle')
    },
    dispose(): void {
      if (!recognition) return
      try {
        recognition.abort()
      } catch {
        // ignore
      }
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      recognition.onstart = null
      recognition = null
      setState('idle')
    },
    setLanguage(next: Language): void {
      lang = next
      if (recognition) recognition.lang = next
    },
    state(): RecognitionState {
      return state
    },
  }
}
