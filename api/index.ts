// The whole API as one Vercel Function. vercel.json rewrites /api/* here; the Fastify app routes by the original path.
import { handleVercelRequest } from '../server/src/vercel.js'

export default handleVercelRequest
