import { Router } from 'express'
import { pool } from '../db.js'
import { assertTrial, audit } from '../auth.js'
import { CURRENCIES, LOAD_TYPES, ORDER_STATUSES, PARTY_ROLES, PROPERTY_TYPES, cents, dateOrNull, intOrNull, oneOf, pageLimit, text } from '../enums.js'
import { EXPENSE_SELECT, insertExpense, readExpenseFields, updateExpense } from '../expenses.js'
import { asyncRoute, changes, httpError } from '../http.js'
import { createCalendarEvent } from '../integrations.js'
import { notify } from '../notify.js'
import { computeRoute } from '../routing.js'
import { storeDocument, upload } from '../uploads.js'
import { createInvoiceForOrder, emit } from '../workflow.js'
import { nextReference, rememberAddress } from './crm.js'

const router = Router()

router.get('/orders', asyncRoute(async (req, res) => {
  const q = req.query.q ? `%${String(req.query.q).replace(/[%_]/g, '').trim()}%` : null
  const limit = pageLimit(req.query.limit)
  const params = [req.user.tenantId, q]
  let sql = `SELECT o.*, c.name AS company_name,
       COALESCE((SELECT SUM(cost_cents) FROM relations r WHERE r.order_id = o.id), 0)::int AS cost_cents,
       COALESCE((SELECT SUM(amount_cents) FROM order_expenses e WHERE e.order_id = o.id), 0)::int AS expense_cents
     FROM orders o
     LEFT JOIN companies c ON c.id = o.company_id
     WHERE o.tenant_id = $1
       AND ($2::text IS NULL OR o.reference ILIKE $2 OR o.origin ILIKE $2 OR o.destination ILIKE $2 OR o.cargo ILIKE $2 OR c.name ILIKE $2)
     ORDER BY o.created_at DESC`
  if (limit) {
    params.push(limit)
    sql += ` LIMIT $${params.length}`
  }
  const { rows } = await pool.query(sql, params)
  res.json({ data: rows })
}))

router.post('/orders', asyncRoute(async (req, res) => {
  await assertTrial(req.user.tenantId)
  const row = await insertOrder(req, req.body, await nextReference(req.user.tenantId))
  res.status(201).json(row)
}))

router.get('/orders/:id', asyncRoute(async (req, res) => {
  const order = await loadOrder(req.params.id, req.user.tenantId)
  if (!order) throw httpError(404, 'Order not found.')
  res.json(order)
}))

router.patch('/orders/:id', asyncRoute(async (req, res) => {
  const current = await mustOrder(req.params.id, req.user.tenantId)
  const origin = req.body.origin !== undefined ? text(req.body.origin, 180) : current.origin
  const destination = req.body.destination !== undefined ? text(req.body.destination, 180) : current.destination
  const moved = origin !== current.origin || destination !== current.destination
  const leg = moved ? await computeRoute(origin, destination) : null
  const body = {
    ...req.body,
    company_id: req.body.companyId !== undefined ? req.body.companyId : req.body.company_id,
    price_cents: req.body.priceCents !== undefined ? req.body.priceCents : req.body.price_cents,
    weight_kg: req.body.weightKg !== undefined ? req.body.weightKg : req.body.weight_kg,
    load_type: req.body.loadType !== undefined ? req.body.loadType : req.body.load_type,
    pickup_at: req.body.pickupAt !== undefined ? req.body.pickupAt : req.body.pickup_at,
    delivery_at: req.body.deliveryAt !== undefined ? req.body.deliveryAt : req.body.delivery_at,
    origin,
    destination,
  }
  const { values, sets } = changes(body, {
    company_id: (v) => v || null,
    status: (v) => oneOf(v, ORDER_STATUSES, current.status),
    origin: (v) => text(v, 180),
    destination: (v) => text(v, 180),
    cargo: (v) => text(v, 240),
    weight_kg: (v) => intOrNull(v),
    load_type: (v) => oneOf(v, LOAD_TYPES, current.load_type),
    price_cents: (v) => cents(v),
    currency: (v) => oneOf(v, CURRENCIES, current.currency),
    pickup_at: (v) => dateOrNull(v),
    delivery_at: (v) => dateOrNull(v),
    notes: (v) => text(v, 4000),
    custom: (v) => JSON.stringify(v && typeof v === 'object' ? v : {}),
  })
  if (body.custom !== undefined) {
    const idx = sets.findIndex((set) => set.startsWith('custom ='))
    if (idx >= 0) sets[idx] = `custom = $${idx + 1}::jsonb`
  }
  if (leg) {
    values.push(leg.distanceKm, leg.durationMin, leg.source)
    sets.push(`distance_km = $${values.length - 2}`, `duration_min = $${values.length - 1}`, `distance_source = $${values.length}`)
  }
  if (body.status === 'delivered' && current.status !== 'delivered') {
    sets.push('delivered_at = COALESCE(delivered_at, now())')
  }
  if (!sets.length) throw httpError(400, 'Nothing to update.')
  values.push(req.params.id, req.user.tenantId)
  const { rows } = await pool.query(
    `UPDATE orders SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length - 1} AND tenant_id = $${values.length} RETURNING *`,
    values,
  )
  await rememberAddress(req.user.tenantId, rows[0].company_id, rows[0].origin)
  await rememberAddress(req.user.tenantId, rows[0].company_id, rows[0].destination)
  if (body.company_id !== undefined) await syncCustomerParty(req.user.tenantId, rows[0].id, rows[0].company_id)
  await audit(req, 'update', 'order', rows[0].id, { status: rows[0].status })
  await emit(req.user.tenantId, 'order', 'property_changed', rows[0], current, 0, req.user.id)
  res.json(await loadOrder(rows[0].id, req.user.tenantId))
}))

