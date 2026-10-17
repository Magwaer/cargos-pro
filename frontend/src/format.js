export function money(cents, currency = 'EUR', digits = 0) {
  const value = (Number(cents) || 0) / 100
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: digits }).format(value)
  } catch {
    return `${value.toFixed(digits)} ${currency}`
  }
}

export function when(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10)
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function day(value) {
  if (!value) return '—'
  return String(value).slice(0, 10)
}

export function leg(km, minutes) {
  if (km == null) return null
  const hours = Math.floor((minutes || 0) / 60)
  const mins = (minutes || 0) % 60
  return `${Number(km).toLocaleString()} km · ${hours}h ${mins}m`
}

export function tone(value) {
  return {
    booked: 'gray', new: 'gray', planned: 'gray', draft: 'gray', cancelled: 'gray', void: 'gray',
    quoted: 'blue', assigned: 'blue', sent: 'blue', on_trip: 'blue', customer: 'blue',
    negotiation: 'amber', in_transit: 'amber', arrived: 'amber', loaded: 'amber', maintenance: 'peach', warning: 'amber',
    delivered: 'mint', won: 'mint', paid: 'mint', available: 'mint',
    invoiced: 'violet', both: 'violet',
    overdue: 'rose', lost: 'rose', carrier: 'peach',
    cash: 'mint', card: 'blue', wire: 'violet', fuel_card: 'amber', cheque: 'peach', other: 'gray',
  }[value] || 'gray'
}

export function eurosToCents(value) {
  const n = Number(String(value).replace(',', '.'))
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100)
}
