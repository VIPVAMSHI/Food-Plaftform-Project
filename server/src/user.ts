import type { FastifyRequest } from 'fastify'
import { AppError } from './errors.js'

/** Header the browser sends with its anonymous id (a random UUID kept in localStorage). */
export const CLIENT_ID_HEADER = 'x-client-id'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidClientId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

/**
 * The anonymous per-browser id. It only scopes plans and favorites so visitors do not see each other's data;
 * it proves nothing about who the visitor is, so it is never used for anything else.
 */
// TODO(auth): replace with the signed-in user's id from the session once real accounts exist.
export function currentUserId(request: FastifyRequest): string {
  const value = request.headers[CLIENT_ID_HEADER]
  if (!isValidClientId(value)) {
    throw new AppError('CLIENT_ID_REQUIRED', 400, 'This request needs the anonymous browser id. Reload the page and try again.')
  }
  return value.toLowerCase()
}
