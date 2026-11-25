import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import type { Db } from '../db/index.js'
import { notFound } from '../errors.js'
import { getPlace } from '../places.js'
import { currentUserId } from '../user.js'
import type { WriteGuard } from './plans.js'

const params = z.object({ placeId: z.string().min(1).max(100) })

/** Favorites need no cap of their own: one row per known place, so at most 68 per visitor. */
export const favoriteRoutes: FastifyPluginAsync<{ db: Db; guardWrite: WriteGuard }> = async (app, { db, guardWrite }) => {
  app.get('/favorites', async (request) => ({ favorites: await db.listFavorites(currentUserId(request)) }))

  /** Idempotent: saving twice keeps one favorite. */
  app.put('/favorites/:placeId', async (request) => {
    const userId = currentUserId(request)
    guardWrite(request, userId)
    const { placeId } = params.parse(request.params)
    if (!getPlace(placeId)) throw notFound(`Place "${placeId}"`)
    return { favorite: await db.addFavorite(userId, placeId) }
  })

  /** Idempotent: removing a place that is not saved still succeeds. */
  app.delete('/favorites/:placeId', async (request, reply) => {
    const userId = currentUserId(request)
    guardWrite(request, userId)
    const { placeId } = params.parse(request.params)
    if (!getPlace(placeId)) throw notFound(`Place "${placeId}"`)
    await db.removeFavorite(userId, placeId)
    return reply.status(204).send()
  })
}
