import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ReceiptWidth, Settings as SettingsModel } from '../lib/types.ts'
import { DEFAULT_SETTINGS, importData, storageFootprint, type StorageLike } from '../lib/storage.ts'
import { speechSupport, type SpeechEnvironment } from '../lib/speech.ts'
import { formatFullDateTime } from '../lib/format.ts'
import { useAppState, useStore } from '../state/react.tsx'
import { useToast } from '../ui/toast.tsx'
import { Icon } from '../ui/icons.tsx'
import { Dialog, Field, SectionHead } from '../ui/components.tsx'

const WIDTHS: { id: ReceiptWidth; label: string; note: string }[] = [
  { id: '58', label: '58 mm', note: 'Small thermal' },
  { id: '80', label: '80 mm', note: 'Standard thermal' },
  { id: 'a4', label: 'A4', note: 'Printer / PDF' },
]

function detectSpeech(): { supported: boolean; reason: string } {
  if (typeof window === 'undefined') return { supported: false, reason: 'unsupported' }
  const env = window as unknown as SpeechEnvironment
  const result = speechSupport({
    SpeechRecognition: env.SpeechRecognition,
    webkitSpeechRecognition: env.webkitSpeechRecognition,
    isSecureContext: window.isSecureContext,
  })
  return { supported: result.supported, reason: result.reason }
}

