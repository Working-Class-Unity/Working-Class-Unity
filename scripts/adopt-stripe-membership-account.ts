import { existsSync } from 'node:fs'
import { connectDatabase, resolveSqlitePath } from '../server/db/connect'
import { createTransactionalEmailSender } from '../server/services/email'
import { issueStripeAccountAdoptionLink } from '../server/services/membership/stripe-account-adoption'
import { readStripeMembershipAdoptionPrices } from '../server/services/membership/stripe-link-sync'
import {
  assertStripeMembershipSyncKey,
  configureStripeMembershipSyncDatabase,
  StripeMembershipSyncError,
  type StripeMembershipSyncMode
} from '../server/services/membership/stripe-sync-state'
import { createStripeClient } from '../server/services/payments/stripe/stripe-client'
import { readDatabaseUrl } from '../server/utils/runtime'

const usage = `Usage: node .output/server/adopt-stripe-membership-account.mjs [options]

Sends one account-adoption link for an exact active allowlisted Stripe subscription.
The account and Stripe link are created only after the customer-email link is redeemed.

Options:
  --subscription-id ID           Exact Stripe subscription to offer for adoption
  --validate-config              Validate operator configuration without calling Stripe or email
  --help                         Show this help
`

await main()

async function main(): Promise<void> {
  let connection: ReturnType<typeof connectDatabase> | null = null
  try {
    const options = parseArguments(process.argv.slice(2))
    if (options.help) {
      process.stdout.write(usage)
      return
    }

    const config = readConfiguration(process.env)
    connection = connectDatabase(config.databaseUrl)
    configureStripeMembershipSyncDatabase(connection)
    assertSchema(connection)
    if (options.validateConfig) {
      process.stdout.write('Stripe account adoption configuration passed.\n')
      return
    }
    if (!options.subscriptionId) throw new StripeMembershipSyncError('configuration_invalid')

    await issueStripeAccountAdoptionLink({
      appName: config.appName,
      appUrl: config.appUrl,
      client: createStripeClient(config.stripeKey),
      connection,
      prices: config.prices,
      sender: createTransactionalEmailSender({
        transport: 'resend',
        from: config.emailFrom,
        captureDirectory: '',
        resend: { apiKey: config.resendApiKey }
      }),
      subscriptionId: options.subscriptionId
    })
    process.stdout.write('Stripe account adoption link issued.\n')
  } catch (error) {
    const code = error instanceof StripeMembershipSyncError ? error.code : 'adoption_failed'
    process.stderr.write(`Stripe account adoption failed: ${code}.\n`)
    process.exitCode = 1
  } finally {
    connection?.sqlite.close()
  }
}

function parseArguments(arguments_: readonly string[]) {
  const values = arguments_.filter((value) => value !== '--')
  if (values.length === 1 && values[0] === '--help') {
    return Object.freeze({ help: true, subscriptionId: null, validateConfig: false })
  }
  if (values.length === 1 && values[0] === '--validate-config') {
    return Object.freeze({ help: false, subscriptionId: null, validateConfig: true })
  }
  if (values.length === 2 && values[0] === '--subscription-id' && /^sub_[A-Za-z0-9_]+$/.test(values[1] ?? '')) {
    return Object.freeze({ help: false, subscriptionId: values[1]!, validateConfig: false })
  }
  throw new StripeMembershipSyncError('configuration_invalid')
}

function readConfiguration(environment: NodeJS.ProcessEnv) {
  const databaseUrl = readDatabaseUrl(environment)
  const databasePath = resolveSqlitePath(databaseUrl)
  if (databasePath !== ':memory:' && !existsSync(databasePath)) {
    throw new StripeMembershipSyncError('configuration_invalid')
  }
  const mode = environment.WCU_STRIPE_MEMBERSHIP_SYNC_MODE?.trim()
  const stripeKey = environment.WCU_STRIPE_MEMBERSHIP_SYNC_KEY?.trim() ?? ''
  if (mode !== 'live' && mode !== 'test') throw new StripeMembershipSyncError('configuration_invalid')
  assertStripeMembershipSyncKey(mode, stripeKey)

  const appUrl = requireOrigin(environment.NUXT_PUBLIC_APP_URL, mode)
  const appName = requireTrimmed(environment.NUXT_PUBLIC_APP_NAME ?? 'Working Class Unity')
  if (environment.NUXT_EMAIL_TRANSPORT !== 'resend') {
    throw new StripeMembershipSyncError('configuration_invalid')
  }
  const emailFrom = requireTrimmed(environment.NUXT_EMAIL_FROM)
  if (/[\r\n]/.test(emailFrom)) throw new StripeMembershipSyncError('configuration_invalid')
  const resendApiKey = requireTrimmed(environment.NUXT_EMAIL_RESEND_API_KEY)
  if (!resendApiKey.startsWith('re_')) throw new StripeMembershipSyncError('configuration_invalid')

  try {
    return Object.freeze({
      appName,
      appUrl,
      databaseUrl,
      emailFrom,
      prices: readStripeMembershipAdoptionPrices(environment),
      resendApiKey,
      stripeKey
    })
  } catch {
    throw new StripeMembershipSyncError('configuration_invalid')
  }
}

function requireOrigin(value: string | undefined, mode: StripeMembershipSyncMode): string {
  try {
    const parsed = new URL(requireTrimmed(value))
    if (parsed.origin !== parsed.toString().replace(/\/$/, '') || (mode === 'live' && parsed.protocol !== 'https:')) {
      throw new Error('Invalid origin')
    }
    return parsed.origin
  } catch {
    throw new StripeMembershipSyncError('configuration_invalid')
  }
}

function requireTrimmed(value: string | undefined): string {
  if (!value || value !== value.trim()) throw new StripeMembershipSyncError('configuration_invalid')
  return value
}

function assertSchema(connection: ReturnType<typeof connectDatabase>): void {
  for (const table of ['user', 'verification', 'account_stripe_memberships', 'billing_account_deletion_requests']) {
    if (!connection.sqlite.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(table)) {
      throw new StripeMembershipSyncError('configuration_invalid')
    }
  }
}
