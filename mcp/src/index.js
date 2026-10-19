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
  const { serveStdio } = await import('@modelcontextprotocol/server/stdio')
  serveStdio(() => createServer())
  console.error('Cargos MCP listening on stdio')
}

async function startHttp() {
  const express = (await import('express')).default
  const { createMcpHandler } = await import('@modelcontextprotocol/server')
  const { Readable } = await import('node:stream')
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

  const mcp = createMcpHandler(
    ({ era, authInfo }) => {
      const session = authInfo?.extra?.session || null
      log(`MCP serving ${era} request`, { user: session?.email })
      return createServer({ session })
    },
    { onerror: (err) => log('MCP handler error', { error: err?.message || String(err) }) },
  )

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
    const abort = new AbortController()
    res.on('close', () => {
      if (!res.writableFinished) abort.abort()
    })
    try {
      const headers = new Headers()
      for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined || key === 'content-length') continue
        headers.set(key, Array.isArray(value) ? value.join(', ') : String(value))
      }
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined
      const request = new Request(`${oauth.originFor(req)}${req.originalUrl}`, {
        method: req.method,
        headers,
        body: hasBody ? JSON.stringify(req.body) : undefined,
        signal: abort.signal,
      })
      const authInfo = decision.session
        ? { token: bearer, clientId: 'cargos-oauth', scopes: ['mcp'], extra: { session: decision.session } }
        : undefined
      const handle = () => mcp.fetch(request, { authInfo, parsedBody: hasBody ? req.body : undefined })
      const response = decision.session ? await requestContext.run(decision.session, handle) : await handle()
      res.status(response.status)
      response.headers.forEach((value, key) => res.setHeader(key, value))
      if (!response.body) {
        res.end()
        return
      }
      Readable.fromWeb(response.body).on('error', (err) => {
        if (!abort.signal.aborted) log(`! ${req.logId} MCP stream error`, { error: err?.message || String(err) })
        res.destroy(err)
      }).pipe(res)
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
