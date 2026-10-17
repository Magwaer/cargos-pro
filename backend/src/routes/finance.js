import crypto from 'node:crypto'
import { Router } from 'express'
import { pool } from '../db.js'
import { audit } from '../auth.js'
import { CURRENCIES, INVOICE_STATUSES, PAYMENT_TYPES, cents, dayOnly, oneOf, text, uuidOrNull } from '../enums.js'
import { EXPENSE_SELECT, csvCell, insertExpense, readExpenseFields, updateExpense } from '../expenses.js'
import { asyncRoute, changes, httpError } from '../http.js'
import { renderInvoicePdf } from '../invoicePdf.js'
import { publicUrl, pushInvoiceToQuickbooks, sendGmail } from '../integrations.js'
import { notify } from '../notify.js'
import { emit } from '../workflow.js'

const router = Router()

const INVOICE_DETAIL = `
  SELECT i.*, c.name AS company_name, c.email AS company_email, c.phone AS company_phone,
         c.vat AS company_vat, c.city AS company_city, c.country AS company_country,
         o.reference, o.origin, o.destination, o.cargo, o.load_type,
         t.name AS tenant_name,
         COALESCE(NULLIF(btrim(t.legal_name), ''), t.name) AS issuer_name,
         t.address AS issuer_address, t.city AS issuer_city, t.country AS issuer_country,
         t.vat AS issuer_vat, t.email AS issuer_email, t.phone AS issuer_phone,
         t.bank_name AS issuer_bank, t.iban AS issuer_iban, t.swift AS issuer_swift,
         t.invoice_footer AS issuer_footer
  FROM invoices i
  LEFT JOIN companies c ON c.id = i.company_id
  JOIN tenants t ON t.id = i.tenant_id
  LEFT JOIN orders o ON o.id = i.order_id`

function calendarDay(value) {
  if (!value) return ''
  if (value instanceof Date) {
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const date = String(value.getDate()).padStart(2, '0')
    return `${value.getFullYear()}-${month}-${date}`
  }
  return String(value).slice(0, 10)
}

function presentInvoice(row) {
  const { public_token: token, ...rest } = row
  return { ...rest, public_url: token ? `${publicUrl()}/i/${token}` : null }
}

async function ensurePublicToken(row) {
  if (row.public_token) return row.public_token
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = crypto.randomBytes(18).toString('base64url')
    try {
      const { rows } = await pool.query(
        `UPDATE invoices SET public_token = $2, updated_at = now()
         WHERE id = $1 AND public_token IS NULL RETURNING public_token`,
        [row.id, token],
      )
      if (rows[0]) return rows[0].public_token
      const again = await pool.query('SELECT public_token FROM invoices WHERE id = $1', [row.id])
      if (again.rows[0]?.public_token) return again.rows[0].public_token
    } catch (err) {
      if (err.code !== '23505') throw err
    }
  }
  throw httpError(500, 'Could not create a public link.')
}

async function loadInvoice(tenantId, id) {
  const { rows } = await pool.query(`${INVOICE_DETAIL} WHERE i.tenant_id = $1 AND i.id = $2`, [tenantId, id])
  if (!rows[0]) throw httpError(404, 'Invoice not found.')
  rows[0].public_token = await ensurePublicToken(rows[0])
  return rows[0]
}

async function loadPublicInvoice(token) {
  const { rows } = await pool.query(`${INVOICE_DETAIL} WHERE i.public_token = $1`, [token])
  if (!rows[0]) throw httpError(404, 'Invoice not found.')
  return rows[0]
}

function sendPdf(res, invoice) {
  const pdf = renderInvoicePdf(invoice)
  const name = `${invoice.number || 'invoice'}.pdf`.replace(/[^\w.-]+/g, '-')
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
  res.send(pdf)
}

function publicView(row) {
  return {
    number: row.number,
    status: row.status,
    amount_cents: row.amount_cents,
    currency: row.currency,
    issued_at: row.issued_at,
    due_at: row.due_at,
    paid_at: row.paid_at,
    company_name: row.company_name,
    company_city: row.company_city,
    company_country: row.company_country,
    company_vat: row.company_vat,
    reference: row.reference,
    origin: row.origin,
    destination: row.destination,
    cargo: row.cargo,
    tenant_name: row.tenant_name,
    issuer_name: row.issuer_name,
    issuer_address: row.issuer_address,
    issuer_city: row.issuer_city,
    issuer_country: row.issuer_country,
    issuer_vat: row.issuer_vat,
    issuer_email: row.issuer_email,
    issuer_phone: row.issuer_phone,
    issuer_bank: row.issuer_bank,
    issuer_iban: row.issuer_iban,
    issuer_swift: row.issuer_swift,
    issuer_footer: row.issuer_footer,
  }
}