router.post('/orders/:id/invoice', asyncRoute(async (req, res) => {
  const order = await mustOrder(req.params.id, req.user.tenantId)
  const invoice = await createInvoiceForOrder(req.user.tenantId, order, req.user.id)
  await audit(req, 'invoice', 'order', order.id, { invoice: invoice.number })
  res.status(201).json(invoice)
}))

router.delete('/orders/:id', asyncRoute(async (req, res) => {
  const { rowCount } = await pool.query(
    `DELETE FROM orders WHERE id = $1 AND tenant_id = $2 AND status IN ('booked','cancelled')`,
    [req.params.id, req.user.tenantId],
  )
  if (!rowCount) throw httpError(409, 'Only booked or cancelled orders can be deleted.')
  res.json({ ok: true })
}))

router.put('/orders/:id/parties/:role', asyncRoute(async (req, res) => {
  const order = await mustOrder(req.params.id, req.user.tenantId)
  const role = oneOf(req.params.role, PARTY_ROLES, null)
  if (!role) throw httpError(400, 'Party role must be customer, broker, or carrier.')
  const companyId = req.body.companyId
  if (!companyId) throw httpError(400, 'Choose a company.')
  const allowed = role === 'broker' ? ['broker'] : role === 'carrier' ? ['carrier', 'both'] : ['customer', 'both']
  const company = (await pool.query(
    `SELECT * FROM companies WHERE id = $1 AND tenant_id = $2`,
    [companyId, req.user.tenantId],
  )).rows[0]
  if (!company) throw httpError(404, 'Company not found.')
  if (!allowed.includes(company.role)) throw httpError(400, `That company is not a ${role}.`)
  let contactId = req.body.contactId || null
  if (contactId) {
    const contact = (await pool.query(
      `SELECT id FROM contacts WHERE id = $1 AND tenant_id = $2 AND company_id = $3`,
      [contactId, req.user.tenantId, companyId],
    )).rows[0]
    if (!contact) throw httpError(400, 'That contact is not at this company.')
  }
  const { rows } = await pool.query(
    `INSERT INTO order_parties (tenant_id, order_id, role, company_id, contact_id)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (order_id, role)
     DO UPDATE SET company_id = EXCLUDED.company_id, contact_id = EXCLUDED.contact_id, updated_at = now()
     RETURNING *`,
    [req.user.tenantId, order.id, role, companyId, contactId],
  )
  if (role === 'customer') {
    await pool.query('UPDATE orders SET company_id = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3', [companyId, order.id, req.user.tenantId])
  }
  res.json(await presentParty(rows[0]))
}))

