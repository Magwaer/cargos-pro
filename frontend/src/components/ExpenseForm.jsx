import { Lookup } from './Lookup.jsx'
import { Field } from './ui.jsx'
import { eurosToCents } from '../format.js'

export const PAYMENT_TYPES = ['cash', 'card', 'wire', 'fuel_card', 'cheque', 'other']
export const EXPENSE_CURRENCIES = ['EUR', 'PLN', 'RON', 'MDL', 'GBP', 'USD']

export function todayIso() {
  const date = new Date()
  const pad = (part) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function emptyExpense(overrides = {}) {
  return {
    label: '',
    amount: '',
    occurredOn: todayIso(),
    paymentType: 'cash',
    currency: 'EUR',
    companyId: '',
    companyName: '',
    orderId: '',
    orderLabel: '',
    ...overrides,
  }
}

export function expenseToForm(row, fallbackCurrency = 'EUR') {
  const cents = Number(row.amount_cents) || 0
  return {
    label: row.label || '',
    amount: cents ? String(cents / 100) : '',
    occurredOn: String(row.occurred_on || '').slice(0, 10) || todayIso(),
    paymentType: row.payment_type || 'cash',
    currency: row.currency || fallbackCurrency,
    companyId: row.company_id || '',
    companyName: row.company_name || '',
    orderId: row.order_id || '',
    orderLabel: row.order_reference || '',
  }
}

export function expenseBody(form, { includeOrder = true } = {}) {
  const body = {
    label: form.label,
    amountCents: eurosToCents(form.amount),
    occurredOn: form.occurredOn,
    paymentType: form.paymentType,
    currency: form.currency,
    companyId: form.companyId || null,
  }
  if (includeOrder) body.orderId = form.orderId || null
  return body
}

export function ExpenseFields({ form, setForm, showOrder = false, t }) {
  return (
    <div className="form-grid">
      <Field label={t('expenseLabel')} wide>
        <input value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} required />
      </Field>
      <Field label={t('amount')}>
        <input value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} required />
      </Field>
      <Field label={t('currency')}>
        <select value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value })}>
          {EXPENSE_CURRENCIES.map((currency) => <option key={currency}>{currency}</option>)}
        </select>
      </Field>
      <Field label={t('expenseDate')}>
        <input type="date" value={form.occurredOn} onChange={(event) => setForm({ ...form, occurredOn: event.target.value })} required />
      </Field>
      <Field label={t('paymentType')}>
        <select value={form.paymentType} onChange={(event) => setForm({ ...form, paymentType: event.target.value })}>
          {PAYMENT_TYPES.map((type) => <option key={type} value={type}>{t(`pay_${type}`)}</option>)}
        </select>
      </Field>
      <Field label={t('optionalCompany')} wide>
        <Lookup
          kind="company"
          value={form.companyId}
          label={form.companyName}
          onChange={(id, item) => setForm({ ...form, companyId: id, companyName: item?.title || '' })}
        />
      </Field>
      {showOrder ? (
        <Field label={t('type_order')} wide>
          <Lookup
            kind="order"
            value={form.orderId}
            label={form.orderLabel}
            onChange={(id, item) => setForm({ ...form, orderId: id, orderLabel: item?.title || '' })}
          />
        </Field>
      ) : null}
    </div>
  )
}
