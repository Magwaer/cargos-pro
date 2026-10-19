const MAX_BODY = 600

export function log(message, fields = {}) {
  const parts = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
  console.error(`${new Date().toISOString()} ${message}${parts.length ? ` ${parts.join(' ')}` : ''}`)
}

export function maskToken(token) {
  if (!token) return ''
  const value = String(token)
  if (value.length <= 10) return '…'
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

function rpcSummary(body) {
  const items = Array.isArray(body) ? body : body && typeof body === 'object' ? [body] : []
  return items.map((item) => {
    if (!item || typeof item !== 'object') return '?'
    if (item.method === 'tools/call') return `tools/call:${item.params?.name || '?'}#${item.id ?? '-'}`
    if (item.method === 'initialize') return `initialize(v=${item.params?.protocolVersion || '?'},client=${item.params?.clientInfo?.name || '?'}/${item.params?.clientInfo?.version || '?'})#${item.id ?? '-'}`
    if (item.method) return `${item.method}#${item.id ?? '-'}`
    if ('result' in item || 'error' in item) return `response#${item.id ?? '-'}`
    return '?'
  }).join(',')
}

export function requestLogger() {
  let counter = 0
  return (req, res, next) => {
    if (req.path === '/health') {
      next()
      return
    }
    const id = (++counter).toString(36)
    const started = Date.now()
    req.logId = id
    const chunks = []
    let size = 0
    const capture = (chunk, encoding) => {
      if (!chunk || size >= MAX_BODY) return
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : 'utf8')
      chunks.push(buffer.subarray(0, MAX_BODY - size))
      size += buffer.length
    }
    const write = res.write.bind(res)
    const end = res.end.bind(res)
    res.write = (chunk, encoding, cb) => {
      capture(chunk, encoding)
      return write(chunk, encoding, cb)
    }
    res.end = (chunk, encoding, cb) => {
      if (typeof chunk !== 'function') capture(chunk, encoding)
      return end(chunk, encoding, cb)
    }

    const path = req.originalUrl.split('?')[0]
    const isMcp = req.path === '/mcp'
    const auth = req.headers.authorization || ''
    log(`→ ${id} ${req.method} ${path}`, {
      ip: req.ip,
      ua: req.get('user-agent'),
      accept: isMcp ? req.get('accept') : undefined,
      contentType: isMcp || req.path.startsWith('/oauth') ? req.get('content-type') : undefined,
      protocol: req.get('mcp-protocol-version'),
      session: req.get('mcp-session-id'),
      auth: auth ? `${auth.split(' ')[0]} ${maskToken(auth.split(' ')[1])}` : undefined,
    })

    let done = false
    const finish = (event) => {
      if (done) return
      done = true
      const status = res.statusCode
      const type = String(res.getHeader('content-type') || '')
      const body = Buffer.concat(chunks).toString('utf8').replace(/\s+/g, ' ').trim()
      const showBody = status >= 400 || (isMcp && /"error"\s*:/.test(body))
      log(`← ${id} ${req.method} ${path} ${status}${event === 'close' && !res.writableFinished ? ' (client closed early)' : ''}`, {
        ms: Date.now() - started,
        rpc: isMcp && req.method === 'POST' ? rpcSummary(req.body) : undefined,
        type: type.split(';')[0],
        mode: req.mcpAuthMode,
        user: req.mcpUser,
        location: status >= 300 && status < 400 ? redactLocation(res.getHeader('location')) : undefined,
        body: showBody ? body.slice(0, MAX_BODY) : undefined,
      })
    }
    res.on('finish', () => finish('finish'))
    res.on('close', () => finish('close'))
    next()
  }
}

function redactLocation(value) {
  if (!value) return undefined
  try {
    const url = new URL(String(value))
    if (url.searchParams.has('code')) url.searchParams.set('code', '…')
    if (url.searchParams.has('state')) url.searchParams.set('state', '…')
    return url.toString()
  } catch {
    return String(value).slice(0, 200)
  }
}
