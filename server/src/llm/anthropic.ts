export const ANTHROPIC_KEY_PATTERN = /^sk-ant-[A-Za-z0-9_-]{20,}$/

export type KeyCheck = { ok: true } | { ok: false; reason: 'rejected' | 'unreachable' }

/**
 * Asks Anthropic whether a key is valid by listing models. This uses no tokens.
 */
export async function verifyAnthropicKey(apiKey: string, timeoutMs = 8000): Promise<KeyCheck> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
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
