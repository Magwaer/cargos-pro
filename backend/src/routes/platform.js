import crypto from 'crypto'
import { Router } from 'express'
import Stripe from 'stripe'
import { pool } from '../db.js'
import { assertTrial, audit, hashApiKey, signUser } from '../auth.js'
import { USER_ROLES, WORKFLOW_OBJECTS, oneOf, text } from '../enums.js'
import { asyncRoute, httpError } from '../http.js'
import {
  connectTwilio,
  getIntegration,
  googleStartUrl,
  integrationCatalog,
  openTwilioRecording,
  publicTwilio,
  quickbooksStartUrl,
  replySms,
  smsForCompany,
  smsInbox,
  smsThread,
  twilioLog,
} from '../integrations.js'
import { publish, subscribe } from '../notify.js'
import { deleteObject, getObject, spacesConfigured } from '../spaces.js'
import { storeDocument, upload } from '../uploads.js'

const router = Router()

router.get('/dashboard', asyncRoute(async (req, res) => {
  const tenantId = req.user.tenantId
  const [openOrders, openTasks, onTime, overdue, margin, byStatus, recent, tasks, fleet] = await Promise.all([
    pool.query(`SELECT count(*)::int AS n FROM orders WHERE tenant_id = $1 AND status IN ('booked','assigned','in_transit')`, [tenantId]),
    pool.query(`SELECT count(*)::int AS n FROM activities WHERE tenant_id = $1 AND kind = 'task' AND done = false`, [tenantId]),
    pool.query(
      `SELECT count(*) FILTER (WHERE delivered_at IS NOT NULL AND (delivery_at IS NULL OR delivered_at <= delivery_at))::int AS on_time,
              count(*) FILTER (WHERE status IN ('delivered','invoiced'))::int AS delivered
       FROM orders WHERE tenant_id = $1`,
      [tenantId],
    ),
    pool.query(
      `SELECT COALESCE(SUM(amount_cents),0)::int AS amount, count(*)::int AS n,
              (ARRAY_AGG(number ORDER BY due_at NULLS LAST, number))[1] AS sample,
              (ARRAY_AGG(id ORDER BY due_at NULLS LAST, number))[1] AS sample_id
       FROM invoices WHERE tenant_id = $1 AND status = 'overdue'`,
      [tenantId],
    ),
    pool.query(
      `SELECT COALESCE(SUM(o.price_cents),0)::int AS revenue,
              COALESCE(SUM((SELECT SUM(e.amount_cents) FROM order_expenses e WHERE e.order_id = o.id)),0)::int AS cost
       FROM orders o WHERE o.tenant_id = $1 AND o.status NOT IN ('cancelled')`,
      [tenantId],
    ),
    pool.query(`SELECT status, count(*)::int AS n FROM orders WHERE tenant_id = $1 GROUP BY status`, [tenantId]),
    pool.query(
      `SELECT o.id, o.reference, o.status, o.origin, o.destination, o.price_cents, o.currency, c.name AS company_name
       FROM orders o LEFT JOIN companies c ON c.id = o.company_id
       WHERE o.tenant_id = $1 ORDER BY o.created_at DESC LIMIT 6`,
      [tenantId],
    ),
    pool.query(
      `SELECT a.*, u.name AS owner_name,
              CASE
                WHEN a.object_type = 'order' THEN a.object_id
                WHEN a.object_type = 'invoice' THEN (SELECT order_id FROM invoices WHERE id = a.object_id)
                WHEN a.object_type = 'company' THEN (
                  SELECT o.id FROM orders o
                  LEFT JOIN order_parties p ON p.order_id = o.id AND p.company_id = a.object_id
                  WHERE o.tenant_id = a.tenant_id AND (o.company_id = a.object_id OR p.company_id = a.object_id)
                  ORDER BY o.created_at DESC LIMIT 1
                )
                ELSE (
                  SELECT o.id FROM orders o
                  WHERE o.tenant_id = a.tenant_id
                    AND (
                      (o.reference IS NOT NULL AND a.title ILIKE '%' || o.reference || '%')
                      OR (
                        o.origin IS NOT NULL AND o.destination IS NOT NULL
                        AND a.title ILIKE '%' || split_part(o.origin, ',', 1) || '%'
                        AND a.title ILIKE '%' || split_part(o.destination, ',', 1) || '%'
                      )
                    )
                  ORDER BY o.created_at DESC LIMIT 1
                )
              END AS order_id
       FROM activities a
       LEFT JOIN users u ON u.id = a.owner_id
       WHERE a.tenant_id = $1 AND a.kind = 'task' AND a.done = false
       ORDER BY a.due_at NULLS LAST LIMIT 6`,
      [tenantId],
    ),
    pool.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'on_trip')::int AS on_trip,
              count(*) FILTER (WHERE status = 'available')::int AS available,
              count(*) FILTER (WHERE status = 'maintenance')::int AS maintenance
       FROM vehicles WHERE tenant_id = $1`,
      [tenantId],
    ),
  ])
  const delivered = onTime.rows[0].delivered || 0
  res.json({
    openOrders: openOrders.rows[0].n,
    openTasks: openTasks.rows[0].n,
    pipelineCents: 0,
    pipelineCount: openTasks.rows[0].n,
    onTimePct: delivered ? Math.round((onTime.rows[0].on_time / delivered) * 100) : null,
    overdueCents: overdue.rows[0].amount,
    overdueCount: overdue.rows[0].n,
    overdueNumber: overdue.rows[0].sample,
    overdueId: overdue.rows[0].sample_id,
    revenueCents: margin.rows[0].revenue,
    costCents: margin.rows[0].cost,
    marginCents: margin.rows[0].revenue - margin.rows[0].cost,
    ordersByStatus: byStatus.rows,
    pipeline: [],
    recentOrders: recent.rows,
    tasks: tasks.rows,
    fleet: fleet.rows[0],
  })
}))

router.get('/reports', asyncRoute(async (req, res) => {
  const tenantId = req.user.tenantId
  const [profit, aging, utilization] = await Promise.all([
    pool.query(
      `SELECT o.id, o.reference, o.status, c.name AS company_name, o.price_cents, o.currency,
              COALESCE((SELECT SUM(amount_cents) FROM order_expenses e WHERE e.order_id = o.id),0)::int AS cost_cents
       FROM orders o LEFT JOIN companies c ON c.id = o.company_id
       WHERE o.tenant_id = $1 AND o.status <> 'cancelled'
       ORDER BY o.created_at DESC`,
      [tenantId],
    ),
    pool.query(
      `SELECT status, count(*)::int AS n, COALESCE(SUM(amount_cents),0)::int AS amount_cents
       FROM invoices WHERE tenant_id = $1 GROUP BY status`,
      [tenantId],
    ),
    pool.query(
      `SELECT status, count(*)::int AS n FROM vehicles WHERE tenant_id = $1 GROUP BY status`,
      [tenantId],
    ),
  ])
  res.json({ profit: profit.rows, invoices: aging.rows, fleet: utilization.rows })
}))

function calendarDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null
  const [year, month, day] = String(value).split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return String(value)
}

function paidRange(fromValue, toValue) {
  let from = calendarDay(fromValue)
  let to = calendarDay(toValue)
  if (!from || !to) throw httpError(400, 'Choose a start and end date.')
  if (from > to) [from, to] = [to, from]
  const [y1, m1, d1] = from.split('-').map(Number)
  const [y2, m2, d2] = to.split('-').map(Number)
  const span = Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000)
  if (span > 365) throw httpError(400, 'Choose a range of 366 days or fewer.')
  return { from, to }
}

router.get('/reports/paid', asyncRoute(async (req, res) => {
  const range = paidRange(req.query.from, req.query.to)
  const { rows } = await pool.query(
    `SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
            COALESCE(p.price_cents, 0)::int AS price_cents,
            COALESCE(p.margin_cents, 0)::int AS margin_cents,
            COALESCE(p.invoices, 0)::int AS invoices
     FROM generate_series($2::date, $3::date, '1 day') AS d(day)
     LEFT JOIN (
       SELECT i.paid_at AS day,
              SUM(i.amount_cents)::int AS price_cents,
              SUM(i.amount_cents - COALESCE(c.cost_cents, 0))::int AS margin_cents,
              count(*)::int AS invoices
       FROM invoices i
       LEFT JOIN (
         SELECT order_id, SUM(amount_cents)::int AS cost_cents
         FROM order_expenses GROUP BY order_id
       ) c ON c.order_id = i.order_id
       WHERE i.tenant_id = $1 AND i.status = 'paid' AND i.paid_at BETWEEN $2::date AND $3::date
       GROUP BY i.paid_at
     ) p ON p.day = d.day
     ORDER BY d.day`,
    [req.user.tenantId, range.from, range.to],
  )
  const currency = await pool.query(
    `SELECT currency FROM invoices
     WHERE tenant_id = $1 AND status = 'paid' AND paid_at BETWEEN $2::date AND $3::date
     GROUP BY currency ORDER BY count(*) DESC LIMIT 1`,
    [req.user.tenantId, range.from, range.to],
  )
  res.json({
    from: range.from,
    to: range.to,
    currency: currency.rows[0]?.currency || 'EUR',
    days: rows,
  })
}))

router.get('/search', asyncRoute(async (req, res) => {
  const q = `%${String(req.query.q || '').replace(/[%_]/g, '').trim()}%`
  if (q === '%%') return res.json({ companies: [], orders: [], contacts: [], invoices: [] })
  const [companies, orders, contacts, invoices] = await Promise.all([
    pool.query(`SELECT id, name, city, role FROM companies WHERE tenant_id = $1 AND name ILIKE $2 ORDER BY name LIMIT 5`, [req.user.tenantId, q]),
    pool.query(`SELECT id, reference, origin, destination, status FROM orders WHERE tenant_id = $1 AND (reference ILIKE $2 OR origin ILIKE $2 OR destination ILIKE $2) LIMIT 5`, [req.user.tenantId, q]),
    pool.query(`SELECT id, name, email FROM contacts WHERE tenant_id = $1 AND (name ILIKE $2 OR email ILIKE $2) LIMIT 5`, [req.user.tenantId, q]),
    pool.query(
      `SELECT i.id, i.number, i.status, c.name AS company_name
       FROM invoices i LEFT JOIN companies c ON c.id = i.company_id
       WHERE i.tenant_id = $1 AND (i.number ILIKE $2 OR c.name ILIKE $2)
       ORDER BY i.created_at DESC LIMIT 5`,
      [req.user.tenantId, q],
    ),
  ])
  res.json({ companies: companies.rows, orders: orders.rows, contacts: contacts.rows, invoices: invoices.rows })
}))

router.get('/activities', asyncRoute(async (req, res) => {
  const values = [req.user.tenantId]
  let where = 'a.tenant_id = $1'
  if (req.query.objectType && req.query.objectId) {
    values.push(req.query.objectType, req.query.objectId)
    where += ` AND a.object_type = $2 AND a.object_id = $3`
  }
  if (req.query.open === '1') where += ` AND a.kind = 'task' AND a.done = false`
  if (req.query.tasks === '1') {
    where += ` AND a.kind = 'task'`
    if (req.query.status === 'open') where += ` AND a.done = false AND (a.due_at IS NULL OR a.due_at > now())`
    if (req.query.status === 'done') where += ` AND a.done = true`
    if (req.query.status === 'overdue') where += ` AND a.done = false AND a.due_at IS NOT NULL AND a.due_at <= now()`
  }
  const { rows } = await pool.query(
    `SELECT a.*, u.name AS owner_name,
       CASE
         WHEN a.object_type = 'order' THEN (SELECT reference FROM orders WHERE id = a.object_id)
         WHEN a.object_type = 'company' THEN (SELECT name FROM companies WHERE id = a.object_id)
         WHEN a.object_type = 'contact' THEN (SELECT name FROM contacts WHERE id = a.object_id)
         WHEN a.object_type = 'invoice' THEN (SELECT number FROM invoices WHERE id = a.object_id)
         WHEN a.object_type = 'vehicle' THEN (SELECT plate FROM vehicles WHERE id = a.object_id)
         ELSE NULL
       END AS object_label
     FROM activities a
     LEFT JOIN users u ON u.id = a.owner_id
     WHERE ${where}
     ORDER BY a.due_at NULLS LAST, a.created_at DESC
     LIMIT 200`,
    values,
  )
  res.json({ data: rows })
}))

router.post('/activities', asyncRoute(async (req, res) => {
  const title = text(req.body.title, 200)
  if (!title || !req.body.objectType || !req.body.objectId) throw httpError(400, 'Title and record are required.')
  const kind = ['note', 'task'].includes(req.body.kind) ? req.body.kind : 'note'
  if (kind === 'task' && !req.body.dueAt) throw httpError(400, 'A due date is required for a task.')
  const { rows } = await pool.query(
    `INSERT INTO activities (tenant_id, object_type, object_id, kind, title, body, due_at, owner_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [req.user.tenantId, req.body.objectType, req.body.objectId, kind, title, text(req.body.body, 4000), req.body.dueAt || null, req.body.ownerId || req.user.id, req.user.id],
  )
  res.status(201).json(rows[0])
}))

router.patch('/activities/:id', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE activities SET done = $1 WHERE id = $2 AND tenant_id = $3 RETURNING *`,
    [Boolean(req.body.done), req.params.id, req.user.tenantId],
  )
  if (!rows[0]) throw httpError(404, 'Activity not found.')
  res.json(rows[0])
}))

router.get('/workflows', asyncRoute(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM workflows WHERE tenant_id = $1 ORDER BY created_at', [req.user.tenantId])
  res.json({ data: rows })
}))

router.get('/workflows/:id', asyncRoute(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM workflows WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user.tenantId])
  if (!rows[0]) throw httpError(404, 'Workflow not found.')
  res.json(rows[0])
}))

router.post('/workflows', asyncRoute(async (req, res) => {
  const name = text(req.body.name, 160)
  if (!name) throw httpError(400, 'Workflow name is required.')
  const actions = Array.isArray(req.body.actions) ? req.body.actions : []
  const graph = req.body.graph && typeof req.body.graph === 'object' ? req.body.graph : null
  const { rows } = await pool.query(
    `INSERT INTO workflows (tenant_id, name, enabled, object_type, trigger_event, trigger_property, trigger_value, actions, graph)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb) RETURNING *`,
    [
      req.user.tenantId, name, req.body.enabled !== false, oneOf(req.body.objectType, WORKFLOW_OBJECTS, 'order'),
      ['created', 'updated', 'property_changed'].includes(req.body.triggerEvent) ? req.body.triggerEvent : 'property_changed',
      text(req.body.triggerProperty, 80), text(req.body.triggerValue, 80), JSON.stringify(actions), graph ? JSON.stringify(graph) : null,
    ],
  )
  res.status(201).json(rows[0])
}))

router.patch('/workflows/:id', asyncRoute(async (req, res) => {
  const current = (await pool.query('SELECT * FROM workflows WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user.tenantId])).rows[0]
  if (!current) throw httpError(404, 'Workflow not found.')
  const graph = req.body.graph !== undefined ? req.body.graph : current.graph
  const actions = req.body.actions !== undefined ? req.body.actions : current.actions
  const { rows } = await pool.query(
    `UPDATE workflows SET
       enabled = COALESCE($1, enabled),
       name = COALESCE($2, name),
       object_type = COALESCE($3, object_type),
       trigger_event = COALESCE($4, trigger_event),
       trigger_property = COALESCE($5, trigger_property),
       trigger_value = COALESCE($6, trigger_value),
       actions = COALESCE($7::jsonb, actions),
       graph = $8::jsonb
     WHERE id = $9 AND tenant_id = $10 RETURNING *`,
    [
      req.body.enabled,
      text(req.body.name, 160),
      req.body.objectType ? oneOf(req.body.objectType, WORKFLOW_OBJECTS, current.object_type) : current.object_type,
      req.body.triggerEvent && ['created', 'updated', 'property_changed'].includes(req.body.triggerEvent) ? req.body.triggerEvent : current.trigger_event,
      req.body.triggerProperty !== undefined ? text(req.body.triggerProperty, 80) : current.trigger_property,
      req.body.triggerValue !== undefined ? text(req.body.triggerValue, 80) : current.trigger_value,
      actions ? JSON.stringify(actions) : null,
      graph ? JSON.stringify(graph) : null,
      req.params.id,
      req.user.tenantId,
    ],
  )
  res.json(rows[0])
}))

router.delete('/workflows/:id', asyncRoute(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM workflows WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user.tenantId])
  if (!rowCount) throw httpError(404, 'Workflow not found.')
  res.json({ ok: true })
}))

router.get('/workflow-runs', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.*, w.name FROM workflow_runs r LEFT JOIN workflows w ON w.id = r.workflow_id
     WHERE r.tenant_id = $1 ORDER BY r.created_at DESC LIMIT 40`,
    [req.user.tenantId],
  )
  res.json({ data: rows })
}))

