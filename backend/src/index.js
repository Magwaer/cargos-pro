import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { requireAuth, requireOffice, requireWrite } from './auth.js'
import { pool, migrate, waitForDb } from './db.js'
import { googleCallback, handleTwilioSms, quickbooksCallback } from './integrations.js'
import authRouter from './routes/auth.js'
import crmRouter from './routes/crm.js'
import financeRouter, { publicInvoice, publicInvoicePdf } from './routes/finance.js'
import fleetRouter from './routes/fleet.js'
import platformRouter, { stripeWebhook } from './routes/platform.js'
import transportRouter, { driver as driverRouter } from './routes/transport.js'
import { seedIfEmpty } from './seed.js'
import { asyncRoute } from './http.js'
import { maintenanceTick } from './workflow.js'

if (process.env.NODE_ENV === 'production') {
  const secret = process.env.JWT_SECRET || ''
  if (secret.length < 24 || secret === 'dev-only-change-me') {
    console.error('Set JWT_SECRET to a long random value before starting in production.')
    process.exit(1)
  }
}

const app = express()
app.set('trust proxy', 1)
app.use(cors())
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), stripeWebhook)
app.use(express.json({ limit: '2mb' }))

app.use((req, res, next) => {
  const started = Date.now()
  res.on('finish', () => {
    if (req.path === '/api/health') return
    console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - started}ms`)
  })
  next()
})

app.get('/api/health', asyncRoute(async (_req, res) => {
  await pool.query('SELECT 1')
  res.json({ ok: true })
}))

app.use('/api/auth', authRouter)
app.get('/api/integrations/google/callback', googleCallback)
app.get('/api/integrations/quickbooks/callback', quickbooksCallback)
app.post('/api/integrations/twilio/sms/:token', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const xml = await handleTwilioSms(req.params.token, req)
    res.type('text/xml').send(xml)
  } catch (err) {
    const status = err.status || 403
    if (status >= 500) console.error(err)
    res.status(status).type('text/plain').send('Invalid request')
  }
})
app.get('/api/public/invoices/:token/pdf', publicInvoicePdf)
app.get('/api/public/invoices/:token', publicInvoice)
app.use('/api/driver', requireAuth, driverRouter)

const office = [requireAuth, requireOffice, requireWrite]
app.use('/api', ...office, crmRouter)
app.use('/api', ...office, transportRouter)
app.use('/api', ...office, fleetRouter)
app.use('/api', ...office, financeRouter)
app.use('/api', ...office, platformRouter)
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }))

app.use((err, _req, res, _next) => {
  let status = err.status || 500
  if (!err.status && (err.code === 'LIMIT_FILE_SIZE' || /^(Upload a|File is)/.test(err.message || ''))) status = 400
  if (status >= 500) console.error(err)
  const message = status === 400 && err.code === 'LIMIT_FILE_SIZE'
    ? 'File is larger than 15 MB.'
    : status >= 500 && process.env.NODE_ENV === 'production'
      ? 'Something went wrong.'
      : err.message
  res.status(status).json({ error: message })
})

const port = Number(process.env.PORT || 3000)

await waitForDb()
await migrate()
await seedIfEmpty()
maintenanceTick().catch((err) => console.error('Maintenance tick failed', err))
setInterval(() => {
  maintenanceTick().catch((err) => console.error('Maintenance tick failed', err))
}, 5 * 60 * 1000)

app.listen(port, () => {
  console.log(`Cargos API listening on ${port}`)
})
