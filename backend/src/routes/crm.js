import { Router } from 'express'
import { pool } from '../db.js'
import { assertTrial, audit } from '../auth.js'
import { COMPANY_ROLES, intOrNull, oneOf, pageLimit, text, uuidOrNull } from '../enums.js'
import { asyncRoute, changes, httpError } from '../http.js'
import { emit } from '../workflow.js'

const router = Router()

function like(q) {
  if (!q) return null
  return `%${String(q).replace(/[%_]/g, '').trim()}%`
}

router.get('/companies', asyncRoute(async (req, res) => {
  const q = like(req.query.q)
  const role = req.query.role && COMPANY_ROLES.includes(req.query.role) ? req.query.role : null
  const limit = pageLimit(req.query.limit)
  const params = [req.user.tenantId, q, role]
  let sql = `SELECT c.*,
       (SELECT count(*)::int FROM contacts ct WHERE ct.company_id = c.id) AS contact_count,
       (SELECT count(*)::int FROM orders o WHERE o.company_id = c.id) AS order_count
     FROM companies c
     WHERE c.tenant_id = $1
       AND ($2::text IS NULL OR c.name ILIKE $2 OR c.city ILIKE $2 OR c.vat ILIKE $2 OR c.vat_eu ILIKE $2)
       AND ($3::text IS NULL OR c.role = $3 OR ($3 IN ('customer','carrier') AND c.role = 'both'))
     ORDER BY c.name`
  if (limit) {
    params.push(limit)
    sql += ` LIMIT $${params.length}`
  }
  const { rows } = await pool.query(sql, params)
  res.json({ data: rows })
}))

