// Versioned SQL migrations. Each file in ./migrations runs once, in name order; completion is
// recorded in `schema_migrations` only after every statement of that file succeeded.
// Usage: imported by index.mjs at startup, or `node server/migrate.mjs` as a finite task.
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

/** Split a migration file into statements (no stored procedures, so `;` at line end is enough). */
export function splitStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map(s => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean)
}

export async function migrate(url = process.env.DATABASE_URL, log = console.log) {
  if (!url) throw new Error('DATABASE_URL is missing')
  const conn = await mysql.createConnection(url)
  try {
    await conn.query(
      'CREATE TABLE IF NOT EXISTS `schema_migrations` (`name` varchar(128) NOT NULL PRIMARY KEY, `appliedAt` timestamp NOT NULL DEFAULT (now()))',
    )
    const [rows] = await conn.query('SELECT `name` FROM `schema_migrations`')
    const done = new Set(rows.map(r => r.name))
    const files = (await readdir(DIR)).filter(f => f.endsWith('.sql')).sort()
    for (const f of files) {
      if (done.has(f)) continue
      const sql = await readFile(join(DIR, f), 'utf8')
      for (const stmt of splitStatements(sql)) {
        try {
          await conn.query(stmt)
        } catch (e) {
          // A rerun after a partial failure may hit an index that already exists.
          if (e && (e.code === 'ER_DUP_KEYNAME' || e.errno === 1061)) continue
          throw e
        }
      }
      await conn.query('INSERT INTO `schema_migrations` (`name`) VALUES (?)', [f])
      log(`[migrate] applied ${f}`)
    }
  } finally {
    await conn.end()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrate().then(
    () => console.log('[migrate] up to date'),
    e => {
      console.error('[migrate] failed:', e.message)
      process.exitCode = 1
    },
  )
}
