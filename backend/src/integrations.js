import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { pool } from './db.js'
import { httpError } from './http.js'
import { text } from './enums.js'

function secret() {
  return process.env.JWT_SECRET || 'dev-only-change-me'
}

export function publicUrl() {
  return (process.env.PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, '')
}

export function integrationCatalog() {
  return [
    {
      provider: 'google',
      label: 'Gmail and Google Calendar',
      purpose: 'Log and send email, and put driver assignments on a calendar.',
      configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    },
    {
      provider: 'quickbooks',
      label: 'QuickBooks Online',
      purpose: 'Push customer invoices and store the QuickBooks invoice id.',
      configured: Boolean(process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET),
    },
    {
      provider: 'twilio',
      label: 'Twilio',
      purpose: 'Send and receive SMS, and read call logs and recordings for this workspace.',
      configured: true,
    },
    {
      provider: 'google_maps',
      label: 'Google Maps routing',
      purpose: 'Driving distance and time on orders.',
      configured: Boolean(process.env.GOOGLE_MAPS_API_KEY),
    },
    {
      provider: 'stripe',
      label: 'Stripe billing',
      purpose: 'Seat and driver subscriptions for this workspace.',
      configured: Boolean(process.env.STRIPE_SECRET_KEY),
    },
  ]
}

async function saveIntegration(tenantId, provider, status, config) {
  await pool.query(
    `INSERT INTO integrations (tenant_id, provider, status, config, updated_at)
     VALUES ($1,$2,$3,$4, now())
     ON CONFLICT (tenant_id, provider)
     DO UPDATE SET status = EXCLUDED.status, config = EXCLUDED.config, updated_at = now()`,
    [tenantId, provider, status, JSON.stringify(config)],
  )
}

export async function getIntegration(tenantId, provider) {
  const { rows } = await pool.query(
    'SELECT * FROM integrations WHERE tenant_id = $1 AND provider = $2',
    [tenantId, provider],
  )
  return rows[0] || null
}

export function googleStartUrl(user) {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    const error = new Error('Google OAuth is not configured on this server.')
    error.status = 400
    throw error
  }
  const state = jwt.sign({ tenantId: user.tenantId, provider: 'google' }, secret(), { expiresIn: '15m' })
  const redirect = `${publicUrl()}/api/integrations/google/callback`
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID)
  url.searchParams.set('redirect_uri', redirect)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('state', state)
  url.searchParams.set('scope', [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/calendar.events',
  ].join(' '))
  return url.toString()
}

