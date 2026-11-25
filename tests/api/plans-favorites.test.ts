import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveDbConfig } from '../../server/src/db/config'
import { Db, UniqueViolation } from '../../server/src/db/index'
import { migrate } from '../../server/src/db/schema'
import { MAX_PLANS_PER_VISITOR } from '../../server/src/routes/plans'
import { OTHER_VISITOR, TODAY, VISITOR, as, makeApp, tempDir, type TestApp } from './helpers'

const open: TestApp[] = []
afterEach(async () => {
  while (open.length) await open.pop()!.app.close()
})
async function start(...args: Parameters<typeof makeApp>) {
  const created = await makeApp(...args)
  open.push(created)
  return created.app
}

type App = TestApp['app']
const createPlan = (app: App, payload: Record<string, unknown>, visitor = VISITOR) =>
  app.inject({ method: 'POST', url: '/api/plans', payload, headers: as(visitor) })
const get = (app: App, url: string, visitor = VISITOR) => app.inject({ url, headers: as(visitor) })
const send = (app: App, method: 'PATCH' | 'DELETE' | 'PUT', url: string, payload?: Record<string, unknown>, visitor = VISITOR) =>
  app.inject({ method, url, payload, headers: as(visitor) })

describe('plans', () => {
  it('creates, lists, edits and deletes a plan', async () => {
    const app = await start()
    const created = await createPlan(app, { placeId: 'wolf', date: '2026-12-03', time: '19:30' })
    expect(created.statusCode).toBe(201)
    const { plan } = created.json()
    expect(plan).toMatchObject({ placeId: 'wolf', date: '2026-12-03', time: '19:30' })

    const listed = (await get(app, '/api/plans')).json().plans
    expect(listed).toHaveLength(1)

    const edited = await send(app, 'PATCH', `/api/plans/${plan.id}`, { time: '18:00' })
    expect(edited.statusCode).toBe(200)
    expect(edited.json().plan).toMatchObject({ date: '2026-12-03', time: '18:00' })

    expect((await send(app, 'DELETE', `/api/plans/${plan.id}`)).statusCode).toBe(204)
    expect((await send(app, 'DELETE', `/api/plans/${plan.id}`)).statusCode).toBe(404)
    expect((await get(app, '/api/plans')).json().plans).toHaveLength(0)
  })

  it('validates input with clear 400s', async () => {
    const app = await start()
    const cases: Array<Record<string, unknown>> = [
      {},
      { placeId: 'wolf', date: '2027-02-29', time: '19:00' },
      { placeId: 'wolf', date: '12/03/2026', time: '19:00' },
      { placeId: 'wolf', date: '2026-12-03', time: '7pm' },
      { placeId: 'wolf', date: '2026-12-03', time: '24:00' },
      { placeId: 'wolf', date: '2026-12-03', time: '19:00', extra: true },
      { placeId: '', date: '2026-12-03', time: '19:00' },
    ]
    for (const payload of cases) {
      const res = await createPlan(app, payload)
      expect(res.statusCode, JSON.stringify(payload)).toBe(400)
      expect(res.json().error.code).toBe('BAD_REQUEST')
      expect(res.json().error.message).toMatch(/^Invalid /)
    }
    const plan = (await createPlan(app, { placeId: 'wolf', date: '2026-12-03', time: '19:00' })).json().plan
    expect((await send(app, 'PATCH', `/api/plans/${plan.id}`, {})).statusCode).toBe(400)
    expect((await send(app, 'PATCH', `/api/plans/${plan.id}`, { placeId: 'other' })).statusCode).toBe(400)
  })

  it('allows today and the leap day, refuses past dates (Seattle calendar)', async () => {
    const app = await start()
    expect((await createPlan(app, { placeId: 'wolf', date: TODAY, time: '19:00' })).statusCode).toBe(201)
    expect((await createPlan(app, { placeId: 'wolf', date: '2028-02-29', time: '19:00' })).statusCode).toBe(201)
    const past = await createPlan(app, { placeId: 'wolf', date: '2026-11-23', time: '19:00' })
    expect(past.statusCode).toBe(400)
    expect(past.json().error).toMatchObject({ code: 'PAST_DATE', message: 'Pick today or a later date.' })
  })

  it('404s unknown places and unknown plans', async () => {
    const app = await start()
    expect((await createPlan(app, { placeId: 'made-up', date: '2026-12-03', time: '19:00' })).statusCode).toBe(404)
    expect((await send(app, 'PATCH', '/api/plans/nope', { time: '18:00' })).statusCode).toBe(404)
  })

  it('409s a second plan for the same place and day, on create and on edit', async () => {
    const app = await start()
    await createPlan(app, { placeId: 'wolf', date: '2026-12-03', time: '19:00' })
    const dup = await createPlan(app, { placeId: 'wolf', date: '2026-12-03', time: '12:00' })
    expect(dup.statusCode).toBe(409)
    expect(dup.json().error.message).toBe('That restaurant is already planned for that day.')
    const other = (await createPlan(app, { placeId: 'wolf', date: '2026-12-04', time: '19:00' })).json().plan
    expect((await send(app, 'PATCH', `/api/plans/${other.id}`, { date: '2026-12-03' })).statusCode).toBe(409)
  })

  it('survives a server restart', async () => {
    const dir = tempDir()
    const first = await makeApp({ dir })
    await createPlan(first.app, { placeId: 'wolf', date: '2026-12-03', time: '19:30' })
    await send(first.app, 'PUT', '/api/favorites/canlis')
    await first.app.close()

    const second = await start({ dir })
    expect((await get(second, '/api/plans')).json().plans).toMatchObject([{ placeId: 'wolf', date: '2026-12-03', time: '19:30' }])
    expect((await get(second, '/api/favorites')).json().favorites).toMatchObject([{ placeId: 'canlis' }])
    expect((await second.inject('/api/health')).json().places).toBe(68)
  })

  it('keeps exactly one plan when 25 identical requests arrive at once', async () => {
    const app = await start()
    const results = await Promise.all(Array.from({ length: 25 }, () => createPlan(app, { placeId: 'wolf', date: '2026-12-05', time: '19:00' })))
    const codes = results.map((r) => r.statusCode).sort()
    expect(codes.filter((c) => c === 201)).toHaveLength(1)
    expect(codes.filter((c) => c === 409)).toHaveLength(24)
    expect((await get(app, '/api/plans')).json().plans).toHaveLength(1)
  })

  it('keeps all plans when 30 different requests arrive at once', async () => {
    const app = await start()
    const ids = (await app.inject('/api/places')).json().places.slice(0, 30).map((p: { id: string }) => p.id)
    const results = await Promise.all(ids.map((placeId: string) => createPlan(app, { placeId, date: '2026-12-06', time: '19:00' })))
    expect(results.every((r) => r.statusCode === 201)).toBe(true)
    expect((await get(app, '/api/plans')).json().plans).toHaveLength(30)
  })

  it('enforces uniqueness across two connections to the same database file', async () => {
    const config = resolveDbConfig({ DATABASE_URL: `file:${join(tempDir(), 'shared.db')}` })!
    const a = new Db(config)
    const b = new Db(config)
    await migrate(await a.client())
    await a.createPlan(VISITOR, { placeId: 'wolf', date: '2026-12-07', time: '19:00' }, 50)
    await expect(b.createPlan(VISITOR, { placeId: 'wolf', date: '2026-12-07', time: '20:00' }, 50)).rejects.toThrow(UniqueViolation)
    expect(await b.listPlans(VISITOR)).toHaveLength(1)
    await a.close()
    await b.close()
  })
})