router.delete('/orders/:id/parties/:role', asyncRoute(async (req, res) => {
  const order = await mustOrder(req.params.id, req.user.tenantId)
  const role = oneOf(req.params.role, PARTY_ROLES, null)
  if (!role) throw httpError(400, 'Party role must be customer, broker, or carrier.')
  await pool.query('DELETE FROM order_parties WHERE order_id = $1 AND tenant_id = $2 AND role = $3', [order.id, req.user.tenantId, role])
  if (role === 'customer') {
    await pool.query('UPDATE orders SET company_id = NULL, updated_at = now() WHERE id = $1 AND tenant_id = $2', [order.id, req.user.tenantId])
  }
  res.json({ ok: true })
}))

router.post('/orders/:id/expenses', asyncRoute(async (req, res) => {
  const order = await mustOrder(req.params.id, req.user.tenantId)
  const fields = await readExpenseFields(req.body, req.user.tenantId, {
    defaults: { occurred_on: new Date().toISOString().slice(0, 10), payment_type: 'cash', currency: order.currency, order_id: order.id },
  })
  fields.order_id = order.id
  res.status(201).json(await insertExpense(req.user.tenantId, fields))
}))

router.patch('/orders/:id/expenses/:expenseId', asyncRoute(async (req, res) => {
  await mustOrder(req.params.id, req.user.tenantId)
  const current = (await pool.query(
    'SELECT id FROM order_expenses WHERE id = $1 AND order_id = $2 AND tenant_id = $3',
    [req.params.expenseId, req.params.id, req.user.tenantId],
  )).rows[0]
  if (!current) throw httpError(404, 'Expense not found.')
  const fields = await readExpenseFields(req.body, req.user.tenantId)
  if (req.body.label !== undefined && !fields.label) throw httpError(400, 'Expense label is required.')
  fields.order_id = undefined
  res.json(await updateExpense(req.params.expenseId, req.user.tenantId, fields))
}))

router.delete('/orders/:id/expenses/:expenseId', asyncRoute(async (req, res) => {
  const { rowCount } = await pool.query(
    `DELETE FROM order_expenses WHERE id = $1 AND order_id = $2 AND tenant_id = $3`,
    [req.params.expenseId, req.params.id, req.user.tenantId],
  )
  if (!rowCount) throw httpError(404, 'Expense not found.')
  res.json({ ok: true })
}))

function propertyKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40) || 'field'
}