export async function googleCallback(req, res) {
  try {
    const payload = jwt.verify(String(req.query.state || ''), secret())
    const body = new URLSearchParams({
      code: String(req.query.code || ''),
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${publicUrl()}/api/integrations/google/callback`,
      grant_type: 'authorization_code',
    })
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    const token = await tokenRes.json()
    if (!tokenRes.ok) throw new Error(token.error_description || 'Google token exchange failed.')
    await saveIntegration(payload.tenantId, 'google', 'connected', {
      refresh_token: token.refresh_token,
      access_token: token.access_token,
      expiry: Date.now() + (token.expires_in || 3600) * 1000,
    })
    res.redirect(`${publicUrl()}/settings?integration=google`)
  } catch (err) {
    res.status(400).send(err.message)
  }
}

async function googleAccessToken(tenantId) {
  const row = await getIntegration(tenantId, 'google')
  if (!row || row.status !== 'connected' || !row.config?.refresh_token) return null
  if (row.config.access_token && row.config.expiry > Date.now() + 60000) return row.config.access_token
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: row.config.refresh_token,
    grant_type: 'refresh_token',
  })
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const token = await tokenRes.json()
  if (!tokenRes.ok) return null
  const config = {
    ...row.config,
    access_token: token.access_token,
    expiry: Date.now() + (token.expires_in || 3600) * 1000,
  }
  await saveIntegration(tenantId, 'google', 'connected', config)
  return token.access_token
}

export async function sendGmail(tenantId, { to, subject, body }) {
  const access = await googleAccessToken(tenantId)
  if (!access) return { sent: false, reason: 'Gmail is not connected for this workspace.' }
  const raw = Buffer.from(
    `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`,
  ).toString('base64url')
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    return { sent: false, reason: data.error?.message || 'Gmail rejected the message.' }
  }
  return { sent: true }
}

export async function createCalendarEvent(tenantId, event) {
  const access = await googleAccessToken(tenantId)
  if (!access) return { created: false, reason: 'Google Calendar is not connected.' }
  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  })
  if (!res.ok) return { created: false, reason: 'Calendar event was not created.' }
  const data = await res.json()
  return { created: true, id: data.id }
}

export function quickbooksStartUrl(user) {
  if (!process.env.QBO_CLIENT_ID || !process.env.QBO_CLIENT_SECRET) {
    const error = new Error('QuickBooks OAuth is not configured on this server.')
    error.status = 400
    throw error
  }
  const state = jwt.sign({ tenantId: user.tenantId, provider: 'quickbooks' }, secret(), { expiresIn: '15m' })
  const url = new URL('https://appcenter.intuit.com/connect/oauth2')
  url.searchParams.set('client_id', process.env.QBO_CLIENT_ID)
  url.searchParams.set('redirect_uri', `${publicUrl()}/api/integrations/quickbooks/callback`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'com.intuit.quickbooks.accounting')
  url.searchParams.set('state', state)
  return url.toString()
}

export async function quickbooksCallback(req, res) {
  try {
    const payload = jwt.verify(String(req.query.state || ''), secret())
    const basic = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString('base64')
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: String(req.query.code || ''),
      redirect_uri: `${publicUrl()}/api/integrations/quickbooks/callback`,
    })
    const tokenRes = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    const token = await tokenRes.json()
    if (!tokenRes.ok) throw new Error(token.error_description || 'QuickBooks token exchange failed.')
    await saveIntegration(payload.tenantId, 'quickbooks', 'connected', {
      refresh_token: token.refresh_token,
      access_token: token.access_token,
      expiry: Date.now() + (token.expires_in || 3600) * 1000,
      realm_id: req.query.realmId,
    })
    res.redirect(`${publicUrl()}/settings?integration=quickbooks`)
  } catch (err) {
    res.status(400).send(err.message)
  }
}

async function qboAccess(tenantId) {
  const row = await getIntegration(tenantId, 'quickbooks')
  if (!row || row.status !== 'connected' || !row.config?.refresh_token || !row.config?.realm_id) return null
  if (row.config.access_token && row.config.expiry > Date.now() + 60000) return row
  const basic = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString('base64')
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: row.config.refresh_token,
  })
  const tokenRes = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const token = await tokenRes.json()
  if (!tokenRes.ok) return null
  const config = {
    ...row.config,
    access_token: token.access_token,
    refresh_token: token.refresh_token || row.config.refresh_token,
    expiry: Date.now() + (token.expires_in || 3600) * 1000,
  }
  await saveIntegration(tenantId, 'quickbooks', 'connected', config)
  return { ...row, config }
}

export async function pushInvoiceToQuickbooks(tenantId, invoice, company) {
  const row = await qboAccess(tenantId)
  if (!row) return { synced: false, reason: 'QuickBooks is not connected.' }
  if (!company?.qbo_customer_id) return { synced: false, reason: 'Set a QuickBooks customer id on the company first.' }
  const res = await fetch(
    `https://quickbooks.api.intuit.com/v3/company/${row.config.realm_id}/invoice?minorversion=73`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${row.config.access_token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        DocNumber: invoice.number,
        CustomerRef: { value: company.qbo_customer_id },
        DueDate: invoice.due_at,
        Line: [{
          Amount: (invoice.amount_cents || 0) / 100,
          DetailType: 'SalesItemLineDetail',
          Description: `Transport ${invoice.number}`,
          SalesItemLineDetail: { Qty: 1, UnitPrice: (invoice.amount_cents || 0) / 100 },
        }],
      }),
    },
  )
  const data = await res.json().catch(() => ({}))
  if (!res.ok) return { synced: false, reason: data?.Fault?.Error?.[0]?.Message || 'QuickBooks rejected the invoice.' }
  const qboId = data?.Invoice?.Id || null
  if (qboId) {
    await pool.query('UPDATE invoices SET qbo_invoice_id = $1, updated_at = now() WHERE id = $2', [qboId, invoice.id])
  }
  return { synced: true, qboInvoiceId: qboId }
}

function normalizePhone(value) {
  const raw = text(value, 40)
  if (!raw) return null
  const compact = raw.replace(/[\s()-]/g, '')
  return /^\+[1-9]\d{6,14}$/.test(compact) ? compact : null
}