describe('anonymous per-browser visitors', () => {
  it('keeps each visitor’s plans and favorites separate', async () => {
    const app = await start()
    await createPlan(app, { placeId: 'wolf', date: '2026-12-03', time: '19:30' }, VISITOR)
    await send(app, 'PUT', '/api/favorites/canlis', undefined, VISITOR)
    expect((await get(app, '/api/plans', OTHER_VISITOR)).json().plans).toEqual([])
    expect((await get(app, '/api/favorites', OTHER_VISITOR)).json().favorites).toEqual([])
    // The same place and day is free for someone else.
    expect((await createPlan(app, { placeId: 'wolf', date: '2026-12-03', time: '18:00' }, OTHER_VISITOR)).statusCode).toBe(201)

    const mine = (await get(app, '/api/plans', VISITOR)).json().plans
    expect(mine).toMatchObject([{ placeId: 'wolf', time: '19:30' }])
    // Another visitor cannot edit or delete my plan, even with its id.
    expect((await send(app, 'PATCH', `/api/plans/${mine[0].id}`, { time: '08:00' }, OTHER_VISITOR)).statusCode).toBe(404)
    expect((await send(app, 'DELETE', `/api/plans/${mine[0].id}`, undefined, OTHER_VISITOR)).statusCode).toBe(404)
    expect((await get(app, '/api/plans', VISITOR)).json().plans).toMatchObject([{ time: '19:30' }])
  })

  it('refuses plan and favorite requests without a valid id, and treats ids case-insensitively', async () => {
    const app = await start()
    const bad = [undefined, '', 'demo-user', 'not-a-uuid', `${VISITOR}x`, "' OR 1=1 --", '00000000-0000-0000-0000-000000000000']
    for (const id of bad) {
      const headers = id === undefined ? {} : { 'x-client-id': id }
      for (const res of [
        await app.inject({ url: '/api/plans', headers }),
        await app.inject({ url: '/api/favorites', headers }),
        await app.inject({ method: 'POST', url: '/api/plans', headers, payload: { placeId: 'wolf', date: '2026-12-03', time: '19:00' } }),
        await app.inject({ method: 'PUT', url: '/api/favorites/wolf', headers }),
      ]) {
        expect(res.statusCode, String(id)).toBe(400)
        expect(res.json().error.code).toBe('CLIENT_ID_REQUIRED')
      }
    }
    await createPlan(app, { placeId: 'wolf', date: '2026-12-03', time: '19:30' }, VISITOR.toUpperCase())
    expect((await get(app, '/api/plans', VISITOR)).json().plans).toHaveLength(1)
  })

  it(`caps plans at ${MAX_PLANS_PER_VISITOR} per visitor, also when requests race at the cap`, async () => {
    const app = await start({ writesPerMinute: 1000 })
    const places = (await app.inject('/api/places')).json().places.map((p: { id: string }) => p.id)
    for (let i = 0; i < MAX_PLANS_PER_VISITOR - 2; i++) {
      expect((await createPlan(app, { placeId: places[i], date: '2026-12-10', time: '19:00' })).statusCode).toBe(201)
    }
    const racing = await Promise.all(places.slice(48, 58).map((placeId: string) => createPlan(app, { placeId, date: '2026-12-10', time: '19:00' })))
    expect(racing.filter((r) => r.statusCode === 201)).toHaveLength(2)
    const refused = racing.filter((r) => r.statusCode === 409)
    expect(refused).toHaveLength(8)
    expect(refused[0].json().error.code).toBe('PLAN_LIMIT')
    expect((await get(app, '/api/plans')).json().plans).toHaveLength(MAX_PLANS_PER_VISITOR)
    // Someone else is not affected by my cap.
    expect((await createPlan(app, { placeId: 'wolf', date: '2026-12-10', time: '19:00' }, OTHER_VISITOR)).statusCode).toBe(201)
  })

  it('rate-limits changes per visitor with a friendly 429, and caps one IP at ten visitors’ worth', async () => {
    const app = await start({ writesPerMinute: 3 })
    for (let i = 0; i < 3; i++) expect((await send(app, 'PUT', '/api/favorites/wolf')).statusCode).toBe(200)
    const limited = await send(app, 'PUT', '/api/favorites/wolf')
    expect(limited.statusCode).toBe(429)
    expect(limited.json().error.code).toBe('RATE_LIMITED')
    // Reads are not limited, and someone else on the same network can still save.
    expect((await get(app, '/api/favorites')).statusCode).toBe(200)
    expect((await send(app, 'PUT', '/api/favorites/wolf', undefined, OTHER_VISITOR)).statusCode).toBe(200)

    const fresh = await start({ writesPerMinute: 3 })
    const visitors = Array.from({ length: 12 }, (_, i) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`)
    const statuses = []
    for (const visitor of visitors) for (let i = 0; i < 3; i++) statuses.push((await send(fresh, 'PUT', '/api/favorites/wolf', undefined, visitor)).statusCode)
    expect(statuses.filter((s) => s === 200)).toHaveLength(30)
    expect(statuses.filter((s) => s === 429)).toHaveLength(6)
  })

  it('reads WRITES_PER_MINUTE from the environment', async () => {
    const app = await start({ env: { WRITES_PER_MINUTE: '2' } })
    expect((await send(app, 'PUT', '/api/favorites/wolf')).statusCode).toBe(200)
    expect((await send(app, 'PUT', '/api/favorites/wolf')).statusCode).toBe(200)
    expect((await send(app, 'PUT', '/api/favorites/wolf')).statusCode).toBe(429)
  })
})

describe('when the database is unavailable', () => {
  it('plans and favorites answer a friendly 503 while places and the assistant keep working', async () => {
    const app = await start({ env: { DATABASE_URL: 'http://127.0.0.1:59999' }, migrateDb: false })
    for (const res of [await get(app, '/api/plans'), await get(app, '/api/favorites'), await createPlan(app, { placeId: 'wolf', date: '2026-12-03', time: '19:00' })]) {
      expect(res.statusCode).toBe(503)
      expect(res.json().error).toMatchObject({ code: 'DB_UNAVAILABLE', message: "Saved plans and favorites can't be reached right now. Try again in a moment." })
      expect(res.body).not.toContain('59999')
    }
    expect((await app.inject('/api/places')).json().count).toBe(68)
    const answer = await app.inject({ method: 'POST', url: '/api/assistant', payload: { message: 'cheap ramen near Capitol Hill', mode: 'walk' } })
    expect(answer.statusCode).toBe(200)
    expect(answer.json().rankedIds.length).toBeGreaterThan(0)
  })

  it('upgrades a database file from the previous release (node:sqlite schema, places table, demo-user rows)', async () => {
    const file = join(tempDir(), 'previous.db')
    const old = new DatabaseSync(file)
    old.exec(`CREATE TABLE places (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE plans (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, place_id TEXT NOT NULL REFERENCES places (id),
        date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        arrival_time TEXT NOT NULL CHECK (arrival_time GLOB '[0-2][0-9]:[0-5][0-9]'),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (user_id, place_id, date));
      CREATE INDEX plans_user_date ON plans (user_id, date);
      CREATE TABLE favorites (user_id TEXT NOT NULL, place_id TEXT NOT NULL REFERENCES places (id), created_at TEXT NOT NULL, PRIMARY KEY (user_id, place_id));
      PRAGMA user_version = 1;
      INSERT INTO places VALUES ('wolf', 'Wolf'), ('canlis', 'Canlis');
      INSERT INTO plans VALUES ('old-1', 'demo-user', 'wolf', '2026-12-01', '19:00', 'x', 'x');
      INSERT INTO favorites VALUES ('demo-user', 'canlis', 'x');`)
    old.close()

    const app = await start({ env: { DATABASE_URL: `file:${file}` } })
    expect((await app.inject('/api/health')).json()).toMatchObject({ status: 'ok', db: true })
    expect((await createPlan(app, { placeId: 'wolf', date: '2026-12-01', time: '19:00' })).statusCode).toBe(201)
    expect((await send(app, 'PUT', '/api/favorites/canlis')).statusCode).toBe(200)
    expect((await get(app, '/api/plans')).json().plans).toHaveLength(1)
    expect(await app.db.counts()).toEqual({ plans: 2, favorites: 2, visitors: 2 })
  })

  it('an unmigrated database is reported, not silently created', async () => {
    const app = await start({ migrateDb: false })
    const res = await get(app, '/api/plans')
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe('DB_UNAVAILABLE')
    const health = (await app.inject('/api/health')).json()
    expect(health).toMatchObject({ status: 'degraded', db: false, checks: { databaseUrl: true, databaseReachable: true, databaseSchema: false } })
    // After `npm run db:migrate`, the same running app recovers without a restart.
    await migrate(await app.db.client())
    expect((await get(app, '/api/plans')).statusCode).toBe(200)
  })
})

describe('favorites', () => {
  it('is idempotent both ways', async () => {
    const app = await start()
    for (let i = 0; i < 3; i++) expect((await send(app, 'PUT', '/api/favorites/canlis')).statusCode).toBe(200)
    expect((await get(app, '/api/favorites')).json().favorites).toHaveLength(1)
    for (let i = 0; i < 3; i++) expect((await send(app, 'DELETE', '/api/favorites/canlis')).statusCode).toBe(204)
    expect((await get(app, '/api/favorites')).json().favorites).toHaveLength(0)
  })

  it('handles rapid concurrent toggles without duplicates or errors', async () => {
    const app = await start()
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => send(app, i % 2 ? 'DELETE' : 'PUT', '/api/favorites/wolf')))
    expect(results.every((r) => r.statusCode === 200 || r.statusCode === 204)).toBe(true)
    expect((await get(app, '/api/favorites')).json().favorites.length).toBeLessThanOrEqual(1)
  })

  it('404s unknown places', async () => {
    const app = await start()
    expect((await send(app, 'PUT', '/api/favorites/made-up')).statusCode).toBe(404)
  })
})