router.get('/order-properties', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM order_property_defs WHERE tenant_id = $1 ORDER BY sort_order, created_at`,
    [req.user.tenantId],
  )
  res.json({ data: rows })
}))

router.post('/order-properties', asyncRoute(async (req, res) => {
  const name = text(req.body.name, 80)
  if (!name) throw httpError(400, 'Field name is required.')
  const type = oneOf(req.body.type, PROPERTY_TYPES, 'text')
  const options = Array.isArray(req.body.options) ? req.body.options.map((item) => String(item).slice(0, 80)).filter(Boolean) : []
  if (['checkboxes', 'radio', 'select', 'multiselect'].includes(type) && !options.length) {
    throw httpError(400, 'Add at least one option.')
  }
  let key = text(req.body.key, 40) || propertyKey(name)
  const taken = await pool.query('SELECT key FROM order_property_defs WHERE tenant_id = $1', [req.user.tenantId])
  const used = new Set(taken.rows.map((row) => row.key))
  if (used.has(key)) {
    let n = 2
    while (used.has(`${key}_${n}`)) n += 1
    key = `${key}_${n}`
  }
  const sort = intOrNull(req.body.sortOrder) ?? taken.rows.length
  const { rows } = await pool.query(
    `INSERT INTO order_property_defs (tenant_id, name, key, type, options, sort_order)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING *`,
    [req.user.tenantId, name, key, type, JSON.stringify(options), sort],
  )
  res.status(201).json(rows[0])
}))

router.patch('/order-properties/:id', asyncRoute(async (req, res) => {
  const body = {
    ...req.body,
    sort_order: req.body.sortOrder ?? req.body.sort_order,
    options: req.body.options,
  }
  const { values, sets } = changes(body, {
    name: (v) => text(v, 80),
    type: (v) => oneOf(v, PROPERTY_TYPES, 'text'),
    options: (v) => JSON.stringify(Array.isArray(v) ? v.map((item) => String(item).slice(0, 80)).filter(Boolean) : []),
    sort_order: (v) => intOrNull(v) ?? 0,
  })
  if (!sets.length) throw httpError(400, 'Nothing to update.')
  if (body.options !== undefined) {
    const idx = sets.findIndex((set) => set.startsWith('options ='))
    if (idx >= 0) sets[idx] = `options = $${idx + 1}::jsonb`
  }
  values.push(req.params.id, req.user.tenantId)
  const { rows } = await pool.query(
    `UPDATE order_property_defs SET ${sets.join(', ')} WHERE id = $${values.length - 1} AND tenant_id = $${values.length} RETURNING *`,
    values,
  )
  if (!rows[0]) throw httpError(404, 'Field not found.')
  res.json(rows[0])
}))

router.delete('/order-properties/:id', asyncRoute(async (req, res) => {
  const { rowCount } = await pool.query(
    'DELETE FROM order_property_defs WHERE id = $1 AND tenant_id = $2',
    [req.params.id, req.user.tenantId],
  )
  if (!rowCount) throw httpError(404, 'Field not found.')
  res.json({ ok: true })
}))

router.post('/routing/estimate', asyncRoute(async (req, res) => {
  const origin = text(req.body.origin, 180)
  const destination = text(req.body.destination, 180)
  if (!origin || !destination) throw httpError(400, 'Origin and destination are required.')
  const leg = await computeRoute(origin, destination)
  if (!leg) throw httpError(404, 'No road estimate for those places. Add a Google Maps key or use a known city.')
  res.json(leg)
}))

router.get('/dispatch', asyncRoute(async (req, res) => {
  const from = dateOrNull(req.query.from)
  const to = dateOrNull(req.query.to)
  const status = req.query.status && ORDER_STATUSES.includes(req.query.status) ? req.query.status : null
  const q = req.query.q ? `%${String(req.query.q).replace(/[%_]/g, '').trim()}%` : null
  const [drivers, orders] = await Promise.all([
    pool.query(
      `SELECT d.id, d.name, d.vehicle_id, v.plate,
         (
           SELECT count(*)::int FROM relations r
           JOIN orders o ON o.id = r.order_id
           WHERE r.driver_id = d.id AND o.status <> 'cancelled'
             AND ($2::timestamptz IS NULL OR COALESCE(o.delivery_at, o.pickup_at) >= $2)
             AND ($3::timestamptz IS NULL OR o.pickup_at < $3)
         ) AS visits
       FROM drivers d
       LEFT JOIN vehicles v ON v.id = d.vehicle_id
       WHERE d.tenant_id = $1
       ORDER BY d.name`,
      [req.user.tenantId, from, to],
    ),
    pool.query(
      `SELECT o.id, o.reference, o.status, o.origin, o.destination, o.pickup_at, o.delivery_at,
              o.price_cents, o.currency, o.cargo, c.name AS company_name,
              COALESCE((SELECT SUM(amount_cents) FROM order_expenses e WHERE e.order_id = o.id), 0)::int AS expense_cents,
              r.id AS relation_id, r.driver_id, r.vehicle_id, r.kind, r.status AS relation_status,
              d.name AS driver_name, v.plate
       FROM orders o
       LEFT JOIN companies c ON c.id = o.company_id
       LEFT JOIN LATERAL (
         SELECT * FROM relations rel WHERE rel.order_id = o.id ORDER BY rel.created_at DESC LIMIT 1
       ) r ON true
       LEFT JOIN drivers d ON d.id = r.driver_id
       LEFT JOIN vehicles v ON v.id = r.vehicle_id
       WHERE o.tenant_id = $1 AND o.status <> 'cancelled'
         AND ($2::text IS NULL OR o.status = $2)
         AND ($3::text IS NULL OR o.reference ILIKE $3 OR c.name ILIKE $3 OR o.origin ILIKE $3 OR o.destination ILIKE $3)
         AND (
           ($4::timestamptz IS NULL AND $5::timestamptz IS NULL)
           OR (
             o.pickup_at IS NOT NULL
             AND o.pickup_at < $5
             AND COALESCE(o.delivery_at, o.pickup_at) >= $4
           )
           OR (r.id IS NULL AND o.pickup_at IS NULL)
         )
       ORDER BY o.pickup_at NULLS LAST, o.reference`,
      [req.user.tenantId, status, q, from, to],
    ),
  ])
  res.json({ drivers: drivers.rows, orders: orders.rows })
}))

router.post('/dispatch/assign', asyncRoute(async (req, res) => {
  await assertTrial(req.user.tenantId)
  const order = await mustOrder(req.body.orderId, req.user.tenantId)
  const kind = oneOf(req.body.kind, ['own_fleet', 'subcontracted'], null)
  if (!kind) throw httpError(400, 'Choose own fleet or a subcontracted carrier.')

  let vehicleId = null
  let driverId = null
  let carrierId = null
  let cost = cents(req.body.costCents)

  if (kind === 'own_fleet') {
    if (req.body.driverId) {
      const driver = (await pool.query('SELECT * FROM drivers WHERE id = $1 AND tenant_id = $2', [req.body.driverId, req.user.tenantId])).rows[0]
      if (!driver) throw httpError(400, 'Choose a driver.')
      driverId = driver.id
      vehicleId = driver.vehicle_id || req.body.vehicleId || null
    }
    if (!vehicleId && req.body.vehicleId) {
      const vehicle = await pool.query('SELECT * FROM vehicles WHERE id = $1 AND tenant_id = $2', [req.body.vehicleId, req.user.tenantId])
      if (!vehicle.rows[0]) throw httpError(400, 'Choose a vehicle.')
      if (vehicle.rows[0].status === 'maintenance') throw httpError(409, 'That vehicle is in maintenance.')
      vehicleId = vehicle.rows[0].id
    }
    if (!vehicleId && !driverId) throw httpError(400, 'Choose a driver or a vehicle.')
    if (vehicleId && !driverId) {
      const driver = await pool.query(
        `SELECT id FROM drivers WHERE tenant_id = $1 AND (id = $2 OR vehicle_id = $3) ORDER BY (id = $2) DESC LIMIT 1`,
        [req.user.tenantId, req.body.driverId || null, vehicleId],
      )
      driverId = driver.rows[0]?.id || null
    }
    if (vehicleId && req.body.costCents == null && order.distance_km) {
      const vehicle = (await pool.query('SELECT cost_per_km_cents FROM vehicles WHERE id = $1', [vehicleId])).rows[0]
      cost = Math.round(order.distance_km * (vehicle?.cost_per_km_cents || 0))
    }
  } else {
    const carrier = await pool.query(
      `SELECT * FROM companies WHERE id = $1 AND tenant_id = $2 AND role IN ('carrier','both')`,
      [req.body.carrierCompanyId, req.user.tenantId],
    )
    if (!carrier.rows[0]) throw httpError(400, 'Choose a carrier.')
    if (carrier.rows[0].blacklisted) throw httpError(409, 'That carrier is blacklisted.')
    carrierId = carrier.rows[0].id
  }

  await pool.query(
    `DELETE FROM relations WHERE order_id = $1 AND tenant_id = $2 AND status IN ('planned','assigned')`,
    [order.id, req.user.tenantId],
  )
  const pickupAt = dateOrNull(req.body.pickupAt)
  if (pickupAt) {
    await pool.query('UPDATE orders SET pickup_at = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3', [pickupAt, order.id, req.user.tenantId])
    order.pickup_at = pickupAt
  }
  const { rows } = await pool.query(
    `INSERT INTO relations (tenant_id, order_id, kind, vehicle_id, driver_id, carrier_company_id, cost_cents, currency, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [req.user.tenantId, order.id, kind, vehicleId, driverId, carrierId, cost, order.currency, driverId || carrierId ? 'assigned' : 'planned'],
  )
  if (order.status === 'booked') {
    await pool.query(`UPDATE orders SET status = 'assigned', updated_at = now() WHERE id = $1`, [order.id])
  }
  if (vehicleId) await syncVehicle(vehicleId)
  await audit(req, 'assign', 'order', order.id, { relationId: rows[0].id, kind })

  if (driverId) {
    const driver = (await pool.query('SELECT * FROM drivers WHERE id = $1', [driverId])).rows[0]
    const when = order.pickup_at ? new Date(order.pickup_at) : new Date()
    const end = new Date(when.getTime() + (order.duration_min || 240) * 60000)
    const calendar = await createCalendarEvent(req.user.tenantId, {
      summary: `${order.reference} ${order.origin || ''} → ${order.destination || ''}`,
      description: order.cargo || 'Transport assignment',
      start: { dateTime: when.toISOString() },
      end: { dateTime: end.toISOString() },
    })
    await pool.query(
      `INSERT INTO activities (tenant_id, object_type, object_id, kind, title, body, created_by)
       VALUES ($1,'order',$2,'system',$3,$4,$5)`,
      [req.user.tenantId, order.id, `Assigned to ${driver?.name || 'a driver'}`, calendar.created ? 'Added to Google Calendar.' : calendar.reason, req.user.id],
    )
  }

  res.status(201).json(rows[0])
}))