router.post('/companies', asyncRoute(async (req, res) => {
  await assertTrial(req.user.tenantId)
  const name = text(req.body.name, 180)
  if (!name) throw httpError(400, 'Company name is required.')
  const { rows } = await pool.query(
    `INSERT INTO companies (tenant_id, name, role, email, phone, vat, vat_eu, city, country, payment_terms_days, rating, insurance_expires, warning, blacklisted, qbo_customer_id, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [
      req.user.tenantId, name, oneOf(req.body.role, COMPANY_ROLES, 'customer'), text(req.body.email, 180),
      text(req.body.phone, 40), text(req.body.vat, 40), text(req.body.vatEu ?? req.body.vat_eu, 40),
      text(req.body.city, 80), text(req.body.country, 8),
      intOrNull(req.body.paymentTermsDays) ?? 14, req.body.rating === '' || req.body.rating == null ? null : Number(req.body.rating),
      req.body.insuranceExpires || null, Boolean(req.body.warning), Boolean(req.body.blacklisted),
      text(req.body.qboCustomerId, 40), text(req.body.notes, 4000),
    ],
  )
  await audit(req, 'create', 'company', rows[0].id, { name })
  await emit(req.user.tenantId, 'company', 'created', rows[0], null, 0, req.user.id)
  res.status(201).json(rows[0])
}))

router.get('/companies/:id', asyncRoute(async (req, res) => {
  const found = await pool.query('SELECT * FROM companies WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user.tenantId])
  const company = found.rows[0]
  if (!company) throw httpError(404, 'Company not found.')
  const [contacts, orders, activities] = await Promise.all([
    pool.query('SELECT * FROM contacts WHERE company_id = $1 AND tenant_id = $2 ORDER BY name', [company.id, req.user.tenantId]),
    pool.query(
      `SELECT DISTINCT o.*
       FROM orders o
       LEFT JOIN order_parties p ON p.order_id = o.id
       WHERE o.tenant_id = $2 AND (o.company_id = $1 OR p.company_id = $1)
       ORDER BY o.created_at DESC`,
      [company.id, req.user.tenantId],
    ),
    pool.query(
      `SELECT a.*, u.name AS owner_name FROM activities a
       LEFT JOIN users u ON u.id = a.owner_id
       WHERE a.tenant_id = $1 AND a.object_type = 'company' AND a.object_id = $2
       ORDER BY a.created_at DESC`,
      [req.user.tenantId, company.id],
    ),
  ])
  res.json({ ...company, contacts: contacts.rows, orders: orders.rows, activities: activities.rows })
}))

router.patch('/companies/:id', asyncRoute(async (req, res) => {
  const spec = {
    name: (v) => text(v, 180),
    role: (v) => oneOf(v, COMPANY_ROLES, 'customer'),
    email: (v) => text(v, 180),
    phone: (v) => text(v, 40),
    vat: (v) => text(v, 40),
    vat_eu: (v) => text(v, 40),
    city: (v) => text(v, 80),
    country: (v) => text(v, 8),
    payment_terms_days: (v) => intOrNull(v) ?? 14,
    rating: (v) => (v === '' || v == null ? null : Number(v)),
    insurance_expires: (v) => v || null,
    warning: (v) => Boolean(v),
    blacklisted: (v) => Boolean(v),
    qbo_customer_id: (v) => text(v, 40),
    notes: (v) => text(v, 4000),
  }
  const body = {
    ...req.body,
    payment_terms_days: req.body.paymentTermsDays ?? req.body.payment_terms_days,
    vat_eu: req.body.vatEu ?? req.body.vat_eu,
    insurance_expires: req.body.insuranceExpires ?? req.body.insurance_expires,
    qbo_customer_id: req.body.qboCustomerId ?? req.body.qbo_customer_id,
  }
  const { values, sets } = changes(body, spec)
  if (!sets.length) throw httpError(400, 'Nothing to update.')
  values.push(req.params.id, req.user.tenantId)
  const { rows } = await pool.query(
    `UPDATE companies SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length - 1} AND tenant_id = $${values.length} RETURNING *`,
    values,
  )
  if (!rows[0]) throw httpError(404, 'Company not found.')
  await audit(req, 'update', 'company', rows[0].id)
  await emit(req.user.tenantId, 'company', 'updated', rows[0], null, 0, req.user.id)
  res.json(rows[0])
}))

router.delete('/companies/:id', asyncRoute(async (req, res) => {
  const used = await pool.query(
    `SELECT 1 FROM orders WHERE company_id = $1 AND tenant_id = $2
     UNION ALL
     SELECT 1 FROM order_parties WHERE company_id = $1 AND tenant_id = $2
     LIMIT 1`,
    [req.params.id, req.user.tenantId],
  )
  if (used.rowCount) throw httpError(409, 'This company still has orders.')
  const { rowCount } = await pool.query('DELETE FROM companies WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user.tenantId])
  if (!rowCount) throw httpError(404, 'Company not found.')
  await audit(req, 'delete', 'company', req.params.id)
  res.json({ ok: true })
}))

router.get('/contacts', asyncRoute(async (req, res) => {
  const q = like(req.query.q)
  const companyId = uuidOrNull(req.query.companyId)
  const limit = pageLimit(req.query.limit)
  const params = [req.user.tenantId, q, companyId]
  let sql = `SELECT ct.*, c.name AS company_name, c.role AS company_role
     FROM contacts ct LEFT JOIN companies c ON c.id = ct.company_id
     WHERE ct.tenant_id = $1
       AND ($2::text IS NULL OR ct.name ILIKE $2 OR ct.email ILIKE $2 OR ct.phone ILIKE $2 OR ct.mobile ILIKE $2 OR c.name ILIKE $2)
       AND ($3::uuid IS NULL OR ct.company_id = $3)
     ORDER BY ct.name`
  if (limit) {
    params.push(limit)
    sql += ` LIMIT $${params.length}`
  }
  const { rows } = await pool.query(sql, params)
  res.json({ data: rows })
}))

router.post('/contacts', asyncRoute(async (req, res) => {
  await assertTrial(req.user.tenantId)
  const name = text(req.body.name, 160)
  if (!name) throw httpError(400, 'Contact name is required.')
  const { rows } = await pool.query(
    `INSERT INTO contacts (tenant_id, company_id, name, email, phone, mobile, fax, title)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      req.user.tenantId, req.body.companyId || null, name,
      text(req.body.email, 180), text(req.body.phone, 40), text(req.body.mobile, 40),
      text(req.body.fax, 40), text(req.body.title, 120),
    ],
  )
  await audit(req, 'create', 'contact', rows[0].id, { name })
  await emit(req.user.tenantId, 'contact', 'created', rows[0], null, 0, req.user.id)
  res.status(201).json(rows[0])
}))

