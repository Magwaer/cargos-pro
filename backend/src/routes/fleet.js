import { Router } from 'express'
import { pool } from '../db.js'
import { assertTrial, audit } from '../auth.js'
import { VEHICLE_STATUSES, cents, intOrNull, oneOf, text } from '../enums.js'
import { asyncRoute, changes, httpError } from '../http.js'

const router = Router()

router.get('/vehicles', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT v.*, d.name AS driver_name
     FROM vehicles v
     LEFT JOIN drivers d ON d.vehicle_id = v.id
     WHERE v.tenant_id = $1
     ORDER BY v.plate`,
    [req.user.tenantId],
  )
  res.json({ data: rows })
}))

router.post('/vehicles', asyncRoute(async (req, res) => {
  await assertTrial(req.user.tenantId)
  const plate = text(req.body.plate, 20)
  if (!plate) throw httpError(400, 'Plate is required.')
  try {
    const { rows } = await pool.query(
      `INSERT INTO vehicles (tenant_id, plate, kind, capacity_kg, status, location, cost_per_km_cents, insurance_expires, inspection_expires, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        req.user.tenantId, plate, text(req.body.kind, 40) || 'tractor', intOrNull(req.body.capacityKg),
        oneOf(req.body.status, VEHICLE_STATUSES, 'available'), text(req.body.location, 120),
        cents(req.body.costPerKmCents), req.body.insuranceExpires || null, req.body.inspectionExpires || null, text(req.body.notes, 2000),
      ],
    )
    await audit(req, 'create', 'vehicle', rows[0].id, { plate })
    res.status(201).json(rows[0])
  } catch (err) {
    if (err.code === '23505') throw httpError(409, 'That plate is already in the fleet.')
    throw err
  }
}))

router.patch('/vehicles/:id', asyncRoute(async (req, res) => {
  const body = {
    ...req.body,
    capacity_kg: req.body.capacityKg ?? req.body.capacity_kg,
    cost_per_km_cents: req.body.costPerKmCents ?? req.body.cost_per_km_cents,
    insurance_expires: req.body.insuranceExpires ?? req.body.insurance_expires,
    inspection_expires: req.body.inspectionExpires ?? req.body.inspection_expires,
  }
  if (req.body.plate !== undefined && !text(req.body.plate, 20)) throw httpError(400, 'Plate is required.')
  const { values, sets } = changes(body, {
    plate: (v) => text(v, 20),
    kind: (v) => text(v, 40),
    capacity_kg: (v) => intOrNull(v),
    status: (v) => oneOf(v, VEHICLE_STATUSES, 'available'),
    location: (v) => text(v, 120),
    cost_per_km_cents: (v) => cents(v),
    insurance_expires: (v) => v || null,
    inspection_expires: (v) => v || null,
    notes: (v) => text(v, 2000),
  })
  if (!sets.length) throw httpError(400, 'Nothing to update.')
  values.push(req.params.id, req.user.tenantId)
  try {
    const { rows } = await pool.query(
      `UPDATE vehicles SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length - 1} AND tenant_id = $${values.length} RETURNING *`,
      values,
    )
    if (!rows[0]) throw httpError(404, 'Vehicle not found.')
    await audit(req, 'update', 'vehicle', rows[0].id, { plate: rows[0].plate })
    res.json(rows[0])
  } catch (err) {
    if (err.code === '23505') throw httpError(409, 'That plate is already in the fleet.')
    throw err
  }
}))

router.delete('/vehicles/:id', asyncRoute(async (req, res) => {
  const used = await pool.query(`SELECT 1 FROM relations WHERE vehicle_id = $1 AND status NOT IN ('delivered')`, [req.params.id])
  if (used.rowCount) throw httpError(409, 'This vehicle still has an active assignment.')
  const { rowCount } = await pool.query('DELETE FROM vehicles WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user.tenantId])
  if (!rowCount) throw httpError(404, 'Vehicle not found.')
  res.json({ ok: true })
}))

router.get('/drivers', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT d.*, v.plate, u.email AS user_email
     FROM drivers d
     LEFT JOIN vehicles v ON v.id = d.vehicle_id
     LEFT JOIN users u ON u.id = d.user_id
     WHERE d.tenant_id = $1
     ORDER BY d.name`,
    [req.user.tenantId],
  )
  res.json({ data: rows })
}))

router.post('/drivers', asyncRoute(async (req, res) => {
  await assertTrial(req.user.tenantId)
  const name = text(req.body.name, 160)
  if (!name) throw httpError(400, 'Driver name is required.')
  const { rows } = await pool.query(
    `INSERT INTO drivers (tenant_id, user_id, vehicle_id, name, phone, license_no, adr, license_expires)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.user.tenantId, req.body.userId || null, req.body.vehicleId || null, name, text(req.body.phone, 40), text(req.body.licenseNo, 40), Boolean(req.body.adr), req.body.licenseExpires || null],
  )
  await audit(req, 'create', 'driver', rows[0].id, { name })
  res.status(201).json(rows[0])
}))

router.patch('/drivers/:id', asyncRoute(async (req, res) => {
  const body = {
    ...req.body,
    user_id: req.body.userId ?? req.body.user_id,
    vehicle_id: req.body.vehicleId ?? req.body.vehicle_id,
    license_no: req.body.licenseNo ?? req.body.license_no,
    license_expires: req.body.licenseExpires ?? req.body.license_expires,
  }
  if (req.body.name !== undefined && !text(req.body.name, 160)) throw httpError(400, 'Driver name is required.')
  const { values, sets } = changes(body, {
    user_id: (v) => v || null,
    vehicle_id: (v) => v || null,
    name: (v) => text(v, 160),
    phone: (v) => text(v, 40),
    license_no: (v) => text(v, 40),
    adr: (v) => Boolean(v),
    license_expires: (v) => v || null,
  })
  if (!sets.length) throw httpError(400, 'Nothing to update.')
  values.push(req.params.id, req.user.tenantId)
  const { rows } = await pool.query(
    `UPDATE drivers SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length - 1} AND tenant_id = $${values.length} RETURNING *`,
    values,
  )
  if (!rows[0]) throw httpError(404, 'Driver not found.')
  await audit(req, 'update', 'driver', rows[0].id, { name: rows[0].name })
  res.json(rows[0])
}))

router.delete('/drivers/:id', asyncRoute(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM drivers WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user.tenantId])
  if (!rowCount) throw httpError(404, 'Driver not found.')
  res.json({ ok: true })
}))

export default router
