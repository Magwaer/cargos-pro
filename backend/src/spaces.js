import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { httpError } from './http.js'

export function spacesConfigured() {
  return Boolean(
    process.env.SPACES_ENDPOINT
    && process.env.SPACES_BUCKET
    && process.env.SPACES_ACCESS_KEY
    && process.env.SPACES_SECRET_KEY,
  )
}

function client() {
  if (!spacesConfigured()) throw httpError(503, 'File storage is not configured.')
  return new S3Client({
    region: process.env.SPACES_REGION || 'us-east-1',
    endpoint: process.env.SPACES_ENDPOINT,
    credentials: {
      accessKeyId: process.env.SPACES_ACCESS_KEY,
      secretAccessKey: process.env.SPACES_SECRET_KEY,
    },
    forcePathStyle: false,
  })
}

export async function putObject({ key, body, contentType }) {
  await client().send(new PutObjectCommand({
    Bucket: process.env.SPACES_BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType || 'application/octet-stream',
    ACL: 'private',
  }))
}

export async function getObject(key) {
  return client().send(new GetObjectCommand({
    Bucket: process.env.SPACES_BUCKET,
    Key: key,
  }))
}

export async function deleteObject(key) {
  if (!key || key.startsWith('/') || !spacesConfigured()) return
  await client().send(new DeleteObjectCommand({
    Bucket: process.env.SPACES_BUCKET,
    Key: key,
  }))
}

export function objectKey(tenantId, objectType, objectId, filename) {
  const safe = String(filename || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || 'file'
  return `${tenantId}/${objectType}/${objectId}/${safe}`
}
