import { buildApp } from './app.js'
import { EnvError, loadEnv } from './env.js'

const SHUTDOWN_TIMEOUT_MS = 10_000

async function main() {
  let env
  try {
    env = loadEnv()
  } catch (error) {
    if (error instanceof EnvError) {
      console.error(`\n${error.message}\n`)
      process.exit(1)
    }
    throw error
  }

  const app = await buildApp(env)

  if (!env.LLM_API_KEY) {
    app.log.warn('LLM_API_KEY is not set. The assistant will answer from the demo cache and the local matcher.')
  }

  await app.listen({ port: env.PORT, host: env.HOST })

  let shuttingDown = false
  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    app.log.info(`${signal} received, finishing open requests and shutting down.`)
    const force = setTimeout(() => {
      app.log.error('Shutdown took too long, exiting anyway.')
      process.exit(1)
    }, SHUTDOWN_TIMEOUT_MS)
    force.unref()
    try {
      await app.close()
      process.exit(0)
    } catch (error) {
      app.log.error({ err: error }, 'Error during shutdown')
      process.exit(1)
    }
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((error) => {
  console.error('Server failed to start:', error)
  process.exit(1)
})