function getLocalStorage(): StorageLike | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function Settings() {
  const state = useAppState()
  const store = useStore()
  const notify = useToast()
  const speech = detectSpeech()
  const [form, setForm] = useState<SettingsModel>(state.settings)
  const [errors, setErrors] = useState<{ shopName?: string; currency?: string }>({})
  const [clearOpen, setClearOpen] = useState(false)
  const [importPreview, setImportPreview] = useState<{ text: string; name: string; products: number; bills: number } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setForm(state.settings)
  }, [state.settings])

  const dirty = (Object.keys(form) as (keyof SettingsModel)[]).some((key) => form[key] !== state.settings[key])

  const set = <K extends keyof SettingsModel>(key: K, value: SettingsModel[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    if (errors[key as keyof typeof errors]) setErrors((current) => ({ ...current, [key]: undefined }))
  }

  const save = (event?: FormEvent) => {
    event?.preventDefault()
    const nextErrors: { shopName?: string; currency?: string } = {}
    if (form.shopName.trim().length === 0) nextErrors.shopName = 'A shop name makes the receipt recognisable'
    if (form.shopName.trim().length > 60) nextErrors.shopName = 'Keep the shop name under 60 characters'
    const currency = form.currency.trim()
    if (!currency) nextErrors.currency = 'Enter a currency symbol, e.g. ₹'
    if (currency.length > 3) nextErrors.currency = 'Use up to 3 characters'
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors)
      return
    }
    store.updateSettings({ ...form, shopName: form.shopName.trim(), currency: form.currency.trim() })
    notify('Settings saved.', 'success')
  }

  const footprint = (() => {
    const storage = getLocalStorage()
    return storage ? storageFootprint(storage) : 0
  })()

  const downloadBackup = () => {
    try {
      const data = store.exportBackup()
      const blob = new Blob([data], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      const stamp = new Date().toISOString().slice(0, 10)
      link.href = url
      link.download = `voicebill-backup-${stamp}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
      notify('Backup downloaded.', 'success')
    } catch {
      notify('The backup could not be created.', 'error')
    }
  }

  const onFile = async (file: File | null | undefined) => {
    if (!file) return
    try {
      const text = await file.text()
      const preview = importData(text, Date.now(), () => 'preview')
      if (!preview.ok) {
        notify(preview.error, 'error')
        return
      }
      setImportPreview({ text, name: file.name, products: preview.data.products.length, bills: preview.data.bills.length })
    } catch {
      notify('That file could not be read.', 'error')
    } finally {
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Settings</p>
          <h1 className="page-title">Your shop setup</h1>
          <p className="page-sub">These details appear on every receipt. Everything is stored on this device.</p>
        </div>
        <button type="button" className="btn btn-primary page-head-action" onClick={() => save()} disabled={!dirty}>
          <Icon name="check" size={17} />
          Save changes
        </button>
      </header>

      <div className="settings-grid">
        <form className="card settings-card" onSubmit={save} noValidate aria-label="Shop details">
          <SectionHead eyebrow="Receipt header" title="Shop details" />
          <Field label="Shop name" htmlFor="settings-shop" error={errors.shopName}>
            <input
              id="settings-shop"
              className="input"
              value={form.shopName}
              onChange={(event) => set('shopName', event.target.value)}
              placeholder="Sharma Kirana Store"
              maxLength={60}
            />
          </Field>
          <Field label="Address" htmlFor="settings-address" hint="Street, area, city — as you want it printed.">
            <textarea
              id="settings-address"
              className="input textarea"
              value={form.address}
              onChange={(event) => set('address', event.target.value)}
              placeholder="12, Gandhi Market, Jaipur"
              rows={2}
              maxLength={160}
            />
          </Field>
          <div className="form-row">
            <Field label="Phone" htmlFor="settings-phone" hint="Shown on the receipt">
              <input
                id="settings-phone"
                className="input"
                value={form.phone}
                onChange={(event) => set('phone', event.target.value)}
                placeholder="98765 43210"
                inputMode="tel"
                maxLength={20}
              />
            </Field>
            <Field label="Currency symbol" htmlFor="settings-currency" error={errors.currency}>
              <input
                id="settings-currency"
                className="input"
                value={form.currency}
                onChange={(event) => set('currency', event.target.value)}
                placeholder="₹"
                maxLength={3}
              />
            </Field>
          </div>

          <SectionHead eyebrow="Print" title="Receipt" />
          <div className="field">
            <span className="label" id="width-label">
              Receipt width
            </span>
            <div className="width-options" role="radiogroup" aria-labelledby="width-label">
              {WIDTHS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={form.receiptWidth === option.id}
                  className={`width-option${form.receiptWidth === option.id ? ' is-active' : ''}`}
                  onClick={() => set('receiptWidth', option.id)}
                >
                  <span className={`width-paper width-paper-${option.id}`} aria-hidden="true" />
                  <span className="width-label">{option.label}</span>
                  <span className="width-note">{option.note}</span>
                </button>
              ))}
            </div>
            <p className="hint">Used when you print. Choose the paper your printer uses.</p>
          </div>
          <Field label="Thank-you message" htmlFor="settings-thanks" hint="Printed at the bottom of every bill.">
            <input
              id="settings-thanks"
              className="input"
              value={form.thankYou}
              onChange={(event) => set('thankYou', event.target.value)}
              maxLength={120}
              placeholder="Thank you for shopping with us!"
            />
          </Field>

          <div className="settings-save-row">
            <button type="submit" className="btn btn-primary" disabled={!dirty}>
              Save changes
            </button>
            {dirty ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setForm(state.settings)
                  setErrors({})
                }}
              >
                Discard
              </button>
            ) : (
              <span className="settings-saved">
                <Icon name="check-circle" size={15} /> All changes saved
              </span>
            )}
          </div>
        </form>

        <div className="settings-col">
          <section className="card settings-card" aria-label="Voice recognition">
            <SectionHead eyebrow="Voice" title="Recognition" />
            <div className="field">
              <span className="label">Default language</span>
              <div className="segmented segmented-block" role="group" aria-label="Default recognition language">
                <button
                  type="button"
                  className={state.settings.language === 'hi-IN' ? 'is-active' : ''}
                  aria-pressed={state.settings.language === 'hi-IN'}
                  onClick={() => store.updateSettings({ language: 'hi-IN' })}
                >
                  हिंदी
                </button>
                <button
                  type="button"
                  className={state.settings.language === 'en-IN' ? 'is-active' : ''}
                  aria-pressed={state.settings.language === 'en-IN'}
                  onClick={() => store.updateSettings({ language: 'en-IN' })}
                >
                  English
                </button>
              </div>
            </div>
            <div className={`status-card ${speech.supported ? 'is-ok' : 'is-warn'}`}>
              <Icon name={speech.supported ? 'check-circle' : 'alert'} size={18} />
              <div>
                <p className="status-title">{speech.supported ? 'Voice input is ready' : 'Voice input not available here'}</p>
                <p className="status-body">
                  {speech.supported
                    ? 'Speak Hindi, Hinglish or English. Speech stays in your browser — VoiceBill never uploads audio.'
                    : speech.reason === 'insecure'
                      ? 'Speech recognition needs an https connection. Manual entry works everywhere.'
                      : 'This browser does not support the Web Speech API. Manual entry works everywhere.'}
                </p>
              </div>
            </div>
            <p className="hint">
              Speech recognition quality varies by phone and accent. Always review the items before saving — unmatched products are
              never priced automatically.
            </p>
          </section>

          <section className="card settings-card" aria-label="Backup and storage">
            <SectionHead eyebrow="Data" title="Backup & storage" />
            <dl className="kv">
              <div>
                <dt>Saved bills</dt>
                <dd>{state.bills.length}</dd>
              </div>
              <div>
                <dt>Products</dt>
                <dd>{state.products.length}</dd>
              </div>
              <div>
                <dt>Storage used</dt>
                <dd>{footprint > 1024 ? `${(footprint / 1024).toFixed(1)} kB` : `${footprint} B`}</dd>
              </div>
              <div>
                <dt>Last saved</dt>
                <dd>{state.lastSavedAt ? formatFullDateTime(state.lastSavedAt) : 'On every change'}</dd>
              </div>
            </dl>

            <div className="data-actions">
              <button type="button" className="btn btn-outline btn-block" onClick={downloadBackup}>
                <Icon name="download" size={17} />
                Download backup (JSON)
              </button>
              <button type="button" className="btn btn-outline btn-block" onClick={() => fileInput.current?.click()}>
                <Icon name="upload" size={17} />
                Restore from backup
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="application/json,.json"
                className="sr-only"
                onChange={(event) => onFile(event.target.files?.[0])}
                aria-label="Choose a backup file"
              />
              {state.products.some((product) => product.sample) ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-block"
                  onClick={() => {
                    const removed = store.removeSampleProducts()
                    notify(`${removed} sample product${removed === 1 ? '' : 's'} removed.`, 'info')
                  }}
                >
                  <Icon name="trash" size={16} />
                  Remove sample products
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost btn-block"
                  onClick={() => {
                    const added = store.addSampleProducts()
                    notify(added ? `${added} sample products added.` : 'Sample products are already in your catalogue.', added ? 'success' : 'info')
                  }}
                >
                  <Icon name="plus" size={16} />
                  Add sample products
                </button>
              )}
            </div>

            <div className="danger-zone">
              <div>
                <p className="danger-title">Erase all data</p>
                <p className="danger-body">Deletes products, bills and settings from this browser. Download a backup first.</p>
              </div>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => setClearOpen(true)}>
                Erase
              </button>
            </div>
          </section>

          <section className="card settings-card about-card" aria-label="About VoiceBill">
            <SectionHead eyebrow="About" title="VoiceBill" />
            <p className="about-copy">
              VoiceBill turns a spoken list into a printed bill. It runs entirely in this browser — no account, no server, no API key.
            </p>
            <ul className="about-list">
              <li>
                <Icon name="shield" size={15} /> Data lives in this browser’s localStorage. Clearing browser data deletes it.
              </li>
              <li>
                <Icon name="mic" size={15} /> Voice uses the browser’s own speech engine. Hinglish accuracy varies.
              </li>
              <li>
                <Icon name="printer" size={15} /> Printing uses the browser print dialog (choose Save as PDF to download).
              </li>
            </ul>
            <p className="about-version">Version 1.0 · Make a backup before changing phones.</p>
          </section>
        </div>
      </div>

      <Dialog
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        title="Erase everything?"
        description="This removes every product, bill and setting stored by VoiceBill in this browser. It cannot be undone."
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setClearOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                store.clearEverything()
                setForm(DEFAULT_SETTINGS)
                setClearOpen(false)
                notify('All VoiceBill data erased from this browser.', 'info')
              }}
            >
              Erase everything
            </button>
          </>
        }
      >
        <p className="dialog-copy">
          {state.bills.length} bill{state.bills.length === 1 ? '' : 's'} and {state.products.length} product
          {state.products.length === 1 ? '' : 's'} will be deleted.
        </p>
      </Dialog>

      <Dialog
        open={!!importPreview}
        onClose={() => setImportPreview(null)}
        title="Restore this backup?"
        description="Your current data in this browser will be replaced by the backup."
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setImportPreview(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                if (!importPreview) return
                const result = store.importBackup(importPreview.text)
                setImportPreview(null)
                notify(result.message, result.ok ? 'success' : 'error')
              }}
            >
              Restore backup
            </button>
          </>
        }
      >
        <p className="dialog-copy">
          <strong>{importPreview?.name}</strong>
          <br />
          {importPreview?.products} products · {importPreview?.bills} bills
        </p>
      </Dialog>
    </div>
  )
}
