import { LOCAL_DB_FILE } from '../src/app.js'
import { resolveDbConfig, type DbConfig } from '../src/db/config.js'
import { Db } from '../src/db/index.js'
import { loadEnv } from '../src/env.js'

/** Where a script will connect, without the token: a file path or a remote host name. */
export function describe(config: DbConfig): string {
  if (config.local) return config.url
  try {
    return `${new URL(config.url).host} (remote)`
  } catch {
    return '(remote database)'
  }
}

/** The database the environment points at: DATABASE_URL, else DB_PATH, else the local server's file. */
export function openTarget(): { db: Db; config: DbConfig } {
  const env = loadEnv()
  const config = resolveDbConfig(env, LOCAL_DB_FILE)!
  return { db: new Db(config), config }
}
