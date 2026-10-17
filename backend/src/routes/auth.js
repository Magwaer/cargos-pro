import bcrypt from 'bcryptjs'
import { Router } from 'express'
import { pool } from '../db.js'
import { audit, requireAuth, signUser } from '../auth.js'
import { asyncRoute, httpError } from '../http.js'
import { text } from '../enums.js'

const router = Router()

function slugify(value) {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  return slug || 'workspace'
}

router.post('/register', asyncRoute(async (req, res) => {
  const name = text(req.body.name, 120)
  const company = text(req.body.company, 160)
  const email = text(req.body.email, 180)?.toLowerCase()
  const password = String(req.body.password || '')
  if (!name || !company || !email || password.length < 8) {
    throw httpError(400, 'Name, company, email, and a password of at least 8 characters are required.')
  }
  const hash = await bcrypt.hash(password, 10)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const base = slugify(company)
    const taken = await client.query('SELECT 1 FROM tenants WHERE slug = $1 OR slug LIKE $2', [base, `${base}-%`])
    const slug = taken.rowCount ? `${base}-${taken.rowCount + 1}` : base
    const tenant = (await client.query(
      `INSERT INTO tenants (name, slug, trial_ends_at) VALUES ($1,$2, now() + interval '14 days') RETURNING id`,
      [company, slug],
    )).rows[0]
    const user = (await client.query(
      `INSERT INTO users (tenant_id, email, password_hash, name, role) VALUES ($1,$2,$3,$4,'owner') RETURNING *`,
      [tenant.id, email, hash, name],
    )).rows[0]
    await client.query(
      `INSERT INTO workflows (tenant_id, name, object_type, trigger_event, trigger_property, trigger_value, actions) VALUES
       ($1, 'Delivery creates an invoice draft', 'order', 'property_changed', 'status', 'delivered', $2::jsonb),
       ($1, 'Overdue invoice alerts finance', 'invoice', 'property_changed', 'status', 'overdue', $3::jsonb)`,
      [
        tenant.id,
        JSON.stringify([
          { type: 'create_task', title: 'Review delivery {{reference}} and send the invoice', assignRole: 'finance' },
          { type: 'create_invoice' },
        ]),
        JSON.stringify([
          { type: 'create_task', title: 'Chase overdue invoice {{number}}', assignRole: 'finance' },
          { type: 'email', subject: 'Payment reminder for {{number}}', body: 'Invoice {{number}} is overdue.' },
        ]),
      ],
    )
    await client.query('COMMIT')
    res.status(201).json({
      token: signUser(user),
      user: { id: user.id, name: user.name, email: user.email, role: user.role, tenantId: user.tenant_id },
    })
  } catch (err) {
    await client.query('ROLLBACK')
    if (err.code === '23505') throw httpError(409, 'An account with that email already exists.')
    throw err
  } finally {
    client.release()
  }
}))

router.post('/login', asyncRoute(async (req, res) => {
  const email = text(req.body.email, 180)?.toLowerCase()
  const password = String(req.body.password || '')
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email])
  const user = rows[0]
  if (!user || !user.active || !(await bcrypt.compare(password, user.password_hash))) {
    throw httpError(401, 'Email or password is incorrect.')
  }
  res.json({
    token: signUser(user),
    user: { id: user.id, name: user.name, email: user.email, role: user.role, tenantId: user.tenant_id, locale: user.locale },
  })
}))

router.get('/me', requireAuth, asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.email, u.role, u.locale, u.tenant_id, t.name AS tenant_name, t.plan, t.trial_ends_at, t.default_currency
     FROM users u JOIN tenants t ON t.id = u.tenant_id
     WHERE u.id = $1`,
    [req.user.id],
  )
  if (!rows[0]) throw httpError(401, 'Sign in required.')
  res.json(rows[0])
}))

router.patch('/me', requireAuth, asyncRoute(async (req, res) => {
  const locale = ['en', 'pl', 'ro'].includes(req.body.locale) ? req.body.locale : undefined
  const name = req.body.name !== undefined ? text(req.body.name, 120) : undefined
  if (name === null) throw httpError(400, 'Name cannot be empty.')
  const sets = []
  const values = []
  if (locale) {
    values.push(locale)
    sets.push(`locale = $${values.length}`)
  }
  if (name) {
    values.push(name)
    sets.push(`name = $${values.length}`)
  }
  if (!sets.length) throw httpError(400, 'Nothing to update.')
  values.push(req.user.id)
  const { rows } = await pool.query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING id, name, email, role, locale, tenant_id`,
    values,
  )
  await audit(req, 'update', 'user', req.user.id, { locale, name })
  res.json(rows[0])
}))

export default router