router.get('/documents', asyncRoute(async (req, res) => {
  const values = [req.user.tenantId]
  let where = 'd.tenant_id = $1'
  if (req.query.objectType && req.query.objectId) {
    values.push(req.query.objectType, req.query.objectId)
    where += ' AND d.object_type = $2 AND d.object_id = $3'
  }
  const { rows } = await pool.query(
    `SELECT d.id, d.object_type, d.object_id, d.kind, d.filename, d.mime, d.size_bytes, d.created_at
     FROM documents d WHERE ${where} ORDER BY d.created_at DESC LIMIT 100`,
    values,
  )
  res.json({ data: rows })
}))

router.post('/documents', upload.single('file'), asyncRoute(async (req, res) => {
  if (!req.file) throw httpError(400, 'Choose a file.')
  if (!req.body.objectType || !req.body.objectId) throw httpError(400, 'Attach the file to a record.')
  const row = await storeDocument({
    tenantId: req.user.tenantId,
    objectType: req.body.objectType,
    objectId: req.body.objectId,
    kind: text(req.body.kind, 40) || 'other',
    file: req.file,
    userId: req.user.id,
  })
  res.status(201).json(row)
}))

router.get('/documents/:id/file', asyncRoute(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM documents WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user.tenantId])
  if (!rows[0]) throw httpError(404, 'Document not found.')
  if (!spacesConfigured() || rows[0].path.startsWith('/')) throw httpError(404, 'File is missing from storage.')
  const object = await getObject(rows[0].path)
  res.setHeader('Content-Type', rows[0].mime || 'application/octet-stream')
  res.setHeader('Content-Disposition', `attachment; filename="${String(rows[0].filename).replace(/"/g, '')}"`)
  if (object.Body?.pipe) object.Body.pipe(res)
  else res.send(Buffer.from(await object.Body.transformToByteArray()))
}))

