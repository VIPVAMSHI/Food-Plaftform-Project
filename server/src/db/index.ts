import type { Client, InStatement, Row } from '@libsql/client'
import type { Favorite, Plan } from '../../../shared/types.js'
import type { DbConfig } from './config.js'
import { SCHEMA_VERSION, schemaVersion } from './schema.js'

/**
 * Plans and favorites through libSQL: a `file:` database locally and in tests, Turso (over HTTPS) on Vercel.
 * The client is created on first use, so a missing or wrong setting shows up in /api/health and as a
 * friendly 503 on plan requests, never as a crashed function.
 */

export class UniqueViolation extends Error {}
export class PlanLimitReached extends Error {}

export type DbProblem = 'not_configured' | 'unreachable' | 'schema_missing'

/** The database cannot serve this request. The cause is logged, never sent to the client. */
export class DbUnavailable extends Error {
  constructor(
    readonly problem: DbProblem,
    readonly detail?: unknown,
  ) {
    super(`database ${problem}`)
  }
}

export type DbStatus = { configured: boolean; reachable: boolean; schema: boolean; problem: DbProblem | null }

function toPlan(row: Row): Plan {
  return {
    id: String(row.id),
    placeId: String(row.place_id),
    date: String(row.date),
    time: String(row.arrival_time),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

const toFavorite = (row: Row): Favorite => ({ placeId: String(row.place_id), createdAt: String(row.created_at) })

/** Opens a client. Remote URLs use the HTTP-only web client, so the deployed function loads no native code. */
export async function openClient(config: DbConfig): Promise<Client> {
  if (config.local) {
    const { createClient } = await import('@libsql/client')
    return createClient({ url: config.url })
  }
  const { createClient } = await import('@libsql/client/web')
  return createClient({ url: config.url, authToken: config.authToken })
}

export class Db {
  #client: Promise<Client> | null = null
  #schemaChecked = false
  #closed = false

  constructor(readonly config: DbConfig | null) {}

  /** For tests and scripts that already hold a client. */
  static fromClient(client: Client, config: DbConfig): Db {
    const db = new Db(config)
    db.#client = Promise.resolve(client)
    return db
  }

  async #connect(): Promise<Client> {
    if (!this.config) throw new DbUnavailable('not_configured')
    this.#client ??= openClient(this.config).catch((error: unknown) => {
      this.#client = null
      throw new DbUnavailable('unreachable', error)
    })
    return this.#client
  }

  /** The raw client, for migrations and maintenance scripts. */
  client(): Promise<Client> {
    return this.#connect()
  }

  /** Runs one statement. The schema is checked once per process; until it is migrated, every call fails with schema_missing. */
  async #execute(statement: InStatement) {
    const client = await this.#connect()
    try {
      if (!this.#schemaChecked) {
        if ((await schemaVersion(client)) < SCHEMA_VERSION) throw new DbUnavailable('schema_missing')
        this.#schemaChecked = true
      }
      return await client.execute(statement)
    } catch (error) {
      if (error instanceof DbUnavailable) throw error
      const message = error instanceof Error ? error.message : String(error)
      if (/UNIQUE constraint failed/.test(message)) throw new UniqueViolation(message)
      throw new DbUnavailable('unreachable', error)
    }
  }

  /** Never throws. Used by /api/health. */
  async status(): Promise<DbStatus> {
    if (!this.config) return { configured: false, reachable: false, schema: false, problem: 'not_configured' }
    try {
      const client = await this.#connect()
      const version = await schemaVersion(client)
      const schema = version >= SCHEMA_VERSION
      if (schema) this.#schemaChecked = true
      return { configured: true, reachable: true, schema, problem: schema ? null : 'schema_missing' }
    } catch {
      return { configured: true, reachable: false, schema: false, problem: 'unreachable' }
    }
  }

  async listPlans(userId: string): Promise<Plan[]> {
    const result = await this.#execute({ sql: 'SELECT * FROM plans WHERE user_id = ? ORDER BY date, arrival_time, created_at', args: [userId] })
    return result.rows.map(toPlan)
  }

  /** Inserts only while the user has fewer than `maxPlans`; the count and the insert are one statement, so parallel requests cannot overshoot. */
  async createPlan(userId: string, input: { placeId: string; date: string; time: string }, maxPlans: number): Promise<Plan> {
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const result = await this.#execute({
      sql: `INSERT INTO plans (id, user_id, place_id, date, arrival_time, created_at, updated_at)
            SELECT ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM plans WHERE user_id = ?) < ?`,
      args: [id, userId, input.placeId, input.date, input.time, now, now, userId, maxPlans],
    })
    if (result.rowsAffected === 0) throw new PlanLimitReached()
    return { id, placeId: input.placeId, date: input.date, time: input.time, createdAt: now, updatedAt: now }
  }

  async updatePlan(userId: string, id: string, changes: { date?: string; time?: string }): Promise<Plan | null> {
    const result = await this.#execute({
      sql: `UPDATE plans SET date = COALESCE(?, date), arrival_time = COALESCE(?, arrival_time), updated_at = ?
            WHERE user_id = ? AND id = ? RETURNING *`,
      args: [changes.date ?? null, changes.time ?? null, new Date().toISOString(), userId, id],
    })
    return result.rows[0] ? toPlan(result.rows[0]) : null
  }

  async deletePlan(userId: string, id: string): Promise<boolean> {
    return (await this.#execute({ sql: 'DELETE FROM plans WHERE user_id = ? AND id = ?', args: [userId, id] })).rowsAffected > 0
  }

  async listFavorites(userId: string): Promise<Favorite[]> {
    const result = await this.#execute({ sql: 'SELECT place_id, created_at FROM favorites WHERE user_id = ? ORDER BY created_at, place_id', args: [userId] })
    return result.rows.map(toFavorite)
  }

  /** Idempotent: adding twice keeps one row and its first timestamp. */
  async addFavorite(userId: string, placeId: string): Promise<Favorite> {
    const result = await this.#execute({
      sql: `INSERT INTO favorites (user_id, place_id, created_at) VALUES (?, ?, ?)
            ON CONFLICT (user_id, place_id) DO UPDATE SET created_at = favorites.created_at
            RETURNING place_id, created_at`,
      args: [userId, placeId, new Date().toISOString()],
    })
    return toFavorite(result.rows[0])
  }

  /** Idempotent: removing something that is not there is fine. */
  async removeFavorite(userId: string, placeId: string): Promise<void> {
    await this.#execute({ sql: 'DELETE FROM favorites WHERE user_id = ? AND place_id = ?', args: [userId, placeId] })
  }

  /** Clears every plan and favorite (all visitors). Used by `npm run reset-demo`. */
  async resetUserData(): Promise<{ plans: number; favorites: number }> {
    const plans = (await this.#execute('DELETE FROM plans')).rowsAffected
    const favorites = (await this.#execute('DELETE FROM favorites')).rowsAffected
    return { plans, favorites }
  }

  async counts(): Promise<{ plans: number; favorites: number; visitors: number }> {
    const row = (
      await this.#execute(
        `SELECT (SELECT COUNT(*) FROM plans) AS plans, (SELECT COUNT(*) FROM favorites) AS favorites,
                (SELECT COUNT(*) FROM (SELECT user_id FROM plans UNION SELECT user_id FROM favorites)) AS visitors`,
      )
    ).rows[0]
    return { plans: Number(row.plans), favorites: Number(row.favorites), visitors: Number(row.visitors) }
  }

  /** Safe to call more than once. */
  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    const client = await this.#client?.catch(() => null)
    client?.close()
  }
}
