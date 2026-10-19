import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { decideAccess, isAllowedRedirect, mountOAuth, wwwAuthenticate } from './oauth.js'

const ORIGIN = 'https://cargos.pro'

test('redirect allowlist accepts Claude and loopback only', () => {
  assert.equal(isAllowedRedirect('https://claude.ai/api/mcp/auth_callback'), true)
  assert.equal(isAllowedRedirect('http://127.0.0.1:53280/callback'), true)
  assert.equal(isAllowedRedirect('http://localhost/callback'), true)
  assert.equal(isAllowedRedirect('https://evil.example/callback'), false)
  assert.equal(isAllowedRedirect('http://localhost.evil/callback'), false)
})

test('www-authenticate points at the MCP protected-resource document', () => {
  const header = wwwAuthenticate(ORIGIN, { tokenPresent: true })
  assert.match(header, /resource_metadata="https:\/\/cargos\.pro\/\.well-known\/oauth-protected-resource\/mcp"/)
  assert.match(header, /error="invalid_token"/)
})

test('shared secret and oauth bearer are distinct', () => {
  assert.equal(decideAccess({ bearer: 'cursor', sharedSecret: 'cursor', session: null }).mode, 'shared')
  assert.equal(decideAccess({ bearer: 'oauth', sharedSecret: 'cursor', session: { token: 'ck' } }).mode, 'oauth')
  assert.equal(decideAccess({ bearer: '', sharedSecret: '', session: null }).mode, 'open')
  assert.equal(decideAccess({ bearer: 'nope', sharedSecret: 'cursor', session: null }).ok, false)
})

test('authorization code flow, refresh rotation, and rejected registration', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cargos-oauth-'))
  const app = express()
  app.use(express.json())
  app.use(express.urlencoded({ extended: false }))
  mountOAuth(app, {
    origin: ORIGIN,
    storePath: join(dir, 'oauth.json'),
    login: async (email, password) => {
      if (password !== 'demo1234') {
        const error = new Error('Email or password is incorrect.')
        error.status = 401
        throw error
      }
      return {
        token: 'ck_live_test',
        kind: 'api_key',
        expires: 'until revoked',
        email,
        name: 'Anna',
        role: 'owner',
        tenantName: 'Northlane',
      }
    },
  })
  const server = createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const meta = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json()
    assert.equal(meta.issuer, ORIGIN)
    assert.equal(meta.registration_endpoint, `${ORIGIN}/oauth/register`)
    assert.ok(meta.code_challenge_methods_supported.includes('S256'))
    assert.ok(meta.token_endpoint_auth_methods_supported.includes('none'))
    const resource = await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json()
    assert.equal(resource.resource, `${ORIGIN}/mcp`)
    assert.deepEqual(resource.authorization_servers, [ORIGIN])

    const rejected = await fetch(`${base}/oauth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['https://evil.example/callback'], client_name: 'Evil' }),
    })
    assert.equal(rejected.status, 400)

    const registered = await (await fetch(`${base}/oauth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
        client_name: 'Claude',
        token_endpoint_auth_method: 'none',
      }),
    })).json()
    assert.ok(registered.client_id)

    const verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: registered.client_id,
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'abc123',
      resource: `${ORIGIN}/mcp`,
      scope: 'mcp offline_access',
    })
    const page = await (await fetch(`${base}/oauth/authorize?${query}`)).text()
    const nonce = page.match(/name="nonce" value="([^"]+)"/)[1]
    assert.match(page, /claude\.ai/)

    const wrong = await fetch(`${base}/oauth/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ nonce, email: 'anna@northlane.example', password: 'nope' }),
    })
    assert.equal(wrong.status, 200)
    const retry = await wrong.text()
    assert.match(retry, /Email or password is incorrect/)
    const nextNonce = retry.match(/name="nonce" value="([^"]+)"/)[1]

    const signedIn = await fetch(`${base}/oauth/authorize`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ nonce: nextNonce, email: 'anna@northlane.example', password: 'demo1234' }),
    })
    assert.equal(signedIn.status, 302)
    const location = new URL(signedIn.headers.get('location'))
    assert.equal(location.origin + location.pathname, 'https://claude.ai/api/mcp/auth_callback')
    assert.equal(location.searchParams.get('state'), 'abc123')
    const code = location.searchParams.get('code')

    const tokenRes = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
        client_id: registered.client_id,
        code_verifier: verifier,
      }),
    })
    const token = await tokenRes.json()
    assert.equal(tokenRes.status, 200)
    assert.equal(token.token_type, 'Bearer')
    assert.ok(token.access_token)
    assert.ok(token.refresh_token)
    assert.equal(token.access_token.includes('ck_live'), false)

    const reused = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
        client_id: registered.client_id,
        code_verifier: verifier,
      }),
    })
    assert.equal((await reused.json()).error, 'invalid_grant')

    const refreshed = await (await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: token.refresh_token,
        client_id: registered.client_id,
      }),
    })).json()
    assert.ok(refreshed.access_token)
    assert.notEqual(refreshed.refresh_token, token.refresh_token)

    const replay = await (await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: token.refresh_token,
        client_id: registered.client_id,
      }),
    })).json()
    assert.equal(replay.error, 'invalid_grant')

    const family = await (await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshed.refresh_token,
        client_id: registered.client_id,
      }),
    })).json()
    assert.equal(family.error, 'invalid_grant')
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()))
    await rm(dir, { recursive: true, force: true })
  }
})