router.delete('/documents/:id', asyncRoute(async (req, res) => {
  const { rows } = await pool.query('DELETE FROM documents WHERE id = $1 AND tenant_id = $2 RETURNING path', [req.params.id, req.user.tenantId])
  if (!rows[0]) throw httpError(404, 'Document not found.')
  await deleteObject(rows[0].path)
  res.json({ ok: true })
}))

router.get('/users', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, email, role, locale, active, created_at FROM users WHERE tenant_id = $1 ORDER BY created_at`,
    [req.user.tenantId],
  )
  res.json({ data: rows })
}))

router.post('/users', asyncRoute(async (req, res) => {
  await assertTrial(req.user.tenantId)
  const name = text(req.body.name, 120)
  const email = text(req.body.email, 180)?.toLowerCase()
  const role = oneOf(req.body.role, USER_ROLES, 'dispatcher')
  const password = String(req.body.password || '')
  if (!name || !email || password.length < 8) throw httpError(400, 'Name, email, and a password of at least 8 characters are required.')
  const tenant = (await pool.query('SELECT seat_limit, driver_limit FROM tenants WHERE id = $1', [req.user.tenantId])).rows[0]
  const usage = await pool.query(
    `SELECT count(*) FILTER (WHERE role <> 'driver')::int AS seats, count(*) FILTER (WHERE role = 'driver')::int AS drivers
     FROM users WHERE tenant_id = $1 AND active = true`,
    [req.user.tenantId],
  )
  if (role === 'driver' && usage.rows[0].drivers >= tenant.driver_limit) throw httpError(402, 'Driver seat limit reached.')
  if (role !== 'driver' && usage.rows[0].seats >= tenant.seat_limit) throw httpError(402, 'Seat limit reached.')
  const bcrypt = await import('bcryptjs')
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, name, role) VALUES ($1,$2,$3,$4,$5)
       RETURNING id, name, email, role, active, created_at`,
      [req.user.tenantId, email, await bcrypt.default.hash(password, 10), name, role],
    )
    await audit(req, 'invite', 'user', rows[0].id, { email, role })
    res.status(201).json(rows[0])
  } catch (err) {
    if (err.code === '23505') throw httpError(409, 'That email is already in use.')
    throw err
  }
}))

