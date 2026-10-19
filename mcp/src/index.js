import 'dotenv/config'
import { createServer } from './server.js'
import { persistLogin, loadAuth, loginAndMint, requestContext } from './auth.js'
import { apiBase } from './client.js'
import { log, requestLogger } from './log.js'
import { decideAccess, defaultOAuthPath, mountOAuth, safeEqual, wwwAuthenticate } from './oauth.js'

const transport = (process.env.MCP_TRANSPORT || 'stdio').toLowerCase()

await bootstrapAuth()

if (transport === 'http') {
  await startHttp()
} else {
  await startStdio()
}

async function bootstrapAuth() {
  const existing = await loadAuth()
  if (existing?.token) {
    console.error(`Cargos MCP authorized (${existing.kind}, ${existing.source}) → ${apiBase()}`)
    return
  }
  const email = process.env.CARGOS_EMAIL
  const password = process.env.CARGOS_PASSWORD
  if (!email || !password) {
    console.error('Cargos MCP has no stored key. Call auth_login or set CARGOS_API_KEY.')
    return
  }
  try {
    const saved = await persistLogin(apiBase(), email, password)
    console.error(`Cargos MCP signed in as ${saved.email} (${saved.kind}, ${saved.expires})`)
  } catch (err) {
    console.error(`Cargos MCP login failed: ${err.message}`)
  }
}

async function startStdio() {
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js')
  const server = createServer()
  const io = new StdioServerTransport()
  await server.connect(io)
  console.error('Cargos MCP listening on stdio')
}

async function startHttp() {
  const express = (await import('express')).default
  const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js')
  const port = Number(process.env.MCP_PORT || 3100)
  const secret = process.env.MCP_SHARED_SECRET || ''
  const app = express()
  app.set('trust proxy', 1)
  app.use(requestLogger())
  app.use(express.json({ limit: '4mb' }))

  const bind = process.env.MCP_BIND || '127.0.0.1'
  app.use(express.urlencoded({ extended: false, limit: '64kb' }))

  app.get('/health', (_req, res) => res.json({ ok: true, api: apiBase() }))

  const oauth = mountOAuth(app, {
    storePath: defaultOAuthPath(),
    login: (email, password) => loginAndMint(apiBase(), email, password, { keyName: 'Claude' }),
  })

  app.all('/mcp', async (req, res) => {
    const header = req.headers.authorization || ''
    const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : String(req.headers['x-mcp-key'] || '')
    const sharedMatch = Boolean(secret && bearer && safeEqual(bearer, secret))
    const session = !sharedMatch && bearer ? await oauth.resolveAccessToken(bearer) : null
    const decision = decideAccess({ bearer, sharedSecret: secret, session })
    req.mcpAuthMode = decision.ok ? decision.mode : bearer ? 'rejected-bearer' : 'no-bearer'
    req.mcpUser = decision.session?.email || undefined
    if (!decision.ok) {
      res.set('WWW-Authenticate', wwwAuthenticate(oauth.originFor(req), { tokenPresent: Boolean(bearer) }))
      res.status(401).json({ error: 'Sign in required.' })
      return
    }
    if (req.method !== 'POST') {
      // Stateless transport keeps a GET stream open without sending headers, so clients time out.
      res.set('Allow', 'POST')
      res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null })
      return
    }
    const server = createServer()
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    transport.onerror = (err) => log(`! ${req.logId} MCP transport error`, { error: err?.message || String(err) })
    server.server.onerror = (err) => log(`! ${req.logId} MCP server error`, { error: err?.message || String(err) })
    res.on('close', () => {
      transport.close?.()
      server.close?.()
    })
    try {
      await server.connect(transport)
      const handle = () => transport.handleRequest(req, res, req.body)
      if (decision.session) await requestContext.run(decision.session, handle)
      else await handle()
    } catch (err) {
      log(`! ${req.logId} MCP handler threw`, { error: err?.stack || err?.message || String(err) })
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error.' }, id: null })
    }
  })

  app.use((err, req, res, next) => {
    if (err?.type !== 'entity.parse.failed') {
      log(`! ${req.logId} unhandled error`, { error: err?.stack || err?.message || String(err) })
      next(err)
      return
    }
    log(`! ${req.logId} malformed body`, { error: err.message })
    res.status(400).json({ error: 'invalid_request', error_description: 'Malformed body.' })
  })

  app.listen(port, bind, () => {
    const issuer = (process.env.PUBLIC_URL || '').replace(/\/$/, '') || '(request host)'
    console.error(`Cargos MCP HTTP on ${bind}:${port}/mcp → ${apiBase()}`)
    console.error(`Cargos MCP OAuth issuer ${issuer}`)
  })
}
