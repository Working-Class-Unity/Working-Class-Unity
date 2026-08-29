import { existsSync } from 'node:fs'
import { connectDatabase, resolveSqlitePath } from '../server/db/connect'
import {
  readStripeMembershipAdoptionPrices,
  StripeMembershipLinkSyncReadError,
  synchronizeStripeMembershipLinks
} from '../server/services/membership/stripe-link-sync'
import {
  acquireStripeMembershipSyncLock,
  assertStripeMembershipSyncKey,
  configureStripeMembershipSyncDatabase,
  StripeMembershipSyncError,
  stripeMembershipSyncFailureCode
} from '../server/services/membership/stripe-sync-state'
import { createStripeClient } from '../server/services/payments/stripe/stripe-client'

const usage = `Usage: node .output/server/sync-stripe-membership-links.mjs [options]

Reads Stripe to adopt and refresh exact account membership links without changing Stripe.
The command is a local database dry-run unless --apply is provided.

Options:
  --apply                         Write exact account membership links to SQLite
  --validate-config               Validate production configuration without calling Stripe
  --help                          Show this help

Environment: NUXT_DATABASE_URL, WCU_STRIPE_MEMBERSHIP_SYNC_KEY, WCU_STRIPE_MEMBERSHIP_SYNC_MODE,
  WCU_STRIPE_LEGACY_DUES10_PRICE_IDS, WCU_STRIPE_LEGACY_DUES27_PRICE_IDS
`

await main()

function parseArguments(arguments_: readonly string[]) {
  const values = new Set(arguments_.filter((value) => value !== '--'))
  if ([...values].some((value) => !['--apply', '--help', '--validate-config'].includes(value))) {
    throw new StripeMembershipSyncError('configuration_invalid')
  }
  const apply = values.has('--apply')
  const help = values.has('--help')
  const validateConfig = values.has('--validate-config')
  if (validateConfig && apply) throw new StripeMembershipSyncError('configuration_invalid')
  return Object.freeze({ apply, help, validateConfig })
}

async function main(): Promise<void> {
  let connection: ReturnType<typeof connectDatabase> | null = null
  let releaseLock: (() => void) | null = null
  try {
    const options = parseArguments(process.argv.slice(2))
    if (options.help) {
      process.stdout.write(usage)
      return
    }
    const databaseUrl = process.env.NUXT_DATABASE_URL?.trim()
    if (!databaseUrl) throw new StripeMembershipSyncError('configuration_invalid')
    const databasePath = resolveSqlitePath(databaseUrl)
    if (databasePath !== ':memory:' && !existsSync(databasePath)) {
      throw new StripeMembershipSyncError('configuration_invalid')
    }
    const mode = process.env.WCU_STRIPE_MEMBERSHIP_SYNC_MODE?.trim()
    const secretKey = process.env.WCU_STRIPE_MEMBERSHIP_SYNC_KEY?.trim()
    if ((mode !== 'live' && mode !== 'test') || !secretKey) {
      throw new StripeMembershipSyncError('configuration_invalid')
    }
    assertStripeMembershipSyncKey(mode, secretKey)
    const legacyPrices = readLegacyPrices()
    connection = connectDatabase(databaseUrl)
    configureStripeMembershipSyncDatabase(connection)
    assertAccountMembershipSchema(connection)
    if (options.validateConfig) {
      process.stdout.write('Stripe account membership synchronization configuration passed.\n')
      return
    }

    if (options.apply) releaseLock = acquireStripeMembershipSyncLock(connection.databasePath)
    const report = await synchronizeStripeMembershipLinks({
      apply: options.apply,
      client: createStripeClient(secretKey),
      connection,
      legacyPrices
    })
    process.stdout.write(`${JSON.stringify(report)}\n`)
  } catch (error) {
    const code =
      error instanceof StripeMembershipLinkSyncReadError
        ? 'stripe_fetch_failed'
        : stripeMembershipSyncFailureCode(error)
    process.stderr.write(`Stripe membership synchronization failed: ${code}.\n`)
    process.exitCode = 1
  } finally {
    if (releaseLock) {
      try {
        releaseLock()
      } catch (error) {
        process.stderr.write(`Stripe membership synchronization failed: ${stripeMembershipSyncFailureCode(error)}.\n`)
        process.exitCode = 1
      }
    }
    connection?.sqlite.close()
  }
}

function readLegacyPrices() {
  try {
    return readStripeMembershipAdoptionPrices(process.env)
  } catch {
    throw new StripeMembershipSyncError('configuration_invalid')
  }
}

function assertAccountMembershipSchema(connection: ReturnType<typeof connectDatabase>): void {
  const columns = connection.sqlite.prepare("pragma table_info('account_stripe_memberships')").all() as Array<{
    name: string
  }>
  for (const name of ['stripe_status', 'last_verified_at', 'projection_order_ms', 'projection_event_id']) {
    if (!columns.some((column) => column.name === name)) throw new StripeMembershipSyncError('configuration_invalid')
  }
}