router.patch('/users/:id', asyncRoute(async (req, res) => {
  const current = (await pool.query(
    `SELECT id, name, email, role, active, tenant_id FROM users WHERE id = $1 AND tenant_id = $2`,
    [req.params.id, req.user.tenantId],
  )).rows[0]
  if (!current) throw httpError(404, 'User not found.')

  const role = req.body.role !== undefined ? oneOf(req.body.role, USER_ROLES, current.role) : current.role
  const email = req.body.email !== undefined ? text(req.body.email, 180)?.toLowerCase() : current.email
  if (!email || !email.includes('@')) throw httpError(400, 'Enter a valid email.')
  const active = req.body.active === undefined ? current.active : Boolean(req.body.active)
  const password = req.body.password == null ? '' : String(req.body.password)
  if (password && password.length < 8) throw httpError(400, 'Password must be at least 8 characters.')

  const leavingOwner = current.role === 'owner' && current.active && (role !== 'owner' || !active)
  if (leavingOwner) {
    const others = await pool.query(
      `SELECT count(*)::int AS n FROM users
       WHERE tenant_id = $1 AND role = 'owner' AND active = true AND id <> $2`,
      [req.user.tenantId, current.id],
    )
    if (!others.rows[0].n) throw httpError(409, 'Keep at least one active owner.')
  }

  if (active && (current.role === 'driver') !== (role === 'driver')) {
    const tenant = (await pool.query('SELECT seat_limit, driver_limit FROM tenants WHERE id = $1', [req.user.tenantId])).rows[0]
    const usage = await pool.query(
      `SELECT count(*) FILTER (WHERE role <> 'driver')::int AS seats, count(*) FILTER (WHERE role = 'driver')::int AS drivers
       FROM users WHERE tenant_id = $1 AND active = true`,
      [req.user.tenantId],
    )
    if (role === 'driver' && usage.rows[0].drivers >= tenant.driver_limit) throw httpError(402, 'Driver seat limit reached.')
    if (role !== 'driver' && usage.rows[0].seats >= tenant.seat_limit) throw httpError(402, 'Seat limit reached.')
  }

  let hash = null
  if (password) {
    const bcrypt = await import('bcryptjs')
    hash = await bcrypt.default.hash(password, 10)
  }

  try {
    const { rows } = await pool.query(
      `UPDATE users SET role = $1, email = $2, active = $3, password_hash = COALESCE($4, password_hash)
       WHERE id = $5 AND tenant_id = $6
       RETURNING id, name, email, role, active, tenant_id`,
      [role, email, active, hash, current.id, req.user.tenantId],
    )
    await audit(req, 'update', 'user', rows[0].id, {
      email, role, active, passwordChanged: Boolean(password),
    })
    const body = { id: rows[0].id, name: rows[0].name, email: rows[0].email, role: rows[0].role, active: rows[0].active }
    if (req.user.id === rows[0].id && (role !== current.role || email !== current.email)) body.token = signUser(rows[0])
    res.json(body)
  } catch (err) {
    if (err.code === '23505') throw httpError(409, 'That email is already in use.')
    throw err
  }
}))

