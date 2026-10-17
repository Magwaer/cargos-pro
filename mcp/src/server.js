import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { authPath, clearAuth, loadAuth, persistLogin } from './auth.js'
import { runBatch } from './batch.js'
import { api, apiBase, run } from './client.js'
import { RESOURCE_NAMES, RESOURCES, pickQuery } from './catalog.js'

const resourceEnum = z.enum(RESOURCE_NAMES)
const dataObject = z.record(z.string(), z.any())

function tool(server, name, description, schema, handler) {
  server.tool(name, description, schema, (args) => run(() => handler(args)))
}

export function createServer() {
  const server = new McpServer({
    name: 'cargos',
    version: '1.0.0',
    instructions: [
      'Cargos.pro TMS tools. Authorization lives on this MCP server (API key or saved login), not on the client.',
      'Prefer list/get before writes. Use batch for multiple insert/update/delete calls.',
      'Money fields are integer cents (186000 = €1,860). Dates are ISO-8601.',
    ].join(' '),
  })

  registerAuth(server)
  registerOverview(server)
  registerCrud(server)
  registerTransport(server)
  registerFinance(server)
  registerPlatform(server)
  registerBatch(server)
  return server
}

function registerAuth(server) {
  tool(server, 'auth_login', 'Sign in to Cargos and store a long-lived API key on this MCP server. Call once; later tools reuse the saved key until revoked.', {
    email: z.string().email(),
    password: z.string().min(1),
  }, (args) => persistLogin(apiBase(), args.email, args.password))

  tool(server, 'auth_status', 'Show whether this MCP server has stored Cargos authorization.', {}, async () => {
    const auth = await loadAuth()
    if (!auth) return { authorized: false, apiUrl: apiBase(), authFile: authPath() }
    return {
      authorized: true,
      apiUrl: apiBase(),
      kind: auth.kind,
      source: auth.source,
      expires: auth.expires || (auth.kind === 'api_key' ? 'until revoked' : 'session'),
      email: auth.email || null,
      name: auth.name || null,
      role: auth.role || null,
      tenantName: auth.tenantName || null,
      authFile: auth.source === 'file' ? authPath() : null,
    }
  })

  tool(server, 'auth_logout', 'Remove the API key stored on this MCP server. Environment CARGOS_API_KEY is not cleared.', {}, async () => {
    await clearAuth()
    return { ok: true, envKeyStillUsed: Boolean(process.env.CARGOS_API_KEY || process.env.CARGOS_TOKEN) }
  })
}

function registerOverview(server) {
  tool(server, 'search', 'Search orders, companies, contacts, and invoices.', {
    q: z.string().min(1),
  }, (args) => api('GET', '/api/search', { query: { q: args.q } }))

  tool(server, 'get_me', 'Current signed-in user and workspace.', {}, () => api('GET', '/api/auth/me'))

  tool(server, 'get_dashboard', 'Dashboard stats, pipeline, and tasks.', {}, () => api('GET', '/api/dashboard'))

  tool(server, 'get_reports', 'Order and invoice totals for a date range.', {
    from: z.string().optional(),
    to: z.string().optional(),
  }, (args) => api('GET', '/api/reports', { query: args }))

  tool(server, 'get_paid_report', 'Invoices marked paid in a date range, by day.', {
    from: z.string().optional(),
    to: z.string().optional(),
  }, (args) => api('GET', '/api/reports/paid', { query: args }))

  tool(server, 'get_invoice_aging', 'Open invoice aging buckets.', {}, () => api('GET', '/api/invoices/aging'))
}

function registerCrud(server) {
  tool(server, 'list', 'List records for a resource.', {
    resource: resourceEnum,
    q: z.string().optional(),
    role: z.enum(['customer', 'carrier', 'both', 'broker']).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    companyId: z.string().optional(),
    orderId: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    paymentType: z.enum(['cash', 'card', 'wire', 'fuel_card', 'cheque', 'other']).optional(),
    objectType: z.string().optional(),
    objectId: z.string().optional(),
    kind: z.string().optional(),
    done: z.boolean().optional(),
    open: z.string().optional(),
    tasks: z.string().optional(),
    status: z.string().optional(),
    currency: z.string().optional(),
  }, (args) => {
    const spec = RESOURCES[args.resource]
    if (!spec.methods.list) throw new Error(`${args.resource} cannot be listed.`)
    return api('GET', spec.collection, { query: pickQuery(args.resource, args) })
  })

  tool(server, 'get', 'Get one record by id.', {
    resource: resourceEnum,
    id: z.string().min(1),
  }, (args) => {
    const spec = RESOURCES[args.resource]
    if (!spec.methods.get || !spec.item) throw new Error(`${args.resource} has no get-by-id.`)
    return api('GET', spec.item(args.id))
  })

  tool(server, 'create', 'Create one record. For many records use batch.', {
    resource: resourceEnum,
    data: dataObject,
  }, (args) => {
    const spec = RESOURCES[args.resource]
    if (!spec.methods.insert) throw new Error(`${args.resource} cannot be created.`)
    return api('POST', spec.collection, { body: args.data })
  })

  tool(server, 'update', 'Update one record. For many records use batch.', {
    resource: resourceEnum,
    id: z.string().min(1),
    data: dataObject,
  }, (args) => {
    const spec = RESOURCES[args.resource]
    if (!spec.methods.update) throw new Error(`${args.resource} cannot be updated.`)
    return api('PATCH', spec.item(args.id), { body: args.data })
  })

  tool(server, 'remove', 'Delete one record. For many records use batch.', {
    resource: resourceEnum,
    id: z.string().min(1),
  }, (args) => {
    const spec = RESOURCES[args.resource]
    if (!spec.methods.delete) throw new Error(`${args.resource} cannot be deleted.`)
    return api('DELETE', spec.item(args.id))
  })
}