export function publicTwilio(config = {}) {
  const token = config.authToken || ''
  return {
    accountSid: config.accountSid || '',
    fromNumber: config.fromNumber || '',
    voiceNumber: config.voiceNumber && config.voiceNumber !== config.fromNumber ? config.voiceNumber : '',
    tokenSet: Boolean(token),
    tokenHint: token ? `••••${token.slice(-4)}` : '',
    webhookUrl: config.hookToken ? `${publicUrl()}/api/integrations/twilio/sms/${config.hookToken}` : '',
    webhookSet: Boolean(config.webhookSet),
  }
}

async function twilioAccount(tenantId) {
  const row = await getIntegration(tenantId, 'twilio')
  const config = row?.config || {}
  if (row?.status !== 'connected' || !config.accountSid || !config.authToken || !config.fromNumber) return null
  return {
    accountSid: config.accountSid,
    authToken: config.authToken,
    fromNumber: config.fromNumber,
    voiceNumber: config.voiceNumber || config.fromNumber,
    hookToken: config.hookToken,
  }
}

function twilioAuth(creds) {
  return `Basic ${Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString('base64')}`
}

async function twilioFetch(creds, path, { method = 'GET', form } = {}) {
  let res
  try {
    res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}${path}`, {
      method,
      headers: {
        Authorization: twilioAuth(creds),
        ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: form ? new URLSearchParams(form) : undefined,
    })
  } catch {
    throw httpError(502, 'Could not reach Twilio.')
  }
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

function twilioError(data, fallback) {
  return data?.message || fallback
}

async function attachSmsWebhook(creds, webhookUrl) {
  const listed = await twilioFetch(creds, `/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(creds.fromNumber)}&PageSize=1`)
  const number = listed.ok ? listed.data.incoming_phone_numbers?.[0] : null
  if (!number?.sid) return false
  const updated = await twilioFetch(creds, `/IncomingPhoneNumbers/${number.sid}.json`, {
    method: 'POST',
    form: { SmsUrl: webhookUrl, SmsMethod: 'POST' },
  })
  return updated.ok
}

export async function connectTwilio(tenantId, input) {
  const accountSid = text(input.accountSid, 40)
  const fromNumber = normalizePhone(input.fromNumber)
  const voiceRaw = text(input.voiceNumber, 40)
  const voiceNumber = voiceRaw ? normalizePhone(voiceRaw) : fromNumber
  const existing = await getIntegration(tenantId, 'twilio')
  const authToken = text(input.authToken, 80) || existing?.config?.authToken || null
  if (!accountSid || !/^AC[0-9a-fA-F]{32}$/.test(accountSid)) throw httpError(400, 'Enter a Twilio Account SID. It starts with AC.')
  if (!authToken) throw httpError(400, 'Enter the Twilio auth token.')
  if (!fromNumber) throw httpError(400, 'Enter the SMS number in international format, like +40722123456.')
  if (voiceRaw && !voiceNumber) throw httpError(400, 'Enter the voice number in international format, or leave it blank.')
  const creds = { accountSid, authToken, fromNumber, voiceNumber }
  const account = await twilioFetch(creds, '.json')
  if (!account.ok) {
    const rejected = account.status === 401 || account.status === 404
    throw httpError(400, rejected ? 'Twilio rejected these credentials.' : twilioError(account.data, 'Twilio rejected these credentials.'))
  }
  if (account.data.status && account.data.status !== 'active') throw httpError(400, 'This Twilio account is not active.')
  const hookToken = existing?.config?.hookToken || crypto.randomBytes(24).toString('hex')
  const webhookUrl = `${publicUrl()}/api/integrations/twilio/sms/${hookToken}`
  const webhookSet = await attachSmsWebhook(creds, webhookUrl)
  const config = { accountSid, authToken, fromNumber, voiceNumber, hookToken, webhookSet }
  await saveIntegration(tenantId, 'twilio', 'connected', config)
  return { status: 'connected', ...publicTwilio(config) }
}

function mapMessage(row) {
  return {
    sid: row.sid,
    from: row.from,
    to: row.to,
    body: row.body,
    direction: row.direction,
    status: row.status,
    at: row.date_sent || row.date_created,
  }
}

function mapCall(row) {
  return {
    sid: row.sid,
    from: row.from,
    to: row.to,
    status: row.status,
    direction: row.direction,
    duration: Number(row.duration || 0),
    at: row.start_time || row.date_created,
  }
}

function mapRecording(row) {
  return {
    sid: row.sid,
    callSid: row.call_sid,
    duration: Number(row.duration || 0),
    status: row.status,
    at: row.date_created,
  }
}

export async function twilioLog(tenantId) {
  const creds = await twilioAccount(tenantId)
  if (!creds) return { connected: false, messages: [], calls: [], recordings: [] }
  const [messages, calls, recordings] = await Promise.all([
    twilioFetch(creds, '/Messages.json?PageSize=15'),
    twilioFetch(creds, '/Calls.json?PageSize=15'),
    twilioFetch(creds, '/Recordings.json?PageSize=15'),
  ])
  return {
    connected: true,
    messages: messages.ok ? (messages.data.messages || []).map(mapMessage) : [],
    calls: calls.ok ? (calls.data.calls || []).map(mapCall) : [],
    recordings: recordings.ok ? (recordings.data.recordings || []).map(mapRecording) : [],
    error: [messages, calls, recordings].find((item) => !item.ok) ? 'Twilio did not return the full log.' : null,
  }
}

export async function openTwilioRecording(tenantId, recordingSid) {
  if (!/^RE[0-9a-fA-F]{32}$/.test(recordingSid || '')) throw httpError(400, 'Recording id is not valid.')
  const creds = await twilioAccount(tenantId)
  if (!creds) throw httpError(400, 'Twilio is not connected for this workspace.')
  let res
  try {
    res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Recordings/${recordingSid}.mp3`, {
      headers: { Authorization: twilioAuth(creds) },
    })
  } catch {
    throw httpError(502, 'Could not reach Twilio.')
  }
  if (!res.ok) throw httpError(res.status === 404 ? 404 : 502, 'Recording is not available.')
  return res
}

