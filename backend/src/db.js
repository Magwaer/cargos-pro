import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const { Pool } = pg

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://cargos:cargos@localhost:5432/cargos',
})

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')
  await pool.query(sql)
}

export async function waitForDb() {
  let last
  for (let i = 0; i < 30; i++) {
    try {
      await pool.query('SELECT 1')
      return
    } catch (err) {
      last = err
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
  throw last
}
