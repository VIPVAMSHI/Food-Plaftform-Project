import type { AiStatus, ApiErrorBody, HealthResponse, SaveAiKeyResponse } from '../../shared/types'

/** Thrown for any failed API call. `code` matches the server's error codes, plus SERVER_UNREACHABLE. */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
  }
}

const SERVER_UNREACHABLE = "Can't reach the app server."

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      signal: init.signal ?? AbortSignal.timeout(15_000),
    })
  } catch {
    throw new ApiError('SERVER_UNREACHABLE', SERVER_UNREACHABLE, 0)
  }

  const body: unknown = await response.json().catch(() => null)
  if (response.ok) return body as T

  const error = (body as ApiErrorBody | null)?.error
  // A non-JSON 5xx comes from the dev proxy or the host when the API process is not running.
  if (!error && response.status >= 500) throw new ApiError('SERVER_UNREACHABLE', SERVER_UNREACHABLE, response.status)
  throw new ApiError(error?.code ?? `HTTP_${response.status}`, error?.message ?? `The server responded ${response.status}.`, response.status)
}

export const api = {
  health: () => request<HealthResponse>('/api/health'),
  getAiStatus: () => request<AiStatus>('/api/ai/status'),
  saveAiKey: (apiKey: string) =>
    request<SaveAiKeyResponse>('/api/ai/key', { method: 'POST', body: JSON.stringify({ apiKey }), signal: AbortSignal.timeout(20_000) }),
}
