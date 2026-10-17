import { pool } from './db.js'
import {
  INVOICE_STATUSES,
  LOAD_TYPES,
  ORDER_STATUSES,
  cents,
  intOrNull,
  oneOf,
  text,
} from './enums.js'
import { sendGmail, sendSms, storeSms } from './integrations.js'
import { notify, objectHref } from './notify.js'

const NATIVE_FIELDS = {
  order: {
    status: (v) => oneOf(v, ORDER_STATUSES, null),
    origin: (v) => text(v, 180),
    destination: (v) => text(v, 180),
    cargo: (v) => text(v, 240),
    notes: (v) => text(v, 4000),
    price_cents: (v) => cents(v),
    load_type: (v) => oneOf(v, LOAD_TYPES, 'FTL'),
  },
  invoice: {
    status: (v) => oneOf(v, INVOICE_STATUSES, null),
  },
  company: {
    name: (v) => text(v, 180),
    email: (v) => text(v, 180),
    phone: (v) => text(v, 40),
    city: (v) => text(v, 80),
    country: (v) => text(v, 8),
    payment_terms_days: (v) => intOrNull(v) ?? 14,
    warning: (v) => String(v) === 'true' || v === true,
    blacklisted: (v) => String(v) === 'true' || v === true,
  },
  contact: {
    name: (v) => text(v, 160),
    email: (v) => text(v, 180),
    phone: (v) => text(v, 40),
    title: (v) => text(v, 120),
  },
}

const TABLES = { order: 'orders', invoice: 'invoices', company: 'companies', contact: 'contacts' }

function fill(template, record) {
  return String(template ?? '').replace(/\{\{(\w+)\}\}/g, (_, key) => (record?.[key] == null ? '' : String(record[key])))
}

function recordValue(record, property) {
  if (!property) return undefined
  if (property.startsWith('custom.')) {
    const custom = record.custom && typeof record.custom === 'object' ? record.custom : {}
    return custom[property.slice(7)]
  }
  if (record.custom && typeof record.custom === 'object' && Object.hasOwn(record.custom, property) && record[property] === undefined) {
    return record.custom[property]
  }
  return record[property]
}

function matches(workflow, event, record, previous) {
  if (workflow.trigger_event === 'created') return event === 'created'
  if (workflow.trigger_event === 'updated') return event === 'updated' || event === 'created'
  if (workflow.trigger_event !== 'property_changed') return false
  const property = workflow.trigger_property
  if (!property) return false
  const now = recordValue(record, property)
  const before = previous ? recordValue(previous, property) : undefined
  if (String(now ?? '') === String(before ?? '')) return false
  if (workflow.trigger_value == null || workflow.trigger_value === '') return true
  return String(now ?? '') === String(workflow.trigger_value)
}

function matchCondition(record, config = {}) {
  const raw = recordValue(record, config.property)
  const value = Array.isArray(raw) ? raw.join(',') : raw
  const expected = fill(config.value ?? '', record)
  const left = value == null ? '' : String(value)
  if (config.operator === 'is_empty') return left === ''
  if (config.operator === 'is_not_empty') return left !== ''
  if (config.operator === 'contains') return left.toLowerCase().includes(expected.toLowerCase())
  if (config.operator === 'not_equals') return left !== expected
  return left === expected
}

