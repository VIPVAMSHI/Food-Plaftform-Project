import type { FastifyPluginAsync } from 'fastify'
import type { HealthResponse } from '../../../shared/types.js'
import type { LlmProvider } from '../assistant/provider.js'
import type { Db } from '../db/index.js'
import { PLACE_COUNT } from '../places.js'
import { APP_VERSION } from '../version.js'

export type HealthOptions = {
  db: Db
  provider: LlmProvider
  runtime: HealthResponse['runtime']
  llmKeyPresent: () => boolean
  llmModelPresent: boolean
  configProblems: string[]
}

export const healthRoutes: FastifyPluginAsync<HealthOptions> = async (app, options) => {
  app.get('/health', async (_request, reply): Promise<HealthResponse> => {
    const { db, provider } = options
    const database = await db.status()
    const healthy = database.reachable && database.schema
    reply.header('Cache-Control', 'no-store')
    if (!healthy) reply.status(503)
    return {
      status: healthy ? 'ok' : 'degraded',
      version: APP_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      places: PLACE_COUNT,
      db: healthy,
      llmConfigured: provider.ready,
      time: new Date().toISOString(),
      runtime: options.runtime,
      checks: {
        databaseUrl: database.configured,
        databaseAuthToken: Boolean(db.config && (db.config.local || db.config.authToken)),
        databaseReachable: database.reachable,
        databaseSchema: database.schema,
        llmApiKey: options.llmKeyPresent(),
        llmModel: options.llmModelPresent,
      },
      configProblems: options.configProblems,
    }
  })
}
