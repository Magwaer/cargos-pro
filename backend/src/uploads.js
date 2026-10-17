import crypto from 'crypto'
import multer from 'multer'
import { pool } from './db.js'
import { httpError } from './http.js'
import { deleteObject, objectKey, putObject, spacesConfigured } from './spaces.js'

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^(image\/|application\/pdf|text\/plain)/.test(file.mimetype)
    cb(ok ? null : new Error('Upload a PDF, image, or text file.'), ok)
  },
})

export async function storeDocument({ tenantId, objectType, objectId, kind, file, userId }) {
  if (!file?.buffer) throw httpError(400, 'Choose a file.')
  if (!spacesConfigured()) throw httpError(503, 'File storage is not configured.')
  const id = crypto.randomUUID()
  const key = objectKey(tenantId, objectType, objectId, `${id}-${file.originalname || 'file'}`)
  await putObject({ key, body: file.buffer, contentType: file.mimetype })
  const { rows } = await pool.query(
    `INSERT INTO documents (id, tenant_id, object_type, object_id, kind, filename, path, mime, size_bytes, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id, kind, filename, mime, size_bytes, created_at`,
    [id, tenantId, objectType, objectId, kind || 'other', file.originalname || 'file', key, file.mimetype, file.size, userId || null],
  )
  return rows[0]
}

export async function storeBufferDocument({ tenantId, objectType, objectId, kind, filename, buffer, mime, userId }) {
  if (!spacesConfigured()) return null
  const id = crypto.randomUUID()
  const key = objectKey(tenantId, objectType, objectId, `${id}-${filename || 'file'}`)
  await putObject({ key, body: buffer, contentType: mime })
  const { rows } = await pool.query(
    `INSERT INTO documents (id, tenant_id, object_type, object_id, kind, filename, path, mime, size_bytes, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id, kind, filename, mime, size_bytes, created_at`,
    [id, tenantId, objectType, objectId, kind || 'other', filename || 'file', key, mime, buffer.length, userId || null],
  )
  return rows[0]
}

export { deleteObject }
