import 'dotenv/config'
import { createServer } from './server.js'
import { persistLogin, loadAuth } from './auth.js'
import { apiBase } from './client.js'

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
  app.use(express.json({ limit: '4mb' }))

  const bind = process.env.MCP_BIND || '127.0.0.1'

  app.get('/health', (_req, res) => res.json({ ok: true, api: apiBase() }))

  app.all('/mcp', async (req, res) => {
    if (secret) {
      const header = req.headers.authorization || ''
      const token = header.startsWith('Bearer ') ? header.slice(7).trim() : (req.headers['x-mcp-key'] || '')
      if (token !== secret) {
        res.status(401).json({ error: 'MCP shared secret required.' })
        return
      }
    }
    const server = createServer()
    const session = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => {
      session.close?.()
      server.close?.()
    })
    await server.connect(session)
    await session.handleRequest(req, res, req.body)
  })

  app.listen(port, bind, () => {
    console.error(`Cargos MCP HTTP on ${bind}:${port}/mcp → ${apiBase()}`)
  })
}