async function assignee(tenantId, role) {
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE tenant_id = $1 AND role = $2 AND active = true ORDER BY created_at LIMIT 1`,
    [tenantId, role || 'owner'],
  )
  if (rows[0]) return rows[0].id
  const owner = await pool.query(
    `SELECT id FROM users WHERE tenant_id = $1 AND role = 'owner' AND active = true LIMIT 1`,
    [tenantId],
  )
  return owner.rows[0]?.id || null
}

export async function createInvoiceForOrder(tenantId, order, userId) {
  const existing = await pool.query(
    `SELECT * FROM invoices WHERE tenant_id = $1 AND order_id = $2 AND status <> 'void' LIMIT 1`,
    [tenantId, order.id],
  )
  if (existing.rows[0]) return existing.rows[0]

  const company = order.company_id
    ? (await pool.query('SELECT payment_terms_days FROM companies WHERE id = $1 AND tenant_id = $2', [order.company_id, tenantId])).rows[0]
    : null
  const terms = company?.payment_terms_days ?? 14
  const count = await pool.query('SELECT count(*)::int AS n FROM invoices WHERE tenant_id = $1', [tenantId])
  const number = `INV-${1001 + count.rows[0].n}`
  const issued = new Date()
  const due = new Date(issued.getTime() + terms * 86400000)
  const { rows } = await pool.query(
    `INSERT INTO invoices (tenant_id, company_id, order_id, number, status, amount_cents, currency, issued_at, due_at)
     VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$8) RETURNING *`,
    [tenantId, order.company_id, order.id, number, order.price_cents || 0, order.currency || 'EUR', issued.toISOString().slice(0, 10), due.toISOString().slice(0, 10)],
  )
  await pool.query(
    `UPDATE orders SET status = 'invoiced', delivered_at = COALESCE(delivered_at, now()), updated_at = now() WHERE id = $1 AND tenant_id = $2`,
    [order.id, tenantId],
  )
  await pool.query(
    `INSERT INTO activities (tenant_id, object_type, object_id, kind, title, body, created_by)
     VALUES ($1,'order',$2,'system',$3,$4,$5)`,
    [tenantId, order.id, `Draft invoice ${number}`, 'Created from the order.', userId || null],
  )
  return rows[0]
}

export async function loadRecord(tenantId, objectType, objectId) {
  const table = TABLES[objectType]
  if (!table) return null
  const { rows } = await pool.query(`SELECT * FROM ${table} WHERE id = $1 AND tenant_id = $2`, [objectId, tenantId])
  const row = rows[0]
  if (!row) return null
  if (objectType === 'order' && row.custom && typeof row.custom === 'string') {
    try { row.custom = JSON.parse(row.custom) } catch { row.custom = {} }
  }
  if (objectType === 'invoice' && row.company_id) {
    const company = (await pool.query('SELECT email, phone, name FROM companies WHERE id = $1', [row.company_id])).rows[0]
    return { ...row, email: company?.email || null, phone: company?.phone || null, company_name: company?.name || '' }
  }
  return row
}

async function editRecord(tenantId, objectType, record, action) {
  const fields = Array.isArray(action.fields) ? action.fields : action.field
    ? [{ key: action.field, source: action.source || 'native', value: action.value }]
    : []
  const native = NATIVE_FIELDS[objectType] || {}
  const sets = []
  const values = []
  const custom = { ...(record.custom && typeof record.custom === 'object' ? record.custom : {}) }
  let customChanged = false

  for (const field of fields) {
    const key = text(field.key, 80)
    if (!key) continue
    const raw = fill(field.value ?? '', record)
    if (field.source === 'custom' && objectType === 'order') {
      custom[key] = raw
      customChanged = true
      record.custom = custom
      continue
    }
    const coerce = native[key]
    if (!coerce) continue
    values.push(coerce(raw))
    sets.push(`${key} = $${values.length}`)
    record[key] = values[values.length - 1]
  }

  if (customChanged && objectType === 'order') {
    values.push(JSON.stringify(custom))
    sets.push(`custom = $${values.length}::jsonb`)
  }
  if (!sets.length) return 'edit skipped'
  values.push(record.id, tenantId)
  await pool.query(
    `UPDATE ${TABLES[objectType]} SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length - 1} AND tenant_id = $${values.length}`,
    values,
  )
  return `edited ${sets.length} field(s)`
}

async function runAction(tenantId, action, objectType, record, userId) {
  const type = action.type === 'set_property' || action.type === 'update_property' ? 'edit_record' : action.type

  if (type === 'create_task') {
    const ownerId = await assignee(tenantId, action.assignRole)
    const title = fill(action.title || 'Follow up', record)
    await pool.query(
      `INSERT INTO activities (tenant_id, object_type, object_id, kind, title, due_at, owner_id, created_by)
       VALUES ($1,$2,$3,'task',$4, now() + interval '1 day', $5, $6)`,
      [tenantId, objectType, record.id, title, ownerId, userId || null],
    )
    return `task: ${title}`
  }

  if (type === 'edit_record') return editRecord(tenantId, objectType, record, action)

  if (type === 'create_invoice') {
    if (objectType !== 'order') return 'invoice skipped'
    const invoice = await createInvoiceForOrder(tenantId, record, userId)
    return `invoice ${invoice.number}`
  }

  if (type === 'email') {
    const subject = fill(action.subject || action.title || 'Message from Cargos.pro', record)
    const body = fill(action.body || '', record)
    const to = record.email || null
    const sent = to ? await sendGmail(tenantId, { to, subject, body }) : { sent: false, reason: 'No recipient email on the record.' }
    await pool.query(
      `INSERT INTO activities (tenant_id, object_type, object_id, kind, title, body)
       VALUES ($1,$2,$3,'email',$4,$5)`,
      [tenantId, objectType, record.id, subject, sent.sent ? body : `${body}\n\nNot sent: ${sent.reason}`],
    )
    return sent.sent ? 'email sent' : `email logged (${sent.reason})`
  }

  if (type === 'sms') {
    const body = fill(action.body || action.title || '', record)
    const to = record.phone || null
    const sent = to ? await sendSms(tenantId, to, body) : { sent: false, reason: 'No phone number on the record.' }
    if (sent.sent) {
      try {
        await storeSms(tenantId, {
          contactId: objectType === 'contact' ? record.id : null,
          peer: to,
          direction: 'out',
          body,
          sid: sent.sid,
          status: 'sent',
        })
      } catch (error) {
        console.error('Could not store workflow SMS', error)
      }
    }
    await pool.query(
      `INSERT INTO activities (tenant_id, object_type, object_id, kind, title, body)
       VALUES ($1,$2,$3,'sms',$4,$5)`,
      [tenantId, objectType, record.id, 'SMS', sent.sent ? body : `${body}\n\nNot sent: ${sent.reason}`],
    )
    return sent.sent ? 'sms sent' : `sms logged (${sent.reason})`
  }

  if (type === 'notification') {
    await notify(tenantId, {
      kind: 'workflow',
      title: fill(action.title || 'Workflow', record),
      body: fill(action.body || '', record),
      href: objectHref(objectType, record.id),
    })
    return 'notification sent'
  }

  if (type === 'webhook') {
    const url = text(action.url, 500)
    if (!url || !/^https:\/\//i.test(url)) return 'webhook skipped'
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ objectType, record }),
        signal: controller.signal,
      })
      return `webhook ${response.status}`
    } catch (error) {
      return `webhook failed (${error.message})`
    } finally {
      clearTimeout(timer)
    }
  }

  return 'unknown action'
}

function nextNodes(graph, fromId, when) {
  return (graph.edges || [])
    .filter((edge) => edge.from === fromId && (when ? edge.when === when : !edge.when))
    .map((edge) => (graph.nodes || []).find((node) => node.id === edge.to))
    .filter(Boolean)
}

async function walkGraph(tenantId, workflow, graph, objectType, record, userId, fromId = 'start') {
  const notes = []
  const queue = nextNodes(graph, fromId)
  while (queue.length) {
    const node = queue.shift()
    if (!node) continue
    if (node.type === 'delay') {
      const amount = Math.max(1, Number(node.config?.amount) || 1)
      const unit = node.config?.unit === 'hours' ? 'hours' : 'days'
      await pool.query(
        `INSERT INTO workflow_waits (tenant_id, workflow_id, object_type, object_id, node_id, resume_at)
         VALUES ($1,$2,$3,$4,$5, now() + make_interval(${unit === 'hours' ? 'hours' : 'days'} => $6))
         ON CONFLICT (workflow_id, object_id)
         DO UPDATE SET node_id = EXCLUDED.node_id, resume_at = EXCLUDED.resume_at`,
        [tenantId, workflow.id, objectType, record.id, node.id, amount],
      )
      notes.push(`delay ${amount} ${unit}`)
      continue
    }
    if (node.type === 'split') {
      const yes = matchCondition(record, node.config)
      queue.push(...nextNodes(graph, node.id, yes ? 'yes' : 'no'))
      notes.push(`split ${yes ? 'yes' : 'no'}`)
      continue
    }
    notes.push(await runAction(tenantId, { type: node.type, ...(node.config || {}) }, objectType, record, userId))
    queue.push(...nextNodes(graph, node.id))
  }
  return notes
}

async function runWorkflow(tenantId, workflow, objectType, record, userId, fromNodeId) {
  const notes = []
  let status = 'ok'
  try {
    if (workflow.graph && (workflow.graph.nodes || []).length) {
      notes.push(...await walkGraph(tenantId, workflow, workflow.graph, objectType, record, userId, fromNodeId || 'start'))
    } else {
      for (const action of workflow.actions || []) {
        notes.push(await runAction(tenantId, action, objectType, record, userId))
      }
    }
  } catch (err) {
    status = 'error'
    notes.push(err.message)
  }
  await pool.query(
    `INSERT INTO workflow_runs (tenant_id, workflow_id, object_type, object_id, status, detail)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [tenantId, workflow.id, objectType, record.id, status, notes.join('; ')],
  )
}