router.get('/api-keys', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, prefix, scope, created_at, revoked_at FROM api_keys WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [req.user.tenantId],
  )
  res.json({ data: rows })
}))

router.post('/api-keys', asyncRoute(async (req, res) => {
  const name = text(req.body.name, 80) || 'API key'
  const scope = req.body.scope === 'write' ? 'write' : 'read'
  const token = `ck_live_${crypto.randomBytes(24).toString('hex')}`
  const { rows } = await pool.query(
    `INSERT INTO api_keys (tenant_id, name, prefix, key_hash, scope, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, prefix, scope, created_at`,
    [req.user.tenantId, name, token.slice(0, 12), hashApiKey(token), scope, req.user.id],
  )
  await audit(req, 'create', 'api_key', rows[0].id, { name, scope })
  res.status(201).json({ ...rows[0], token })
}))

router.post('/api-keys/:id/revoke', asyncRoute(async (req, res) => {
  const { rowCount } = await pool.query(
    `UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL`,
    [req.params.id, req.user.tenantId],
  )
  if (!rowCount) throw httpError(404, 'API key not found.')
  res.json({ ok: true })
}))

router.get('/integrations', asyncRoute(async (req, res) => {
  const saved = await pool.query('SELECT provider, status, config, updated_at FROM integrations WHERE tenant_id = $1', [req.user.tenantId])
  const byProvider = Object.fromEntries(saved.rows.map((row) => [row.provider, row]))
  res.json({
    data: integrationCatalog().map((item) => {
      const row = byProvider[item.provider]
      const status = row?.status || (item.provider === 'twilio' ? 'disconnected' : (item.configured ? 'available' : 'not_configured'))
      return {
        ...item,
        status,
        updatedAt: row?.updated_at || null,
        ...(item.provider === 'twilio' ? publicTwilio(row?.config) : {}),
      }
    }),
  })
}))

