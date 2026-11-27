import { useMemo, useState } from 'react'
import type { Bill } from '../lib/types.ts'
import { formatDayHeading, formatMoney, formatTimeLabel, itemCountLabel, startOfDay } from '../lib/format.ts'
import { useAppState } from '../state/react.tsx'
import { Icon } from '../ui/icons.tsx'
import { EmptyState } from '../ui/components.tsx'

type Preset = 'all' | 'today' | 'week' | 'month'

const PRESETS: { id: Preset; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'today', label: 'Today' },
  { id: 'week', label: '7 days' },
  { id: 'month', label: '30 days' },
]

function dayStartFromInput(value: string): number | null {
  if (!value) return null
  const parsed = new Date(`${value}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime()
}

function dayEndFromInput(value: string): number | null {
  if (!value) return null
  const parsed = new Date(`${value}T23:59:59.999`)
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime()
}

export function Bills() {
  const state = useAppState()
  const { bills, settings } = state
  const currency = settings.currency
  const [preset, setPreset] = useState<Preset>('all')
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [showRange, setShowRange] = useState(false)

  const filtered = useMemo(() => {
    const now = Date.now()
    const day = 24 * 60 * 60 * 1000
    const fromCustom = dayStartFromInput(from)
    const toCustom = dayEndFromInput(to)
    const query = search.trim().toLowerCase()

    return bills.filter((bill) => {
      if (preset === 'today' && bill.createdAt < startOfDay(now)) return false
      if (preset === 'week' && bill.createdAt < startOfDay(now - 6 * day)) return false
      if (preset === 'month' && bill.createdAt < startOfDay(now - 29 * day)) return false
      if (fromCustom !== null && bill.createdAt < fromCustom) return false
      if (toCustom !== null && bill.createdAt > toCustom) return false
      if (!query) return true
      return (
        bill.number.toLowerCase().includes(query) ||
        bill.items.some((item) => item.name.toLowerCase().includes(query)) ||
        String(bill.total).includes(query)
      )
    })
  }, [bills, preset, search, from, to])

  const groups = useMemo(() => {
    const map = new Map<string, { timestamp: number; bills: Bill[] }>()
    for (const bill of filtered) {
      const key = new Date(bill.createdAt).toDateString()
      const entry = map.get(key) ?? { timestamp: startOfDay(bill.createdAt), bills: [] }
      entry.bills.push(bill)
      map.set(key, entry)
    }
    return [...map.values()]
      .sort((a, b) => b.timestamp - a.timestamp)
      .map((entry) => ({
        heading: formatDayHeading(entry.timestamp),
        total: entry.bills.reduce((sum, bill) => sum + bill.total, 0),
        bills: [...entry.bills].sort((a, b) => b.createdAt - a.createdAt),
      }))
  }, [filtered])

  const total = filtered.reduce((sum, bill) => sum + bill.total, 0)

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">History</p>
          <h1 className="page-title">Bill history</h1>
          <p className="page-sub">Every bill is saved on this device. Open one to view or reprint it.</p>
        </div>
        <a className="btn btn-primary page-head-action" href="#/new">
          <Icon name="mic" size={18} />
          New bill
        </a>
      </header>

      {bills.length === 0 ? (
        <section className="card">
          <EmptyState
            icon="receipt"
            title="No bills yet"
            body="Your saved bills will appear here, with the newest first. You can reprint any bill at any time."
            action={
              <a className="btn btn-primary btn-sm" href="#/new">
                <Icon name="mic" size={16} />
                Make your first bill
              </a>
            }
          />
        </section>
      ) : (
        <>
          <section className="card filter-card" aria-label="Filter bills">
            <div className="search-field">
              <Icon name="search" size={18} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search bill number, product or amount"
                aria-label="Search bills"
                autoComplete="off"
              />
              {search ? (
                <button type="button" className="btn btn-icon btn-ghost btn-xs" onClick={() => setSearch('')} aria-label="Clear search">
                  <Icon name="close" size={14} />
                </button>
              ) : null}
            </div>
            <div className="filter-row">
              <div className="chips" role="group" aria-label="Date filter">
                {PRESETS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`chip${preset === option.id ? ' is-active' : ''}`}
                    aria-pressed={preset === option.id}
                    onClick={() => setPreset(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
                <button
                  type="button"
                  className={`chip${showRange || from || to ? ' is-active' : ''}`}
                  aria-expanded={showRange}
                  onClick={() => setShowRange((current) => !current)}
                >
                  <Icon name="clock" size={13} />
                  Date range
                </button>
              </div>
              <p className="filter-summary">
                {filtered.length} bill{filtered.length === 1 ? '' : 's'} · {formatMoney(total, currency)}
              </p>
            </div>
            {showRange ? (
              <div className="range-row">
                <label className="field-inline">
                  <span className="label">From</span>
                  <input type="date" className="input input-sm" value={from} onChange={(event) => setFrom(event.target.value)} />
                </label>
                <label className="field-inline">
                  <span className="label">To</span>
                  <input type="date" className="input input-sm" value={to} onChange={(event) => setTo(event.target.value)} />
                </label>
                {from || to ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setFrom('')
                      setTo('')
                    }}
                  >
                    Clear dates
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>

          {filtered.length === 0 ? (
            <section className="card">
              <EmptyState
                icon="search"
                title="No bills match this filter"
                body="Try another date range or search term."
                action={
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => {
                      setSearch('')
                      setPreset('all')
                      setFrom('')
                      setTo('')
                    }}
                  >
                    Show all bills
                  </button>
                }
              />
            </section>
          ) : (
            groups.map((group) => (
              <section key={group.heading} className="card day-card" aria-label={group.heading}>
                <div className="day-head">
                  <h2 className="day-title">{group.heading}</h2>
                  <span className="day-total">{formatMoney(group.total, currency)}</span>
                </div>
                <ul className="day-list">
                  {group.bills.map((bill) => (
                    <li key={bill.id}>
                      <a className="history-row" href={`#/bill/${encodeURIComponent(bill.id)}`}>
                        <span className="history-icon" aria-hidden="true">
                          <Icon name="receipt" size={17} />
                        </span>
                        <span className="history-main">
                          <span className="history-top">
                            <span className="history-number">{bill.number}</span>
                            <span className="history-amount">{formatMoney(bill.total, currency)}</span>
                          </span>
                          <span className="history-meta">
                            {formatTimeLabel(bill.createdAt)} · {itemCountLabel(bill.items.length)} ·{' '}
                            {bill.items
                              .slice(0, 2)
                              .map((item) => item.name)
                              .join(', ')}
                            {bill.items.length > 2 ? ` +${bill.items.length - 2}` : ''}
                          </span>
                        </span>
                        <Icon name="chevron-right" size={16} className="history-arrow" />
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </>
      )}
    </div>
  )
}
