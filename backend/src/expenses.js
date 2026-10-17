import { pool } from './db.js'
import { CURRENCIES, PAYMENT_TYPES, cents, dayOnly, oneOf, text, uuidOrNull } from './enums.js'
import { httpError } from './http.js'

export const EXPENSE_SELECT = `
  SELECT e.id, e.tenant_id, e.order_id, e.company_id, e.label, e.amount_cents,
         to_char(e.occurred_on, 'YYYY-MM-DD') AS occurred_on,
         e.payment_type, e.currency, e.created_at, e.updated_at,
         o.reference AS order_reference,
         c.name AS company_name, c.role AS company_role
  FROM order_expenses e
  LEFT JOIN orders o ON o.id = e.order_id
  LEFT JOIN companies c ON c.id = e.company_id`

export async function companyInTenant(id, tenantId) {
  const companyId = uuidOrNull(id)
  if (!companyId) return null
  const { rows } = await pool.query('SELECT id FROM companies WHERE id = $1 AND tenant_id = $2', [companyId, tenantId])
  if (!rows[0]) throw httpError(400, 'Company not found.')
  return rows[0].id
}

export async function orderInTenant(id, tenantId) {
  const orderId = uuidOrNull(id)
  if (!orderId) return null
  const { rows } = await pool.query('SELECT id FROM orders WHERE id = $1 AND tenant_id = $2', [orderId, tenantId])
  if (!rows[0]) throw httpError(400, 'Order not found.')
  return rows[0].id
}

export function todayStamp() {
  return dayOnly(new Date().toISOString().slice(0, 10), '1970-01-01')
}

export async function readExpenseFields(body, tenantId, { defaults = {} } = {}) {
  const label = body.label === undefined ? defaults.label : text(body.label, 160)
  const amountRaw = body.amountCents ?? body.amount_cents
  const amount_cents = amountRaw === undefined ? defaults.amount_cents : cents(amountRaw)
  const occurredRaw = body.occurredOn ?? body.occurred_on
  const occurred_on = occurredRaw === undefined ? defaults.occurred_on : (dayOnly(occurredRaw) || defaults.occurred_on)
  const paymentRaw = body.paymentType ?? body.payment_type
  const payment_type = paymentRaw === undefined ? defaults.payment_type : oneOf(paymentRaw, PAYMENT_TYPES, defaults.payment_type || 'cash')
  const currencyRaw = body.currency
  const currency = currencyRaw === undefined ? defaults.currency : oneOf(currencyRaw, CURRENCIES, defaults.currency || 'EUR')
  const companyRaw = body.companyId !== undefined ? body.companyId : body.company_id
  const company_id = companyRaw === undefined ? defaults.company_id : await companyInTenant(companyRaw, tenantId)
  const orderRaw = body.orderId !== undefined ? body.orderId : body.order_id
  const order_id = orderRaw === undefined ? defaults.order_id : await orderInTenant(orderRaw, tenantId)
  return { label, amount_cents, occurred_on, payment_type, currency, company_id, order_id }
}

export async function insertExpense(tenantId, fields) {
  const label = fields.label
  if (!label) throw httpError(400, 'Expense label is required.')
  const { rows } = await pool.query(
    `INSERT INTO order_expenses (
       tenant_id, order_id, company_id, label, amount_cents, occurred_on, payment_type, currency
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      tenantId,
      fields.order_id || null,
      fields.company_id || null,
      label,
      cents(fields.amount_cents),
      fields.occurred_on || todayStamp(),
      oneOf(fields.payment_type, PAYMENT_TYPES, 'cash'),
      oneOf(fields.currency, CURRENCIES, 'EUR'),
    ],
  )
  return loadExpense(rows[0].id, tenantId)
}

export async function updateExpense(id, tenantId, fields) {
  const sets = []
  const values = []
  for (const [column, value] of Object.entries(fields)) {
    if (value === undefined) continue
    values.push(value)
    sets.push(`${column} = $${values.length}`)
  }
  if (!sets.length) throw httpError(400, 'Nothing to update.')
  values.push(id, tenantId)
  const { rows } = await pool.query(
    `UPDATE order_expenses SET ${sets.join(', ')}, updated_at = now()
     WHERE id = $${values.length - 1} AND tenant_id = $${values.length}
     RETURNING id`,
    values,
  )
  if (!rows[0]) throw httpError(404, 'Expense not found.')
  return loadExpense(rows[0].id, tenantId)
}

export async function loadExpense(id, tenantId) {
  const { rows } = await pool.query(`${EXPENSE_SELECT} WHERE e.id = $1 AND e.tenant_id = $2`, [id, tenantId])
  if (!rows[0]) throw httpError(404, 'Expense not found.')
  return rows[0]
}

export function csvCell(value) {
  const text = value == null ? '' : String(value)
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}
