import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createRecognizer,
  describeSpeechError,
  speechSupport,
  type RecognitionState,
  type Recognizer,
  type SpeechEnvironment,
  type SpeechFailure,
} from '../lib/speech.ts'
import type { Language } from '../lib/types.ts'

export interface UseSpeechOptions {
  lang: Language
  onFinal(text: string): void
  /** Injectable for tests; defaults to window. */
  env?: SpeechEnvironment
}

export interface UseSpeech {
  state: RecognitionState
  listening: boolean
  supported: boolean
  reason: 'supported' | 'unsupported' | 'insecure'
  interim: string
  failure: SpeechFailure | null
  start(): boolean
  stop(): void
  toggle(): void
  clearFailure(): void
}

function browserEnv(): SpeechEnvironment {
  if (typeof window === 'undefined') return {}
  const candidate = window as unknown as SpeechEnvironment
  return {
    SpeechRecognition: candidate.SpeechRecognition,
    webkitSpeechRecognition: candidate.webkitSpeechRecognition,
    isSecureContext: window.isSecureContext,
  }
}

/**
 * React binding for the speech recogniser. The recogniser is created once and
 * disposed with the screen, so a permission prompt is never re-triggered by a
 * background render.
 */
export function useSpeech({ lang, onFinal, env }: UseSpeechOptions): UseSpeech {
  const environment = useMemo(() => env ?? browserEnv(), [env])
  const support = useMemo(() => speechSupport(environment), [environment])
  const [state, setState] = useState<RecognitionState>('idle')
  const [interim, setInterim] = useState('')
  const [failure, setFailure] = useState<SpeechFailure | null>(null)
  const recognizerRef = useRef<Recognizer | null>(null)
  const onFinalRef = useRef(onFinal)
  onFinalRef.current = onFinal

  useEffect(() => {
    const recognizer = createRecognizer({
      env: environment,
      lang,
      onFinal: (text) => {
        setInterim('')
        onFinalRef.current(text)
      },
      onInterim: setInterim,
      onError: (next) => {
        setFailure(next)
        setInterim('')
      },
      onStateChange: setState,
      // The browser silently ends after a pause; surface that as "idle" and keep
      // whatever was already heard safely in the bill.
      onEnd: () => setInterim(''),
    })
    recognizerRef.current = recognizer
    return () => {
      recognizer?.dispose()
      recognizerRef.current = null
      setInterim('')
      setState('idle')
    }
    // `lang` is applied through setLanguage below so changing language mid-bill
    // does not rebuild the recogniser or replay permission prompts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [environment])

  useEffect(() => {
    recognizerRef.current?.setLanguage(lang)
  }, [lang])

  const start = useCallback(() => {
    setFailure(null)
    const recognizer = recognizerRef.current
    if (!recognizer) {
      setFailure(describeSpeechError('not-supported'))
      return false
    }
    return recognizer.start()
  }, [])

  const stop = useCallback(() => {
    recognizerRef.current?.stop()
  }, [])

  const toggle = useCallback(() => {
    if (state === 'idle') start()
    else stop()
  }, [state, start, stop])

  const clearFailure = useCallback(() => setFailure(null), [])

  return {
    state,
    listening: state !== 'idle',
    supported: support.supported,
    reason: support.reason,
    interim,
    failure,
    start,
    stop,
    toggle,
    clearFailure,
  }
}