router.post('/dispatch/unassign', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    req.body.orderId
      ? `DELETE FROM relations WHERE order_id = $1 AND tenant_id = $2 AND status IN ('planned','assigned') RETURNING *`
      : `DELETE FROM relations WHERE id = $1 AND tenant_id = $2 AND status IN ('planned','assigned') RETURNING *`,
    [req.body.orderId || req.body.relationId, req.user.tenantId],
  )
  if (!rows[0]) throw httpError(409, 'That assignment can no longer be removed.')
  const left = await pool.query('SELECT 1 FROM relations WHERE order_id = $1', [rows[0].order_id])
  if (!left.rowCount) {
    await pool.query(`UPDATE orders SET status = 'booked', updated_at = now() WHERE id = $1 AND status = 'assigned'`, [rows[0].order_id])
  }
  if (rows[0].vehicle_id) await syncVehicle(rows[0].vehicle_id)
  res.json({ ok: true })
}))

const driver = Router()

driver.get('/assignments', asyncRoute(async (req, res) => {
  if (req.user.role !== 'driver') throw httpError(403, 'Open this view from a driver seat.')
  const { rows } = await pool.query(
    `SELECT r.id AS relation_id, r.status AS relation_status, r.kind,
            o.id, o.reference, o.origin, o.destination, o.cargo, o.weight_kg, o.pickup_at, o.delivery_at,
            o.distance_km, o.duration_min, o.status AS order_status, o.notes, c.name AS company_name, v.plate,
            (SELECT filename FROM documents doc
             WHERE doc.tenant_id = r.tenant_id AND doc.object_type = 'order' AND doc.object_id = o.id AND doc.kind = 'pod'
             ORDER BY doc.created_at DESC LIMIT 1) AS pod_filename,
            EXISTS (
              SELECT 1 FROM documents doc
              WHERE doc.tenant_id = r.tenant_id AND doc.object_type = 'order' AND doc.object_id = o.id AND doc.kind = 'signature'
            ) AS has_signature
     FROM relations r
     JOIN orders o ON o.id = r.order_id
     JOIN drivers d ON d.id = r.driver_id
     LEFT JOIN companies c ON c.id = o.company_id
     LEFT JOIN vehicles v ON v.id = r.vehicle_id
     WHERE r.tenant_id = $1 AND d.user_id = $2 AND o.status NOT IN ('cancelled')
     ORDER BY o.pickup_at NULLS LAST`,
    [req.user.tenantId, req.user.id],
  )
  res.json({ data: rows })
}))