function validTwilioSignature(authToken, url, params, signature) {
  const payload = url + Object.keys(params || {}).sort().reduce((sum, key) => sum + key + params[key], '')
  const expected = crypto.createHmac('sha1', authToken).update(payload).digest('base64')
  const left = Buffer.from(expected)
  const right = Buffer.from(String(signature || ''))
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''))
}

function lastDigits(value) {
  const digits = String(value || '').replace(/\D/g, '')
  return digits.length >= 7 ? digits.slice(-9) : ''
}

function peerNumber(value) {
  return normalizePhone(value)
}

function twilioDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function publicMessage(row) {
  return {
    id: row.id,
    direction: row.direction,
    body: row.body,
    status: row.status,
    at: row.created_at,
  }
}

async function contactForPeer(tenantId, peer) {
  const digits = lastDigits(peer)
  if (!digits) return null
  const { rows } = await pool.query(
    `SELECT id, name, phone, title, company_id
     FROM contacts
     WHERE tenant_id = $1 AND right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 9) = $2
     ORDER BY created_at
     LIMIT 1`,
    [tenantId, digits],
  )
  return rows[0] || null
}

export async function storeSms(tenantId, input) {
  const sid = text(input.sid, 40)
  const peer = peerNumber(input.peer)
  if (!sid || !peer) return null
  const direction = input.direction === 'in' ? 'in' : 'out'
  const body = String(input.body || '').slice(0, 1600)
  let contactId = isUuid(input.contactId) ? input.contactId : null
  if (!contactId) contactId = (await contactForPeer(tenantId, peer))?.id || null
  const { rows } = await pool.query(
    `INSERT INTO sms_messages (tenant_id, contact_id, direction, peer, body, twilio_sid, status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8::timestamptz, now()))
     ON CONFLICT (tenant_id, twilio_sid) DO UPDATE
       SET status = EXCLUDED.status,
           contact_id = COALESCE(sms_messages.contact_id, EXCLUDED.contact_id)
     RETURNING *, (xmax = 0) AS inserted`,
    [tenantId, contactId, direction, peer, body, sid, text(input.status, 40), input.at || null],
  )
  return rows[0] || null
}

async function pullTwilioMessages(tenantId) {
  const creds = await twilioAccount(tenantId)
  if (!creds) return false
  try {
    const listed = await twilioFetch(creds, '/Messages.json?PageSize=40')
    if (listed.ok) {
      for (const row of listed.data.messages || []) {
        const inbound = String(row.direction || '').startsWith('inbound')
        await storeSms(tenantId, {
          sid: row.sid,
          peer: inbound ? row.from : row.to,
          direction: inbound ? 'in' : 'out',
          body: row.body || '',
          status: row.status,
          at: twilioDate(row.date_sent || row.date_created),
        })
      }
    }
  } catch {
    /* Local messages still load when Twilio is briefly unreachable. */
  }
  return true
}

