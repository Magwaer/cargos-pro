import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const AUTH_PATH = process.env.MCP_AUTH_PATH || fileURLToPath(new URL('../data/auth.json', import.meta.url))

let cache = null

function envToken() {
  return process.env.CARGOS_API_KEY || process.env.CARGOS_TOKEN || ''
}

export function authPath() {
  return AUTH_PATH
}

export async function loadAuth() {
  if (cache) return cache
  const token = envToken()
  if (token) {
    cache = {
      token,
      kind: token.startsWith('ck_') ? 'api_key' : 'jwt',
      source: 'env',
      email: process.env.CARGOS_EMAIL || null,
    }
    return cache
  }
  try {
    const raw = JSON.parse(await readFile(AUTH_PATH, 'utf8'))
    if (raw?.token) {
      cache = { ...raw, source: 'file' }
      return cache
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
  return null
}

export async function getToken() {
  const auth = await loadAuth()
  return auth?.token || ''
}

export async function saveAuth(record) {
  cache = { ...record, source: 'file', savedAt: new Date().toISOString() }
  await mkdir(dirname(AUTH_PATH), { recursive: true, mode: 0o700 })
  await writeFile(AUTH_PATH, `${JSON.stringify(cache, null, 2)}\n`, { mode: 0o600 })
  return cache
}

export async function clearAuth() {
  cache = null
  try {
    await unlink(AUTH_PATH)
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
}

export async function persistLogin(apiBase, email, password) {
  const loginRes = await fetch(new URL('/api/auth/login', apiBase), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const login = await readJson(loginRes)
  if (!loginRes.ok) throw new Error(login.error || 'Sign in failed.')
  const jwt = login.token
  const meRes = await fetch(new URL('/api/auth/me', apiBase), {
    headers: { Authorization: `Bearer ${jwt}` },
  })
  const me = await readJson(meRes)
  if (!meRes.ok) throw new Error(me.error || 'Could not load the signed-in user.')

  let token = jwt
  let kind = 'jwt'
  let expires = '7 days (workspace session)'
  try {
    const keyRes = await fetch(new URL('/api/api-keys', apiBase), {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'MCP server', scope: 'write' }),
    })
    const key = await readJson(keyRes)
    if (keyRes.ok && key.token) {
      token = key.token
      kind = 'api_key'
      expires = 'until revoked'
    }
  } catch {
    // Keep the JWT if the workspace cannot mint an API key.
  }

  const saved = await saveAuth({
    token,
    kind,
    expires,
    email: me.email,
    name: me.name,
    role: me.role,
    tenantId: me.tenant_id,
    tenantName: me.tenant_name,
  })
  return {
    ok: true,
    kind: saved.kind,
    expires: saved.expires,
    email: saved.email,
    name: saved.name,
    role: saved.role,
    tenantName: saved.tenantName,
    storedAt: authPath(),
  }
}

async function readJson(res) {
  const text = await res.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { error: text.slice(0, 240) }
  }
}
