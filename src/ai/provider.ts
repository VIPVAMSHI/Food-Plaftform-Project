import { localAssistant } from './local'
import type { AssistantRequest, AssistantResponse } from './types'

/**
 * Online assistant endpoint. Leave unset to stay on the local fallback.
 * This module never reads an API key and never calls a paid model directly.
 */
export const ASSISTANT_URL_ENV = 'VITE_FOOD_ASSISTANT_URL'

export async function askFoodAssistant(request: AssistantRequest): Promise<AssistantResponse> {
  const endpoint = import.meta.env.VITE_FOOD_ASSISTANT_URL?.trim()
  if (!endpoint) return localAssistant(request)

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(request),
    })
    if (!response.ok) throw new Error(`Assistant responded ${response.status}`)
    const payload: unknown = await response.json()
    const parsed = normalizeRemote(payload, request)
    return parsed
  } catch {
    const fallback = localAssistant(request)
    return {
      ...fallback,
      error: 'The online assistant did not respond. These matches are from the on-device fallback.',
    }
  }
}

function normalizeRemote(payload: unknown, request: AssistantRequest): AssistantResponse {
  if (!payload || typeof payload !== 'object') throw new Error('Assistant payload was empty')
  const body = payload as Record<string, unknown>
  if (typeof body.reply !== 'string' || !Array.isArray(body.rankedIds)) {
    throw new Error('Assistant payload was missing reply or rankedIds')
  }
  const known = new Set(request.places.map((place) => place.id))
  const rankedIds = body.rankedIds.filter((id): id is string => typeof id === 'string' && known.has(id)).slice(0, 3)
  const reasons: Record<string, string> = {}
  if (body.reasons && typeof body.reasons === 'object') {
    for (const [id, reason] of Object.entries(body.reasons as Record<string, unknown>)) {
      if (known.has(id) && typeof reason === 'string') reasons[id] = reason
    }
  }
  const neighborhoods = new Set(request.places.map((place) => place.neighborhood))
  const neighborhood = typeof body.neighborhood === 'string' && neighborhoods.has(body.neighborhood) ? body.neighborhood : null
  return {
    reply: body.reply,
    preference: typeof body.preference === 'string' ? body.preference : null,
    neighborhood,
    maxTravelMinutes: typeof body.maxTravelMinutes === 'number' ? body.maxTravelMinutes : null,
    maxBudget: typeof body.maxBudget === 'number' ? body.maxBudget : null,
    rankedIds,
    reasons,
    source: 'remote',
  }
}