async function linkPeer(tenantId, contactId, phone) {
  const digits = lastDigits(phone)
  if (!digits) return
  await pool.query(
    `UPDATE sms_messages SET contact_id = $2
     WHERE tenant_id = $1 AND contact_id IS NULL
       AND right(regexp_replace(peer, '\\D', '', 'g'), 9) = $3`,
    [tenantId, contactId, digits],
  )
}

export async function handleTwilioSms(hookToken, req) {
  const { rows } = await pool.query(
    `SELECT tenant_id, config FROM integrations WHERE provider = 'twilio' AND config->>'hookToken' = $1 AND status = 'connected'`,
    [hookToken],
  )
  const row = rows[0]
  if (!row?.config?.authToken) {
    const error = new Error('Unknown Twilio webhook.')
    error.status = 404
    throw error
  }
  const url = `${publicUrl()}${req.originalUrl}`
  if (!validTwilioSignature(row.config.authToken, url, req.body, req.get('x-twilio-signature'))) {
    const error = new Error('Invalid Twilio signature.')
    error.status = 403
    throw error
  }
  const from = String(req.body.From || '')
  const body = String(req.body.Body || '').slice(0, 1600)
  const saved = await storeSms(row.tenant_id, {
    sid: req.body.MessageSid,
    peer: from,
    direction: 'in',
    body,
    status: req.body.SmsStatus || 'received',
  })
  const digits = lastDigits(from)
  if (saved?.inserted && digits && body) {
    const match = await pool.query(
      `SELECT id, 'contact' AS kind FROM contacts
       WHERE tenant_id = $1 AND right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 9) = $2
       UNION ALL
       SELECT id, 'company' AS kind FROM companies
       WHERE tenant_id = $1 AND right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 9) = $2
       LIMIT 1`,
      [row.tenant_id, digits],
    )
    const record = match.rows[0]
    if (record) {
      await pool.query(
        `INSERT INTO activities (tenant_id, object_type, object_id, kind, title, body)
         VALUES ($1,$2,$3,'sms',$4,$5)`,
        [row.tenant_id, record.kind, record.id, `SMS from ${from}`, body],
      )
    }
  }
  return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
}

export async function sendSms(tenantId, to, body) {
  const creds = await twilioAccount(tenantId)
  if (!creds) return { sent: false, reason: 'Twilio is not connected for this workspace.' }
  let result
  try {
    result = await twilioFetch(creds, '/Messages.json', { method: 'POST', form: { To: to, From: creds.fromNumber, Body: body } })
  } catch (error) {
    return { sent: false, reason: error.message }
  }
  if (!result.ok) return { sent: false, reason: twilioError(result.data, 'Twilio rejected the message.') }
  return { sent: true, sid: result.data.sid }
}

export async function smsInbox(tenantId) {
  const connected = await pullTwilioMessages(tenantId)
  if (!connected) return { connected: false, threads: [] }
  const { rows } = await pool.query(
    `SELECT m.contact_id, m.peer, m.body, m.direction, m.created_at,
            c.name AS contact_name, c.phone AS contact_phone, c.company_id, co.name AS company_name
     FROM sms_messages m
     LEFT JOIN contacts c ON c.id = m.contact_id
     LEFT JOIN companies co ON co.id = c.company_id
     WHERE m.tenant_id = $1
     ORDER BY m.created_at DESC
     LIMIT 400`,
    [tenantId],
  )
  const threads = []
  const seen = new Set()
  for (const row of rows) {
    const key = row.contact_id || row.peer
    if (seen.has(key)) continue
    seen.add(key)
    threads.push({
      contactId: row.contact_id,
      peer: row.peer,
      name: row.contact_name || row.peer,
      phone: row.contact_phone || row.peer,
      companyId: row.company_id,
      companyName: row.company_name,
      lastBody: row.body,
      lastAt: row.created_at,
      lastDirection: row.direction,
    })
  }
  return { connected: true, threads }
}