router.get('/notifications/stream', asyncRoute(async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders()
  req.socket?.setNoDelay?.(true)
  const send = (event, payload) => {
    if (res.writableEnded || res.destroyed) return
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
  }
  send('ready', { ok: true })
  const stop = subscribe(req.user.id, (message) => send(message.event, message.payload))
  const beat = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) res.write(': ping\n\n')
  }, 20000)
  await new Promise((resolve) => {
    res.on('close', () => {
      clearInterval(beat)
      stop()
      resolve()
    })
  })
}))

router.get('/notifications', asyncRoute(async (req, res) => {
  const [list, unread] = await Promise.all([
    pool.query(
      `SELECT id, kind, title, body, href, read_at, created_at
       FROM notifications WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 20`,
      [req.user.id],
    ),
    pool.query(
      `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
      [req.user.id],
    ),
  ])
  res.json({
    unread: unread.rows[0].n,
    data: list.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      href: row.href,
      readAt: row.read_at,
      createdAt: row.created_at,
    })),
  })
}))

router.post('/notifications/read', asyncRoute(async (req, res) => {
  if (req.body?.all) {
    await pool.query(
      `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`,
      [req.user.id],
    )
  } else if (req.body?.id) {
    await pool.query(
      `UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 AND read_at IS NULL`,
      [req.body.id, req.user.id],
    )
  }
  publish(req.user.id, 'read', { id: req.body?.id || null, all: Boolean(req.body?.all) })
  res.json({ ok: true })
}))

router.get('/sms', asyncRoute(async (req, res) => {
  res.json(await smsInbox(req.user.tenantId))
}))

router.get('/sms/thread', asyncRoute(async (req, res) => {
  res.json(await smsThread(req.user.tenantId, { contactId: req.query.contact, peer: req.query.peer }))
}))

router.get('/sms/companies/:id', asyncRoute(async (req, res) => {
  res.json(await smsForCompany(req.user.tenantId, req.params.id))
}))

router.post('/sms', asyncRoute(async (req, res) => {
  const message = await replySms(req.user.tenantId, req.user.id, req.body || {})
  res.status(201).json(message)
}))

router.get('/integrations/twilio', asyncRoute(async (req, res) => {
  res.json(await twilioLog(req.user.tenantId))
}))

router.post('/integrations/twilio', asyncRoute(async (req, res) => {
  const row = await connectTwilio(req.user.tenantId, req.body)
  await audit(req, 'connect', 'integration', null, { provider: 'twilio', accountSid: row.accountSid })
  res.json(row)
}))

router.get('/integrations/twilio/recordings/:sid', asyncRoute(async (req, res) => {
  const upstream = await openTwilioRecording(req.user.tenantId, req.params.sid)
  res.setHeader('Content-Type', 'audio/mpeg')
  const { Readable } = await import('stream')
  Readable.fromWeb(upstream.body).pipe(res)
}))

router.post('/integrations/google/start', asyncRoute(async (req, res) => {
  res.json({ url: googleStartUrl(req.user) })
}))

router.post('/integrations/quickbooks/start', asyncRoute(async (req, res) => {
  res.json({ url: quickbooksStartUrl(req.user) })
}))

router.delete('/integrations/:provider', asyncRoute(async (req, res) => {
  await pool.query('DELETE FROM integrations WHERE tenant_id = $1 AND provider = $2', [req.user.tenantId, req.params.provider])
  res.json({ ok: true })
}))

router.get('/audit', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.*, u.name AS user_name FROM audit_log a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE a.tenant_id = $1 ORDER BY a.created_at DESC LIMIT 50`,
    [req.user.tenantId],
  )
  res.json({ data: rows })
}))

function stripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) return null
  return new Stripe(process.env.STRIPE_SECRET_KEY)
}

