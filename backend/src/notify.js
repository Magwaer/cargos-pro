import { EventEmitter } from 'node:events'
import { pool } from './db.js'
import { text } from './enums.js'

const hub = new EventEmitter()
hub.setMaxListeners(0)

export function subscribe(userId, listener) {
  const channel = String(userId)
  hub.on(channel, listener)
  return () => hub.off(channel, listener)
}

export function publish(userId, event, payload) {
  hub.emit(String(userId), { event, payload })
}

function present(row) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    href: row.href,
    readAt: row.read_at,
    createdAt: row.created_at,
  }
}

export function objectHref(type, id) {
  if (type === 'order') return `/orders/${id}`
  if (type === 'company') return `/companies/${id}`
  if (type === 'contact') return `/contacts/${id}`
  if (type === 'invoice') return `/invoices/${id}`
  if (type === 'vehicle') return '/fleet'
  return '/tasks'
}

export async function notify(tenantId, input) {
  const title = text(input.title, 160)
  const kind = text(input.kind, 40)
  if (!tenantId || !title || !kind) return
  const params = [tenantId, kind, title, text(input.body, 240), text(input.href, 200)]
  let users = 'tenant_id = $1 AND active = true AND role <> \'driver\''
  if (input.userId) {
    params.push(input.userId)
    users = `tenant_id = $1 AND active = true AND id = $${params.length}`
  }
  const { rows } = await pool.query(
    `INSERT INTO notifications (tenant_id, user_id, kind, title, body, href)
     SELECT $1, id, $2, $3, $4, $5
     FROM users
     WHERE ${users}
     RETURNING id, user_id, kind, title, body, href, read_at, created_at`,
    params,
  )
  for (const row of rows) publish(row.user_id, 'notification', present(row))
}