router.get('/contacts/:id', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ct.*, c.name AS company_name, c.role AS company_role, c.email AS company_email,
            c.phone AS company_phone, c.city, c.country, c.payment_terms_days
     FROM contacts ct
     LEFT JOIN companies c ON c.id = ct.company_id
     WHERE ct.id = $1 AND ct.tenant_id = $2`,
    [req.params.id, req.user.tenantId],
  )
  const contact = rows[0]
  if (!contact) throw httpError(404, 'Contact not found.')
  const [orders, activities] = await Promise.all([
    pool.query(
      `SELECT DISTINCT o.*
       FROM orders o
       LEFT JOIN order_parties p ON p.order_id = o.id
       WHERE o.tenant_id = $2
         AND (p.contact_id = $1 OR o.company_id = $3 OR p.company_id = $3)
       ORDER BY o.created_at DESC`,
      [contact.id, req.user.tenantId, contact.company_id],
    ),
    pool.query(
      `SELECT a.*, u.name AS owner_name FROM activities a
       LEFT JOIN users u ON u.id = a.owner_id
       WHERE a.tenant_id = $1 AND a.object_type = 'contact' AND a.object_id = $2
       ORDER BY a.created_at DESC`,
      [req.user.tenantId, contact.id],
    ),
  ])
  res.json({ ...contact, orders: orders.rows, activities: activities.rows })
}))

router.patch('/contacts/:id', asyncRoute(async (req, res) => {
  const body = { ...req.body, company_id: req.body.companyId ?? req.body.company_id }
  const { values, sets } = changes(body, {
    company_id: (v) => v || null,
    name: (v) => text(v, 160),
    email: (v) => text(v, 180),
    phone: (v) => text(v, 40),
    mobile: (v) => text(v, 40),
    fax: (v) => text(v, 40),
    title: (v) => text(v, 120),
  })
  if (!sets.length) throw httpError(400, 'Nothing to update.')
  values.push(req.params.id, req.user.tenantId)
  const { rows } = await pool.query(
    `UPDATE contacts SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length - 1} AND tenant_id = $${values.length} RETURNING *`,
    values,
  )
  if (!rows[0]) throw httpError(404, 'Contact not found.')
  await emit(req.user.tenantId, 'contact', 'updated', rows[0], null, 0, req.user.id)
  res.json(rows[0])
}))

router.delete('/contacts/:id', asyncRoute(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM contacts WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user.tenantId])
  if (!rowCount) throw httpError(404, 'Contact not found.')
  res.json({ ok: true })
}))

router.get('/addresses', asyncRoute(async (req, res) => {
  const q = like(req.query.q)
  const { rows } = await pool.query(
    `SELECT * FROM addresses WHERE tenant_id = $1 AND ($2::text IS NULL OR label ILIKE $2) ORDER BY label LIMIT 20`,
    [req.user.tenantId, q],
  )
  res.json({ data: rows })
}))

export async function nextReference(tenantId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(reference FROM '[0-9]+$') AS INT)), 24020) AS n
     FROM orders WHERE tenant_id = $1`,
    [tenantId],
  )
  return `NL-${Number(rows[0].n) + 1}`
}

export async function rememberAddress(tenantId, companyId, label) {
  if (!label) return
  await pool.query(
    `INSERT INTO addresses (tenant_id, company_id, label) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [tenantId, companyId || null, label],
  )
}

export default router
