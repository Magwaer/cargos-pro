import { getToken } from './auth.js'

export function apiBase() {
  return (process.env.CARGOS_API_URL || 'http://localhost:3010').replace(/\/$/, '')
}

export async function api(method, path, { query, body } = {}) {
  const token = await getToken()
  if (!token) throw new Error('Not authorized. Call auth_login or set CARGOS_API_KEY on the MCP server.')
  const url = new URL(path, `${apiBase()}/`)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value == null || value === '') continue
      url.searchParams.set(key, String(value))
    }
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data = null
  if (text) {
    try { data = JSON.parse(text) } catch { data = { raw: text.slice(0, 400) } }
  }
  if (!res.ok) {
    const error = new Error(data?.error || `Cargos API ${res.status} on ${method} ${path}`)
    error.status = res.status
    error.data = data
    throw error
  }
  return data
}

export function ok(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

export function fail(err) {
  return {
    isError: true,
    content: [{ type: 'text', text: err?.message || String(err) }],
  }
}

export async function run(fn) {
  try {
    return ok(await fn())
  } catch (err) {
    return fail(err)
  }
}
