/**
 * Types shared by the front end (src/) and the API server (server/).
 * Change them here only, so the two sides cannot drift apart.
 */

export type MealMoment = 'breakfast' | 'lunch' | 'dinner'
export type TravelMode = 'walk' | 'bike' | 'car'

export type AssistantPlace = {
  id: string
  name: string
  cuisine: string
  neighborhood: string
  address: string
  street: string
  price: string
  serving: number
  rating: number | null
  travelMinutes: number
  waitMinutes: number
  note: string
  dishes: string[]
}

export type AssistantRequest = {
  message: string
  location: string
  neighborhood: string | null
  mode: TravelMode
  budget: number | null
  mealMoment: MealMoment
  places: AssistantPlace[]
}

export type AssistantResponse = {
  reply: string
  preference: string | null
  neighborhood: string | null
  maxTravelMinutes: number | null
  maxBudget: number | null
  rankedIds: string[]
  reasons: Record<string, string>
  source: 'local' | 'remote'
  error?: string
}

export type HealthResponse = {
  status: 'ok'
  version: string
  llmConfigured: boolean
  uptimeSeconds: number
  time: string
}

/** Whether the live AI assistant has an API key. The key itself is never sent to the browser. */
export type AiStatus = {
  configured: boolean
  provider: 'anthropic'
  model: string
}

export type SaveAiKeyResponse = {
  configured: true
  /** False when Anthropic could not be reached to check the key; it was saved anyway. */
  verified: boolean
  /** False when the key could not be written to server/.env and only lasts until restart. */
  persisted: boolean
}

export type ApiErrorBody = {
  error: { code: string; message: string; requestId: string }
}