function accountView(row) {
  return {
    name: row.name,
    legalName: row.legal_name || '',
    address: row.address || '',
    city: row.city || '',
    country: row.country || '',
    vat: row.vat || '',
    email: row.email || '',
    phone: row.phone || '',
    bankName: row.bank_name || '',
    iban: row.iban || '',
    swift: row.swift || '',
    invoiceFooter: row.invoice_footer || '',
  }
}

router.get('/account', asyncRoute(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM tenants WHERE id = $1', [req.user.tenantId])
  if (!rows[0]) throw httpError(404, 'Account not found.')
  res.json(accountView(rows[0]))
}))

router.patch('/account', asyncRoute(async (req, res) => {
  const email = text(req.body.email, 160)
  if (email && !email.includes('@')) throw httpError(400, 'Enter a valid email address.')
  const iban = text(req.body.iban, 42)
  const swift = text(req.body.swift, 16)
  const { rows } = await pool.query(
    `UPDATE tenants SET
       legal_name = $1, address = $2, city = $3, country = $4, vat = $5, email = $6, phone = $7,
       bank_name = $8, iban = $9, swift = $10, invoice_footer = $11
     WHERE id = $12 RETURNING *`,
    [
      text(req.body.legalName, 160),
      text(req.body.address, 240),
      text(req.body.city, 80),
      text(req.body.country, 80),
      text(req.body.vat, 40),
      email,
      text(req.body.phone, 40),
      text(req.body.bankName, 120),
      iban ? iban.replace(/\s+/g, '').toUpperCase() : null,
      swift ? swift.replace(/\s+/g, '').toUpperCase() : null,
      text(req.body.invoiceFooter, 500),
      req.user.tenantId,
    ],
  )
  await audit(req, 'update', 'tenant', req.user.tenantId, { legalName: rows[0].legal_name })
  res.json(accountView(rows[0]))
}))