router.get('/invoices/aging', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT
       CASE
         WHEN due_at IS NULL OR due_at >= CURRENT_DATE THEN 'current'
         WHEN due_at >= CURRENT_DATE - 30 THEN '1-30'
         WHEN due_at >= CURRENT_DATE - 60 THEN '31-60'
         WHEN due_at >= CURRENT_DATE - 90 THEN '61-90'
         ELSE '90+'
       END AS bucket,
       count(*)::int AS count,
       COALESCE(SUM(amount_cents), 0)::int AS amount_cents
     FROM invoices
     WHERE tenant_id = $1 AND status IN ('sent','overdue')
     GROUP BY 1`,
    [req.user.tenantId],
  )
  res.json({ data: rows })
}))

router.get('/invoices', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT i.*, c.name AS company_name, o.reference
     FROM invoices i
     LEFT JOIN companies c ON c.id = i.company_id
     LEFT JOIN orders o ON o.id = i.order_id
     WHERE i.tenant_id = $1
     ORDER BY i.created_at DESC`,
    [req.user.tenantId],
  )
  res.json({ data: rows })
}))

router.get('/invoices/:id/pdf', asyncRoute(async (req, res) => {
  sendPdf(res, await loadInvoice(req.user.tenantId, req.params.id))
}))

router.get('/invoices/:id', asyncRoute(async (req, res) => {
  res.json(presentInvoice(await loadInvoice(req.user.tenantId, req.params.id)))
}))

router.post('/invoices/:id/share', asyncRoute(async (req, res) => {
  const invoice = await loadInvoice(req.user.tenantId, req.params.id)
  res.json({ url: presentInvoice(invoice).public_url })
}))

router.post('/invoices/:id/email', asyncRoute(async (req, res) => {
  const invoice = await loadInvoice(req.user.tenantId, req.params.id)
  const to = text(req.body?.email, 200) || invoice.company_email
  if (!to || !to.includes('@')) throw httpError(400, 'Enter an email address.')
  const url = presentInvoice(invoice).public_url
  const due = invoice.due_at ? ` It is due ${calendarDay(invoice.due_at)}.` : ''
  const amount = ((invoice.amount_cents || 0) / 100).toFixed(2)
  const result = await sendGmail(req.user.tenantId, {
    to,
    subject: `Invoice ${invoice.number} from ${invoice.issuer_name || invoice.tenant_name}`,
    body: `Hello,\n\n${invoice.issuer_name || invoice.tenant_name} sent invoice ${invoice.number} for ${amount} ${invoice.currency}.${due}\n\nView or download it here: ${url}\n`,
  })
  if (!result.sent) throw httpError(409, result.reason || 'The email could not be sent.')
  if (invoice.status === 'draft') {
    const { rows } = await pool.query(
      `UPDATE invoices SET status = 'sent', updated_at = now() WHERE id = $1 AND status = 'draft' RETURNING *`,
      [invoice.id],
    )
    if (rows[0]) {
      await emit(req.user.tenantId, 'invoice', 'property_changed', rows[0], invoice, 0, req.user.id)
    }
  }
  await pool.query(
    `INSERT INTO activities (tenant_id, object_type, object_id, kind, title, body, created_by)
     VALUES ($1, 'invoice', $2, 'email', $3, $4, $5)`,
    [req.user.tenantId, invoice.id, `Emailed ${invoice.number}`, to, req.user.id],
  )
  await audit(req, 'invoice.email', 'invoice', invoice.id, { to })
  res.json(presentInvoice(await loadInvoice(req.user.tenantId, invoice.id)))
}))

export const publicInvoice = asyncRoute(async (req, res) => {
  res.json(publicView(await loadPublicInvoice(req.params.token)))
})

export const publicInvoicePdf = asyncRoute(async (req, res) => {
  sendPdf(res, await loadPublicInvoice(req.params.token))
})

