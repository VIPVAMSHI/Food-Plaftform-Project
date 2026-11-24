import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

/**
 * Holds the LLM API key on the server. The key can be set once from the app's setup prompt,
 * but it is never returned to any client.
 */
export class LlmKeyStore {
  #key: string | undefined

  constructor(
    initialKey: string | undefined,
    /** File the key is written to so it survives a restart. null keeps it in memory only. */
    private readonly envFilePath: string | null,
  ) {
    this.#key = initialKey
  }

  get configured(): boolean {
    return Boolean(this.#key)
  }

  get key(): string | undefined {
    return this.#key
  }

  /** Stores the key in memory and in the env file. Returns whether the file write succeeded. */
  save(key: string): { persisted: boolean } {
    this.#key = key
    if (!this.envFilePath) return { persisted: false }
    try {
      writeEnvValue(this.envFilePath, 'LLM_API_KEY', key)
      return { persisted: true }
    } catch {
      return { persisted: false }
    }
  }

  /** Forgets a key the provider rejected, so the app asks for a new one. */
  clear(): void {
    this.#key = undefined
    if (!this.envFilePath) return
    try {
      writeEnvValue(this.envFilePath, 'LLM_API_KEY', '')
    } catch {
      // The in-memory key is already cleared; a stale file value is rejected again on next use.
    }
  }
}

function writeEnvValue(path: string, name: string, value: string): void {
  const current = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const line = `${name}=${value}`
  const pattern = new RegExp(`^${name}=.*$`, 'm')
  const next = pattern.test(current)
    ? current.replace(pattern, () => line)
    : `${current}${current === '' || current.endsWith('\n') ? '' : '\n'}${line}\n`
  const temp = `${path}.tmp`
  writeFileSync(temp, next, { mode: 0o600 })
  renameSync(temp, path)
}
