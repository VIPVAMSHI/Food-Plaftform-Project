import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveDbConfig } from '../../server/src/db/config'
import { Db } from '../../server/src/db/index'
import { migrate } from '../../server/src/db/schema'
import { loadEnvLenient } from '../../server/src/env'
import { originalApiUrl } from '../../server/src/vercel'
import { VISITOR, tempDir } from './helpers'

describe('loadEnvLenient (the Vercel function never crashes on configuration)', () => {
  it('drops invalid values, names them, and never includes a value', () => {
    const { env, problems } = loadEnvLenient({ LOG_LEVEL: 'loud', LLM_API_KEY: 'short', DATABASE_URL: 'postgres://user:pw@host/db', NODE_ENV: 'production' })
    expect(problems.sort()).toEqual(['DATABASE_URL', 'LLM_API_KEY', 'LOG_LEVEL'])
    expect(env).toMatchObject({ LOG_LEVEL: 'info', NODE_ENV: 'production' })
    expect(env.LLM_API_KEY).toBeUndefined()
    expect(env.DATABASE_URL).toBeUndefined()
    expect(JSON.stringify(problems)).not.toMatch(/pw@host|short|loud/)
  })

  it('a key without a model turns the live model off instead of failing', () => {
    const { env, problems } = loadEnvLenient({ LLM_API_KEY: 'a-perfectly-fine-looking-key-123456' })
    expect(problems).toEqual(['LLM_MODEL'])
    expect(env.LLM_API_KEY).toBeUndefined()
  })

  it('accepts a valid configuration with no problems', () => {
    const { problems } = loadEnvLenient({ DATABASE_URL: 'libsql://db-org.turso.io', DATABASE_AUTH_TOKEN: 'token', LLM_API_KEY: 'a-perfectly-fine-looking-key-123456', LLM_MODEL: 'gemini-2.5-flash-lite' })
    expect(problems).toEqual([])
  })
})

describe('resolveDbConfig', () => {
  it('prefers DATABASE_URL, falls back to DB_PATH (render.yaml), then the local file; never guesses on Vercel', () => {
    expect(resolveDbConfig({ DATABASE_URL: 'libsql://db.turso.io', DATABASE_AUTH_TOKEN: 't', DB_PATH: '/x.db' })).toEqual({ url: 'libsql://db.turso.io', authToken: 't', local: false })
    expect(resolveDbConfig({ DB_PATH: '/var/data/bite.db' })).toEqual({ url: 'file:/var/data/bite.db', authToken: undefined, local: true })
    expect(resolveDbConfig({}, '/srv/app.db')).toMatchObject({ url: 'file:/srv/app.db', local: true })
    expect(resolveDbConfig({})).toBeNull()
    expect(resolveDbConfig({ DATABASE_URL: 'file:./data/x.db' })!.url).toMatch(/^file:\/.+\/server\/data\/x\.db$/)
  })
})

describe('originalApiUrl (Vercel may hand the function the rewritten /api?path= form)', () => {
  it.each([
    ['/api?path=plans', '/api/plans'],
    ['/api?path=places&q=ramen&neighborhood=Ballard', '/api/places?q=ramen&neighborhood=Ballard'],
    ['/api?path=favorites%2Fwolf', '/api/favorites/wolf'],
    ['/api?path=plans/abc-123', '/api/plans/abc-123'],
    ['/api/plans', '/api/plans'],
    ['/api/places?q=x', '/api/places?q=x'],
    ['/api', '/api'],
  ])('%s → %s', (input, expected) => {
    expect(originalApiUrl(input)).toBe(expected)
  })
})

describe('handleVercelRequest (the function entry, over real HTTP)', () => {
  let server: Server | undefined
  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
    server = undefined
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  async function serve(env: Record<string, string>) {
    vi.resetModules()
    for (const [key, value] of Object.entries({ DATABASE_URL: '', DB_PATH: '', LLM_API_KEY: '', LOG_LEVEL: 'silent', ...env })) vi.stubEnv(key, value)
    const { handleVercelRequest } = await import('../../server/src/vercel')
    server = createServer((req, res) => void handleVercelRequest(req, res))
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`
  }

  it('serves the API from a migrated database, in both URL forms, and scopes data by visitor', async () => {
    const url = `file:${join(tempDir(), 'vercel.db')}`
    const db = new Db(resolveDbConfig({ DATABASE_URL: url })!)
    await migrate(await db.client())
    await db.close()
    const base = await serve({ DATABASE_URL: url })

    const health = await (await fetch(`${base}/api/health`)).json()
    expect(health).toMatchObject({ status: 'ok', runtime: 'vercel', db: true, places: 68 })
    const created = await fetch(`${base}/api?path=plans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-client-id': VISITOR },
      body: JSON.stringify({ placeId: 'wolf', date: '2099-12-31', time: '19:00' }),
    })
    expect(created.status).toBe(201)
    expect((await (await fetch(`${base}/api/plans`, { headers: { 'x-client-id': VISITOR } })).json()).plans).toHaveLength(1)
    expect((await (await fetch(`${base}/api?path=places&neighborhood=Ballard`)).json()).count).toBeGreaterThan(0)
    const unknown = await fetch(`${base}/api/nothing-here`)
    expect(unknown.status).toBe(404)
    expect((await unknown.json()).error.code).toBe('NOT_FOUND')
  })

  it('without DATABASE_URL: health says what is missing, plans get a friendly 503, places and the assistant still work', async () => {
    const base = await serve({})
    const health = await fetch(`${base}/api/health`)
    expect(health.status).toBe(503)
    expect(await health.json()).toMatchObject({ status: 'degraded', db: false, checks: { databaseUrl: false, databaseReachable: false, llmApiKey: false } })
    const plans = await fetch(`${base}/api/plans`, { headers: { 'x-client-id': VISITOR } })
    expect(plans.status).toBe(503)
    expect((await plans.json()).error.code).toBe('DB_UNAVAILABLE')
    expect((await (await fetch(`${base}/api/places`)).json()).count).toBe(68)
    const answer = await fetch(`${base}/api/assistant`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'cheap ramen near Capitol Hill' }) })
    expect(answer.status).toBe(200)
    expect((await answer.json()).rankedIds.length).toBeGreaterThan(0)
  })

  it('refuses file: databases and DB_PATH on Vercel and names them in configProblems', async () => {
    const base = await serve({ VERCEL: '1', DATABASE_URL: `file:${join(tempDir(), 'x.db')}`, DB_PATH: '/tmp/y.db' })
    const health = await (await fetch(`${base}/api/health`)).json()
    expect(health).toMatchObject({ status: 'degraded', checks: { databaseUrl: false }, configProblems: ['DATABASE_URL', 'DB_PATH'] })
    expect(JSON.stringify(health)).not.toContain('x.db')
  })

  it('never offers the browser key prompt on Vercel, whatever AI_KEY_PROMPT says', async () => {
    const base = await serve({ AI_KEY_PROMPT: 'on' })
    expect((await (await fetch(`${base}/api/ai/status`)).json()).keyPromptEnabled).toBe(false)
    const res = await fetch(`${base}/api/ai/key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey: 'test-google-key-aaaaaaaaaaaaaaaaaaaa' }) })
    expect(res.status).toBe(404)
  })
})
