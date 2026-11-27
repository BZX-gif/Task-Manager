import { useAppState, useStore } from '../state/react.tsx'
import { navigate } from '../router.ts'
import {
  formatDateLabel,
  formatMoney,
  greetingFor,
  itemCountLabel,
  startOfDay,
} from '../lib/format.ts'
import { Icon } from '../ui/icons.tsx'
import { EmptyState, SectionHead } from '../ui/components.tsx'
import { BillRow } from '../ui/BillRow.tsx'
import { useToast } from '../ui/toast.tsx'

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      <span className="stat-sub">{sub}</span>
    </div>
  )
}

export function Dashboard() {
  const state = useAppState()
  const store = useStore()
  const notify = useToast()
  const { settings, bills, products } = state
  const now = Date.now()
  const todayStart = startOfDay(now)
  const todaysBills = bills.filter((bill) => bill.createdAt >= todayStart)
  const todaysSales = todaysBills.reduce((total, bill) => total + bill.total, 0)
  const todaysItems = todaysBills.reduce((total, bill) => total + bill.items.length, 0)
  const recent = bills.slice(0, 4)
  const greeting = greetingFor()
  const shopName = settings.shopName.trim()
  const currency = settings.currency

  const speak = () => navigate('#/new')

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">
            {greeting.hindi} · {formatDateLabel(now)}
          </p>
          <h1 className="page-title">
            {greeting.english}
            {shopName ? (
              <>
                , <em>{shopName}</em>
              </>
            ) : null}
          </h1>
          {!shopName ? (
            <p className="page-sub">
              Add your shop name in <a href="#/settings">Settings</a> so receipts look right.
            </p>
          ) : null}
        </div>
        <button type="button" className="btn btn-primary page-head-action" onClick={speak}>
          <Icon name="mic" size={18} />
          New bill
        </button>
      </header>

      <section className="voice-hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <span className="hero-eyebrow">
            <Icon name="sparkle" size={14} /> Voice billing
          </span>
          <h2 className="hero-title" id="hero-title">
            Speak the list.
            <br />
            Bill in seconds.
          </h2>
          <p className="hero-sub">
            Say <span className="hero-example">“2 kilo chini aur 1 litre tel”</span> — prices come from your catalogue.
          </p>
          <button type="button" className="btn btn-hero" onClick={speak}>
            <Icon name="mic" size={18} />
            Start a new bill
          </button>
        </div>
        <button type="button" className="hero-mic" onClick={speak} aria-label="Start a new bill with your voice">
          <span className="hero-mic-ring" aria-hidden="true" />
          <Icon name="mic" size={40} />
          <span className="hero-mic-label">Tap to speak</span>
        </button>
      </section>

      <section className="stat-grid" aria-label="Today at a glance">
        <Stat label="Today’s sales" value={formatMoney(todaysSales, currency)} sub={itemCountLabel(todaysItems)} />
        <Stat label="Bills today" value={String(todaysBills.length)} sub={todaysBills.length ? 'All saved on this device' : 'No bills yet today'} />
        <Stat label="Products" value={String(products.length)} sub={products.length ? 'In your catalogue' : 'Catalogue is empty'} />
      </section>

      {products.length === 0 ? (
        <section className="card setup-card" aria-labelledby="setup-title">
          <div className="setup-head">
            <span className="setup-icon" aria-hidden="true">
              <Icon name="wand" size={20} />
            </span>
            <div>
              <h2 className="section-title" id="setup-title">
                Set up your shop
              </h2>
              <p className="section-sub">Two minutes now saves hours at the counter.</p>
            </div>
          </div>
          <ol className="setup-steps">
            <li>
              <span className="setup-step-num">1</span>
              <div className="setup-step-body">
                <p className="setup-step-title">Add your products and prices</p>
                <p className="setup-step-note">Name, price and unit — that’s all VoiceBill needs.</p>
              </div>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => navigate('#/products')}>
                Add products
              </button>
            </li>
            <li>
              <span className="setup-step-num">2</span>
              <div className="setup-step-body">
                <p className="setup-step-title">In a hurry?</p>
                <p className="setup-step-note">Load 9 sample products, then edit the prices to yours.</p>
              </div>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => {
                  const added = store.addSampleProducts()
                  notify(added ? `${added} sample products added. Edit the prices to match your shop.` : 'Sample products are already in your catalogue.', added ? 'success' : 'info')
                  if (added) navigate('#/products')
                }}
              >
                Use samples
              </button>
            </li>
            <li>
              <span className="setup-step-num">3</span>
              <div className="setup-step-body">
                <p className="setup-step-title">Add shop details for receipts</p>
                <p className="setup-step-note">Shop name, address and phone appear on every bill.</p>
              </div>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => navigate('#/settings')}>
                Shop details
              </button>
            </li>
          </ol>
        </section>
      ) : null}

      <section className="card recent-card">
        <SectionHead
          eyebrow="Recent"
          title="Latest bills"
          action={
            bills.length > 0 ? (
              <a className="btn btn-ghost btn-sm" href="#/bills">
                View all
                <Icon name="arrow-right" size={15} />
              </a>
            ) : null
          }
        />
        {recent.length > 0 ? (
          <div className="bill-list">
            {recent.map((bill) => (
              <BillRow key={bill.id} bill={bill} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon="receipt"
            title="No bills yet"
            body="Speak your first bill — it will appear here, saved on this device."
            action={
              <button type="button" className="btn btn-primary btn-sm" onClick={speak}>
                <Icon name="mic" size={16} />
                Make first bill
              </button>
            }
          />
        )}
      </section>

      <div className="quick-grid">
        <a className="quick-card" href="#/products">
          <span className="quick-icon" aria-hidden="true">
            <Icon name="box" size={20} />
          </span>
          <span className="quick-body">
            <span className="quick-title">Products &amp; prices</span>
            <span className="quick-sub">
              {products.length ? `${products.length} products ready to bill` : 'Add your catalogue to start billing'}
            </span>
          </span>
          <Icon name="chevron-right" size={16} />
        </a>
        <a className="quick-card" href="#/settings">
          <span className="quick-icon" aria-hidden="true">
            <Icon name="settings" size={20} />
          </span>
          <span className="quick-body">
            <span className="quick-title">Shop settings</span>
            <span className="quick-sub">Receipt width, language, backup</span>
          </span>
          <Icon name="chevron-right" size={16} />
        </a>
      </div>
    </div>
  )
}