export async function emit(tenantId, objectType, event, record, previous = null, depth = 0, userId = null) {
  if (!record || depth > 3) return
  const { rows } = await pool.query(
    `SELECT * FROM workflows WHERE tenant_id = $1 AND enabled = true AND object_type = $2`,
    [tenantId, objectType],
  )
  for (const workflow of rows) {
    if (!matches(workflow, event, record, previous)) continue
    await runWorkflow(tenantId, workflow, objectType, record, userId)
  }
}

async function notifyDueTasks() {
  const { rows } = await pool.query(
    `UPDATE activities SET notified_at = now()
     WHERE kind = 'task' AND done = false AND due_at IS NOT NULL AND due_at <= now() AND notified_at IS NULL
     RETURNING *`,
  )
  for (const task of rows) {
    await notify(task.tenant_id, {
      kind: 'task_due',
      title: task.title || 'Task due',
      body: task.body || '',
      href: objectHref(task.object_type, task.object_id),
      userId: task.owner_id || undefined,
    })
  }
}

async function resumeWaits() {
  const { rows } = await pool.query(
    `DELETE FROM workflow_waits WHERE resume_at <= now() RETURNING *`,
  )
  for (const wait of rows) {
    const workflow = (await pool.query(
      `SELECT * FROM workflows WHERE id = $1 AND tenant_id = $2 AND enabled = true`,
      [wait.workflow_id, wait.tenant_id],
    )).rows[0]
    const record = await loadRecord(wait.tenant_id, wait.object_type, wait.object_id)
    if (!workflow || !record || !workflow.graph) continue
    const notes = []
    try {
      notes.push(...await walkGraph(wait.tenant_id, workflow, workflow.graph, wait.object_type, record, null, wait.node_id))
    } catch (err) {
      notes.push(err.message)
    }
    await pool.query(
      `INSERT INTO workflow_runs (tenant_id, workflow_id, object_type, object_id, status, detail)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [wait.tenant_id, workflow.id, wait.object_type, wait.object_id, notes.some((note) => /failed|error/i.test(note)) ? 'error' : 'ok', notes.join('; ')],
    )
  }
}

export async function maintenanceTick() {
  const overdue = await pool.query(
    `UPDATE invoices SET status = 'overdue', updated_at = now()
     WHERE status = 'sent' AND due_at < CURRENT_DATE
     RETURNING *`,
  )
  for (const invoice of overdue.rows) {
    const company = invoice.company_id
      ? (await pool.query('SELECT email, phone, name FROM companies WHERE id = $1', [invoice.company_id])).rows[0]
      : null
    await emit(
      invoice.tenant_id,
      'invoice',
      'property_changed',
      { ...invoice, email: company?.email || null, phone: company?.phone || null, company_name: company?.name || '' },
      { ...invoice, status: 'sent' },
    )
    await notify(invoice.tenant_id, {
      kind: 'invoice_overdue',
      title: invoice.number,
      body: company?.name || '',
      href: `/invoices/${invoice.id}`,
    })
  }

  const vehicles = await pool.query(
    `SELECT * FROM vehicles
     WHERE (insurance_expires IS NOT NULL AND insurance_expires <= CURRENT_DATE + 30)
        OR (inspection_expires IS NOT NULL AND inspection_expires <= CURRENT_DATE + 30)`,
  )
  for (const vehicle of vehicles.rows) {
    const existing = await pool.query(
      `SELECT 1 FROM activities
       WHERE tenant_id = $1 AND object_type = 'vehicle' AND object_id = $2
         AND kind = 'task' AND done = false AND title LIKE 'Document expiring:%'`,
      [vehicle.tenant_id, vehicle.id],
    )
    if (existing.rowCount) continue
    const ownerId = await assignee(vehicle.tenant_id, 'dispatcher')
    await pool.query(
      `INSERT INTO activities (tenant_id, object_type, object_id, kind, title, due_at, owner_id)
       VALUES ($1,'vehicle',$2,'task',$3, now() + interval '7 days', $4)`,
      [vehicle.tenant_id, vehicle.id, `Document expiring: ${vehicle.plate}`, ownerId],
    )
  }

  await notifyDueTasks()
  await resumeWaits()
}
