export const ORDER_STATUSES = ['booked', 'assigned', 'in_transit', 'delivered', 'invoiced', 'cancelled']
export const INVOICE_STATUSES = ['draft', 'sent', 'paid', 'overdue', 'void']
export const RELATION_STATUSES = ['planned', 'assigned', 'arrived', 'loaded', 'in_transit', 'delivered']
export const USER_ROLES = ['owner', 'dispatcher', 'sales', 'finance', 'driver']
export const COMPANY_ROLES = ['customer', 'carrier', 'both', 'broker']
export const PARTY_ROLES = ['customer', 'broker', 'carrier']
export const PROPERTY_TYPES = ['text', 'checkboxes', 'radio', 'number', 'select', 'multiselect']
export const WORKFLOW_OBJECTS = ['order', 'invoice', 'company', 'contact']
export const LOAD_TYPES = ['FTL', 'LTL', 'parcel']
export const CURRENCIES = ['EUR', 'PLN', 'RON', 'MDL', 'GBP', 'USD']
export const PAYMENT_TYPES = ['cash', 'card', 'wire', 'fuel_card', 'cheque', 'other']
export const VEHICLE_STATUSES = ['available', 'on_trip', 'maintenance']
export const DOC_KINDS = ['cmr', 'pod', 'insurance', 'customs', 'invoice', 'signature', 'other']

export function oneOf(value, allowed, fallback) {
  if (value == null || value === '') return fallback
  if (!allowed.includes(value)) {
    const error = new Error(`Expected one of: ${allowed.join(', ')}`)
    error.status = 400
    throw error
  }
  return value
}

export function text(value, max = 500) {
  if (value == null) return null
  const trimmed = String(value).trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

export function cents(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.round(n))
}

export function intOrNull(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.round(n)
}

export function dateOrNull(value) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

export function dayOnly(value, fallback = null) {
  const raw = String(value || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return fallback
  const [year, month, day] = raw.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return fallback
  return raw
}

export function uuidOrNull(value) {
  if (value == null || value === '') return null
  const id = String(value)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null
  return id
}

export function pageLimit(value, max = 50) {
  if (value == null || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.min(max, Math.max(1, Math.round(n)))
}
