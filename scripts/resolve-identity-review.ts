import { existsSync } from 'node:fs'
import { connectDatabase, resolveSqlitePath } from '../server/db/connect'
import { IdentityReviewResolutionError, resolveIdentityLinkReview } from '../server/services/membership/identity-review'

const usage = `Usage: pnpm run db:identity-review:resolve -- [options]

Links one reviewed website account to one existing canonical person.

Options:
  --review-id <id>             Open identity review to resolve
  --person-id <id>             Existing canonical person selected by the reviewer
  --database-url <file:...>    Override NUXT_DATABASE_URL
  --confirm-resolve            Required acknowledgement that ownership was reviewed
  --help                       Show this help
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
    if (!options.confirm || !options.personId || !options.reviewId) throw new IdentityReviewResolutionError()
    const databaseUrl = options.databaseUrl ?? process.env.NUXT_DATABASE_URL?.trim()
    if (!databaseUrl) throw new IdentityReviewResolutionError()
    const databasePath = resolveSqlitePath(databaseUrl)
    if (databasePath === ':memory:' || !existsSync(databasePath)) throw new IdentityReviewResolutionError()

    connection = connectDatabase(databaseUrl)
    const resolved = resolveIdentityLinkReview(connection, {
      personId: options.personId,
      reviewId: options.reviewId
    })
    process.stdout.write(
      `${JSON.stringify({ personId: resolved.personId, reviewId: resolved.reviewId, status: 'resolved' })}\n`
    )
  } catch {
    process.stderr.write('Identity review resolution failed. No account merge was performed.\n')
    process.exitCode = 1
  } finally {
    connection?.sqlite.close()
  }
}

type ParsedArguments = Readonly<{
  confirm: boolean
  databaseUrl: string | null
  help: boolean
  personId: string | null
  reviewId: string | null
}>

function parseArguments(arguments_: readonly string[]): ParsedArguments {
  let confirm = false
  let databaseUrl: string | null = null
  let help = false
  let personId: string | null = null
  let reviewId: string | null = null

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!
    if (argument === '--') continue
    if (argument === '--confirm-resolve') {
      if (confirm) throw new IdentityReviewResolutionError()
      confirm = true
      continue
    }
    if (argument === '--help') {
      help = true
      continue
    }
    const [key, inlineValue] = splitOption(argument)
    if (!['--database-url', '--person-id', '--review-id'].includes(key)) {
      throw new IdentityReviewResolutionError()
    }
    const value = inlineValue ?? arguments_[++index]
    if (!value || value.startsWith('--')) throw new IdentityReviewResolutionError()
    if (key === '--database-url') databaseUrl = once(databaseUrl, value)
    if (key === '--person-id') personId = once(personId, value)
    if (key === '--review-id') reviewId = once(reviewId, value)
  }
  return Object.freeze({ confirm, databaseUrl, help, personId, reviewId })
}

function splitOption(argument: string): readonly [string, string | undefined] {
  const separator = argument.indexOf('=')
  return separator === -1 ? [argument, undefined] : [argument.slice(0, separator), argument.slice(separator + 1)]
}

function once(current: string | null, value: string): string {
  if (current !== null) throw new IdentityReviewResolutionError()
  return value
}
