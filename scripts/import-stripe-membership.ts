import { existsSync } from 'node:fs'
import { connectDatabase, resolveSqlitePath } from '../server/db/connect'
import { createStripeClient } from '../server/services/payments/stripe/stripe-client'
import { importStripeMembershipDataset } from '../server/services/membership/stripe-import'
import {
  createStripeMembershipImportSource,
  fetchStripeMembershipImportDataset
} from '../server/services/membership/stripe-import-source'

const usage = `Usage: pnpm db:import:stripe -- --grandfathered-before <ISO timestamp> [options]

Reads Stripe and reports the membership import without changing Stripe.
The command is a local database dry-run unless --apply is provided.

Options:
  --apply                         Write the imported records to SQLite
  --database-url <file:...>       Override NUXT_DATABASE_URL
  --grandfathered-before <ISO>    Existing subscribers before this cutoff become active members
  --observed-at <ISO>             Override the observation time (primarily for controlled runs)
  --help                          Show this help

Environment:
  NUXT_DATABASE_URL
  NUXT_STRIPE_SECRET_KEY
  WCU_MEMBERSHIP_GRANDFATHERED_BEFORE
`

const options = parseArguments(process.argv.slice(2))
if (options.help) {
  process.stdout.write(usage)
  process.exit(0)
}

const databaseUrl = options.databaseUrl ?? process.env.NUXT_DATABASE_URL?.trim()
if (!databaseUrl) throw new Error('NUXT_DATABASE_URL or --database-url is required')
const databasePath = resolveSqlitePath(databaseUrl)
if (databasePath !== ':memory:' && !existsSync(databasePath)) {
  throw new Error('The target SQLite database does not exist; run the packaged migrations first')
}

const secretKey = process.env.NUXT_STRIPE_SECRET_KEY?.trim()
if (!secretKey) throw new Error('NUXT_STRIPE_SECRET_KEY is required')
if (!/^rk_(?:test|live)_[A-Za-z0-9_]+$/.test(secretKey)) {
  throw new Error('NUXT_STRIPE_SECRET_KEY must be a Stripe restricted API key')
}
const grandfatheredBeforeValue = options.grandfatheredBefore ?? process.env.WCU_MEMBERSHIP_GRANDFATHERED_BEFORE?.trim()
if (!grandfatheredBeforeValue) {
  throw new Error('--grandfathered-before or WCU_MEMBERSHIP_GRANDFATHERED_BEFORE is required')
}

const observedAt = parseDate(options.observedAt ?? new Date().toISOString(), 'observed-at')
const grandfatheredBefore = parseDate(grandfatheredBeforeValue, 'grandfathered-before')
const connection = connectDatabase(databaseUrl)

try {
  const source = createStripeMembershipImportSource(createStripeClient(secretKey))
  const dataset = await fetchStripeMembershipImportDataset(source)
  const report = importStripeMembershipDataset(connection, dataset, {
    apply: options.apply,
    grandfatheredBefore,
    observedAt
  })
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} finally {
  connection.sqlite.close()
}

type ParsedArguments = Readonly<{
  apply: boolean
  databaseUrl: string | null
  grandfatheredBefore: string | null
  help: boolean
  observedAt: string | null
}>

function parseArguments(arguments_: readonly string[]): ParsedArguments {
  let apply = false
  let databaseUrl: string | null = null
  let grandfatheredBefore: string | null = null
  let help = false
  let observedAt: string | null = null

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
  return Object.freeze({ apply, databaseUrl, grandfatheredBefore, help, observedAt })
}

function splitOption(argument: string): readonly [string, string | undefined] {
  const separator = argument.indexOf('=')
  return separator === -1 ? [argument, undefined] : [argument.slice(0, separator), argument.slice(separator + 1)]
}

function once(current: string | null, value: string, key: string): string {
  if (current !== null) throw new Error(`${key} may be provided only once`)
  return value
}

function parseDate(value: string, label: string): Date {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be an ISO timestamp`)
  return date
}
