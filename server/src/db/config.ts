import { isAbsolute, resolve } from 'node:path'

const SERVER_DIR = resolve(import.meta.dirname, '../..')

export type DbConfig = {
  url: string
  authToken: string | undefined
  /** A `file:` database on this machine (local `npm start`, tests, Render's disk). */
  local: boolean
}

export type DbEnv = { DATABASE_URL?: string; DATABASE_AUTH_TOKEN?: string; DB_PATH?: string }

const REMOTE = /^(libsql|https?|wss?):\/\//i

/** `file:` URLs with a relative path are relative to server/, whatever the working directory. */
function absoluteFileUrl(url: string): string {
  const path = url.slice('file:'.length)
  if (path === ':memory:' || isAbsolute(path)) return url
  return `file:${resolve(SERVER_DIR, path)}`
}

/**
 * DATABASE_URL wins. DB_PATH (the earlier SQLite setting, still used by render.yaml) becomes a `file:` URL.
 * `fallbackFile` is for the local server only; on Vercel there is no fallback, so a missing URL is reported, not guessed.
 */
export function resolveDbConfig(env: DbEnv, fallbackFile?: string): DbConfig | null {
  const raw = env.DATABASE_URL?.trim() || (env.DB_PATH?.trim() ? `file:${env.DB_PATH.trim()}` : fallbackFile ? `file:${fallbackFile}` : '')
  if (!raw) return null
  const local = raw.startsWith('file:') || raw === ':memory:'
  return {
    url: raw === ':memory:' ? 'file::memory:' : local ? absoluteFileUrl(raw) : raw,
    authToken: env.DATABASE_AUTH_TOKEN?.trim() || undefined,
    local,
  }
}

/** Whether the URL has a scheme the database client understands. */
export function isSupportedDbUrl(url: string): boolean {
  return url.startsWith('file:') || REMOTE.test(url)
}
