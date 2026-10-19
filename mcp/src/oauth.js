import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from './log.js'

const ACCESS_TTL_MS = 60 * 60 * 1000
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000
const CODE_TTL_MS = 60 * 1000
const NONCE_TTL_MS = 10 * 60 * 1000
const REVOKED_TTL_MS = 24 * 60 * 60 * 1000
const RESOURCE_PATH = '/mcp'

const CLAUDE_REDIRECTS = new Set([
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
])

export function defaultOAuthPath() {
  if (process.env.MCP_OAUTH_PATH) return process.env.MCP_OAUTH_PATH
  if (process.env.MCP_AUTH_PATH) return join(dirname(process.env.MCP_AUTH_PATH), 'oauth.json')
  return fileURLToPath(new URL('../data/oauth.json', import.meta.url))
}

export function safeEqual(a, b) {
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export function isAllowedRedirect(uri) {
  if (CLAUDE_REDIRECTS.has(uri)) return true
  let url
  try {
    url = new URL(uri)
  } catch {
    return false
  }
  if (url.username || url.password || url.hash) return false
  if (url.protocol !== 'http:') return false
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
}

export function redirectsMatch(registered, requested) {
  if (registered === requested) return true
  let left
  let right
  try {
    left = new URL(registered)
    right = new URL(requested)
  } catch {
    return false
  }
  const loopback = (host) => host === 'localhost' || host === '127.0.0.1' || host === '::1'
  if (!loopback(left.hostname) || !loopback(right.hostname)) return false
  return left.protocol === right.protocol && left.pathname === right.pathname && left.search === right.search
}

export function decideAccess({ bearer, sharedSecret, session }) {
  if (sharedSecret && bearer && safeEqual(bearer, sharedSecret)) return { ok: true, mode: 'shared' }
  if (session) return { ok: true, mode: 'oauth', session }
  if (!sharedSecret && !bearer) return { ok: true, mode: 'open' }
  return { ok: false }
}

export function wwwAuthenticate(origin, { tokenPresent = false } = {}) {
  const metadata = `${origin}/.well-known/oauth-protected-resource/mcp`
  const parts = ['Bearer realm="cargos"']
  if (tokenPresent) parts.push('error="invalid_token"', 'error_description="Sign in required."')
  parts.push(`resource_metadata="${metadata}"`, 'scope="mcp"')
  return parts.join(', ')
}

export function publicOrigin(req) {
  const configured = (process.env.PUBLIC_URL || '').replace(/\/$/, '')
  if (configured) return configured
  const proto = String(req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim()
  const host = req.get('x-forwarded-host') || req.get('host')
  return `${proto}://${host}`
}

function resourceFor(origin) {
  return `${origin}${RESOURCE_PATH}`
}

function sameResource(value, origin) {
  try {
    const got = new URL(value)
    const expected = new URL(resourceFor(origin))
    const path = (url) => url.pathname.replace(/\/$/, '') || '/'
    return got.origin === expected.origin && path(got) === path(expected) && !got.search && !got.hash
  } catch {
    return false
  }
}

function emptyStore() {
  return { clients: {}, codes: {}, accessTokens: {}, refreshTokens: {}, revokedRefresh: {} }
}

function randomId(bytes = 32) {
  return randomBytes(bytes).toString('base64url')
}

function pkce(verifier) {
  return createHash('sha256').update(verifier).digest('base64url')
}

function sessionCopy(session) {
  return {
    token: session.token,
    kind: session.kind,
    source: 'oauth',
    expires: session.expires,
    email: session.email || null,
    name: session.name || null,
    role: session.role || null,
    tenantName: session.tenantName || null,
  }
}

export class OAuthServer {
  constructor({ storePath, login }) {
    this.storePath = storePath
    this.login = login
    this.nonces = new Map()
    this.failures = new Map()
    this.chain = Promise.resolve()
  }

  locked(fn) {
    const run = this.chain.then(fn, fn)
    this.chain = run.then(() => {}, () => {})
    return run
  }

  async read() {
    try {
      const parsed = JSON.parse(await readFile(this.storePath, 'utf8'))
      return { ...emptyStore(), ...parsed }
    } catch (err) {
      if (err.code === 'ENOENT') return emptyStore()
      throw err
    }
  }

  async write(store) {
    await mkdir(dirname(this.storePath), { recursive: true, mode: 0o700 })
    const tmp = `${this.storePath}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(store), { mode: 0o600 })
    await rename(tmp, this.storePath)
  }

  prune(store, now = Date.now()) {
    for (const [key, row] of Object.entries(store.codes)) {
      if (row.expiresAt <= now) delete store.codes[key]
    }
    for (const [key, row] of Object.entries(store.accessTokens)) {
      if (row.expiresAt <= now) delete store.accessTokens[key]
    }
    for (const [key, row] of Object.entries(store.refreshTokens)) {
      if (row.expiresAt <= now) delete store.refreshTokens[key]
    }
    for (const [key, row] of Object.entries(store.revokedRefresh)) {
      if (row.expiresAt <= now) delete store.revokedRefresh[key]
    }
    for (const [nonce, row] of this.nonces) {
      if (row.expiresAt <= now) this.nonces.delete(nonce)
    }
  }

  revokeFamily(store, familyId) {
    for (const [key, row] of Object.entries(store.accessTokens)) {
      if (row.familyId === familyId) delete store.accessTokens[key]
    }
    for (const [key, row] of Object.entries(store.refreshTokens)) {
      if (row.familyId === familyId) {
        delete store.refreshTokens[key]
        store.revokedRefresh[key] = { familyId, expiresAt: Date.now() + REVOKED_TTL_MS }
      }
    }
  }

  metadata(origin) {
    return {
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['mcp', 'offline_access'],
    }
  }

  protectedResource(origin) {
    return {
      resource: resourceFor(origin),
      authorization_servers: [origin],
      scopes_supported: ['mcp'],
      bearer_methods_supported: ['header'],
    }
  }

  async register(body) {
    const redirectUris = Array.isArray(body?.redirect_uris) ? body.redirect_uris.map(String) : []
    if (!redirectUris.length || redirectUris.length > 10) {
      return error(400, 'invalid_redirect_uri', 'A redirect URI is required.')
    }
    if (redirectUris.some((uri) => uri.length > 500 || !isAllowedRedirect(uri))) {
      console.error(`OAuth registration rejected redirect: ${redirectUris.join(', ')}`)
      return error(400, 'invalid_redirect_uri', 'Redirect URI is not allowed for this server.')
    }
    const clientId = `cargos_${randomId(18)}`
    const client = {
      clientId,
      clientName: String(body.client_name || 'MCP client').slice(0, 80),
      redirectUris,
      tokenEndpointAuthMethod: 'none',
      createdAt: Date.now(),
    }
    await this.locked(async () => {
      const store = await this.read()
      this.prune(store)
      const ids = Object.keys(store.clients)
      if (ids.length >= 5000) {
        ids.sort((a, b) => store.clients[a].createdAt - store.clients[b].createdAt)
        for (const id of ids.slice(0, 500)) delete store.clients[id]
      }
      store.clients[clientId] = client
      await this.write(store)
    })
    return {
      status: 201,
      body: {
        client_id: clientId,
        client_id_issued_at: Math.floor(client.createdAt / 1000),
        client_name: client.clientName,
        redirect_uris: redirectUris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
    }
  }

  async clientById(clientId) {
    const store = await this.read()
    return store.clients[clientId] || null
  }

  matchingRedirect(client, redirectUri) {
    return client.redirectUris.find((uri) => redirectsMatch(uri, redirectUri) && isAllowedRedirect(redirectUri)) || null
  }

  async startAuthorize(query, origin) {
    const client = await this.clientById(String(query.client_id || ''))
    if (!client) return { type: 'html', status: 400, title: 'Unknown application', message: 'This sign-in link is not from a registered application.' }
    const redirectUri = String(query.redirect_uri || '')
    if (!this.matchingRedirect(client, redirectUri)) {
      return { type: 'html', status: 400, title: 'Redirect not allowed', message: 'This application is not allowed to return to that address.' }
    }
    const bounce = (oauthError, description) => ({
      type: 'redirect',
      location: withParams(redirectUri, { error: oauthError, error_description: description, state: query.state || '' }),
    })
    if (query.response_type !== 'code') return bounce('unsupported_response_type', 'Only authorization code is supported.')
    if (query.code_challenge_method !== 'S256' || !query.code_challenge || String(query.code_challenge).length > 128) {
      return bounce('invalid_request', 'PKCE S256 is required.')
    }
    const resource = query.resource ? String(query.resource) : ''
    if (resource && !sameResource(resource, origin)) {
      console.error(`OAuth resource rejected: ${resource}`)
      return bounce('invalid_target', 'Resource does not match this server.')
    }
    if (query.state && String(query.state).length > 2048) return bounce('invalid_request', 'State is too long.')
    const nonce = randomId(24)
    this.nonces.set(nonce, {
      expiresAt: Date.now() + NONCE_TTL_MS,
      clientId: client.clientId,
      clientName: client.clientName,
      redirectUri,
      redirectHost: new URL(redirectUri).host,
      codeChallenge: String(query.code_challenge),
      state: query.state ? String(query.state) : '',
      resource: resource || resourceFor(origin),
    })
    return { type: 'form', nonce, clientName: client.clientName, redirectHost: new URL(redirectUri).host }
  }

  async finishAuthorize({ nonce, email, password, ip }) {
    email = String(email || '').trim().slice(0, 180)
    password = String(password || '').slice(0, 200)
    const pending = this.nonces.get(String(nonce || ''))
    this.nonces.delete(String(nonce || ''))
    if (!pending || pending.expiresAt <= Date.now()) {
      return { type: 'html', status: 400, title: 'Sign-in expired', message: 'Go back to Claude and connect again.' }
    }
    const again = (message) => {
      const next = randomId(24)
      this.nonces.set(next, { ...pending, expiresAt: Date.now() + NONCE_TTL_MS })
      return { type: 'form', nonce: next, clientName: pending.clientName, redirectHost: pending.redirectHost, error: message, email }
    }
    if (this.limited(ip)) return again('Too many attempts. Wait a few minutes and try again.')
    try {
      const session = await this.login(String(email || ''), String(password || ''))
      const code = randomId(32)
      const familyId = randomId(16)
      await this.locked(async () => {
        const store = await this.read()
        this.prune(store)
        store.codes[code] = {
          clientId: pending.clientId,
          redirectUri: pending.redirectUri,
          codeChallenge: pending.codeChallenge,
          familyId,
          session: sessionCopy(session),
          expiresAt: Date.now() + CODE_TTL_MS,
        }
        await this.write(store)
      })
      this.failures.delete(ip)
      return {
        type: 'redirect',
        location: withParams(pending.redirectUri, { code, state: pending.state }),
        email: session.email,
      }
    } catch (err) {
      this.noteFailure(ip)
      const message = err.status === 401 ? 'Email or password is incorrect.' : 'Could not sign in. Try again.'
      return again(message)
    }
  }

  limited(ip) {
    const row = this.failures.get(ip)
    if (!row || row.resetAt <= Date.now()) return false
    return row.count >= 8
  }

  noteFailure(ip) {
    const row = this.failures.get(ip)
    if (!row || row.resetAt <= Date.now()) {
      this.failures.set(ip, { count: 1, resetAt: Date.now() + 10 * 60 * 1000 })
      return
    }
    row.count += 1
  }

  async token({ body, clientId }) {
    const grant = body.grant_type
    if (grant === 'authorization_code') return this.exchangeCode(body, clientId)
    if (grant === 'refresh_token') return this.exchangeRefresh(body, clientId)
    return error(400, 'unsupported_grant_type', 'Unsupported grant.')
  }

  async exchangeCode(body, clientId) {
    const code = String(body.code || '')
    const redirectUri = String(body.redirect_uri || '')
    const verifier = String(body.code_verifier || '')
    if (!code || !redirectUri || !clientId || !verifier) return error(400, 'invalid_request', 'Missing token request fields.')
    return this.locked(async () => {
      const store = await this.read()
      this.prune(store)
      const pending = store.codes[code]
      delete store.codes[code]
      if (!pending) {
        await this.write(store)
        return error(400, 'invalid_grant', 'Authorization code is invalid.')
      }
      const client = store.clients[pending.clientId]
      const challenge = pkce(verifier)
      const matches = pending.clientId === clientId
        && redirectsMatch(pending.redirectUri, redirectUri)
        && client
        && verifier.length >= 43
        && verifier.length <= 128
        && safeEqual(challenge, pending.codeChallenge.replace(/=+$/, ''))
      if (!matches) {
        await this.write(store)
        return error(400, 'invalid_grant', 'Authorization code could not be verified.')
      }
      const issued = this.issue(store, pending)
      await this.write(store)
      return { status: 200, body: issued }
    })
  }

  async exchangeRefresh(body, clientId) {
    const refresh = String(body.refresh_token || '')
    if (!refresh || !clientId) return error(400, 'invalid_request', 'Missing refresh token.')
    return this.locked(async () => {
      const store = await this.read()
      this.prune(store)
      const reused = store.revokedRefresh[refresh]
      if (reused) {
        this.revokeFamily(store, reused.familyId)
        await this.write(store)
        return error(400, 'invalid_grant', 'Refresh token was already used.')
      }
      const row = store.refreshTokens[refresh]
      if (!row || row.clientId !== clientId || row.expiresAt <= Date.now()) {
        return error(400, 'invalid_grant', 'Refresh token is invalid.')
      }
      delete store.refreshTokens[refresh]
      delete store.accessTokens[row.accessToken]
      store.revokedRefresh[refresh] = { familyId: row.familyId, expiresAt: Date.now() + REVOKED_TTL_MS }
      const issued = this.issue(store, row)
      await this.write(store)
      return { status: 200, body: issued }
    })
  }

  issue(store, row) {
    const accessToken = randomId(32)
    const refreshToken = randomId(32)
    const expiresAt = Date.now() + ACCESS_TTL_MS
    store.accessTokens[accessToken] = {
      clientId: row.clientId,
      familyId: row.familyId,
      session: row.session,
      expiresAt,
      refreshToken,
    }
    store.refreshTokens[refreshToken] = {
      clientId: row.clientId,
      familyId: row.familyId,
      session: row.session,
      expiresAt: Date.now() + REFRESH_TTL_MS,
      accessToken,
    }
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: Math.floor(ACCESS_TTL_MS / 1000),
      refresh_token: refreshToken,
      scope: 'mcp offline_access',
    }
  }

  async resolveAccessToken(token) {
    if (!token) return null
    return this.locked(async () => {
      const store = await this.read()
      const row = store.accessTokens[token]
      if (!row) {
        log('OAuth access token unknown', { tokens: Object.keys(store.accessTokens).length, store: this.storePath })
        return null
      }
      if (row.expiresAt <= Date.now()) {
        log('OAuth access token expired', { email: row.session?.email, expiredAt: new Date(row.expiresAt).toISOString() })
        return null
      }
      return sessionCopy(row.session)
    })
  }
}

function redactError(location) {
  try {
    const url = new URL(location)
    return `bounce ${url.searchParams.get('error')}: ${url.searchParams.get('error_description')}`
  } catch {
    return 'bounce'
  }
}

function error(status, code, description) {
  return { status, body: { error: code, error_description: description } }
}

function withParams(uri, params) {
  const url = new URL(uri)
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value)
  }
  return url.toString()
}

function clientIdFrom(req, body) {
  const header = req.headers.authorization || ''
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
    const split = decoded.indexOf(':')
    const id = split === -1 ? decoded : decoded.slice(0, split)
    if (body.client_id && body.client_id !== id) return ''
    return id
  }
  return String(body.client_id || '')
}

export function mountOAuth(app, { login, storePath, origin } = {}) {
  const server = new OAuthServer({ storePath: storePath || defaultOAuthPath(), login })
  const originFor = (req) => (origin ? origin.replace(/\/$/, '') : publicOrigin(req))

  const sendMeta = (document) => (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300')
    res.json(document(_req))
  }
  app.get('/.well-known/oauth-protected-resource', sendMeta((req) => server.protectedResource(originFor(req))))
  app.get('/.well-known/oauth-protected-resource/mcp', sendMeta((req) => server.protectedResource(originFor(req))))
  app.get('/.well-known/oauth-authorization-server', sendMeta((req) => server.metadata(originFor(req))))
  app.get('/.well-known/oauth-authorization-server/mcp', sendMeta((req) => server.metadata(originFor(req))))
  app.get('/.well-known/openid-configuration', sendMeta((req) => server.metadata(originFor(req))))

  app.post('/oauth/register', async (req, res) => {
    try {
      const result = await server.register(req.body || {})
      if (result.status === 201) console.error(`OAuth client registered (${result.body.client_name})`)
      else console.error(`OAuth registration rejected: ${result.body.error_description}`)
      res.status(result.status).json(result.body)
    } catch (err) {
      console.error(`OAuth registration failed: ${err.message}`)
      res.status(500).json({ error: 'server_error', error_description: 'Could not register the client.' })
    }
  })

  app.get('/oauth/authorize', async (req, res) => {
    try {
      const result = await server.startAuthorize(req.query, originFor(req))
      log('OAuth authorize start', {
        client: req.query.client_id,
        redirect: req.query.redirect_uri,
        resource: req.query.resource,
        scope: req.query.scope,
        prompt: req.query.prompt,
        result: result.type === 'form' ? 'login form' : result.type === 'redirect' ? redactError(result.location) : result.title,
      })
      sendAuthorize(res, result, '', originFor(req))
    } catch (err) {
      console.error(`OAuth authorize failed: ${err.message}`)
      sendPage(res, 500, 'Sign-in unavailable', 'Could not start sign-in. Try again.')
    }
  })

  app.post('/oauth/authorize', async (req, res) => {
    try {
      const result = await server.finishAuthorize({
        nonce: req.body?.nonce,
        email: req.body?.email,
        password: req.body?.password,
        ip: req.ip || 'unknown',
      })
      if (result.type === 'redirect') console.error(`OAuth sign-in succeeded for ${result.email}`)
      else log('OAuth sign-in not completed', { email: req.body?.email, reason: result.error || result.title })
      sendAuthorize(res, result, req.body?.email, originFor(req))
    } catch (err) {
      console.error(`OAuth sign-in failed: ${err.message}`)
      sendPage(res, 500, 'Sign-in unavailable', 'Could not sign in. Try again.')
    }
  })

  app.post('/oauth/token', async (req, res) => {
    try {
      const body = req.body || {}
      const clientId = clientIdFrom(req, body)
      const result = await server.token({ body, clientId })
      log(`OAuth token ${body.grant_type || '?'} → ${result.status}`, {
        client: clientId,
        redirect: body.redirect_uri,
        resource: body.resource,
        basicAuth: String(req.headers.authorization || '').startsWith('Basic ') || undefined,
        error: result.body.error ? `${result.body.error}: ${result.body.error_description}` : undefined,
        expiresIn: result.body.expires_in,
      })
      res.set('Cache-Control', 'no-store')
      res.status(result.status).json(result.body)
    } catch (err) {
      console.error(`OAuth token failed: ${err.message}`)
      res.status(500).json({ error: 'server_error', error_description: 'Could not issue a token.' })
    }
  })

  return {
    originFor,
    resolveAccessToken: (token) => server.resolveAccessToken(token),
  }
}

function sendAuthorize(res, result, email, origin) {
  if (result.type === 'redirect') {
    res.redirect(302, result.location)
    return
  }
  if (result.type === 'form') {
    sendPage(res, 200, 'Sign in to Cargos', loginBody(result, email || result.email || '', origin))
    return
  }
  sendPage(res, result.status || 400, result.title, result.message)
}

function sendPage(res, status, title, body) {
  // No form-action directive. Chrome blocks the sign-in POST when one is set,
  // including 'self' and the explicit site origin, once the URL has a query string.
  res.set('Cache-Control', 'no-store')
  res.set('Referrer-Policy', 'no-referrer')
  res.set('Content-Security-Policy', "base-uri 'none'; script-src 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; style-src 'unsafe-inline'")
  res.set('X-Robots-Tag', 'noindex')
  res.status(status).type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4f6f8; color: #17202a; font: 16px/1.45 ui-sans-serif, system-ui, sans-serif; }
    main { width: min(420px, calc(100% - 32px)); background: #fff; border-radius: 16px; padding: 28px; box-shadow: 0 12px 40px rgba(23, 32, 42, 0.08); }
    h1 { margin: 0 0 8px; font-size: 22px; }
    p { margin: 0 0 16px; color: #52606d; }
    label { display: block; margin: 12px 0 6px; font-size: 14px; }
    input { width: 100%; box-sizing: border-box; border: 1px solid #d5dbe1; border-radius: 10px; padding: 10px 12px; font: inherit; }
    button { margin-top: 18px; width: 100%; border: 0; border-radius: 10px; padding: 12px; background: #17202a; color: #fff; font: inherit; }
    .error { margin: 0 0 8px; color: #9b2c2c; }
  </style>
</head>
<body>
  <main>
    <h1>${esc(title)}</h1>
    ${body}
  </main>
</body>
</html>`)
}

function loginBody(result, email, origin) {
  const action = `${String(origin || '').replace(/\/$/, '')}/oauth/authorize`
  return `<p>${esc(result.clientName)} will return to <strong>${esc(result.redirectHost)}</strong> after you sign in with your Cargos account.</p>
    ${result.error ? `<p class="error">${esc(result.error)}</p>` : ''}
    <form method="post" action="${esc(action)}">
      <input type="hidden" name="nonce" value="${esc(result.nonce)}">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" autocomplete="username" required value="${esc(email)}">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">Sign in</button>
    </form>`
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]))
}
