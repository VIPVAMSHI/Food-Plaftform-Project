import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { isValidDateString, isValidTimeString, seattleToday } from '../../../shared/dates.js'
import { PlanLimitReached, UniqueViolation, type Db } from '../db/index.js'
import { AppError, notFound } from '../errors.js'
import { getPlace } from '../places.js'
import type { RateLimiter } from '../rateLimit.js'
import { currentUserId } from '../user.js'

/** One visitor cannot fill the database: plenty for a real person, small for a script. */
export const MAX_PLANS_PER_VISITOR = 50

const date = z.string().refine(isValidDateString, 'must be a real date in YYYY-MM-DD form')
const time = z.string().refine(isValidTimeString, 'must be a time in HH:MM (24-hour) form')

const createBody = z.object({ placeId: z.string().min(1).max(100), date, time }).strict()
const updateBody = z
  .object({ date: date.optional(), time: time.optional() })
  .strict()
  .refine((body) => body.date !== undefined || body.time !== undefined, 'send a date, a time, or both')
const idParams = z.object({ id: z.string().min(1).max(100) })

/** Plans are for today or later, in Seattle. Existing past plans can still be read and deleted. */
function assertNotPast(value: string, now: () => Date) {
  if (value < seattleToday(now())) throw new AppError('PAST_DATE', 400, 'Pick today or a later date.')
}

const DUPLICATE = 'That restaurant is already planned for that day.'

export type WriteGuard = (request: FastifyRequest, userId: string) => void

/**
 * Writes per visitor per minute, plus a looser per-IP ceiling: a room on one Wi-Fi shares an IP, while a script
 * inventing new visitor ids is still bounded. In memory, so per server instance: approximate on Vercel.
 */
export function writeGuard(perVisitor: RateLimiter, perIp: RateLimiter): WriteGuard {
  return (request, userId) => {
    if (!perVisitor.allow(`${request.ip}|${userId}`) || !perIp.allow(request.ip)) {
      throw new AppError('RATE_LIMITED', 429, 'Too many changes at once. Wait a moment and try again.')
    }
  }
}

export const planRoutes: FastifyPluginAsync<{ db: Db; now?: () => Date; guardWrite: WriteGuard }> = async (app, { db, now = () => new Date(), guardWrite }) => {
  app.get('/plans', async (request) => ({ plans: await db.listPlans(currentUserId(request)) }))

  app.post('/plans', async (request, reply) => {
    const userId = currentUserId(request)
    guardWrite(request, userId)
    const body = createBody.parse(request.body)
    assertNotPast(body.date, now)
    if (!getPlace(body.placeId)) throw notFound(`Place "${body.placeId}"`)
    try {
      const plan = await db.createPlan(userId, body, MAX_PLANS_PER_VISITOR)
      return reply.status(201).send({ plan })
    } catch (error) {
      if (error instanceof UniqueViolation) throw new AppError('CONFLICT', 409, DUPLICATE)
      if (error instanceof PlanLimitReached) {
        throw new AppError('PLAN_LIMIT', 409, `You can keep up to ${MAX_PLANS_PER_VISITOR} plans. Remove an old one to add another.`)
      }
      throw error
    }
  })

  app.patch('/plans/:id', async (request) => {
    const userId = currentUserId(request)
    guardWrite(request, userId)
    const { id } = idParams.parse(request.params)
    const body = updateBody.parse(request.body)
    if (body.date) assertNotPast(body.date, now)
    try {
      const plan = await db.updatePlan(userId, id, body)
      if (!plan) throw notFound('Plan')
      return { plan }
    } catch (error) {
      if (error instanceof UniqueViolation) throw new AppError('CONFLICT', 409, DUPLICATE)
      throw error
    }
  })

  app.delete('/plans/:id', async (request, reply) => {
    const userId = currentUserId(request)
    guardWrite(request, userId)
    const { id } = idParams.parse(request.params)
    if (!(await db.deletePlan(userId, id))) throw notFound('Plan')
    return reply.status(204).send()
  })
}
