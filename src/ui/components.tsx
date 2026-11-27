import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Icon, type IconName } from './icons.tsx'

/* ------------------------------------------------------------------ */
/* Dialog                                                              */
/* ------------------------------------------------------------------ */

export interface DialogProps {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children?: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  /** Hide the close X for steps that must be completed. */
  dismissible?: boolean
}

/**
 * Accessible modal: labelled, escape-closable, focus moved inside and returned
 * to the trigger on close. No dependency on the native <dialog> element, which
 * older Android WebViews handle inconsistently.
 */
export function Dialog({ open, title, description, onClose, children, footer, size = 'md', dismissible = true }: DialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    previouslyFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const timer = setTimeout(() => {
      const panel = panelRef.current
      if (!panel) return
      // Prefer the first field; a close button should not steal the focus.
      const focusable =
        panel.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), select, textarea') ??
        panel.querySelector<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')
      focusable?.focus()
    }, 20)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissible) {
        event.stopPropagation()
        closeRef.current()
      }
      if (event.key !== 'Tab' || !panelRef.current) return
      const focusables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null || element === document.activeElement)
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = overflow
      previouslyFocused.current?.focus?.()
    }
  }, [open, dismissible])

  if (!open) return null

  return (
    <div className="dialog-overlay" onMouseDown={(event) => event.target === event.currentTarget && dismissible && closeRef.current()}>
      <div
        ref={panelRef}
        className={`dialog dialog-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      >
        <div className="dialog-head">
          <div>
            <h2 id={titleId} className="dialog-title">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="dialog-desc">
                {description}
              </p>
            ) : null}
          </div>
          {dismissible ? (
            <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} aria-label="Close">
              <Icon name="close" size={18} />
            </button>
          ) : null}
        </div>
        <div className="dialog-body">{children}</div>
        {footer ? <div className="dialog-foot">{footer}</div> : null}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Small building blocks                                               */
/* ------------------------------------------------------------------ */

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'green' | 'amber' | 'red'
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

export function EmptyState({
  icon = 'box',
  title,
  body,
  action,
}: {
  icon?: IconName
  title: string
  body?: string
  action?: ReactNode
}) {
  return (
    <div className="empty">
      <span className="empty-icon" aria-hidden="true">
        <Icon name={icon} size={26} />
      </span>
      <h3 className="empty-title">{title}</h3>
      {body ? <p className="empty-body">{body}</p> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  )
}

export interface FieldProps {
  label: string
  htmlFor: string
  hint?: string
  error?: string
  children: ReactNode
}

export function Field({ label, htmlFor, hint, error, children }: FieldProps) {
  return (
    <div className={`field${error ? ' field-error' : ''}`}>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="hint">{hint}</p>
      ) : null}
    </div>
  )
}

export function SectionHead({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  return (
    <div className="section-head">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2 className="section-title">{title}</h2>
      </div>
      {action}
    </div>
  )
}
