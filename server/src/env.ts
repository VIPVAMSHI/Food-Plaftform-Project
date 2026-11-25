import { z } from 'zod'

const optionalSecret = z
  .string()
  .trim()
  .transform((value) => (value === '' ? undefined : value))
  .optional()
  .refine((value) => value === undefined || (value.length >= 20 && !/\s/.test(value)), {
    message: 'looks malformed (too short or contains spaces). Paste the full key, or leave it empty to run without the live assistant.',
  })

const optionalText = z
  .string()
  .trim()
  .transform((value) => (value === '' ? undefined : value))
  .optional()

const flag = z
  .string()
  .trim()
  .toLowerCase()
  .optional()
  .transform((value) => (value === undefined || value === '' ? undefined : ['1', 'true', 'on', 'yes'].includes(value)))

/**
 * All server configuration comes from environment variables.
 * The local server parses them once at startup and exits with a readable message if something is wrong.
 * The Vercel function uses `loadEnvLenient`, which never throws and reports problems in /api/health.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().min(0).max(65535).default(3001),
    HOST: z.string().min(1).optional(),
    /** libSQL URL: `file:./data/bite.db` locally (relative to server/), `libsql://<db>-<org>.turso.io` for Turso. */
    DATABASE_URL: optionalText.refine((value) => value === undefined || /^(file:|libsql:\/\/|https?:\/\/|wss?:\/\/)/i.test(value), {
      message: 'must start with file:, libsql://, https:// or wss://',
    }),
    /** Turso auth token. Not needed for file: databases. */
    DATABASE_AUTH_TOKEN: optionalText,
    /** Earlier SQLite file setting (render.yaml still uses it). Used only when DATABASE_URL is empty. */
    DB_PATH: optionalText,
    /** Local server only: file that keeps live-model answers across restarts. Unset on Vercel (read-only disk). */
    CACHE_PATH: optionalText,
    /** Plan and favorite changes per visitor per minute; each IP gets ten times this. */
    WRITES_PER_MINUTE: z.coerce.number().int().min(1).max(100_000).default(60),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    LLM_PROVIDER: z.enum(['google']).default('google'),
    LLM_MODEL: optionalText,
    LLM_API_KEY: optionalSecret,
    /** Show the assistant's answer source (llm / cache / local) in the UI. */
    DEMO_DEBUG: flag,
    /** Show the in-app "add an API key" prompt. Defaults to on in development, off in production. */
    AI_KEY_PROMPT: flag,
    /** Origin allowed by CORS in development (Vite dev server). Never used in production. */
    DEV_ORIGIN: z.string().default('http://localhost:5173'),
  })
  .superRefine((env, ctx) => {
    if (env.LLM_API_KEY && !env.LLM_MODEL) {
      ctx.addIssue({ code: 'custom', path: ['LLM_MODEL'], message: 'is required when LLM_API_KEY is set (for example gemini-2.5-flash-lite)' })
    }
  })

export type Env = Omit<z.infer<typeof envSchema>, 'HOST' | 'DEMO_DEBUG' | 'AI_KEY_PROMPT'> & {
  HOST: string
  DEMO_DEBUG: boolean
  AI_KEY_PROMPT: boolean
}

export class EnvError extends Error {}

function finish(env: z.infer<typeof envSchema>): Env {
  const production = env.NODE_ENV === 'production'
  return {
    ...env,
    // Hosting platforms route traffic to 0.0.0.0. Locally we stay on loopback so the API is not exposed to the network.
    HOST: env.HOST ?? (production ? '0.0.0.0' : '127.0.0.1'),
    DEMO_DEBUG: env.DEMO_DEBUG ?? false,
    AI_KEY_PROMPT: env.AI_KEY_PROMPT ?? !production,
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source)
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    throw new EnvError(`Invalid server configuration. Check server/.env (see server/.env.example):\n${lines.join('\n')}`)
  }
  return finish(result.data)
}

/**
 * Never throws. Each invalid variable is dropped (its default applies) and its name is reported.
 * A key without a model disables the live model instead of failing. Values are never included.
 */
export function loadEnvLenient(source: NodeJS.ProcessEnv = process.env): { env: Env; problems: string[] } {
  const working: Record<string, string | undefined> = { ...source }
  const problems = new Set<string>()
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = envSchema.safeParse(working)
    if (result.success) return { env: finish(result.data), problems: [...problems] }
    for (const issue of result.error.issues) {
      const name = String(issue.path[0] ?? '')
      problems.add(name || '(unknown)')
      if (name === 'LLM_MODEL') delete working.LLM_API_KEY
      if (name) delete working[name]
    }
  }
  return { env: finish(envSchema.parse({})), problems: [...problems] }
}
