import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { SCHEMA_VERSION, migrate } from '../src/db/schema.js'
import { describe, openTarget } from './db-target.js'

/**
 * Creates or updates the plans/favorites tables. Run once per database (and again after a schema change):
 *   DATABASE_URL=libsql://<db>.turso.io DATABASE_AUTH_TOKEN=<token> npm run db:migrate
 * Safe to repeat: it does nothing when the schema is current.
 */
const { db, config } = openTarget()
if (config.local) mkdirSync(dirname(config.url.slice('file:'.length)), { recursive: true })
try {
  const { from, to } = await migrate(await db.client())
  console.log(`${describe(config)}: schema ${from} → ${to} (current ${SCHEMA_VERSION}). ${from === to ? 'Already up to date.' : 'Migrated.'}`)
  if (to !== SCHEMA_VERSION) process.exitCode = 1
} catch (error) {
  console.error(`Migration failed for ${describe(config)}: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await db.close()
}
