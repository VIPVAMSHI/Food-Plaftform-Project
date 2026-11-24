import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import Fastify, { LogController, type FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import type { Env } from './env.js'
import { errorHandler, sendError } from './errors.js'
import { verifyAnthropicKey, type KeyCheck } from './llm/anthropic.js'
import { LlmKeyStore } from './llm/keyStore.js'
import { aiRoutes } from './routes/ai.js'
import { healthRoutes } from './routes/health.js'

/** Fastify's default log controller writes two extra lines per request. We only want our single summary line. */
class QuietLogController extends LogController {
  override isLogDisabled(): boolean {
    return true
  }
}

/** The Vite build output. In production the API server also serves the front end from here. */
export const DIST_DIR = resolve(import.meta.dirname, '../../dist')

/** server/.env, where a key added from the app's setup prompt is saved. */
export const ENV_FILE = resolve(import.meta.dirname, '../.env')

export type BuildOptions = {
  distDir?: string
  keyStore?: LlmKeyStore
  verifyKey?: (apiKey: string) => Promise<KeyCheck>
}

/**
 * Builds the Fastify app without starting it. Tests can build it and call it directly.
 */
export async function buildApp(env: Env, options: BuildOptions = {}): Promise<FastifyInstance> {
  const keyStore = options.keyStore ?? new LlmKeyStore(env.LLM_API_KEY, ENV_FILE)
  const verifyKey = options.verifyKey ?? verifyAnthropicKey

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Pretty logs while developing; plain JSON in production.
      transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } : undefined,
      // Never log request bodies, so user messages stay out of logs.
      serializers: {
        req: (request) => ({ method: request.method, url: request.url, requestId: request.id }),
      },
    },
    genReqId: () => crypto.randomUUID(),
    bodyLimit: 64 * 1024,
    // Turn off Fastify's built-in per-request lines; we log one summary line per request (see onResponse below).
    logController: new QuietLogController(),
  })

  // Log one line per finished request: method, path, status, and duration.
  app.addHook('onResponse', async (request, reply) => {
    request.log.info({ statusCode: reply.statusCode, responseTimeMs: Math.round(reply.elapsedTime) }, `${request.method} ${request.url}`)
  })

  app.setErrorHandler(errorHandler)

  await app.register(healthRoutes, { prefix: '/api', keyStore })
  await app.register(aiRoutes, { prefix: '/api', env, keyStore, verifyKey })

  const distDir = options.distDir ?? DIST_DIR
  const serveFrontEnd = existsSync(resolve(distDir, 'index.html'))
  if (serveFrontEnd) {
    await app.register(fastifyStatic, {
      root: distDir,
      wildcard: false,
      setHeaders: (reply, filePath) => {
        // Hashed assets never change; index.html must always be re-fetched so a redeploy shows up immediately.
        reply.header('Cache-Control', filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable')
      },
    })
  } else {
    app.log.info('No dist/ build found. Serving the API only (run `npm run build` at the repo root to serve the app too).')
  }

  app.setNotFoundHandler((request, reply) => {
    const isApi = request.url === '/api' || request.url.startsWith('/api/')
    if (!isApi && serveFrontEnd && (request.method === 'GET' || request.method === 'HEAD')) {
      return reply.type('text/html').header('Cache-Control', 'no-cache').sendFile('index.html')
    }
    return sendError(reply, request, 'NOT_FOUND', 404, `No route for ${request.method} ${request.url}.`)
  })

  return app
}