router.get('/billing', asyncRoute(async (req, res) => {
  const tenant = (await pool.query('SELECT * FROM tenants WHERE id = $1', [req.user.tenantId])).rows[0]
  const usage = await pool.query(
    `SELECT count(*) FILTER (WHERE role <> 'driver' AND active)::int AS seats,
            count(*) FILTER (WHERE role = 'driver' AND active)::int AS drivers
     FROM users WHERE tenant_id = $1`,
    [req.user.tenantId],
  )
  const google = await getIntegration(req.user.tenantId, 'google')
  res.json({
    plan: tenant.plan,
    trialEndsAt: tenant.trial_ends_at,
    seatLimit: tenant.seat_limit,
    driverLimit: tenant.driver_limit,
    seatsUsed: usage.rows[0].seats,
    driversUsed: usage.rows[0].drivers,
    stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
    currency: tenant.default_currency,
    googleConnected: google?.status === 'connected',
    prices: {
      seatMonthly: 4000,
      seatAnnual: 42000,
      driverMonthly: 1000,
      driverAnnual: 8400,
    },
  })
}))

router.post('/billing/checkout', asyncRoute(async (req, res) => {
  const stripe = stripeClient()
  if (!stripe) throw httpError(400, 'Stripe is not configured on this server.')
  const interval = req.body.interval === 'year' ? 'year' : 'month'
  const seats = Math.max(1, Number(req.body.seats) || 1)
  const drivers = Math.max(0, Number(req.body.drivers) || 0)
  const publicUrl = (process.env.PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, '')
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer_email: req.user.email,
    client_reference_id: req.user.tenantId,
    success_url: `${publicUrl}/settings?billing=success`,
    cancel_url: `${publicUrl}/settings?billing=cancel`,
    metadata: { tenantId: req.user.tenantId, seats: String(seats), drivers: String(drivers) },
    line_items: [
      {
        quantity: seats,
        price_data: {
          currency: 'usd',
          unit_amount: interval === 'year' ? 42000 : 4000,
          recurring: { interval },
          product_data: { name: 'Cargos.pro seat' },
        },
      },
      ...(drivers ? [{
        quantity: drivers,
        price_data: {
          currency: 'usd',
          unit_amount: interval === 'year' ? 8400 : 1000,
          recurring: { interval },
          product_data: { name: 'Cargos.pro driver' },
        },
      }] : []),
    ],
  })
  res.json({ url: session.url })
}))

export async function stripeWebhook(req, res) {
  try {
    const stripe = stripeClient()
    if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
      return res.status(400).json({ error: 'Stripe webhook is not configured.' })
    }
    let event
    try {
      event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)
    } catch (err) {
      return res.status(400).json({ error: err.message })
    }
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object
      const tenantId = session.metadata?.tenantId || session.client_reference_id
      const seats = Number(session.metadata?.seats || 1)
      const drivers = Number(session.metadata?.drivers || 0)
      if (tenantId) {
        await pool.query(
          `UPDATE tenants
           SET plan = 'active', stripe_customer_id = $1, stripe_subscription_id = $2,
               seat_limit = GREATEST(seat_limit, $3), driver_limit = GREATEST(driver_limit, $4)
           WHERE id = $5`,
          [session.customer, session.subscription, seats, drivers, tenantId],
        )
      }
    }
    res.json({ received: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Webhook failed.' })
  }
}

export default router
