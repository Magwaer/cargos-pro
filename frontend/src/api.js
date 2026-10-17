import { useCallback, useEffect, useState } from 'react'

const TOKEN_KEY = 'cargos_token'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  let payload
  if (form) payload = form
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(path, { method, headers, body: payload })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { error: text } }
  if (res.status === 401) {
    const onAuth = location.pathname === '/login' || location.pathname === '/register'
    if (!onAuth) {
      clearToken()
      location.assign('/login')
    }
  }
  if (!res.ok) throw new Error(data?.error || res.statusText)
  return data
}

export async function downloadFile(path, filename) {
  const res = await fetch(path, { headers: { Authorization: `Bearer ${getToken()}` } })
  if (!res.ok) throw new Error('Download failed.')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function useFetch(path) {
  const [state, setState] = useState({ loading: Boolean(path), data: null, error: null })
  const reload = useCallback(() => {
    if (!path) return
    setState((current) => ({ ...current, loading: true, error: null }))
    api(path)
      .then((data) => setState({ loading: false, data, error: null }))
      .catch((err) => setState({ loading: false, data: null, error: err.message }))
  }, [path])
  useEffect(() => { reload() }, [reload])
  return { ...state, reload }
}
