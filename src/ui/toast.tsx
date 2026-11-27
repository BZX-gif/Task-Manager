import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { Icon } from './icons.tsx'

export type ToastKind = 'success' | 'error' | 'info'

interface Toast {
  id: number
  kind: ToastKind
  message: string
}

interface ToastOptions {
  timeout?: number
}

type Notify = (message: string, kind?: ToastKind, options?: ToastOptions) => void

const ToastContext = createContext<Notify | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const counter = useRef(0)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const notify = useCallback<Notify>(
    (message, kind = 'info', options = {}) => {
      if (!message) return
      counter.current += 1
      const id = counter.current
      setToasts((current) => [...current.slice(-2), { id, kind, message }])
      const timeout = options.timeout ?? (kind === 'error' ? 7000 : 3800)
      const timer = setTimeout(() => dismiss(id), timeout)
      timers.current.set(id, timer)
    },
    [dismiss],
  )

  const value = useMemo(() => notify, [notify])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.kind}`}>
            <span className="toast-icon" aria-hidden="true">
              <Icon name={toast.kind === 'success' ? 'check-circle' : toast.kind === 'error' ? 'alert' : 'info'} size={18} />
            </span>
            <span className="toast-text">{toast.message}</span>
            <button type="button" className="toast-close" onClick={() => dismiss(toast.id)} aria-label="Dismiss message">
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): Notify {
  const notify = useContext(ToastContext)
  if (!notify) throw new Error('useToast must be used inside <ToastProvider>')
  return notify
}