export async function smsThread(tenantId, { contactId, peer } = {}) {
  const connected = await pullTwilioMessages(tenantId)
  if (!connected) return { connected: false, messages: [], contact: null, peer: '' }
  let contact = null
  let digits = ''
  let phone = peerNumber(peer) || ''
  if (contactId) {
    if (!isUuid(contactId)) throw httpError(404, 'Contact not found.')
    const { rows } = await pool.query(
      'SELECT id, name, phone, title FROM contacts WHERE id = $1 AND tenant_id = $2',
      [contactId, tenantId],
    )
    contact = rows[0]
    if (!contact) throw httpError(404, 'Contact not found.')
    phone = contact.phone || ''
    digits = lastDigits(contact.phone)
    await linkPeer(tenantId, contact.id, contact.phone)
  } else if (phone) {
    digits = lastDigits(phone)
    contact = await contactForPeer(tenantId, phone)
    if (contact) await linkPeer(tenantId, contact.id, phone)
  } else {
    throw httpError(400, 'Choose a conversation.')
  }
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT * FROM sms_messages
       WHERE tenant_id = $1 AND (
         ($2::uuid IS NOT NULL AND contact_id = $2)
         OR ($3 <> '' AND right(regexp_replace(peer, '\\D', '', 'g'), 9) = $3)
       )
       ORDER BY created_at DESC
       LIMIT 200
     ) recent
     ORDER BY created_at ASC`,
    [tenantId, contact?.id || null, digits],
  )
  return {
    connected: true,
    contact: contact ? { id: contact.id, name: contact.name, phone: contact.phone, title: contact.title } : null,
    peer: phone,
    messages: rows.map(publicMessage),
  }
}

export async function smsForCompany(tenantId, companyId) {
  if (!isUuid(companyId)) throw httpError(404, 'Company not found.')
  const company = await pool.query('SELECT id FROM companies WHERE id = $1 AND tenant_id = $2', [companyId, tenantId])
  if (!company.rows[0]) throw httpError(404, 'Company not found.')
  const connected = await pullTwilioMessages(tenantId)
  if (!connected) return { connected: false, conversations: [] }
  const contacts = await pool.query(
    'SELECT id, name, phone, title FROM contacts WHERE tenant_id = $1 AND company_id = $2 ORDER BY name',
    [tenantId, companyId],
  )
  for (const contact of contacts.rows) await linkPeer(tenantId, contact.id, contact.phone)
  const ids = contacts.rows.map((contact) => contact.id)
  const messages = ids.length
    ? (await pool.query(
      `SELECT * FROM sms_messages WHERE tenant_id = $1 AND contact_id = ANY($2::uuid[]) ORDER BY created_at ASC`,
      [tenantId, ids],
    )).rows
    : []
  return {
    connected: true,
    conversations: contacts.rows.map((contact) => ({
      contactId: contact.id,
      name: contact.name,
      phone: contact.phone,
      title: contact.title,
      messages: messages.filter((row) => row.contact_id === contact.id).map(publicMessage),
    })),
  }
}

export async function replySms(tenantId, userId, input) {
  const creds = await twilioAccount(tenantId)
  if (!creds) throw httpError(400, 'Twilio is not connected for this workspace.')
  const body = text(input.body, 1600)
  if (!body) throw httpError(400, 'Write a message.')
  let contact = null
  let peer = null
  if (input.contactId) {
    if (!isUuid(input.contactId)) throw httpError(404, 'Contact not found.')
    const { rows } = await pool.query(
      'SELECT id, phone FROM contacts WHERE id = $1 AND tenant_id = $2',
      [input.contactId, tenantId],
    )
    contact = rows[0]
    if (!contact) throw httpError(404, 'Contact not found.')
    peer = peerNumber(contact.phone)
    if (!peer) throw httpError(400, 'This contact needs a phone number in international format, like +40722123456.')
  } else {
    peer = peerNumber(input.peer)
    if (!peer) throw httpError(400, 'Enter the phone number in international format, like +40722123456.')
    contact = await contactForPeer(tenantId, peer)
  }
  const sent = await sendSms(tenantId, peer, body)
  if (!sent.sent) throw httpError(400, sent.reason || 'Twilio rejected the message.')
  const saved = await storeSms(tenantId, {
    contactId: contact?.id,
    peer,
    direction: 'out',
    body,
    sid: sent.sid,
    status: 'sent',
  })
  if (!saved) throw httpError(502, 'Twilio accepted the message, but it could not be stored.')
  if (contact) {
    await pool.query(
      `INSERT INTO activities (tenant_id, object_type, object_id, kind, title, body, created_by)
       VALUES ($1,'contact',$2,'sms',$3,$4,$5)`,
      [tenantId, contact.id, `SMS to ${peer}`, body, userId || null],
    )
  }
  return publicMessage(saved)
}
