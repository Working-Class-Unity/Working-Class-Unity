import { existsSync } from 'node:fs'
import { connectDatabase, resolveSqlitePath } from '../server/db/connect'
import { createStripeClient } from '../server/services/payments/stripe/stripe-client'
import { assertMembershipSchema, importStripeMembershipDataset } from '../server/services/membership/stripe-import'
import {
  createStripeMembershipImportSource,
  fetchStripeMembershipImportDataset
} from '../server/services/membership/stripe-import-source'
import {
  acquireStripeMembershipSyncLock,
  assertStripeMembershipSyncBinding,
  assertStripeMembershipSyncKey,
  configureStripeMembershipSyncDatabase,
  recordStripeMembershipSyncCompleted,
  recordStripeMembershipSyncFailed,
  recordStripeMembershipSyncStarted,
  redactedStripeMembershipSyncReceipt,
  StripeMembershipSyncError,
  stripeMembershipSyncFailureCode,
  type StripeMembershipSyncFailureCode,
  type StripeMembershipSyncMode
} from '../server/services/membership/stripe-sync-state'

const usage = `Usage: node .output/server/import-stripe-membership.mjs [options]

Reads Stripe and reports the membership import without changing Stripe.
The command is a local database dry-run unless --apply is provided.

Options:
  --apply                         Write the imported records to SQLite
  --database-url <file:...>       Local-only override for NUXT_DATABASE_URL
  --grandfathered-before <ISO>    Local-only override for the grandfathering cutoff
  --observed-at <ISO>             Local-only override for controlled runs
  --validate-config               Validate production configuration without calling Stripe
  --help                          Show this help

Environment:
  NUXT_DATABASE_URL
  WCU_STRIPE_MEMBERSHIP_SYNC_KEY
  WCU_STRIPE_MEMBERSHIP_SYNC_MODE
  WCU_MEMBERSHIP_GRANDFATHERED_BEFORE
`

await main()

type ParsedArguments = Readonly<{
  apply: boolean
  databaseUrl: string | null
  grandfatheredBefore: string | null
  help: boolean
  observedAt: string | null
  validateConfig: boolean
}>

function parseArguments(arguments_: readonly string[]): ParsedArguments {
  let apply = false
  let databaseUrl: string | null = null
  let grandfatheredBefore: string | null = null
  let help = false
  let observedAt: string | null = null
  let validateConfig = false

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!
    if (argument === '--') continue
    if (argument === '--apply') {
      apply = true
      continue
    }
    if (argument === '--help') {
      help = true
      continue
    }
    if (argument === '--validate-config') {
      validateConfig = true
      continue
    }
    const [key, inlineValue] = splitOption(argument)
    if (!['--database-url', '--grandfathered-before', '--observed-at'].includes(key)) {
      throw new Error(`Unknown Stripe import option: ${key}`)
    }
    const value = inlineValue ?? arguments_[++index]
    if (!value || value.startsWith('--')) throw new Error(`${key} requires a value`)
    if (key === '--database-url') databaseUrl = once(databaseUrl, value, key)
    if (key === '--grandfathered-before') grandfatheredBefore = once(grandfatheredBefore, value, key)
    if (key === '--observed-at') observedAt = once(observedAt, value, key)
  }
  if (validateConfig && apply) throw new StripeMembershipSyncError('configuration_invalid')
  return Object.freeze({ apply, databaseUrl, grandfatheredBefore, help, observedAt, validateConfig })
}

function splitOption(argument: string): readonly [string, string | undefined] {
  const separator = argument.indexOf('=')
  return separator === -1 ? [argument, undefined] : [argument.slice(0, separator), argument.slice(separator + 1)]
}

function once(current: string | null, value: string, key: string): string {
  if (current !== null) throw new Error(`${key} may be provided only once`)
  return value
}

function parseDate(value: string): Date {
  const date = new Date(value)
  const canonicalValue = value.length === 20 ? `${value.slice(0, -1)}.000Z` : value
  if (
    Number.isNaN(date.getTime()) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ||
    date.toISOString() !== canonicalValue
  ) {
    throw new StripeMembershipSyncError('configuration_invalid')
  }
  return date
}