driver.post('/relations/:id/status', asyncRoute(async (req, res) => {
  const relation = await ownRelation(req)
  const next = oneOf(req.body.status, ['arrived', 'loaded', 'in_transit', 'delivered'], null)
  if (!next) throw httpError(400, 'Status must be arrived, loaded, in transit, or delivered.')
  await pool.query('UPDATE relations SET status = $1, updated_at = now() WHERE id = $2', [next, relation.id])
  await applyOrderProgress(req, relation.order_id, next)
  await notifyOrderStatus(req, relation, next)
  res.json({ ok: true })
}))

driver.post('/relations/:id/pod', upload.single('file'), asyncRoute(async (req, res) => {
  if (!req.file) throw httpError(400, 'Choose a photo or PDF.')
  const relation = await ownRelation(req)
  await storeDocument({
    tenantId: req.user.tenantId, objectType: 'order', objectId: relation.order_id,
    kind: 'pod', file: req.file, userId: req.user.id,
  })
  res.status(201).json({ ok: true })
}))

driver.post('/relations/:id/signature', upload.single('file'), asyncRoute(async (req, res) => {
  if (!req.file) throw httpError(400, 'Signature file is missing.')
  const relation = await ownRelation(req)
  await storeDocument({
    tenantId: req.user.tenantId, objectType: 'order', objectId: relation.order_id,
    kind: 'signature', file: { ...req.file, originalname: req.file.originalname || 'signature.png' }, userId: req.user.id,
  })
  res.status(201).json({ ok: true })
}))

