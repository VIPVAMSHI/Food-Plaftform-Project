import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import type { AiStatus, SaveAiKeyResponse } from '../../../shared/types.js'
import type { Env } from '../env.js'
import { AppError } from '../errors.js'
import { ANTHROPIC_KEY_PATTERN, type KeyCheck } from '../llm/anthropic.js'
import type { LlmKeyStore } from '../llm/keyStore.js'

const saveKeyBody = z.object({ apiKey: z.string().trim().min(1, 'is empty').max(400, 'is too long') })

const ATTEMPT_WINDOW_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 10

export type AiRoutesOptions = {
  env: Env
  keyStore: LlmKeyStore
  verifyKey: (apiKey: string) => Promise<KeyCheck>
}

export const aiRoutes: FastifyPluginAsync<AiRoutesOptions> = async (app, { env, keyStore, verifyKey }) => {
  const attempts = new Map<string, number[]>()

  app.get('/ai/status', async (): Promise<AiStatus> => ({
    configured: keyStore.configured,
    provider: env.LLM_PROVIDER,
    model: env.LLM_MODEL,
  }))

  // TODO(auth): once real accounts exist, restrict this to an admin.
  app.post('/ai/key', async (request): Promise<SaveAiKeyResponse> => {
    const now = Date.now()
    const recent = (attempts.get(request.ip) ?? []).filter((time) => now - time < ATTEMPT_WINDOW_MS)
    if (recent.length >= MAX_ATTEMPTS) {
      throw new AppError('RATE_LIMITED', 429, 'Too many key attempts. Wait a few minutes and try again.')
    }
    attempts.set(request.ip, [...recent, now])

    // Once a key is set, nobody can replace it from the browser. Change it in server/.env instead.
    if (keyStore.configured) {
      throw new AppError('AI_KEY_ALREADY_SET', 409, 'An API key has already been added. AI is on.')
    }

    const { apiKey } = saveKeyBody.parse(request.body)
    if (!ANTHROPIC_KEY_PATTERN.test(apiKey)) {
      throw new AppError('AI_KEY_FORMAT', 400, 'That does not look like an Anthropic API key. Keys start with "sk-ant-".')
    }

    const check = await verifyKey(apiKey)
    if (!check.ok && check.reason === 'rejected') {
      throw new AppError('AI_KEY_REJECTED', 400, 'Anthropic did not accept that key. Check that you copied all of it, or create a new one.')
    }

    const { persisted } = keyStore.save(apiKey)
    request.log.info({ verified: check.ok, persisted }, 'LLM API key added')
    return { configured: true, verified: check.ok, persisted }
  })
}