async function main(): Promise<void> {
  let connection: ReturnType<typeof connectDatabase> | null = null
  let releaseLock: (() => void) | null = null
  let failureCode: StripeMembershipSyncFailureCode = 'configuration_invalid'
  let syncContext: Readonly<{
    grandfatheredBefore: string
    mode: StripeMembershipSyncMode
    startedAt: string
  }> | null = null
  let syncStatusStarted = false
  try {
    const options = parseArguments(process.argv.slice(2))
    if (options.help) {
      process.stdout.write(usage)
      return
    }
    if (
      process.env.NODE_ENV === 'production' &&
      (options.databaseUrl || options.grandfatheredBefore || options.observedAt)
    ) {
      throw new StripeMembershipSyncError('configuration_invalid')
    }

    const databaseUrl = options.databaseUrl ?? process.env.NUXT_DATABASE_URL?.trim()
    if (!databaseUrl) throw new StripeMembershipSyncError('configuration_invalid')
    const databasePath = resolveSqlitePath(databaseUrl)
    if (databasePath !== ':memory:' && !existsSync(databasePath)) {
      throw new StripeMembershipSyncError('configuration_invalid')
    }

    const secretKey = process.env.WCU_STRIPE_MEMBERSHIP_SYNC_KEY?.trim()
    const mode = process.env.WCU_STRIPE_MEMBERSHIP_SYNC_MODE?.trim()
    if (mode !== 'live' && mode !== 'test') throw new StripeMembershipSyncError('configuration_invalid')
    if (!secretKey) throw new StripeMembershipSyncError('configuration_invalid')
    assertStripeMembershipSyncKey(mode, secretKey)
    const grandfatheredBeforeValue =
      options.grandfatheredBefore ?? process.env.WCU_MEMBERSHIP_GRANDFATHERED_BEFORE?.trim()
    if (!grandfatheredBeforeValue) throw new StripeMembershipSyncError('configuration_invalid')

    const observedAt = parseDate(options.observedAt ?? new Date().toISOString())
    const grandfatheredBefore = parseDate(grandfatheredBeforeValue)
    if (grandfatheredBefore.getTime() > observedAt.getTime()) {
      throw new StripeMembershipSyncError('configuration_invalid')
    }

    connection = connectDatabase(databaseUrl)
    configureStripeMembershipSyncDatabase(connection)
    assertMembershipSchema(connection.sqlite)
    assertStripeMembershipSyncBinding(connection, { grandfatheredBefore: grandfatheredBefore.toISOString(), mode })
    if (options.validateConfig) {
      process.stdout.write('Stripe membership synchronization configuration passed.\n')
      return
    }

    if (options.apply) releaseLock = acquireStripeMembershipSyncLock(connection.databasePath)
    const startedAt = new Date().toISOString()
    if (options.apply) {
      syncContext = { grandfatheredBefore: grandfatheredBefore.toISOString(), mode, startedAt }
      recordStripeMembershipSyncStarted(connection, syncContext)
      syncStatusStarted = true
    }

    failureCode = 'stripe_fetch_failed'
    const source = createStripeMembershipImportSource(createStripeClient(secretKey))
    const dataset = await fetchStripeMembershipImportDataset(source)
    failureCode = 'import_failed'
    const report = importStripeMembershipDataset(connection, dataset, {
      apply: options.apply,
      grandfatheredBefore,
      observedAt
    })
    if (options.apply) {
      recordStripeMembershipSyncCompleted(connection, {
        completedAt: new Date().toISOString(),
        grandfatheredBefore: syncContext!.grandfatheredBefore,
        mode: syncContext!.mode,
        report,
        startedAt: syncContext!.startedAt
      })
      syncStatusStarted = false
    }
    process.stdout.write(`${JSON.stringify(redactedStripeMembershipSyncReceipt(report))}\n`)
  } catch (error) {
    const mappedCode = stripeMembershipSyncFailureCode(error)
    const code = mappedCode === 'import_failed' ? failureCode : mappedCode
    if (connection && syncContext && syncStatusStarted) {
      try {
        recordStripeMembershipSyncFailed(connection, {
          completedAt: new Date().toISOString(),
          failureCode: code,
          grandfatheredBefore: syncContext.grandfatheredBefore,
          mode: syncContext.mode,
          startedAt: syncContext.startedAt
        })
      } catch {
        // The private task failure notification remains the fallback when SQLite cannot record status.
      }
    }
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
