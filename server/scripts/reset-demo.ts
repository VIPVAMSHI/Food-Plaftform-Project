import { describe, openTarget } from './db-target.js'

/**
 * Clears every plan and favorite (all visitors) so the demo starts from a known state.
 * A local file database resets right away. A remote database (production) needs an explicit flag:
 *   npm run reset-demo -- --production
 * The assistant cache is not touched.
 */
const { db, config } = openTarget()
if (!config.local && !process.argv.includes('--production')) {
  console.error(
    `Refusing to reset ${describe(config)}: it is a remote database, probably production.\n` +
      'This deletes every visitor\'s plans and favorites. If you mean it, run: npm run reset-demo -- --production',
  )
  process.exit(1)
}
try {
  const removed = await db.resetUserData()
  const counts = await db.counts()
  console.log(`Reset ${describe(config)}: removed ${removed.plans} plans and ${removed.favorites} favorites.`)
  console.log(`Now: plans=${counts.plans}, favorites=${counts.favorites}`)
  if (counts.plans !== 0 || counts.favorites !== 0) process.exitCode = 1
} catch (error) {
  console.error(`Reset failed for ${describe(config)}: ${error instanceof Error ? error.message : String(error)}. Run npm run db:migrate first if the database is new.`)
  process.exitCode = 1
} finally {
  await db.close()
}