async function notifyOrderStatus(req, relation, next) {
  if (relation.status === next) return
  const order = await mustOrder(relation.order_id, req.user.tenantId)
  await notify(req.user.tenantId, {
    kind: 'order_status',
    title: order.reference,
    body: `${req.user.name}\n${next}`,
    href: `/orders/${order.id}`,
  })
}

async function applyOrderProgress(req, orderId, relationStatus) {
  const current = await mustOrder(orderId, req.user.tenantId)
  if (['invoiced', 'cancelled'].includes(current.status)) return
  if (relationStatus === 'delivered') {
    const open = await pool.query(
      `SELECT 1 FROM relations WHERE order_id = $1 AND status <> 'delivered'`,
      [orderId],
    )
    if (open.rowCount) {
      if (current.status !== 'in_transit') {
        await pool.query(`UPDATE orders SET status = 'in_transit', updated_at = now() WHERE id = $1`, [orderId])
      }
    } else {
      const { rows } = await pool.query(
        `UPDATE orders SET status = 'delivered', delivered_at = COALESCE(delivered_at, now()), updated_at = now()
         WHERE id = $1 RETURNING *`,
        [orderId],
      )
      await emit(req.user.tenantId, 'order', 'property_changed', rows[0], current, 0, req.user.id)
    }
  } else if (['booked', 'assigned'].includes(current.status)) {
    await pool.query(`UPDATE orders SET status = 'in_transit', updated_at = now() WHERE id = $1`, [orderId])
  }
  const vehicles = await pool.query('SELECT DISTINCT vehicle_id FROM relations WHERE order_id = $1 AND vehicle_id IS NOT NULL', [orderId])
  for (const row of vehicles.rows) await syncVehicle(row.vehicle_id)
}

async function ownRelation(req) {
  const { rows } = await pool.query(
    `SELECT r.* FROM relations r
     JOIN drivers d ON d.id = r.driver_id
     WHERE r.id = $1 AND r.tenant_id = $2 AND d.user_id = $3`,
    [req.params.id, req.user.tenantId, req.user.id],
  )
  if (!rows[0]) throw httpError(404, 'Assignment not found.')
  return rows[0]
}

async function syncVehicle(vehicleId) {
  await pool.query(
    `UPDATE vehicles SET status = CASE
       WHEN status = 'maintenance' THEN 'maintenance'
       WHEN EXISTS (
         SELECT 1 FROM relations r JOIN orders o ON o.id = r.order_id
         WHERE r.vehicle_id = vehicles.id AND o.status IN ('assigned','in_transit')
       ) THEN 'on_trip' ELSE 'available' END,
       updated_at = now()
     WHERE id = $1`,
    [vehicleId],
  )
}

async function mustOrder(id, tenantId) {
  const { rows } = await pool.query('SELECT * FROM orders WHERE id = $1 AND tenant_id = $2', [id, tenantId])
  if (!rows[0]) throw httpError(404, 'Order not found.')
  return rows[0]
}

async function presentParty(row) {
  if (!row) return null
  const [company, contact] = await Promise.all([
    pool.query('SELECT id, name, role, email, phone, city, country FROM companies WHERE id = $1', [row.company_id]),
    row.contact_id
      ? pool.query('SELECT id, name, email, phone, title FROM contacts WHERE id = $1', [row.contact_id])
      : { rows: [] },
  ])
  return {
    ...row,
    company: company.rows[0] || null,
    contact: contact.rows[0] || null,
  }
}

async function syncCustomerParty(tenantId, orderId, companyId) {
  if (!companyId) {
    await pool.query('DELETE FROM order_parties WHERE order_id = $1 AND tenant_id = $2 AND role = $3', [orderId, tenantId, 'customer'])
    return
  }
  await pool.query(
    `INSERT INTO order_parties (tenant_id, order_id, role, company_id)
     VALUES ($1,$2,'customer',$3)
     ON CONFLICT (order_id, role)
     DO UPDATE SET company_id = EXCLUDED.company_id, updated_at = now()`,
    [tenantId, orderId, companyId],
  )
}

