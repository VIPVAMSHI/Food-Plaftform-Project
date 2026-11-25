/**
 * Anonymous per-browser id. Plans and favorites on the server are stored under it, so each browser sees only its own.
 * It is not a login: clearing site data starts a fresh, empty profile.
 */
// TODO(auth): replace with the signed-in account once real accounts exist.
export const CLIENT_ID_KEY = 'sfd-client-id'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Random v4 UUID. `crypto.randomUUID` needs Safari 15.4+, so older phones build one from getRandomValues. */
function newUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

let memoryId: string | null = null

/** The stored id, created on first use. If storage is blocked (some private modes), the id lasts for this page load. */
export function getClientId(): string {
  try {
    const stored = localStorage.getItem(CLIENT_ID_KEY)
    if (stored && UUID.test(stored)) return stored
    const id = memoryId ?? newUuid()
    localStorage.setItem(CLIENT_ID_KEY, id)
    memoryId = id
    return id
  } catch {
    memoryId ??= newUuid()
    return memoryId
  }
}
