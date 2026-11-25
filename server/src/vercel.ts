import type { IncomingMessage, ServerResponse } from 'node:http'
import { buildApp, type App } from './app.js'
import { loadEnvLenient } from './env.js'

let instance: Promise<App> | null = null

/**
 * One Fastify app per function instance, built on the first request (not at import time) from the environment then.
 * Vercel env values are fixed for a deployment, so later requests would read the same values.
 * Invalid values never crash the function: they are dropped and named in /api/health.
 */
function getApp(): Promise<App> {
  instance ??= (async () => {
    const { env, problems } = loadEnvLenient(process.env)
    // On Vercel (VERCEL=1) a file database would live on one instance's temporary disk, and its native driver is not bundled.
    const onVercel = process.env.VERCEL === '1'
    const fileUrl = onVercel && Boolean(env.DATABASE_URL?.startsWith('file:'))
    if (fileUrl) problems.push('DATABASE_URL')
    if (onVercel && env.DB_PATH) problems.push('DB_PATH')
    const database = { DATABASE_URL: fileUrl ? undefined : env.DATABASE_URL, DB_PATH: onVercel ? undefined : env.DB_PATH }
    // The setup prompt writes a key from the browser: never on a public URL. Production mode for proxy trust and plain logs.
    const app = await buildApp({ ...env, ...database, NODE_ENV: 'production', AI_KEY_PROMPT: false }, { runtime: 'vercel', configProblems: problems })
    await app.ready()
    return app
  })().catch((error: unknown) => {
    instance = null
    throw error
  })
  return instance
}

/**
 * vercel.json rewrites `/api/:path*` to this function, which Vercel compiles to `/api?path=<rest>`.
 * If the function sees that form instead of the original URL, rebuild `/api/<rest>?<other params>` so Fastify routes it.
 */
export function originalApiUrl(url: string): string {
  const parsed = new URL(url, 'http://function.local')
  const rest = parsed.searchParams.get('path')
  if (parsed.pathname !== '/api' || rest === null) return url
  parsed.searchParams.delete('path')
  const query = parsed.searchParams.toString()
  return `/api/${rest.replace(/^\/+/, '')}${query ? `?${query}` : ''}`
}

/** Vercel Node.js function handler: hands the request to Fastify and resolves once the response is sent. */
export async function handleVercelRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.url) req.url = originalApiUrl(req.url)
  let app: App
  try {
    app = await getApp()
  } catch (error) {
    console.error('API failed to start:', error instanceof Error ? error.message : String(error))
    res.statusCode = 500
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: { code: 'INTERNAL', message: 'The server could not start. Try again in a moment.', requestId: '' } }))
    return
  }
  await new Promise<void>((resolve) => {
    res.once('finish', resolve)
    res.once('close', resolve)
    app.server.emit('request', req, res)
  })
}
