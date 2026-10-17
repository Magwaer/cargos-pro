import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { pool } from './db.js'

function secret() {
  return process.env.JWT_SECRET || 'dev-only-change-me'
}

export function signUser(user) {
  return jwt.sign(
    {
      sub: user.id,
      tenantId: user.tenant_id,
      role: user.role,
      email: user.email,
      name: user.name,
    },
    secret(),
    { expiresIn: '7d' },
  )
}

export function hashApiKey(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) return res.status(401).json({ error: 'Sign in required.' })

  if (token.startsWith('ck_')) {
    const { rows } = await pool.query(
      `SELECT k.*, u.role, u.email, u.name, u.active
       FROM api_keys k
       LEFT JOIN users u ON u.id = k.created_by
       WHERE k.key_hash = $1 AND k.revoked_at IS NULL`,
      [hashApiKey(token)],
    )
    const key = rows[0]
    if (!key) return res.status(401).json({ error: 'API key is not valid.' })
    req.user = {
      id: key.created_by,
      tenantId: key.tenant_id,
      role: key.role || 'owner',
      email: key.email || '',
      name: key.name,
      scope: key.scope,
      apiKeyId: key.id,
    }
    return next()
  }

  try {
    const payload = jwt.verify(token, secret())
    req.user = {
      id: payload.sub,
      tenantId: payload.tenantId,
      role: payload.role,
      email: payload.email,
      name: payload.name,
      scope: 'write',
    }
    return next()
  } catch {
    return res.status(401).json({ error: 'Session expired. Sign in again.' })
  }
}

export function requireOffice(req, res, next) {
  if (req.user?.role === 'driver') {
    return res.status(403).json({ error: 'Driver seats use the driver view.' })
  }
  next()
}

export function requireWrite(req, res, next) {
  if (req.user?.scope === 'read' && !['GET', 'HEAD'].includes(req.method)) {
    return res.status(403).json({ error: 'This API key is read-only.' })
  }
  next()
}

export async function audit(req, action, objectType, objectId, detail) {
  await pool.query(
    `INSERT INTO audit_log (tenant_id, user_id, action, object_type, object_id, detail)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [req.user.tenantId, req.user.id || null, action, objectType, objectId, detail ? JSON.stringify(detail) : null],
  )
}

export async function assertTrial(tenantId) {
  const { rows } = await pool.query('SELECT plan, trial_ends_at FROM tenants WHERE id = $1', [tenantId])
  const tenant = rows[0]
  if (!tenant) throw Object.assign(new Error('Workspace not found.'), { status: 404 })
  if (tenant.plan === 'trial' && tenant.trial_ends_at && new Date(tenant.trial_ends_at) < new Date()) {
    throw Object.assign(new Error('Trial ended. Choose a subscription in Settings to keep creating records.'), { status: 402 })
  }
}
