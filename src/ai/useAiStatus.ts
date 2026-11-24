import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'

/**
 * checking: first status request still in flight.
 * ready: the server has an API key.
 * missing-key: the server is up but nobody has added a key yet.
 * server-offline: the app server could not be reached.
 */
export type AiSetupState = 'checking' | 'ready' | 'missing-key' | 'server-offline'

/** Tracks whether the live AI assistant is set up. `refresh` re-asks the server, so a key added by anyone is picked up. */
export function useAiStatus() {
  const [state, setState] = useState<AiSetupState>('checking')

  const refresh = useCallback(async (): Promise<AiSetupState> => {
    let next: AiSetupState
    try {
      next = (await api.getAiStatus()).configured ? 'ready' : 'missing-key'
    } catch {
      next = 'server-offline'
    }
    setState(next)
    return next
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { state, refresh, markReady: useCallback(() => setState('ready'), []) }
}
