import { useState, type FormEvent } from 'react'
import { useAppState, useStore } from '../state/react.tsx'
import { useToast } from './toast.tsx'
import { Icon } from './icons.tsx'

/**
 * First-run setup. Deliberately one screen: the shopkeeper gives the shop a name
 * and can opt in to a clearly-labelled sample catalogue. Nothing is imported
 * silently and no existing catalogue is ever replaced.
 */
export function Onboarding() {
  const store = useStore()
  const state = useAppState()
  const notify = useToast()
  const [shopName, setShopName] = useState(state.settings.shopName)
  const [phone, setPhone] = useState(state.settings.phone)
  const [addSamples, setAddSamples] = useState(true)
  const [error, setError] = useState('')

  const finish = (event?: FormEvent) => {
    event?.preventDefault()
    const name = shopName.trim()
    if (!name) {
      setError('Please enter your shop name')
      return
    }
    store.updateSettings({ shopName: name, phone: phone.trim() })
    if (addSamples) {
      const added = store.addSampleProducts()
      if (added > 0) notify(`${added} sample products added — edit or delete them anytime.`, 'success')
    }
    store.markOnboarded()
    notify(`Welcome, ${name}. Tap the mic to make your first bill.`, 'success')
  }

  return (
    <div className="onboard" role="dialog" aria-modal="true" aria-labelledby="onboard-title">
      <div className="onboard-card">
        <div className="onboard-brand">
          <span className="brand-mark" aria-hidden="true">
            <Icon name="mic" size={22} />
          </span>
          <span className="brand-name">VoiceBill</span>
        </div>

        <h1 className="onboard-title" id="onboard-title">
          Speak. Review. <em>Bill.</em>
        </h1>
        <p className="onboard-sub">
          Aapki dukaan, aapki awaaz. Speak your items in Hindi, Hinglish or English and VoiceBill writes the bill.
        </p>

        <div className="onboard-points">
          <div className="onboard-point">
            <Icon name="mic" size={18} />
            <span>Say “3 kilo chini aur 2 kilo aata”</span>
          </div>
          <div className="onboard-point">
            <Icon name="check-circle" size={18} />
            <span>Check the items, fix anything, then bill</span>
          </div>
          <div className="onboard-point">
            <Icon name="shield" size={18} />
            <span>Everything stays on this phone</span>
          </div>
        </div>

        <form onSubmit={finish} noValidate>
          <div className="field">
            <label className="label" htmlFor="onboard-shop">
              Shop name
            </label>
            <input
              id="onboard-shop"
              className="input input-lg"
              value={shopName}
              onChange={(event) => {
                setShopName(event.target.value)
                if (error) setError('')
              }}
              placeholder="Sharma Kirana Store"
              autoComplete="organization"
              maxLength={60}
              aria-invalid={error ? true : undefined}
            />
            {error ? (
              <p className="error-text" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <div className="field">
            <label className="label" htmlFor="onboard-phone">
              Phone number <span className="label-optional">(optional)</span>
            </label>
            <input
              id="onboard-phone"
              className="input"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="98765 43210"
              inputMode="tel"
              maxLength={20}
            />
          </div>

          <label className="checkbox">
            <input type="checkbox" checked={addSamples} onChange={(event) => setAddSamples(event.target.checked)} />
            <span>
              Add 9 sample products with prices
              <span className="checkbox-note">Marked as samples. Edit or delete them anytime.</span>
            </span>
          </label>

          <button type="submit" className="btn btn-primary btn-lg btn-block">
            Start billing
            <Icon name="arrow-right" size={18} />
          </button>
        </form>

        <button
          type="button"
          className="btn btn-ghost btn-block onboard-skip"
          onClick={() => {
            store.markOnboarded()
            notify('You can add your shop details in Settings anytime.', 'info')
          }}
        >
          I’ll set it up later
        </button>

        <p className="onboard-foot">Voice input uses your browser’s speech engine. Audio is never stored by VoiceBill.</p>
      </div>
    </div>
  )
}
