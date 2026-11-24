import { LlmError, type LlmProvider, type LlmRequest, type LlmResult } from '../assistant/provider.js'
import type { LlmKeyStore } from './keyStore.js'

export const ANTHROPIC_KEY_PATTERN = /^sk-ant-[A-Za-z0-9_-]{20,}$/
export const ANTHROPIC_API_URL = 'https://api.anthropic.com'
const ANTHROPIC_VERSION = '2023-06-01'

export type KeyCheck = { ok: true } | { ok: false; reason: 'rejected' | 'unreachable' }

/**
 * Asks Anthropic whether a key is valid by listing models. This uses no tokens.
 */
export async function verifyAnthropicKey(apiKey: string, timeoutMs = 8000): Promise<KeyCheck> {
  try {
    const response = await fetch(`${ANTHROPIC_API_URL}/v1/models?limit=1`, {
      headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
      signal: AbortSignal.timeout(timeoutMs),
    })
    // 429 means Anthropic recognized the key and is only rate limiting it.
    if (response.ok || response.status === 429) return { ok: true }
    if (response.status === 401 || response.status === 403) return { ok: false, reason: 'rejected' }
    return { ok: false, reason: 'unreachable' }
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
}

type MessagesResponse = {
  content?: Array<{ type: string; text?: string }>
  usage?: { input_tokens?: number; output_tokens?: number }
}

/** Anthropic Messages API. The key is read from the key store on every call and only ever sent to Anthropic. */
export function anthropicProvider(keyStore: LlmKeyStore, model: string | undefined, baseUrl = ANTHROPIC_API_URL): LlmProvider {
  return {
    name: 'anthropic',
    get ready() {
      return keyStore.configured && Boolean(model)
    },
    async complete({ system, user, maxTokens, signal }: LlmRequest): Promise<LlmResult> {
      const key = keyStore.key
      if (!key || !model) throw new LlmError('not_configured')
      let response: Response
      try {
        response = await fetch(`${baseUrl}/v1/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION },
          body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0.2, system, messages: [{ role: 'user', content: user }] }),
          signal,
        })
      } catch (error) {
        if (signal.aborted || (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))) throw new LlmError('timeout')
        throw new LlmError('network')
      }
      if (response.status === 401 || response.status === 403) {
        keyStore.markRejected()
        throw new LlmError('auth', response.status)
      }
      if (response.status === 429) throw new LlmError('rate_limited', 429)
      if (response.status >= 500) throw new LlmError('server', response.status)
      if (!response.ok) throw new LlmError('bad_response', response.status)
      let body: MessagesResponse
      try {
        body = (await response.json()) as MessagesResponse
      } catch {
        throw new LlmError(signal.aborted ? 'timeout' : 'bad_response', response.status)
      }
      const text = (body.content ?? []).filter((part) => part.type === 'text').map((part) => part.text ?? '').join('')
      return { text, inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0 }
    },
  }
}
