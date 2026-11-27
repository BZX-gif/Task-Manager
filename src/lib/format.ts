/** Display formatting for money, dates and quantities. */

export function formatMoney(amount: number, currency = '₹'): string {
  const value = Number.isFinite(amount) ? amount : 0
  const hasPaise = Math.abs(value - Math.round(value)) > 0.004
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(value)
  return `${currency}${formatted}`
}

/** Money always printed with paise, for receipts and totals. */
export function formatMoneyFixed(amount: number, currency = '₹'): string {
  const value = Number.isFinite(amount) ? amount : 0
  return `${currency}${new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}`
}

export function formatDateLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function formatTimeLabel(timestamp: number): string {
  return new Date(timestamp)
    .toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })
    .toUpperCase()
}

export function formatFullDateTime(timestamp: number): string {
  return `${formatDateLabel(timestamp)} · ${formatTimeLabel(timestamp)}`
}

export function startOfDay(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function dayKey(timestamp: number): string {
  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** "Today", "Yesterday" or a dated heading. */
export function formatDayHeading(timestamp: number, now = Date.now()): string {
  const start = startOfDay(timestamp)
  const today = startOfDay(now)
  const day = 24 * 60 * 60 * 1000
  if (start === today) return 'Today'
  if (start === today - day) return 'Yesterday'
  return formatDateLabel(timestamp)
}

export function greetingFor(now: Date = new Date()): { english: string; hindi: string } {
  const hour = now.getHours()
  if (hour < 5) return { english: 'Working late', hindi: 'देर रात तक काम' }
  if (hour < 12) return { english: 'Good morning', hindi: 'सुप्रभात' }
  if (hour < 17) return { english: 'Good afternoon', hindi: 'नमस्ते' }
  if (hour < 21) return { english: 'Good evening', hindi: 'शुभ संध्या' }
  return { english: 'Good evening', hindi: 'शुभ रात्रि' }
}

export function itemCountLabel(count: number): string {
  return count === 1 ? '1 item' : `${count} items`
}

export function billCountLabel(count: number): string {
  return count === 1 ? '1 bill' : `${count} bills`
}

/** "3 kg · ₹45/kg" style meta used in lists. */
export function rateLabel(unitPrice: number, unit: string, currency: string): string {
  return `${formatMoney(unitPrice, currency)}/${unit}`
}
