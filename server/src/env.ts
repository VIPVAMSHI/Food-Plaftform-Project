import { z } from 'zod'

const optionalSecret = z
  .string()
  .trim()
  .transform((value) => (value === '' ? undefined : value))
  .optional()
  .refine((value) => value === undefined || (value.length >= 20 && !/\s/.test(value)), {
    message: 'looks malformed (too short or contains spaces). Paste the full key, or leave it empty to run without the live assistant.',
  })

/**
 * All server configuration comes from environment variables.
 * Parsed once at startup. If something is wrong, the server exits with a readable message.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().min(1).optional(),
  DATABASE_PATH: z.string().min(1).default('./data/bite.db'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LLM_PROVIDER: z.enum(['anthropic']).default('anthropic'),
  LLM_MODEL: z.string().trim().min(1).default('claude-haiku-4-5'),
  LLM_API_KEY: optionalSecret,
})

export type Env = z.infer<typeof envSchema> & { HOST: string }

export class EnvError extends Error {}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source)
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    throw new EnvError(`Invalid server configuration. Check server/.env (see server/.env.example):\n${lines.join('\n')}`)
  }
  const env = result.data
  // Hosting platforms route traffic to 0.0.0.0. Locally we stay on loopback so the API is not exposed to the network.
  return { ...env, HOST: env.HOST ?? (env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1') }
}
