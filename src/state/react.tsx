import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
import type { AppStore, StoreState } from './store.ts'

const StoreContext = createContext<AppStore | null>(null)

export function StoreProvider({ store, children }: { store: AppStore; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}

export function useStore(): AppStore {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useStore must be used inside <StoreProvider>')
  return store
}

/** Subscribe to the whole store. The app is small enough that this is cheap. */
export function useAppState(): StoreState {
  const store = useStore()
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getState(),
    () => store.getState(),
  )
}