router.post('/invoices', asyncRoute(async (req, res) => {
  const companyId = req.body.companyId || null
  const count = await pool.query('SELECT count(*)::int AS n FROM invoices WHERE tenant_id = $1', [req.user.tenantId])
  const number = text(req.body.number, 40) || `INV-${1001 + count.rows[0].n}`
  const issued = req.body.issuedAt || new Date().toISOString().slice(0, 10)
  const due = req.body.dueAt || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
  const { rows } = await pool.query(
    `INSERT INTO invoices (tenant_id, company_id, order_id, number, status, amount_cents, currency, issued_at, due_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      req.user.tenantId, companyId, req.body.orderId || null, number,
      oneOf(req.body.status, INVOICE_STATUSES, 'draft'), cents(req.body.amountCents),
      oneOf(req.body.currency, CURRENCIES, 'EUR'), issued, due,
    ],
  )
  await audit(req, 'create', 'invoice', rows[0].id, { number })
  await emit(req.user.tenantId, 'invoice', 'created', rows[0], null, 0, req.user.id)
  res.status(201).json(rows[0])
}))

router.patch('/invoices/:id', asyncRoute(async (req, res) => {
  const current = (await pool.query('SELECT * FROM invoices WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user.tenantId])).rows[0]
  if (!current) throw httpError(404, 'Invoice not found.')
  const body = { ...req.body, amount_cents: req.body.amountCents ?? req.body.amount_cents, due_at: req.body.dueAt ?? req.body.due_at }
  const { values, sets } = changes(body, {
    status: (v) => oneOf(v, INVOICE_STATUSES, current.status),
    amount_cents: (v) => cents(v),
    due_at: (v) => v || null,
  })
  if (body.status === 'paid') sets.push('paid_at = COALESCE(paid_at, CURRENT_DATE)')
  if (!sets.length) throw httpError(400, 'Nothing to update.')
  values.push(req.params.id, req.user.tenantId)
  const { rows } = await pool.query(
    `UPDATE invoices SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length - 1} AND tenant_id = $${values.length} RETURNING *`,
    values,
  )
  const company = rows[0].company_id
    ? (await pool.query('SELECT email, phone, name FROM companies WHERE id = $1', [rows[0].company_id])).rows[0]
    : null
  await emit(
    req.user.tenantId,
    'invoice',
    'property_changed',
    { ...rows[0], email: company?.email || null, phone: company?.phone || null },
    current,
    0,
    req.user.id,
  )
  if (rows[0].status === 'paid' && current.status !== 'paid') {
    await notify(req.user.tenantId, {
      kind: 'invoice_paid',
      title: rows[0].number,
      body: company?.name || '',
      href: `/invoices/${rows[0].id}`,
    })
  }
  res.json(rows[0])
}))

function expenseWhere(req) {
  const values = [req.user.tenantId]
  const clauses = ['e.tenant_id = $1']
  const from = dayOnly(req.query.from)
  const to = dayOnly(req.query.to)
  if (from) {
    values.push(from)
    clauses.push(`e.occurred_on >= $${values.length}`)
  }
  if (to) {
    values.push(to)
    clauses.push(`e.occurred_on <= $${values.length}`)
  }
  const q = String(req.query.q || '').replace(/[%_]/g, '').trim()
  if (q) {
    values.push(`%${q}%`)
    clauses.push(`(e.label ILIKE $${values.length} OR o.reference ILIKE $${values.length} OR c.name ILIKE $${values.length})`)
  }
  const payment = req.query.paymentType || req.query.payment_type
  if (payment && PAYMENT_TYPES.includes(payment)) {
    values.push(payment)
    clauses.push(`e.payment_type = $${values.length}`)
  }
  const currency = req.query.currency
  if (currency && CURRENCIES.includes(currency)) {
    values.push(currency)
    clauses.push(`e.currency = $${values.length}`)
  }
  const companyId = uuidOrNull(req.query.companyId)
  if (companyId) {
    values.push(companyId)
    clauses.push(`e.company_id = $${values.length}`)
  }
  const orderId = uuidOrNull(req.query.orderId)
  if (orderId) {
    values.push(orderId)
    clauses.push(`e.order_id = $${values.length}`)
  }
  if (req.query.kind === 'generic') clauses.push('e.order_id IS NULL')
  if (req.query.kind === 'order') clauses.push('e.order_id IS NOT NULL')
  return { values, where: clauses.join(' AND ') }
}

function fillDays(from, to, rows) {
  if (!from || !to) return [...rows].sort((a, b) => a.day.localeCompare(b.day))
  const startMs = Date.parse(`${from}T00:00:00Z`)
  const endMs = Date.parse(`${to}T00:00:00Z`)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs || (endMs - startMs) / 86400000 > 366) {
    return [...rows].sort((a, b) => a.day.localeCompare(b.day))
  }
  const byDay = new Map(rows.map((row) => [row.day, row]))
  const days = []
  const cursor = new Date(`${from}T00:00:00Z`)
  const last = new Date(`${to}T00:00:00Z`)
  while (cursor <= last) {
    const day = cursor.toISOString().slice(0, 10)
    const row = byDay.get(day)
    days.push({ day, amount_cents: row?.amount_cents || 0, count: row?.count || 0 })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return days
}

function presentExpenses(rows, query) {
  const totalsMap = new Map()
  const payMap = new Map()
  for (const row of rows) {
    const total = totalsMap.get(row.currency) || { currency: row.currency, amount_cents: 0, count: 0 }
    total.amount_cents += Number(row.amount_cents) || 0
    total.count += 1
    totalsMap.set(row.currency, total)
    const pay = payMap.get(row.payment_type) || { payment_type: row.payment_type, amount_cents: 0, count: 0 }
    pay.amount_cents += Number(row.amount_cents) || 0
    pay.count += 1
    payMap.set(row.payment_type, pay)
  }
  const totals = [...totalsMap.values()].sort((a, b) => b.amount_cents - a.amount_cents)
  const currency = totals[0]?.currency || 'EUR'
  const dayMap = new Map()
  for (const row of rows) {
    if (row.currency !== currency) continue
    const key = row.occurred_on
    const current = dayMap.get(key) || { day: key, amount_cents: 0, count: 0 }
    current.amount_cents += Number(row.amount_cents) || 0
    current.count += 1
    dayMap.set(key, current)
  }
  return {
    data: rows,
    totals,
    byPayment: [...payMap.values()].sort((a, b) => b.amount_cents - a.amount_cents),
    days: fillDays(dayOnly(query.from), dayOnly(query.to), [...dayMap.values()]),
    currency,
  }
}

router.get('/expenses', asyncRoute(async (req, res) => {
  const { values, where } = expenseWhere(req)
  const { rows } = await pool.query(
    `${EXPENSE_SELECT} WHERE ${where} ORDER BY e.occurred_on DESC, e.created_at DESC`,
    values,
  )
  res.json(presentExpenses(rows, req.query))
}))

router.get('/expenses/export.csv', asyncRoute(async (req, res) => {
  const { values, where } = expenseWhere(req)
  const { rows } = await pool.query(
    `${EXPENSE_SELECT} WHERE ${where} ORDER BY e.occurred_on DESC, e.created_at DESC`,
    values,
  )
  const header = ['date', 'label', 'amount', 'currency', 'payment_type', 'order', 'company']
  const lines = [header.join(',')]
  for (const row of rows) {
    lines.push([
      csvCell(row.occurred_on),
      csvCell(row.label),
      csvCell(((Number(row.amount_cents) || 0) / 100).toFixed(2)),
      csvCell(row.currency),
      csvCell(row.payment_type),
      csvCell(row.order_reference || ''),
      csvCell(row.company_name || ''),
    ].join(','))
  }
  const from = dayOnly(req.query.from) || 'all'
  const to = dayOnly(req.query.to) || 'all'
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="expenses-${from}-${to}.csv"`)
  res.send(`\uFEFF${lines.join('\n')}\n`)
}))