async function loadOrder(id, tenantId) {
  const { rows } = await pool.query(
    `SELECT o.*, c.name AS company_name,
       COALESCE((SELECT SUM(cost_cents) FROM relations r WHERE r.order_id = o.id), 0)::int AS cost_cents,
       COALESCE((SELECT SUM(amount_cents) FROM order_expenses e WHERE e.order_id = o.id), 0)::int AS expense_cents
     FROM orders o LEFT JOIN companies c ON c.id = o.company_id
     WHERE o.id = $1 AND o.tenant_id = $2`,
    [id, tenantId],
  )
  if (!rows[0]) return null
  const [relations, activities, documents, invoice, partyRows, expenses, properties] = await Promise.all([
    pool.query(
      `SELECT r.*, v.plate, v.kind AS vehicle_kind, d.name AS driver_name, d.phone AS driver_phone,
              cc.name AS carrier_name
       FROM relations r
       LEFT JOIN vehicles v ON v.id = r.vehicle_id
       LEFT JOIN drivers d ON d.id = r.driver_id
       LEFT JOIN companies cc ON cc.id = r.carrier_company_id
       WHERE r.order_id = $1 ORDER BY r.created_at`,
      [id],
    ),
    pool.query(
      `SELECT a.*, u.name AS owner_name FROM activities a
       LEFT JOIN users u ON u.id = a.owner_id
       WHERE a.tenant_id = $1 AND a.object_type = 'order' AND a.object_id = $2
       ORDER BY a.created_at DESC`,
      [tenantId, id],
    ),
    pool.query(`SELECT id, kind, filename, mime, size_bytes, created_at FROM documents WHERE tenant_id = $1 AND object_type = 'order' AND object_id = $2 ORDER BY created_at DESC`, [tenantId, id]),
    pool.query(`SELECT id, number, status, amount_cents, currency, due_at FROM invoices WHERE order_id = $1 AND tenant_id = $2 AND status <> 'void' ORDER BY created_at DESC LIMIT 1`, [id, tenantId]),
    pool.query('SELECT * FROM order_parties WHERE order_id = $1 AND tenant_id = $2', [id, tenantId]),
    pool.query(`${EXPENSE_SELECT} WHERE e.order_id = $1 AND e.tenant_id = $2 ORDER BY e.occurred_on, e.created_at`, [id, tenantId]),
    pool.query('SELECT * FROM order_property_defs WHERE tenant_id = $1 ORDER BY sort_order, created_at', [tenantId]),
  ])
  const parties = { customer: null, broker: null, carrier: null }
  for (const row of partyRows.rows) parties[row.role] = await presentParty(row)
  return {
    ...rows[0],
    relations: relations.rows,
    activities: activities.rows,
    documents: documents.rows,
    invoice: invoice.rows[0] || null,
    parties,
    expenses: expenses.rows,
    properties: properties.rows,
  }
}

async function insertOrder(req, body, reference) {
  const origin = text(body.origin, 180)
  const destination = text(body.destination, 180)
  const leg = origin && destination ? await computeRoute(origin, destination) : null
  const { rows } = await pool.query(
    `INSERT INTO orders (tenant_id, company_id, owner_id, reference, origin, destination, cargo, weight_kg, load_type, price_cents, currency, pickup_at, delivery_at, distance_km, duration_min, distance_source, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
    [
      req.user.tenantId, body.companyId || null, req.user.id, reference, origin, destination, text(body.cargo, 240),
      intOrNull(body.weightKg), oneOf(body.loadType, LOAD_TYPES, 'FTL'), cents(body.priceCents),
      oneOf(body.currency, CURRENCIES, 'EUR'), dateOrNull(body.pickupAt), dateOrNull(body.deliveryAt),
      leg?.distanceKm ?? null, leg?.durationMin ?? null, leg?.source ?? null, text(body.notes, 4000),
    ],
  )
  await rememberAddress(req.user.tenantId, rows[0].company_id, origin)
  await rememberAddress(req.user.tenantId, rows[0].company_id, destination)
  if (rows[0].company_id) await syncCustomerParty(req.user.tenantId, rows[0].id, rows[0].company_id)
  await audit(req, 'create', 'order', rows[0].id, { reference })
  await emit(req.user.tenantId, 'order', 'created', rows[0], null, 0, req.user.id)
  return rows[0]
}

export { driver }
export default router
