import type { Client } from '@libsql/client/web'

/**
 * Only plans and favorites live in the database; places are bundled with the code (server/src/places.ts).
 * Each entry is one migration. Never edit a shipped entry; append a new one.
 * Applied by `npm run db:migrate` (production, once) or by the local server on boot (file databases only).
 */
export const MIGRATIONS: string[][] = [
  [
    `CREATE TABLE IF NOT EXISTS plans (
       id TEXT PRIMARY KEY,
       user_id TEXT NOT NULL,
       place_id TEXT NOT NULL,
       date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
       arrival_time TEXT NOT NULL CHECK (arrival_time GLOB '[0-2][0-9]:[0-5][0-9]'),
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL,
       UNIQUE (user_id, place_id, date)
     )`,
    'CREATE INDEX IF NOT EXISTS plans_user_date ON plans (user_id, date)',
    `CREATE TABLE IF NOT EXISTS favorites (
       user_id TEXT NOT NULL,
       place_id TEXT NOT NULL,
       created_at TEXT NOT NULL,
       PRIMARY KEY (user_id, place_id)
     )`,
  ],
]

export const SCHEMA_VERSION = MIGRATIONS.length

/** The applied schema version, or 0 when the database has never been migrated. */
export async function schemaVersion(client: Client): Promise<number> {
  const table = await client.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'")
  if (!table.rows.length) return 0
  const row = (await client.execute('SELECT MAX(version) AS version FROM schema_version')).rows[0]
  return Number(row?.version ?? 0)
}

/** Applies missing migrations, each in its own transaction. Safe to run again: it does nothing when up to date. */
export async function migrate(client: Client): Promise<{ from: number; to: number }> {
  await client.execute('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)')
  const from = await schemaVersion(client)
  for (let index = from; index < MIGRATIONS.length; index++) {
    await client.batch(
      [
        ...MIGRATIONS[index],
        { sql: 'INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (?, ?)', args: [index + 1, new Date().toISOString()] },
      ],
      'write',
    )
  }
  return { from, to: await schemaVersion(client) }
}
