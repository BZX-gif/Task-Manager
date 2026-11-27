/** Hash-based routing keeps the static build deployable anywhere (no rewrites). */
import { useEffect, useState } from 'react'

export type RouteName = 'dashboard' | 'new-bill' | 'products' | 'bills' | 'settings' | 'receipt'

export interface Route {
  name: RouteName
  billId?: string
}

const ROUTE_BY_PATH: Record<string, RouteName> = {
  '': 'dashboard',
  '/': 'dashboard',
  '/dashboard': 'dashboard',
  '/new': 'new-bill',
  '/new-bill': 'new-bill',
  '/products': 'products',
  '/bills': 'bills',
  '/settings': 'settings',
}

export function parseRoute(hash: string): Route {
  const clean = (hash || '').replace(/^#/, '').split('?')[0]
  const receipt = clean.match(/^\/bill\/([^/]+)\/?$/)
  if (receipt) return { name: 'receipt', billId: decodeURIComponent(receipt[1]) }
  return { name: ROUTE_BY_PATH[clean.replace(/\/$/, '')] ?? 'dashboard' }
}

export function routeHash(route: Route): string {
  if (route.name === 'receipt' && route.billId) return `#/bill/${encodeURIComponent(route.billId)}`
  const map: Record<Exclude<RouteName, 'receipt'>, string> = {
    dashboard: '#/',
    'new-bill': '#/new',
    products: '#/products',
    bills: '#/bills',
    settings: '#/settings',
  }
  return map[route.name as Exclude<RouteName, 'receipt'>] ?? '#/'
}

export function navigate(route: Route | string): void {
  const hash = typeof route === 'string' ? (route.startsWith('#') ? route : `#${route.startsWith('/') ? '' : '/'}${route}`) : routeHash(route)
  if (window.location.hash === hash) {
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    return
  }
  window.location.hash = hash
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
