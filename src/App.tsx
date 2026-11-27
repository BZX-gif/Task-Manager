import { useEffect, useRef } from 'react'
import { StoreProvider, useAppState, useStore } from './state/react.tsx'
import { ToastProvider, useToast } from './ui/toast.tsx'
import { Icon, type IconName } from './ui/icons.tsx'
import { navigate, useRoute, type Route, type RouteName } from './router.ts'
import { Dashboard } from './views/Dashboard.tsx'
import { NewBill } from './views/NewBill.tsx'
import { Products } from './views/Products.tsx'
import { Bills } from './views/Bills.tsx'
import { ReceiptView } from './views/Receipt.tsx'
import { Settings } from './views/Settings.tsx'
import { Onboarding } from './ui/Onboarding.tsx'
import type { AppStore } from './state/store.ts'

interface NavItem {
  name: RouteName
  href: string
  label: string
  short: string
  icon: IconName
}

const NAV: readonly NavItem[] = [
  { name: 'dashboard', href: '#/', label: 'Dashboard', short: 'Home', icon: 'home' },
  { name: 'new-bill', href: '#/new', label: 'New bill', short: 'New bill', icon: 'mic' },
  { name: 'products', href: '#/products', label: 'Products', short: 'Products', icon: 'box' },
  { name: 'bills', href: '#/bills', label: 'Bill history', short: 'Bills', icon: 'receipt' },
  { name: 'settings', href: '#/settings', label: 'Settings', short: 'Settings', icon: 'settings' },
]

const activeName = (route: Route): RouteName => (route.name === 'receipt' ? 'bills' : route.name)

function Brand({ small = false }: { small?: boolean }) {
  return (
    <a className="brand" href="#/" aria-label="VoiceBill home">
      <span className="brand-mark" aria-hidden="true">
        <Icon name="mic" size={small ? 18 : 20} />
      </span>
      <span className="brand-text">
        <span className="brand-name">VoiceBill</span>
        {small ? null : <span className="brand-tag">Just speak. Get your bill.</span>}
      </span>
    </a>
  )
}

function Sidebar({ route }: { route: Route }) {
  const state = useAppState()
  const active = activeName(route)
  return (
    <aside className="sidebar" aria-label="Main navigation">
      <Brand />
      <button type="button" className="btn btn-primary side-cta" onClick={() => navigate('#/new')}>
        <Icon name="mic" size={18} />
        New bill
      </button>
      <nav className="nav">
        {NAV.map((item) => (
          <a
            key={item.name}
            href={item.href}
            className={`nav-item${active === item.name ? ' is-active' : ''}`}
            aria-current={active === item.name ? 'page' : undefined}
          >
            <Icon name={item.icon} size={19} />
            <span>{item.label}</span>
            {item.name === 'bills' && state.bills.length > 0 ? (
              <span className="nav-count">{state.bills.length > 99 ? '99+' : state.bills.length}</span>
            ) : null}
          </a>
        ))}
      </nav>
      <div className="side-foot">
        <span className="side-foot-icon" aria-hidden="true">
          <Icon name="shield" size={16} />
        </span>
        <p>
          Your bills live on this device.
          <br />
          No account, no cloud.
        </p>
        <p className="side-shop">{state.settings.shopName || 'Set your shop name'}</p>
      </div>
    </aside>
  )
}

function BottomNav({ route }: { route: Route }) {
  const active = activeName(route)
  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {NAV.map((item) =>
        item.name === 'new-bill' ? (
          <a
            key={item.name}
            href={item.href}
            className={`bottom-mic${active === item.name ? ' is-active' : ''}`}
            aria-current={active === item.name ? 'page' : undefined}
            aria-label="New bill"
          >
            <span className="bottom-mic-circle">
              <Icon name="mic" size={24} />
            </span>
            <span className="bottom-mic-label">New bill</span>
          </a>
        ) : (
          <a
            key={item.name}
            href={item.href}
            className={`bottom-item${active === item.name ? ' is-active' : ''}`}
            aria-current={active === item.name ? 'page' : undefined}
          >
            <Icon name={item.icon} size={21} />
            <span>{item.short}</span>
          </a>
        ),
      )}
    </nav>
  )
}

function MobileTop() {
  const state = useAppState()
  return (
    <header className="mobile-top">
      <Brand small />
      <span className="mobile-shop">{state.settings.shopName || 'VoiceBill'}</span>
    </header>
  )
}

function ActiveView({ route }: { route: Route }) {
  switch (route.name) {
    case 'new-bill':
      return <NewBill />
    case 'products':
      return <Products />
    case 'bills':
      return <Bills />
    case 'settings':
      return <Settings />
    case 'receipt':
      return <ReceiptView billId={route.billId} />
    default:
      return <Dashboard />
  }
}

function Shell() {
  const store = useStore()
  const state = useAppState()
  const notify = useToast()
  const route = useRoute()
  const announced = useRef(false)

  useEffect(() => {
    if (announced.current) return
    announced.current = true
    for (const problem of state.loadProblems) notify(problem, 'error')
    const warning = store.storageWarning()
    if (warning) notify(warning, 'error', { timeout: 9000 })
  }, [state.loadProblems, store, notify])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [route.name, route.billId])

  const storageWarning = store.storageWarning()

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <Sidebar route={route} />
      <MobileTop />
      <main className="main" id="main-content">
        {storageWarning ? (
          <div className="banner banner-warn" role="status">
            <Icon name="alert" size={18} />
            <span>{storageWarning} Export a backup from Settings.</span>
          </div>
        ) : null}
        <ActiveView route={route} />
      </main>
      <BottomNav route={route} />
      {!state.meta.onboarded ? <Onboarding /> : null}
    </div>
  )
}

export function App({ store }: { store: AppStore }) {
  return (
    <StoreProvider store={store}>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </StoreProvider>
  )
}
