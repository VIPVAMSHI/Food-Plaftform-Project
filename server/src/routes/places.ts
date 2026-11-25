import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { notFound } from '../errors.js'
import { getPlace, listPlaces } from '../places.js'

const querySchema = z.object({
  q: z.string().trim().max(100).optional(),
  neighborhood: z.string().trim().max(100).optional(),
  cuisine: z.string().trim().max(100).optional(),
  maxPrice: z.coerce.number().positive().max(10000).optional(),
})

const idParams = z.object({ id: z.string().min(1).max(100) })

/** Served from the bundled dataset, so these work even when the database is down. */
export const placeRoutes: FastifyPluginAsync = async (app) => {
  app.get('/places', async (request) => {
    const places = listPlaces(querySchema.parse(request.query))
    return { places, count: places.length }
  })

  app.get('/places/:id', async (request) => {
    const { id } = idParams.parse(request.params)
    const place = getPlace(id)
    if (!place) throw notFound(`Place "${id}"`)
    return { place }
  })
}
