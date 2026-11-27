import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App.tsx'
import { createStore } from './state/store.ts'
import type { Language } from './lib/types.ts'

/** First run follows the phone's language when it is Hindi, otherwise English. */
function browserLanguage(): Language {
  try {
    return navigator.language?.toLowerCase().startsWith('hi') ? 'hi-IN' : 'en-IN'
  } catch {
    return 'hi-IN'
  }
}

function safeStorage(): Storage | null {
  try {
    const storage = window.localStorage
    const probe = '__voicebill__'
    storage.setItem(probe, '1')
    storage.removeItem(probe)
    return storage
  } catch {
    return null
  }
}

const store = createStore({ storage: safeStorage(), language: browserLanguage() })
const container = document.getElementById('root')

if (container) {
  createRoot(container).render(
    <StrictMode>
      <App store={store} />
    </StrictMode>,
  )
}