router.post('/expenses', asyncRoute(async (req, res) => {
  const fields = await readExpenseFields(req.body, req.user.tenantId, {
    defaults: { occurred_on: new Date().toISOString().slice(0, 10), payment_type: 'cash', currency: 'EUR' },
  })
  res.status(201).json(await insertExpense(req.user.tenantId, fields))
}))

router.patch('/expenses/:id', asyncRoute(async (req, res) => {
  const fields = await readExpenseFields(req.body, req.user.tenantId)
  if (req.body.label !== undefined && !fields.label) throw httpError(400, 'Expense label is required.')
  res.json(await updateExpense(req.params.id, req.user.tenantId, fields))
}))

router.delete('/expenses/:id', asyncRoute(async (req, res) => {
  const { rowCount } = await pool.query(
    'DELETE FROM order_expenses WHERE id = $1 AND tenant_id = $2',
    [req.params.id, req.user.tenantId],
  )
  if (!rowCount) throw httpError(404, 'Expense not found.')
  res.json({ ok: true })
}))

router.post('/invoices/:id/quickbooks', asyncRoute(async (req, res) => {
  const invoice = (await pool.query('SELECT * FROM invoices WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user.tenantId])).rows[0]
  if (!invoice) throw httpError(404, 'Invoice not found.')
  const company = invoice.company_id
    ? (await pool.query('SELECT * FROM companies WHERE id = $1', [invoice.company_id])).rows[0]
    : null
  const result = await pushInvoiceToQuickbooks(req.user.tenantId, invoice, company)
  if (!result.synced) throw httpError(409, result.reason)
  await audit(req, 'sync', 'invoice', invoice.id, result)
  res.json(result)
}))

export default router
