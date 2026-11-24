import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError, api } from '../api/client'
import { Icon } from '../icons'
import type { AiSetupState } from './useAiStatus'

const KEY_PATTERN = /^sk-ant-[A-Za-z0-9_-]{20,}$/
const KEYS_URL = 'https://console.anthropic.com/settings/keys'

function messageFor(error: unknown): string {
  if (!(error instanceof ApiError)) return 'The key could not be saved. Please try again.'
  switch (error.code) {
    case 'SERVER_UNREACHABLE':
      return "The app's server isn't running, so the key can't be saved right now. This is a setup problem, not a problem with your key."
    case 'AI_KEY_REJECTED':
    case 'AI_KEY_FORMAT':
    case 'RATE_LIMITED':
      return error.message
    default:
      return 'The key could not be saved. Please try again.'
  }
}

/**
 * Shown every time someone uses the AI assistant while no API key has been added.
 * The wording makes clear this is a setup step, not a bug.
 */
export function AiKeyPrompt({
  state,
  onReady,
  onSkip,
}: {
  state: AiSetupState
  onReady: () => void
  onSkip: () => void
}) {
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const onSkipRef = useRef(onSkip)
  onSkipRef.current = onSkip
  const offline = state === 'server-offline'

  useEffect(() => {
    inputRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onSkipRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = key.trim()
    setError('')
    if (!trimmed) {
      setError('Paste your Anthropic API key first.')
      return
    }
    if (!KEY_PATTERN.test(trimmed)) {
      setError('That does not look like an Anthropic API key. Keys start with "sk-ant-".')
      return
    }
    setSaving(true)
    try {
      const result = await api.saveAiKey(trimmed)
      setKey('')
      if (!result.verified || !result.persisted) {
        setNotice(
          [
            !result.verified && "Saved. Anthropic couldn't be reached to double-check the key, so it will be checked on first use.",
            !result.persisted && 'The key is saved until the server restarts.',
          ]
            .filter(Boolean)
            .join(' '),
        )
        return
      }
      onReady()
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'AI_KEY_ALREADY_SET') {
        onReady()
        return
      }
      setError(messageFor(caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="confirmation-backdrop">
      <section className="schedule-card ai-key-card" role="dialog" aria-modal="true" aria-labelledby="ai-key-title" data-testid="ai-key-prompt">
        <div className="sheet-title">
          <div>
            <p className="eyebrow">SETUP NEEDED · NOT AN ERROR</p>
            <h2 id="ai-key-title">{offline ? 'AI server not running' : 'Add an API key to turn on AI'}</h2>
          </div>
          <button type="button" onClick={onSkip} aria-label="Close and use basic matching">
            <Icon name="close" />
          </button>
        </div>

        {offline ? (
          <p className="ai-key-copy">
            The AI assistant can't start because this app's server isn't running. Nothing you did caused this. Basic keyword
            matching still works in the meantime.
          </p>
        ) : (
          <>
            <p className="ai-key-copy">
              <strong>Nothing is broken.</strong> The AI assistant is switched off because no Anthropic API key has been added to
              this app yet. Until one is added, the assistant uses basic keyword matching, and this message appears each time
              someone uses it.
            </p>
            {notice ? (
              <div className="ai-key-notice" role="status">
                <Icon name="check" size={16} />
                <span>{notice}</span>
              </div>
            ) : (
              <form onSubmit={submit}>
                <label className="field">
                  <span>Anthropic API key</span>
                  <div>
                    <Icon name="spark" />
                    <input
                      ref={inputRef}
                      data-testid="ai-key-input"
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={key}
                      onChange={(event) => setKey(event.target.value)}
                      placeholder="sk-ant-…"
                      aria-invalid={Boolean(error)}
                      aria-describedby="ai-key-help"
                    />
                  </div>
                </label>
                {error && (
                  <p className="ai-key-error" role="alert" data-testid="ai-key-error">
                    {error}
                  </p>
                )}
                <p className="ai-key-help" id="ai-key-help">
                  Get a key at{' '}
                  <a href={KEYS_URL} target="_blank" rel="noreferrer">
                    console.anthropic.com
                  </a>
                  . It goes straight to this app's server and is stored there, never in your browser, and it is never shown again.
                </p>
                <button type="submit" className="continue-btn" disabled={saving} data-testid="ai-key-save">
                  {saving ? 'Checking key…' : 'Save key and turn on AI'}
                </button>
              </form>
            )}
          </>
        )}

        <button type="button" className="keep-browsing ai-key-skip" onClick={notice ? onReady : onSkip} data-testid="ai-key-skip">
          {notice ? 'Continue' : 'Not now, use basic matching'}
        </button>
      </section>
    </div>
  )
}