function registerTransport(server) {
  tool(server, 'get_dispatch', 'Dispatch board: drivers and orders in a date range.', {
    from: z.string(),
    to: z.string(),
    status: z.enum(['booked', 'assigned', 'in_transit', 'delivered', 'invoiced']).optional(),
    q: z.string().optional(),
  }, (args) => api('GET', '/api/dispatch', { query: args }))

  tool(server, 'assign_dispatch', 'Assign an order to a driver (own fleet) or a subcontracted carrier.', {
    orderId: z.string(),
    kind: z.enum(['own_fleet', 'subcontracted']),
    driverId: z.string().optional(),
    vehicleId: z.string().optional(),
    carrierCompanyId: z.string().optional(),
    pickupAt: z.string().optional(),
    costCents: z.number().int().optional(),
  }, (args) => api('POST', '/api/dispatch/assign', { body: args }))

  tool(server, 'unassign_dispatch', 'Remove a planned or assigned dispatch relation.', {
    orderId: z.string().optional(),
    relationId: z.string().optional(),
  }, (args) => api('POST', '/api/dispatch/unassign', { body: args }))

  tool(server, 'estimate_route', 'Road distance and duration between two places.', {
    origin: z.string(),
    destination: z.string(),
  }, (args) => api('POST', '/api/routing/estimate', { body: args }))

  tool(server, 'set_order_party', 'Set the customer, broker, or carrier company on an order.', {
    orderId: z.string(),
    role: z.enum(['customer', 'broker', 'carrier']),
    companyId: z.string(),
    contactId: z.string().optional(),
  }, (args) => api('PUT', `/api/orders/${args.orderId}/parties/${args.role}`, {
    body: { companyId: args.companyId, contactId: args.contactId || null },
  }))

  tool(server, 'remove_order_party', 'Remove a customer, broker, or carrier party from an order.', {
    orderId: z.string(),
    role: z.enum(['customer', 'broker', 'carrier']),
  }, (args) => api('DELETE', `/api/orders/${args.orderId}/parties/${args.role}`))

  tool(server, 'generate_order_invoice', 'Create an invoice from an order.', {
    orderId: z.string(),
  }, (args) => api('POST', `/api/orders/${args.orderId}/invoice`, { body: {} }))
}

function registerFinance(server) {
  tool(server, 'share_invoice', 'Create a public share link for an invoice.', {
    invoiceId: z.string(),
  }, (args) => api('POST', `/api/invoices/${args.invoiceId}/share`, { body: {} }))

  tool(server, 'email_invoice', 'Email an invoice to the customer.', {
    invoiceId: z.string(),
    to: z.string().optional(),
  }, (args) => api('POST', `/api/invoices/${args.invoiceId}/email`, { body: { to: args.to } }))
}

function registerPlatform(server) {
  tool(server, 'list_notifications', 'Unread and recent notifications.', {}, () => api('GET', '/api/notifications'))

  tool(server, 'mark_notifications_read', 'Mark notifications as read.', {
    ids: z.array(z.string()).optional(),
  }, (args) => api('POST', '/api/notifications/read', { body: { ids: args.ids } }))

  tool(server, 'list_workflow_runs', 'Recent workflow run log.', {}, () => api('GET', '/api/workflow-runs'))

  tool(server, 'list_audit', 'Workspace audit log.', {
    q: z.string().optional(),
  }, (args) => api('GET', '/api/audit', { query: args }))

  tool(server, 'list_sms', 'SMS conversations.', {}, () => api('GET', '/api/sms'))

  tool(server, 'get_sms_thread', 'Messages in one SMS thread.', {
    contactId: z.string().optional(),
    phone: z.string().optional(),
  }, (args) => api('GET', '/api/sms/thread', { query: args }))

  tool(server, 'send_sms', 'Send an SMS to a contact or phone number.', {
    contactId: z.string().optional(),
    to: z.string().optional(),
    body: z.string(),
  }, (args) => api('POST', '/api/sms', { body: args }))

  tool(server, 'list_api_keys', 'List workspace API keys (prefix only).', {}, () => api('GET', '/api/api-keys'))

  tool(server, 'create_api_key', 'Mint a workspace API key. Prefer write scope for this MCP server.', {
    name: z.string().optional(),
    scope: z.enum(['read', 'write']).optional(),
  }, (args) => api('POST', '/api/api-keys', { body: { name: args.name || 'MCP', scope: args.scope || 'write' } }))

  tool(server, 'revoke_api_key', 'Revoke a workspace API key.', {
    id: z.string(),
  }, (args) => api('POST', `/api/api-keys/${args.id}/revoke`, { body: {} }))
}

function registerBatch(server) {
  tool(server, 'batch', 'Insert, update, or delete many records in one call. Operations run in order. Default stopOnError=true.', {
    operations: z.array(z.object({
      op: z.enum(['insert', 'update', 'delete']),
      resource: resourceEnum,
      id: z.string().optional(),
      data: dataObject.optional(),
    })).min(1).max(50),
    stopOnError: z.boolean().optional(),
  }, (args) => runBatch(args))
}
