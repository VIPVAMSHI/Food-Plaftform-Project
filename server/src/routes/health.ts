import type { FastifyPluginAsync } from 'fastify'
import type { HealthResponse } from '../../../shared/types.js'
import type { LlmKeyStore } from '../llm/keyStore.js'
import { APP_VERSION } from '../version.js'

export const healthRoutes: FastifyPluginAsync<{ keyStore: LlmKeyStore }> = async (app, { keyStore }) => {
  app.get('/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    version: APP_VERSION,
    // Boolean only. The key itself is never sent to the client.
    llmConfigured: keyStore.configured,
    uptimeSeconds: Math.round(process.uptime()),
    time: new Date().toISOString(),
  }))
}
