import { api } from './client.js'
import { BATCH_OPS, RESOURCES } from './catalog.js'

const MAX_OPS = 50

export async function runBatch({ operations, stopOnError = true }) {
  if (!Array.isArray(operations) || !operations.length) {
    throw new Error('Provide at least one operation.')
  }
  if (operations.length > MAX_OPS) {
    throw new Error(`Batch is limited to ${MAX_OPS} operations.`)
  }

  const results = []
  for (const [index, raw] of operations.entries()) {
    const op = String(raw?.op || '').toLowerCase()
    const resource = String(raw?.resource || '').toLowerCase()
    const spec = RESOURCES[resource]
    try {
      if (!BATCH_OPS.includes(op)) throw new Error(`op must be insert, update, or delete.`)
      if (!spec) throw new Error(`Unknown resource "${resource}".`)
      if (!spec.methods[op]) throw new Error(`${resource} does not support ${op}.`)
      if ((op === 'update' || op === 'delete') && !raw.id) throw new Error(`${op} requires id.`)
      if (op === 'insert' && (!raw.data || typeof raw.data !== 'object')) throw new Error('insert requires data.')
      if (op === 'update' && (!raw.data || typeof raw.data !== 'object')) throw new Error('update requires data.')

      const method = spec.methods[op]
      const path = op === 'insert' ? spec.collection : spec.item(raw.id)
      const data = await api(method, path, op === 'delete' ? {} : { body: raw.data })
      results.push({ index, ok: true, op, resource, id: raw.id || data?.id || null, data })
    } catch (err) {
      const row = { index, ok: false, op, resource, id: raw?.id || null, error: err.message }
      results.push(row)
      if (stopOnError) {
        return { ok: false, stoppedAt: index, results }
      }
    }
  }
  return { ok: results.every((row) => row.ok), results }
}
